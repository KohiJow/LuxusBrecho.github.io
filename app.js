'use strict';

/* ════════════════════════════════════════════
   AUTH — Firebase Authentication
════════════════════════════════════════════ */

// BUG 4 FIX: IDs como strings (não notação científica)
const firebaseConfig = {
  apiKey: "AIzaSyDF-X_HOomeNKoQtOmIN-c9dtTpRyhAmBY",
  authDomain: "brechobase.firebaseapp.com",
  projectId: "brechobase",
  storageBucket: "brechobase.firebasestorage.app",
  messagingSenderId: "1093839654425",
  appId: "1:1093839654425:web:d502e779a0a574b4c4a488"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
let currentSellerId = null, currentSellerEmail = null;

auth.onAuthStateChanged(user => {
  const login = document.getElementById('loginScreen');
  const app   = document.getElementById('appWrapper');
  if (user) {
    currentSellerId   = user.uid;
    currentSellerEmail = user.email;
    const el = document.getElementById('loggedEmail');
    if (el) el.textContent = user.email;
    login.style.display = 'none';
    app.style.display   = 'block';
    carregarConfigSalva();
    loadProductsFromDb();
  } else {
    currentSellerId = null;
    login.style.display = 'flex';
    app.style.display   = 'none';
    _products = [];
  }
});

// BUG 2 FIX: exposto no window para que onclick="fazerLogin()" sempre funcione
async function fazerLogin() {
  const email = (document.getElementById('loginEmail').value || '').trim();
  const senha  = document.getElementById('loginSenha').value || '';
  const errEl  = document.getElementById('loginErr');
  const btn    = document.getElementById('btnLogin');
  errEl.textContent = '';
  if (!email || !senha) { errEl.textContent = 'Preencha email e senha.'; return; }
  btn.disabled = true; btn.textContent = 'Entrando…';
  try {
    await auth.signInWithEmailAndPassword(email, senha);
  } catch (e) {
    errEl.textContent =
      (e.code === 'auth/user-not-found' || e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential')
        ? 'Email ou senha incorretos.'
        : 'Erro ao entrar. Tente novamente.';
    btn.disabled = false; btn.textContent = 'Entrar';
  }
}
window.fazerLogin = fazerLogin;  // ← BUG 2 FIX

function fazerLogout() { auth.signOut(); _products = []; }
window.fazerLogout = fazerLogout;

/* ════════════════════════════════════════════
   CONFIG — localStorage
════════════════════════════════════════════ */

const CFG_KEY = 'brecho_cfg_v2';

function carregarConfigSalva() {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return;
    const cfg = JSON.parse(raw);
    if (cfg.telefone) document.getElementById('telefone').value = cfg.telefone;
    if (cfg.brecoNome) document.getElementById('brecoNome').value = cfg.brecoNome;
    if (cfg.seuNome)   document.getElementById('seuNome').value   = cfg.seuNome;
    if (cfg.meuTel)    document.getElementById('meuTel').value    = cfg.meuTel;
    const cbIA = document.getElementById('usarIA');
    if (cbIA) cbIA.checked = !!cfg.usarIA;
  } catch (e) {}
}

function salvarConfig() {
  const cfg = {
    telefone:  document.getElementById('telefone').value.trim(),
    brecoNome: document.getElementById('brecoNome').value.trim(),
    seuNome:   document.getElementById('seuNome').value.trim(),
    meuTel:    document.getElementById('meuTel').value.trim(),
    usarIA:    !!(document.getElementById('usarIA') || {}).checked
  };
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
    toast('✅ Configurações salvas!');
    setTimeout(() => { _cfgOpen = false; document.getElementById('cfgCard').style.display = 'none'; }, 800);
  } catch (e) { toast('Erro ao salvar.'); }
}
window.salvarConfig = salvarConfig;

/* ════════════════════════════════════════════
   FIRESTORE — Persistência
════════════════════════════════════════════ */

let _foto64 = null, _fotoFile = null, _msg = '', _dark = true, _cfgOpen = false, _currentTab = 'anuncio';
let _products = [];

