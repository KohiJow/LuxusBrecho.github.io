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
- `:hover` só entra dentro de `@media (hover: hover) and (pointer: fine)`,
  senão o estado fica colado depois do toque (tem Android que diz ter hover)
- As animações usam `transform` e `opacity`, e quem ativou "reduzir movimento"
  no celular vê tudo parado (veja Celular, logo abaixo)
- Os efeitos ficam num arquivo separado (`efeitos.js`): se ele falhar, o app
  funciona igual, só sem enfeite

## Celular

O app é usado no Android (Chrome, Brave) e no iPhone (Safari). As animações
foram gravadas em vídeo e medidas quadro a quadro nos dois motores, com o
Playwright: WebKit 26.4 (o motor do Safari) nos perfis iPhone 13 e iPhone SE,
e Chromium 148 (o motor do Chrome e do Brave) no perfil Pixel 7, também com a
CPU 4x mais lenta para simular um Android simples. O que estava errado e
mudou:

- **Cabeçalho tremendo perto do topo**: ao rolar, ele encolhia de verdade
  (padding e logo), o conteúdo subia, o navegador corrigia a rolagem e ele
  voltava a crescer, sem parar (86 trocas em 1,5 s a 10 px do topo). Agora a
  altura não muda: o sticky para 8 px acima da tela e só sombra, borda e o
  logo (por `transform`) mudam
- **Cartão do anúncio e confete repetindo**: quando o banco confirmava o
  anúncio (um segundo depois, na rede de verdade), o cartão animava de novo e
  o confete saía duas vezes
- **Histórico piscando**: cada letra da busca e cada "Reservar" refazia a
  lista inteira, os cartões repetiam a entrada e as miniaturas eram
  decodificadas de novo. Agora cada cartão é reaproveitado e só a peça que
  mudou ganha um nó novo; a entrada em cascata acontece quando a aba abre
- **Folha da venda na loja**: subia com mola, passava do ponto e abria um vão
  embaixo. Agora para no lugar, e o véu escuro ficou sem desfoque, que
  derrubava quadros ao abrir e fechar
- **Troca de tema no iPhone com iOS 17 ou antes**: sem View Transitions (só
  iOS 18 em diante), o tema trocava seco. Agora um círculo da cor do tema
  novo cresce do toque, e nos dois caminhos as transições de cor ficam
  desligadas durante a troca
- **Armadilhas do Safari evitadas**: títulos em gradiente
  (`background-clip: text`) se escrevem animando só o fundo, sem
  filter/clip-path/opacity; nada de `var()` dentro de `@keyframes` (o confete
  anima pela Web Animations API com números prontos e as polaroids usam a
  propriedade `rotate`); `dvh` sempre com `vh` antes; `:active` funciona no
  iPhone com um ouvinte de `touchstart`; `isolation` nos botões com
  `overflow: hidden` para a onda do toque não vazar dos cantos
- **Peso no celular simples**: o desfoque atrás do cartão do login saiu (as
  manchas de trás se mexem sempre, então ele era refeito a cada quadro); a
  bolinha dos cartões pulsa por `transform` em vez de `box-shadow`; a foto
  revela só com filtros de cor, sem `blur`; as miniaturas decodificam fora do
  quadro (`decoding="async"`); a polaroid só entra com a foto já
  decodificada; com o modal aberto, as animações de trás param

Com a CPU 4x mais lenta, o intervalo entre quadros (p95) caiu de 33 para 17 ms
na abertura do login, ao gerar o anúncio e no histórico, e de 50 a 67 para
17 ms na troca de tema.

**Reduzir movimento.** Quem liga "Reduzir movimento" no iPhone, ou "Remover
animações" no Android (alguns Android ligam isso junto com a economia de
bateria), vê o app parado de propósito: tudo aparece direto no estado final.
Nesse caso as Configurações mostram um aviso explicando por que nada se mexe.

O WebKit do Playwright não é o Safari do iPhone: é o mesmo motor, numa versão
recente, rodando em Linux sem GPU. Ele serve para conferir que cada animação
aparece e termina no estado certo (os testes congelam a animação no meio e
olham a tela), não para medir fluidez; a fluidez foi medida no Chromium. Os
recursos novos têm alternativa: View Transitions (iOS 18), `dvh` e `:has()`
(iOS 15.4). Versões do iOS abaixo da 15.4 não foram testadas.

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

