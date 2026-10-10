"""Teste de ponta a ponta do app, com Firebase de mentira (stub.js).

Sobe um servidor estatico na raiz do repositorio e percorre o fluxo inteiro em
dois motores: WebKit com perfil de iPhone 13 (o motor do Safari) e Chromium com
perfil de Pixel 7 (o motor do Chrome e do Brave no Android). Login, configuracao,
anuncio com foto, historico, status, venda na loja, fechamento de caixa, busca e
temas, mais as animacoes: cada uma e congelada no meio (Web Animations API) pra
conferir que aparece, e depois solta pra conferir o estado final. Qualquer erro
de JavaScript ou violacao da CSP no console derruba o teste. Nada sai pra
internet alem das fontes do Google: o SDK do Firebase e trocado pelo stub, que
anota o que o app tentou gravar e abrir.

Uso:  python tests/e2e.py [--motor chromium,webkit] [--saida PASTA] [--url http://host:porta/]
Sem --url, o servidor sobe sozinho numa porta livre. As capturas de tela vao
para tests/saida/<motor> (ignorada pelo git).
"""
import argparse
import base64
import hashlib
import io
import json
import re
import statistics
import sys
import threading
import time
import urllib.parse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent
FOTO = str(AQUI / "peca-teste.jpg")
STUB = (AQUI / "stub.js").read_text(encoding="utf-8")
# O index.html exige o hash sha384 de cada modulo do SDK (SRI). O stub entra no
# lugar deles, entao a pagina servida aqui leva o hash do stub; a pagina
# original, com os hashes de verdade, e usada para provar que o SRI bloqueia.
HASH_STUB = "sha384-" + base64.b64encode(hashlib.sha384(STUB.encode("utf-8")).digest()).decode()
INDEX_ORIGINAL = (RAIZ / "index.html").read_text(encoding="utf-8")
INDEX_COM_STUB = re.sub(r'(firebasejs/[^"]+" integrity=")sha384-[A-Za-z0-9+/=]+', lambda m: m.group(1) + HASH_STUB, INDEX_ORIGINAL)
APP_JS = (RAIZ / "app.js").read_text(encoding="utf-8")
USUARIA = "{uid:'uid-teste', email:'teste@example.com'}"
CAMPOS_PRODUTO = {"ts", "emoji", "cats", "estado", "estLabel", "tam", "obs", "precoNum", "precoStr", "link", "msg",
                  "foto64", "prodCod", "brecoNome", "brecoOwner", "sellerEmail", "status", "soldAt", "cashoutSent", "type"}
LIMITE_MINIATURA, LIMITE_FOTO = 16000, 300000   # os mesmos de LIMITE em app.js e das regras
# perfil de aparelho de cada motor (nomes da lista de aparelhos do Playwright)
APARELHO = {"chromium": "Pixel 7", "webkit": "iPhone 13"}
# a tela de login tambem e conferida nestes, no motor do Safari
APARELHOS_LOGIN = {"chromium": ["Pixel 7"], "webkit": ["iPhone 13", "iPhone SE"]}
# O WebKit do Playwright injeta uma folha de estilo pra tirar a captura de tela,
# e a CSP do app recusa: a mesma mensagem aparece numa pagina vazia com a mesma
# politica, entao e da ferramenta, nao do app. So e ignorada durante a captura.
RECUSA_DA_CAPTURA = "Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive"

erros, falhas, ok = [], [], []
estado = {"motor": "", "capturando": False}


def checa(cond, nome):
    (ok if cond else falhas).append("[%s] %s" % (estado["motor"], nome))


class Silencioso(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        # a pagina vai com o hash do stub no lugar dos hashes do SDK; o resto e servido como esta
        if self.path.split("?")[0] in ("/", "/index.html"):
            corpo = INDEX_COM_STUB.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(corpo)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(corpo)
            return
        super().do_GET()


def servir():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), partial(Silencioso, directory=str(RAIZ)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, "http://127.0.0.1:%d/" % srv.server_address[1]


def bytes_da_data_url(data_url):
    return len(base64.b64decode(data_url.split(",", 1)[1]))


# Folha de compartilhamento de mentira: anota texto e arquivos que o app passou
# e responde como o teste mandar (window.__shareErro = nome do erro pra falhar).
FOLHA_DE_COMPARTILHAR = """window.__compartilhados = [];
    navigator.canShare = d => true;
    navigator.share = async d => { if (window.__shareErro) { const e = new Error('x'); e.name = window.__shareErro; throw e; }
      window.__compartilhados.push({ text: d.text, arquivos: (d.files || []).map(f => ({ nome: f.name, tipo: f.type, bytes: f.size })) }); };"""


def foto_neutra(largura, altura):
    """JPEG em data URL com listras e uma forma, sem pessoa nenhuma."""
    im = Image.new("RGB", (largura, altura), (236, 228, 214))
    d = ImageDraw.Draw(im)
    for i in range(0, (largura + altura) * 2, 40):
        d.line([(i, 0), (i - altura, altura)], fill=(47, 111, 134), width=14)
    d.ellipse([largura * .3, altura * .3, largura * .7, altura * .7], fill=(242, 121, 91))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=70)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def captura(pg, caminho=None, cheia=False, elemento=None):
    estado["capturando"] = True
    try:
        if elemento:
            return pg.locator(elemento).screenshot()
        return pg.screenshot(path=str(caminho), full_page=cheia)
    finally:
        pg.wait_for_timeout(150)
        estado["capturando"] = False


def foto(pg, caminho, cheia=False):
    pg.evaluate("window.scrollTo({top: 0, behavior: 'instant'})")
    pg.wait_for_timeout(450)
    captura(pg, caminho, cheia)


def prepara(ctx, url, pedidos=None):
    def rota(r):
        u = r.request.url
        if pedidos is not None:
            pedidos.append(u)
        if "/firebasejs/" in u:
            # o mesmo modulo de mentira responde pelos modulos do SDK
            return r.fulfill(status=200, content_type="text/javascript", body=STUB,
                             headers={"Access-Control-Allow-Origin": "*"})
        if u.startswith(url) or u.startswith("https://fonts.googleapis.com/") or u.startswith("https://fonts.gstatic.com/"):
            return r.continue_()
        return r.abort()

    ctx.route("**/*", rota)


def vigia(pg):
    pg.on("pageerror", lambda e: erros.append("[%s] pageerror: %s" % (estado["motor"], e)))
    pg.on("dialog", lambda d: d.accept())

    def console(m):
        t = m.text
        if estado["capturando"] and estado["motor"] == "webkit" and t.startswith(RECUSA_DA_CAPTURA):
            return
        if "Content Security Policy" in t or "Refused to" in t:
            erros.append("[%s] csp: %s" % (estado["motor"], t))
        elif m.type == "error" and "ERR_FAILED" not in t:
            erros.append("[%s] console: %s" % (estado["motor"], t))

    pg.on("console", console)


def contexto(b, url, pedidos=None, **extra):
    opcoes = dict(PERFIS[estado["motor"]])
    opcoes.update(extra)
    ctx = b.new_context(**opcoes)
    prepara(ctx, url, pedidos)
    return ctx


def sem_sobreposicao(pg):
    """As polaroids do fundo do login nao podem cobrir o titulo, a frase de cima nem a de baixo.
    Amostra algumas vezes porque elas flutuam (floatA) depois de entrar."""
    piores = []
    for _ in range(4):
        caixas = pg.evaluate("""() => { const r = s => { const b = document.querySelector(s).getBoundingClientRect();
                return [b.left, b.top, b.right, b.bottom]; };
            const texto = ['.login-eyebrow', '.login-head h1', '.login-head p'].map(r);
            const polas = [...document.querySelectorAll('.pola')].map(p => { const b = p.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; });
            let pior = 0;
            for (const t of texto) for (const p of polas) {
              const w = Math.min(t[2], p[2]) - Math.max(t[0], p[0]), h = Math.min(t[3], p[3]) - Math.max(t[1], p[1]);
              if (w > 0 && h > 0) pior = Math.max(pior, Math.round(Math.min(w, h)));
            }
            return pior; }""")
        piores.append(caixas)
        pg.wait_for_timeout(350)
    return max(piores)


def tema(pg, escuro):
    # so pra tirar foto do login nos dois temas; o botao de verdade e testado dentro do app
    pg.evaluate("document.documentElement.%s('data-theme', 'dark')" % ("setAttribute" if escuro else "removeAttribute"))
    pg.wait_for_timeout(500)


def escritas(pg, op=None, col=None):
    todas = pg.evaluate("window.__escritas")
    return [e for e in todas if (op is None or e["op"] == op) and (col is None or e.get("col") == col)]


def folhas_desenhadas(png):
    # o ramo fica no canto superior esquerdo do login; se o <use> do symbol animou,
    # o canto tem centenas de pixels no verde-azulado das folhas
    img = Image.open(png).convert("RGB")
    w, h = img.size
    recorte = img.crop((0, 0, min(w, 420), min(h, 420)))
    teal = sum(1 for r, g, b in recorte.getdata() if b > r + 25 and g > r + 10 and r < 130)
    return teal > 300


