/* Inventário Lenha - app de contagem de paletes de lenha */
'use strict';
const $ = id => document.getElementById(id);
const VERSAO = '1';

// ---------- armazenamento (fotos ficam so dentro do app) ----------
let db;
function abrirBanco() {
  return new Promise((ok, erro) => {
    const r = indexedDB.open('contalenha', 2);
    r.onupgradeneeded = e => {
      const st = e.oldVersion < 1 ? r.result.createObjectStore('fotos', { keyPath: 'id', autoIncrement: true }) : r.transaction.objectStore('fotos');
      if (!st.indexNames.contains('env')) st.createIndex('env', 'env');
      // fotos antigas: marca uma por uma (sem carregar todas juntas)
      st.openCursor().onsuccess = ev => { const c = ev.target.result; if (!c) return;
        const v = c.value; if (v.env === undefined) { v.env = v.enviado ? 1 : 0; c.update(v); } c.continue(); };
    };
    r.onsuccess = () => { db = r.result; ok(); };
    r.onerror = () => erro(r.error);
  });
}
function tx(modo, fn) {
  return new Promise((ok, erro) => {
    const t = db.transaction('fotos', modo), s = t.objectStore('fotos');
    let res; const p = fn(s); if (p) p.onsuccess = () => { res = p.result; };
    t.oncomplete = () => ok(res); t.onerror = () => erro(t.error);
  });
}
const salvar = reg => tx('readwrite', s => s.add(reg));
const atualizar = reg => tx('readwrite', s => s.put(reg));
const todos = () => tx('readonly', s => s.getAll());
// contagens leves: nunca carregam as fotos
const contar = () => tx('readonly', s => s.count());
const contarPendentes = () => tx('readonly', s => s.index('env').count(0));
const idsPendentes = () => tx('readonly', s => s.index('env').getAllKeys(0));
const todosIds = () => tx('readonly', s => s.getAllKeys());
const pegarFoto = id => tx('readonly', s => s.get(id));
const limpar = () => tx('readwrite', s => s.clear());

