"""O app com o SDK DE VERDADE do Firebase, contra os emuladores de Auth e Firestore.

O e2e (tests/e2e.py) troca o SDK por um stub. Este teste nao: carrega os
modulos reais do www.gstatic.com/firebasejs e liga o modo de teste do app
(?emulador=PORTA_AUTH,PORTA_FIRESTORE, que so funciona em 127.0.0.1 ou
localhost). O Firestore do emulador roda com o firestore.rules deste
repositorio, entao toda leitura e gravacao passa pelas mesmas regras do
projeto real. Nada sai pro Google: qualquer pedido fora do servidor local, dos
emuladores, das fontes e do CDN do SDK e bloqueado e derruba o teste.

Percorre, em cada motor (WebKit com perfil de iPhone 13 e Chromium com perfil
de Pixel 7): conta inexistente, senha errada, recuperacao de senha (com e sem
conta), login, anuncio com foto (products), reserva e venda (events e sales),
venda na loja, fechamento de caixa, remocao, recarregar a pagina continuando
logada, sair e entrar com outra vendedora que nao ve nada da primeira.

Uso (Java 21 e a CLI do Firebase, sem login; o projeto demo-luxus e so local):
  firebase emulators:exec --only auth,firestore --project demo-luxus "python3 tests/emulador.py"
Opcoes: --motor chromium,webkit (padrao: os dois). Com DEPURA=1 imprime os
passos, os pedidos ao Firestore e quanto cada gravacao levou pra chegar.
"""
import argparse
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent
FOTO = str(AQUI / "peca-teste.jpg")
PROJETO = "demo-luxus"
CHAVE = "chave-de-teste"   # a mesma que o app usa no modo de teste
AUTH = os.environ.get("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:8576")
FS = os.environ.get("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8577")
APARELHO = {"chromium": "Pixel 7", "webkit": "iPhone 13"}
ANA = ("ana@example.com", "senha-da-ana-123")
BIA = ("bia@example.com", "senha-da-bia-456")

erros, falhas, ok = [], [], []
estado = {"motor": ""}


def checa(cond, nome):
    (ok if cond else falhas).append("[%s] %s" % (estado["motor"], nome))


# ---------- servidor: o site como esta, so com os emuladores liberados na CSP ----------

def html_de_teste():
    """index.html com os dois emuladores somados ao connect-src. O resto da CSP
    fica identico ao publicado, e isso e conferido aqui mesmo."""
    original = (RAIZ / "index.html").read_text(encoding="utf-8")
    extra = " http://%s http://%s" % (AUTH, FS)
    novo, n = re.subn(r"(connect-src [^;\"]+)", lambda m: m.group(1) + extra, original)
    if n != 1:
        raise SystemExit("nao achei o connect-src da CSP no index.html")
    csp = lambda t: re.search(r'http-equiv="Content-Security-Policy" content="([^"]+)"', t).group(1)
    tira = lambda t: [d.strip() for d in t.split(";") if not d.strip().startswith("connect-src")]
    if tira(csp(original)) != tira(csp(novo)):
        raise SystemExit("a CSP de teste mudou mais do que o connect-src")
    return novo.encode("utf-8")


