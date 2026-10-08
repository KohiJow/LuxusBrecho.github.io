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
O texto aparece antes de o banco confirmar que salvou, e o topo do resultado
diz em qual situação está: salvando, salvo, ou não salvo (com o motivo num
aviso). Sem internet, um aviso entra depois de dez segundos em vez de deixar a
vendedora achar que já está no histórico.

## O texto do anúncio

O texto é montado no próprio navegador a partir do que foi marcado no
formulário. A primeira linha é uma chamada de grupo de promoção (abre com um
brilho), porque é ela que aparece na notificação. Quando a vendedora escreve um
detalhe, ele abre o texto, já que é a informação mais específica da peça. Cada
categoria e cada estado de conservação têm seu vocabulário, e a escolha varia
de peça para peça: vinte anúncios seguidos no grupo não saem todos iguais.

```
Chegou peça nova!
Melissa azul com cadarço amarelo, tamanho 37. Calçado pronto pra andar muito.
Sem defeitos e sem sinal de uso.
Só tem essa, quem chamar primeiro leva.
```

Sem categoria marcada, o texto serve para qualquer coisa, não só roupa:

```
Garimpo fresquinho pro grupo!
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
- Texto com contraste de pelo menos 4.5:1 nos dois temas, medido por
  `tests/contraste.py` (o menor par é 4.86:1)
- Tudo funciona pelo teclado: as etiquetas respondem a Enter, espaço e setas
  (o estado é um grupo de rádio), as abas às setas, o modal fecha com Esc e
  devolve o foco para o botão que o abriu, e quem navega por Tab vê um anel de
  foco rosa
- Estados de erro com motivo e saída: preço faltando leva o foco ao campo,
  banco recusando mostra o porquê e um "Tentar de novo"
- `:hover` só entra dentro de `@media (hover: hover)`, senão o estado fica
  colado depois do toque
- As animações usam `transform` e `opacity`, e quem ativou "reduzir movimento"
  no celular vê tudo parado
- Os efeitos ficam num arquivo separado (`efeitos.js`): se ele falhar, o app
  funciona igual, só sem enfeite

## Controle de vendas

- Cada peça ganha um código de seis caracteres (sem 0/O nem 1/I, porque ele é
  lido em voz alta), que aparece no post do grupo e na mensagem que a cliente
  manda ao clicar no link. A cliente chega dizendo qual peça quer:

  ```
  Oi! Tenho interesse na peça 7FPRK6 do Luxus Brechó: Calçado Melissa azul
  com cadarço amarelo, tam 37, R$ 45,00
  ```

- No histórico, a busca encontra a peça pelo código e mostra a foto
- A mensagem do link é curta e sem emoji de propósito: cada emoji vira 12
  caracteres no link e o post do grupo fica poluído
- Status por peça: disponível, reservada, vendida, com cancelamento a qualquer
  momento. A tela muda na hora e volta atrás se o banco recusar
- Ao confirmar uma venda, abre uma mensagem com o resumo para acerto de comissão
- Venda feita na loja entra no mesmo histórico e no fechamento do caixa
- Histórico fica salvo e sincronizado por vendedora

## Segurança

O app é estático e fala direto com o Firebase (Authentication por email e
senha, Firestore). Num app assim, a segurança mora em três lugares: nas regras
do banco, no que o navegador aceita executar, e em como o app trata o que vem
de fora.

### A chave do Firebase é pública, e isso é normal

A `apiKey` que está no `app.js` identifica o projeto, não autentica ninguém.
Ela vai parar no navegador de qualquer pessoa que abra o site, e o Firebase
foi desenhado para isso. O que protege os dados são as regras do Firestore e
a autenticação: sem token de uma conta logada, nenhuma leitura ou escrita
passa. Não trate a chave como segredo, mas também não a confunda com a chave
de uma conta de serviço (essa, sim, nunca pode ir para o repositório).

### Regras do Firestore (`firestore.rules`)

As regras são publicadas pelo dono do projeto, no Console do Firebase
(Firestore > Regras, colar e publicar) ou com
`firebase deploy --only firestore:rules` usando o `firebase.json` deste
repositório. O que cada bloco protege:

- **Funções de validação**: tipos e tamanhos de cada campo. Texto curto,
  preço entre 0 e 99999, listas conferidas item a item, foto só como JPEG em
  base64 de até 700 KB, status e tipo em lista fechada, `ts` inteiro e no
  máximo um dia à frente do servidor. Os limites acompanham os do app
  (`LIMITE` em `app.js` e os `maxlength` do `index.html`)
- **`products`**: só a dona (`brecoOwner` igual ao uid logado) lê, e a consulta
  do app filtra por ela, então a leitura em lista passa. Criar exige
  exatamente os campos que o app grava, dono igual ao uid, email igual ao do
  token, `cashoutSent` falso e `soldAt` coerente com o status (vendido tem
  hora, o resto não). Depois de criado, só `status`, `soldAt` e `cashoutSent`
  mudam; dono, preço, foto e código são imutáveis. Apagar, só venda na loja,
  que é o único "remover" que o app oferece
- **`events`** e **`sales`**: registro de mudança de status e de venda, com
  `by` e `sellerId` iguais ao uid. Nascem e ficam: ninguém altera nem apaga
- **Resto do banco**: fechado para leitura e escrita

A consulta do histórico usa só o filtro pela dona e ordena no navegador. Antes
havia um `orderBy` junto com o `where`, que exige índice composto no Firestore
e, sem ele, fazia o histórico sumir em silêncio. Se a consulta falhar por
qualquer motivo, o histórico mostra o erro e um botão de tentar de novo.

As regras são testadas no emulador por `tests/regras.py` (veja Testes): o que
o app faz tem que passar, e o que um invasor tentaria tem que ser recusado.

### O que o navegador aceita executar

- **Content-Security-Policy** no `<meta>` do `index.html`: script só do
  próprio site e do CDN do Firebase (`www.gstatic.com`), estilo só do próprio
  site e do Google Fonts, conexões só com os endpoints do Firebase, nada de
  `object`, `base` ou envio de formulário para fora. Não há `'unsafe-inline'`
  nem para script nem para estilo: nenhum botão usa `onclick`, cada um declara
  `data-action` e o `app.js` trata o clique por delegação, e o HTML não tem
  `style=` (os atrasos das folhas do fundo viraram regras por posição no CSS;
  esconder e mostrar usa o atributo `hidden`). O `tests/e2e.py` vigia o
  console e falha em qualquer "Refused to"
- `frame-ancestors` (contra clickjacking) só funciona em cabeçalho HTTP, que o
  GitHub Pages não deixa configurar, por isso não está no `<meta>`: lá ele
  seria ignorado e só geraria aviso no console
- Se um dia entrar login com Google ou outro provedor por popup, a CSP vai
  precisar de `frame-src https://brechobase.firebaseapp.com` e de
  `script-src https://apis.google.com`
