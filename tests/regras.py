"""Teste das regras do Firestore (firestore.rules) no emulador, sem conta nem projeto real.

Fala com a API REST do emulador usando tokens sem assinatura, que o emulador
aceita como se fossem usuarias logadas (e o mesmo truque da biblioteca oficial
de teste de regras, so que sem instalar o SDK inteiro). Cada caso grava, le,
altera ou apaga um documento e confere se o emulador aceitou (200) ou recusou
(403), do jeito que o app faz e dos jeitos que um invasor tentaria.

Uso (o emulador precisa do Java):
  firebase emulators:exec --only firestore --project demo-luxus "python3 tests/regras.py"
"""
import base64
import copy
import json
import os
import sys
import time
import urllib.error
import urllib.request

PROJETO = os.environ.get("GCLOUD_PROJECT", "demo-luxus")
HOST = os.environ.get("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8577")
BASE = "http://%s/v1/projects/%s/databases/(default)/documents" % (HOST, PROJETO)
AGORA = int(time.time() * 1000)

ok, falhas = [], []


def checa(cond, nome, detalhe=""):
    (ok if cond else falhas).append(nome + ("" if cond else "  <- " + detalhe))


def b64url(d):
    return base64.urlsafe_b64encode(json.dumps(d, separators=(",", ":")).encode()).rstrip(b"=").decode()


def token(uid, email):
    """JWT sem assinatura, no formato que o emulador reconhece como usuaria logada."""
    agora = int(time.time())
    cabecalho = {"alg": "none", "typ": "JWT"}
    corpo = {
        "iss": "https://securetoken.google.com/" + PROJETO, "aud": PROJETO, "iat": agora, "exp": agora + 3600,
        "sub": uid, "user_id": uid, "auth_time": agora, "email": email, "email_verified": False,
        "firebase": {"sign_in_provider": "password", "identities": {"email": [email]}},
    }
    return b64url(cabecalho) + "." + b64url(corpo) + "."


ANA = token("uid-ana", "ana@exemplo.com")
BIA = token("uid-bia", "bia@exemplo.com")


def valor(v):
    """Python -> valor no formato REST do Firestore."""
    if v is None:
        return {"nullValue": None}
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, str):
        return {"stringValue": v}
    if isinstance(v, list):
        return {"arrayValue": {"values": [valor(x) for x in v]}}
    raise TypeError(type(v))


def campos(d):
    return {"fields": {k: valor(v) for k, v in d.items()}}


def req(metodo, caminho, corpo=None, quem=None):
    dados = json.dumps(corpo).encode() if corpo is not None else None
    r = urllib.request.Request(BASE + caminho, data=dados, method=metodo)
    r.add_header("Content-Type", "application/json")
    if quem:
        r.add_header("Authorization", "Bearer " + quem)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:200]


def cria(colecao, dados, quem):
    return req("POST", "/" + colecao, campos(dados), quem)


def atualiza(colecao, doc_id, dados, quem):
    mascara = "&".join("updateMask.fieldPaths=" + k for k in dados)
    return req("PATCH", "/%s/%s?%s" % (colecao, doc_id, mascara), campos(dados), quem)


def apaga(colecao, doc_id, quem):
    return req("DELETE", "/%s/%s" % (colecao, doc_id), None, quem)


def le(colecao, doc_id, quem):
    return req("GET", "/%s/%s" % (colecao, doc_id), None, quem)


def consulta(colecao, filtro_campo, filtro_valor, quem):
    q = {"structuredQuery": {"from": [{"collectionId": colecao}]}}
    if filtro_campo:
        q["structuredQuery"]["where"] = {"fieldFilter": {"field": {"fieldPath": filtro_campo}, "op": "EQUAL", "value": valor(filtro_valor)}}
    return req("POST", ":runQuery", q, quem)


def id_de(resposta):
    return resposta[1]["name"].rsplit("/", 1)[1]


def aceita(resposta, nome):
    checa(resposta[0] == 200, nome, "status %s %s" % resposta)


def recusa(resposta, nome):
    checa(resposta[0] == 403, nome, "status %s %s" % resposta)


