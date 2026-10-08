"""Mede o contraste de texto do style.css nos dois temas, sem navegador.

Le os tokens de cor de :root e de [data-theme="dark"], compoe fundos
translucidos sobre o que esta por baixo e calcula a razao WCAG de cada par
texto/fundo que a interface usa. Qualquer par abaixo de 4.5:1 derruba o teste.

Uso: python tests/contraste.py
"""
import re
import sys
from pathlib import Path

CSS = (Path(__file__).resolve().parent.parent / "style.css").read_text(encoding="utf-8")
MINIMO = 4.5

# (texto, fundo, o que esta por baixo de um fundo translucido, onde aparece)
PARES = [
    ("--text", "--bg", None, "texto no fundo"),
    ("--text", "--card", None, "texto no cartao"),
    ("--text-soft", "--bg", None, "label de campo, abas, eyebrow do login"),
    ("--text-soft", "--card", None, "labels dentro do cartao"),
    ("--text-soft", "--card-2", None, "botoes de foto, info-badge"),
    ("--text-faint", "--bg", None, "subtitulo do cabecalho, email"),
    ("--text-faint", "--card", None, "hist-meta, hist-time, stat-lbl, hint"),
    ("--text-faint", "--card-2", None, "placeholder nos campos"),
    ("--pink-ink", "--card", None, "prefixo R$, esqueci minha senha, codigo da peca"),
    ("--pink-ink", "--bg", None, "rosa sobre o fundo"),
    ("--teal", "--card", None, "icone do link do resultado"),
    ("--teal", "--teal-soft", "--card", "link de reserva no resultado"),
    ("--ok", "--ok-bg", "--card", "status disponivel, confirmar venda, aviso do esqueci a senha"),
    ("--ok", "--card", None, "contador de disponiveis"),
    ("--warn", "--warn-bg", "--card", "status reservado, botao reservar, resultado nao salvo"),
    ("--warn", "--card", None, "contador de reservados"),
    ("--sold", "--sold-bg", "--card", "status vendido"),
    ("--text-soft", "--sold-bg", "--card", "botao cancelar"),
    ("--phys", "--phys-bg", "--card", "status venda na loja"),
    ("--error", "--error-bg", "--card", "barra de erro, erro do login"),
    ("--bubble-ink", "--bubble", None, "balao da mensagem"),
    ("--on-grad", "#C2405A", None, "texto no botao principal (meio do gradiente)"),
    ("--on-grad", "#C24A35", None, "texto no botao principal (inicio do gradiente)"),
    ("--on-grad", "--teal-solid", None, "texto no botao venda na loja"),
    ("#FFF7EF", "#2A1F1D", None, "aviso flutuante no tema claro"),
    ("#2A1F1D", "#F5EDE4", None, "aviso flutuante no tema escuro"),
    ("#2A1F1D", "--paper", None, "legenda da polaroid"),
    ("--text-soft", "--teal-soft", "--card", "texto do info-badge"),
    ("--ink", "--teal-soft", "--card", "titulo do link de reserva"),
]


def bloco(seletor):
    m = re.search(re.escape(seletor) + r"\s*\{(.*?)\n\}", CSS, re.S)
    return dict(re.findall(r"(--[\w-]+):\s*([^;]+);", m.group(1)))


def cor(v, toks):
    v = v.strip()
    if v.startswith("--"):
        return cor(toks[v], toks)
    m = re.match(r"var\((--[\w-]+)\)", v)
    if m:
        return cor(toks[m.group(1)], toks)
    m = re.match(r"#([0-9a-fA-F]{6})$", v)
    if m:
        return tuple(int(m.group(1)[i:i + 2], 16) for i in (0, 2, 4)) + (1.0,)
    m = re.match(r"rgba?\(([^)]+)\)", v)
    if m:
        p = [x.strip() for x in m.group(1).split(",")]
        return (float(p[0]), float(p[1]), float(p[2]), float(p[3]) if len(p) > 3 else 1.0)
    raise ValueError("cor que nao sei ler: " + v)


def sobre(frente, fundo):
    a = frente[3]
    return tuple(frente[i] * a + fundo[i] * (1 - a) for i in range(3)) + (1.0,)


def luminancia(c):
    def canal(x):
        x /= 255
        return x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4
    return 0.2126 * canal(c[0]) + 0.7152 * canal(c[1]) + 0.0722 * canal(c[2])


def razao(a, b):
    la, lb = luminancia(a), luminancia(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def main():
    claro = bloco(":root")
    escuro = dict(claro)
    escuro.update(bloco('[data-theme="dark"]'))
    ruins = []
    for nome, toks in (("claro", claro), ("escuro", escuro)):
        print("== tema", nome)
        for texto, fundo, embaixo, uso in PARES:
            cf = cor(fundo, toks)
            if cf[3] < 1:
                cf = sobre(cf, cor(embaixo, toks))
            ct = cor(texto, toks)
            if ct[3] < 1:
                ct = sobre(ct, cf)
            r = razao(ct, cf)
            print("%s %5.2f  %-12s sobre %-13s %s" % ("ok " if r >= MINIMO else "XXX", r, texto, fundo, uso))
            if r < MINIMO:
                ruins.append((nome, texto, fundo, round(r, 2), uso))
    if ruins:
        print("ABAIXO DE %.1f:1:" % MINIMO, ruins, file=sys.stderr)
        sys.exit(1)
    print("OK: %d pares em cada tema, todos acima de %.1f:1" % (len(PARES), MINIMO), file=sys.stderr)


if __name__ == "__main__":
    main()