- **SDK modular do Firebase, sem login por popup**: o `app.js` é um módulo ES
  que importa `firebase-app.js`, `firebase-auth.js` e `firebase-firestore.js`
  (10.12.0) do CDN. O Auth é montado com `initializeAuth` e persistência em
  IndexedDB e localStorage, sem o resolvedor de popup e redirecionamento. O
  SDK compat, usado antes, montava esse resolvedor sozinho e, no celular,
  carregava `https://apis.google.com/js/api.js` logo ao abrir, que a CSP
  bloqueava ("Refused to load", visto no site no ar no iPhone e no Android).
  O app só entra por email e senha, então nada disso faz falta. Quem já estava
  logada continua logada depois da troca: a sessão fica na mesma chave do
  IndexedDB, e isso foi conferido entrando pelo app antigo e abrindo o novo
- **Content-Security-Policy** no `<meta>` do `index.html`, a mesma de antes
  da troca de SDK (nenhum domínio novo; `apis.google.com` continua de fora):
  script só do
  próprio site e da pasta do Firebase no CDN (`www.gstatic.com/firebasejs/`),
  estilo só do próprio site e do Google Fonts, imagem só do próprio site e em
  `data:`, conexões só com Authentication e Firestore (o app não usa Realtime
  Database, então `firebaseio.com` não entra), nada de `object`, `base` ou
  envio de formulário para fora. Não há `'unsafe-inline'`
  nem para script nem para estilo: nenhum botão usa `onclick`, cada um declara
  `data-action` e o `app.js` trata o clique por delegação, e o HTML não tem
  `style=` (os atrasos das folhas do fundo viraram regras por posição no CSS;
  esconder e mostrar usa o atributo `hidden`). O `tests/e2e.py` e o
  `tests/emulador.py` vigiam o console nos dois motores e falham em qualquer
  "Refused to". A única exceção é uma recusa de folha de estilo que o próprio
  Playwright provoca no WebKit ao tirar captura de tela (acontece igual numa
  página vazia com a mesma política), ignorada só durante a captura
- `frame-ancestors` (contra clickjacking) só funciona em cabeçalho HTTP, que o
  GitHub Pages não deixa configurar, por isso não está no `<meta>`: lá ele
  seria ignorado e só geraria aviso no console
- Se um dia entrar login com Google ou outro provedor por popup, o Auth vai
  precisar do `browserPopupRedirectResolver` no `initializeAuth`, e a CSP, de
  `frame-src https://brechobase.firebaseapp.com` e de
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
python -m playwright install chromium webkit

