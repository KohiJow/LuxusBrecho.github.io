/* Roda no <head>, antes da primeira pintura. O app.js é módulo e só executa
   depois de baixar o SDK do Firebase, e até lá a tela já foi desenhada. Duas
   coisas não podem esperar por ele:

   1. O tema escuro salvo. Sem isto quem usa o escuro via a abertura do login
      inteira no tema claro e a tela escurecendo no meio da animação.
   2. A vendedora que já está logada. Sem isto ela via a tela de login começar
      a animar e ser cortada quando o Firebase confirmava a sessão. Com a marca
      'luxus-sessao' (o app.js grava ao entrar e apaga ao sair), o login fica
      escondido até o Firebase responder; se ele não responder em 3,5 s, o
      login aparece do mesmo jeito, para ninguém ficar diante de uma tela vazia. */
(function () {
  'use strict';
  var raiz = document.documentElement;
  try {
    if (localStorage.getItem('luxus-tema') === 'escuro') {
      raiz.setAttribute('data-theme', 'dark');
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', '#17110F');
    }
    if (localStorage.getItem('luxus-sessao') === '1') {
      raiz.classList.add('retomando');
      setTimeout(function () { raiz.classList.remove('retomando'); }, 3500);
    }
  } catch (e) { /* sem storage: tema claro e login normal */ }
})();