// Backend Luxus IA. Em produção (GitHub Pages) usa o domínio público com HTTPS;
// em dev (localhost) cai no backend local. window.IA_BASE_URL sempre tem prioridade.
const IA_BASE_URL = (typeof window !== 'undefined' && window.IA_BASE_URL)
  || (typeof location !== 'undefined' && location.hostname.endsWith('github.io')
    ? 'https://api.luxusbrecho.com.br'
    : 'http://127.0.0.1:8000');

async function loadProductsFromDb() {
  try {
    const snap = await db.collection('products')
      .where('brecoOwner', '==', currentSellerId)
      .orderBy('ts', 'desc').limit(500).get();
    _products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    try {
      const snap2 = await db.collection('products').orderBy('ts', 'desc').limit(500).get();
      _products = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e2) { _products = []; }
  }
  updatePendBadge();
  if (_currentTab === 'historico') renderHistory();
}

async function addProductToDb(product) {
  try {
    const docRef = await db.collection('products').add(product);
    product.id = docRef.id;
    _products.unshift(product);
  } catch (e) { _products.unshift(product); }
}

async function updateProductInDb(id, data) {
  try { await db.collection('products').doc(id).update(data); } catch (e) {}
}

async function addEventToDb(event) {
  try { await db.collection('events').add(event); } catch (e) {}
}

async function addSaleToDb(sale) {
  try { await db.collection('sales').add(sale); } catch (e) {}
}

/* ════════════════════════════════════════════
   UI — Tema, Tabs, Config
════════════════════════════════════════════ */

function applyTheme(dark) {
  _dark = dark;
  dark
    ? document.documentElement.removeAttribute('data-theme')
    : document.documentElement.setAttribute('data-theme', 'light');
  document.getElementById('themeIcon').innerHTML = dark
    ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
    : '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
}
function toggleTheme() { applyTheme(!_dark); }
window.toggleTheme = toggleTheme;

function toggleConfig() {
  _cfgOpen = !_cfgOpen;
  document.getElementById('cfgCard').style.display = _cfgOpen ? 'block' : 'none';
}
window.toggleConfig = toggleConfig;

function switchTab(tab) {
  _currentTab = tab;
  document.getElementById('pageAnuncio').style.display   = tab === 'anuncio'   ? 'block' : 'none';
  document.getElementById('pageHistorico').style.display = tab === 'historico' ? 'block' : 'none';
  document.getElementById('tabAnuncio').classList.toggle('active',   tab === 'anuncio');
  document.getElementById('tabHistorico').classList.toggle('active', tab === 'historico');
  if (tab === 'historico') renderHistory();
}
window.switchTab = switchTab;

/* ════════════════════════════════════════════
   UI — Foto
════════════════════════════════════════════ */

function handlePhoto(e) {
  const file = e.target.files[0]; if (!file) return;
  const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  if (!ok.includes(file.type) && !/\.(jpg|jpeg|png|webp|heic|heif)$/i.test(file.name)) {
    showErr('Formato não suportado.'); return;
  }
  if (file.size > 8 * 1024 * 1024) { showErr('Imagem muito grande. Máximo 8MB.'); return; }
  _fotoFile = file;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const MAX = 640; let w = img.width, h = img.height;
      if (w > MAX || h > MAX) { if (w > h) { h = Math.round(h * MAX / w); w = MAX; } else { w = Math.round(w * MAX / h); h = MAX; } }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      _foto64 = c.toDataURL('image/jpeg', 0.75);
      const prev = document.getElementById('preview');
      prev.src = _foto64; prev.style.display = 'block';
      document.getElementById('photoBtns').style.display   = 'none';
      document.getElementById('previewZone').style.display = 'block';
      hideStatus();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}
window.handlePhoto = handlePhoto;

function removePhoto() {
  _foto64 = null; _fotoFile = null;
  const prev = document.getElementById('preview');
  prev.style.display = 'none'; prev.src = '';
  document.getElementById('photoBtns').style.display   = 'grid';
  document.getElementById('previewZone').style.display = 'none';
  document.getElementById('fotoCamera').value  = '';
  document.getElementById('fotoGaleria').value = '';
}
window.removePhoto = removePhoto;

/* ════════════════════════════════════════════
   UI — Tags, feedback, loading
════════════════════════════════════════════ */

