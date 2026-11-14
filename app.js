/* Inventário Lenha - app de contagem de paletes de lenha */
'use strict';
const $ = id => document.getElementById(id);
const VERSAO = '1';

// ---------- armazenamento (fotos ficam so dentro do app) ----------
let db;
// abrir o banco nunca mexe nas fotos guardadas (com 1.400 fotos o iPhone nao aguenta)
function abrirBanco() {
  return new Promise((ok, erro) => {
    const r = indexedDB.open('contalenha', 3);
    r.onupgradeneeded = e => {
      const d = r.result;
      const st = d.objectStoreNames.contains('fotos') ? r.transaction.objectStore('fotos') : d.createObjectStore('fotos', { keyPath: 'id', autoIncrement: true });
      if (st.indexNames.contains('env')) st.deleteIndex('env');
      if (!d.objectStoreNames.contains('enviadas')) d.createObjectStore('enviadas');
    };
    r.onsuccess = () => { db = r.result; ok(); };
    r.onerror = () => erro(r.error);
  });
}
function tx(modo, fn, lojas = 'fotos') {
  return new Promise((ok, erro) => {
    const t = db.transaction(lojas, modo);
    const s = Array.isArray(lojas) ? lojas.map(n => t.objectStore(n)) : t.objectStore(lojas);
    let res; const p = fn(s); if (p) p.onsuccess = () => { res = p.result; };
    t.oncomplete = () => ok(res); t.onerror = () => erro(t.error);
  });
}
const salvar = reg => tx('readwrite', s => s.add(reg));
const atualizar = reg => tx('readwrite', s => s.put(reg));
const todos = () => tx('readonly', s => s.getAll());
// contagens leves: so mexem nos numeros, nunca carregam as fotos
const contar = () => tx('readonly', s => s.count());
const todosIds = () => tx('readonly', s => s.getAllKeys());
const idsEnviadas = () => tx('readonly', s => s.getAllKeys(), 'enviadas');
async function idsPendentes() { const env = new Set(await idsEnviadas()); return (await todosIds()).filter(id => !env.has(id)); }
async function contarPendentes() { return (await idsPendentes()).length; }
const marcarEnviada = id => tx('readwrite', s => s.put(1, id), 'enviadas');
const pegarFoto = id => tx('readonly', s => s.get(id));
const limpar = () => tx('readwrite', ([f, e]) => { f.clear(); e.clear(); }, ['fotos', 'enviadas']);

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
  $('enviar').disabled = !total || enviando;
  $('enviar').textContent = total && !pend ? 'Enviar fotos de novo' : 'Enviar fotos';
  $('apagar').disabled = !total;
  let s;
  if (!total) s = 'Nenhuma foto ainda. Toque em CONTAR para começar.';
  else if (pend) s = `${regs.length} fotos guardadas no app. ${pend} ainda não enviadas. Toque em Enviar fotos quando tiver internet.`;
  else s = `Tudo enviado (${enviados} fotos). O app apaga essas fotos sozinho 1 hora depois do envio.`;
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
  const s = Math.min(1, 1024 / Math.max(v.videoWidth, v.videoHeight));
  let c = document.createElement('canvas');
  c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  if (c.height > c.width) c = girar(c, Math.abs(gravX) > 6 && gravX < 0 ? 1 : -1);
  return c;
}
const paraBlob = c => new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.6));
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
  // igual a versao 30 (que trouxe as 1441 no iPhone), so com: nova tentativa se uma foto falhar,
  // continuar de onde parou se o app fechar, e registro enviado ao PC para achar erros
  const todas = [...arquivos]; $('galeria').value = '';
  registrar(`galeria: escolheu ${todas.length} fotos`);
  if (!todas.length) return;
  const ja = lerImportadas(), chave = f => f.name + '|' + f.size;
  const lista = todas.filter(f => !ja.has(chave(f))), puladas = todas.length - lista.length;
  if (puladas) registrar(`galeria: ${puladas} ja estavam no app`);
  if (!lista.length) { alert(`Essas ${todas.length} fotos já estão no app.`); return; }
  importando = true;
  const barra = $('barra'); barra.hidden = false; $('btnGaleria').disabled = true;
  $('situacao').textContent = `Começando a trazer ${lista.length} fotos...`;
  let feitos = 0, prox = 0, perdidas = 0, desdeGravar = 0; const t0 = Date.now(), base = Number($('total').textContent) || 0;
  async function uma(f) {
    const im = window.createImageBitmap ? await createImageBitmap(f) : await carregarImagem(f);
    const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, s = Math.min(1, 1024 / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); if (im.close) im.close();
    const b = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.6));
    c.width = c.height = 0;
    if (!b) throw new Error('foto vazia');
    await salvar({ numero: null, letra: null, origem: 'galeria', repetida: false, usuario: cfg.nome,
      data: new Date().toISOString(), contagem: cfg.contagem, foto: await b.arrayBuffer(), enviado: false, env: 0 });
  }
  async function trabalhador() {
    while (prox < lista.length) {
      const f = lista[prox++];
      let ok = false, erro = '';
      // se o iPhone pausar o app, a foto do meio da erro: espera e tenta de novo (o relogio para enquanto o app esta pausado)
      for (let t = 0; t < 4 && !ok; t++) {
        if (t) await new Promise(r => setTimeout(r, 1500 * t));
        try { await uma(f); ok = true; } catch (e) { erro = String((e && e.message) || e); }
      }
      if (ok) { ja.add(chave(f)); if (++desdeGravar >= 10) { desdeGravar = 0; gravarImportadas(ja); } }
      else { perdidas++; if (perdidas <= 5) registrar(`galeria: foto ${f.name} nao entrou: ${erro}`); }
      feitos++;
      barra.firstElementChild.style.width = (100 * feitos / lista.length) + '%';
      $('total').textContent = base + feitos;
      const resta = Math.round((Date.now() - t0) / feitos * (lista.length - feitos) / 60000);
      $('situacao').textContent = `Trazendo ${feitos + puladas} de ${todas.length} (${Math.round(100 * (feitos + puladas) / todas.length)}%)... falta ${resta < 1 ? 'menos de 1 min' : 'uns ' + resta + ' min'}`;
      if (feitos % 100 === 0) registrar(`galeria: ${feitos} de ${lista.length} em ${Math.round((Date.now() - t0) / 1000)} s`);
    }
  }
  await Promise.all(Array.from({ length: 4 }, trabalhador));
  gravarImportadas(ja); importando = false;
  registrar(`galeria: terminou ${feitos - perdidas} de ${lista.length} em ${Math.round((Date.now() - t0) / 1000)} s, ${perdidas} nao entraram`);
  barra.hidden = true; $('btnGaleria').disabled = false;
  await atualizarInicio();
  if (perdidas) alert(`${perdidas} fotos não conseguiram entrar. Toque em "Trazer fotos da galeria" e escolha todas de novo: as que já entraram são puladas na hora.`);
  if (recarregarDepois) location.reload();
}
// registro para o PC: mostra ao Claude o que acontece no iPhone (nao espera resposta, nao atrasa nada)
let destinoLog = null;
function registrar(txt) {
  try {
    const v = (document.querySelector('p.sub[style]') || {}).textContent || '';
    const mandar = d => fetch(d.url + '/log', { method: 'POST', headers: { 'X-Chave': d.chave, 'Content-Type': 'text/plain' }, body: `[${cfg.nome} ${v}] ${txt}` }).catch(() => {});
    if (destinoLog) return mandar(destinoLog);
    fetch('url.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json()).then(d => { destinoLog = d; mandar(d); }).catch(() => {});
  } catch (e) {}
}
// espera o app estar na tela (o iPhone pausa tudo quando voce sai)
function visivel() {
  if (document.visibilityState !== 'hidden') return Promise.resolve();
  return new Promise(ok => {
    const fim = () => { document.removeEventListener('visibilitychange', f); clearInterval(t); setTimeout(ok, 300); };
    const f = () => { if (document.visibilityState !== 'hidden') fim(); };
    const t = setInterval(f, 1000);
    document.addEventListener('visibilitychange', f);
  });
}
let importando = false, recarregarDepois = false;
function lerImportadas() { try { return new Set(JSON.parse(localStorage.getItem('importadas') || '[]')); } catch (e) { return new Set(); } }
function gravarImportadas(s) { try { localStorage.setItem('importadas', JSON.stringify([...s])); } catch (e) {} }
// tela acesa enquanto traz ou envia fotos (o iPhone pausa tudo quando a tela apaga)
function manterTelaAcesa() {
  // nunca trava o app esperando: se o iPhone nao responder em 1 s, segue sem
  try {
    if (!navigator.wakeLock) return Promise.resolve(null);
    return Promise.race([navigator.wakeLock.request('screen').catch(() => null), new Promise(ok => setTimeout(() => ok(null), 1000))]);
  } catch (e) { return Promise.resolve(null); }
}
function soltar(t) { try { t && t.release(); } catch (e) {} }
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
let enviando = false;
// 1 hora depois de tudo enviado, o app apaga as fotos e comeca uma contagem nova (nao mistura contagens)
async function limparEnviadas() {
  let t; try { t = Number(localStorage.getItem('tudoEnviadoEm')); } catch (e) {}
  if (!t || Date.now() - t < 3600000 || enviando || importando) return;
  if (await contarPendentes()) return; // tem foto nova ainda nao enviada: nao apaga nada
  await limpar(); lidos = null; novaContagem();
  try { ['tudoEnviadoEm', 'enviando', 'importadas'].forEach(k => localStorage.removeItem(k)); } catch (e) {}
  await atualizarInicio();
}
// o envio foi interrompido (app fechado ou travou): ao abrir de novo, continua sozinho
async function retomarEnvio() {
  let f; try { f = localStorage.getItem('enviando'); } catch (e) {}
  if (f && !enviando && navigator.onLine !== false && await contarPendentes()) { $('situacao').textContent = 'Continuando o envio que ficou pela metade...'; enviar(); }
}
async function enviar() {
  if (enviando) return;
  let destino;
  try { destino = await (await fetch('url.json?t=' + Date.now(), { cache: 'no-store' })).json(); }
  catch (e) { alert('Sem internet. Conecte no Wi-Fi ou nos dados e tente de novo.'); return; }
  try {
    const ping = await fetch(destino.url + '/ping', { headers: { 'X-Chave': destino.chave } });
    if (!ping.ok) throw 0;
  } catch (e) { alert('O PC de casa não respondeu. Ele precisa estar ligado. Nenhuma foto foi apagada.'); return; }

  let pend = await idsPendentes();
  if (!pend.length) {
    const tudo = await todosIds();
    if (!tudo.length) return;
    if (!confirm(`Todas as ${tudo.length} fotos já foram enviadas. Enviar todas de novo?`)) return;
    await tx('readwrite', s => { s.clear(); }, 'enviadas'); pend = tudo;
  }
  enviando = true; try { localStorage.setItem('enviando', '1'); } catch (e) {}
  let trava = await manterTelaAcesa();
  const reacender = async () => { if (document.visibilityState === 'visible' && enviando) { soltar(trava); trava = await manterTelaAcesa(); } };
  document.addEventListener('visibilitychange', reacender);
  const barra = $('barra'); barra.hidden = false; $('enviar').disabled = true;
  let feitos = 0, falhas = 0, seguidas = 0, parou = false, recuperando = null, pulou = 0; const voltas = new Map();
  const fila = pend.slice();
  const espera = ms => new Promise(r => setTimeout(r, ms));
  const pingar = async d => { try { const c = new AbortController(); setTimeout(() => c.abort(), 8000);
    return (await fetch(d.url + '/ping', { headers: { 'X-Chave': d.chave }, signal: c.signal })).ok; } catch (e) { return false; } };
  // o PC caiu ou trocou de endereco: espera ate 3 minutos pelo endereco novo e continua sozinho
  const recuperar = () => recuperando || (recuperando = (async () => {
    let ate = Date.now() + 180000;
    while (Date.now() < ate) {
      const v0 = Date.now(); await visivel(); ate += Date.now() - v0; // tempo fora do app nao conta
      $('situacao').textContent = `Reconectando com o PC de casa... (${feitos} de ${pend.length} enviadas)`;
      try { const d = await (await fetch('url.json?t=' + Date.now(), { cache: 'no-store' })).json(); if (await pingar(d)) { destino = d; return true; } } catch (e) {}
      await espera(10000);
    }
    return false;
  })().then(ok => { recuperando = null; if (ok) seguidas = 0; else parou = true; return ok; }));
  async function mandar(r, info) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 45000);
    try {
      const resp = await fetch(`${destino.url}/foto?contagem=${encodeURIComponent(r.contagem)}&id=${r.id}`, {
        method: 'PUT', body: fotoBlob(r), signal: ctl.signal,
        headers: { 'X-Chave': destino.chave, 'X-Info': btoa(unescape(encodeURIComponent(JSON.stringify(info)))), 'Content-Type': 'image/jpeg' } });
      return resp.ok;
    } catch (e) { return false; } finally { clearTimeout(t); }
  }
  async function trabalhador() {
    while (fila.length && !parou) {
      const id = fila.shift(), r = await pegarFoto(id); if (!r) { feitos++; continue; }
      const info = { id: r.id, numero: r.numero, letra: r.letra, origem: r.origem, repetida: r.repetida, usuario: r.usuario, data: r.data };
      let ok = false;
      for (let t = 0; t < 3 && !ok && !parou; t++) {
        await visivel(); // app fora da tela: espera voltar, sem contar como erro
        if (recuperando) await recuperando;
        if (t) await espera(1500 * t);
        ok = await mandar(r, info);
      }
      if (ok) { await marcarEnviada(r.id); seguidas = 0; feitos++; }
      else if (document.visibilityState === 'hidden') { fila.unshift(id); continue; } // falhou porque saiu do app: tenta de novo ao voltar
      else if (parou) { fila.unshift(id); }
      else if ((voltas.get(id) || 0) >= 2) { pulou++; } // esta foto nao vai de jeito nenhum: fica para o proximo envio
      else { voltas.set(id, (voltas.get(id) || 0) + 1);
        if (++seguidas >= 6) { fila.unshift(id); await recuperar(); } else fila.push(id); // tenta de novo depois
        continue; }
      barra.firstElementChild.style.width = (100 * (feitos + pulou) / pend.length) + '%';
      if (!recuperando) $('situacao').textContent = `Enviando ${feitos} de ${pend.length} (${Math.round(100 * feitos / pend.length)}%)...`;
    }
  }
  await Promise.all(Array.from({ length: 8 }, trabalhador));
  falhas = pend.length - feitos;
  if (!falhas) {
    try {
      await fetch(destino.url + '/fim', { method: 'POST', headers: { 'X-Chave': destino.chave, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contagem: cfg.contagem, usuario: cfg.nome }) });
    } catch (e) {}
  }
  enviando = false; soltar(trava); document.removeEventListener('visibilitychange', reacender);
  if (!falhas) try { localStorage.removeItem('enviando'); localStorage.setItem('tudoEnviadoEm', String(Date.now())); } catch (e) {}
  barra.hidden = true; await atualizarInicio();
  if (recarregarDepois) setTimeout(() => location.reload(), 3000);
  alert(falhas ? (parou ? `O PC de casa parou de responder. ${falhas} fotos ficaram para depois. Toque em Enviar de novo daqui a 1 minuto (as já enviadas não vão de novo).` : `${falhas} fotos não foram enviadas. Toque em Enviar de novo.`) : 'Fotos enviadas! O PC já está montando o relatório.');
}

