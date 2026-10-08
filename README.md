# Luxus Brechó

Ferramenta web que transforma uma foto de peça em anúncio pronto para o grupo de
WhatsApp do brechó: texto do produto, preço, link de reserva rastreável por
vendedora e controle do que já foi vendido.

Nasceu de um problema real. Anunciar peça por peça num grupo de WhatsApp é
repetitivo: fotografar, escrever a descrição, montar o preço, mandar. Isso toma
tempo que podia estar sendo usado para vender.

## Como funciona

1. A vendedora tira ou escolhe a foto da peça
2. Marca a categoria, o estado e o tamanho
3. Informa o preço
4. O app monta o anúncio e abre o WhatsApp com foto e texto prontos

O anúncio sai **na hora**, sem depender de internet boa nem de serviço externo.

## O texto do anúncio

O texto é montado no próprio navegador a partir do que foi marcado no
formulário. Cada categoria tem seu vocabulário e cada estado de conservação tem
sua forma de ser dito, e a escolha varia de peça para peça. Vinte anúncios
seguidos no grupo não saem todos iguais.

```
Vestido com caimento bonito, tamanho M. Em ótimo estado, sem marcas de uso.
Seda. Se gostou, chama que eu seguro pra você.

Calçado confortável de verdade, tamanho 37. Nunca saiu do cabide: etiqueta
ainda na peça. Peça única: saiu, acabou.
```

## A IA é opcional

Existe um modo que passa o texto por um modelo de linguagem para deixá-lo mais
caprichado. Ele vem **desligado**, e por um motivo prático: o modelo roda num
servidor pequeno e leva de 30 a 60 segundos por peça. Quem está na loja com a
cliente esperando não tem esse tempo.

Com a opção ligada, se o modelo demorar ou estiver fora do ar, o anúncio sai
com o texto local do mesmo jeito. A venda nunca trava por causa da IA.

## Interface

Quem usa é a vendedora, no celular, de pé na loja, muitas vezes com a cliente
esperando. A tela foi feita a partir disso:

- Todo alvo de toque tem no mínimo 44px de altura, incluindo as tags de
  categoria e os botões de ação do histórico
- `:hover` só entra dentro de `@media (hover:hover)`, senão o estado fica colado
  depois do toque no celular
- Todo elemento clicável tem retorno visual no toque e contorno visível no
  teclado, e as tags respondem a Enter e espaço
- Tema claro e escuro com paleta própria: as cores de texto sobre fundo colorido
  mudam junto, para não cair em cinza claro sobre bege
- Espaçamento vem de uma escala única de tokens, nada de valor solto

## Controle de vendas

- Cada anúncio gera um link `wa.me` com código do produto e nome da vendedora,
  então dá para saber de qual post veio o interesse
- Status por peça: disponível, reservada, vendida, com cancelamento a qualquer
  momento
- Ao confirmar uma venda, abre uma mensagem com o resumo para acerto de comissão
- Histórico fica salvo e sincronizado por vendedora

## Rodando

É um site estático. Para abrir localmente:

```bash
python3 -m http.server 8000
```

E acessar `http://localhost:8000`.

Login e histórico usam Firebase Authentication e Firestore. A configuração do
projeto fica no `app.js`, e o acesso aos dados é controlado pelas regras do
Firestore, não pela chave, que é pública por natureza em aplicação web.

## Estrutura

```
index.html   telas e formulário
app.js       lógica, geração do texto, WhatsApp e persistência
style.css    tema claro e escuro
```

## Licença

MIT: use, modifique e distribua livremente.
