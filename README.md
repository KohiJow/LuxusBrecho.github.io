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

## Por que o texto é montado no navegador

Já foi escrito por um serviço de fora. Num servidor pequeno levava de 30 a 60
segundos por peça, e a opção paga acabava a cota. Quem está na loja com a
cliente esperando não tem esse tempo, e o texto montado no navegador sai na
hora, de graça e sem depender de nada fora do celular. As opções gratuitas e
rápidas exigem um servidor só para guardar a chave com segurança, o que não
compensa para um texto de três linhas.

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
  voltava a crescer, sem parar (até 87 trocas em 1,5 s a 10 px do topo, no
  Chromium; no WebKit não acontecia). Agora a altura não muda: o sticky para 8 px acima da tela e só sombra, borda e o
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
  decodificada; com o modal aberto, as animações de trás param (menos a onda
  do toque que abriu o modal, que antes ficava congelada no botão)
- **Tema escuro abrindo claro**: o `app.js` é módulo e só roda depois de
  baixar o SDK do Firebase. Quem usa o tema escuro via a abertura do login
  inteira no tema claro e a tela escurecendo no meio da animação. Agora o
  `inicio.js`, no `<head>`, põe o tema salvo antes da primeira pintura
- **Login cortado para quem já está logada**: a tela de login começava a
  animar e sumia quando o Firebase confirmava a sessão (1,5 s de login na
  tela, com o SDK de verdade contra o emulador e o CDN atrasado como numa
  rede de celular). Agora o app guarda só a marca `luxus-sessao` no
  `localStorage` ao entrar (e apaga ao sair), e o `inicio.js` esconde o
  login enquanto o Firebase responde. Se ele não responder em 3,5 s, o login
  aparece do mesmo jeito
- **Topo do anúncio atrás do cabeçalho**: o `scrollIntoView` media o cartão
  ainda deslocado pela animação de entrada e rolava demais; o "salvo no
  histórico" e o tique ficavam escondidos atrás do cabeçalho grudado. Agora
  o `app.js` calcula a posição sem o deslocamento e para o cartão logo
  abaixo do cabeçalho, e o `scroll-padding-top` faz o mesmo com o campo que
  recebe foco depois de um erro

Com a CPU 4x mais lenta, o intervalo entre quadros (p95) caiu de 33 para 17 ms
na abertura do login (seis rodadas de cada lado), ao gerar o anúncio, no
histórico, ao rolar e no modal, e de 50 a 67 para 17 ms na troca de tema.

**Reduzir movimento.** Quem liga "Reduzir movimento" no iPhone, ou "Remover
animações" no Android (alguns Android ligam isso junto com a economia de
bateria), vê o app parado de propósito: tudo aparece direto no estado final.
Nesse caso as Configurações mostram um aviso explicando por que nada se mexe.

O WebKit do Playwright não é o Safari do iPhone: é o mesmo motor, numa versão
recente, rodando em Linux sem GPU. Ele serve para conferir que cada animação
aparece e termina no estado certo (os testes congelam a animação no meio e
olham a tela), não para medir fluidez; a fluidez foi medida no Chromium. No
WebKit sem GPU, o app logado pinta menos de 1 quadro por segundo enquanto as três
animações que nunca param (o brilho do título, o brilho do botão principal e
o pulso das bolinhas) estão rodando, e perto de 60 sem elas; isso ainda não
foi conferido num iPhone de verdade (Safari, Web Inspector, aba Layers). Os
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
- "Reenviar", nas peças disponíveis, abre de novo a folha de compartilhar com
  o texto salvo e a foto grande, buscada no banco só nessa hora
- A mensagem do link é curta e sem emoji de propósito: cada emoji vira 12
  caracteres no link e o post do grupo fica poluído
- Status por peça: disponível, reservada, vendida, com cancelamento a qualquer
  momento. A tela muda na hora e volta atrás se o banco recusar