- **Referrer policy** `strict-origin-when-cross-origin`, e todo `window.open`
  para o WhatsApp vai com `noopener,noreferrer`

### O que vem de fora

- Tudo que o histórico desenha a partir do banco passa por um template que
  escapa cada valor (`html` e `esc` em `app.js`): nome da loja, categoria,
  código, estado e preço viram texto, nunca marcação. A miniatura só aceita
  `data:image/...` em base64; qualquer outra coisa no campo da foto vira o
  emoji da categoria
- A foto escolhida é lida pelo navegador, reduzida a 640px e reencodada como
  JPEG antes de ir para o banco, então o arquivo original nunca sobe
- Login: erro de credencial vira sempre "Email ou senha incorretos", sem
  distinguir conta inexistente de senha errada. "Esqueci minha senha" responde
  a mesma frase para email com e sem conta. Os campos têm `autocomplete` de
  email e `current-password` para o gerenciador de senhas do celular
- No navegador ficam só as configurações da loja (telefone, nome) e o tema,
  em `localStorage`. Nada vai para o console

### O que fica em aberto

- As fotos vão dentro do documento do produto, em base64. Com centenas de
  peças, o histórico fica pesado para carregar; o caminho é Firebase Storage
  com link no documento
- `frame-ancestors` depende de cabeçalho HTTP, como dito acima
- Não há limite de tentativas próprio: o que existe é o do Firebase
  Authentication (`auth/too-many-requests`), que o app mostra

