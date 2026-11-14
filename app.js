/* Inventário Lenha - app de contagem de paletes de lenha */
'use strict';
const $ = id => document.getElementById(id);
const VERSAO = '1';

// ---------- armazenamento (fotos ficam so dentro do app) ----------
let db;
function abrirBanco() {
  return new Promise((ok, erro) => {
    const r = indexedDB.open('contalenha', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('fotos', { keyPath: 'id', autoIncrement: true });
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
  const regs = await todos();
  $('total').textContent = regs.length;
  fotosTela = regs.length; $('contaCam').textContent = regs.length;
  $('ola').textContent = 'Olá, ' + cfg.nome;
  const pend = regs.filter(r => !r.enviado).length;
  const enviados = regs.length - pend;
  $('enviar').disabled = pend === 0;
  $('apagar').disabled = !regs.length;
  let s;
  if (!regs.length) s = 'Nenhuma foto ainda. Toque em CONTAR para começar.';
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
// a foto sai igual ao quadro deitado (16:9) que aparece na tela
function capturarQuadro() {
  const v = $('video'), vw = v.videoWidth, vh = v.videoHeight, alvo = 16 / 9;
  let sw = vw, sh = vh;
  if (vw / vh < alvo) sh = Math.round(vw / alvo); else sw = Math.round(vh * alvo);
  const sx = Math.round((vw - sw) / 2), sy = Math.round((vh - sh) / 2);
  const s = Math.min(1, 1400 / sw);
  const c = document.createElement('canvas');
  c.width = Math.round(sw * s); c.height = Math.round(sh * s);
  c.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
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
    data: new Date().toISOString(), contagem: cfg.contagem, foto: await blob.arrayBuffer(), enviado: false });
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
// galeria: manda direto para o PC, sem guardar no app (bem mais rapido)
async function importarGaleria(arquivos) {
  const lista = [...arquivos]; $('galeria').value = ''; if (!lista.length) return;
  const sit = $('situacao');
  let destino;
  try { destino = await (await fetch('url.json?t=' + Date.now(), { cache: 'no-store' })).json(); }
  catch (e) { sit.textContent = 'Sem internet. Conecte no Wi-Fi ou nos dados e tente de novo.'; return; }
  try { const p = await fetch(destino.url + '/ping', { headers: { 'X-Chave': destino.chave } }); if (!p.ok) throw 0; }
  catch (e) { sit.textContent = 'O PC de casa não respondeu. Ele precisa estar ligado.'; return; }
  const contagem = novaContagem(), usuario = cfg.nome, t0 = Date.now();
  const barra = $('barra'); barra.hidden = false;
  let feitos = 0, falhas = 0, prox = 0;
  async function trabalhador() {
    while (prox < lista.length) {
      const i = prox++;
      let corpo = null;
      try {
        const f = lista[i];
        const im = window.createImageBitmap ? await createImageBitmap(f) : await carregarImagem(f);
        const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, s = Math.min(1, 1280 / Math.max(w, h));
        const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); if (im.close) im.close();
        corpo = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.7));
      } catch (e) { corpo = lista[i].size < 8000000 ? lista[i] : null; }
      const info = btoa(unescape(encodeURIComponent(JSON.stringify({ id: i + 1, origem: 'galeria', usuario, data: new Date().toISOString() }))));
      let ok = false;
      for (let t = 0; t < 3 && !ok && corpo; t++) {
        try {
          const r = await fetch(`${destino.url}/foto?contagem=${encodeURIComponent(contagem)}&id=${i + 1}`, {
            method: 'PUT', body: corpo, headers: { 'X-Chave': destino.chave, 'X-Info': info, 'Content-Type': 'image/jpeg' } });
          ok = r.ok;
        } catch (e) {}
      }
      if (!ok) falhas++;
      feitos++; barra.firstElementChild.style.width = (100 * feitos / lista.length) + '%';
      const resta = Math.round((Date.now() - t0) / feitos * (lista.length - feitos) / 60000);
      sit.textContent = `Enviando ${feitos} de ${lista.length}... falta ${resta < 1 ? 'menos de 1 min' : 'uns ' + resta + ' min'}`;
    }
  }
  await Promise.all(Array.from({ length: 8 }, trabalhador));
  try {
    await fetch(destino.url + '/fim', { method: 'POST', headers: { 'X-Chave': destino.chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contagem, usuario, total: lista.length, falhas }) });
  } catch (e) {}
  barra.hidden = true;
  sit.textContent = falhas ? `Enviadas ${lista.length - falhas} de ${lista.length}. ${falhas} falharam: escolha essas de novo.`
    : `Pronto! ${lista.length} fotos enviadas. A lista chega no seu e-mail.`;
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

  const regs = await todos(), pend = regs.filter(r => !r.enviado);
  const barra = $('barra'); barra.hidden = false; $('enviar').disabled = true;
  let feitos = 0, falhas = 0;
  const fila = pend.slice();
  async function trabalhador() {
    while (fila.length) {
      const r = fila.shift();
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
      if (ok) { r.enviado = true; await atualizar(r); } else falhas++;
      feitos++; barra.firstElementChild.style.width = (100 * feitos / pend.length) + '%';
      $('situacao').textContent = `Enviando ${feitos} de ${pend.length}...`;
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
  const regs = await todos(), pend = regs.filter(r => !r.enviado).length;
  if (!confirm(pend ? `Apagar todas as ${regs.length} fotos do app? ${pend} ainda não foram enviadas.` : `Apagar todas as ${regs.length} fotos do app?`)) return;
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
async function verLista() {
  const regs = (await todos()).reverse();
  $('resumoLista').textContent = `${regs.length} fotos no app`;
  const l = $('lista'); l.querySelectorAll('img').forEach(im => URL.revokeObjectURL(im.src)); l.innerHTML = '';
  escolhendo = false; marcadas.clear();
  for (const r of regs.slice(0, 500)) {
    const d = document.createElement('div'); d.className = 'foto'; d.dataset.id = r.id;
    const img = document.createElement('img'); img.src = URL.createObjectURL(fotoBlob(r)); img.alt = ''; img.loading = 'lazy';
    d.onclick = () => {
      if (!escolhendo) return abrirFoto(img.src);
      marcadas.has(r.id) ? marcadas.delete(r.id) : marcadas.add(r.id); atualizarBarraLista();
    };
    d.append(img); l.append(d);
  }
  atualizarBarraLista(); mostrar('telaLista');
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
  $('btnGaleria').onclick = () => $('galeria').click();
  $('galeria').onchange = e => importarGaleria(e.target.files);
  $('apagar').onclick = apagarTudo;
  $('verLista').onclick = verLista;
  $('voltarLista').onclick = () => mostrar('telaInicio');
  $('selecionar').onclick = () => { escolhendo = !escolhendo; marcadas.clear(); atualizarBarraLista(); };
  $('tudo').onclick = () => { document.querySelectorAll('#lista .foto').forEach(d => marcadas.add(Number(d.dataset.id))); atualizarBarraLista(); };
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