function toggleTag(el)        { el.classList.toggle('active'); }
function toggleSingle(el, gid) {
  document.querySelectorAll('#' + gid + ' .tag').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
}
function getActive(gid) {
  return Array.from(document.querySelectorAll('#' + gid + ' .tag.active')).map(t => t.textContent.trim());
}
window.toggleTag    = toggleTag;
window.toggleSingle = toggleSingle;

function showErr(m)   { const e = document.getElementById('errBar');   e.textContent = m; e.classList.add('on'); }
function hideErr()    { document.getElementById('errBar').classList.remove('on'); }
function showRetry(m) { const r = document.getElementById('retryBar'); r.textContent = m; r.classList.add('on'); }
function hideRetry()  { document.getElementById('retryBar').classList.remove('on'); }
function hideStatus() { hideErr(); hideRetry(); }
function toast(m, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = m; t.classList.add('on');
  setTimeout(() => t.classList.remove('on'), ms);
}

function setLoading(on) {
  const b = document.getElementById('btnGerar');
  b.disabled = on;
  b.innerHTML = on
    ? '<div class="dots"><span></span><span></span><span></span></div> Gerando…'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Gerar mensagem com IA';
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function finalizarDesc(text) {
  if (!text) return '';
  const t = text.trim();
  let last = -1;
  for (let i = t.length - 1; i >= 0; i--) { if ('.!?'.includes(t[i])) { last = i; break; } }
  if (last > 0 && last < t.length - 1) return t.slice(0, last + 1);
  if (last === -1) return t + '.';
  return t;
}

function updatePendBadge() {
  const pend = _products.filter(p => p.status !== 'sold').length;
  const el   = document.getElementById('pendBadge');
  el.textContent = pend; el.classList.toggle('on', pend > 0);
}

/* ════════════════════════════════════════════
   FIRESTORE — Status dos produtos
════════════════════════════════════════════ */

async function changeStatus(id, newStatus) {
  const p = _products.find(x => x.id === id); if (!p) return;
  const oldStatus = p.status;
  p.status = newStatus;
  if (newStatus === 'sold') p.soldAt = Date.now();
  await updateProductInDb(id, { status: newStatus, soldAt: p.soldAt || null });
  await addEventToDb({ productId: id, type: 'status_changed', from: oldStatus, to: newStatus,
    by: currentSellerId || 'anon', byEmail: currentSellerEmail || '', at: Date.now() });
  if (newStatus === 'sold') {
    await addSaleToDb({ productId: id, sellerId: currentSellerId || 'anon',
      sellerEmail: currentSellerEmail || '', valor: p.precoNum || 0,
      brecoNome: p.brecoNome || '', soldAt: p.soldAt, cashoutSent: false });
  }
  saveProducts(); renderHistory(); updatePendBadge();
  if (newStatus === 'available') toast('↩️ Produto disponível novamente!');
  if (newStatus === 'reserved')  toast('🔒 Marcado como Reservado.');
  if (newStatus === 'sold')      dispararAlertaVenda(p);
}
window.changeStatus = changeStatus;

function saveProducts() {
  try { localStorage.setItem('brecho_cache', JSON.stringify(_products.map(p => ({ ...p, foto64: null })))); } catch (e) {}
}

function dispararAlertaVenda(p) {
  const meuTel  = (document.getElementById('meuTel').value  || '').trim().replace(/\D/g, '');
  const meuNome = (document.getElementById('seuNome').value || '').trim() || 'Vendedor';
  const now = new Date();
  const isPhysical = p.type === 'physical';
  const msg = '🧾 *VENDA REGISTRADA — ' + (p.brecoNome || 'Brechó') + '*\n\n'
    + (isPhysical ? '🏪 Venda física\n' : '')
    + '📦 Produto: ' + (p.emoji || '📦') + ' ' + (p.cats?.join('/') || 'Peça') + (p.tam ? ' (' + p.tam + ')' : '')
    + '\n💰 Valor: R$ ' + p.precoStr
    + '\n🏷️ Estado: ' + (p.estLabel || '')
    + '\n👤 Vendedor: ' + meuNome
    + '\n🕐 ' + now.toLocaleDateString('pt-BR') + ' às ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (meuTel) {
    setTimeout(() => window.open('https://wa.me/55' + meuTel + '?text=' + encodeURIComponent(msg), '_blank', 'noopener,noreferrer'), 600);
  } else {
    setTimeout(() => { toast('⚠️ Configure seu WhatsApp nas ⚙️ para receber alertas.', 4000); if (!_cfgOpen) toggleConfig(); }, 500);
  }
}

