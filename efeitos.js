/* Efeitos visuais do app. Tudo aqui é enfeite: se este arquivo falhar,
   o app continua funcionando igual, só sem as animações. Quem pediu menos
   movimento no celular (prefers-reduced-motion) não vê nada disso.

   O app.js não conhece este arquivo: ele só procura window.efeitos e, se
   existir, usa contar() nos números do histórico e trocarTema() na troca de
   tema. Fora isso, tudo aqui observa o DOM por conta própria. */
(function () {
  'use strict';

  const efeitos = window.efeitos = {};

  const reduz = window.matchMedia('(prefers-reduced-motion: reduce)');
  const semMovimento = () => reduz.matches;
  const mouse = window.matchMedia('(hover: hover) and (pointer: fine)');
  const raiz = document.documentElement;
  const temWaapi = typeof Element.prototype.animate === 'function';

  // No iPhone o :active (botão afundando no toque) só funciona se a página
  // tiver algum ouvinte de touchstart; o pointerdown abaixo não conta.
  document.addEventListener('touchstart', () => {}, { passive: true });

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
    // aba oculta no meio da onda: o animationend pode não vir
    setTimeout(() => onda.remove(), 1200);
  }, { passive: true });

  /* 2. Cabeçalho ganha sombra e o logo encolhe ao rolar.
     Só sombra, borda e transform: nada que mude a altura do cabeçalho. Antes
     o padding e o logo encolhiam de verdade, o conteúdo de baixo subia, o
     navegador corrigia a rolagem e a página voltava pra baixo de 8px: o
     cabeçalho ficava abrindo e fechando sem parar perto do topo. A folga de
     cima some sozinha pelo top: -8px do sticky (style.css). */
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

  /* 3. Troca de tema: o tema novo abre num círculo a partir do botão.
     Com View Transitions (Chrome 111+, Safari 18+) o círculo revela a tela
     nova de verdade. Sem elas (iPhone com iOS 17 ou antes, Firefox) um
     círculo da cor do tema novo cresce do toque, o tema troca por baixo dele
     e o círculo se desfaz. Nos dois casos as transições de cor do CSS ficam
     desligadas durante a troca, senão a tela nova aparece no meio do caminho
     entre uma cor e outra. */
  const semTransicao = () => raiz.classList.add('sem-transicao');
  const comTransicao = () => requestAnimationFrame(() => requestAnimationFrame(() => raiz.classList.remove('sem-transicao')));

  efeitos.trocarTema = function (troca) {
    if (semMovimento() || !temWaapi) return troca();
    const { x, y } = ultimoToque;
    const raio = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const circulo = r => `circle(${r}px at ${x}px ${y}px)`;

    if (document.startViewTransition) {
      const t = document.startViewTransition(() => { semTransicao(); troca(); });
      t.ready.then(() => {
        raiz.animate({ clipPath: [circulo(0), circulo(raio)] },
          { duration: 650, easing: 'cubic-bezier(.22,1,.36,1)', pseudoElement: '::view-transition-new(root)' });
      }).catch(() => {});
      t.finished.catch(() => {}).then(comTransicao);
      return;
    }

    const onda = document.createElement('div');
    onda.className = 'tema-onda';
    onda.setAttribute('aria-hidden', 'true');
    document.body.appendChild(onda);
    let trocou = false;
    const trocaUmaVez = () => {
      if (trocou) return;
      trocou = true;
      // congela a cor antes de trocar: a regra do CSS depende do tema atual
      onda.style.backgroundColor = getComputedStyle(onda).backgroundColor;
      semTransicao();
      troca();
      comTransicao();
    };
    const cresce = onda.animate({ clipPath: [circulo(0), circulo(raio)] },
      { duration: 520, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
    cresce.finished.catch(() => {}).then(() => {
      trocaUmaVez();
      const some = onda.animate({ opacity: [1, 0] }, { duration: 280, easing: 'ease-out', fill: 'forwards' });
      some.finished.catch(() => {}).then(() => onda.remove());
    });
    // aba oculta no meio da troca: o tema troca e o círculo sai mesmo assim
    setTimeout(() => { trocaUmaVez(); setTimeout(() => onda.remove(), 400); }, 1400);
  };

  /* 4. Números do histórico contam até o valor novo */
  efeitos.contar = function (el, alvo) {
    if (!el) return;
    const de = parseInt(el.textContent, 10) || 0;
    const id = (el._contaId || 0) + 1;
    el._contaId = id;
    if (de === alvo || semMovimento()) { el.textContent = alvo; return; }
    const ini = performance.now();
    const dur = 650;
    const passo = agora => {
      if (el._contaId !== id) return;
      const p = Math.min(1, Math.max(0, (agora - ini) / dur));
      const suave = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(de + (alvo - de) * suave);
      if (p < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  };

  /* 5. Confete nas cores da loja quando o anúncio fica pronto.
     Cada pedaço anima pela Web Animations API com números já calculados.
     Antes era um @keyframes com var(--ux) e companhia, e variável dentro de
     keyframes é justamente o que iPhone com Safari antigo não anima. */
  const cores = ['#F2795B', '#E8458B', '#2F6F86', '#F2B33D', '#C2405A', '#FFFDF9'];
  function festa(origem) {
    if (semMovimento() || !temWaapi) return;
    const r = origem.getBoundingClientRect();
    if (!r.width) return;
    const cx = r.left + r.width / 2;
    const cy = Math.max(40, r.top + 30);
    const caixa = document.createElement('div');
    caixa.className = 'confete';
    caixa.setAttribute('aria-hidden', 'true');
    document.body.appendChild(caixa);
    const total = 34;
    const voos = [];
    for (let i = 0; i < total; i++) {
      const p = document.createElement('i');
      const ang = (Math.PI * 2 * i) / total + Math.random() * 0.4;
      const forca = 70 + Math.random() * 110;
      const giro = Math.random() * 720 - 360;
      p.style.left = cx + 'px';
      p.style.top = cy + 'px';
      p.style.background = cores[i % cores.length];
      if (i % 3 === 0) p.classList.add('redondo');
      caixa.appendChild(p);
      // a curva vai em cada trecho (como no CSS), não na animação inteira:
      // o pedaço sobe rápido, freia, e cai de novo com a mesma curva
      const curva = 'cubic-bezier(.2,.6,.4,1)';
      voos.push(p.animate([
        { transform: 'translate(0, 0) rotate(0deg)', opacity: 1, easing: curva },
        { transform: `translate(${Math.cos(ang) * forca}px, ${Math.sin(ang) * forca - 60}px) rotate(${giro * 0.4}deg)`, opacity: 1, offset: 0.35, easing: curva },
        { transform: `translate(${Math.cos(ang) * forca * 1.4}px, ${160 + Math.random() * 220}px) rotate(${giro}deg)`, opacity: 0 }
      ], { duration: 1100 + Math.random() * 700, fill: 'forwards' }));
    }
    const tira = () => caixa.remove();
    Promise.all(voos.map(v => v.finished)).then(tira, tira);
    setTimeout(tira, 2600);
  }
  // Anúncio novo troca o texto da mensagem: é o sinal pra animar de novo.
  // O mesmo anúncio passa duas vezes (salvando e salvo, que no celular chega
  // um segundo depois); só texto diferente do último anima e solta confete.
  const card = document.getElementById('resultCard');
  const msg = document.getElementById('msgResult');
  let ultimaMensagem = '';
  if (card && msg && 'MutationObserver' in window) {
    new MutationObserver(() => {
      const texto = msg.textContent.trim();
      if (!texto || texto === ultimaMensagem) return;
      ultimaMensagem = texto;
      // O cartão que acabou de ganhar .visible já tem a entrada recém-criada
      // (getAnimations resolve o estilo agora, com o tempo ainda em zero); aí
      // não há o que reiniciar. Só o cartão que já estava na tela com o
      // anúncio anterior precisa entrar de novo.
      const acabouDeAparecer = typeof card.getAnimations === 'function'
        && card.getAnimations().some(a => a.animationName === 'resultIn' && !a.currentTime);
      requestAnimationFrame(() => {
        if (!card.classList.contains('visible')) return;
        if (!acabouDeAparecer) {
          card.style.animation = 'none';
          void card.offsetWidth;
          card.style.animation = '';
        }
        setTimeout(() => festa(card), 350);
      });
    }).observe(msg, { childList: true, characterData: true, subtree: true });
  }

  /* 6. Botão de copiar confirma em cima dele mesmo quando a cópia deu certo */
  const aviso = document.getElementById('toast');
  if (aviso && 'MutationObserver' in window) {
    new MutationObserver(() => {
      if (!aviso.classList.contains('on') || !/Copiado/.test(aviso.textContent)) return;
      document.querySelectorAll('[data-action="copiar"]').forEach(b => {
        b.classList.remove('ok');
        void b.offsetWidth;
        b.classList.add('ok');
        setTimeout(() => b.classList.remove('ok'), 1600);
      });
    }).observe(aviso, { attributes: true, attributeFilter: ['class'], childList: true });
  }

  /* 7. Itens do histórico do sétimo em diante entram conforme a rolagem.
     Só na entrada da lista (classe .entrando, posta pelo app.js): numa busca
     ou numa troca de status o cartão que muda de lugar não pode sumir. */
  const lista = document.getElementById('histList');
  if (lista && 'IntersectionObserver' in window && 'MutationObserver' in window) {
    const io = new IntersectionObserver(entradas => entradas.forEach(en => {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }), { rootMargin: '0px 0px -8% 0px' });
    new MutationObserver(() => {
      if (semMovimento() || !lista.classList.contains('entrando')) return;
      lista.querySelectorAll('.hist-item:nth-child(n+7):not(.in)').forEach(it => {
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