def tinta_por_metade(png_bytes):
    """Pixels de tinta (o gradiente coral e rosa do titulo) na metade esquerda e na direita."""
    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    w, h = img.size
    esq = dir_ = 0
    for i, (r, g, b) in enumerate(img.getdata()):
        if r > 140 and g < 120 and r - g > 70:
            if i % w < w // 2:
                esq += 1
            else:
                dir_ += 1
    return esq, dir_


def variacao(png_bytes):
    """Desvio padrao do brilho: imagem em branco (nada renderizado) da perto de zero."""
    img = Image.open(io.BytesIO(png_bytes)).convert("L")
    return statistics.pstdev(list(img.getdata()))


def congela(pg, seletor, fracao):
    """Pausa as animacoes do elemento numa fracao da duracao (atraso incluido)."""
    return pg.evaluate("""([sel, f]) => { const el = document.querySelector(sel); if (!el) return 0;
        const as = el.getAnimations(); as.forEach(a => { a.pause(); const t = a.effect.getComputedTiming();
        const dur = Number.isFinite(t.activeDuration) ? t.activeDuration : t.duration;
        a.currentTime = (t.delay || 0) + dur * f; }); return as.length; }""", [seletor, fracao])


def solta(pg, seletor):
    pg.evaluate("""sel => document.querySelectorAll(sel).forEach(el => el.getAnimations().forEach(a => {
        const t = a.effect.getComputedTiming(); if (t.iterations === Infinity) a.play(); else a.finish(); }))""", seletor)


def espera(pg, expressao, timeout=8000):
    """wait_for_function sem eval: a CSP do app proibe avaliar texto como codigo."""
    limite = time.time() + timeout / 1000
    while True:
        if pg.evaluate(expressao):
            return
        if time.time() > limite:
            raise AssertionError("esperou demais por: " + expressao)
        pg.wait_for_timeout(50)


def chega(pg, expressao, nome, timeout=8000):
    """Confere um estado final esperando por ele. Sleep fixo nao serve: o
    WebKit do conteiner (sem GPU) produz poucos quadros por segundo, e o que
    depende de requestAnimationFrame ou do fim de animacao chega mais tarde."""
    try:
        espera(pg, expressao, timeout)
        checa(True, nome)
    except AssertionError:
        checa(False, nome)


def sem_rolagem(pg):
    return pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


def entra(pg, atraso=0):
    pg.evaluate("window.__atrasoDb = %d; window.__authCb(%s)" % (atraso, USUARIA))
    pg.wait_for_timeout(300)


def doc_produto(i, foto64, status, codigo):
    agora = int(time.time() * 1000)
    return {"id": "d%d" % i, "data": {
        "ts": agora - i * 60000, "emoji": "\U0001F457", "cats": ["\U0001F457 Vestido"], "estado": ["\u2728 Ótimo"],
        "estLabel": "Ótimo", "tam": "M", "obs": "", "precoNum": 40 + i, "precoStr": "%d,00" % (40 + i), "link": "",
        "msg": "", "foto64": foto64, "prodCod": codigo, "brecoNome": "Luxus Brechó", "brecoOwner": "uid-teste",
        "sellerEmail": "teste@example.com", "status": status, "soldAt": agora - i * 1000 if status == "sold" else None,
        "cashoutSent": False, "type": "online"}}


def abertura_do_login(pg, saida):
    """O titulo em gradiente se escreve da esquerda pra direita e termina inteiro."""
    espera(pg, "document.querySelector('.login-head h1').getAnimations().length > 0")
    congela(pg, ".login-head h1", 0.12)
    tamanho = pg.evaluate("getComputedStyle(document.querySelector('.login-head h1')).backgroundSize")
    esq, dir_ = tinta_por_metade(captura(pg, elemento=".login-head h1"))
    checa(esq > 150 and dir_ < esq / 4, "titulo do login no meio da escrita: tinta na esquerda (%d px), quase nada na direita (%d px), fundo em %s"
          % (esq, dir_, tamanho))
    solta(pg, ".login-head h1")
    esq, dir_ = tinta_por_metade(captura(pg, elemento=".login-head h1"))
    checa(esq > 150 and dir_ > 150, "titulo do login termina inteiro (%d e %d px de tinta)" % (esq, dir_))
    checa(pg.evaluate("getComputedStyle(document.querySelector('.login-head h1')).backgroundSize") == "100% 100%",
          "titulo do login: estado final do fundo e 100%")
    animacoes = pg.evaluate("""() => { const h = document.querySelector('.login-head h1');
        return h.getAnimations().map(a => a.animationName); }""")
    checa(animacoes == [] or animacoes == ["escrever"], "titulo em gradiente so anima propriedade de fundo")