/* ════════════════════════════════════════════
   UI — Modal venda física
════════════════════════════════════════════ */

function abrirModalVendaFisica() {
  document.getElementById('modalVendaFisica').classList.add('on');
  setTimeout(() => document.getElementById('vfDesc').focus(), 200);
}
function fecharModalVF(e) {
  if (e && e.target !== document.getElementById('modalVendaFisica')) return;
  document.getElementById('modalVendaFisica').classList.remove('on');
}
window.abrirModalVendaFisica = abrirModalVendaFisica;
window.fecharModalVF         = fecharModalVF;

async function registrarVendaFisica() {
  const desc   = (document.getElementById('vfDesc').value || '').trim();
  const precoV = document.getElementById('vfPreco').value;
  const preco  = parseFloat(precoV);
  if (!desc)                                 { toast('⚠️ Informe uma descrição.'); return; }
  if (!precoV || isNaN(preco) || preco <= 0) { toast('⚠️ Informe um valor válido.'); return; }

  const nome     = (document.getElementById('brecoNome').value || '').trim() || 'Brechó';
  const precoStr = preco.toFixed(2).replace('.', ',');
  const now      = Date.now();

  const product = {
    ts: now, emoji: '🏪', cats: [desc], estado: [], estLabel: 'Venda física', tam: '',
    obs: '', precoNum: preco, precoStr, link: '', msg: '',
    foto64: null, brecoNome: nome, brecoOwner: currentSellerId || 'anon',
    sellerEmail: currentSellerEmail || '',
    status: 'sold', soldAt: now, cashoutSent: false, type: 'physical'
  };

  await addProductToDb(product);
  await addSaleToDb({ productId: product.id, sellerId: currentSellerId || 'anon',
    sellerEmail: currentSellerEmail || '', valor: preco,
    brecoNome: nome, soldAt: now, cashoutSent: false, type: 'physical' });

  updatePendBadge();
  document.getElementById('vfDesc').value  = '';
  document.getElementById('vfPreco').value = '';
  document.getElementById('modalVendaFisica').classList.remove('on');
  toast('🏪 Venda física registrada! R$ ' + precoStr);
  renderHistory();
}
window.registrarVendaFisica = registrarVendaFisica;

/* ════════════════════════════════════════════
   UI — Render Histórico
════════════════════════════════════════════ */

