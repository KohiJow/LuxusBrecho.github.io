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
    if (cfg.apiKey) {
      document.getElementById('apiKey').value = cfg.apiKey;
      document.getElementById('apiSavedBadge').classList.add('on');
    }
  } catch (e) {}
}

function salvarConfig() {
  const cfg = {
    telefone:  document.getElementById('telefone').value.trim(),
    brecoNome: document.getElementById('brecoNome').value.trim(),
    seuNome:   document.getElementById('seuNome').value.trim(),
    meuTel:    document.getElementById('meuTel').value.trim(),
    apiKey:    document.getElementById('apiKey').value.trim()
  };
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
    const badge = document.getElementById('apiSavedBadge');
    if (cfg.apiKey) badge.classList.add('on');
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
const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-1.5-flash-latest'];

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

function toggleApiVis() {
  const inp = document.getElementById('apiKey');
  const vis  = inp.type === 'password';
  inp.type   = vis ? 'text' : 'password';
  document.getElementById('eyeIcon').innerHTML = vis
    ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
}
window.toggleApiVis = toggleApiVis;

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
   GEMINI — API calls com retry/fallback
════════════════════════════════════════════ */

async function callOnce(key, model, parts) {
  const url  = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 35000);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { maxOutputTokens: 900, temperature: 0.82, topP: 0.92, stopSequences: ['---', '###'] } }),
      signal: ctrl.signal
    });
  } catch (e) {
    clearTimeout(tid);
    throw Object.assign(new Error(e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK'), { code: e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK' });
  }
  clearTimeout(tid);
  const body = await resp.json().catch(() => ({}));
  if (resp.status === 429) {
    const rd = body?.error?.details?.find(d => d['@type']?.includes('RetryInfo'))?.retryDelay;
    throw Object.assign(new Error('rate_limit'), { code: 429, retryMs: rd ? (parseInt(rd) || 5) * 1000 : null });
  }
  if (!resp.ok) throw Object.assign(new Error('http_' + resp.status), { code: resp.status });
  return body?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

async function callGemini(key, prompt, imgB64) {
  if (!key.startsWith('AIza') || key.length < 30)
    throw new Error('Chave inválida. Verifique em aistudio.google.com.');
  const parts = [{ text: prompt }];
  if (imgB64) {
    const m = imgB64.match(/^data:(image\/[\w]+);base64,(.+)$/s);
    if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
  }
  const names = {
    'gemini-2.5-flash':      'Gemini 2.5 Flash',
    'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
    'gemini-2.0-flash-lite': 'Gemini 2.0 Flash Lite',
    'gemini-1.5-flash-latest': 'Gemini 1.5 Flash'
  };
  for (let mi = 0; mi < MODELS.length; mi++) {
    const model = MODELS[mi];
    for (let at = 1; at <= 3; at++) {
      try {
        const r = await callOnce(key, model, parts);
        document.getElementById('modelLabel').textContent = (names[model] || model) + ' · Firebase';
        hideRetry(); return r;
      } catch (err) {
        if (err.code === 429) {
          if (at < 3) {
            const w = err.retryMs ? Math.ceil(err.retryMs / 1000) + 2 : at * 8;
            showRetry('⏳ Limite atingido. Aguardando ' + w + 's… (' + at + '/3)');
            await sleep(w * 1000); continue;
          }
          showRetry('↪️ Trocando modelo…'); await sleep(1500); break;
        }
        if (err.code === 404 || err.code === 400) break;
        if (err.code === 403) throw new Error('Chave sem permissão. Verifique no AI Studio.');
        if (err.code === 'TIMEOUT') {
          if (at < 3) { showRetry('⏳ Sem resposta, tentando… (' + at + '/3)'); await sleep(3000); continue; }
          break;
        }
        break;
      }
    }
  }
  hideRetry();
  throw new Error('Nenhum modelo disponível. Usando descrição padrão.');
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
  const cat = cats.length   ? cats[0].replace(/^\S+\s/, '')   : 'peça';
  const est = estado.length ? estado[0].replace(/^\S+\s/, '') : 'bom estado';
  return cat + (tam ? ' (' + tam + ')' : '') + ' em ' + est + '.' + (obs ? ' ' + obs + '.' : '')
    + ' Peça selecionada com cuidado e pronta para nova dona. Aproveita antes que voa! 🛍️';
}