python tests/contraste.py     # pares texto/fundo dos dois temas, direto do style.css
python tests/e2e.py           # fluxo inteiro no WebKit (iPhone 13) e no Chromium (Pixel 7), com Firebase de mentira
```

Em Linux onde o WebKit do Playwright não instala direto (Oracle Linux, por
exemplo), o contêiner oficial dele resolve:
`podman run --rm --network host -v "$PWD":/w:Z -w /w --ipc=host mcr.microsoft.com/playwright/python:v1.60.0-noble sh -c "pip install -r requirements-dev.txt && python tests/e2e.py --motor webkit"`.

`tests/e2e.py` sobe um servidor estático na raiz do repositório, troca os três
módulos do SDK do Firebase por `tests/stub.js` (que anota o que o app tentou
gravar e abrir) e percorre, em cada motor: login com erro e "esqueci minha
senha", esqueleto e estado vazio, consulta recusada com "tentar de novo",
dados maliciosos vindos do banco, miniaturas em retrato (480x900) e paisagem
(900x480), busca e reserva sem refazer a lista, etiquetas pelo teclado,
anúncio com foto, busca por código, reservar e confirmar venda (conferindo o
que foi gravado e para onde o alerta foi), venda na loja com Esc e foco de
volta, fechamento de caixa, remoção, tema pelo botão (com e sem View
Transitions), sair. As animações são congeladas no meio pela Web Animations
API para conferir que aparecem (o título se escrevendo, a foto revelando, o
confete espalhado) e soltas para conferir o estado final; o cabeçalho não
pode tremer perto do topo, a folha do modal não pode abrir vão, e o cartão do
anúncio anima e solta confete uma vez só mesmo com o banco demorando. Repete
as telas em 360 e 430px e com "reduzir movimento". Falha com qualquer erro
de JavaScript ou violação de CSP no console. As capturas de tela ficam em
`tests/saida/<motor>` (fora do git). A fixture `tests/peca-teste.jpg` é uma
imagem neutra, não uma foto da loja; as fotos em retrato e paisagem são
geradas na hora.

As regras do Firestore precisam do emulador (Java 21 e a CLI do Firebase, sem
login; o projeto `demo-luxus` é só local):

```bash
npm install -g firebase-tools
firebase emulators:exec --only firestore --project demo-luxus "python3 tests/regras.py"
firebase emulators:exec --only auth,firestore --project demo-luxus "python3 tests/emulador.py"
```

`tests/emulador.py` abre o app com o SDK de verdade (os módulos do CDN) no
modo de teste, que liga os emuladores de Auth e Firestore e só existe com a
página servida de `127.0.0.1` ou `localhost` e `?emulador=PORTA_AUTH,PORTA_FIRESTORE`
na URL; no site publicado esse código não faz nada. No modo de teste o
projeto é o `demo-luxus` e o Firestore vai por long polling (o streaming do
emulador falha no WebKit do teste); em produção fica o padrão do SDK. Em cada
motor ele confere: conta inexistente e senha errada com a mesma mensagem,
recuperação de senha com e sem conta (o emulador gera o link só para quem
tem conta), login, anúncio gravado em `products`, reserva e venda em
`events` e `sales`, venda na loja, fechamento de caixa e remoção, a sessão
continuando depois de recarregar, e outra vendedora que entra e não vê nada
da primeira. Tudo passa pelas regras do `firestore.rules`, e qualquer pedido
para fora do servidor local, dos emuladores, das fontes e do CDN do SDK
derruba o teste.

`tests/regras.py` fala com a API REST do emulador usando tokens sem
assinatura, o mesmo mecanismo da biblioteca oficial de teste de regras, e
cobre 81 casos: cada escrita que o app faz, e para cada campo uma tentativa
de burlar (dono diferente, campo a mais, tipo errado, tamanho acima, foto que
não é imagem, status fora da lista, alteração de campo imutável, leitura dos
dados de outra vendedora, consulta sem filtro).

O GitHub Actions (`.github/workflows/testes.yml`) roda tudo a cada push:
contraste e ponta a ponta nos dois motores, o SDK de verdade contra os
emuladores nos dois motores, e as regras.

## Rodando

É um site estático. Para abrir localmente:

```bash
python3 -m http.server 8000
```

E acessar `http://localhost:8000`. O login e o histórico usam o projeto real
do Firebase; para mexer no app sem conta, use o e2e, que já traz o Firebase
de mentira, ou suba os emuladores (`firebase emulators:start --only
auth,firestore --project demo-luxus`) e abra
`http://localhost:8000/?emulador=8576,8577`. Nesse caso a CSP do `index.html`
recusa a conexão com o emulador; o `tests/emulador.py` resolve isso servindo
uma cópia da página com as duas portas somadas ao `connect-src`.

## Estrutura

```
index.html            telas e formulário; CSP no <head>
app.js                módulo ES com o SDK modular do Firebase; lógica em um
                      escopo só, em 13 seções: login, config, banco, tema e
                      abas, foto, etiquetas, texto do anúncio, gerar e
                      compartilhar, histórico, venda na loja, eventos
style.css             visual editorial, temas dia e noite, animações, foco
efeitos.js            enfeites que precisam de JavaScript (confete, contagem,
                      onda no toque, círculo na troca de tema); expõe
                      window.efeitos, que o app usa se existir
firestore.rules       regras do banco com validação de esquema
firebase.json         aponta as regras e os emuladores (Auth 8576, Firestore 8577)
tests/e2e.py          teste de ponta a ponta no WebKit e no Chromium (Playwright)
tests/stub.js         Firebase de mentira usado pelo e2e (módulo ES)
tests/emulador.py     o app com o SDK de verdade contra os emuladores
tests/regras.py       teste das regras no emulador
tests/contraste.py    medição de contraste dos tokens
tests/peca-teste.jpg  fixture neutra do e2e
requirements-dev.txt  dependências dos testes
```

## Licença

MIT: use, modifique e distribua livremente.
