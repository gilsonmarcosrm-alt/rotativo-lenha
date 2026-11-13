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
  const unicos = new Set(regs.filter(r => r.numero).map(chave));
  $('total').textContent = unicos.size;
  $('contaCam').textContent = unicos.size;
  $('ola').textContent = 'Olá, ' + cfg.nome;
  const pend = regs.filter(r => !r.enviado).length;
  const enviados = regs.length - pend;
  $('enviar').disabled = pend === 0;
  $('apagar').disabled = !(regs.length && pend === 0);
  let s;
  if (!regs.length) s = 'Nenhuma foto ainda. Toque em CONTAR para começar.';
  else if (pend) s = `${regs.length} fotos guardadas no app. ${pend} ainda não enviadas. Envie quando estiver no Wi-Fi do escritório.`;
  else s = `Tudo enviado (${enviados} fotos). Quando o Excel chegar no e-mail, toque em Apagar contagem.`;
  $('situacao').textContent = s;
}

// ---------- leitura (OCR no proprio celular, sem internet) ----------
let wNum, wLetra, prontoOCR;
function iniciarOCR() {
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
async function ler(canvas) {
  await iniciarOCR();
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const r = Leitura.localizar({ data: id.data, width: id.width, height: id.height });
  if (!r) return { ok: false };
  const a = (await wNum.recognize(paraCanvas(r.numeroImg))).data.text;
  const b = (await wLetra.recognize(paraCanvas(r.letraImg))).data.text;
  return Leitura.interpretar(a, b, r.geo);
}

// ---------- camera ----------
let fluxo = null, ocupado = false, pendente = null;
async function abrirCamera() {
  mostrar('telaCamera');
  iniciarOCR();
  try {
    fluxo = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    $('video').srcObject = fluxo;
    // lanterna, quando o celular permite
    const trilha = fluxo.getVideoTracks()[0];
    let pode = false;
    try { pode = !!(trilha.getCapabilities && trilha.getCapabilities().torch); } catch (e) {}
    const bt = $('lanterna'); bt.hidden = !pode; let acesa = false;
    bt.onclick = async () => {
      acesa = !acesa;
      try { await trilha.applyConstraints({ advanced: [{ torch: acesa }] }); bt.textContent = acesa ? '🔦 Apagar' : '🔦 Lanterna'; }
      catch (e) { acesa = false; }
    };
  } catch (e) {
    alert('Não consegui abrir a câmera. Libere o acesso à câmera para o Inventário Lenha nas configurações do celular.');
    fecharCamera();
  }
}
function fecharCamera() {
  if (fluxo) fluxo.getTracks().forEach(t => t.stop());
  fluxo = null; mostrar('telaInicio'); atualizarInicio();
}
// recorta a area do quadro guia (com folga) direto do video em boa resolucao
function capturarQuadro() {
  const v = $('video'), g = $('guia').getBoundingClientRect(), tela = v.getBoundingClientRect();
  const vw = v.videoWidth, vh = v.videoHeight;
  const esc = Math.max(tela.width / vw, tela.height / vh);
  const offX = (tela.width - vw * esc) / 2, offY = (tela.height - vh * esc) / 2;
  const folgaY = g.height * 0.25;
  let sx = (g.left - tela.left - offX) / esc, sy = (g.top - folgaY - tela.top - offY) / esc;
  let sw = g.width / esc, sh = (g.height + folgaY * 2) / esc;
  sx = Math.max(0, sx); sy = Math.max(0, sy); sw = Math.min(vw - sx, sw); sh = Math.min(vh - sy, sh);
  const s = Math.min(1, 1100 / sw);
  const c = document.createElement('canvas'); c.width = Math.round(sw * s); c.height = Math.round(sh * s);
  c.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}
const paraBlob = c => new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.72));
function vibrar(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }

async function processar(canvas) {
  if (ocupado) return; ocupado = true;
  const res = $('resultado'); res.className = 'lendo'; res.textContent = 'Lendo...';
  try {
    const [blob, r] = await Promise.all([paraBlob(canvas), ler(canvas)]);
    if (!r.ok) { abrirDigitar(blob); res.className = ''; return; }
    await registrar(blob, r.numero, r.letra, 'auto');
  } catch (e) {
    res.className = ''; alert('Erro ao ler a foto: ' + e.message);
  } finally { ocupado = false; }
}
async function registrar(blob, numero, letra, origem) {
  const regs = await todos();
  const repetida = regs.some(x => x.numero === numero && x.letra === letra);
  await salvar({ numero, letra, origem, repetida, usuario: cfg.nome, data: new Date().toISOString(), contagem: cfg.contagem, foto: blob, enviado: false });
  const res = $('resultado');
  if (repetida) {
    res.className = '';
    $('alertaTxt').textContent = `${numero} ${letra}`;
    $('alerta').classList.add('mostra');
    vibrar([400, 120, 400, 120, 400]);
  } else {
    res.className = 'ok'; res.textContent = `${numero} ${letra} ✓`;
    vibrar(80);
  }
  atualizarInicio();
}
function abrirDigitar(blob) {
  pendente = blob;
  $('fotoDigitar').src = URL.createObjectURL(blob);
  $('digNum').value = ''; $('digLetra').value = '';
  $('digitar').classList.add('mostra');
  vibrar([150, 80, 150]);
  setTimeout(() => $('digNum').focus(), 100);
}
async function salvarDigitado() {
  // aceita tudo junto ("358H" ou "358 h") em qualquer um dos dois campos
  const tudo = ($('digNum').value + ' ' + $('digLetra').value).toUpperCase();
  const n = parseInt((tudo.match(/\d{1,4}/) || [''])[0], 10), l = (tudo.match(/[A-Z]/) || [''])[0];
  if (!(n >= 1 && n <= 1255) || !/^[A-Z]$/.test(l)) { alert('Número de 1 a 1255 e uma letra de A a Z.'); return; }
  $('digitar').classList.remove('mostra');
  await registrar(pendente, n, l, 'digitado'); pendente = null;
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
            method: 'PUT', body: r.foto,
            headers: { 'X-Chave': destino.chave, 'X-Info': btoa(unescape(encodeURIComponent(JSON.stringify(info)))), 'Content-Type': 'image/jpeg' } });
          ok = resp.ok;
        } catch (e) {}
      }
      if (ok) { r.enviado = true; await atualizar(r); } else falhas++;
      feitos++; barra.firstElementChild.style.width = (100 * feitos / pend.length) + '%';
      $('situacao').textContent = `Enviando ${feitos} de ${pend.length}...`;
    }
  }
  await Promise.all([trabalhador(), trabalhador(), trabalhador(), trabalhador()]);
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
  if (!confirm('Apagar todas as fotos desta contagem do celular? Faça isso só depois de receber o Excel.')) return;
  await limpar(); novaContagem(); atualizarInicio();
}

// ---------- lista ----------
async function verLista() {
  const regs = (await todos()).reverse();
  const unicos = new Set(regs.map(chave)).size;
  $('resumoLista').textContent = `${unicos} paletes · ${regs.length} fotos`;
  const l = $('lista'); l.innerHTML = '';
  for (const r of regs.slice(0, 300)) {
    const d = document.createElement('div'); d.className = 'item';
    const img = document.createElement('img'); img.src = URL.createObjectURL(r.foto); img.alt = '';
    const b = document.createElement('b'); b.textContent = `${r.numero} ${r.letra}`;
    d.append(img, b);
    if (r.repetida) { const t = document.createElement('span'); t.className = 'tag rep'; t.textContent = 'repetida'; d.append(t); }
    if (r.origem === 'digitado') { const t = document.createElement('span'); t.className = 'tag man'; t.textContent = 'digitado'; d.append(t); }
    l.append(d);
  }
  mostrar('telaLista');
}

// ---------- inicio ----------
(async function () {
  await abrirBanco();
  pedirArmazenamentoFixo();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  $('salvarNome').onclick = () => {
    const n = $('campoNome').value.trim(); if (!n) return;
    cfg.nome = n; mostrar('telaInicio'); atualizarInicio(); iniciarOCR();
  };
  $('abrirCamera').onclick = abrirCamera;
  $('fecharCamera').onclick = fecharCamera;
  $('disparo').onclick = () => { if (!ocupado && $('video').videoWidth) processar(capturarQuadro()); };
  $('alerta').onclick = () => $('alerta').classList.remove('mostra');
  $('digOk').onclick = salvarDigitado;
  $('digCancela').onclick = () => { $('digitar').classList.remove('mostra'); pendente = null; };
  $('enviar').onclick = enviar;
  $('apagar').onclick = apagarTudo;
  $('verLista').onclick = verLista;
  $('voltarLista').onclick = () => mostrar('telaInicio');
  if (cfg.nome) { mostrar('telaInicio'); atualizarInicio(); iniciarOCR(); } else mostrar('telaNome');
})();

// usado nos testes: processa uma imagem como se viesse da camera
window.testarImagem = async function (url) {
  const im = new Image(); im.src = url; await im.decode();
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
  c.getContext('2d').drawImage(im, 0, 0);
  return ler(c);
};
