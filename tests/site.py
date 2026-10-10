"""Confere o site publicado, sem login: abre nos dois motores com o SDK de
verdade (os modulos do CDN passando pelo SRI do index.html), a tela de login
aparece, o app.js rodou, e o console nao tem erro nem "Refused to". Nada e
digitado, nenhuma conta e tocada: e so a pagina publica.

Uso:  python tests/site.py [--url https://kohijow.github.io/LuxusBrecho.github.io/] [--motor chromium,webkit]
"""
import argparse
import json
import sys

from playwright.sync_api import sync_playwright

APARELHO = {"chromium": "Pixel 7", "webkit": "iPhone 13"}
SDK = ("firebase-app.js", "firebase-auth.js", "firebase-firestore.js")
RECUSA_DA_CAPTURA = "Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive"

ok, falhas = [], []


def checa(cond, motor, nome):
    (ok if cond else falhas).append("[%s] %s" % (motor, nome))


def confere(p, motor, url):
    perfil = {k: v for k, v in p.devices[APARELHO[motor]].items() if k != "default_browser_type"}
    b = getattr(p, motor).launch()
    ctx = b.new_context(**perfil)
    pg = ctx.new_page()
    erros, respostas = [], {}
    pg.on("pageerror", lambda e: erros.append("pageerror: " + str(e)))
    pg.on("console", lambda m: erros.append("console: " + m.text) if ("Refused to" in m.text or "Content Security Policy" in m.text or m.type == "error") else None)
    pg.on("response", lambda r: respostas.update({r.url.rsplit("/", 1)[1]: r.status}) if "/firebasejs/" in r.url else None)
    pg.goto(url, wait_until="load")
    pg.wait_for_timeout(4000)
    checa(pg.is_visible("#loginScreen") and pg.is_hidden("#appWrapper"), motor, "a tela de login aparece, sem sessao")
    checa(all(respostas.get(m) == 200 for m in SDK), motor, "os tres modulos do SDK vieram do CDN com 200 (%s)" % json.dumps(respostas))
    # o app.js so roda se os tres modulos passarem no SRI; ao iniciar ele grava o tema
    checa(pg.evaluate("localStorage.getItem('luxus-tema')") in ("claro", "escuro"), motor, "o app.js rodou (SRI do SDK passou)")
    tags = pg.evaluate("""[...document.querySelectorAll('script[type=module][src*="firebasejs"]')].map(s => s.integrity.slice(0, 7) + '|' + s.crossOrigin)""")
    checa(tags == ["sha384-|anonymous"] * 3, motor, "as tres tags do SDK tem integrity sha384 e crossorigin anonymous")
    csp = pg.evaluate("document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]').content")
    checa("frame-src 'none'" in csp and "worker-src 'none'" in csp and "'unsafe-inline'" not in csp, motor, "CSP publicada sem unsafe-inline, sem iframe e sem worker")
    checa(pg.evaluate("document.querySelector('meta[name=referrer]').content") == "strict-origin-when-cross-origin", motor, "referrer policy publicada")
    checa(pg.evaluate("navigator.serviceWorker ? navigator.serviceWorker.controller === null : true"), motor, "nenhum service worker controla a pagina")
    sujo = [e for e in erros if not e.startswith("console: " + RECUSA_DA_CAPTURA)]
    checa(not sujo, motor, "console sem erro e sem 'Refused to' (%s)" % sujo[:3])
    ctx.close()
    b.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="https://kohijow.github.io/LuxusBrecho.github.io/")
    ap.add_argument("--motor", default="chromium,webkit")
    args = ap.parse_args()
    with sync_playwright() as p:
        for motor in [m.strip() for m in args.motor.split(",") if m.strip()]:
            confere(p, motor, args.url)
    print(json.dumps({"ok": ok, "falhas": falhas}, ensure_ascii=False, indent=1))
    if falhas:
        print("FALHOU: %d" % len(falhas), file=sys.stderr)
        sys.exit(1)
    print("OK: %d verificacoes no site publicado" % len(ok), file=sys.stderr)


if __name__ == "__main__":
    main()
