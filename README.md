# Luxus Brechó

Ferramenta web que transforma uma foto de peça em anúncio pronto para o grupo de
WhatsApp do brechó: texto do produto, preço, link de reserva rastreável por
vendedora e controle do que já foi vendido.

Nasceu de um problema real. Anunciar peça por peça num grupo de WhatsApp é
repetitivo: fotografar, escrever a descrição, montar o preço, mandar. Isso toma
tempo que podia estar sendo usado para vender.

## Como funciona

1. A vendedora tira ou escolhe a foto da peça
2. Marca a categoria, o estado e o tamanho, e escreve um detalhe se quiser
3. Informa o preço
4. O app monta o anúncio e abre o WhatsApp com foto e texto prontos

O anúncio sai **na hora**, sem depender de internet boa nem de serviço externo.

## O texto do anúncio

O texto é montado no próprio navegador a partir do que foi marcado no
formulário. A primeira linha é uma chamada de grupo de promoção, porque é ela
que aparece na notificação. Quando a vendedora escreve um detalhe, ele abre o
texto, já que é a informação mais específica da peça. Cada categoria e cada
estado de conservação têm seu vocabulário, e a escolha varia de peça para peça:
vinte anúncios seguidos no grupo não saem todos iguais.

```
✨ Chegou peça nova!
Melissa azul com cadarço amarelo, tamanho 37. Calçado pronto pra andar muito.
Sem defeitos e sem sinal de uso.
Só tem essa, quem chamar primeiro leva.
```

Sem categoria marcada, o texto serve para qualquer coisa, não só roupa:

```
✨ Garimpo fresquinho pro grupo!
Luminária de mesa retrô, funcionando. Achado bom demais pra ficar parado.
Tem marcas discretas de uso, nada que incomode.
Só tem essa, quem chamar primeiro leva.
```

## Por que não tem IA

Já teve. Um modelo local num servidor pequeno levava de 30 a 60 segundos por
peça, e uma API paga acabava a cota. Quem está na loja com a cliente esperando
não tem esse tempo, e o texto montado no navegador sai na hora, de graça e sem
depender de nada fora do celular. As opções gratuitas e rápidas exigem um
servidor só para guardar a chave com segurança, o que não compensa para um
texto de três linhas.

## Interface

O visual segue o perfil da loja no Instagram: papel creme, serifa de revista,
o coral e o rosa do logo, o verde-azulado das folhas e fotos em polaroid. A
foto escolhida vira uma polaroid presa com fita e "revela" como foto
instantânea, a mensagem aparece como balão do WhatsApp do jeito que vai chegar
no grupo, e o tema da noite troca abrindo um círculo a partir do botão.

Quem usa é a vendedora, no celular, de pé na loja, muitas vezes com a cliente
esperando. Por isso:

- Todo alvo de toque tem no mínimo 44px, incluindo as etiquetas de categoria e
  os botões do histórico
- Texto com contraste de pelo menos 4.5:1 nos dois temas
- `:hover` só entra dentro de `@media (hover: hover)`, senão o estado fica
  colado depois do toque
- As animações usam `transform` e `opacity`, e quem ativou "reduzir movimento"
  no celular vê tudo parado
- Os efeitos ficam num arquivo separado (`efeitos.js`): se ele falhar, o app
  funciona igual, só sem enfeite

## Controle de vendas

- Cada peça ganha um código, que aparece no post do grupo e na mensagem que a
  cliente manda ao clicar no link. A cliente chega dizendo qual peça quer:

  ```
  Oi! Tenho interesse na peça 7FPRK6 do Luxus Brechó: Calçado Melissa azul
  com cadarço amarelo, tam 37, R$ 45,00
  ```

- No histórico, a busca encontra a peça pelo código e mostra a foto
- A mensagem do link é curta e sem emoji de propósito: cada emoji vira 12
  caracteres no link e o post do grupo fica poluído
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
style.css    visual editorial, temas dia e noite, animações
efeitos.js   animações que precisam de JavaScript (confete, contagem, onda no toque)
```

## Licença

MIT: use, modifique e distribua livremente.