function renderHistory() {
  const list = document.getElementById('histList');
  const vendasHoje = _products.filter(p => p.status === 'sold' && ehHoje(p.soldAt));
  const disp = _products.filter(p => p.status === 'available').length;
  const res  = _products.filter(p => p.status === 'reserved').length;
  document.getElementById('cntDisp').textContent = disp;
  document.getElementById('cntRes').textContent  = res;
  document.getElementById('cntVend').textContent = vendasHoje.length;

  if (!_products.length) {
    list.innerHTML = '<div class="hist-empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="3"/></svg><p>Nenhum produto ainda</p><small>Gere um anúncio na aba Anunciar</small></div>';
    return;
  }

  const sorted = [..._products].sort((a, b) => {
    const ord = { available: 0, reserved: 1, sold: 2 };
    if (ord[a.status] !== ord[b.status]) return ord[a.status] - ord[b.status];
    return b.ts - a.ts;
  });

  list.innerHTML = sorted.map(p => {
    const isPhysical  = p.type === 'physical';
    const statusClass = isPhysical ? 'phys' : p.status === 'available' ? 'avail' : p.status === 'reserved' ? 'reserv' : 'sold-st';
    const statusLabel = isPhysical ? '🏪 Venda Física' : p.status === 'available' ? '● Disponível' : p.status === 'reserved' ? '● Reservado' : '✓ Vendido';
    const d    = new Date(p.ts);
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const data = d.toLocaleDateString('pt-BR');
    const thumbHtml = p.foto64
      ? '<div class="hist-thumb"><img src="' + p.foto64 + '" alt="Foto do produto"></div>'
      : '<div class="hist-thumb" style="font-size:1.4rem">' + (p.emoji || '📦') + '</div>';

    let actionsHtml = '';
    if (!isPhysical) {
      if (p.status === 'available') {
        actionsHtml = '<button class="btn btn-sm btn-warn"   onclick="changeStatus(\'' + p.id + '\',\'reserved\')"  type="button">🔒 Reservar</button>'
                    + '<button class="btn btn-sm btn-sold-c" onclick="changeStatus(\'' + p.id + '\',\'sold\')"     type="button">✓ Confirmar Venda</button>';
      } else if (p.status === 'reserved') {
        actionsHtml = '<button class="btn btn-sm btn-cancel" onclick="changeStatus(\'' + p.id + '\',\'available\')" type="button">✕ Cancelar Reserva</button>'
                    + '<button class="btn btn-sm btn-sold-c" onclick="changeStatus(\'' + p.id + '\',\'sold\')"     type="button">✓ Confirmar Venda</button>';
      } else {
        actionsHtml = '<button class="btn btn-sm btn-cancel" onclick="changeStatus(\'' + p.id + '\',\'available\')" type="button">↩ Cancelar Venda</button>';
      }
    } else {
      actionsHtml = '<button class="btn btn-sm btn-cancel" onclick="removerVendaFisica(\'' + p.id + '\')" type="button">🗑 Remover</button>';
    }

    const itemClass = isPhysical ? 'hist-item physical-item' : 'hist-item';
    return '<div class="' + itemClass + '"><div class="hist-item-top">' + thumbHtml
      + '<div class="hist-info"><div class="hist-name">' + (p.emoji || '') + ' ' + (p.cats.join(', ') || 'Produto') + (p.tam ? ' · ' + p.tam : '') + '</div>'
      + '<div class="hist-meta">' + (p.brecoNome || 'Brechó') + (p.estLabel ? ' · ' + p.estLabel : '') + '</div>'
      + '<div class="hist-price">R$ ' + p.precoStr + '</div></div></div>'
      + '<div class="hist-status ' + statusClass + '">' + statusLabel + '</div>'
      + '<div class="hist-time">' + data + ' às ' + hora + '</div>'
      + '<div class="hist-actions">' + actionsHtml + '</div></div>';
  }).join('');
}

async function removerVendaFisica(id) {
  if (!confirm('Remover esta venda física?')) return;
  _products = _products.filter(p => p.id !== id);
  try { await db.collection('products').doc(id).delete(); } catch (e) {}
  renderHistory(); updatePendBadge();
  toast('🗑 Venda removida.');
}
window.removerVendaFisica = removerVendaFisica;

/* ════════════════════════════════════════════
   IA — backend próprio (Ollama: qwen2.5 + moondream)
════════════════════════════════════════════ */

async function callIA(dados, imgB64) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 45000); // 45s: acima disso quem está na loja desiste

  // mostra aviso após 8s sem cancelar a request
  const lentoMsg = setTimeout(() => showRetry('⏳ A IA está pensando… isso leva ~30–60s.'), 8000);

  let resp;
  try {
    resp = await fetch(IA_BASE_URL + '/ia/anuncio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brecho:         dados.nome,
        categorias:     dados.cats,
        estado:         dados.estado,
        tamanho:        dados.tam,
        observacao:     dados.obs,
        imagem_base64:  imgB64 || null,
        sellerId:       currentSellerId || 'anon'
      }),
      signal: ctrl.signal
    });
  } catch (e) {
    clearTimeout(tid); clearTimeout(lentoMsg); hideRetry();
    throw new Error(e.name === 'AbortError'
      ? 'A IA demorou demais. Tente novamente.'
      : 'Sem conexão com o servidor de IA.');
  }
  clearTimeout(tid); clearTimeout(lentoMsg);

  const body = await resp.json().catch(() => ({}));
  if (resp.status === 429) { hideRetry(); throw new Error('⏳ Muitos pedidos. Aguarde alguns segundos.'); }
  if (resp.status === 503) { hideRetry(); throw new Error('IA indisponível agora.'); }
  if (resp.status === 504) { hideRetry(); throw new Error('A IA demorou demais. Tente novamente.'); }
  if (!resp.ok)            { hideRetry(); throw new Error('Erro no servidor de IA (' + resp.status + ').'); }
  hideRetry();
  return body.texto || '';
}