- Ao confirmar uma venda, abre uma mensagem com o resumo para acerto de comissão
- Venda feita na loja entra no mesmo histórico e no fechamento do caixa
- Histórico fica salvo e sincronizado por vendedora
- Copiar e compartilhar sempre respondem: "Copiado" em cima do botão,
  "Compartilhado com a foto", "Compartilhamento cancelado" ou "Abrindo o
  WhatsApp com o texto" (no computador, sem folha de compartilhar)
- Nada fica preso em "salvando": sem internet, depois de 10 segundos o
  anúncio passa a "aguardando internet pra salvar", com aviso, e vira "salvo"
  quando a gravação chega (se o app continuar aberto)

## Segurança

O app é estático e fala direto com o Firebase (Authentication por email e
senha, Firestore). Num app assim, a segurança mora em quatro lugares: nas
regras do banco, no que o navegador aceita executar, em como o app trata o
que vem de fora, e no que só o console do projeto controla (a lista de
verificação está no fim desta seção).

### A chave do Firebase é pública, e isso é normal

A `apiKey` que está no `app.js` identifica o projeto, não autentica ninguém.
Ela vai parar no navegador de qualquer pessoa que abra o site, e o Firebase
foi desenhado para isso. O que protege os dados são as regras do Firestore e
a autenticação: sem token de uma conta logada, nenhuma leitura ou escrita
passa. Não trate a chave como segredo, mas também não a confunda com a chave
de uma conta de serviço (essa, sim, nunca pode ir para o repositório).

O que vale fazer com ela é restringir onde e para quê serve, no console do
Google Cloud (passo 1 da lista de verificação): só a partir do site publicado
e só para as APIs que o app usa. Com isso, quem copiar a chave não consegue
usá-la de outro domínio nem em outros serviços do projeto.

### Regras do Firestore (`firestore.rules`)

As regras são publicadas pelo dono do projeto, no Console do Firebase
(Firestore > Regras, colar e publicar) ou com
`firebase deploy --only firestore:rules` usando o `firebase.json` deste
repositório. Publique a versão atual logo depois de o site novo estar no ar:
o app antigo gravava a foto inteira no produto, e as regras de agora recusam
isso (o contrário, site novo com regras antigas, funciona com uma perda só: a
foto grande não é guardada e o "Reenviar" vai com a miniatura). O que cada
bloco protege:

- **Funções de validação**: tipos e tamanhos de cada campo. Texto curto,
  preço entre 0 e 99999, listas conferidas item a item, status e tipo em lista
  fechada, `ts` inteiro e no máximo um dia à frente do servidor. Os limites
  acompanham os do app (`LIMITE` em `app.js` e os `maxlength` do `index.html`)
- **`products`**: só a dona (`brecoOwner` igual ao uid logado) lê, e a consulta
  do app filtra por ela, então a leitura em lista passa. Criar exige
  exatamente os campos que o app grava, dono igual ao uid, email igual ao do
  token, `cashoutSent` falso e `soldAt` coerente com o status (vendido tem
  hora, o resto não). No campo `foto64` cabe só a miniatura (JPEG em base64
  de até 16 KB) ou nada. Depois de criado, só `status`, `soldAt` e
  `cashoutSent` mudam; dono, preço, foto e código são imutáveis. Apagar, só
  venda na loja, que é o único "remover" que o app oferece
- **`products/{id}/fotos/principal`**: a foto grande do anúncio (JPEG em
  base64 de até 300 KB), num documento só dela. Nasce uma vez, com o id fixo
  `principal`, debaixo de um produto que já existe e é da mesma vendedora
  (a regra lê o produto para conferir), e só a dona lê. Não se altera, não
  se apaga, e consulta de grupo em `fotos` é recusada
- **`events`** e **`sales`**: registro de mudança de status e de venda, com
  `by` e `sellerId` iguais ao uid. Nascem e ficam: ninguém altera nem apaga
