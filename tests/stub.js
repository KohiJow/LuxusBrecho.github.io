// Firebase de mentira pro teste: nada sai pro projeto real.
// O teste controla o comportamento por variaveis em window:
//   __atrasoDb  ms que o banco demora pra responder (mostra o esqueleto)
//   __docs      documentos que a consulta de produtos devolve
//   __falhaDb   se verdadeiro, a consulta de produtos falha com permission-denied
//   __authCb    callback do onAuthStateChanged, pra "entrar" sem senha
//   __escritas  tudo que o app tentou gravar, pra conferir o esquema
(function () {
  const atraso = () => window.__atrasoDb || 0;
  window.__escritas = [];
  function consulta(nome) {
    const q = {
      where: () => q, orderBy: () => q, limit: () => q,
      get: () => new Promise((ok, falha) => setTimeout(() => {
        if (window.__falhaDb) return falha({ code: 'permission-denied', message: 'Missing or insufficient permissions.' });
        const docs = (nome === 'products' ? (window.__docs || []) : []).map(d => ({ id: d.id, data: () => d.data }));
        ok({ docs, empty: !docs.length, size: docs.length, forEach: f => docs.forEach(f) });
      }, atraso())),
      add: async dados => {
        const id = 'teste' + Math.random().toString(36).slice(2, 7);
        window.__escritas.push({ op: 'add', col: nome, id, dados });
        return { id };
      },
      doc: id => ({
        update: async dados => { window.__escritas.push({ op: 'update', col: nome, id, dados }); },
        set: async dados => { window.__escritas.push({ op: 'set', col: nome, id, dados }); },
        delete: async () => { window.__escritas.push({ op: 'delete', col: nome, id }); },
        get: async () => ({ exists: false, data: () => ({}) })
      })
    };
    return q;
  }
  window.firebase = {
    initializeApp() {},
    firestore() { return { collection: consulta }; },
    auth() {
      return {
        onAuthStateChanged(cb) { window.__authCb = cb; setTimeout(() => cb(null), 0); return () => {}; },
        signInWithEmailAndPassword: async () => { throw { code: window.__erroLogin || 'auth/invalid-credential' }; },
        sendPasswordResetEmail: async () => { window.__escritas.push({ op: 'reset' }); if (window.__erroReset) throw { code: window.__erroReset }; },
        signOut: async () => { window.__authCb && window.__authCb(null); }
      };
    }
  };
})();