def fluxo_principal(b, url, saida):
    pedidos = []
    ctx = contexto(b, url, pedidos)
    ctx.add_init_script(FOLHA_DE_COMPARTILHAR)
    pg = ctx.new_page()
    vigia(pg)
    pg.goto(url)
    abertura_do_login(pg, saida)
    pg.wait_for_timeout(3200)
    foto(pg, saida / "1-login-claro.png")
    checa(pg.is_visible("#loginScreen"), "login aparece")
    checa(pg.evaluate("getComputedStyle(document.querySelector('.login-card')).opacity") == "1", "cartao do login visivel depois da animacao")
    checa(pg.evaluate("document.documentElement.getAttribute('data-theme')") is None, "creme e o tema padrao")
    checa(sem_rolagem(pg), "login sem rolagem horizontal")
    checa(folhas_desenhadas(saida / "1-login-claro.png"), "folhas do fundo se desenham a partir do symbol")
    sobra = sem_sobreposicao(pg)
    checa(sobra == 0, "%s: nenhuma polaroid cobre o titulo nem as frases do login (sobreposicao de %d px)" % (APARELHO[estado["motor"]], sobra))
    checa(pg.evaluate("window.__opcoesAuth && window.__opcoesAuth.popupRedirectResolver === undefined"),
          "Auth montado sem o resolvedor de popup (nada de apis.google.com)")
    checa(pg.evaluate("window.__config.projectId") == "brechobase" and not pg.evaluate("!!window.__emuladorLigado"),
          "fora de ?emulador=, o app usa o projeto real e nao liga emulador")
    # SRI: os tres modulos do SDK chegam por tag de script com hash e sem credenciais
    links = pg.evaluate("""[...document.querySelectorAll('script[type=module][src*="firebasejs"]')].map(l => [l.src, l.integrity, l.crossOrigin])""")
    checa(len(links) == 3 and all(h.startswith("https://www.gstatic.com/firebasejs/10.12.0/") and i.startswith("sha384-") and c == "anonymous" for h, i, c in links)
          and {h.rsplit("/", 1)[1] for h, _, _ in links} == {"firebase-app.js", "firebase-auth.js", "firebase-firestore.js"},
          "os tres modulos do SDK entram por script type=module com integrity sha384 e crossorigin anonymous")
    checa(not any("app-check" in u for u in pedidos) and pg.evaluate("window.__appCheck") is None,
          "sem chave, o App Check nao e baixado nem montado")
    pedidos.clear()

    tema(pg, True)
    foto(pg, saida / "2-login-noite.png")
    tema(pg, False)

    # login errado: a mensagem nao conta se o email existe
    pg.fill("#loginEmail", "alguem@example.com")
    pg.fill("#loginSenha", "errada")
    pg.click("#btnLogin")
    pg.wait_for_timeout(300)
    checa(pg.inner_text("#loginErr") == "Email ou senha incorretos.", "senha errada: mensagem generica")
    pg.evaluate("window.__erroLogin = 'auth/user-not-found'")
    pg.press("#loginSenha", "Enter")
    pg.wait_for_timeout(300)
    checa(pg.inner_text("#loginErr") == "Email ou senha incorretos.", "usuario inexistente: a mesma mensagem")
    checa(not pg.is_disabled("#btnLogin"), "botao de entrar volta a funcionar depois do erro")
    foto(pg, saida / "2b-login-erro.png")

    # esqueci minha senha
    pg.fill("#loginEmail", "")
    pg.click("#btnEsqueci")
    pg.wait_for_timeout(200)
    checa("Digite seu email" in pg.inner_text("#loginErr"), "esqueci a senha sem email pede o email")
    checa(pg.evaluate("document.activeElement.id") == "loginEmail", "e leva o foco pro campo")
    pg.fill("#loginEmail", "alguem@example.com")
    pg.click("#btnEsqueci")
    pg.wait_for_timeout(300)
    checa("Se esse email tiver conta" in pg.inner_text("#loginMsg"), "esqueci a senha confirma sem revelar se a conta existe")
    checa(len(escritas(pg, "reset")) == 1, "sendPasswordResetEmail foi chamado uma vez")
    foto(pg, saida / "2c-login-esqueci.png")

    # entra como usuaria de teste (falsa), com o banco segurando a resposta pra mostrar o esqueleto
    pg.evaluate("window.__seguraDb = true")
    entra(pg)
    checa(pg.is_hidden("#loginScreen") and pg.is_visible("#appWrapper"), "entrou no app")
    checa(pg.inner_text("#loggedEmail") == "teste@example.com", "email da conta aparece no cabecalho")
    pg.click("#tabHistorico")
    pg.wait_for_timeout(500)
    checa(pg.locator("#histList .skel").count() == 3, "esqueleto enquanto o banco carrega")
    foto(pg, saida / "3-historico-carregando.png")
    pg.evaluate("window.__seguraDb = false; window.__soltaDb()")
    espera(pg, "!!document.querySelector('#histList .hist-empty')")
    checa("Nenhum produto ainda" in pg.inner_text("#histList"), "estado vazio depois de carregar")

    # banco recusa: o historico mostra o motivo e oferece tentar de novo
    pg.evaluate("window.__falhaDb = true; window.__atrasoDb = 0; window.__authCb(null); window.__authCb(%s)" % USUARIA)
    pg.wait_for_timeout(500)
    pg.click("#tabHistorico")
    pg.wait_for_timeout(400)
    checa("Não deu pra carregar o histórico" in pg.inner_text("#histList") and "sem permissão" in pg.inner_text("#histList"),
          "consulta recusada: erro visivel com o motivo")
    foto(pg, saida / "3b-historico-erro.png")
    pg.evaluate("window.__falhaDb = false")
    pg.click("#histList [data-action='recarregar']")
    pg.wait_for_timeout(400)
    checa("Nenhum produto ainda" in pg.inner_text("#histList"), "tentar de novo recarrega o historico")

    # dados maliciosos vindos do banco viram texto, nunca marcacao
    pg.evaluate("""window.__docs = [{id: 'x1', data: {ts: Date.now(), emoji: '<b>', cats: ['<img src=x onerror="window.__xss=1">'],
        estado: [], estLabel: '</div><script>window.__xss=2</script>', tam: '"><svg onload=alert(1)>', obs: '',
        precoNum: 10, precoStr: '<i>10,00</i>', link: '', msg: '', foto64: 'javascript:alert(1)',
        prodCod: '<u>AB</u>', brecoNome: '<marquee>loja</marquee>', brecoOwner: 'uid-teste', sellerEmail: '',
        status: 'available', soldAt: null, cashoutSent: false, type: 'online'}}];
        window.__authCb(null); window.__authCb(%s)""" % USUARIA)
    pg.wait_for_timeout(500)
    pg.click("#tabHistorico")
    pg.wait_for_timeout(500)
    texto = pg.inner_text("#histList")
    checa(pg.locator("#histList img, #histList script, #histList marquee, #histList svg:not(.hist-empty svg), #histList u, #histList i, #histList b").count() == 0,
          "nenhuma tag injetada pelo historico")
    checa('<img src=x onerror="window.__xss=1">' in texto and "<marquee>loja</marquee>" in texto, "o conteudo malicioso aparece como texto")
    checa(pg.evaluate("window.__xss") is None, "nenhum script do banco rodou")
    checa(pg.locator("#histList .hist-thumb-emoji").count() == 1, "foto64 que nao e imagem vira miniatura de emoji")
    foto(pg, saida / "3c-historico-xss.png")

    # historico com fotos de verdade: retrato 480x900 e paisagem 900x480 vindas do banco.
    # A primeira e um anuncio novo (miniatura no produto, foto grande no documento
    # proprio); a segunda e um anuncio antigo (foto inteira no produto, sem documento proprio)
    retrato, paisagem, grande = foto_neutra(480, 900), foto_neutra(900, 480), foto_neutra(640, 640)
    docs = [doc_produto(1, retrato, "available", "RTR234"), doc_produto(2, paisagem, "available", "PSG567"),
            doc_produto(3, None, "reserved", "NFT789"), doc_produto(4, retrato, "sold", "VND234")]
    for d in docs:
        d["data"]["msg"] = "mensagem da peca " + d["data"]["prodCod"]
    pg.evaluate("([docs, grande]) => { window.__docs = docs; window.__fotos = {d1: grande}; window.__authCb(null); window.__authCb(%s); }" % USUARIA, [docs, grande])
    pg.wait_for_timeout(500)
    pg.click("#tabHistorico")
    pg.wait_for_timeout(1200)
    # reenviar: a foto grande vem do documento proprio quando existe, senao a do produto
    checa(pg.locator("#histList [data-action='reenviar']").count() == 2, "reenviar so nas pecas disponiveis que tem mensagem")
    pg.click("#histList .hist-item:has-text('RTR234') [data-action='reenviar']")
    espera(pg, "window.__compartilhados.length === 1")
    comp = pg.evaluate("window.__compartilhados[0]")
    checa(comp["text"] == "mensagem da peca RTR234" and comp["arquivos"] and comp["arquivos"][0]["bytes"] == bytes_da_data_url(grande),
          "reenviar manda a mensagem salva e a foto grande lida do documento proprio (%s)" % json.dumps(comp)[:120])
    checa(pg.evaluate("window.__leituras") == ["products/d1/fotos/principal"], "a foto grande so e lida ao reenviar, e so a dessa peca")
    checa("Compartilhado com a foto" in pg.inner_text("#toast"), "reenviar confirma com aviso")
    checa(not pg.is_disabled("#histList .hist-item:has-text('RTR234') [data-action='reenviar']"), "botao de reenviar volta ao normal")
    pg.click("#histList .hist-item:has-text('PSG567') [data-action='reenviar']")
    espera(pg, "window.__compartilhados.length === 2")
    comp = pg.evaluate("window.__compartilhados[1]")
    checa(comp["arquivos"] and comp["arquivos"][0]["bytes"] == bytes_da_data_url(paisagem) and pg.evaluate("window.__leituras.length") == 2,
          "anuncio antigo sem documento proprio: reenviar usa a foto que esta no produto")
    for cod, nome in (("RTR234", "retrato 480x900"), ("PSG567", "paisagem 900x480")):
        caixas = pg.evaluate("""cod => { const item = [...document.querySelectorAll('#histList .hist-item')].find(i => i.textContent.includes(cod));
            const m = item.querySelector('.hist-thumb').getBoundingClientRect(), f = item.querySelector('.hist-thumb img').getBoundingClientRect();
            return [m.top, m.bottom, m.left, m.right, f.top, f.bottom, f.left, f.right, f.width, f.height]; }""", cod)
        checa(caixas[4] >= caixas[0] - 1 and caixas[5] <= caixas[1] + 1 and caixas[6] >= caixas[2] - 1 and caixas[7] <= caixas[3] + 1
              and caixas[8] > 40 and caixas[9] > 40, "miniatura em %s fica dentro da moldura e visivel" % nome)
    checa(pg.evaluate("[...document.querySelectorAll('#histList .hist-thumb img')].every(i => i.decoding === 'async')"),
          "miniaturas decodificam fora do quadro (decoding=async)")
    chega(pg, "document.getElementById('cntDisp').textContent.trim() === '2' && document.getElementById('cntRes').textContent.trim() === '1'",
          "contagem chega nos valores certos")
    foto(pg, saida / "3d-historico-fotos.png", True)

    # a lista nao e refeita a cada mudanca: busca e reserva mantem os outros cartoes
    pg.evaluate("document.querySelectorAll('#histList .hist-item').forEach((el, i) => el.__marca = 'm' + i)")
    pg.fill("#histSearch", "psg")
    pg.wait_for_timeout(300)
    checa(pg.locator("#histList .hist-item").count() == 1 and pg.evaluate("document.querySelector('#histList .hist-item').__marca") is not None,
          "busca filtra reaproveitando o cartao que ja estava na tela")
    checa(pg.evaluate("document.activeElement.id") == "histSearch", "a busca continua com o foco enquanto a lista muda")
    pg.fill("#histSearch", "")
    pg.wait_for_timeout(300)
    checa(pg.evaluate("[...document.querySelectorAll('#histList .hist-item')].every(el => el.__marca)"),
          "limpar a busca devolve os mesmos cartoes, sem montar de novo")
    pg.click("#histList .hist-item:has-text('PSG567') [data-action='status'][data-para='reserved']")
    pg.wait_for_timeout(250)
    resultado = pg.evaluate("""() => { const itens = [...document.querySelectorAll('#histList .hist-item')];
        const outros = itens.filter(el => !el.textContent.includes('PSG567'));
        return { mantidos: outros.every(el => el.__marca), animando: outros.filter(el => el.getAnimations().some(a => a.animationName === 'itemIn')).length }; }""")
    checa(resultado["mantidos"] and resultado["animando"] == 0, "reservar troca so o cartao da peca; os outros nao piscam (%s)" % json.dumps(resultado))
    pg.evaluate("window.__docs = []; window.__authCb(null); window.__authCb(%s)" % USUARIA)
    pg.wait_for_timeout(500)
    pg.click("#tabAnuncio")
    pg.wait_for_timeout(600)
    pg.evaluate("window.__escritas.length = 0")

    # configura a loja
    pg.click("#btnConfig")
    pg.wait_for_timeout(300)
    checa(pg.get_attribute("#btnConfig", "aria-expanded") == "true" and pg.is_visible("#cfgCard"), "configuracoes abrem")
    checa(pg.is_hidden(".aviso-movimento"), "sem 'reduzir movimento', o aviso de animacoes desligadas fica escondido")
    dicas = pg.evaluate("[document.getElementById('telefone').placeholder, document.getElementById('meuTel').placeholder]")
    checa(all(not re.search(r"\d{5}", d) for d in dicas), "os telefones de exemplo sao mascaras, sem numero completo (%s)" % dicas)
    pg.fill("#telefone", "5511900000000")
    pg.fill("#brecoNome", "Luxus Brechó")
    pg.fill("#meuTel", "11900000001")
    pg.click("#cfgCard .btn-primary")
    pg.wait_for_timeout(1100)
    checa(pg.is_hidden("#cfgCard"), "salvar fecha as configuracoes")
    checa(pg.evaluate("JSON.parse(localStorage.getItem('brecho_cfg_v2')).telefone") == "5511900000000", "configuracao fica no localStorage")

    # cabecalho perto do topo: nao pode ficar abrindo e fechando sozinho
    altura = pg.evaluate("document.querySelector('.header').offsetHeight")
    tremor = pg.evaluate("""() => new Promise(ok => { const h = document.querySelector('.header'); let trocas = 0;
        const mo = new MutationObserver(() => trocas++); mo.observe(h, {attributes: true, attributeFilter: ['class']});
        window.scrollTo({top: 10, behavior: 'instant'});
        setTimeout(() => { mo.disconnect(); ok({trocas, y: window.scrollY, encolhido: h.classList.contains('scrolled'), altura: h.offsetHeight}); }, 1200); })""")
    checa(tremor["trocas"] <= 1 and tremor["y"] == 10 and tremor["encolhido"], "cabecalho a 10px do topo encolhe uma vez e para (%s)" % json.dumps(tremor))
    checa(tremor["altura"] == altura, "cabecalho encolhido tem a mesma altura (nada embaixo dele se mexe)")
    pg.evaluate("window.scrollTo({top: 0, behavior: 'instant'})")
    pg.wait_for_timeout(300)

    # tentar gerar sem preco: erro visivel e foco no campo
    pg.click("#btnGerar")
    pg.wait_for_timeout(300)
    checa(pg.is_visible("#errBar") and "preço" in pg.inner_text("#errBar"), "sem preco: aviso de erro")
    checa(pg.evaluate("document.activeElement.id") == "preco", "sem preco: foco vai pro preco")
    foto(pg, saida / "3e-anunciar-erro.png")

    # etiquetas pelo teclado
    pg.focus("#catTags .tag:has-text('Vestido')")
    pg.keyboard.press("Space")
    checa(pg.get_attribute("#catTags .tag:has-text('Vestido')", "aria-checked") == "true", "espaco marca a categoria")
    pg.keyboard.press("Enter")
    checa(pg.get_attribute("#catTags .tag:has-text('Vestido')", "aria-checked") == "false", "enter desmarca a categoria")
    pg.focus("#stateTags .tag[tabindex='0']")
    pg.keyboard.press("ArrowRight")
    checa(pg.get_attribute("#stateTags .tag:has-text('Bom')", "aria-checked") == "true"
          and pg.evaluate("document.activeElement.textContent.trim()") == "\U0001F44C Bom", "seta muda o estado e leva o foco")
    checa(pg.locator("#stateTags .tag[tabindex='0']").count() == 1, "so um estado entra no Tab")
    pg.keyboard.press("ArrowLeft")

    # anuncio com foto: a polaroid revela com a foto ja pronta
    pg.set_input_files("#fotoGaleria", FOTO)
    pg.wait_for_selector("#previewZone:not([hidden])")
    checa(pg.evaluate("document.getElementById('preview').complete && document.getElementById('preview').naturalWidth > 0"),
          "a polaroid entra com a foto ja decodificada")
    congela(pg, "#preview", 0.25)
    filtro = pg.evaluate("getComputedStyle(document.getElementById('preview')).filter")
    checa("brightness" in filtro and "blur" not in filtro, "foto no meio da revelacao: lavada, sem blur (%s)" % filtro)
    checa(variacao(captura(pg, elemento="#preview")) > 3, "foto no meio da revelacao aparece (nao e um quadro em branco)")
    solta(pg, "#preview")
    pg.wait_for_timeout(400)
    chega(pg, "document.getElementById('previewZone').classList.contains('revelada')", "foto revelada fica marcada e nao revela de novo")
    checa(pg.is_visible("#previewZone"), "foto vira polaroid")
    pg.fill("#preco", "45")
    pg.fill("#tamanho", "37")
    pg.click("#catTags .tag:has-text('Calçado')")
    pg.fill("#obs", "Melissa azul com cadarço amarelo")
    foto(pg, saida / "4-anunciar-com-foto.png", True)

    # gerar com o banco demorando como na rede de verdade: o cartao anima uma
    # vez so e o confete sai uma vez so, mesmo quando o "salvo" chega depois
    pg.evaluate("""() => { window.__atrasoAdd = 900; window.__inicios = 0; window.__confetes = 0;
        document.getElementById('resultCard').addEventListener('animationstart', e => { if (e.target.id === 'resultCard') window.__inicios++; });
        new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList && n.classList.contains('confete')) window.__confetes++; })))
          .observe(document.body, {childList: true}); }""")
    pg.click("#btnGerar")
    pg.wait_for_selector(".confete i", state="attached", timeout=8000)
    voo = pg.evaluate("""() => { const pecas = [...document.querySelectorAll('.confete i')];
        pecas.forEach(p => p.getAnimations().forEach(a => { a.pause(); a.currentTime = a.effect.getComputedTiming().duration * 0.3; }));
        const vistas = pecas.filter(p => { const r = p.getBoundingClientRect(); return Number(getComputedStyle(p).opacity) > 0.3
          && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; }).length;
        const r = pecas.map(p => p.getBoundingClientRect()); const xs = r.map(b => b.left);
        return { pecas: pecas.length, vistas, espalhadas: Math.max(...xs) - Math.min(...xs) }; }""")
    checa(voo["pecas"] == 34 and voo["vistas"] >= 12 and voo["espalhadas"] > 80, "confete no meio do voo aparece espalhado (%s)" % json.dumps(voo))
    pg.evaluate("document.querySelectorAll('.confete i').forEach(p => p.getAnimations().forEach(a => a.finish()))")
    espera(pg, "document.getElementById('resultStatus').textContent.includes('salvo no histórico')", timeout=8000)
    pg.wait_for_timeout(1200)
    checa(pg.evaluate("window.__inicios") == 1 and pg.evaluate("window.__confetes") == 1,
          "salvo chegando depois nao reanima o cartao nem repete o confete (%d animacao, %d confete)"
          % (pg.evaluate("window.__inicios"), pg.evaluate("window.__confetes")))
    checa(pg.locator(".confete").count() == 0, "confete sai da pagina quando termina")
    # o cartao rola ate a vista e para logo abaixo do cabecalho grudado: o topo
    # dele (o "salvo no historico" e o tique) nao pode ficar escondido atras
    chega(pg, """(() => { const h = document.querySelector('.header').getBoundingClientRect();
        const t = document.querySelector('#resultCard .result-top').getBoundingClientRect();
        return t.top >= h.bottom - 1 && t.bottom <= innerHeight; })()""",
          "cartao do anuncio para abaixo do cabecalho, com o topo a vista")
    pg.evaluate("window.__atrasoAdd = 0")
    checa(pg.is_visible("#resultCard"), "anuncio gerado na hora")
    checa(pg.inner_text("#resultStatus") == "Anúncio pronto e salvo no histórico", "topo do resultado confirma que salvou")
    chega(pg, "getComputedStyle(document.querySelector('#msgResult')).opacity === '1'", "balao da mensagem termina visivel")
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
    grav = escritas(pg, "add", "products")
    checa(len(grav) == 1 and set(grav[0]["dados"].keys()) == CAMPOS_PRODUTO, "produto gravado com exatamente os campos das regras")
    mini = grav[0]["dados"]["foto64"] if grav else ""
    checa(len(grav) == 1 and grav[0]["dados"]["brecoOwner"] == "uid-teste" and grav[0]["dados"]["status"] == "available"
          and mini.startswith("data:image/jpeg;base64,") and len(mini) <= LIMITE_MINIATURA,
          "produto gravado com o uid da vendedora e a miniatura (%d caracteres)" % len(mini))
    fotos = escritas(pg, "set", "products")
    foto_grande = fotos[0]["dados"]["foto64"] if fotos else ""
    checa(len(fotos) == 1 and fotos[0]["caminho"] == "products/%s/fotos/principal" % grav[0]["id"]
          and set(fotos[0]["dados"].keys()) == {"foto64", "brecoOwner"} and fotos[0]["dados"]["brecoOwner"] == "uid-teste"
          and foto_grande.startswith("data:image/jpeg;base64,") and len(mini) < len(foto_grande) <= LIMITE_FOTO,
          "foto grande gravada no documento proprio, depois do produto (%d caracteres)" % len(foto_grande))
    tamanhos = pg.evaluate("""src => new Promise(ok => { const i = new Image(); i.onload = () => ok([i.naturalWidth, i.naturalHeight]); i.src = src; })""", mini)
    checa(max(tamanhos) == 128, "miniatura tem 128px no lado maior (%s)" % tamanhos)

    # copiar: aviso e confirmacao em cima do botao
    pg.click("[data-action='copiar']")
    espera(pg, "document.getElementById('toast').classList.contains('on')", timeout=5000)
    checa("Copiado" in pg.inner_text("#toast"), "copiar mostra o aviso flutuante")
    checa(pg.evaluate("document.querySelector('[data-action=copiar]').classList.contains('ok')"), "botao de copiar confirma em cima dele")
    espera(pg, "!document.getElementById('toast').classList.contains('on')", timeout=6000)
    chega(pg, "getComputedStyle(document.getElementById('toast')).opacity === '0'", "aviso flutuante some no fim")

    # compartilhar: com a folha do celular vai texto e foto; cancelado e sem folha tambem avisam
    pg.evaluate("window.__compartilhados.length = 0")
    pg.click("#btnShareWpp")
    espera(pg, "window.__compartilhados.length === 1")
    comp = pg.evaluate("window.__compartilhados[0]")
    arq = comp["arquivos"][0] if comp["arquivos"] else {}
    checa(comp["text"] == msg and arq.get("bytes") == bytes_da_data_url(foto_grande) and arq.get("tipo") == "image/jpeg",
          "compartilhar manda a mensagem e a foto grande (%s bytes)" % arq.get("bytes"))
    checa("Compartilhado com a foto" in pg.inner_text("#toast") and not pg.is_disabled("#btnShareWpp"), "compartilhar confirma com aviso e o botao volta")
    pg.evaluate("window.__shareErro = 'AbortError'")
    pg.click("#btnShareWpp")
    pg.wait_for_timeout(300)
    checa("cancelado" in pg.inner_text("#toast"), "compartilhamento cancelado pela vendedora: aviso, sem abrir nada")
    pg.evaluate("window.__shareErro = null; delete navigator.share; delete navigator.canShare")
    pg.click("#btnShareWpp")
    pg.wait_for_timeout(300)
    aberturas = pg.evaluate("window.__aberturas")
    checa(len(aberturas) == 1 and aberturas[0].startswith("https://wa.me/?text=") and "Abrindo o WhatsApp" in pg.inner_text("#toast"),
          "sem folha de compartilhar (computador): abre o WhatsApp com o texto e avisa")
    pg.evaluate("window.__aberturas.length = 0; window.__compartilhados.length = 0")

    # historico + busca por codigo
    pg.click("#tabHistorico")
    pg.wait_for_timeout(900)
    codigo_card = pg.inner_text("#histList .hist-code") if pg.locator("#histList .hist-code").count() else ""
    checa(bool(cod) and cod.group(1) in codigo_card, "codigo aparece no card do historico")
    checa(pg.inner_text("#histList .hist-name").count("\U0001F45F") == 1, "emoji nao duplica no nome")
    # a fixture e um retrato (4:5): a miniatura tem que ficar presa na moldura, sem vazar por baixo
    caixas = pg.evaluate("(() => { const m = document.querySelector('#histList .hist-thumb').getBoundingClientRect();"
                         " const f = document.querySelector('#histList .hist-thumb img').getBoundingClientRect();"
                         " return [m.top, m.bottom, m.left, m.right, f.top, f.bottom, f.left, f.right]; })()")
    checa(caixas[4] >= caixas[0] - 1 and caixas[5] <= caixas[1] + 1 and caixas[6] >= caixas[2] - 1 and caixas[7] <= caixas[3] + 1,
          "foto em retrato fica dentro da moldura da miniatura")
    chega(pg, "document.getElementById('cntDisp').textContent.trim() === '1'", "contador de disponiveis = 1")
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
    checa(sem_rolagem(pg), "app sem rolagem horizontal")

    # teclado: o anel de foco aparece, e as setas trocam de aba. No Safari o Tab
    # so passa por botao com "Tab destaca cada item" ligado, entao la nao se cobra.
    if estado["motor"] == "chromium":
        pg.keyboard.press("Shift+Tab")
        pg.wait_for_timeout(200)
        checa(pg.evaluate("document.activeElement.dataset.action") == "fechar-caixa"
              and pg.evaluate("document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).outlineStyle === 'solid'"),
              "tab leva o foco pro botao e o anel aparece")
        foto(pg, saida / "11-foco-teclado.png")
    pg.focus("#tabHistorico")
    pg.keyboard.press("ArrowLeft")
    pg.wait_for_timeout(300)
    checa(pg.is_visible("#pageAnuncio") and pg.evaluate("document.activeElement.id") == "tabAnuncio", "seta esquerda vai pra aba anunciar")
    checa(pg.get_attribute("#tabHistorico", "tabindex") == "-1" and pg.get_attribute("#tabAnuncio", "tabindex") == "0", "so a aba ativa entra no tab")
    pg.keyboard.press("ArrowRight")
    pg.wait_for_timeout(300)
    checa(pg.is_visible("#pageHistorico") and pg.evaluate("document.activeElement.id") == "tabHistorico", "seta direita volta pro historico")

    # status pelos botoes criados no historico (delegacao de evento)
    pg.click("#histList [data-action='status'][data-para='reserved']")
    pg.wait_for_timeout(400)
    chega(pg, "document.querySelector('#histList .hist-status').textContent === '\\u25CF Reservado' && document.getElementById('cntRes').textContent.trim() === '1'",
          "reservar muda o card e o contador")
    up = escritas(pg, "update", "products")
    checa(len(up) == 1 and up[0]["dados"] == {"status": "reserved", "soldAt": None}, "reserva grava status e soldAt nulo")
    ev = escritas(pg, "add", "events")
    checa(len(ev) == 1 and ev[0]["dados"]["by"] == "uid-teste" and ev[0]["dados"]["from"] == "available" and ev[0]["dados"]["to"] == "reserved",
          "evento gravado com o uid e a transicao")
    pg.click("#histList [data-action='status'][data-para='sold']")
    pg.wait_for_timeout(1000)
    chega(pg, "document.querySelector('#histList .hist-status').textContent === '\\u2713 Vendido' && document.getElementById('cntVend').textContent.trim() === '1'",
          "venda muda o card e o contador de hoje")
    vendas = escritas(pg, "add", "sales")
    checa(len(vendas) == 1 and vendas[0]["dados"]["sellerId"] == "uid-teste" and vendas[0]["dados"]["type"] == "online"
          and vendas[0]["dados"]["valor"] == 45, "venda online gravada com o uid")
    aberturas = pg.evaluate("window.__aberturas")
    checa(len(aberturas) == 1 and aberturas[0].startswith("https://wa.me/5511900000001?text=") and "VENDA%20REGISTRADA" in aberturas[0],
          "alerta de venda vai pro WhatsApp da vendedora")
    foto(pg, saida / "6b-historico-vendido.png", True)

    # venda na loja: a folha sobe sem passar do ponto, Escape fecha, foco volta, tela de tras inerte
    pg.evaluate("""() => { window.__vao = 0; const m = document.querySelector('#modalVendaFisica .modal'); const t0 = performance.now();
        const f = () => { const r = m.getBoundingClientRect(); if (document.getElementById('modalVendaFisica').classList.contains('on'))
          window.__vao = Math.max(window.__vao, innerHeight - r.bottom); if (performance.now() - t0 < 900) requestAnimationFrame(f); };
        requestAnimationFrame(f); }""")
    pg.click("[data-action='venda-loja']")
    onda = pg.evaluate("""() => { const o = document.querySelector('[data-action=venda-loja] .ripple');
        return o ? getComputedStyle(o).animationPlayState : 'sem onda'; }""")
    checa(onda == "running", "a onda do toque que abriu o modal termina, nao congela atras do veu (%s)" % onda)
    pg.wait_for_timeout(900)
    checa(pg.evaluate("window.__vao") <= 1, "folha da venda na loja nao abre vao embaixo ao subir (%.1f px)" % pg.evaluate("window.__vao"))
    checa(pg.evaluate("document.getElementById('modalVendaFisica').classList.contains('on')"), "modal abre")
    checa(pg.evaluate("document.getElementById('appMain').inert") is True, "tela de tras fica inerte com o modal aberto")
    checa(pg.evaluate("getComputedStyle(document.querySelector('#appMain .btn-primary'), '::after').animationPlayState") == "paused",
          "brilho dos botoes para atras do modal")
    checa(pg.evaluate("document.activeElement.id") == "vfDesc", "foco vai pra descricao")
    foto(pg, saida / "6c-modal-venda-loja.png")
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(500)
    checa(not pg.evaluate("document.getElementById('modalVendaFisica').classList.contains('on')"), "escape fecha o modal")
    chega(pg, "getComputedStyle(document.getElementById('modalVendaFisica')).visibility === 'hidden'", "modal fechado some de vez")
    checa(pg.evaluate("document.getElementById('appMain').inert") is False, "tela de tras volta ao normal")
    checa(pg.evaluate("document.activeElement.dataset.action") == "venda-loja", "foco volta pro botao que abriu")
    pg.click("[data-action='venda-loja']")
    pg.wait_for_timeout(400)
    pg.fill("#vfDesc", "Bolsa de couro bege")
    pg.fill("#vfPreco", "80")
    pg.press("#vfPreco", "Enter")
    pg.wait_for_timeout(600)
    checa(pg.locator("#histList .physical-item").count() == 1 and "Venda Física" in pg.inner_text("#histList .physical-item"),
          "venda na loja entra no historico")
    chega(pg, "document.getElementById('cntVend').textContent.trim() === '2'", "vendidos hoje soma a venda da loja")
    fis = [e for e in escritas(pg, "add", "products") if e["dados"]["type"] == "physical"]
    checa(len(fis) == 1 and set(fis[0]["dados"].keys()) == CAMPOS_PRODUTO - {"prodCod"} and fis[0]["dados"]["status"] == "sold",
          "venda na loja gravada como produto vendido, sem codigo")
    checa(len(escritas(pg, "add", "sales")) == 2 and escritas(pg, "add", "sales")[1]["dados"]["type"] == "physical", "venda na loja gravada em sales")

    # fechamento de caixa
    pg.click("[data-action='fechar-caixa']")
    pg.wait_for_timeout(600)
    aberturas = pg.evaluate("window.__aberturas")
    fecho = urllib.parse.unquote(aberturas[-1]) if len(aberturas) == 2 else ""
    checa("FECHAMENTO DO DIA" in fecho and "Total: R$ 125,00" in fecho and "2 peças" not in fecho.split("Total")[0].replace("1 peça", ""),
          "fechamento soma online e loja")
    cash = [e for e in escritas(pg, "update", "products") if e["dados"] == {"cashoutSent": True}]
    checa(len(cash) == 2, "fechamento marca as duas vendas como fechadas")
    pg.click("[data-action='fechar-caixa']")
    pg.wait_for_timeout(300)
    checa(len(pg.evaluate("window.__aberturas")) == 2, "segundo fechamento no mesmo dia nao abre nada")

    # remover venda da loja (confirm aceito pelo teste)
    pg.click("#histList [data-action='remover-venda']")
    pg.wait_for_timeout(400)
    checa(pg.locator("#histList .physical-item").count() == 0 and len(escritas(pg, "delete", "products")) == 1, "remover apaga a venda da loja")

    # tema pelo botao de verdade, com View Transition quando o navegador tem
    tem_vt = pg.evaluate("typeof document.startViewTransition === 'function'")
    pg.click("#btnTheme")
    pg.wait_for_timeout(1100)
    checa(pg.evaluate("document.documentElement.getAttribute('data-theme')") == "dark", "botao troca pro tema escuro (view transition: %s)" % tem_vt)
    chega(pg, "!document.documentElement.classList.contains('sem-transicao')", "troca de tema devolve as transicoes no fim")
    checa(pg.evaluate("localStorage.getItem('luxus-tema')") == "escuro", "tema fica salvo")
    checa(pg.get_attribute("#btnTheme", "aria-label") == "Mudar para o tema claro", "rotulo do botao acompanha o tema")
    checa(pg.is_visible("#iconeSol") and pg.is_hidden("#iconeLua"), "no escuro o botao mostra o sol")
    foto(pg, saida / "8-historico-noite.png", True)
    # sem View Transitions (iPhone com iOS 17 ou antes): o circulo vem de um elemento proprio
    pg.evaluate("delete Document.prototype.startViewTransition; delete document.startViewTransition")
    pg.click("#btnTheme")
    pg.wait_for_selector(".tema-onda", state="attached", timeout=3000)
    pg.evaluate("document.querySelector('.tema-onda').getAnimations().forEach(a => { a.pause(); a.currentTime = 160; })")
    circulo = pg.evaluate("""() => { const o = document.querySelector('.tema-onda'); const cs = getComputedStyle(o);
        return { clip: cs.clipPath, fundo: cs.backgroundColor, tema: document.documentElement.getAttribute('data-theme') }; }""")
    checa(circulo["clip"].startswith("circle(") and circulo["tema"] == "dark" and circulo["fundo"] == "rgb(243, 239, 231)",
          "sem view transition: circulo da cor do tema claro cresce antes da troca (%s)" % json.dumps(circulo))
    pg.evaluate("document.querySelector('.tema-onda').getAnimations().forEach(a => a.play())")
    espera(pg, "!document.querySelector('.tema-onda')", timeout=5000)
    chega(pg, "document.documentElement.getAttribute('data-theme') === null && !document.documentElement.classList.contains('sem-transicao')",
          "sem view transition: o tema troca e o circulo sai da pagina")
    pg.click("#btnTheme")
    espera(pg, "!document.querySelector('.tema-onda') && document.documentElement.getAttribute('data-theme') === 'dark'", timeout=5000)
    pg.click("#tabAnuncio")
    pg.wait_for_timeout(700)
    checa(pg.evaluate("getComputedStyle(document.getElementById('preview')).animationName") == "none", "foto nao revela de novo ao voltar a aba")
    foto(pg, saida / "9-resultado-noite.png", True)

    # anunciar outra peca limpa tudo
    pg.click("[data-action='novo']")
    pg.wait_for_timeout(500)
    checa(pg.is_hidden("#resultCard") and pg.is_hidden("#previewZone") and pg.input_value("#preco") == "", "anunciar outra peca limpa o formulario")

    # sair volta pro login e nao deixa nada da conta no aparelho
    pg.click("#tabHistorico")
    pg.fill("#histSearch", "abc")
    pg.click("#tabAnuncio")
    pg.click("#btnConfig")
    pg.click("[data-action='sair']")
    pg.wait_for_timeout(400)
    checa(pg.is_visible("#loginScreen") and pg.is_hidden("#appWrapper"), "sair volta pro login")
    checa(pg.get_attribute("#btnConfig", "aria-expanded") == "false" and pg.get_attribute("#tabAnuncio", "aria-selected") == "true",
          "sair fecha as configuracoes e volta pra aba anunciar")
    restos = pg.evaluate("""() => ({ email: document.getElementById('loggedEmail').textContent, lista: document.getElementById('histList').innerHTML,
        busca: document.getElementById('histSearch').value, tel: document.getElementById('telefone').value, meuTel: document.getElementById('meuTel').value,
        cfg: localStorage.getItem('brecho_cfg_v2'), sessao: localStorage.getItem('luxus-sessao'), loginEmail: document.getElementById('loginEmail').value,
        cont: document.getElementById('cntVend').textContent, badge: document.getElementById('pendBadge').textContent, tema: localStorage.getItem('luxus-tema') })""")
    checa(all(not restos[k] for k in ("email", "lista", "busca", "tel", "meuTel", "cfg", "sessao", "loginEmail")) and restos["cont"] == "0" and restos["badge"] == "0",
          "sair limpa email, historico, busca, configuracoes e contadores (%s)" % json.dumps({k: v for k, v in restos.items() if v}))
    checa(restos["tema"] == "escuro", "sair deixa o tema, que nao e da conta")
    ctx.close()
    return cod, pedido