## Testes

Tudo roda local, sem conta no Firebase e sem tocar o projeto real.

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
python -m playwright install chromium

python tests/contraste.py     # pares texto/fundo dos dois temas, direto do style.css
python tests/e2e.py           # fluxo inteiro num Chromium de celular, com Firebase de mentira
```

`tests/e2e.py` sobe um servidor estático na raiz do repositório, substitui o
Firebase por `tests/stub.js` (que anota o que o app tentou gravar e abrir) e
percorre: login com erro e "esqueci minha senha", esqueleto e estado vazio,
consulta recusada com "tentar de novo", dados maliciosos vindos do banco,
etiquetas pelo teclado, anúncio com foto, busca por código, reservar e
confirmar venda (conferindo o que foi gravado e para onde o alerta foi), venda
na loja com Esc e foco de volta, fechamento de caixa, remoção, tema pelo
botão, sair. Repete as telas em 360 e 430px e com "reduzir movimento". Falha
com qualquer erro de JavaScript ou violação de CSP no console. As capturas de
tela ficam em `tests/saida` (fora do git). A fixture `tests/peca-teste.jpg` é
uma imagem neutra, não uma foto da loja.

As regras do Firestore precisam do emulador (Java 21 e a CLI do Firebase, sem
login; o projeto `demo-luxus` é só local):

```bash
npm install -g firebase-tools
firebase emulators:exec --only firestore --project demo-luxus "python3 tests/regras.py"
```

`tests/regras.py` fala com a API REST do emulador usando tokens sem
assinatura, o mesmo mecanismo da biblioteca oficial de teste de regras, e
cobre 81 casos: cada escrita que o app faz, e para cada campo uma tentativa
de burlar (dono diferente, campo a mais, tipo errado, tamanho acima, foto que
não é imagem, status fora da lista, alteração de campo imutável, leitura dos
dados de outra vendedora, consulta sem filtro).

O GitHub Actions (`.github/workflows/testes.yml`) roda os três a cada push.

## Rodando

É um site estático. Para abrir localmente:

```bash
python3 -m http.server 8000
```

E acessar `http://localhost:8000`. O login e o histórico usam o projeto real
do Firebase; para mexer no app sem conta, use o e2e, que já traz o Firebase
de mentira.

## Estrutura

```
index.html            telas e formulário; CSP no <head>
app.js                lógica em um escopo só, em 13 seções: login, config,
                      banco, tema e abas, foto, etiquetas, texto do anúncio,
                      gerar e compartilhar, histórico, venda na loja, eventos
style.css             visual editorial, temas dia e noite, animações, foco
efeitos.js            enfeites que precisam de JavaScript (confete, contagem,
                      onda no toque, círculo na troca de tema); expõe
                      window.efeitos, que o app usa se existir
firestore.rules       regras do banco com validação de esquema
firebase.json         aponta as regras e o emulador
tests/e2e.py          teste de ponta a ponta (Playwright)
tests/stub.js         Firebase de mentira usado pelo e2e
tests/regras.py       teste das regras no emulador
tests/contraste.py    medição de contraste dos tokens
tests/peca-teste.jpg  fixture neutra do e2e
requirements-dev.txt  dependências dos testes
```

## Licença

MIT: use, modifique e distribua livremente.
