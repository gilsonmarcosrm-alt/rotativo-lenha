// Inventario Lenha: escolhe fotos da galeria e manda para o PC de casa. Quem le as etiquetas e o PC/Claude.
const $ = id => document.getElementById(id);
const nome = {
  get: () => { try { return localStorage.getItem('nome') || ''; } catch (e) { return ''; } },
  set: v => { try { localStorage.setItem('nome', v); } catch (e) {} },
};
function mostrar(id) { document.querySelectorAll('.tela').forEach(t => t.classList.remove('ativa')); $(id).classList.add('ativa'); }
function novaContagem() {
  const d = new Date(), z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}_${Math.random().toString(36).slice(2, 6)}`;
}

// deixa a foto leve (1600 px) para subir rapido; se nao der, manda a original
async function preparar(f) {
  try {
    let img, w, h;
    if (window.createImageBitmap) { img = await createImageBitmap(f); w = img.width; h = img.height; }
    else {
      img = await new Promise((ok, erro) => {
        const u = URL.createObjectURL(f), i = new Image();
        i.onload = () => { URL.revokeObjectURL(u); ok(i); }; i.onerror = erro; i.src = u;
      });
      w = img.naturalWidth; h = img.naturalHeight;
    }
    const s = Math.min(1, 1600 / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    if (img.close) img.close();
    const b = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.8));
    if (b && b.size) return b;
  } catch (e) {}
  return f.size < 8000000 ? f : null;
}

async function enviar(arquivos) {
  const lista = [...arquivos]; $('galeria').value = '';
  if (!lista.length) return;
  const sit = $('situacao');
  let destino;
  try { destino = await (await fetch('url.json?t=' + Date.now(), { cache: 'no-store' })).json(); }
  catch (e) { sit.textContent = 'Sem internet. Conecte no Wi-Fi ou nos dados e tente de novo.'; return; }
  try { const p = await fetch(destino.url + '/ping', { headers: { 'X-Chave': destino.chave } }); if (!p.ok) throw 0; }
  catch (e) { sit.textContent = 'O PC de casa não respondeu. Ele precisa estar ligado.'; return; }

  const contagem = novaContagem(), usuario = nome.get();
  const barra = $('barra'); barra.hidden = false; $('escolher').disabled = true;
  let feitos = 0, falhas = 0, prox = 0;
  async function trabalhador() {
    while (prox < lista.length) {
      const i = prox++;
      const corpo = await preparar(lista[i]);
      const info = btoa(unescape(encodeURIComponent(JSON.stringify(
        { id: i + 1, numero: null, letra: null, origem: 'galeria', usuario, data: new Date().toISOString() }))));
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
      sit.textContent = `Enviando ${feitos} de ${lista.length}...`;
    }
  }
  await Promise.all([1, 2, 3, 4, 5, 6].map(trabalhador));
  try {
    await fetch(destino.url + '/fim', { method: 'POST', headers: { 'X-Chave': destino.chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contagem, usuario, total: lista.length, falhas }) });
  } catch (e) {}
  barra.hidden = true; $('escolher').disabled = false;
  sit.textContent = falhas ? `Enviadas ${lista.length - falhas} de ${lista.length}. ${falhas} falharam: escolha essas de novo.`
    : `Pronto! ${lista.length} fotos enviadas. A lista chega no seu e-mail.`;
}

function mostrarInstalar() {
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) return;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent), el = $('instalar'); el.hidden = false;
  el.innerHTML = ios
    ? '<b>Para instalar o ícone:</b> no Safari, toque em Compartilhar (quadrado com seta) e depois em <b>Adicionar à Tela de Início</b>.'
    : '<b>Para instalar o ícone:</b> toque nos 3 pontinhos do Chrome e depois em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.';
}

if ('serviceWorker' in navigator) {
  // versao nova chegou: recarrega sozinho
  const tinha = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (tinha && !window._r) { window._r = 1; location.reload(); } });
  navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {});
}
function iniciar() { $('ola').textContent = 'Olá, ' + nome.get(); mostrar('telaInicio'); mostrarInstalar(); }
$('salvarNome').onclick = () => { const n = $('campoNome').value.trim(); if (!n) return; nome.set(n); iniciar(); };
$('escolher').onclick = () => $('galeria').click();
$('galeria').onchange = e => enviar(e.target.files);
if (nome.get()) iniciar(); else mostrar('telaNome');