def outras_larguras(b, url, saida):
    for largura in (360, 430):
        ctx = contexto(b, url, viewport={"width": largura, "height": 800}, device_scale_factor=2)
        pg = ctx.new_page()
        vigia(pg)
        pg.goto(url)
        pg.wait_for_timeout(1200)
        checa(sem_rolagem(pg), "%dpx: login sem rolagem horizontal" % largura)
        pg.wait_for_timeout(2200)
        sobra = sem_sobreposicao(pg)
        checa(sobra == 0, "%dpx: nenhuma polaroid cobre o titulo nem as frases do login (sobreposicao de %d px)" % (largura, sobra))
        foto(pg, saida / ("10-login-%d.png" % largura))
        entra(pg)
        pg.click("#btnConfig")
        pg.wait_for_timeout(300)
        checa(sem_rolagem(pg), "%dpx: configuracoes sem rolagem horizontal" % largura)
        foto(pg, saida / ("10-config-%d.png" % largura), True)
        pg.click("#btnConfig")
        pg.set_input_files("#fotoGaleria", FOTO)
        pg.wait_for_timeout(1500)
        checa(sem_rolagem(pg), "%dpx: anunciar sem rolagem horizontal" % largura)
        foto(pg, saida / ("10-anunciar-%d.png" % largura), True)
        pg.click("#tabHistorico")
        pg.wait_for_timeout(600)
        checa(sem_rolagem(pg), "%dpx: historico sem rolagem horizontal" % largura)
        foto(pg, saida / ("10-historico-%d.png" % largura))
        ctx.close()