- **Resto do banco**: fechado para leitura e escrita

A consulta do histórico usa só o filtro pela dona e ordena no navegador. Antes
havia um `orderBy` junto com o `where`, que exige índice composto no Firestore
e, sem ele, fazia o histórico sumir em silêncio. Se a consulta falhar por
qualquer motivo, o histórico mostra o erro e um botão de tentar de novo.

As regras são testadas no emulador por `tests/regras.py` (veja Testes): o que
o app faz tem que passar, e o que um invasor tentaria tem que ser recusado.

### Fotos: miniatura no produto, foto grande à parte

Antes a foto inteira (640px, até 700 KB em base64) ia dentro do documento do
produto, e o histórico baixava todas de uma vez. Agora o app grava duas
versões da mesma foto, as duas reencodadas no navegador (o arquivo original
nunca sobe): a miniatura de 128px no lado maior (no campo `foto64` do
produto, que a lista usa; limite de 16 KB em base64) e a foto de 640px
(limite de 300 KB, antes eram 700) em `products/{id}/fotos/principal`,
gravada logo depois de o produto nascer. Com a fixture dos testes a
miniatura dá 2 KB e a foto grande 8 KB nos dois motores. Se uma foto cheia
de detalhe passar do limite, o app reencoda mais comprimida até caber. A
foto grande só é lida quando a vendedora toca em "Reenviar" (uma leitura, só
daquela peça); o anúncio recém-gerado compartilha a foto que já está na
memória. Anúncios antigos, com a foto inteira no produto, continuam
funcionando: a lista mostra o que está em `foto64` e o "Reenviar" usa essa
foto quando não há documento próprio. Sem o Firebase Storage de propósito:
ele exige configuração no console, e o histórico de uma loja cabe assim.

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
- **Integridade do SDK (SRI)**: os três módulos entram no `<head>` por
  `<script type="module">` com `integrity` (hash sha384 de cada arquivo
  exato) e `crossorigin="anonymous"`; o `import` do `app.js` reaproveita o
  módulo já verificado, porque é a mesma URL. Se o CDN (ou alguém no caminho)
  entregar outro conteúdo, o navegador bloqueia e o app não roda; a tela de
  login continua visível, sem erro de JavaScript solto. Foi tag de script, e
  não `<link rel="modulepreload">`, porque o WebKit (motor do Safari) ignora
  o `integrity` do modulepreload: na sondagem feita nos dois motores, com o
  modulepreload e o hash errado o app rodou no WebKit; com a tag de script e
  com import map, os dois motores bloquearam. O `tests/e2e.py` prova o
  bloqueio em cada motor servindo um módulo com hash diferente, e o
  `tests/emulador.py` carrega o SDK de verdade com os hashes do `index.html`.
  Ao trocar a versão do SDK, recalcule:
  `openssl dgst -sha384 -binary arquivo.js | openssl base64 -A`. As fontes do
  Google Fonts não têm SRI porque o CSS delas muda por navegador
- **App Check (reCAPTCHA v3)**, atrás de configuração: com `APP_CHECK.siteKey`
  vazia em `app.js` (o padrão) nada é baixado nem chamado. Com a chave, o
  módulo `firebase-app-check.js` entra do mesmo jeito que os outros (tag de
  script com `integrity`, hash já no código) e o App Check é montado antes do
  primeiro pedido ao Auth e ao Firestore; se o módulo não vier em 4 s ou for
  bloqueado, o app segue sem ele. Com o App Check imposto no Firestore, só
  pedidos vindos do site de verdade passam, mesmo com a `apiKey` copiada.
  Como ligar está na lista de verificação (passo 3)
