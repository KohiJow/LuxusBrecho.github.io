/* Efeitos visuais do app. Tudo aqui é enfeite: se este arquivo falhar,
   o app continua funcionando igual, só sem as animações. Quem pediu menos
   movimento no celular (prefers-reduced-motion) não vê nada disso. */
(function () {
  'use strict';

  const reduz = window.matchMedia('(prefers-reduced-motion: reduce)');
  const semMovimento = () => reduz.matches;
  const mouse = window.matchMedia('(hover: hover) and (pointer: fine)');

  // posição do último toque, usada pra abrir o círculo da troca de tema dali
  let ultimoToque = { x: window.innerWidth - 40, y: 40 };
  document.addEventListener('pointerdown', e => {
    ultimoToque = { x: e.clientX, y: e.clientY };
  }, { passive: true, capture: true });

  /* 1. Onda que sai do dedo nos botões */
  document.addEventListener('pointerdown', e => {
    const btn = e.target.closest('.btn, .nav-btn, .icon-btn');
    if (!btn || btn.disabled || semMovimento()) return;
    const r = btn.getBoundingClientRect();
    const tam = Math.max(r.width, r.height) * 2.2;
    const onda = document.createElement('span');
    onda.className = 'ripple';
    onda.style.width = onda.style.height = tam + 'px';
    onda.style.left = (e.clientX - r.left - tam / 2) + 'px';
    onda.style.top = (e.clientY - r.top - tam / 2) + 'px';
    btn.appendChild(onda);
    onda.addEventListener('animationend', () => onda.remove(), { once: true });
  }, { passive: true });

  /* 2. Cabeçalho encolhe e ganha sombra ao rolar */
  const header = document.querySelector('.header');
  if (header) {
    let pendente = false;
    window.addEventListener('scroll', () => {
      if (pendente) return;
      pendente = true;
      requestAnimationFrame(() => {
        header.classList.toggle('scrolled', window.scrollY > 8);
        pendente = false;
      });
    }, { passive: true });
  }

  /* 3. Troca de tema: o tema novo abre num círculo a partir do botão */
  const trocaOriginal = window.toggleTheme;
  if (typeof trocaOriginal === 'function' && document.startViewTransition) {
    window.toggleTheme = function () {
      if (semMovimento()) return trocaOriginal();
      const { x, y } = ultimoToque;
      const raio = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      const t = document.startViewTransition(() => trocaOriginal());
      t.ready.then(() => {
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${raio}px at ${x}px ${y}px)`] },
          { duration: 650, easing: 'cubic-bezier(.22,1,.36,1)', pseudoElement: '::view-transition-new(root)' }
        );
      }).catch(() => {});
    };
  }

  /* 4. Números do histórico contam até o valor novo */
  window.contar = function (el, alvo) {
    if (!el) return;
    const de = parseInt(el.textContent, 10) || 0;
    const id = (el._contaId || 0) + 1;
    el._contaId = id;
    if (de === alvo || semMovimento()) { el.textContent = alvo; return; }
    const ini = performance.now();
    const dur = 650;
    const passo = agora => {
      if (el._contaId !== id) return;
      const p = Math.min(1, (agora - ini) / dur);
      const suave = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(de + (alvo - de) * suave);
      if (p < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  };

  /* 5. Confete nas cores da loja quando o anúncio fica pronto */
  const cores = ['#F2795B', '#E8458B', '#2F6F86', '#F2B33D', '#C2405A', '#FFFDF9'];
  function festa(origem) {
    if (semMovimento()) return;
    const r = origem.getBoundingClientRect();
    if (!r.width) return;
    const cx = r.left + r.width / 2;
    const cy = Math.max(40, r.top + 30);
    const caixa = document.createElement('div');
    caixa.className = 'confete';
    caixa.setAttribute('aria-hidden', 'true');
    const total = 34;
    for (let i = 0; i < total; i++) {
      const p = document.createElement('i');
      const ang = (Math.PI * 2 * i) / total + Math.random() * 0.4;
      const forca = 70 + Math.random() * 110;
      p.style.left = cx + 'px';
      p.style.top = cy + 'px';
      p.style.background = cores[i % cores.length];
      p.style.setProperty('--ux', (Math.cos(ang) * forca) + 'px');
      p.style.setProperty('--uy', (Math.sin(ang) * forca - 60) + 'px');
      p.style.setProperty('--dx', (Math.cos(ang) * forca * 1.4) + 'px');
      p.style.setProperty('--dy', (160 + Math.random() * 220) + 'px');
      p.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
      p.style.animationDuration = (1.1 + Math.random() * 0.7) + 's';
      if (i % 3 === 0) p.classList.add('redondo');
      caixa.appendChild(p);
    }
    document.body.appendChild(caixa);
    setTimeout(() => caixa.remove(), 2200);
  }
  // cada anúncio novo troca o texto da mensagem: é o sinal pra animar de novo
  const card = document.getElementById('resultCard');
  const msg = document.getElementById('msgResult');
  if (card && msg && 'MutationObserver' in window) {
    new MutationObserver(() => {
      if (!msg.textContent.trim()) return;
      requestAnimationFrame(() => {
        if (!card.classList.contains('visible')) return;
        card.style.animation = 'none';
        void card.offsetWidth;
        card.style.animation = '';
        setTimeout(() => festa(card), 350);
      });
    }).observe(msg, { childList: true, characterData: true, subtree: true });
  }

  /* 6. Botão de copiar confirma em cima dele mesmo quando a cópia deu certo */
  const aviso = document.getElementById('toast');
  if (aviso && 'MutationObserver' in window) {
    new MutationObserver(() => {
      if (!aviso.classList.contains('on') || !/Copiado/.test(aviso.textContent)) return;
      document.querySelectorAll('[onclick^="copiar"]').forEach(b => {
        b.classList.remove('ok');
        void b.offsetWidth;
        b.classList.add('ok');
        setTimeout(() => b.classList.remove('ok'), 1600);
      });
    }).observe(aviso, { attributes: true, attributeFilter: ['class'], childList: true });
  }

  /* 7. Itens do histórico do sétimo em diante entram conforme a rolagem */
  const lista = document.getElementById('histList');
  if (lista && 'IntersectionObserver' in window && 'MutationObserver' in window) {
    const io = new IntersectionObserver(entradas => entradas.forEach(en => {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }), { rootMargin: '0px 0px -8% 0px' });
    new MutationObserver(() => {
      if (semMovimento()) return;
      lista.querySelectorAll('.hist-item:nth-child(n+7)').forEach(it => {
        it.classList.add('rv');
        io.observe(it);
      });
    }).observe(lista, { childList: true });
  }

  /* 8. Fundo do login acompanha o mouse de leve (só no computador) */
  const login = document.getElementById('loginScreen');
  if (login && mouse.matches) {
    let pendente = false, px = 0, py = 0;
    login.addEventListener('pointermove', e => {
      px = (e.clientX / window.innerWidth - 0.5) * 2;
      py = (e.clientY / window.innerHeight - 0.5) * 2;
      if (pendente || semMovimento()) return;
      pendente = true;
      requestAnimationFrame(() => {
        login.style.setProperty('--px', px.toFixed(3));
        login.style.setProperty('--py', py.toFixed(3));
        pendente = false;
      });
    }, { passive: true });
  }

  /* 9. A polaroid revela só quando a foto é nova, não a cada troca de aba */
  const foto = document.getElementById('preview');
  const zona = document.getElementById('previewZone');
  if (foto && zona && 'MutationObserver' in window) {
    foto.addEventListener('animationend', ev => {
      if (ev.animationName === 'develop') zona.classList.add('revelada');
    });
    new MutationObserver(() => zona.classList.remove('revelada'))
      .observe(foto, { attributes: true, attributeFilter: ['src'] });
  }
})();