const cfg = {
  get nome() { try { return localStorage.getItem('nome') || ''; } catch (e) { return ''; } },
  set nome(v) { try { localStorage.setItem('nome', v); } catch (e) {} },
  get contagem() {
    let c; try { c = localStorage.getItem('contagem'); } catch (e) {}
    if (!c) { c = novaContagem(); }
    return c;
  },
};
function novaContagem() {
  const d = new Date(), z = n => String(n).padStart(2, '0');
  const c = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}_${Math.random().toString(36).slice(2, 6)}`;
  try { localStorage.setItem('contagem', c); } catch (e) {}
  return c;
}
async function pedirArmazenamentoFixo() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
}

// ---------- telas ----------
function mostrar(id) {
  document.querySelectorAll('.tela').forEach(t => t.classList.remove('ativa'));
  $(id).classList.add('ativa');
}
const chave = r => r.numero + r.letra;

async function atualizarInicio() {
  const total = await contar(), regs = { length: total };
  $('total').textContent = total;
  fotosTela = total; $('contaCam').textContent = total;
  $('ola').textContent = 'Olá, ' + cfg.nome;
  const pend = await contarPendentes();
  const enviados = total - pend;
  $('enviar').disabled = pend === 0;
  $('apagar').disabled = !total;
  let s;
  if (!total) s = 'Nenhuma foto ainda. Toque em CONTAR para começar.';
  else if (pend) s = `${regs.length} fotos guardadas no app. ${pend} ainda não enviadas. Envie quando estiver no Wi-Fi do escritório.`;
  else s = `Tudo enviado (${enviados} fotos). Quando o Excel chegar no e-mail, toque em Apagar contagem.`;
  $('situacao').textContent = s;
}

// ---------- leitura (OCR no proprio celular, sem internet) ----------
let wNum, wLetra, prontoOCR;
function iniciarOCR() { return Promise.resolve();

  if (prontoOCR) return prontoOCR;
  const op = { workerPath: 'lib/worker.min.js', corePath: 'lib/', langPath: 'lib/', gzip: true, cacheMethod: 'none' };
  prontoOCR = (async () => {
    wNum = await Tesseract.createWorker('eng', 1, op);
    await wNum.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '7' });
    wLetra = await Tesseract.createWorker('eng', 1, op);
    await wLetra.setParameters({ tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', tessedit_pageseg_mode: '13' });
  })();
  return prontoOCR;
}
function paraCanvas(img) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return c;
}
function girar(c, sentido) {
  const g = document.createElement('canvas'); g.width = c.height; g.height = c.width;
  const x = g.getContext('2d'); x.translate(g.width / 2, g.height / 2); x.rotate(sentido * Math.PI / 2);
  x.drawImage(c, -c.width / 2, -c.height / 2); return g;
}
// celular deitado: se nao ler de primeira, tenta a foto girada
async function ler(canvas) {
  let r = await ler1(canvas);
  for (const sentido of [1, -1]) if (!r.ok) r = await ler1(girar(canvas, sentido));
  return r;
}
async function ler1(canvas) {
  await iniciarOCR();
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const r = Leitura.localizar({ data: id.data, width: id.width, height: id.height });
  if (!r) return { ok: false };
  const a = (await wNum.recognize(paraCanvas(r.numeroImg))).data.text;
  const b = (await wLetra.recognize(paraCanvas(r.letraImg))).data.text;
  return Leitura.interpretar(a, b, r.geo);
}

// ---------- camera: livre e rapida, sem travas ----------
let fluxo = null;
async function abrirCamera() {
  mostrar('telaCamera');
  iniciarOCR();
  try {
    fluxo = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    $('video').srcObject = fluxo;
    try { await $('video').play(); } catch (e) {} // iPhone: sem isso a tela da camera fica preta
    // lanterna, quando o celular permite
    const trilha = fluxo.getVideoTracks()[0];
    let pode = false;
    let cap = {};
    try { cap = trilha.getCapabilities ? trilha.getCapabilities() : {}; pode = !!cap.torch; } catch (e) {}
    // zoom, quando o celular permite
    const z = $('zooms'); z.innerHTML = '';
    if (cap.zoom && cap.zoom.max > 1) {
      const niveis = [cap.zoom.min < 1 ? cap.zoom.min : null, 1, 2, cap.zoom.max >= 4 ? 4 : null].filter(n => n && n >= cap.zoom.min && n <= cap.zoom.max);
      for (const n of niveis) {
        const b = document.createElement('button'); b.className = 'mini'; b.style.minWidth = '64px';
        b.textContent = (Math.round(n * 10) / 10) + 'x';
        b.onclick = async () => {
          try { await trilha.applyConstraints({ advanced: [{ zoom: n }] }); } catch (e) {}
          z.querySelectorAll('button').forEach(x => x.style.background = 'rgba(0,0,0,.5)'); b.style.background = '#e37400';
        };
        if (n === 1) b.style.background = '#e37400';
        z.append(b);
      }
      z.hidden = false;
    } else z.hidden = true;
    const bt = $('lanterna'); bt.hidden = !pode; let acesa = false;
    bt.onclick = async () => {
      acesa = !acesa;
      try { await trilha.applyConstraints({ advanced: [{ torch: acesa }] }); bt.textContent = acesa ? '🔦 Apagar' : '🔦 Lanterna'; }
      catch (e) { acesa = false; }
    };
  } catch (e) {
    alert('Não consegui abrir a câmera. Libere o acesso à câmera nas configurações do celular.');
    fecharCamera();
  }
}
function fecharCamera() {
  if (fluxo) fluxo.getTracks().forEach(t => t.stop());
  fluxo = null; mostrar('telaInicio'); atualizarInicio();
}
// foto da tela inteira, reduzida para enviar rapido
// foto inteira, sem corte, igual a camera do celular; se sair em pe, deita
function capturarQuadro() {
  const v = $('video');
  const s = Math.min(1, 1400 / Math.max(v.videoWidth, v.videoHeight));
  let c = document.createElement('canvas');
  c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  if (c.height > c.width) c = girar(c, Math.abs(gravX) > 6 && gravX < 0 ? 1 : -1);
  return c;
}
const paraBlob = c => new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.72));
// iPhone estraga Blob guardado no banco: guarda os bytes e remonta a foto na hora de usar
const fotoBlob = r => r.foto instanceof Blob ? r.foto : new Blob([r.foto], { type: 'image/jpeg' });
function abrirFoto(url) { $('fotoGrande').src = url; $('verFoto').style.display = 'flex'; }
function vibrar(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }

let fotosTela = 0;
let gravX = 0, gravY = 0;
addEventListener('devicemotion', e => { const g = e.accelerationIncludingGravity; if (g) { gravX = g.x || 0; gravY = g.y || 0; } });
async function disparar() {
  if (!$('video').videoWidth) return;
  let c = capturarQuadro();
  // celular deitado: a tela nao gira (igual a camera do celular), a foto sai deitada
  const f = $('flash'); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 60);
  vibrar(30);
  fotosTela++; $('contaCam').textContent = fotosTela;
  const blob = await paraBlob(c);
  // miniatura da ultima foto, como na camera do celular
  const m = $('miniatura'); if (m._url) URL.revokeObjectURL(m._url);
  m._url = URL.createObjectURL(blob); m.src = m._url; m.style.visibility = 'visible';
  const id = await salvar({ numero: null, letra: null, origem: 'auto', repetida: false, usuario: cfg.nome,
    data: new Date().toISOString(), contagem: cfg.contagem, foto: await blob.arrayBuffer(), enviado: false, env: 0 });
  fila.push({ id, canvas: c });
  processarFila();
}
// leitura em segundo plano: nao trava a camera; so avisa se for repetida
const fila = []; let lendo = false;
const pegar = id => tx('readonly', st => st.get(id));
let lidos = null; // numero+letra ja lidos -> id da foto (evita reler o banco inteiro a cada foto)
function carregarImagem(blob) {
  return new Promise((ok, erro) => {
    const u = URL.createObjectURL(blob), im = new Image();
    im.onload = () => { URL.revokeObjectURL(u); ok(im); };
    im.onerror = () => { URL.revokeObjectURL(u); erro(new Error('imagem')); };
    im.src = u;
  });
}
function reduzir(im) {
  const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
  const s = Math.min(1, 1400 / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); return c;
}
async function processarFila() { fila.length = 0; return; // leitura fica no PC

  if (lendo) return; lendo = true;
  if (!lidos) { lidos = new Map(); for (const x of await todos()) if (x.numero) lidos.set(x.numero + x.letra, x.id); }
  while (fila.length) {
    const item = fila.shift();
    try {
      const reg = await pegar(item.id); if (!reg) continue;
      const canvas = item.canvas || reduzir(await carregarImagem(fotoBlob(reg)));
      const r = await ler(canvas);
      if (!r.ok) continue;
      const k = r.numero + r.letra;
      const repetida = lidos.has(k) && lidos.get(k) !== item.id;
      if (!lidos.has(k)) lidos.set(k, item.id);
      reg.numero = r.numero; reg.letra = r.letra; reg.repetida = repetida;
      await atualizar(reg);
      if (item.galeria) continue;
      if (repetida) avisarRepetida(r.numero + ' ' + r.letra);
      else mostrarLido(r.numero + ' ' + r.letra);
    } catch (e) {}
  }
  lendo = false;
}
// fotos que ja estao na galeria do celular
// galeria: traz as fotos para dentro do app, varias ao mesmo tempo
async function importarGaleria(arquivos) {
  const lista = [...arquivos]; $('galeria').value = ''; if (!lista.length) return;
  const barra = $('barra'); barra.hidden = false; $('btnGaleria').disabled = true;
  let feitos = 0, prox = 0; const t0 = Date.now(), base = Number($('total').textContent) || 0;
  async function trabalhador() {
    while (prox < lista.length) {
      const f = lista[prox++];
      try {
        const im = window.createImageBitmap ? await createImageBitmap(f) : await carregarImagem(f);
        const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, s = Math.min(1, 1280 / Math.max(w, h));
        const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); if (im.close) im.close();
        const b = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.7));
        await salvar({ numero: null, letra: null, origem: 'galeria', repetida: false, usuario: cfg.nome,
          data: new Date().toISOString(), contagem: cfg.contagem, foto: await b.arrayBuffer(), enviado: false, env: 0 });
      } catch (e) {}
      feitos++; barra.firstElementChild.style.width = (100 * feitos / lista.length) + '%';
      $('total').textContent = base + feitos;
      const resta = Math.round((Date.now() - t0) / feitos * (lista.length - feitos) / 60000);
      $('situacao').textContent = `Trazendo ${feitos} de ${lista.length} (${Math.round(100 * feitos / lista.length)}%)... falta ${resta < 1 ? 'menos de 1 min' : 'uns ' + resta + ' min'}`;
    }
  }
  await Promise.all(Array.from({ length: 4 }, trabalhador));
  barra.hidden = true; $('btnGaleria').disabled = false;
  await atualizarInicio();
}
let tAviso;
function avisarRepetida(txt) {
  $('alertaTxt').textContent = txt; $('alerta').classList.add('mostra');
  vibrar([300, 100, 300]);
  clearTimeout(tAviso); tAviso = setTimeout(() => $('alerta').classList.remove('mostra'), 1800);
}
function mostrarLido(txt) {
  const r = $('resultado'); r.className = 'ok'; r.textContent = txt + ' ✓';
  clearTimeout(r._t); r._t = setTimeout(() => { r.className = ''; }, 1200);
}

// ---------- envio para o PC ----------
async function enviar() {
  let destino;
  try { destino = await (await fetch('url.json?t=' + Date.now(), { cache: 'no-store' })).json(); }
  catch (e) { alert('Sem internet. Conecte no Wi-Fi do escritório e tente de novo.'); return; }
  try {
    const ping = await fetch(destino.url + '/ping', { headers: { 'X-Chave': destino.chave } });
    if (!ping.ok) throw 0;
  } catch (e) { alert('O PC que recebe as fotos não respondeu. Ele precisa estar ligado. Nada foi apagado.'); return; }

  const pend = await idsPendentes();
  const barra = $('barra'); barra.hidden = false; $('enviar').disabled = true;
  let feitos = 0, falhas = 0;
  const fila = pend.slice();
  async function trabalhador() {
    while (fila.length) {
      const r = await pegarFoto(fila.shift()); if (!r) { feitos++; continue; }
      const info = { id: r.id, numero: r.numero, letra: r.letra, origem: r.origem, repetida: r.repetida, usuario: r.usuario, data: r.data };
      let ok = false;
      for (let t = 0; t < 3 && !ok; t++) {
        try {
          const resp = await fetch(`${destino.url}/foto?contagem=${encodeURIComponent(r.contagem)}&id=${r.id}`, {
            method: 'PUT', body: fotoBlob(r),
            headers: { 'X-Chave': destino.chave, 'X-Info': btoa(unescape(encodeURIComponent(JSON.stringify(info)))), 'Content-Type': 'image/jpeg' } });
          ok = resp.ok;
        } catch (e) {}
      }
      if (ok) { r.enviado = true; r.env = 1; await atualizar(r); } else falhas++;
      feitos++; barra.firstElementChild.style.width = (100 * feitos / pend.length) + '%';
      $('situacao').textContent = `Enviando ${feitos} de ${pend.length} (${Math.round(100 * feitos / pend.length)}%)...`;
    }
  }
  await Promise.all(Array.from({ length: 8 }, trabalhador));
  if (!falhas) {
    try {
      await fetch(destino.url + '/fim', { method: 'POST', headers: { 'X-Chave': destino.chave, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contagem: cfg.contagem, usuario: cfg.nome }) });
    } catch (e) {}
  }
  barra.hidden = true; await atualizarInicio();
  alert(falhas ? `${falhas} fotos não foram enviadas. Toque em Enviar de novo.` : 'Fotos enviadas! O Excel chega no seu e-mail em alguns minutos.');
}

async function apagarTudo() {
  const total = await contar(), pend = await contarPendentes();
  if (!confirm(pend ? `Apagar todas as ${total} fotos do app? ${pend} ainda não foram enviadas.` : `Apagar todas as ${total} fotos do app?`)) return;
  await limpar(); lidos = null; novaContagem(); atualizarInicio();
}

// ---------- lista: ver, selecionar e apagar ----------
const apagarIds = ids => tx('readwrite', st => { ids.forEach(id => st.delete(id)); });
let escolhendo = false; const marcadas = new Set();
function atualizarBarraLista() {
  $('selecionar').textContent = escolhendo ? 'Cancelar' : 'Selecionar';
  $('tudo').hidden = $('apagarSel').hidden = !escolhendo;
  $('apagarSel').textContent = `🗑 Apagar (${marcadas.size})`;
  $('apagarSel').disabled = !marcadas.size;
  document.querySelectorAll('#lista .foto').forEach(d => d.classList.toggle('marcada', marcadas.has(Number(d.dataset.id))));
}
let idsLista = [], mostradas = 0;
function adicionarFoto(r) {
  const d = document.createElement('div'); d.className = 'foto'; d.dataset.id = r.id;
  const img = document.createElement('img'); img.src = URL.createObjectURL(fotoBlob(r)); img.alt = '';
  d.onclick = () => {
    if (!escolhendo) return abrirFoto(img.src);
    marcadas.has(r.id) ? marcadas.delete(r.id) : marcadas.add(r.id); atualizarBarraLista();
  };
  d.append(img); $('lista').append(d);
}
async function maisFotos() {
  const parte = idsLista.slice(mostradas, mostradas + 40); mostradas += parte.length;
  for (const id of parte) { const r = await pegarFoto(id); if (r) adicionarFoto(r); }
  $('maisFotos').hidden = mostradas >= idsLista.length;
  $('maisFotos').textContent = `Mostrar mais (${idsLista.length - mostradas} restantes)`;
  atualizarBarraLista();
}
async function verLista() {
  idsLista = (await todosIds()).reverse(); mostradas = 0;
  $('resumoLista').textContent = `${idsLista.length} fotos no app`;
  const l = $('lista'); l.querySelectorAll('img').forEach(im => URL.revokeObjectURL(im.src)); l.innerHTML = '';
  escolhendo = false; marcadas.clear();
  mostrar('telaLista'); await maisFotos();
}
async function apagarMarcadas() {
  if (!marcadas.size || !confirm(`Apagar ${marcadas.size} foto(s) do app?`)) return;
  await apagarIds([...marcadas]); await atualizarInicio(); await verLista();
}

// ---------- aviso para instalar o icone ----------
function mostrarInstalar() {
  const inst = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (inst) return;
  const ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua), dentroApp = /FBAN|FBAV|Instagram|WhatsApp|Line\//.test(ua);
  const el = $('instalar'); el.hidden = false;
  if (ios && (dentroApp || !/Safari/.test(ua) || /CriOS|FxiOS/.test(ua)))
    el.innerHTML = '<b>Para instalar:</b> abra este link no <b>Safari</b>. Depois toque em Compartilhar (quadrado com seta) e em <b>Adicionar à Tela de Início</b>.';
  else if (ios)
    el.innerHTML = '<b>Para instalar o ícone:</b> toque em Compartilhar (quadrado com seta) e depois em <b>Adicionar à Tela de Início</b>.';
  else
    el.innerHTML = '<b>Para instalar o ícone:</b> toque nos 3 pontinhos do Chrome e depois em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.';
}

// ---------- inicio ----------
(async function () {
  await abrirBanco();
  pedirArmazenamentoFixo();
  if ('serviceWorker' in navigator) {
    // versao nova chegou: recarrega sozinho para o celular nunca ficar na velha
    const tinha = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (tinha && !window._recarregou) { window._recarregou = 1; location.reload(); } });
    navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {});
  }
  $('salvarNome').onclick = () => {
    const n = $('campoNome').value.trim(); if (!n) return;
    cfg.nome = n; mostrar('telaInicio'); atualizarInicio(); iniciarOCR();
  };
  $('abrirCamera').onclick = abrirCamera;
  $('fecharCamera').onclick = fecharCamera;
  $('disparo').onclick = disparar;
  $('miniatura').onclick = () => { if (!$('miniatura')._url) return; abrirFoto($('miniatura')._url); };
  $('verFoto').onclick = () => { $('verFoto').style.display = 'none'; };
  $('enviar').onclick = enviar;
  $('btnGaleria').onclick = () => { $('situacao').textContent = 'Depois de escolher as fotos, o iPhone leva um tempinho preparando. Aguarde: a barra aparece aqui.'; $('galeria').click(); };
  $('galeria').onchange = e => importarGaleria(e.target.files);
  $('apagar').onclick = apagarTudo;
  $('verLista').onclick = verLista;
  $('voltarLista').onclick = () => mostrar('telaInicio');
  $('selecionar').onclick = () => { escolhendo = !escolhendo; marcadas.clear(); atualizarBarraLista(); };
  $('tudo').onclick = () => { idsLista.forEach(id => marcadas.add(id)); atualizarBarraLista(); };
  $('maisFotos').onclick = maisFotos;
  $('apagarSel').onclick = apagarMarcadas;
  if (cfg.nome) { mostrar('telaInicio'); atualizarInicio(); iniciarOCR(); } else mostrar('telaNome');
})();

// usado nos testes: processa uma imagem como se viesse da camera
window.testarImagem = async function (url) {
  const im = new Image(); im.src = url; await im.decode();
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
  c.getContext('2d').drawImage(im, 0, 0);
  return ler(c);
};