- **Content-Security-Policy** no `<meta>` do `index.html`: script só do
  próprio site e da pasta do Firebase no CDN (`www.gstatic.com/firebasejs/`),
  estilo só do próprio site e do Google Fonts, imagem só do próprio site e em
  `data:`, conexões só com Authentication e Firestore (o app não usa Realtime
  Database, então `firebaseio.com` não entra), nenhum iframe nem worker
  (`frame-src 'none'`, `worker-src 'none'`), nada de `object`, `base` ou
  envio de formulário para fora. Não há `'unsafe-inline'` nem para script nem
  para estilo: nenhum botão usa `onclick`, cada um declara `data-action` e o
  `app.js` trata o clique por delegação, e o HTML não tem `style=` (os
  atrasos das folhas do fundo viraram regras por posição no CSS; esconder e
  mostrar usa o atributo `hidden`). O `tests/e2e.py` e o `tests/emulador.py`
  vigiam o console nos dois motores e falham em qualquer "Refused to". A
  única exceção é uma recusa de folha de estilo que o próprio Playwright
  provoca no WebKit ao tirar captura de tela (acontece igual numa página
  vazia com a mesma política), ignorada só durante a captura. O que o App
  Check precisa somar à política quando for ligado está num comentário logo
  acima do `<meta>`
- `frame-ancestors` (contra clickjacking) só funciona em cabeçalho HTTP, que o
  GitHub Pages não deixa configurar, por isso não está no `<meta>`: lá ele
  seria ignorado e só geraria aviso no console
- Se um dia entrar login com Google ou outro provedor por popup, o Auth vai
  precisar do `browserPopupRedirectResolver` no `initializeAuth`, e a CSP, de
  `frame-src https://brechobase.firebaseapp.com` e de
  `script-src https://apis.google.com`
- **Referrer policy** `strict-origin-when-cross-origin`, e todo `window.open`
  para o WhatsApp vai com `noopener,noreferrer`. Não há service worker: nada
  fica em cache por conta do app, e cada abertura busca o site atual
- **Nada pessoal na URL**: o app não põe email, nome nem código na própria
  URL (o único parâmetro que ele lê, `?emulador=`, só funciona em
  `localhost`). Os links `wa.me` levam o telefone da loja e o texto do
  anúncio, que é o que a vendedora quer mandar

### O que vem de fora

- Tudo que o histórico desenha a partir do banco passa por um template que
  escapa cada valor (`html` e `esc` em `app.js`): nome da loja, categoria,
  código, estado e preço viram texto, nunca marcação. A miniatura só aceita
  `data:image/...` em base64; qualquer outra coisa no campo da foto vira o
  emoji da categoria. A foto grande lida do documento próprio passa pela
  mesma conferência antes de virar arquivo
- Login: erro de credencial vira sempre "Email ou senha incorretos", sem
  distinguir conta inexistente de senha errada. "Esqueci minha senha" responde
  a mesma frase para email com e sem conta. Do lado do Firebase, a proteção
  contra enumeração de email (passo 2 da lista) faz o servidor responder
  igual nos dois casos, inclusive no pedido de troca de senha; o app já está
  pronto para as duas respostas. Os campos têm `autocomplete` de email e
  `current-password` para o gerenciador de senhas do celular
- No navegador ficam só as configurações da loja (telefone, nome, WhatsApp
  da vendedora), o tema e a marca de sessão aberta (o valor `1`, nada da
  conta), em `localStorage`. Nada vai para o console
- **Sair limpa tudo da conta neste aparelho**: histórico em memória e na
  tela, email no cabeçalho, busca, formulário, campos e `localStorage` das
  configurações (que têm o WhatsApp da vendedora), marca de sessão e a
  sessão do Firebase. Fica só o tema. Outra vendedora que entrar no mesmo
  celular começa do zero, e o mesmo acontece se a sessão deixar de valer

### Lista de verificação do console

O que só o dono do projeto faz, com os cliques. Nada disso muda o código.