/* ════════════════════════════════════════════
   GEMINI — Gerar post principal
   BUG 1 FIX: prompt como template literal (backtick)
   — elimina o SyntaxError de aspas aninhadas
════════════════════════════════════════════ */

async function gerarPost() {
  hideStatus();
  const key    = (document.getElementById('apiKey').value   || '').trim();
  const tel    = (document.getElementById('telefone').value || '').trim();
  const nome   = (document.getElementById('brecoNome').value || '').trim().slice(0, 60) || 'Brechó';
  const meu    = (document.getElementById('seuNome').value  || '').trim().slice(0, 40);
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

  let desc = '';
  if (key) {
    const hasImg = !!_foto64;

    // ✅ BUG 1 CORRIGIDO: template literal com backtick
    // Prompt reescrito: personalidade Edna Moda mais forte + regras anti-truncamento
    const prompt = [
      `Você é a Edna Moda — estilista genial, direta, esnobe refinada e incapaz de elogiar sem fundamento.`,
      `Agora você escreve o anúncio de um produto para o grupo do WhatsApp do brechó "${nome}".`,
      ``,
      `DADOS DO PRODUTO:`,
      `- Peça: ${cats.join(', ') || 'peça'}`,
      `- Estado: ${estado.join(', ') || 'bom'}`,
      `- Tamanho: ${tam || 'não informado'}`,
      `- Observação extra: ${obs || 'nenhuma'}`,
      hasImg ? `\nA imagem foi enviada. Use APENAS o que é claramente visível: cor, corte, comprimento, detalhes (botões, gola, bolsos). NUNCA invente estampas, tecidos ou marcas.` : '',
      ``,
      `SUA VOZ É A DA EDNA:`,
      `- Frases curtas e certeiras. Nenhuma palavra desperdiçada.`,
      `- Julgamentos firmes com elegância: "estruturado", "preciso", "impecável", "discreto".`,
      `- Ironia seca quando apropriado. Nunca fofa. Nunca exagerada.`,
      `- Você apresenta, não grita. Zero exclamações histéricas. Máximo 1 emoji no texto todo.`,
      ``,
      `ESCREVA EXATAMENTE 4 PARÁGRAFOS separados por linha vazia:`,
      ``,
      `Parágrafo 1 — DESCRIÇÃO: o que é, cor, corte e um detalhe marcante.${hasImg ? ' Use o que você viu na imagem.' : ''} Termine com ponto.`,
      ``,
      `Parágrafo 2 — ESTADO: objetivo e confiante sobre a conservação. Termine com ponto.`,
      ``,
      `Parágrafo 3 — PARA QUEM: quem vai usar e em qual ocasião, com precisão ou ironia. Termine com ponto.`,
      ``,
      `Parágrafo 4 — CHAMADA: convide para reservar com charme frio. Curto. Termine com ponto.`,
      ``,
      `REGRAS ABSOLUTAS:`,
      `- CADA parágrafo deve ser uma frase COMPLETA — termine com ponto final, nunca no meio de uma palavra.`,
      `- Sem preço, sem tamanho, sem markdown, sem numeração, sem prefácio, sem explicações.`,
      `- Responda APENAS os 4 parágrafos.`
    ].filter(l => l !== null).join('\n');

    try {
      const r = await callGemini(key, prompt, _foto64);
      desc = r ? r.replace(/^\d+[.)\s]+/gm, '').trim() : descLocal(cats, estado, tam, obs);
    } catch (err) {
      showErr(err.message);
      desc = descLocal(cats, estado, tam, obs);
    }
  } else {
    desc = descLocal(cats, estado, tam, obs);
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