class Servidor(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.split("?")[0] in ("/", "/index.html"):
            corpo = html_de_teste()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(corpo)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(corpo)
            return
        super().do_GET()


def servir():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), partial(Servidor, directory=str(RAIZ)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, "http://127.0.0.1:%d/" % srv.server_address[1]


# ---------- emuladores pela API REST (so local) ----------

def rest(metodo, url, corpo=None, cabecalhos=None):
    dados = json.dumps(corpo).encode() if corpo is not None else None
    r = urllib.request.Request(url, data=dados, method=metodo)
    r.add_header("Content-Type", "application/json")
    for k, v in (cabecalhos or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:300]


def limpa_emuladores():
    rest("DELETE", "http://%s/emulator/v1/projects/%s/accounts" % (AUTH, PROJETO))
    rest("DELETE", "http://%s/emulator/v1/projects/%s/databases/(default)/documents" % (FS, PROJETO))


def cria_conta(email, senha):
    st, r = rest("POST", "http://%s/identitytoolkit.googleapis.com/v1/accounts:signUp?key=%s" % (AUTH, CHAVE),
                 {"email": email, "password": senha, "returnSecureToken": True})
    if st != 200:
        raise SystemExit("o emulador nao criou a conta de teste: %s %s" % (st, r))
    return r["localId"]


def codigos_de_senha():
    st, r = rest("GET", "http://%s/emulator/v1/projects/%s/oobCodes" % (AUTH, PROJETO))
    return [c for c in (r or {}).get("oobCodes", []) if c.get("requestType") == "PASSWORD_RESET"] if st == 200 else []


def documentos(colecao):
    """Le pelo emulador como administrador (Bearer owner ignora as regras): so pra conferir."""
    st, r = rest("GET", "http://%s/v1/projects/%s/databases/(default)/documents/%s?pageSize=300" % (FS, PROJETO, colecao),
                 cabecalhos={"Authorization": "Bearer owner"})
    if st != 200:
        return []
    saida = []
    for d in (r or {}).get("documents", []):
        campos = {}
        for k, v in d.get("fields", {}).items():
            campos[k] = next(iter(v.values())) if v else None
        campos["_id"] = d["name"].rsplit("/", 1)[1]
        saida.append(campos)
    return saida


# ---------- navegador ----------

def espera(pg, expressao, timeout=15000):
    limite = time.time() + timeout / 1000
    while True:
        if pg.evaluate(expressao):
            return True
        if time.time() > limite:
            return False
        pg.wait_for_timeout(100)


def espera_banco(teste, timeout=int(os.environ.get("ESPERA_BANCO", "15"))):
    limite = time.time() + timeout
    t0 = time.time()
    while time.time() < limite:
        try:
            if teste():
                if os.environ.get("DEPURA"):
                    print("banco chegou em %.1fs" % (time.time() - t0), file=sys.stderr)
                return True
        except (IndexError, KeyError):
            pass
        time.sleep(0.25)
    return False


def resumo_do_banco():
    return {c: [{k: v for k, v in d.items() if k in ("status", "type", "cashoutSent", "to")} for d in documentos(c)]
            for c in ("products", "events", "sales")}


T0 = time.time()


def marca(passo):
    if os.environ.get("DEPURA"):
        print("passo %.1f %s" % (time.time() - T0, passo), file=sys.stderr)


def entra(pg, email, senha):
    pg.fill("#loginEmail", email)
    pg.fill("#loginSenha", senha)
    pg.click("#btnLogin")


def fluxo(b, p, url):
    opcoes = {k: v for k, v in p.devices[APARELHO[estado["motor"]]].items() if k != "default_browser_type"}
    ctx = b.new_context(**opcoes)
    fora, respostas_ruins = [], []
    permitidos = (url, "http://%s/" % AUTH, "http://%s/" % FS, "https://www.gstatic.com/firebasejs/10.12.0/",
                  "https://fonts.googleapis.com/", "https://fonts.gstatic.com/")

    # Sem interceptar pedidos: com ctx.route o Playwright segura a resposta em
    # streaming do Firestore (o canal de gravacao) ate ela fechar, e a
    # confirmacao de cada gravacao chegava 90 segundos depois. Aqui so se
    # anota tudo que sai; qualquer endereco fora da lista derruba o teste. O
    # projeto e um demo-, entao mesmo um pedido que escapasse nao acharia nada.
    ctx.on("request", lambda r: None if r.url.startswith(permitidos) or r.url.startswith("data:") else fora.append(r.url))
    # os links do WhatsApp abririam outra aba: aqui eles so ficam anotados
    ctx.add_init_script("window.__aberturas = []; window.open = u => { window.__aberturas.push(String(u)); return null; };"
                        "window.__avisos = []; document.addEventListener('DOMContentLoaded', () => new MutationObserver(() => {"
                        " const t = document.getElementById('toast'); if (t.classList.contains('on')) window.__avisos.push(t.textContent); })"
                        ".observe(document.getElementById('toast'), {attributes: true, childList: true}));")
    pg = ctx.new_page()
    if os.environ.get("DEPURA"):
        pg.set_default_timeout(120000)
    pg.on("dialog", lambda d: d.accept())

    def erro_de_pagina(e):
        marca("pageerror " + str(e)[:90])
        # Ao recarregar, o WebKit cancela os pedidos do Firestore que estavam
        # abertos e anuncia cada um como "access control checks". Acontece no
        # instante do reload e so nele (conferido com DEPURA=1); fora dessa
        # janela a mesma mensagem derruba o teste.
        if estado.get("recarregando") and estado["motor"] == "webkit" and "Firestore" in str(e) and "access control checks" in str(e):
            return
        erros.append("[%s] pageerror: %s" % (estado["motor"], e))

    pg.on("pageerror", erro_de_pagina)
    pg.on("response", lambda r: respostas_ruins.append((r.status, r.url.split("?")[0])) if r.status >= 400 else None)
    if os.environ.get("DEPURA"):
        t0 = time.time()
        pg.on("request", lambda r: print("req %.1f %s" % (time.time() - t0, r.url[:160]), file=sys.stderr) if FS in r.url else None)
        pg.on("requestfinished", lambda r: print("fim %.1f %s" % (time.time() - t0, r.url[:160]), file=sys.stderr) if FS in r.url else None)

    def console(m):
        t = m.text
        if os.environ.get("DEPURA"):
            print("console", m.type, t[:300], file=sys.stderr)
        if "Content Security Policy" in t or "Refused to" in t:
            erros.append("[%s] csp: %s" % (estado["motor"], t))
        elif m.type == "error" and "Failed to load resource" not in t:
            erros.append("[%s] console: %s" % (estado["motor"], t))

    pg.on("console", console)
    endereco = url + "?emulador=%s,%s" % (AUTH.rsplit(":", 1)[1], FS.rsplit(":", 1)[1])

    pg.goto(endereco)
    checa(espera(pg, "!document.getElementById('loginScreen').hidden"), "login aparece com o SDK de verdade")
    pg.wait_for_timeout(1500)

    marca("login errado")
    # credencial errada, nos dois sabores: a tela diz a mesma coisa
    entra(pg, "nao-existe@example.com", "qualquer-senha")
    checa(espera(pg, "document.getElementById('loginErr').textContent === 'Email ou senha incorretos.'"),
          "conta inexistente: Email ou senha incorretos")
    entra(pg, ANA[0], "senha-errada")
    pg.wait_for_timeout(300)
    checa(espera(pg, "document.getElementById('loginErr').textContent === 'Email ou senha incorretos.' && !document.getElementById('btnLogin').disabled"),
          "senha errada: a mesma mensagem")

    # recuperacao de senha: com conta gera o codigo no emulador, sem conta nao, e a tela e igual
    antes = len(codigos_de_senha())
    pg.fill("#loginEmail", ANA[0])
    pg.click("#btnEsqueci")
    checa(espera(pg, "document.getElementById('loginMsg').textContent.includes('Se esse email tiver conta')"),
          "esqueci a senha com conta: mensagem neutra")
    codigos = codigos_de_senha()
    checa(len(codigos) == antes + 1 and codigos[-1].get("email") == ANA[0], "esqueci a senha com conta: o Auth gerou o link de troca")
    pg.fill("#loginEmail", "nao-existe@example.com")
    pg.click("#btnEsqueci")
    pg.wait_for_timeout(300)
    checa(espera(pg, "document.getElementById('loginMsg').textContent.includes('Se esse email tiver conta') && !document.getElementById('btnEsqueci').disabled"),
          "esqueci a senha sem conta: a mesma mensagem")
    checa(len(codigos_de_senha()) == antes + 1, "esqueci a senha sem conta: nenhum link gerado")

    # login de verdade
    entra(pg, *ANA)
    checa(espera(pg, "!document.getElementById('appWrapper').hidden && document.getElementById('loggedEmail').textContent === '%s'" % ANA[0]),
          "login com email e senha entra no app")
    pg.click("#btnConfig")
    pg.fill("#telefone", "5511900000000")
    pg.fill("#brecoNome", "Luxus Brechó")
    pg.fill("#meuTel", "11900000001")
    pg.click("#cfgCard .btn-primary")
    pg.wait_for_timeout(1200)

    marca("gerar")
    # anuncio com foto: products
    pg.set_input_files("#fotoGaleria", FOTO)
    espera(pg, "!document.getElementById('previewZone').hidden")
    pg.fill("#preco", "45")
    pg.fill("#tamanho", "37")
    pg.click("#catTags .tag:has-text('Calçado')")
    pg.click("#btnGerar")
    checa(espera(pg, "document.getElementById('resultStatus').textContent === 'Anúncio pronto e salvo no histórico'"),
          "anuncio salvo: o Firestore confirmou a gravacao")
    msg = pg.inner_text("#msgResult")
    cod = re.search(r"Código \*?([A-Z0-9]{6})", msg)
    prods = documentos("products")
    checa(len(prods) == 1 and prods[0].get("brecoOwner") == estado["uid_ana"] and prods[0].get("status") == "available"
          and str(prods[0].get("foto64", "")).startswith("data:image/jpeg;base64,") and cod and prods[0].get("prodCod") == cod.group(1),
          "products: o documento gravado tem a dona, a foto e o codigo do anuncio")

    marca("reservar e vender")
    # reservar e vender: products atualizado, events e sales criados
    pg.click("#tabHistorico")
    checa(espera(pg, "document.querySelectorAll('#histList .hist-item').length === 1"), "historico le o produto do banco")
    pg.click("#histList [data-action='status'][data-para='reserved']")
    reservou = espera_banco(lambda: documentos("products")[0].get("status") == "reserved" and len(documentos("events")) == 1)
    checa(reservou, "reservar: status no banco e evento registrado" + ("" if reservou else " %s" % json.dumps(resumo_do_banco())))
    pg.click("#histList [data-action='status'][data-para='sold']")
    checa(espera_banco(lambda: documentos("products")[0].get("status") == "sold" and len(documentos("events")) == 2
                       and len(documentos("sales")) == 1), "vender: status, evento e venda no banco")
    vendas = documentos("sales")
    checa(vendas and vendas[0].get("sellerId") == estado["uid_ana"] and vendas[0].get("type") == "online", "sales: venda online com a vendedora certa")

    marca("venda na loja")
    # venda na loja, fechamento de caixa e remocao
    pg.click("[data-action='venda-loja']")
    pg.wait_for_timeout(600)
    pg.fill("#vfDesc", "Bolsa de couro bege")
    pg.fill("#vfPreco", "80")
    pg.press("#vfPreco", "Enter")
    checa(espera_banco(lambda: len(documentos("products")) == 2 and len(documentos("sales")) == 2),
          "venda na loja: produto vendido e venda no banco")
    checa(espera(pg, "!document.querySelector('#histList .hist-saving')"), "venda na loja: cartao sai do 'salvando'")
    pg.click("[data-action='fechar-caixa']")
    checa(espera_banco(lambda: all(d.get("cashoutSent") is True for d in documentos("products"))), "fechar caixa: as duas vendas marcadas no banco")
    pg.click("#histList [data-action='remover-venda']")
    checa(espera_banco(lambda: len(documentos("products")) == 1), "remover venda da loja: apagada no banco")

    aberturas = pg.evaluate("window.__aberturas")
    checa(len(aberturas) == 2 and all(u.startswith("https://wa.me/5511900000001?text=") for u in aberturas),
          "alerta de venda e fechamento de caixa vao pro WhatsApp da vendedora")

    # recarregar: continua logada e le o historico do banco
    marca("recarregar")
    estado["recarregando"] = True
    pg.reload()
    checa(espera(pg, "!document.getElementById('appWrapper').hidden && document.getElementById('loggedEmail').textContent === '%s'" % ANA[0]),
          "recarregar a pagina mantem a sessao")
    estado["recarregando"] = False
    pg.click("#tabHistorico")
    checa(espera(pg, "document.querySelectorAll('#histList .hist-item').length === 1 && document.querySelector('#histList .hist-status').textContent.includes('Vendido')"),
          "depois de recarregar, o historico volta do banco")

    marca("outra vendedora")
    # outra vendedora nao ve nada da primeira
    pg.click("#btnConfig")
    pg.click("[data-action='sair']")
    checa(espera(pg, "!document.getElementById('loginScreen').hidden"), "sair volta pro login")
    entra(pg, *BIA)
    checa(espera(pg, "document.getElementById('loggedEmail').textContent === '%s'" % BIA[0]), "segunda vendedora entra")
    pg.click("#tabHistorico")
    checa(espera(pg, "document.getElementById('histList').textContent.includes('Nenhum produto ainda')"),
          "segunda vendedora nao ve os produtos da primeira")

    if os.environ.get("DEPURA"):
        print("banco", json.dumps(resumo_do_banco()), "avisos", pg.evaluate("window.__avisos"), file=sys.stderr)
    ruins = [r for r in respostas_ruins if "accounts:signInWithPassword" not in r[1] and "accounts:sendOobCode" not in r[1]]
    checa(not ruins, "nenhuma resposta de erro alem dos logins e da recuperacao recusados de proposito (%s)" % ruins[:3])
    checa(not fora, "nada saiu pra fora do servidor local, dos emuladores e do CDN (%s)" % fora[:3])
    ctx.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--motor", default="chromium,webkit", help="motores, separados por virgula")
    args = ap.parse_args()
    motores = [m.strip() for m in args.motor.split(",") if m.strip()]
    srv, url = servir()
    try:
        with sync_playwright() as p:
            for motor in motores:
                estado["motor"] = motor
                limpa_emuladores()
                estado["uid_ana"] = cria_conta(*ANA)
                cria_conta(*BIA)
                b = getattr(p, motor).launch()
                fluxo(b, p, url)
                b.close()
    finally:
        srv.shutdown()
    print(json.dumps({"ok": ok, "falhas": falhas, "erros_js": erros[:12]}, ensure_ascii=False, indent=1))
    if falhas or erros:
        print("FALHOU: %d falha(s), %d erro(s) no console" % (len(falhas), len(erros)), file=sys.stderr)
        sys.exit(1)
    print("OK: %d verificacoes em %s, com o SDK de verdade e os emuladores" % (len(ok), ", ".join(motores)), file=sys.stderr)


if __name__ == "__main__":
    main()