def anuncio_seguido(b, url):
    """Dois anuncios seguidos sem 'Anunciar outra peca': o cartao entra de novo e o confete sai de novo."""
    ctx = contexto(b, url)
    pg = ctx.new_page()
    vigia(pg)
    pg.goto(url)
    pg.wait_for_timeout(500)
    entra(pg)
    pg.evaluate("""() => { document.getElementById('telefone').value = '5511900000000'; document.getElementById('preco').value = '30';
        window.__inicios = 0; window.__confetes = 0;
        document.getElementById('resultCard').addEventListener('animationstart', e => { if (e.target.id === 'resultCard') window.__inicios++; });
        new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList && n.classList.contains('confete')) window.__confetes++; })))
          .observe(document.body, {childList: true}); }""")
    pg.click("#btnGerar")
    espera(pg, "window.__confetes === 1 && window.__inicios === 1")
    pg.wait_for_timeout(1500)
    pg.click("#btnGerar")
    chega(pg, "window.__confetes === 2 && window.__inicios === 2", "segundo anuncio com o cartao na tela: entra de novo e solta confete de novo")
    ctx.close()


# Amostra o que a tela vai pintar: a cada quadro e tambem por relogio (40 ms),
# porque o WebKit do conteiner pinta poucos quadros por segundo e o primeiro
# pode chegar depois de tudo ja ter acontecido. So conta depois que as folhas
# de estilo carregaram: antes disso o navegador nao pinta nada (elas bloqueiam
# a pintura), mas o getComputedStyle do WebKit responde como se nao houvesse CSS.
AMOSTRA_QUADROS = """window.__quadros = []; (function () {
    const amostra = () => { const b = document.body, l = document.getElementById('loginScreen'), a = document.getElementById('appWrapper');
        const folhas = [...document.querySelectorAll('link[rel=stylesheet]')];
        if (b && l && a && folhas.length && folhas.every(f => f.sheet)) window.__quadros.push({ t: Math.round(performance.now()), tema: document.documentElement.getAttribute('data-theme'),
            fundo: getComputedStyle(b).backgroundColor, login: !l.hidden && getComputedStyle(l).display !== 'none',
            app: !a.hidden, appRodou: !!window.__config }); };
    const f = () => { amostra(); if (performance.now() < 20000) requestAnimationFrame(f); };
    requestAnimationFrame(f);
    const relogio = setInterval(() => { amostra(); if (performance.now() > 20000) clearInterval(relogio); }, 40); })();"""


