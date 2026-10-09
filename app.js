/* Luxus Brechó: a vendedora tira a foto, o app monta o anúncio pro grupo de
   WhatsApp e guarda o histórico por vendedora no Firestore.

   Como este arquivo está organizado:
     1. Firebase e estado
     2. Utilidades: DOM, HTML seguro, avisos
     3. Login
     4. Configurações da loja
     5. Banco: produtos, eventos e vendas
     6. Tema e abas
     7. Foto
     8. Etiquetas de categoria e estado
     9. Texto do anúncio
    10. Gerar, copiar e compartilhar
    11. Histórico e status das peças
    12. Venda na loja e fechamento de caixa
    13. Ligação dos eventos e início

   Nada fica em window: cada botão declara data-action e o clique chega aqui
   por delegação (seção 13). É isso que permite a CSP do index.html proibir
   script inline. Os enfeites (efeitos.js) entram por window.efeitos, e o app
   funciona igual sem eles.

   Este arquivo é um módulo ES e usa o SDK modular do Firebase direto do CDN.
   O SDK compat (firebase.auth()) prepara o login por popup e redirecionamento
   assim que inicia, e no celular isso carrega https://apis.google.com/js/api.js,
   que a CSP bloqueia. O app só entra por email e senha, então o Auth é montado
   com initializeAuth sem o resolvedor de popup: nada de apis.google.com. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, connectAuthEmulator,
  onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore, initializeFirestore, connectFirestoreEmulator, collection, query, where, getDocs, addDoc, doc, updateDoc, deleteDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

(function () {
  'use strict';

  /* ── 1. Firebase e estado ─────────────────────────────────────────── */

  // A apiKey do Firebase identifica o projeto, não autentica ninguém: ela é
  // pública por desenho em app web. Quem protege os dados são as regras do
  // Firestore (firestore.rules), que só deixam cada vendedora ver o que é dela.
  const firebaseConfig = {
    apiKey: "AIzaSyDF-X_HOomeNKoQtOmIN-c9dtTpRyhAmBY",
    authDomain: "brechobase.firebaseapp.com",
    projectId: "brechobase",
    storageBucket: "brechobase.firebasestorage.app",
    messagingSenderId: "1093839654425",
    appId: "1:1093839654425:web:d502e779a0a574b4c4a488"
  };

  // Modo de teste com os emuladores do Firebase (tests/emulador.py). Só liga
  // com as duas condições juntas: a página servida de 127.0.0.1 ou localhost
  // E ?emulador=PORTA_DO_AUTH,PORTA_DO_FIRESTORE na URL. No site publicado o
  // endereço é github.io, então isto devolve null e o app fala só com o
  // projeto real. No modo de teste o projeto é um "demo-", que não existe no
  // Google: se algum pedido escapasse do emulador, não acharia dado nenhum.
  function portasDoEmulador() {
    const local = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
    if (!local) return null;
    const m = /^(\d{2,5}),(\d{2,5})$/.exec(new URLSearchParams(location.search).get('emulador') || '');
    return m ? { auth: Number(m[1]), firestore: Number(m[2]) } : null;
  }
  const emulador = portasDoEmulador();

  const app = initializeApp(emulador
    ? { apiKey: 'chave-de-teste', authDomain: location.hostname, projectId: 'demo-luxus' }
    : firebaseConfig);
  // IndexedDB primeiro, como no SDK compat: quem já estava logada continua
  // logada depois da troca de SDK, sem precisar entrar de novo.
  const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  // No emulador o Firestore vai por long polling: o canal em streaming dele
  // falha no WebKit do teste ("access control checks") e as gravações
  // atrasavam. Em produção fica o transporte padrão do SDK.
  const db = emulador ? initializeFirestore(app, { experimentalForceLongPolling: true }) : getFirestore(app);
  if (emulador) {
    connectAuthEmulator(auth, 'http://' + location.hostname + ':' + emulador.auth, { disableWarnings: true });
    connectFirestoreEmulator(db, location.hostname, emulador.firestore);
  }

  const CFG_KEY = 'brecho_cfg_v2';
  const TEMA_KEY = 'luxus-tema';
  const DISPONIVEL = 'available', RESERVADO = 'reserved', VENDIDO = 'sold';
  const STATUS_VALIDOS = [DISPONIVEL, RESERVADO, VENDIDO];
  const COMISSAO_PERCENTUAL = 15;
  // os mesmos limites estão nas regras do Firestore: mudou aqui, muda lá
  const LIMITE = { nome: 60, tam: 20, obs: 200, descLoja: 120, preco: 99999 };

  let uid = null, emailLogado = '';
  let produtos = [];
  let bancoPronto = false, erroBanco = '';
  let foto64 = null;
  let mensagem = '';
  let filtroHist = '';
  let temaEscuro = false, configAberta = false, abaAtual = 'anuncio';
  let quemAbriuModal = null;

  /* ── 2. Utilidades: DOM, HTML seguro, avisos ──────────────────────── */

  const $ = id => document.getElementById(id);
  const valor = id => ($(id).value || '').trim();
  const formatarPreco = n => n.toFixed(2).replace('.', ',');
  const efeitos = () => window.efeitos || {};

  // Tudo que vai pra innerHTML passa por aqui. O template `html` escapa cada
  // valor interpolado; só o que vier de outro `html` (ou de `raw`) entra como
  // marcação. Assim nome da loja, categoria, código etc. viram texto, nunca tag.
  class Html { constructor(s) { this.s = s; } toString() { return this.s; } }
  const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(v) {
    if (v instanceof Html) return v.s;
    if (v == null) return '';
    if (Array.isArray(v)) return v.map(esc).join('');
    return String(v).replace(/[&<>"']/g, c => ESCAPE[c]);
  }
  function html(partes, ...valores) {
    let s = partes[0];
    for (let i = 0; i < valores.length; i++) s += esc(valores[i]) + partes[i + 1];
    return new Html(s);
  }
  const raw = s => new Html(s);

  // Só uma data URL de imagem serve de src; qualquer outra coisa no banco é lixo
  const fotoValida = s => typeof s === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s);

  let toastTimer = null;
  function toast(texto, ms = 2600) {
    const t = $('toast');
    t.textContent = texto;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), ms);
  }
  function mostrarErro(texto) { const e = $('errBar'); e.textContent = texto; e.classList.add('on'); }
  function esconderErro() { $('errBar').classList.remove('on'); }

  function textoDoErro(e) {
    const c = e && e.code;
    if (c === 'permission-denied' || c === 'unauthenticated') return 'sem permissão (saia e entre de novo)';
    if (c === 'unavailable' || c === 'deadline-exceeded') return 'sem conexão com o banco';
    if (c === 'failed-precondition') return 'o banco pediu uma configuração que falta';
    return c ? 'erro ' + c : 'erro inesperado';
  }

  // Sem internet o Firestore deixa a promessa pendurada até a conexão voltar.
  // O aviso evita a vendedora achar que salvou quando ainda não salvou.
  function avisarSeDemorar(promessa, texto, ms = 10000) {
    let avisou = false;
    const timer = setTimeout(() => { avisou = true; toast(texto, 5000); }, ms);
    return promessa.finally(() => {
      clearTimeout(timer);
      if (avisou) toast('Pronto, sincronizou com o banco.');
    });
  }

  /* ── 3. Login ─────────────────────────────────────────────────────── */

  // Marca de sessão aberta, lida pelo inicio.js na próxima abertura para não
  // mostrar o login a quem já está logada. Só diz "tem sessão", nada da conta.
  const SESSAO_KEY = 'luxus-sessao';
  function marcarSessao(aberta) {
    try {
      if (aberta) localStorage.setItem(SESSAO_KEY, '1');
      else localStorage.removeItem(SESSAO_KEY);
    } catch (e) { /* sem storage, o login só aparece por um instante */ }
    document.documentElement.classList.remove('retomando');
  }

  onAuthStateChanged(auth, user => {
    marcarSessao(!!user);
    if (user) {
      uid = user.uid;
      emailLogado = user.email || '';
      $('loggedEmail').textContent = emailLogado;
      mostrarTela(true);
      carregarConfigSalva();
      carregarProdutos();
    } else {
      uid = null;
      emailLogado = '';
      produtos = [];
      bancoPronto = false;
      erroBanco = '';
      // quem sai pelas configurações não deve encontrá-las abertas na próxima entrada
      alternarConfig(false);
      mudarAba('anuncio');
      mostrarTela(false);
    }
  });

  function mostrarTela(logado) {
    $('loginScreen').hidden = logado;
    $('appWrapper').hidden = !logado;
  }

  // Erro de credencial vira sempre a mesma frase: a tela não conta se o email
  // existe ou se só a senha está errada. Os outros casos têm resposta própria
  // porque pedem outra atitude da vendedora.
  const MSG_LOGIN = {
    'auth/too-many-requests': 'Muitas tentativas. Espere um pouco e tente de novo.',
    'auth/network-request-failed': 'Sem conexão. Confira a internet e tente de novo.',
    'auth/invalid-email': 'Esse email não parece válido.'
  };

  function avisoLogin(texto, tipo) {
    $('loginErr').textContent = tipo === 'erro' ? texto : '';
    $('loginMsg').textContent = tipo === 'ok' ? texto : '';
  }

  async function entrar() {
    const email = valor('loginEmail');
    const senha = $('loginSenha').value || '';
    avisoLogin('');
    if (!email || !senha) { avisoLogin('Preencha email e senha.', 'erro'); return; }
    const btn = $('btnLogin');
    btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      await signInWithEmailAndPassword(auth, email, senha);
      $('loginSenha').value = '';
    } catch (e) {
      avisoLogin(MSG_LOGIN[e && e.code] || 'Email ou senha incorretos.', 'erro');
    } finally {
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  }

  async function esqueciSenha() {
    const email = valor('loginEmail');
    avisoLogin('');
    if (!email) {
      avisoLogin('Digite seu email ali em cima e toque de novo em "Esqueci minha senha".', 'erro');
      $('loginEmail').focus();
      return;
    }
    const btn = $('btnEsqueci');
    btn.disabled = true;
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (e) {
      const c = e && e.code;
      // email sem conta recebe a mesma resposta do email com conta
      if (c !== 'auth/user-not-found') {
        avisoLogin(MSG_LOGIN[c] || 'Não deu pra enviar o email agora. Tente de novo.', 'erro');
        btn.disabled = false;
        return;
      }
    }
    btn.disabled = false;
    avisoLogin('Se esse email tiver conta, o link pra criar uma senha nova chega em instantes. Olhe também o spam.', 'ok');
  }

  function sair() {
    novoAnuncio();
    $('loginSenha').value = '';
    signOut(auth).catch(() => toast('Não deu pra sair agora. Tente de novo.'));
  }

  /* ── 4. Configurações da loja ─────────────────────────────────────── */

  const CAMPOS_CFG = ['telefone', 'brecoNome', 'seuNome', 'meuTel'];

  function carregarConfigSalva() {
    try {
      const cfg = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
      CAMPOS_CFG.forEach(id => { if (typeof cfg[id] === 'string') $(id).value = cfg[id]; });
    } catch (e) { /* config corrompida: a vendedora preenche de novo */ }
  }

  function salvarConfig() {
    const cfg = {};
    CAMPOS_CFG.forEach(id => { cfg[id] = valor(id); });
    try {
      localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
      toast('✅ Configurações salvas!');
      setTimeout(() => { if (configAberta) alternarConfig(false); }, 800);
    } catch (e) { toast('Erro ao salvar.'); }
  }

  function alternarConfig(abrir) {
    configAberta = typeof abrir === 'boolean' ? abrir : !configAberta;
    $('cfgCard').hidden = !configAberta;
    $('btnConfig').setAttribute('aria-expanded', configAberta ? 'true' : 'false');
  }

  /* ── 5. Banco: produtos, eventos e vendas ─────────────────────────── */

  const col = nome => collection(db, nome);

  // Só o filtro pela dona, sem orderBy: assim não depende de índice composto
  // (sem o índice a consulta falharia e o histórico sumiria sem aviso). A
  // ordenação é feita aqui. Se a consulta falhar, o histórico mostra o motivo.
  async function carregarProdutos() {
    bancoPronto = false; erroBanco = '';
    if (abaAtual === 'historico') renderizarHistorico();
    try {
      const snap = await getDocs(query(col('products'), where('brecoOwner', '==', uid)));
      produtos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      produtos.sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
    } catch (e) {
      produtos = [];
      erroBanco = textoDoErro(e);
      toast('Não deu pra carregar o histórico.', 4000);
    }
    bancoPronto = true;
    atualizarBadge();
    if (abaAtual === 'historico') renderizarHistorico(true);
  }

  // O produto entra na lista antes de ir pro banco (id nulo até salvar), pra
  // tela responder na hora mesmo com internet ruim.
  async function salvarProduto(produto) {
    const dados = { ...produto };
    delete dados.id;
    const ref = await addDoc(col('products'), dados);
    produto.id = ref.id;
  }

  const produtoRef = id => doc(db, 'products', id);

  function registrarEvento(evento) {
    addDoc(col('events'), evento).catch(() => toast('O registro da mudança não foi salvo.', 3000));
  }

  function registrarVenda(venda) {
    addDoc(col('sales'), venda).catch(() => toast('O registro da venda não foi salvo.', 3000));
  }

  /* ── 6. Tema e abas ───────────────────────────────────────────────── */

  function aplicarTema(escuro) {
    temaEscuro = escuro;
    if (escuro) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', escuro ? '#17110F' : '#F3EFE7');
    try { localStorage.setItem(TEMA_KEY, escuro ? 'escuro' : 'claro'); } catch (e) { /* sem storage, o tema só não fica salvo */ }
    // os ícones são <svg>: o atributo hidden precisa ir pelo DOM, porque a
    // propriedade .hidden só existe em elemento HTML e no SVG não faz nada
    $('iconeLua').toggleAttribute('hidden', escuro);
    $('iconeSol').toggleAttribute('hidden', !escuro);
    $('btnTheme').setAttribute('aria-label', escuro ? 'Mudar para o tema claro' : 'Mudar para o tema escuro');
  }

  function trocarTema() {
    const troca = () => aplicarTema(!temaEscuro);
    // efeitos.js abre o tema novo num círculo; sem ele, troca direto
    if (typeof efeitos().trocarTema === 'function') efeitos().trocarTema(troca);
    else troca();
  }

  function mudarAba(aba) {
    if (aba !== 'anuncio' && aba !== 'historico') return;
    abaAtual = aba;
    const anuncio = aba === 'anuncio';
    $('pageAnuncio').hidden = !anuncio;
    $('pageHistorico').hidden = anuncio;
    $('tabAnuncio').classList.toggle('active', anuncio);
    $('tabHistorico').classList.toggle('active', !anuncio);
    $('tabAnuncio').setAttribute('aria-selected', anuncio ? 'true' : 'false');
    $('tabHistorico').setAttribute('aria-selected', anuncio ? 'false' : 'true');
    // só a aba ativa entra no Tab; a outra se alcança pelas setas
    $('tabAnuncio').tabIndex = anuncio ? 0 : -1;
    $('tabHistorico').tabIndex = anuncio ? -1 : 0;
    if (!anuncio) renderizarHistorico(true);
  }

  /* ── 7. Foto ──────────────────────────────────────────────────────── */

  const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  const LADO_MAX = 640;

  function escolherFoto(e) {
    const input = e.target;
    const file = input.files && input.files[0];
    if (!file) return;
    if (!TIPOS_FOTO.includes(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
      mostrarErro('Formato não suportado. Use JPG, PNG ou WebP.'); input.value = ''; return;
    }
    if (file.size > 8 * 1024 * 1024) { mostrarErro('Imagem muito grande. Máximo 8MB.'); input.value = ''; return; }
    const reader = new FileReader();
    reader.onerror = () => { mostrarErro('Não deu pra ler esse arquivo.'); input.value = ''; };
    reader.onload = ev => {
      const img = new Image();
      // HEIC do iPhone chega aqui e o navegador não abre: antes falhava calado
      img.onerror = () => { mostrarErro('Não consegui abrir essa foto. Se for HEIC, converta pra JPG ou tire pela câmera do app.'); input.value = ''; };
      img.onload = () => { usarFoto(reduzir(img)); esconderErro(); };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  function reduzir(img) {
    let w = img.width, h = img.height;
    if (w > LADO_MAX || h > LADO_MAX) {
      if (w > h) { h = Math.round(h * LADO_MAX / w); w = LADO_MAX; }
      else { w = Math.round(w * LADO_MAX / h); h = LADO_MAX; }
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.75);
  }

  async function usarFoto(dataUrl) {
    foto64 = dataUrl;
    const prev = $('preview');
    prev.src = foto64;
    // A polaroid só entra com a foto já decodificada. Sem isso a animação
    // começa com a moldura vazia e a foto pipoca no meio, e no celular simples
    // a decodificação disputa o mesmo quadro com a animação.
    if (prev.decode) await prev.decode().catch(() => {});
    if (foto64 !== dataUrl) return;  // removida ou trocada enquanto decodificava
    prev.hidden = false;
    $('photoBtns').hidden = true;
    $('previewZone').hidden = false;
  }

  function removerFoto() {
    foto64 = null;
    const prev = $('preview');
    prev.hidden = true;
    prev.removeAttribute('src');
    $('photoBtns').hidden = false;
    $('previewZone').hidden = true;
    $('fotoCamera').value = '';
    $('fotoGaleria').value = '';
  }

  // data URL vira Blob sem fetch(): fetch de data: esbarra na CSP (connect-src)
  function dataUrlParaBlob(url) {
    const [cabecalho, b64] = url.split(',');
    const tipo = (cabecalho.match(/^data:([^;]+)/) || [])[1] || 'image/jpeg';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: tipo });
  }

  /* ── 8. Etiquetas de categoria e estado ───────────────────────────── */

  function marcar(tag, ativa) {
    tag.classList.toggle('active', ativa);
    tag.setAttribute('aria-checked', ativa ? 'true' : 'false');
  }
  function alternarEtiqueta(tag) { marcar(tag, !tag.classList.contains('active')); }
  // o grupo de estado funciona como rádio: uma marcada, e só ela entra no Tab
  function marcarUnica(tag, gid) {
    $(gid).querySelectorAll('.tag').forEach(t => { marcar(t, t === tag); t.tabIndex = t === tag ? 0 : -1; });
  }
  function etiquetasAtivas(gid) {
    return Array.from($(gid).querySelectorAll('.tag.active')).map(t => t.textContent.trim());
  }
  const semEmoji = s => s.replace(/^\S+\s/, '');

  function ligarEtiquetas() {
    [['catTags', false], ['stateTags', true]].forEach(([gid, unica]) => {
      const box = $(gid);
      const acionar = tag => unica ? marcarUnica(tag, gid) : alternarEtiqueta(tag);
      box.addEventListener('click', e => {
        const tag = e.target.closest('.tag');
        if (tag) acionar(tag);
      });
      box.addEventListener('keydown', e => {
        const tag = e.target.closest('.tag');
        if (!tag) return;
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); acionar(tag); return; }
        if (!unica) return;
        const passo = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!passo) return;
        e.preventDefault();
        const tags = Array.from(box.querySelectorAll('.tag'));
        const proxima = tags[(tags.indexOf(tag) + passo + tags.length) % tags.length];
        proxima.focus();
        marcarUnica(proxima, gid);
      });
    });
    marcarUnica($('stateTags').querySelector('.tag.active') || $('stateTags').querySelector('.tag'), 'stateTags');
  }

  /* ── 9. Texto do anúncio ──────────────────────────────────────────── */

  // Mensagem que a cliente manda ao clicar no link. Curta e sem emoji de
  // propósito: cada emoji vira 12 caracteres no link e o post do grupo fica
  // poluído. O código vem primeiro porque é por ele que a vendedora acha a
  // peça no histórico; o detalhe ajuda a reconhecer sem nem precisar buscar.
  function montarLink(tel, nome, cats, precoStr, tam, codigo, obs) {
    const t = tel.replace(/\D/g, '').slice(0, 15);
    if (!t) return null;
    const catLabel = cats.length ? semEmoji(cats[0]) : 'Peça';
    let det = (obs || '').trim().replace(/\s*\.+\s*$/, '');
    if (det.length > 40) det = det.slice(0, 40).replace(/\s+\S*$/, '');
    const partes = [catLabel + (det ? ' ' + det : '')];
    if (tam) partes.push('tam ' + tam);
    if (precoStr) partes.push('R$ ' + precoStr);
    const loja = nome ? ' do ' + nome.slice(0, 30) : '';
    const txt = 'Oi! Tenho interesse na peça' + (codigo ? ' ' + codigo : '') + loja + ': ' + partes.join(', ');
    return 'https://wa.me/' + t + '?text=' + encodeURIComponent(txt);
  }

  // Chamada de grupo de promoção: a primeira linha é a que aparece na
  // notificação, então ela precisa fazer a pessoa abrir.
  const GANCHOS = [
    '✨ Achadinho novo na arara!',
    '✨ Garimpo fresquinho pro grupo!',
    '✨ Olha o que acabou de chegar!',
    '✨ Chegou peça nova!',
    '✨ Separei essa pra vocês!',
    '✨ Novidade no brechó!'
  ];

  const POR_CATEGORIA = {
    'Vestido':   ['Vestido que resolve o look sozinho', 'Vestido fácil de usar, é só jogar e sair',
                  'Vestido com caimento bonito', 'Vestido que vai do almoço ao rolê'],
    'Camisa':    ['Camisa coringa, combina com tudo', 'Camisa que serve pro trabalho e pro rolê',
                  'Camisa de tecido gostoso', 'Camisa que não sai de moda'],
    'Blusa':     ['Blusa pra usar o ano todo', 'Blusa confortável do jeito que a gente gosta',
                  'Blusa simples de combinar', 'Blusa que dá um up em qualquer calça'],
    'Calça':     ['Calça com caimento ótimo', 'Calça confortável pro dia inteiro',
                  'Calça que valoriza qualquer look', 'Calça daquelas que viram favorita'],
    'Short':     ['Short leve, perfeito pro calor', 'Short confortável pro dia a dia',
                  'Short fácil de combinar', 'Short pronto pro fim de semana'],
    'Casaco':    ['Casaco quentinho pros dias frios', 'Casaco que fecha o look com estilo',
                  'Casaco confortável e versátil', 'Casaco pra sair bem vestida no frio'],
    'Calçado':   ['Calçado confortável de verdade', 'Calçado que combina com vários looks',
                  'Calçado pronto pra andar muito', 'Calçado que chama atenção do jeito certo'],
    'Bolsa':     ['Bolsa que acompanha o dia inteiro', 'Bolsa com espaço pro que importa',
                  'Bolsa coringa pra qualquer ocasião', 'Bolsa que deixa o look mais arrumado'],
    'Acessório': ['Acessório que dá outro ar no look', 'Acessório pra usar sem pensar muito',
                  'Acessório que faz diferença no detalhe', 'Acessório que vira assunto'],
    // sem categoria marcada: serve pra qualquer coisa, não só roupa
    'Peça':      ['Peça bem cuidada e cheia de estilo', 'Achado que vale cada centavo',
                  'Peça bonita do jeito que a gente gosta de garimpar', 'Achado bom demais pra ficar parado']
  };

  // Frases sem marca de gênero: a mesma lista serve para bolsa e para casaco.
  const POR_ESTADO = {
    'Novo c/ etiqueta': ['Nova, com etiqueta, nunca usada.',
                         'Nunca saiu do cabide: etiqueta ainda na peça.',
                         'Chegou e já vai: nova, com etiqueta.'],
    'Ótimo':            ['Em ótimo estado, sem marcas de uso.',
                         'Sem defeitos e sem sinal de uso.',
                         'Praticamente sem sinal de uso.'],
    'Bom':              ['Em bom estado, com sinais leves de uso que não atrapalham.',
                         'Tem marcas discretas de uso, nada que incomode.',
                         'Em bom estado de uso.']
  };

  const FECHOS = [
    'Peça única: saiu, acabou.',
    'Só tem essa, quem chamar primeiro leva.',
    'Gostou? Chama que eu separo pra você.',
    'É garimpo, então não tem repetida.',
    'Corre que essa não volta pra arara.'
  ];

  function montarDescricao(cats, estado, tam, obs) {
    const cat = cats.length ? semEmoji(cats[0]) : 'Peça';
    const est = estado.length ? semEmoji(estado[0]) : 'Bom';
    const det = (obs || '').trim().replace(/\s*\.+\s*$/, '');

    // Escolha estável: a mesma peça gera sempre o mesmo texto, mas peças
    // diferentes geram textos diferentes. Evita o grupo receber vinte posts
    // começando e terminando igual.
    const chave = (cat + est + tam + det).toLowerCase();
    let h = 0;
    for (let i = 0; i < chave.length; i++) h = (h * 31 + chave.charCodeAt(i)) >>> 0;
    const pega = (lista, desvio) => lista[(h + (desvio || 0)) % lista.length];

    // peça sem categoria pode ser luminária, livro, louça: aí "arara" não cabe
    const semArara = l => cat === 'Peça' ? l.filter(f => !f.includes('arara')) : l;
    const tamTxt = tam ? ', tamanho ' + tam : '';
    const frases = POR_CATEGORIA[cat] || POR_CATEGORIA['Peça'];
    // O detalhe que a vendedora escreveu é a informação mais específica da
    // peça, então ele abre o texto em vez de ficar escondido no meio.
    const corpo = det
      ? det.charAt(0).toUpperCase() + det.slice(1) + tamTxt + '. ' + pega(frases) + '.'
      : pega(frases) + tamTxt + '.';
    const condicao = POR_ESTADO[est] ? pega(POR_ESTADO[est], 1) : est + '.';

    return pega(semArara(GANCHOS), 3) + '\n' + corpo + ' ' + condicao + '\n' + pega(semArara(FECHOS), 2);
  }

  function montarMensagem(nome, emoji, descricao, precoStr, tam, estLabel, codigo, link) {
    return emoji + ' *' + nome + '*\n\n' + descricao + '\n\n💰 *R$ ' + precoStr + '*'
      + (tam ? '\nTamanho: *' + tam + '*' : '')
      + '\n🏷️ ' + estLabel + '\n🔖 Código *' + codigo + '*'
      + '\n\n👉 Clique para reservar:\n' + link;
  }

  // Sem 0/O e 1/I: o código é lido em voz alta e digitado na busca
  const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function novoCodigo() {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => ALFABETO_CODIGO[b % ALFABETO_CODIGO.length]).join('');
  }

  /* ── 10. Gerar, copiar e compartilhar ─────────────────────────────── */

  function gerarAnuncio() {
    esconderErro();
    const tel = valor('telefone');
    const nome = valor('brecoNome').slice(0, LIMITE.nome) || 'Brechó';
    const precoV = $('preco').value;
    const tam = valor('tamanho').slice(0, LIMITE.tam);
    const obs = valor('obs').slice(0, LIMITE.obs);
    const cats = etiquetasAtivas('catTags');
    const estado = etiquetasAtivas('stateTags');
    const preco = parseFloat(precoV);

    if (!precoV || isNaN(preco) || preco < 0 || preco > LIMITE.preco) { mostrarErro('⚠️ Informe um preço válido.'); $('preco').focus(); return; }
    if (!tel) { mostrarErro('⚠️ Configure o telefone da loja nas configurações.'); alternarConfig(true); $('telefone').focus(); return; }

    const precoStr = formatarPreco(preco);
    const codigo = novoCodigo();
    const link = montarLink(tel, nome, cats, precoStr, tam, codigo, obs);
    if (!link) { mostrarErro('⚠️ Telefone inválido. Use apenas números com DDD.'); alternarConfig(true); $('telefone').focus(); return; }

    const estLabel = estado.length ? semEmoji(estado[0]) : '';
    const emoji = cats.length ? cats[0].split(' ')[0] : '📦';
    mensagem = montarMensagem(nome, emoji, montarDescricao(cats, estado, tam, obs), precoStr, tam, estLabel, codigo, link);

    const produto = {
      id: null, ts: Date.now(), emoji, cats, estado, estLabel, tam, obs,
      precoNum: preco, precoStr, link, msg: mensagem,
      foto64: foto64 || null, prodCod: codigo,
      brecoNome: nome, brecoOwner: uid, sellerEmail: emailLogado,
      status: DISPONIVEL, soldAt: null, cashoutSent: false, type: 'online'
    };
    produtos.unshift(produto);
    atualizarBadge();
    mostrarResultado(link, 'salvando');

    avisarSeDemorar(salvarProduto(produto), 'O anúncio ainda não foi salvo no histórico. Confira a internet.')
      .then(() => {
        if (mensagem === produto.msg) mostrarResultado(link, 'salvo');
        if (abaAtual === 'historico') renderizarHistorico();
      })
      .catch(e => {
        produtos = produtos.filter(p => p !== produto);
        atualizarBadge();
        if (mensagem === produto.msg) mostrarResultado(link, 'falhou');
        if (abaAtual === 'historico') renderizarHistorico();
        toast('O anúncio não foi salvo no histórico: ' + textoDoErro(e) + '.', 5000);
      });
  }

  const TEXTO_RESULTADO = {
    salvando: 'Anúncio pronto, salvando no histórico…',
    salvo: 'Anúncio pronto e salvo no histórico',
    falhou: 'Anúncio pronto, mas não foi salvo no histórico'
  };

  function mostrarResultado(link, situacao) {
    // o mesmo anúncio passa aqui duas vezes (salvando e salvo): reescrever o
    // texto igual faria o efeitos.js achar que é anúncio novo e animar de novo
    if ($('msgResult').textContent !== mensagem) $('msgResult').textContent = mensagem;
    $('linkTxt').textContent = link.replace('https://', '');
    $('resultStatus').textContent = TEXTO_RESULTADO[situacao];
    $('resultCard').classList.toggle('falhou', situacao === 'falhou');
    $('txtShareWpp').textContent = foto64 && navigator.canShare ? 'Compartilhar com foto no WhatsApp' : 'Compartilhar no WhatsApp';
    const card = $('resultCard');
    if (!card.classList.contains('visible')) {
      card.classList.add('visible');
      setTimeout(() => rolarAteCartao(card), 80);
    }
  }

  // Traz o cartão para a vista logo abaixo do cabeçalho grudado. Não usa
  // scrollIntoView: ele mede o cartão ainda deslocado pela animação de entrada
  // (uns 26px para baixo), rola demais e o topo do cartão, com o "salvo no
  // histórico", acabava atrás do cabeçalho. offsetTop é a posição sem transform.
  function rolarAteCartao(el) {
    let topo = 0;
    for (let n = el; n; n = n.offsetParent) topo += n.offsetTop;
    const cabecalho = document.querySelector('.header');
    const folga = cabecalho ? cabecalho.offsetHeight : 0;
    const alt = el.offsetHeight, vh = window.innerHeight, y = window.scrollY;
    if (topo - y >= folga && topo + alt - y <= vh) return;   // já está inteiro na tela
    // cabe abaixo do cabeçalho: alinha o pé com o fim da tela; não cabe: o topo logo abaixo dele
    const alvo = alt <= vh - folga ? topo + alt - vh : topo - folga;
    const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: Math.max(0, alvo), behavior: suave ? 'smooth' : 'auto' });
  }

  function copiar() {
    if (!mensagem) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(mensagem).then(() => toast('✅ Copiado!')).catch(copiarPeloTextarea);
    } else {
      copiarPeloTextarea();
    }
  }
  function copiarPeloTextarea() {
    const el = document.createElement('textarea');
    el.value = mensagem;
    el.setAttribute('readonly', '');
    el.className = 'fora-da-tela';
    document.body.appendChild(el);
    el.select();
    try { document.execCommand('copy'); toast('✅ Copiado!'); } catch (e) { toast('Selecione e copie manualmente.'); }
    el.remove();
  }

  async function compartilharWpp() {
    if (!mensagem) return;
    if (foto64 && navigator.share && navigator.canShare) {
      try {
        const arquivo = new File([dataUrlParaBlob(foto64)], 'produto.jpg', { type: 'image/jpeg' });
        const dados = { text: mensagem, files: [arquivo] };
        if (navigator.canShare(dados)) { await navigator.share(dados); toast('📤 Compartilhado!'); return; }
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    if (navigator.share) {
      try { await navigator.share({ text: mensagem }); toast('📤 Compartilhado!'); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    window.open('https://wa.me/?text=' + encodeURIComponent(mensagem), '_blank', 'noopener,noreferrer');
  }

  function novoAnuncio() {
    $('resultCard').classList.remove('visible', 'falhou');
    $('preco').value = '';
    $('tamanho').value = '';
    $('obs').value = '';
    $('catTags').querySelectorAll('.tag').forEach(t => marcar(t, false));
    marcarUnica($('stateTags').querySelector('.tag'), 'stateTags');
    removerFoto();
    esconderErro();
    mensagem = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ── 11. Histórico e status das peças ─────────────────────────────── */

  const CABIDE_VAZIO = raw('<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.6 5.2a2.4 2.4 0 1 1 3.3 2.2c-.6.3-.9.8-.9 1.4v.7"/><path d="M12 9.5 3.4 15.6c-.9.6-.5 2 .6 2h16c1.1 0 1.5-1.4.6-2z"/></svg>');

  function ehHoje(ts) {
    if (!ts) return false;
    const d = new Date(ts), h = new Date();
    return d.getDate() === h.getDate() && d.getMonth() === h.getMonth() && d.getFullYear() === h.getFullYear();
  }

  // número com contagem animada (efeitos.js); sem ele, troca direto
  function setNum(id, n) {
    const el = $(id);
    if (typeof efeitos().contar === 'function') efeitos().contar(el, n);
    else el.textContent = n;
  }

  function atualizarBadge() {
    const pendentes = produtos.filter(p => p.status !== VENDIDO).length;
    const el = $('pendBadge');
    el.textContent = pendentes;
    el.setAttribute('aria-label', pendentes + (pendentes === 1 ? ' peça pendente' : ' peças pendentes'));
    el.classList.toggle('on', pendentes > 0);
  }

  function buscarHist(q) {
    filtroHist = (q || '').trim().toLowerCase();
    renderizarHistorico();
  }

  function vazio(titulo, dica, extra) {
    return html`<div class="hist-empty">${CABIDE_VAZIO}<p>${titulo}</p><small>${dica}</small>${extra || ''}</div>`;
  }

  // Cada cartão do histórico é montado uma vez e reaproveitado enquanto a peça
  // não muda (id, status, hora da venda). Antes a lista inteira era refeita a
  // cada letra da busca e a cada "Reservar": todos os cartões repetiam a
  // animação de entrada (a lista piscava) e as miniaturas eram decodificadas
  // de novo. Agora só entra nó novo para a peça que mudou.
  const cartoes = new Map(); // produto -> { versao, el }
  let estadoDaLista = '';    // marcação do esqueleto/vazio/erro que está na tela

  function mostrarNaLista(lista, marcacao) {
    if (estadoDaLista === marcacao) return;   // a mesma mensagem não reanima
    estadoDaLista = marcacao;
    lista.innerHTML = marcacao;
  }

  function cartaoReaproveitado(p) {
    const versao = [p.id, p.status, p.soldAt].join('|');
    const antigo = cartoes.get(p);
    if (antigo && antigo.versao === versao) return antigo;
    const molde = document.createElement('template');
    molde.innerHTML = cartaoDoHistorico(p);
    return { versao, el: molde.content.firstElementChild };
  }

  // entrando: a aba acabou de abrir ou os dados acabaram de chegar, e só aí
  // os cartões fazem a animação de entrada (classe .entrando no style.css)
  function renderizarHistorico(entrando) {
    const lista = $('histList');
    setNum('cntDisp', produtos.filter(p => p.status === DISPONIVEL).length);
    setNum('cntRes', produtos.filter(p => p.status === RESERVADO).length);
    setNum('cntVend', produtos.filter(p => p.status === VENDIDO && ehHoje(p.soldAt)).length);
    lista.classList.toggle('entrando', entrando === true);

    if (!bancoPronto) {
      mostrarNaLista(lista, '<div class="skel"></div><div class="skel"></div><div class="skel"></div>');
      return;
    }
    if (erroBanco) {
      mostrarNaLista(lista, String(vazio('Não deu pra carregar o histórico', 'Motivo: ' + erroBanco,
        html`<button class="btn btn-ghost btn-sm" type="button" data-action="recarregar">Tentar de novo</button>`)));
      return;
    }
    if (!produtos.length) {
      mostrarNaLista(lista, String(vazio('Nenhum produto ainda', 'Gere um anúncio na aba Anunciar')));
      return;
    }

    let base = produtos;
    if (filtroHist) {
      base = produtos.filter(p =>
        (p.prodCod || '').toLowerCase().includes(filtroHist) ||
        (p.cats || []).join(' ').toLowerCase().includes(filtroHist) ||
        (p.brecoNome || '').toLowerCase().includes(filtroHist));
    }
    const ordem = { [DISPONIVEL]: 0, [RESERVADO]: 1, [VENDIDO]: 2 };
    const ordenados = [...base].sort((a, b) => {
      const oa = ordem[a.status] ?? 3, ob = ordem[b.status] ?? 3;
      if (oa !== ob) return oa - ob;
      return (Number(b.ts) || 0) - (Number(a.ts) || 0);
    });

    if (!ordenados.length) {
      mostrarNaLista(lista, String(vazio('Nenhuma peça encontrada', 'Confira o código, ele vem no fim da mensagem da cliente')));
      return;
    }

    const nos = ordenados.map(p => {
      const c = cartaoReaproveitado(p);
      cartoes.set(p, c);
      return c.el;
    });
    // o que a busca escondeu continua guardado; só sai quem saiu dos produtos
    if (cartoes.size > produtos.length) {
      const vivos = new Set(produtos);
      cartoes.forEach((c, p) => { if (!vivos.has(p)) cartoes.delete(p); });
    }
    if (estadoDaLista) { lista.textContent = ''; estadoDaLista = ''; }
    // tira o que saiu (filtro, peça removida) e põe na ordem mexendo só no
    // que estiver fora do lugar
    const ficam = new Set(nos);
    Array.from(lista.children).forEach(el => { if (!ficam.has(el)) el.remove(); });
    nos.forEach((el, i) => { if (lista.children[i] !== el) lista.insertBefore(el, lista.children[i] || null); });
  }

  function cartaoDoHistorico(p) {
    const fisica = p.type === 'physical';
    const classeStatus = fisica ? 'phys' : p.status === DISPONIVEL ? 'avail' : p.status === RESERVADO ? 'reserv' : 'sold-st';
    const rotuloStatus = fisica ? '🏪 Venda Física' : p.status === DISPONIVEL ? '● Disponível' : p.status === RESERVADO ? '● Reservado' : '✓ Vendido';
    const d = new Date(Number(p.ts) || 0);
    const quando = d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const nome = (p.cats || []).map(c => String(c).replace(/^[^\p{L}\p{N}]+\s+/u, '')).join(', ') || 'Produto';

    const thumb = fotoValida(p.foto64)
      ? html`<div class="hist-thumb"><img src="${p.foto64}" alt="" loading="lazy" decoding="async"></div>`
      : html`<div class="hist-thumb hist-thumb-emoji">${p.emoji || '📦'}</div>`;

    const botao = (classe, acao, para, texto) =>
      html`<button class="btn btn-sm ${classe}" type="button" data-action="${acao}" data-id="${p.id}" data-para="${para}">${texto}</button>`;
    let acoes;
    if (!p.id) {
      acoes = html`<span class="hist-saving" role="status">Salvando no histórico…</span>`;
    } else if (fisica) {
      acoes = botao('btn-cancel', 'remover-venda', '', '🗑 Remover');
    } else if (p.status === DISPONIVEL) {
      acoes = html`${botao('btn-warn', 'status', RESERVADO, '🔒 Reservar')}${botao('btn-sold-c', 'status', VENDIDO, '✓ Confirmar Venda')}`;
    } else if (p.status === RESERVADO) {
      acoes = html`${botao('btn-cancel', 'status', DISPONIVEL, '✕ Cancelar Reserva')}${botao('btn-sold-c', 'status', VENDIDO, '✓ Confirmar Venda')}`;
    } else {
      acoes = botao('btn-cancel', 'status', DISPONIVEL, '↩ Cancelar Venda');
    }

    return String(html`<article class="hist-item${fisica ? ' physical-item' : ''}">
      <div class="hist-item-top">${thumb}
        <div class="hist-info">
          <div class="hist-name">${p.emoji || ''} ${nome}${p.tam ? ' | ' + p.tam : ''}</div>
          <div class="hist-meta">${p.brecoNome || 'Brechó'}${p.estLabel ? ' | ' + p.estLabel : ''}</div>
          ${p.prodCod ? html`<div class="hist-code">🔖 ${p.prodCod}</div>` : ''}
          <div class="hist-price">R$ ${p.precoStr}</div>
        </div>
      </div>
      <div class="hist-status ${classeStatus}">${rotuloStatus}</div>
      <div class="hist-time">${quando}</div>
      <div class="hist-actions">${acoes}</div>
    </article>`);
  }

  // A tela muda na hora e volta atrás se o banco recusar
  async function mudarStatus(id, novo) {
    const p = produtos.find(x => x.id === id);
    if (!p || p.status === novo || !STATUS_VALIDOS.includes(novo)) return;
    const antes = { status: p.status, soldAt: p.soldAt };
    p.status = novo;
    p.soldAt = novo === VENDIDO ? Date.now() : null;
    renderizarHistorico(); atualizarBadge();
    if (novo === DISPONIVEL) toast('↩️ Produto disponível novamente!');
    if (novo === RESERVADO) toast('🔒 Marcado como Reservado.');
    if (novo === VENDIDO) dispararAlertaVenda(p);
    try {
      await avisarSeDemorar(updateDoc(produtoRef(id), { status: novo, soldAt: p.soldAt }),
        'A mudança ainda não foi salva. Confira a internet.');
      registrarEvento({ productId: id, type: 'status_changed', from: antes.status, to: novo,
        by: uid, byEmail: emailLogado, at: Date.now() });
      if (novo === VENDIDO) {
        registrarVenda({ productId: id, sellerId: uid, sellerEmail: emailLogado, valor: p.precoNum || 0,
          brecoNome: p.brecoNome || '', soldAt: p.soldAt, cashoutSent: false, type: 'online' });
      }
    } catch (e) {
      Object.assign(p, antes);
      renderizarHistorico(); atualizarBadge();
      toast('Não deu pra salvar a mudança: ' + textoDoErro(e) + '.', 5000);
    }
  }

  function dispararAlertaVenda(p) {
    const meuTel = valor('meuTel').replace(/\D/g, '');
    const meuNome = valor('seuNome') || 'Vendedor';
    const agora = new Date();
    const fisica = p.type === 'physical';
    const msg = '🧾 *VENDA REGISTRADA: ' + (p.brecoNome || 'Brechó') + '*\n\n'
      + (fisica ? '🏪 Venda física\n' : '')
      + '📦 Produto: ' + (p.emoji || '📦') + ' ' + ((p.cats || []).join('/') || 'Peça') + (p.tam ? ' (' + p.tam + ')' : '')
      + '\n💰 Valor: R$ ' + p.precoStr
      + '\n🏷️ Estado: ' + (p.estLabel || '')
      + '\n👤 Vendedor: ' + meuNome
      + '\n🕐 ' + agora.toLocaleDateString('pt-BR') + ' às ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (meuTel) {
      setTimeout(() => window.open('https://wa.me/55' + meuTel + '?text=' + encodeURIComponent(msg), '_blank', 'noopener,noreferrer'), 600);
    } else {
      setTimeout(() => { toast('⚠️ Configure seu WhatsApp nas ⚙️ para receber alertas.', 4000); alternarConfig(true); }, 500);
    }
  }

  /* ── 12. Venda na loja e fechamento de caixa ──────────────────────── */

  function abrirModalVendaFisica(botao) {
    quemAbriuModal = botao || null;
    $('modalVendaFisica').classList.add('on');
    // o resto da tela fica inerte: Tab e leitor de tela não saem do modal
    $('appMain').inert = true;
    setTimeout(() => $('vfDesc').focus(), 200);
  }

  function fecharModalVF() {
    const modal = $('modalVendaFisica');
    if (!modal.classList.contains('on')) return;
    modal.classList.remove('on');
    $('appMain').inert = false;
    // o foco volta pra onde estava, senão o leitor de tela se perde
    if (quemAbriuModal && quemAbriuModal.focus) quemAbriuModal.focus();
    quemAbriuModal = null;
  }

  async function registrarVendaFisica() {
    const desc = valor('vfDesc').slice(0, LIMITE.descLoja);
    const precoV = $('vfPreco').value;
    const preco = parseFloat(precoV);
    if (!desc) { toast('⚠️ Informe uma descrição.'); $('vfDesc').focus(); return; }
    if (!precoV || isNaN(preco) || preco <= 0 || preco > LIMITE.preco) { toast('⚠️ Informe um valor válido.'); $('vfPreco').focus(); return; }

    const nome = valor('brecoNome').slice(0, LIMITE.nome) || 'Brechó';
    const precoStr = formatarPreco(preco);
    const agora = Date.now();
    const produto = {
      id: null, ts: agora, emoji: '🏪', cats: [desc], estado: [], estLabel: 'Venda física', tam: '',
      obs: '', precoNum: preco, precoStr, link: '', msg: '',
      foto64: null, brecoNome: nome, brecoOwner: uid, sellerEmail: emailLogado,
      status: VENDIDO, soldAt: agora, cashoutSent: false, type: 'physical'
    };
    produtos.unshift(produto);
    $('vfDesc').value = '';
    $('vfPreco').value = '';
    fecharModalVF();
    renderizarHistorico(); atualizarBadge();
    toast('🏪 Venda física registrada! R$ ' + precoStr);

    try {
      await avisarSeDemorar(salvarProduto(produto), 'A venda ainda não foi salva. Confira a internet.');
      registrarVenda({ productId: produto.id, sellerId: uid, sellerEmail: emailLogado, valor: preco,
        brecoNome: nome, soldAt: agora, cashoutSent: false, type: 'physical' });
      if (abaAtual === 'historico') renderizarHistorico();
    } catch (e) {
      produtos = produtos.filter(p => p !== produto);
      renderizarHistorico(); atualizarBadge();
      toast('A venda não foi salva: ' + textoDoErro(e) + '.', 5000);
    }
  }

  async function removerVendaFisica(id) {
    const p = produtos.find(x => x.id === id);
    if (!p || !confirm('Remover esta venda física?')) return;
    const posicao = produtos.indexOf(p);
    produtos = produtos.filter(x => x !== p);
    renderizarHistorico(); atualizarBadge();
    toast('🗑 Venda removida.');
    try {
      await deleteDoc(produtoRef(id));
    } catch (e) {
      produtos.splice(posicao, 0, p);
      renderizarHistorico(); atualizarBadge();
      toast('Não deu pra remover: ' + textoDoErro(e) + '.', 5000);
    }
  }

  function fecharCaixaHoje() {
    const vendasHoje = produtos.filter(p => p.status === VENDIDO && ehHoje(p.soldAt) && !p.cashoutSent && p.id);
    if (!vendasHoje.length) { toast('Nenhuma venda nova hoje.'); return; }

    let totalOnline = 0, totalFisico = 0, qtdOnline = 0, qtdFisico = 0;
    vendasHoje.forEach(p => {
      if (p.type === 'physical') { totalFisico += (p.precoNum || 0); qtdFisico++; }
      else { totalOnline += (p.precoNum || 0); qtdOnline++; }
    });
    const totalGeral = totalOnline + totalFisico;
    const qtdTotal = qtdOnline + qtdFisico;
    const ticket = qtdTotal > 0 ? totalGeral / qtdTotal : 0;
    const comissao = totalGeral * (COMISSAO_PERCENTUAL / 100);
    const pecas = n => n + ' peça' + (n > 1 ? 's' : '');

    let resumo = '📊 *FECHAMENTO DO DIA*\n'
      + new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }) + '\n\n';
    if (qtdOnline > 0) resumo += '🌐 Vendas Online: R$ ' + formatarPreco(totalOnline) + ' (' + pecas(qtdOnline) + ')\n';
    if (qtdFisico > 0) resumo += '🏪 Vendas Físicas: R$ ' + formatarPreco(totalFisico) + ' (' + pecas(qtdFisico) + ')\n';
    resumo += '\n💰 *Total: R$ ' + formatarPreco(totalGeral) + '*'
      + '\n📦 Peças vendidas: ' + qtdTotal
      + '\n🎯 Ticket médio: R$ ' + formatarPreco(ticket)
      + '\n💸 Comissão (' + COMISSAO_PERCENTUAL + '%): R$ ' + formatarPreco(comissao);

    vendasHoje.forEach(p => {
      p.cashoutSent = true;
      updateDoc(produtoRef(p.id), { cashoutSent: true })
        .catch(() => { p.cashoutSent = false; toast('Uma venda não foi marcada como fechada. Tente de novo.', 4000); });
    });

    const meuTel = valor('meuTel').replace(/\D/g, '');
    const destino = (meuTel ? 'https://wa.me/55' + meuTel : 'https://wa.me/') + '?text=' + encodeURIComponent(resumo);
    window.open(destino, '_blank', 'noopener,noreferrer');
  }

  /* ── 13. Ligação dos eventos e início ─────────────────────────────── */

  // Cada botão declara data-action; o clique chega aqui por delegação, o que
  // também cobre os botões que o histórico cria depois.
  const ACOES = {
    'tema': trocarTema,
    'config': () => alternarConfig(),
    'salvar-config': salvarConfig,
    'sair': sair,
    'aba': btn => mudarAba(btn.dataset.aba),
    'remover-foto': removerFoto,
    'gerar': gerarAnuncio,
    'copiar': copiar,
    'compartilhar': compartilharWpp,
    'novo': novoAnuncio,
    'venda-loja': abrirModalVendaFisica,
    'fechar-caixa': fecharCaixaHoje,
    'fechar-modal': fecharModalVF,
    'status': btn => mudarStatus(btn.dataset.id, btn.dataset.para),
    'remover-venda': btn => removerVendaFisica(btn.dataset.id),
    'recarregar': carregarProdutos,
    'esqueci-senha': esqueciSenha
  };

  function ligarEventos() {
    document.addEventListener('click', e => {
      const alvo = e.target.closest('[data-action]');
      if (!alvo || alvo.disabled) return;
      const acao = ACOES[alvo.dataset.action];
      if (acao) acao(alvo, e);
    });

    $('loginForm').addEventListener('submit', e => { e.preventDefault(); entrar(); });
    // Enter no email pula pra senha em vez de enviar o formulário pela metade
    $('loginEmail').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); $('loginSenha').focus(); }
    });

    // nas abas, seta esquerda ou direita troca de aba e leva o foco junto
    document.querySelector('.nav').addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const aba = abaAtual === 'anuncio' ? 'historico' : 'anuncio';
      mudarAba(aba);
      $(aba === 'anuncio' ? 'tabAnuncio' : 'tabHistorico').focus();
    });

    $('fotoCamera').addEventListener('change', escolherFoto);
    $('fotoGaleria').addEventListener('change', escolherFoto);
    $('histSearch').addEventListener('input', e => buscarHist(e.target.value));

    $('formVendaFisica').addEventListener('submit', e => { e.preventDefault(); registrarVendaFisica(); });
    $('modalVendaFisica').addEventListener('click', e => { if (e.target === e.currentTarget) fecharModalVF(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharModalVF(); });

    ligarEtiquetas();
  }

  // o inicio.js já pôs o tema salvo antes da primeira pintura; aqui ficam os
  // ícones do botão e o rótulo, que dependem dele
  let temaSalvo = null;
  try { temaSalvo = localStorage.getItem(TEMA_KEY); } catch (e) { /* sem storage, fica o claro */ }
  aplicarTema(temaSalvo === 'escuro');
  // versões antigas guardavam uma cópia do histórico que nada lia
  try { localStorage.removeItem('brecho_cache'); } catch (e) { /* nada a limpar */ }
  ligarEventos();
})();