1. **Restringir a chave do Firebase.** Google Cloud Console
   (console.cloud.google.com) > projeto `brechobase` > APIs e serviços >
   Credenciais > a chave "Browser key (auto created by Firebase)" > Editar.
   Em "Restrições de aplicativo", marque "Sites" e adicione
   `https://kohijow.github.io/*`. Em "Restrições de API", marque "Restringir
   chave" e deixe só: Identity Toolkit API, Token Service API, Cloud Firestore
   API (e Firebase App Check API, se o passo 3 for feito). Salvar. Leva uns
   minutos para valer; depois, abra o site e entre: se o login falhar com
   "erro inesperado", confira se o endereço do site está igual ao da lista.
   Para rodar o app local contra o projeto real (não é o caso dos testes, que
   usam os emuladores), seria preciso somar `http://localhost:8000/*`
2. **Proteção contra enumeração de email.** Console do Firebase > Authentication
   > Settings (Configurações) > "User actions" (Ações do usuário) > marcar
   "Email enumeration protection" (Proteção contra enumeração de e-mails) >
   Save. A partir daí o servidor devolve `auth/invalid-credential` tanto para
   conta inexistente quanto para senha errada, e "Esqueci minha senha" não
   conta se o email tem conta; o app já mostra a mesma frase nos dois casos
3. **App Check com reCAPTCHA v3**, opcional, em quatro partes:
   (a) Console do Firebase > App Check > Apps > o app web `Luxus` > Registrar >
   provedor "reCAPTCHA v3"; o console abre o painel do reCAPTCHA
   (google.com/recaptcha/admin) para criar um site do tipo v3 com o domínio
   `kohijow.github.io`; copie a **chave do site** (a secreta fica no console
   do Firebase, nunca no código).
   (b) No `app.js`, cole a chave em `APP_CHECK.siteKey`.
   (c) No `index.html`, some à CSP o que o comentário acima do `<meta>` lista
   (os domínios do reCAPTCHA em `script-src` e `frame-src`, e
   `firebaseappcheck.googleapis.com` em `connect-src`).
   (d) Publique, abra o site, confira no console do navegador que não há
   "Refused to" e, no Firebase, em App Check > APIs > Cloud Firestore, veja
   as métricas por uns dias e só então clique em "Impor" (Enforce). O
   Authentication só aceita App Check com o Firebase Authentication with
   Identity Platform (upgrade gratuito no console); sem isso, deixe o Auth
   sem imposição. O reCAPTCHA mostra um selo no canto da página; ele pode ser
   escondido por CSS desde que o texto de atribuição do reCAPTCHA apareça
   em algum lugar visível
4. **Publicar as regras** (`firestore.rules`) sempre que o arquivo mudar:
   Firestore > Regras > colar > Publicar, logo depois de o site estar no ar
5. **Domínios autorizados do Authentication**: Authentication > Settings >
   Authorized domains deve ter só `kohijow.github.io` e o `localhost` (o
   `brechobase.firebaseapp.com` e `web.app` podem sair se nunca forem usados)

### O que fica em aberto

- `frame-ancestors` depende de cabeçalho HTTP, como dito acima
- Não há limite de tentativas próprio: o que existe é o do Firebase
  Authentication (`auth/too-many-requests`), que o app mostra
- O App Check protege o Firestore; o Authentication só com o Identity
  Platform (passo 3). O selo do reCAPTCHA no canto da página ainda não foi
  acomodado no visual, porque o App Check ainda não foi ligado
- O SRI cobre o SDK; o CSS do Google Fonts fica sem, porque varia por
  navegador. A alternativa é servir as fontes do próprio site

## Testes

Tudo roda local, sem conta no Firebase e sem tocar o projeto real.

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
python -m playwright install chromium webkit

