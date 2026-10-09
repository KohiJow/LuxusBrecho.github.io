"""Teste de ponta a ponta do app, com Firebase de mentira (stub.js).

Sobe um servidor estatico na raiz do repositorio, abre o app num Chromium de
celular e percorre o fluxo inteiro: login, configuracao, anuncio com foto,
historico, status, venda na loja, fechamento de caixa, busca e temas. Qualquer
erro de JavaScript ou violacao da CSP no console derruba o teste. Nada sai pra
internet alem das fontes do Google: Firebase e WhatsApp sao substituidos pelo
stub, que anota o que o app tentou gravar e abrir.

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

from PIL import Image
from playwright.sync_api import sync_playwright

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent
FOTO = str(AQUI / "peca-teste.jpg")
STUB = (AQUI / "stub.js").read_text(encoding="utf-8")
USUARIA = "{uid:'uid-teste', email:'teste@example.com'}"
CAMPOS_PRODUTO = {"ts", "emoji", "cats", "estado", "estLabel", "tam", "obs", "precoNum", "precoStr", "link", "msg",
                  "foto64", "prodCod", "brecoNome", "brecoOwner", "sellerEmail", "status", "soldAt", "cashoutSent", "type"}

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


def prepara(ctx, url):
    ctx.add_init_script(STUB)

    def rota(r):
        u = r.request.url
        if "firebasejs" in u:
            return r.fulfill(status=200, content_type="application/javascript", body="")
        if u.startswith(url) or u.startswith("https://fonts.googleapis.com/") or u.startswith("https://fonts.gstatic.com/"):
            return r.continue_()
        return r.abort()

    ctx.route("**/*", rota)


def vigia(pg):
    pg.on("pageerror", lambda e: erros.append("pageerror: " + str(e)))
    pg.on("dialog", lambda d: d.accept())

    def console(m):
        t = m.text
        if "Content Security Policy" in t or "Refused to" in t:
            erros.append("csp: " + t)
        elif m.type == "error" and "ERR_FAILED" not in t:
            erros.append("console: " + t)

    pg.on("console", console)


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


def sem_rolagem(pg):
    return pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


def entra(pg, atraso=0):
    pg.evaluate("window.__atrasoDb = %d; window.__authCb(%s)" % (atraso, USUARIA))
    pg.wait_for_timeout(300)


def fluxo_principal(b, url, saida):
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    prepara(ctx, url)
    pg = ctx.new_page()
    vigia(pg)
    pg.goto(url)
    pg.wait_for_timeout(3200)
    foto(pg, saida / "1-login-claro.png")
    checa(pg.is_visible("#loginScreen"), "login aparece")
    checa(pg.evaluate("getComputedStyle(document.querySelector('.login-card')).opacity") == "1", "cartao do login visivel depois da animacao")
    checa(pg.evaluate("document.documentElement.getAttribute('data-theme')") is None, "creme e o tema padrao")
    checa(sem_rolagem(pg), "login sem rolagem horizontal")
    checa(folhas_desenhadas(saida / "1-login-claro.png"), "folhas do fundo se desenham a partir do symbol")

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

    # entra como usuaria de teste (falsa), com o banco demorando pra mostrar o esqueleto
    entra(pg, 2500)
    checa(pg.is_hidden("#loginScreen") and pg.is_visible("#appWrapper"), "entrou no app")
    checa(pg.inner_text("#loggedEmail") == "teste@example.com", "email da conta aparece no cabecalho")
    pg.click("#tabHistorico")
    pg.wait_for_timeout(500)
    checa(pg.locator("#histList .skel").count() == 3, "esqueleto enquanto o banco carrega")
    foto(pg, saida / "3-historico-carregando.png")
    pg.wait_for_timeout(2600)
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
    pg.evaluate("window.__docs = []; window.__authCb(null); window.__authCb(%s)" % USUARIA)
    pg.wait_for_timeout(500)
    pg.click("#tabAnuncio")
    pg.wait_for_timeout(600)

    # configura a loja
    pg.click("#btnConfig")
    pg.wait_for_timeout(300)
    checa(pg.get_attribute("#btnConfig", "aria-expanded") == "true" and pg.is_visible("#cfgCard"), "configuracoes abrem")
    pg.fill("#telefone", "5511900000000")
    pg.fill("#brecoNome", "Luxus Brechó")
    pg.fill("#meuTel", "11900000001")
    pg.click("#cfgCard .btn-primary")
    pg.wait_for_timeout(1100)
    checa(pg.is_hidden("#cfgCard"), "salvar fecha as configuracoes")
    checa(pg.evaluate("JSON.parse(localStorage.getItem('brecho_cfg_v2')).telefone") == "5511900000000", "configuracao fica no localStorage")

    # tentar gerar sem preco: erro visivel e foco no campo
    pg.click("#btnGerar")
    pg.wait_for_timeout(300)
    checa(pg.is_visible("#errBar") and "preço" in pg.inner_text("#errBar"), "sem preco: aviso de erro")
    checa(pg.evaluate("document.activeElement.id") == "preco", "sem preco: foco vai pro preco")
    foto(pg, saida / "3d-anunciar-erro.png")

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
    checa(pg.inner_text("#resultStatus") == "Anúncio pronto e salvo no histórico", "topo do resultado confirma que salvou")
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
    checa(len(grav) == 1 and grav[0]["dados"]["brecoOwner"] == "uid-teste" and grav[0]["dados"]["status"] == "available"
          and grav[0]["dados"]["foto64"].startswith("data:image/jpeg;base64,"), "produto gravado com o uid da vendedora e a foto")

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
    checa(sem_rolagem(pg), "app sem rolagem horizontal")

    # teclado: o anel de foco aparece, e as setas trocam de aba
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
    checa(pg.inner_text("#histList .hist-status") == "\u25CF Reservado" and pg.inner_text("#cntRes").strip() == "1", "reservar muda o card e o contador")
    up = escritas(pg, "update", "products")
    checa(len(up) == 1 and up[0]["dados"] == {"status": "reserved", "soldAt": None}, "reserva grava status e soldAt nulo")
    ev = escritas(pg, "add", "events")
    checa(len(ev) == 1 and ev[0]["dados"]["by"] == "uid-teste" and ev[0]["dados"]["from"] == "available" and ev[0]["dados"]["to"] == "reserved",
          "evento gravado com o uid e a transicao")
    pg.click("#histList [data-action='status'][data-para='sold']")
    pg.wait_for_timeout(1000)
    checa(pg.inner_text("#histList .hist-status") == "\u2713 Vendido" and pg.inner_text("#cntVend").strip() == "1", "venda muda o card e o contador de hoje")
    vendas = escritas(pg, "add", "sales")
    checa(len(vendas) == 1 and vendas[0]["dados"]["sellerId"] == "uid-teste" and vendas[0]["dados"]["type"] == "online"
          and vendas[0]["dados"]["valor"] == 45, "venda online gravada com o uid")
    aberturas = pg.evaluate("window.__aberturas")
    checa(len(aberturas) == 1 and aberturas[0].startswith("https://wa.me/5511900000001?text=") and "VENDA%20REGISTRADA" in aberturas[0],
          "alerta de venda vai pro WhatsApp da vendedora")
    foto(pg, saida / "6b-historico-vendido.png", True)

    # venda na loja: modal com Escape, foco de volta e tela de tras inerte
    pg.click("[data-action='venda-loja']")
    pg.wait_for_timeout(500)
    checa(pg.evaluate("document.getElementById('modalVendaFisica').classList.contains('on')"), "modal abre")
    checa(pg.evaluate("document.getElementById('appMain').inert") is True, "tela de tras fica inerte com o modal aberto")
    checa(pg.evaluate("document.activeElement.id") == "vfDesc", "foco vai pra descricao")
    foto(pg, saida / "6c-modal-venda-loja.png")
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(400)
    checa(not pg.evaluate("document.getElementById('modalVendaFisica').classList.contains('on')"), "escape fecha o modal")
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
    checa(pg.inner_text("#cntVend").strip() == "2", "vendidos hoje soma a venda da loja")
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

    # tema pelo botao de verdade
    pg.click("#btnTheme")
    pg.wait_for_timeout(900)
    checa(pg.evaluate("document.documentElement.getAttribute('data-theme')") == "dark", "botao troca pro tema escuro")
    checa(pg.evaluate("localStorage.getItem('luxus-tema')") == "escuro", "tema fica salvo")
    checa(pg.get_attribute("#btnTheme", "aria-label") == "Mudar para o tema claro", "rotulo do botao acompanha o tema")
    checa(pg.is_visible("#iconeSol") and pg.is_hidden("#iconeLua"), "no escuro o botao mostra o sol")
    foto(pg, saida / "8-historico-noite.png", True)
    pg.click("#tabAnuncio")
    pg.wait_for_timeout(700)
    checa(pg.evaluate("getComputedStyle(document.getElementById('preview')).animationName") == "none", "foto nao revela de novo ao voltar a aba")
    foto(pg, saida / "9-resultado-noite.png", True)

    # anunciar outra peca limpa tudo
    pg.click("[data-action='novo']")
    pg.wait_for_timeout(500)
    checa(pg.is_hidden("#resultCard") and pg.is_hidden("#previewZone") and pg.input_value("#preco") == "", "anunciar outra peca limpa o formulario")

    # sair volta pro login
    pg.click("#btnConfig")
    pg.click("[data-action='sair']")
    pg.wait_for_timeout(400)
    checa(pg.is_visible("#loginScreen") and pg.is_hidden("#appWrapper"), "sair volta pro login")
    checa(pg.get_attribute("#btnConfig", "aria-expanded") == "false" and pg.get_attribute("#tabAnuncio", "aria-selected") == "true",
          "sair fecha as configuracoes e volta pra aba anunciar")
    ctx.close()
    return cod, pedido


def outras_larguras(b, url, saida):
    for largura in (360, 430):
        ctx = b.new_context(viewport={"width": largura, "height": 800}, device_scale_factor=2, is_mobile=True, has_touch=True)
        prepara(ctx, url)
        pg = ctx.new_page()
        vigia(pg)
        pg.goto(url)
        pg.wait_for_timeout(1200)
        checa(sem_rolagem(pg), "%dpx: login sem rolagem horizontal" % largura)
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


def movimento_reduzido(b, url):
    ctx = b.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce")
    prepara(ctx, url)
    pg = ctx.new_page()
    vigia(pg)
    pg.goto(url)
    pg.wait_for_timeout(800)
    checa(pg.evaluate("getComputedStyle(document.querySelector('.login-card')).opacity") == "1", "movimento reduzido: login visivel sem esperar")
    ctx.close()


def roda(url, saida):
    with sync_playwright() as p:
        b = p.chromium.launch()
        cod, pedido = fluxo_principal(b, url, saida)
        outras_larguras(b, url, saida)
        movimento_reduzido(b, url)
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