async function apagarTudo() {
  const total = await contar(), pend = await contarPendentes();
  if (!confirm(pend ? `Apagar todas as ${total} fotos do app? ${pend} ainda não foram enviadas.` : `Apagar todas as ${total} fotos do app?`)) return;
  await limpar(); lidos = null; try { ['enviando', 'importadas', 'tudoEnviadoEm'].forEach(k => localStorage.removeItem(k)); } catch (e) {} novaContagem(); atualizarInicio();
}

// ---------- lista: ver, selecionar e apagar ----------
const apagarIds = ids => tx('readwrite', ([f, e]) => { ids.forEach(id => { f.delete(id); e.delete(id); }); }, ['fotos', 'enviadas']);
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
let carregando = false;
async function maisFotos() {
  if (carregando || mostradas >= idsLista.length) return; carregando = true;
  const parte = idsLista.slice(mostradas, mostradas + 60); mostradas += parte.length;
  for (const id of parte) { const r = await pegarFoto(id); if (r) adicionarFoto(r); }
  $('maisFotos').hidden = mostradas >= idsLista.length;
  $('maisFotos').textContent = `Mostrar mais (${idsLista.length - mostradas} restantes)`;
  atualizarBarraLista(); carregando = false;
  // ainda perto do fim da tela: ja carrega a proxima parte
  if (!$('maisFotos').hidden && $('maisFotos').getBoundingClientRect().top < innerHeight * 3) maisFotos();
}
// rolagem continua: chegando perto do fim, carrega mais fotos sozinho
function perto() { const b = document.getElementById('maisFotos'); if (!b.hidden && b.getBoundingClientRect().top < innerHeight * 3) maisFotos(); }
addEventListener('scroll', perto, { passive: true });
if ('IntersectionObserver' in window) new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) maisFotos(); }, { rootMargin: '0px 0px 1500px 0px' }).observe(document.getElementById('maisFotos'));
async function verLista() {
  idsLista = (await todosIds()).reverse(); mostradas = 0; carregando = false;
  $('resumoLista').textContent = `${idsLista.length} fotos no app`;
  const l = $('lista'); l.querySelectorAll('img').forEach(im => URL.revokeObjectURL(im.src)); l.innerHTML = '';
  escolhendo = false; marcadas.clear();
  mostrar('telaLista'); scrollTo(0, 0); await maisFotos();
}
async function apagarMarcadas() {
  if (!marcadas.size || !confirm(`Apagar ${marcadas.size} foto(s) do app?`)) return;
  await apagarIds([...marcadas]); if (!(await contar())) try { localStorage.removeItem('importadas'); } catch (e) {}
  await atualizarInicio(); await verLista();
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

// qualquer erro inesperado aparece na tela (para o Gilson mandar print e o Claude saber o que foi)
addEventListener('error', e => { try { $('situacao').textContent = 'Erro: ' + (e.message || e); registrar('ERRO: ' + (e.message || e)); } catch (x) {} });
addEventListener('unhandledrejection', e => { try { const m = (e.reason && e.reason.message) || e.reason; $('situacao').textContent = 'Erro: ' + m; registrar('ERRO: ' + m); } catch (x) {} });
// ---------- inicio ----------
(async function () {
  await abrirBanco();
  pedirArmazenamentoFixo();
  if ('serviceWorker' in navigator) {
    // versao nova chegou: recarrega sozinho para o celular nunca ficar na velha
    const tinha = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (tinha && !window._recarregou) { window._recarregou = 1; if (importando || enviando) recarregarDepois = true; else location.reload(); } });
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
  $('btnGaleria').onclick = () => { registrar('galeria: abriu a escolha de fotos'); $('situacao').textContent = 'Depois de escolher as fotos, o iPhone leva um tempinho preparando. Aguarde: a barra aparece aqui.'; $('galeria').click(); };
  $('galeria').onchange = e => importarGaleria(e.target.files);
  $('apagar').onclick = apagarTudo;
  $('verLista').onclick = verLista;
  $('voltarLista').onclick = () => mostrar('telaInicio');
  $('selecionar').onclick = () => { escolhendo = !escolhendo; marcadas.clear(); atualizarBarraLista(); };
  $('tudo').onclick = () => { idsLista.forEach(id => marcadas.add(id)); atualizarBarraLista(); };
  $('maisFotos').onclick = maisFotos;
  $('apagarSel').onclick = apagarMarcadas;
  if (cfg.nome) { mostrar('telaInicio'); atualizarInicio(); iniciarOCR(); } else mostrar('telaNome');
  if (cfg.nome) setTimeout(async () => { registrar(`app abriu: ${await contar()} fotos no app, ${navigator.userAgent.slice(0, 120)}`); await limparEnviadas(); retomarEnvio(); }, 1500);
  document.addEventListener('visibilitychange', () => registrar('tela: ' + document.visibilityState));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && cfg.nome) retomarEnvio(); });
})();

// usado nos testes: processa uma imagem como se viesse da camera
window.testarImagem = async function (url) {
  const im = new Image(); im.src = url; await im.decode();
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
  c.getContext('2d').drawImage(im, 0, 0);
  return ler(c);
};
