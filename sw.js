// Guarda o app no celular para funcionar sem internet no deposito.
// Com internet: sempre busca a versao nova. Sem internet: usa a guardada.
const CACHE = 'contalenha-v8';
const ARQUIVOS = ['./', 'index.html', 'app.js', 'leitura.js', 'manifest.json', 'img/logo.png', 'img/icone-180.png',
  'img/icone-192.png', 'img/icone-512.png', 'lib/tesseract.min.js', 'lib/worker.min.js', 'lib/eng.traineddata.gz',
  'lib/tesseract-core-lstm.wasm.js', 'lib/tesseract-core-simd-lstm.wasm.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(ARQUIVOS.map(u => fetch(new Request(u, { cache: 'reload' })).then(r => c.put(u, r)))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.endsWith('url.json')) return;
  const pesado = u.pathname.includes('/lib/') || u.pathname.includes('/img/');
  if (pesado) {
    // bibliotecas e imagens: guardadas primeiro (nao mudam)
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
    return;
  }
  // telas e codigo do app: tenta a internet primeiro, guarda a copia nova
  e.respondWith(fetch(new Request(e.request, { cache: 'no-store' })).then(resp => {
    if (resp.ok) { const copia = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); }
    return resp;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
