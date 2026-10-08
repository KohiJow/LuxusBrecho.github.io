"""Teste de ponta a ponta do app, com Firebase de mentira (stub.js).

Sobe um servidor estatico na raiz do repositorio, abre o app num Chromium de
celular e percorre o fluxo inteiro: login, configuracao, anuncio com foto,
historico, busca, temas. Qualquer erro de JavaScript ou violacao da CSP no
console derruba o teste.

Uso:  python tests/e2e.py [--saida PASTA] [--url http://host:porta/]
Sem --url, o servidor sobe sozinho numa porta livre. As capturas de tela vao
para tests/saida (ignorada pelo git).
"""
import argparse
import json
import re
import sys
import threading
import urllib.parse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent
FOTO = str(AQUI / "peca-teste.jpg")
STUB = (AQUI / "stub.js").read_text(encoding="utf-8")

erros, falhas, ok = [], [], []


def checa(cond, nome):
    (ok if cond else falhas).append(nome)


class Silencioso(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def servir():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), partial(Silencioso, directory=str(RAIZ)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, "http://127.0.0.1:%d/" % srv.server_address[1]


def foto(pg, caminho, cheia=False):
    pg.evaluate("window.scrollTo({top: 0, behavior: 'instant'})")
    pg.wait_for_timeout(450)
    pg.screenshot(path=str(caminho), full_page=cheia)


def prepara(ctx):
    ctx.add_init_script(STUB)

    def rota(r):
        u = r.request.url
        if "firebasejs" in u:
            return r.fulfill(status=200, content_type="application/javascript", body="")
        if ("googleapis.com" in u and "fonts.googleapis.com" not in u) or "firebaseio" in u:
            return r.abort()
        return r.continue_()

    ctx.route("**/*", rota)


def vigia(pg):
    pg.on("pageerror", lambda e: erros.append("pageerror: " + str(e)))

    def console(m):
        t = m.text
        if "Content Security Policy" in t or "Refused to" in t:
            erros.append("csp: " + t)
        elif m.type == "error" and "ERR_FAILED" not in t:
            erros.append("console: " + t)

    pg.on("console", console)


def roda(url, saida):
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        prepara(ctx)
        pg = ctx.new_page()
        vigia(pg)
        pg.goto(url)
        pg.wait_for_timeout(3200)
        foto(pg, saida / "1-login-claro.png")
        checa(pg.is_visible("#loginScreen"), "login aparece")
        checa(pg.evaluate("getComputedStyle(document.querySelector('.login-card')).opacity") == "1", "cartao do login visivel depois da animacao")
        checa(pg.evaluate("document.documentElement.getAttribute('data-theme')") is None, "creme e o tema padrao")
        checa(pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "login sem rolagem horizontal")

        pg.evaluate("applyTheme(true)")
        pg.wait_for_timeout(500)
        foto(pg, saida / "2-login-noite.png")
        pg.evaluate("applyTheme(false)")

        # entra como usuaria de teste (falsa), com o banco demorando pra mostrar o esqueleto
        pg.evaluate("window.__atrasoDb = 2500; window.__authCb({uid:'uid-teste', email:'teste@exemplo.com'})")
        pg.wait_for_timeout(300)
        pg.click("#tabHistorico")
        pg.wait_for_timeout(500)
        checa(pg.locator("#histList .skel").count() == 3, "esqueleto enquanto o banco carrega")
        foto(pg, saida / "3-historico-carregando.png")
        pg.wait_for_timeout(2600)
        checa("Nenhum produto ainda" in pg.inner_text("#histList"), "estado vazio depois de carregar")
        pg.click("#tabAnuncio")
        pg.wait_for_timeout(600)

        # configura a loja
        pg.click("#btnConfig")
        pg.wait_for_timeout(300)
        pg.fill("#telefone", "5511900000000")
        pg.fill("#brecoNome", "Luxus Brechó")
        pg.click("#cfgCard .btn-primary")
        pg.wait_for_timeout(300)
        if pg.is_visible("#cfgCard"):
            pg.click("#btnConfig")

        # anuncio com foto
        pg.set_input_files("#fotoGaleria", FOTO)
        pg.wait_for_timeout(2600)
        checa(pg.is_visible("#previewZone"), "foto vira polaroid")
        pg.fill("#preco", "45")
        pg.fill("#tamanho", "37")
        pg.click("#catTags .tag:has-text('Calçado')")
        pg.fill("#obs", "Melissa azul com cadarço amarelo")
        foto(pg, saida / "4-anunciar-com-foto.png", True)
        pg.click("#btnGerar")
        pg.wait_for_timeout(2500)
        checa(pg.is_visible("#resultCard"), "anuncio gerado na hora")
        msg = pg.inner_text("#msgResult")
        cod = re.search(r"Código \*?([A-Z0-9]{6})", msg)
        checa(bool(cod), "codigo aparece no post do grupo")
        foto(pg, saida / "5-resultado.png", True)
        # mensagem que a cliente manda: a do link de verdade
        href = re.search(r"https://wa\.me/\S+", msg).group(0)
        pedido = urllib.parse.unquote(href.split("text=")[1])
        checa("Melissa azul com cadarço amarelo" in pedido, "pedido da cliente traz o detalhe da peca")
        checa(bool(cod) and cod.group(1) in pedido, "pedido da cliente traz o codigo")
        checa(len(href) < 260, "link de reserva curto (%d caracteres)" % len(href))

        # historico + busca por codigo
        pg.click("#tabHistorico")
        pg.wait_for_timeout(900)
        codigo_card = pg.inner_text("#histList .hist-code") if pg.locator("#histList .hist-code").count() else ""
        checa(bool(cod) and cod.group(1) in codigo_card, "codigo aparece no card do historico")
        checa(pg.inner_text("#histList .hist-name").count("👟") == 1, "emoji nao duplica no nome")
        checa(pg.inner_text("#cntDisp").strip() == "1", "contador de disponiveis = 1")
        foto(pg, saida / "6-historico.png", True)
        if cod:
            pg.fill("#histSearch", cod.group(1).lower())
            pg.wait_for_timeout(400)
            checa(pg.locator("#histList .hist-item").count() == 1, "busca pelo codigo acha a peca")
        pg.fill("#histSearch", "ZZZ999")
        pg.wait_for_timeout(400)
        checa("Nenhuma peça encontrada" in pg.inner_text("#histList"), "busca sem resultado avisa")
        foto(pg, saida / "7-busca-vazia.png")
        pg.fill("#histSearch", "")
        pg.wait_for_timeout(300)
        checa(pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "app sem rolagem horizontal")

        pg.evaluate("applyTheme(true)")
        pg.wait_for_timeout(500)
        foto(pg, saida / "8-historico-noite.png", True)
        pg.click("#tabAnuncio")
        pg.wait_for_timeout(700)
        checa(pg.evaluate("getComputedStyle(document.getElementById('preview')).animationName") == "none", "foto nao revela de novo ao voltar a aba")
        foto(pg, saida / "9-resultado-noite.png", True)

        # quem pediu menos movimento: tudo tem que aparecer parado
        ctx2 = b.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce")
        prepara(ctx2)
        pg2 = ctx2.new_page()
        vigia(pg2)
        pg2.goto(url)
        pg2.wait_for_timeout(800)
        checa(pg2.evaluate("getComputedStyle(document.querySelector('.login-card')).opacity") == "1", "movimento reduzido: login visivel sem esperar")
        b.close()
    return {"codigo": cod.group(1) if cod else None, "pedido": pedido}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--saida", default=str(AQUI / "saida"), help="pasta das capturas de tela")
    ap.add_argument("--url", default=None, help="usar um servidor ja no ar em vez de subir um")
    args = ap.parse_args()
    saida = Path(args.saida)
    saida.mkdir(parents=True, exist_ok=True)

    srv = None
    url = args.url
    if not url:
        srv, url = servir()
    try:
        extra = roda(url, saida)
    finally:
        if srv:
            srv.shutdown()

    resumo = {"ok": ok, "falhas": falhas, "erros_js": erros[:12]}
    resumo.update(extra)
    print(json.dumps(resumo, ensure_ascii=False, indent=1))
    if falhas or erros:
        print("FALHOU: %d falha(s), %d erro(s) no console" % (len(falhas), len(erros)), file=sys.stderr)
        sys.exit(1)
    print("OK: %d verificacoes" % len(ok), file=sys.stderr)


if __name__ == "__main__":
    main()