/* ════════════════════════════════════════════
   WHATSAPP — Link rastreável
════════════════════════════════════════════ */

function buildLink(tel, nome, cats, precoStr, tam, prodCod) {
  const t = tel.replace(/\D/g, '').slice(0, 15); if (!t) return null;
  const catLabel  = cats && cats.length ? cats[0].replace(/^\S+\s/, '') : 'peça';
  const tamPart   = tam      ? ' tamanho ' + tam         : '';
  const pricePart = precoStr ? ' R$ ' + precoStr         : '';
  const nomePart  = nome     ? ' do ' + nome.slice(0, 30) : '';
  const codPart   = prodCod  ? ' [#' + prodCod + ']'     : '';
  const txt = 'Oi! Vi a ' + catLabel + tamPart + pricePart + nomePart + codPart + ' e tenho interesse 😊';
  return 'https://wa.me/' + t + '?text=' + encodeURIComponent(txt);
}

function descLocal(cats, estado, tam, obs) {
  const cat = cats.length   ? cats[0].replace(/^\S+\s/, '')   : 'Peça';
  const est = estado.length ? estado[0].replace(/^\S+\s/, '') : 'Bom';
  const chave = (cat + est + tam + obs).toLowerCase();

  // Escolha estável: a mesma peça gera sempre o mesmo texto, mas peças
  // diferentes geram textos diferentes. Evita o grupo receber vinte posts
  // terminando na mesma frase.
  let h = 0;
  for (let i = 0; i < chave.length; i++) h = (h * 31 + chave.charCodeAt(i)) >>> 0;
  const pega = (lista, desvio) => lista[(h + (desvio || 0)) % lista.length];

  const PORCATEGORIA = {
    'Vestido':   ['Vestido que resolve o look sozinho', 'Vestido fácil de usar, só jogar e sair',
                  'Vestido com caimento bonito'],
    'Camisa':    ['Camisa coringa, combina com tudo', 'Camisa que serve pro trabalho e pro rolê',
                  'Camisa de tecido gostoso'],
    'Blusa':     ['Blusa pra usar o ano todo', 'Blusa confortável do jeito que a gente gosta',
                  'Blusa simples de combinar'],
    'Calça':     ['Calça com caimento ótimo', 'Calça confortável pro dia inteiro',
                  'Calça que valoriza qualquer look'],
    'Short':     ['Short leve, perfeito pro calor', 'Short confortável pro dia a dia',
                  'Short fácil de combinar'],
    'Casaco':    ['Casaco quentinho pros dias frios', 'Casaco que fecha o look com estilo',
                  'Casaco confortável e versátil'],
    'Calçado':   ['Calçado confortável de verdade', 'Calçado que combina com vários looks',
                  'Calçado pronto pra andar muito'],
    'Bolsa':     ['Bolsa que acompanha o dia inteiro', 'Bolsa com espaço pro que importa',
                  'Bolsa coringa pra qualquer ocasião'],
    'Acessório': ['Acessório que dá outro ar no look', 'Acessório pra usar sem pensar muito',
                  'Acessório que faz diferença no detalhe']
  };

  // Frases sem marca de gênero: a mesma lista serve para bolsa e para casaco.
  const PORESTADO = {
    'Novo c/ etiqueta': ['Peça nova, com etiqueta, nunca usada.',
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
    'Garimpo do dia, e é peça única.',
    'Só tem essa, quem chamar primeiro leva.',
    'Peça única: saiu, acabou.',
    'Separei essa com carinho pro grupo.',
    'Se gostou, chama que eu seguro pra você.'
  ];

  const abertura = (PORCATEGORIA[cat] ? pega(PORCATEGORIA[cat]) : cat)
                 + (tam ? ', tamanho ' + tam : '') + '.';
  const condicao = (PORESTADO[est] ? pega(PORESTADO[est], 1) : est + '.');
  const detalhe  = obs ? ' ' + obs.replace(/\s*\.?\s*$/, '') + '.' : '';
  const fecho    = pega(FECHOS, 2);

  return abertura + ' ' + condicao + detalhe + ' ' + fecho;
}

/* ════════════════════════════════════════════
   Gerar post principal
   Prompt vive no backend — front só envia os dados.
════════════════════════════════════════════ */

async function gerarPost() {
  hideStatus();
  const tel    = (document.getElementById('telefone').value || '').trim();
  const nome   = (document.getElementById('brecoNome').value || '').trim().slice(0, 60) || 'Brechó';
  const precoV = document.getElementById('preco').value;
  const tam    = (document.getElementById('tamanho').value  || '').trim().slice(0, 20);
  const obs    = (document.getElementById('obs').value      || '').trim().slice(0, 200);
  const cats   = getActive('catTags');
  const estado = getActive('stateTags');
  const preco  = parseFloat(precoV);

  if (!precoV || isNaN(preco) || preco < 0 || preco > 99999) { showErr('⚠️ Informe um preço válido.'); return; }
  if (!tel) { showErr('⚠️ Configure o telefone da loja (⚙️).'); if (!_cfgOpen) toggleConfig(); return; }

  const precoStr = preco.toFixed(2).replace('.', ',');
  const _prodCod = Date.now().toString(36).slice(-3).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
  const link     = buildLink(tel, nome, cats, precoStr, tam, _prodCod);
  if (!link) { showErr('⚠️ Telefone inválido. Use apenas números com DDD.'); return; }

  setLoading(true);

  // O anúncio é montado aqui mesmo, na hora e sem custo. A IA virou um extra
  // opcional: desligada nem é chamada, e ligada, se falhar, o texto local entra
  // no lugar sem travar a venda.
  let desc = descLocal(cats, estado, tam, obs);
  const querIA = !!(document.getElementById('usarIA') || {}).checked;
  if (querIA) {
    try {
      const imgB64 = _foto64 ? _foto64.split(',')[1] : null;  // backend espera base64 puro
      const r = await callIA({ nome, cats, estado, tam, obs }, imgB64);
      if (r) desc = finalizarDesc(r);
    } catch (err) {
      showErr(err.message + ' Usei o texto automático.');
    }
  }

  const estLabel = estado.length ? estado[0].replace(/^\S+\s/, '') : '';
  const emoji    = cats.length   ? cats[0].split(' ')[0]           : '📦';
  const tamStr   = tam ? '\nTamanho: *' + tam + '*' : '';

  _msg = emoji + ' *' + nome + '*\n\n' + desc + '\n\n💰 *R$ ' + precoStr + '*' + tamStr
       + '\n🏷️ ' + estLabel + '\n\n👉 Clique para reservar:\n' + link;

  const product = {
    ts: Date.now(), emoji, cats, estado, estLabel, tam, obs,
    precoNum: preco, precoStr, link, msg: _msg,
    foto64: _foto64 || null, prodCod: _prodCod,
    brecoNome: nome, brecoOwner: currentSellerId || 'anon',
    sellerEmail: currentSellerEmail || '',
    status: 'available', soldAt: null, cashoutSent: false, type: 'online'
  };

  await addProductToDb(product);
  updatePendBadge();

  document.getElementById('msgResult').textContent = _msg;
  document.getElementById('linkTxt').textContent   = link.replace('https://', '');

  const shareBtn = document.getElementById('btnShareWpp');
  if (_fotoFile && navigator.canShare) {
    shareBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg> Compartilhar com foto no WhatsApp';
  } else {
    shareBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg> Compartilhar no WhatsApp';
  }

  const card = document.getElementById('resultCard');
  card.classList.add('visible');
  setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
  setLoading(false);
}
window.gerarPost = gerarPost;

/* ════════════════════════════════════════════
   WHATSAPP — Copiar / Compartilhar
════════════════════════════════════════════ */

function copiar() {
  if (!_msg) return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(_msg).then(() => toast('✅ Copiado!')).catch(fallbackCopy);
  } else {
    fallbackCopy();
  }
}
function fallbackCopy() {
  const el = document.createElement('textarea');
  el.value = _msg; el.style.cssText = 'position:fixed;opacity:0;';
  document.body.appendChild(el); el.select();
  try { document.execCommand('copy'); toast('✅ Copiado!'); } catch { toast('Selecione e copie manualmente.'); }
  document.body.removeChild(el);
}
window.copiar = copiar;