def abre_com_sdk_preso(b, url, init):
    """Abre o app segurando os modulos do Firebase: o app.js (modulo) fica
    esperando por eles, como no celular com rede lenta. Devolve a pagina depois
    de pelo menos um quadro pintado e a funcao que solta o SDK."""
    ctx = contexto(b, url)
    presos = []
    ctx.route("**/firebasejs/**", lambda r: presos.append(r))
    ctx.add_init_script(init + AMOSTRA_QUADROS)
    pg = ctx.new_page()
    vigia(pg)
    pg.goto(url, wait_until="commit")
    espera(pg, "window.__quadros.length >= 1", timeout=20000)

    def solta_sdk():
        limite = time.time() + 10
        while len(presos) < 3 and time.time() < limite:
            pg.wait_for_timeout(50)
        for r in presos:
            r.fulfill(status=200, content_type="text/javascript", body=STUB, headers={"Access-Control-Allow-Origin": "*"})
        espera(pg, "!!window.__config", timeout=15000)

    return ctx, pg, solta_sdk


def abertura_sem_piscar(b, url):
    """O que o inicio.js resolve antes da primeira pintura, enquanto o SDK nao chega."""
    # tema escuro salvo: escuro desde o primeiro quadro, sem passar pelo claro
    ctx, pg, solta_sdk = abre_com_sdk_preso(b, url, "try { localStorage.setItem('luxus-tema', 'escuro') } catch (e) {}")
    antes = pg.evaluate("window.__quadros")
    solta_sdk()
    pg.wait_for_timeout(300)
    todos = pg.evaluate("window.__quadros")
    checa(antes and not antes[0]["appRodou"] and all(q["tema"] == "dark" and q["fundo"] == "rgb(23, 17, 15)" for q in todos),
          "tema escuro salvo: escuro desde o primeiro quadro, antes do app.js (%d quadros antes do SDK)" % len(antes))
    checa(pg.get_attribute('meta[name="theme-color"]', "content") == "#17110F", "tema escuro salvo: barra do navegador escura")
    ctx.close()

    # ja logada: o login nao aparece nem por um quadro, o app entra direto
    ctx, pg, solta_sdk = abre_com_sdk_preso(b, url, "try { localStorage.setItem('luxus-sessao', '1') } catch (e) {} window.__usuariaSalva = %s;" % USUARIA)
    antes = pg.evaluate("window.__quadros")
    solta_sdk()
    espera(pg, "!document.getElementById('appWrapper').hidden")
    pg.wait_for_timeout(300)
    # so vale ate os 3,5 s da garantia do inicio.js (no WebKit do conteiner o SDK pode demorar mais que isso)
    todos = [q for q in pg.evaluate("window.__quadros") if q["t"] < 3400 or q["app"]]
    checa(antes and not antes[0]["appRodou"] and not any(q["login"] for q in todos) and todos[-1]["app"],
          "ja logada: o login nao aparece nem antes nem depois do SDK, o app entra direto (%d amostras)" % len(todos))
    checa(not pg.evaluate("document.documentElement.classList.contains('retomando')"), "ja logada: a marca de espera sai quando o Firebase responde")
    pg.click("#btnConfig")
    pg.click("[data-action='sair']")
    pg.wait_for_timeout(400)
    checa(pg.evaluate("localStorage.getItem('luxus-sessao')") is None and pg.is_visible("#loginScreen"), "sair apaga a marca de sessao")
    ctx.close()

    # marca de sessao que nao vale mais (sessao vencida): login espera o Firebase e aparece
    ctx, pg, solta_sdk = abre_com_sdk_preso(b, url, "try { localStorage.setItem('luxus-sessao', '1') } catch (e) {}")
    antes = pg.evaluate("window.__quadros")
    solta_sdk()
    chega(pg, "getComputedStyle(document.getElementById('loginScreen')).display !== 'none' && localStorage.getItem('luxus-sessao') === null",
          "sessao vencida: o login aparece quando o Firebase responde e a marca sai")
    checa(antes and not any(q["login"] for q in antes if q["t"] < 3400), "sessao vencida: antes da resposta o login nao pisca")
    ctx.close()

    # o Firebase nunca responde: o login aparece sozinho, ninguem fica diante de tela vazia
    ctx = contexto(b, url)
    ctx.route("**/firebasejs/**", lambda r: r.abort())
    ctx.add_init_script("try { localStorage.setItem('luxus-sessao', '1') } catch (e) {}")
    pg = ctx.new_page()
    pg.goto(url, wait_until="commit")
    pg.wait_for_timeout(1500)
    escondido = pg.evaluate("getComputedStyle(document.getElementById('loginScreen')).display") == "none"
    chega(pg, "getComputedStyle(document.getElementById('loginScreen')).display !== 'none'",
          "sem resposta do Firebase: o login aparece sozinho depois de 3,5 s", timeout=8000)
    checa(escondido, "sem resposta do Firebase: antes dos 3,5 s o login espera")
    ctx.close()