python tests/contraste.py     # pares texto/fundo dos dois temas, direto do style.css
python tests/e2e.py           # fluxo inteiro no WebKit (iPhone 13) e no Chromium (Pixel 7), com Firebase de mentira
```

Onde o WebKit do Playwright não instala direto (distribuições Linux fora da
lista dele), o contêiner oficial resolve; o pacote Python precisa ser
instalado dentro dele:
`podman run --rm --network host -v "$PWD":/w:Z -w /w --ipc=host mcr.microsoft.com/playwright/python:v1.60.0-noble sh -c "pip install -r requirements-dev.txt && python tests/e2e.py --motor webkit"`.

`tests/e2e.py` sobe um servidor estático na raiz do repositório, troca os três
módulos do SDK do Firebase por `tests/stub.js` (que anota o que o app tentou
gravar, ler e abrir) e serve o `index.html` com o hash do stub no lugar dos
hashes do SDK, para o SRI passar. Percorre, em cada motor: login com erro e
"esqueci minha senha", esqueleto e estado vazio, consulta recusada com "tentar
de novo", dados maliciosos vindos do banco, miniaturas em retrato (480x900) e
paisagem (900x480), "Reenviar" lendo a foto grande do documento próprio (e a
do produto num anúncio antigo), busca e reserva sem refazer a lista e sem
perder o foco, etiquetas pelo teclado, anúncio com foto (miniatura de 128px
no produto, foto grande no documento próprio), copiar e compartilhar com
feedback (com a folha do celular, cancelado, e sem folha), busca por código,
reservar e confirmar venda (conferindo o que foi gravado e para onde o alerta
foi), venda na loja com Esc e foco de volta, fechamento de caixa, remoção,
tema pelo botão (com e sem View Transitions), sair sem deixar nada da conta.
As animações são congeladas no meio pela Web Animations API para conferir que
aparecem (o título se escrevendo, a foto revelando, o confete espalhado) e
soltas para conferir o estado final; o cabeçalho não pode tremer perto do
topo, a folha do modal não pode abrir vão, e o cartão do anúncio anima e solta
confete uma vez só mesmo com o banco demorando e para abaixo do cabeçalho,
com o topo à vista. Com o SDK preso de propósito (como na rede de celular),
confere o que o `inicio.js` resolve antes de o `app.js` rodar: tema escuro
desde o primeiro quadro, login escondido para quem já está logada, login de
volta quando a sessão não vale mais ou o Firebase não responde. Com a gravação
presa (sem internet), confere que o "salvando" vira "aguardando internet" em
10 s e "salvo" quando a gravação chega. Serve a página original (com os
hashes do SDK de verdade) e um módulo diferente para provar que o navegador
bloqueia e o app não roda; serve o `app.js` com uma chave de App Check para
conferir que o módulo entra com `integrity` e é montado antes do login, e
com o hash errado para conferir que é bloqueado sem derrubar o app. No
login, nenhuma polaroid do fundo pode cobrir o título nem as frases, no
Pixel 7, no iPhone 13, no iPhone SE e em 360 e 430px. Repete as telas com
"reduzir movimento". Falha com qualquer erro de JavaScript ou violação de
CSP no console. As capturas de tela ficam em `tests/saida/<motor>` (fora do
git). A fixture `tests/peca-teste.jpg` é uma imagem neutra, não uma foto da
loja; as fotos em retrato e paisagem são geradas na hora.

As regras do Firestore precisam do emulador (Java 21 e a CLI do Firebase, sem
login; o projeto `demo-luxus` é só local):

```bash
npm install -g firebase-tools
firebase emulators:exec --only firestore --project demo-luxus "python3 tests/regras.py"
firebase emulators:exec --only auth,firestore --project demo-luxus "python3 tests/emulador.py"
```

`tests/emulador.py` abre o app com o SDK de verdade (os módulos do CDN,
conferidos pelos hashes do `index.html`) no modo de teste, que liga os
emuladores de Auth e Firestore e só existe com a página servida de
`127.0.0.1` ou `localhost` e `?emulador=PORTA_AUTH,PORTA_FIRESTORE` na URL; no
site publicado esse código não faz nada. No modo de teste o projeto é o
`demo-luxus` e o Firestore vai por long polling (o streaming do emulador
falha no WebKit do teste); em produção fica o padrão do SDK. Em cada motor
ele confere: conta inexistente e senha errada com a mesma mensagem,
recuperação de senha com e sem conta (o emulador gera o link só para quem
tem conta), login, anúncio gravado em `products` com a miniatura e a foto
grande em `products/{id}/fotos/principal`, reserva e venda em `events` e
`sales`, venda na loja, fechamento de caixa e remoção, um anúncio no formato
antigo posto direto no emulador, a sessão continuando depois de recarregar,
"Reenviar" lendo a foto grande do documento próprio e a do produto antigo,
sair apagando configurações, email e histórico da tela, e outra vendedora que
entra e não vê nada da primeira. Tudo passa pelas regras do
`firestore.rules`, e qualquer pedido para fora do servidor local, dos
emuladores, das fontes e do CDN do SDK derruba o teste.

`tests/regras.py` fala com a API REST do emulador usando tokens sem
assinatura, o mesmo mecanismo da biblioteca oficial de teste de regras, e
cobre 102 casos: cada escrita que o app faz, e para cada campo uma tentativa
de burlar (dono diferente, campo a mais, tipo errado, tamanho acima, foto que
não é imagem, miniatura acima de 16 KB, foto inteira no produto como no
formato antigo, status fora da lista, alteração de campo imutável, leitura dos
dados de outra vendedora, consulta sem filtro), e a foto grande: só sob o
próprio produto, só com o id `principal`, até 300 KB, sem alterar, sem
apagar, sem consulta de grupo.

`tests/site.py` abre o site publicado nos dois motores, sem login e sem
digitar nada: a tela de login aparece, os três módulos do SDK vêm do CDN e
passam no SRI (o `app.js` só roda se passarem), a CSP e a referrer policy
publicadas são as esperadas, não há service worker, e o console fica sem erro
e sem "Refused to". É o que se roda depois de cada deploy:

```bash
python tests/site.py                 # chromium e webkit; --url para outro endereço
```

O GitHub Actions (`.github/workflows/testes.yml`) roda tudo a cada push:
contraste e ponta a ponta nos dois motores, o SDK de verdade contra os
emuladores nos dois motores, e as regras. O `tests/site.py` fica de fora
porque depende de o deploy do GitHub Pages já ter terminado.

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
index.html            telas e formulário; CSP e SRI do SDK no <head>
inicio.js             roda no <head>, antes da primeira pintura: tema salvo e
                      login escondido para quem já está logada
app.js                módulo ES com o SDK modular do Firebase; lógica em um
                      escopo só, em 13 seções: login, config, banco, tema e
                      abas, foto, etiquetas, texto do anúncio, gerar e
                      compartilhar, histórico, venda na loja, eventos
style.css             visual editorial, temas dia e noite, animações, foco
efeitos.js            enfeites que precisam de JavaScript (confete, contagem,
                      onda no toque, círculo na troca de tema); expõe
                      window.efeitos, que o app usa se existir
firestore.rules       regras do banco com validação de esquema; foto grande
                      em products/{id}/fotos/principal
firebase.json         aponta as regras e os emuladores (Auth 8576, Firestore 8577)
tests/e2e.py          teste de ponta a ponta no WebKit e no Chromium (Playwright)
tests/stub.js         Firebase de mentira usado pelo e2e (módulo ES)
tests/emulador.py     o app com o SDK de verdade contra os emuladores
tests/regras.py       teste das regras no emulador
tests/site.py         o site publicado nos dois motores, sem login
tests/contraste.py    medição de contraste dos tokens
tests/peca-teste.jpg  fixture neutra do e2e
requirements-dev.txt  dependências dos testes
```

## Licença

MIT: use, modifique e distribua livremente.
