// Firebase de mentira pro teste: nada sai pro projeto real.
// O e2e serve este arquivo (um módulo ES) no lugar dos três módulos do SDK
// (firebase-app.js, firebase-auth.js e firebase-firestore.js), então ele
// exporta tudo que o app.js importa. Cada URL vira uma instância separada do
// módulo, por isso o estado fica em window.
// O teste controla o comportamento por variáveis em window:
//   __atrasoDb   ms que a consulta de produtos demora
//   __seguraDb   se verdadeiro, a consulta só responde quando o teste chamar
//                window.__soltaDb() (mostra o esqueleto sem depender de relógio)
//   __atrasoAdd  ms que uma gravação nova demora pra ser confirmada (rede de verdade)
//   __docs       documentos que a consulta de produtos devolve
//   __falhaDb    se verdadeiro, a consulta de produtos falha com permission-denied
//   __authCb     callback do onAuthStateChanged, pra "entrar" sem senha
//   __usuariaSalva  se existir, o app abre ja logada com ela (sessao salva)
//   __escritas   tudo que o app tentou gravar, pra conferir o esquema
//   __aberturas  URLs que o app mandou pro window.open (WhatsApp), sem abrir nada
const w = window;
if (!w.__escritas) {
  w.__escritas = [];
  w.__aberturas = [];
  w.open = url => { w.__aberturas.push(String(url)); return null; };
}
const espera = ms => new Promise(ok => setTimeout(ok, ms || 0));
const anota = registro => { w.__escritas.push(registro); };

// app
export function initializeApp(config) { w.__config = config; return { options: config }; }

// auth
export const indexedDBLocalPersistence = { tipo: 'indexedDB' };
export const browserLocalPersistence = { tipo: 'local' };
export function initializeAuth(app, opcoes) { w.__opcoesAuth = opcoes; return { app }; }
export function connectAuthEmulator() { w.__emuladorLigado = true; }
export function onAuthStateChanged(auth, cb) { w.__authCb = cb; setTimeout(() => cb(w.__usuariaSalva || null), 0); return () => {}; }
export async function signInWithEmailAndPassword() { throw { code: w.__erroLogin || 'auth/invalid-credential' }; }
export async function sendPasswordResetEmail() { anota({ op: 'reset' }); if (w.__erroReset) throw { code: w.__erroReset }; }
export async function signOut() { if (w.__authCb) w.__authCb(null); }

// firestore
export function getFirestore(app) { return { app }; }
export function initializeFirestore(app, opcoes) { w.__opcoesFirestore = opcoes; return { app }; }
export function connectFirestoreEmulator() { w.__emuladorLigado = true; }
export const collection = (db, nome) => ({ nome });
export const where = (campo, op, valor) => ({ campo, op, valor });
export const query = (col, ...filtros) => ({ nome: col.nome, filtros });
export const doc = (db, nome, id) => ({ nome, id });
export async function getDocs(q) {
  if (w.__seguraDb) await new Promise(ok => { w.__soltaDb = ok; });
  await espera(w.__atrasoDb);
  if (w.__falhaDb) throw { code: 'permission-denied', message: 'Missing or insufficient permissions.' };
  const docs = (q.nome === 'products' ? (w.__docs || []) : []).map(d => ({ id: d.id, data: () => d.data }));
  return { docs, empty: !docs.length, size: docs.length, forEach: f => docs.forEach(f) };
}
export async function addDoc(col, dados) {
  const id = 'teste' + Math.random().toString(36).slice(2, 7);
  anota({ op: 'add', col: col.nome, id, dados });
  if (w.__atrasoAdd) await espera(w.__atrasoAdd);
  return { id };
}
export async function updateDoc(ref, dados) { anota({ op: 'update', col: ref.nome, id: ref.id, dados }); }
export async function deleteDoc(ref) { anota({ op: 'delete', col: ref.nome, id: ref.id }); }