# exatamente o que o app grava (app.js, gerarAnuncio e registrarVendaFisica)
ONLINE = {
    "ts": AGORA, "emoji": "\U0001F45F", "cats": ["\U0001F45F Calçado"], "estado": ["\u2728 Ótimo"], "estLabel": "Ótimo", "tam": "37",
    "obs": "Melissa azul com cadarço amarelo", "precoNum": 45, "precoStr": "45,00",
    "link": "https://wa.me/5511900000000?text=Oi!%20Tenho%20interesse%20na%20pe%C3%A7a%20ABC234",
    "msg": "\U0001F45F *Luxus Brechó*\n\n\u2728 Chegou peça nova!\n\n\U0001F4B0 *R$ 45,00*\n\U0001F516 Código *ABC234*",
    "foto64": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
    "prodCod": "ABC234", "brecoNome": "Luxus Brechó", "brecoOwner": "uid-ana", "sellerEmail": "ana@exemplo.com",
    "status": "available", "soldAt": None, "cashoutSent": False, "type": "online",
}
FISICO = {
    "ts": AGORA, "emoji": "\U0001F3EA", "cats": ["Bolsa de couro bege"], "estado": [], "estLabel": "Venda física", "tam": "",
    "obs": "", "precoNum": 80.5, "precoStr": "80,50", "link": "", "msg": "", "foto64": None,
    "brecoNome": "Luxus Brechó", "brecoOwner": "uid-ana", "sellerEmail": "ana@exemplo.com",
    "status": "sold", "soldAt": AGORA, "cashoutSent": False, "type": "physical",
}
EVENTO = {"productId": "abc", "type": "status_changed", "from": "available", "to": "reserved",
          "by": "uid-ana", "byEmail": "ana@exemplo.com", "at": AGORA}
VENDA = {"productId": "abc", "sellerId": "uid-ana", "sellerEmail": "ana@exemplo.com", "valor": 45,
         "brecoNome": "Luxus Brechó", "soldAt": AGORA, "cashoutSent": False, "type": "online"}


def variante(base, **muda):
    d = copy.deepcopy(base)
    for k, v in muda.items():
        if v is KeyError:
            d.pop(k, None)
        else:
            d[k] = v
    return d