def movimento_reduzido(b, url, saida):
    # Android com "remover animacoes" ou economia de bateria, e iPhone com
    # "reduzir movimento": tudo parado de proposito, e a tela explica o porque
    ctx = contexto(b, url, reduced_motion="reduce")
    pg = ctx.new_page()
    vigia(pg)
    pg.goto(url)
    pg.wait_for_timeout(800)
    checa(pg.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"), "movimento reduzido: o navegador informa a preferencia")
    checa(pg.evaluate("getComputedStyle(document.querySelector('.login-card')).opacity") == "1", "movimento reduzido: login visivel sem esperar")
    checa(pg.evaluate("getComputedStyle(document.querySelector('.login-head h1')).backgroundSize") == "100% 100%",
          "movimento reduzido: titulo ja escrito")
    entra(pg)
    pg.click("#btnConfig")
    pg.wait_for_timeout(300)
    checa(pg.is_visible(".aviso-movimento"), "movimento reduzido: as configuracoes explicam por que nada se mexe")
    foto(pg, saida / "12-config-movimento-reduzido.png", True)
    pg.click("#btnTheme")
    pg.wait_for_timeout(200)
    checa(pg.evaluate("document.documentElement.getAttribute('data-theme')") == "dark" and pg.locator(".tema-onda").count() == 0,
          "movimento reduzido: tema troca direto, sem circulo")
    ctx.close()


def integridade(b, url):
    """SRI de verdade: a pagina original (hashes do SDK publicado) recebendo o
    stub no lugar do SDK e um modulo adulterado. O navegador tem que bloquear e
    o app nao pode rodar."""
    ctx = contexto(b, url)
    ctx.route(url, lambda r: r.fulfill(status=200, content_type="text/html; charset=utf-8", body=INDEX_ORIGINAL))
    pg = ctx.new_page()
    mensagens = []
    pg.on("console", lambda m: mensagens.append(m.text))
    pg.on("pageerror", lambda e: mensagens.append(str(e)))
    pg.goto(url)
    pg.wait_for_timeout(3000)
    rodou = pg.evaluate("!!window.__config")
    bloqueou = [m for m in mensagens if "integrity" in m.lower()]
    checa(not rodou and bloqueou, "modulo do SDK com hash diferente do index.html: o navegador bloqueia e o app nao roda (%s)"
          % (bloqueou[0][:110] if bloqueou else "nenhuma mensagem de integridade"))
    checa(pg.is_visible("#loginScreen"), "com o SDK bloqueado a tela de login continua visivel, nao fica tela vazia")
    ctx.close()


def app_check(b, url):
    """Com a chave do reCAPTCHA preenchida em APP_CHECK, o modulo entra por tag
    de script com integrity e o App Check e montado antes do Auth. Com o hash
    errado, o modulo e bloqueado e o app segue sem App Check."""
    assert "siteKey: ''" in APP_JS and "integridade: 'sha384-" in APP_JS, "APP_CHECK em app.js mudou de forma"
    com_chave = re.sub(r"integridade: 'sha384-[^']+'", "integridade: '%s'" % HASH_STUB, APP_JS.replace("siteKey: ''", "siteKey: 'chave-recaptcha-de-teste'"))
    pedidos = []
    ctx = contexto(b, url, pedidos)
    ctx.route(url + "app.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body=com_chave))
    pg = ctx.new_page()
    vigia(pg)
    pg.goto(url)
    espera(pg, "!!window.__appCheck", timeout=10000)
    ac = pg.evaluate("window.__appCheck")
    checa(ac["chave"] == "chave-recaptcha-de-teste" and ac["renova"] is True, "com a chave, o App Check e montado com o reCAPTCHA v3 e renovacao automatica")
    link = pg.evaluate("""() => { const l = document.querySelector('script[type=module][src*="app-check"]'); return l && [l.integrity, l.crossOrigin]; }""")
    checa(link and link[0].startswith("sha384-") and link[1] == "anonymous", "o modulo do App Check entra por script type=module com integrity e crossorigin anonymous")
    checa(sum(1 for u in pedidos if "firebase-app-check.js" in u) >= 1, "o modulo do App Check e baixado da pasta do Firebase no CDN")
    entra(pg)
    checa(pg.is_visible("#appWrapper"), "o login continua funcionando com o App Check ligado")
    ctx.close()

    # modulo do App Check adulterado (hash errado): bloqueado, e o app segue sem ele
    hash_errado = re.sub(r"integridade: 'sha384-[^']+'", "integridade: 'sha384-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'",
                         APP_JS.replace("siteKey: ''", "siteKey: 'chave-recaptcha-de-teste'"))
    ctx = contexto(b, url)
    ctx.route(url + "app.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body=hash_errado))
    pg = ctx.new_page()
    mensagens = []
    pg.on("console", lambda m: mensagens.append(m.text))
    pg.on("pageerror", lambda e: mensagens.append(str(e)))
    pg.goto(url)
    espera(pg, "!!window.__authCb", timeout=10000)
    checa(pg.evaluate("window.__appCheck") is None and any("integrity" in m.lower() for m in mensagens),
          "modulo do App Check com hash errado: bloqueado pelo navegador, e o app abre o login mesmo assim")
    ctx.close()


def salvando_nao_prende(b, url):
    """Sem internet o Firestore deixa a gravacao pendurada. Depois de 10 s a tela
    tem que dizer que esta aguardando, e confirmar quando a gravacao chegar."""
    ctx = contexto(b, url)
    pg = ctx.new_page()
    vigia(pg)
    pg.goto(url)
    pg.wait_for_timeout(500)
    entra(pg)
    pg.evaluate("document.getElementById('telefone').value = '5511900000000'; document.getElementById('preco').value = '30'; window.__seguraAdd = true")
    pg.click("#btnGerar")
    pg.wait_for_timeout(600)
    checa("salvando no histórico" in pg.inner_text("#resultStatus"), "gravacao presa: comeca em 'salvando'")
    pg.click("#tabHistorico")
    pg.wait_for_timeout(400)
    checa("Salvando no histórico" in pg.inner_text("#histList"), "gravacao presa: o cartao diz 'salvando'")
    espera(pg, "document.getElementById('resultStatus').textContent.includes('internet voltar')", timeout=14000)
    checa("Aguardando internet" in pg.inner_text("#histList") and "ainda não foi salvo" in pg.inner_text("#toast"),
          "depois de 10 s: cartao e aviso dizem que esta aguardando internet, nada fica preso em 'salvando'")
    checa(pg.evaluate("document.getElementById('resultCard').classList.contains('falhou')"), "o topo do resultado muda de cor enquanto aguarda")
    pg.evaluate("window.__soltaAdd()")
    chega(pg, "document.getElementById('resultStatus').textContent === 'Anúncio pronto e salvo no histórico' && !document.querySelector('#histList .hist-saving')",
          "quando a gravacao chega, vira 'salvo' e o cartao ganha os botoes")
    checa("sincronizou" in pg.inner_text("#toast"), "e avisa que sincronizou")
    ctx.close()


def login_em_outros_iphones(b, p, url, saida):
    """A tela de login nos outros perfis do motor (iPhone SE no WebKit): nada cobre o titulo."""
    for nome in APARELHOS_LOGIN[estado["motor"]][1:]:
        perfil = {k: v for k, v in p.devices[nome].items() if k != "default_browser_type"}
        ctx = contexto(b, url, **perfil)
        pg = ctx.new_page()
        vigia(pg)
        pg.goto(url)
        pg.wait_for_timeout(3400)
        sobra = sem_sobreposicao(pg)
        checa(sobra == 0, "%s: nenhuma polaroid cobre o titulo nem as frases do login (sobreposicao de %d px)" % (nome, sobra))
        checa(sem_rolagem(pg), "%s: login sem rolagem horizontal" % nome)
        foto(pg, saida / ("13-login-%s.png" % nome.lower().replace(" ", "-")))
        ctx.close()


PERFIS = {}


def roda(url, saida_base, motores):
    extra = {}
    with sync_playwright() as p:
        for motor in motores:
            estado["motor"] = motor
            PERFIS[motor] = {k: v for k, v in p.devices[APARELHO[motor]].items() if k != "default_browser_type"}
            saida = saida_base / motor
            saida.mkdir(parents=True, exist_ok=True)
            b = getattr(p, motor).launch()
            cod, pedido = fluxo_principal(b, url, saida)
            outras_larguras(b, url, saida)
            login_em_outros_iphones(b, p, url, saida)
            anuncio_seguido(b, url)
            abertura_sem_piscar(b, url)
            movimento_reduzido(b, url, saida)
            integridade(b, url)
            app_check(b, url)
            salvando_nao_prende(b, url)
            b.close()
            extra[motor] = {"codigo": cod.group(1) if cod else None, "pedido": pedido}
    return extra


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--saida", default=str(AQUI / "saida"), help="pasta das capturas de tela")
    ap.add_argument("--url", default=None, help="usar um servidor ja no ar em vez de subir um")
    ap.add_argument("--motor", default="chromium,webkit", help="motores, separados por virgula (chromium, webkit)")
    args = ap.parse_args()
    saida = Path(args.saida)
    motores = [m.strip() for m in args.motor.split(",") if m.strip()]
    if not motores or any(m not in APARELHO for m in motores):
        ap.error("motor desconhecido: use chromium, webkit ou os dois")

    srv = None
    url = args.url
    if not url:
        srv, url = servir()
    try:
        extra = roda(url, saida, motores)
    finally:
        if srv:
            srv.shutdown()

    resumo = {"ok": ok, "falhas": falhas, "erros_js": erros[:12], "por_motor": extra}
    print(json.dumps(resumo, ensure_ascii=False, indent=1))
    if falhas or erros:
        print("FALHOU: %d falha(s), %d erro(s) no console" % (len(falhas), len(erros)), file=sys.stderr)
        sys.exit(1)
    print("OK: %d verificacoes em %s" % (len(ok), ", ".join(motores)), file=sys.stderr)


if __name__ == "__main__":
    main()