async function compartilharWpp() {
  if (!_msg) return;
  if (_fotoFile && navigator.share && navigator.canShare) {
    try {
      const res       = await fetch(_foto64);
      const blob      = await res.blob();
      const shareFile = new File([blob], 'produto.jpg', { type: 'image/jpeg' });
      const shareData = { text: _msg, files: [shareFile] };
      if (navigator.canShare(shareData)) {
        await navigator.share(shareData);
        toast('📤 Compartilhado!');
        return;
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  if (navigator.share) {
    try { await navigator.share({ text: _msg }); toast('📤 Compartilhado!'); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  window.open('https://wa.me/?text=' + encodeURIComponent(_msg), '_blank', 'noopener,noreferrer');
}
window.compartilharWpp = compartilharWpp;

function novoAnuncio() {
  document.getElementById('resultCard').classList.remove('visible');
  document.getElementById('preco').value   = '';
  document.getElementById('tamanho').value = '';
  document.getElementById('obs').value     = '';
  document.querySelectorAll('#catTags .tag').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#stateTags .tag').forEach((t, i) => t.classList.toggle('active', i === 0));
  removePhoto(); hideStatus(); _msg = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.novoAnuncio = novoAnuncio;

/* ════════════════════════════════════════════
   FECHAMENTO DE CAIXA
════════════════════════════════════════════ */

function ehHoje(ts) {
  if (!ts) return false;
  const d = new Date(ts), h = new Date();
  return d.getDate() === h.getDate() && d.getMonth() === h.getMonth() && d.getFullYear() === h.getFullYear();
}

function fecharCaixaHoje() {
  const vendasHoje = _products.filter(p => p.status === 'sold' && ehHoje(p.soldAt) && !p.cashoutSent);
  if (!vendasHoje.length) { toast('Nenhuma venda nova hoje.'); return; }

  let totalOnline = 0, totalFisico = 0, qtdOnline = 0, qtdFisico = 0;
  vendasHoje.forEach(p => {
    if (p.type === 'physical') { totalFisico += (p.precoNum || 0); qtdFisico++; }
    else                       { totalOnline += (p.precoNum || 0); qtdOnline++; }
  });
  const totalGeral = totalOnline + totalFisico;
  const qtdTotal   = qtdOnline + qtdFisico;
  const ticket     = qtdTotal > 0 ? totalGeral / qtdTotal : 0;
  const perc       = 15;
  const comissao   = totalGeral * (perc / 100);

  let resumo = '📊 *FECHAMENTO DO DIA*\n'
    + new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }) + '\n\n';

  if (qtdOnline > 0)
    resumo += '🌐 Vendas Online: R$ ' + totalOnline.toFixed(2).replace('.', ',') + ' (' + qtdOnline + ' peça' + (qtdOnline > 1 ? 's' : '') + ')\n';
  if (qtdFisico > 0)
    resumo += '🏪 Vendas Físicas: R$ ' + totalFisico.toFixed(2).replace('.', ',') + ' (' + qtdFisico + ' peça' + (qtdFisico > 1 ? 's' : '') + ')\n';

  resumo += '\n💰 *Total: R$ ' + totalGeral.toFixed(2).replace('.', ',') + '*'
    + '\n📦 Peças vendidas: ' + qtdTotal
    + '\n🎯 Ticket médio: R$ ' + ticket.toFixed(2).replace('.', ',')
    + '\n💸 Comissão (' + perc + '%): R$ ' + comissao.toFixed(2).replace('.', ',');

  vendasHoje.forEach(p => { p.cashoutSent = true; updateProductInDb(p.id, { cashoutSent: true }); });

  const meuTel = (document.getElementById('meuTel').value || '').trim().replace(/\D/g, '');
  const dest   = meuTel
    ? 'https://wa.me/55' + meuTel + '?text=' + encodeURIComponent(resumo)
    : 'https://wa.me/?text=' + encodeURIComponent(resumo);
  window.open(dest, '_blank');
}
window.fecharCaixaHoje = fecharCaixaHoje;

/* ════════════════════════════════════════════
   INIT
════════════════════════════════════════════ */
applyTheme(true);