def main():
    # --- produtos: criar ---
    recusa(cria("products", ONLINE, None), "sem login nao cria produto")
    r_online = cria("products", ONLINE, ANA)
    aceita(r_online, "anuncio online do jeito que o app grava")
    r_fisico = cria("products", FISICO, ANA)
    aceita(r_fisico, "venda na loja do jeito que o app grava (sem prodCod, preco com centavos)")
    aceita(cria("products", variante(ONLINE, foto64=None, obs="", tam="", cats=[], estado=[], estLabel="", precoNum=0, precoStr="0,00"), ANA),
           "anuncio sem foto, sem categoria e preco zero")
    aceita(cria("products", variante(ONLINE, cats=["\U0001F457 Vestido", "\U0001F455 Camisa", "\U0001F456 Calça", "\U0001F45F Calçado", "\U0001F45C Bolsa", "\U0001F9E5 Casaco", "\U0001F48D Acessório", "\U0001FA71 Blusa", "\U0001FA74 Short"],
                                     estado=["\U0001F3F7\uFE0F Novo c/ etiqueta"], obs="x" * 200, brecoNome="N" * 60, tam="T" * 20), ANA),
           "anuncio nos limites de tamanho do app")
    aceita(cria("products", variante(ONLINE, foto64="data:image/jpeg;base64," + "A" * 699000), ANA), "foto de quase 700 KB passa")

    casos_recusados = {
        "dono diferente do uid": variante(ONLINE, brecoOwner="uid-bia"),
        "email diferente do token": variante(ONLINE, sellerEmail="outra@exemplo.com"),
        "campo a mais": variante(ONLINE, admin=True),
        "campo faltando": variante(ONLINE, status=KeyError),
        "status fora da lista": variante(ONLINE, status="deleted"),
        "tipo fora da lista": variante(ONLINE, type="admin"),
        "preco acima do limite": variante(ONLINE, precoNum=100000, precoStr="100000,00"),
        "preco negativo": variante(ONLINE, precoNum=-1),
        "preco como texto": variante(ONLINE, precoNum="45"),
        "precoStr fora do formato": variante(ONLINE, precoStr="<i>45</i>"),
        "foto que nao e imagem": variante(ONLINE, foto64="javascript:alert(1)"),
        "foto maior que 700 KB": variante(ONLINE, foto64="data:image/jpeg;base64," + "A" * 700001),
        "codigo fora do formato": variante(ONLINE, prodCod="<u>AB</u>"),
        "detalhe acima de 200": variante(ONLINE, obs="x" * 201),
        "nome da loja acima de 60": variante(ONLINE, brecoNome="N" * 61),
        "categoria que nao e texto": variante(ONLINE, cats=[1]),
        "categoria longa demais": variante(ONLINE, cats=["c" * 121]),
        "estado que nao e texto": variante(ONLINE, estado=[True]),
        "lista de categorias grande demais": variante(ONLINE, cats=["\U0001F457 Vestido"] * 11),
        "link que nao e do WhatsApp": variante(ONLINE, link="https://exemplo.com/phishing"),
        "mensagem gigante": variante(ONLINE, msg="m" * 1501),
        "disponivel com hora de venda": variante(ONLINE, soldAt=AGORA),
        "vendido sem hora de venda": variante(ONLINE, status="sold", soldAt=None),
        "ja fechado no caixa ao nascer": variante(ONLINE, cashoutSent=True),
        "ts no futuro distante": variante(ONLINE, ts=AGORA + 10 * 86400000),
        "ts como texto": variante(ONLINE, ts=str(AGORA)),
    }
    for nome, dados in casos_recusados.items():
        recusa(cria("products", dados, ANA), "nao cria produto: " + nome)

    # --- produtos: ler ---
    id_online, id_fisico = id_de(r_online), id_de(r_fisico)
    aceita(le("products", id_online, ANA), "dona le o proprio produto")
    recusa(le("products", id_online, BIA), "outra vendedora nao le o produto")
    recusa(le("products", id_online, None), "sem login nao le")
    criados = len([n for n in ok if n.startswith("anuncio") or n.startswith("venda na loja do jeito") or n.startswith("foto de quase")])
    r = consulta("products", "brecoOwner", "uid-ana", ANA)
    aceita(r, "consulta filtrada pela dona (a do app) passa")
    devolvidos = sum(1 for x in r[1] if "document" in x) if r[0] == 200 else -1
    checa(devolvidos == criados, "e devolve todos os produtos dela (%d)" % criados, "veio %d" % devolvidos)
    recusa(consulta("products", None, None, ANA), "consulta sem filtro de dona e recusada")
    recusa(consulta("products", "brecoOwner", "uid-bia", ANA), "consulta pelos produtos de outra e recusada")

    # --- produtos: alterar ---
    aceita(atualiza("products", id_online, {"status": "reserved", "soldAt": None}, ANA), "reservar (status + soldAt nulo)")
    aceita(atualiza("products", id_online, {"status": "sold", "soldAt": AGORA}, ANA), "confirmar venda (status + soldAt)")
    aceita(atualiza("products", id_online, {"cashoutSent": True}, ANA), "fechar caixa (cashoutSent)")
    aceita(atualiza("products", id_online, {"status": "available", "soldAt": None}, ANA), "cancelar venda volta pra disponivel")
    recusa(atualiza("products", id_online, {"status": "sold", "soldAt": None}, ANA), "nao altera: vendido sem hora")
    recusa(atualiza("products", id_online, {"status": "lost"}, ANA), "nao altera: status fora da lista")
    recusa(atualiza("products", id_online, {"precoNum": 1}, ANA), "nao altera: preco e imutavel")
    recusa(atualiza("products", id_online, {"brecoOwner": "uid-bia"}, ANA), "nao altera: dono e imutavel")
    recusa(atualiza("products", id_online, {"foto64": None}, ANA), "nao altera: foto e imutavel")
    recusa(atualiza("products", id_online, {"status": "reserved", "soldAt": None}, BIA), "outra vendedora nao altera")
    recusa(atualiza("products", id_online, {"cashoutSent": True}, None), "sem login nao altera")

    # --- produtos: apagar ---
    recusa(apaga("products", id_fisico, BIA), "outra vendedora nao apaga venda na loja")
    recusa(apaga("products", id_online, ANA), "anuncio online nao se apaga (so muda de status)")
    aceita(apaga("products", id_fisico, ANA), "dona apaga a propria venda na loja")

    # --- eventos ---
    r_ev = cria("events", EVENTO, ANA)
    aceita(r_ev, "evento de status do jeito que o app grava")
    recusa(cria("events", variante(EVENTO, by="uid-bia"), ANA), "nao cria evento: by diferente do uid")
    recusa(cria("events", variante(EVENTO, byEmail="x@exemplo.com"), ANA), "nao cria evento: email diferente do token")
    recusa(cria("events", variante(EVENTO, **{"from": "reserved"}), ANA), "nao cria evento: de e para iguais")
    recusa(cria("events", variante(EVENTO, type="login"), ANA), "nao cria evento: tipo fora da lista")
    recusa(cria("events", variante(EVENTO, extra=1), ANA), "nao cria evento: campo a mais")
    recusa(cria("events", variante(EVENTO, productId=""), ANA), "nao cria evento: productId vazio")
    recusa(cria("events", EVENTO, None), "sem login nao cria evento")
    aceita(le("events", id_de(r_ev), ANA), "dona le o proprio evento")
    recusa(le("events", id_de(r_ev), BIA), "outra vendedora nao le o evento")
    recusa(atualiza("events", id_de(r_ev), {"to": "sold"}, ANA), "evento nao se altera")
    recusa(apaga("events", id_de(r_ev), ANA), "evento nao se apaga")

    # --- vendas ---
    r_vd = cria("sales", VENDA, ANA)
    aceita(r_vd, "venda online do jeito que o app grava")
    aceita(cria("sales", variante(VENDA, type="physical", valor=80.5), ANA), "venda na loja do jeito que o app grava")
    recusa(cria("sales", variante(VENDA, sellerId="uid-bia"), ANA), "nao cria venda: sellerId diferente do uid")
    recusa(cria("sales", variante(VENDA, sellerEmail=""), ANA), "nao cria venda: email diferente do token")
    recusa(cria("sales", variante(VENDA, valor=100000), ANA), "nao cria venda: valor acima do limite")
    recusa(cria("sales", variante(VENDA, cashoutSent=True), ANA), "nao cria venda: ja fechada no caixa")
    recusa(cria("sales", variante(VENDA, soldAt=None), ANA), "nao cria venda: sem hora")
    recusa(cria("sales", variante(VENDA, type="troca"), ANA), "nao cria venda: tipo fora da lista")
    recusa(cria("sales", VENDA, None), "sem login nao cria venda")
    aceita(le("sales", id_de(r_vd), ANA), "dona le a propria venda")
    recusa(le("sales", id_de(r_vd), BIA), "outra vendedora nao le a venda")
    recusa(atualiza("sales", id_de(r_vd), {"valor": 1}, ANA), "venda nao se altera")
    recusa(apaga("sales", id_de(r_vd), ANA), "venda nao se apaga")

    # --- resto do banco ---
    recusa(cria("config", {"x": 1}, ANA), "outra colecao: nao grava")
    recusa(consulta("config", None, None, ANA), "outra colecao: nao le")
    recusa(req("PATCH", "/products/" + id_online + "/sub/x?updateMask.fieldPaths=a", campos({"a": 1}), ANA), "subcolecao: nao grava")

    print(json.dumps({"ok": len(ok), "falhas": falhas}, ensure_ascii=False, indent=1))
    if falhas:
        print("FALHOU: %d caso(s)" % len(falhas), file=sys.stderr)
        sys.exit(1)
    print("OK: %d casos" % len(ok), file=sys.stderr)


if __name__ == "__main__":
    main()
