# 🛍️ Brechó Post IA

Ferramenta web para gerar anúncios de produtos de brechó com IA (Google Gemini), com link de rastreamento por vendedor, controle de status dos produtos e alerta de venda via WhatsApp.

> Feito para rodar direto no navegador — sem backend, sem instalação.

---

## ✨ Funcionalidades

- **Geração de texto com IA** — descreve o produto de forma animada e criativa usando o Google Gemini
- **Suporte a foto** — envia a imagem para a IA analisar cor, estilo e detalhes
- **Link rastreável por vendedor** — cada anúncio gera um link `wa.me` com o nome do vendedor, permitindo rastrear de onde veio o interesse
- **Controle de status** — cada produto tem status independente: Disponível → Reservado → Vendido
- **Cancelamento flexível** — reserva ou venda podem ser canceladas a qualquer momento, voltando o produto para Disponível
- **Alerta de venda no WhatsApp** — ao confirmar uma venda, abre automaticamente uma mensagem no WhatsApp do administrador com resumo da venda para cobrança de comissão
- **Histórico persistente** — todos os produtos anunciados ficam salvos no `localStorage`, mesmo após fechar o navegador
- **Fallback automático de modelos** — se um modelo da API atingir o limite, tenta o próximo automaticamente
- **Tema claro/escuro**
- **100% offline-ready** — só precisa de internet para chamar a API do Gemini

---

## 🚀 Como usar

### 1. Abrir o app
Acesse o link do GitHub Pages ou abra o arquivo `index.html` diretamente no navegador.

### 2. Configurar (ícone ⚙️)
| Campo | Descrição |
|---|---|
| Chave da API Gemini | Obtida gratuitamente em [aistudio.google.com](https://aistudio.google.com) |
| Nome do brechó | Aparece no cabeçalho do anúncio |
| Telefone do brechó | Número que recebe os interessados via WhatsApp |
| Seu nome | Aparece no link rastreável para identificar o vendedor |
| Seu WhatsApp | Recebe o resumo quando uma venda é confirmada |

> A chave da API fica **apenas na memória da sessão** — nunca é salva ou enviada para nenhum servidor além da API do Google.

### 3. Anunciar um produto
1. Adicione uma foto (opcional, mas melhora muito o texto gerado)
2. Preencha preço, tamanho, categoria e estado
3. Clique em **Gerar mensagem com IA**
4. Copie ou compartilhe direto no WhatsApp

### 4. Controlar vendas (aba Histórico)
- Todos os produtos anunciados aparecem aqui com status em tempo real
- Mude o status de qualquer produto a qualquer momento
- Ao confirmar uma venda, você recebe um resumo no WhatsApp para cobrar sua % de comissão

---

## 🤖 Modelos de IA utilizados

A ferramenta tenta os modelos nesta ordem, com retry automático em caso de limite:

1. `gemini-2.5-flash` — principal
2. `gemini-2.5-flash-lite` — mais leve
3. `gemini-2.0-flash-lite` — fallback
4. `gemini-1.5-flash-latest` — último recurso

> O plano gratuito da API do Google permite ~10–15 requisições por minuto. Suficiente para uso normal.

---

## 📦 Deploy no GitHub Pages

1. Faça upload do arquivo `index.html` neste repositório
2. Vá em **Settings → Pages**
3. Em *Source*, selecione `Deploy from a branch` → `main` → `/ (root)`
4. Salve e aguarde ~1 minuto
5. Acesse: `https://<seu-usuario>.github.io/<nome-do-repositorio>/`

---

## 🗂️ Estrutura

```
index.html   ← app completo (HTML + CSS + JS em um único arquivo)
README.md    ← este arquivo
```

Não há dependências externas além da fonte do Google Fonts (carregada via CDN) e da API do Gemini.

---

## 🔒 Privacidade

- Nenhum dado é enviado para servidores próprios
- A chave da API é usada apenas para chamadas diretas à API do Google
- O histórico de produtos fica salvo apenas no `localStorage` do navegador do usuário

---

## 📄 Licença

MIT — use, modifique e distribua livremente.
