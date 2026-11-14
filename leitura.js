// Conta Lenha - localiza o numero + letra impressos na etiqueta.
// Funciona no navegador e no Node (para testes). Entrada: {data,width,height} RGBA.
(function (root) {
  'use strict';

  // Reduz a imagem para no maximo `max` px no lado maior.
  function reduzir(img, max) {
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.round(img.width * s), h = Math.round(img.height * s);
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(img.height - 1, Math.floor(y / s));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(img.width - 1, Math.floor(x / s));
        const i = (sy * img.width + sx) * 4, o = (y * w + x) * 4;
        out[o] = img.data[i]; out[o + 1] = img.data[i + 1]; out[o + 2] = img.data[i + 2]; out[o + 3] = 255;
      }
    }
    return { data: out, width: w, height: h };
  }

  // Mascara de tinta preta: escuro e sem cor (ignora azul do giz e madeira).
  function mascaraPreta(img, limiar) {
    const { data, width: w, height: h } = img;
    const m = new Uint8Array(w * h);
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < limiar && mx - mn < 45) m[p] = 1;
    }
    return m;
  }

  // Fecha listras brancas finas dentro das letras (dilata e depois erode na vertical).
  function fecharVertical(m, w, h, k) {
    if (k < 1) return m;
    const d = new Uint8Array(w * h), e = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let v = 0;
        for (let t = -k; t <= k && !v; t++) { const yy = y + t; if (yy >= 0 && yy < h && m[yy * w + x]) v = 1; }
        d[y * w + x] = v;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let v = 1;
        for (let t = -k; t <= k && v; t++) { const yy = y + t; if (yy >= 0 && yy < h && !d[yy * w + x]) v = 0; }
        e[y * w + x] = v;
      }
    }
    return e;
  }

  // Componentes conectados (8 vizinhos).
  function componentes(m, w, h) {
    const lab = new Int32Array(w * h).fill(-1), comps = [], pilha = [];
    for (let p = 0; p < w * h; p++) {
      if (!m[p] || lab[p] >= 0) continue;
      const c = { x0: w, y0: h, x1: 0, y1: 0, area: 0, id: comps.length };
      lab[p] = c.id; pilha.push(p);
      while (pilha.length) {
        const q = pilha.pop(), x = q % w, y = (q - x) / w;
        c.area++;
        if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (m[n] && lab[n] < 0) { lab[n] = c.id; pilha.push(n); }
        }
      }
      c.w = c.x1 - c.x0 + 1; c.h = c.y1 - c.y0 + 1;
      comps.push(c);
    }
    return { comps, lab };
  }

  // Procura a linha "numero + letra": caracteres grandes, alinhados e proximos.
  function acharLinha(comps, w, h) {
    const cand = comps.filter(c =>
      c.h > h * 0.05 && c.h < h * 0.6 && c.w < c.h * 1.3 && c.w > 2 &&
      c.area / (c.w * c.h) > 0.12 && c.area / (c.w * c.h) < 0.95);
    let melhor = null;
    for (const base of cand) {
      // grupo = caracteres com altura parecida e na mesma faixa vertical
      const g = cand.filter(c => {
        const hr = c.h / base.h;
        if (hr < 0.5 || hr > 1.6) return false;
        const sobre = Math.min(c.y1, base.y1) - Math.max(c.y0, base.y0);
        return sobre > Math.min(c.h, base.h) * 0.5;
      }).sort((a, b) => a.x0 - b.x0);
      // corta em sequencias sem buracos grandes
      let seq = [], seqs = [];
      for (const c of g) {
        if (seq.length && c.x0 - seq[seq.length - 1].x1 > base.h * 1.2) { seqs.push(seq); seq = []; }
        seq.push(c);
      }
      if (seq.length) seqs.push(seq);
      for (const s of seqs) {
        if (!s.includes(base) || s.length < 2 || s.length > 7) continue;
        const hMed = s.reduce((a, c) => a + c.h, 0) / s.length;
        // tinta forte e grande pesa mais; prefere 3-5 caracteres
        const nota = hMed * s.length * (s.length >= 3 && s.length <= 5 ? 1.5 : 1);
        if (!melhor || nota > melhor.nota) melhor = { nota, chars: s, hMed };
      }
    }
    return melhor;
  }

  // Divide numero e letra no maior espaco entre caracteres.
  function dividir(chars) {
    let gi = chars.length - 1, gmax = -1;
    for (let i = 1; i < chars.length; i++) {
      const gap = chars[i].x0 - chars[i - 1].x1;
      if (gap > gmax) { gmax = gap; gi = i; }
    }
    return { numero: chars.slice(0, gi), letra: chars.slice(gi) };
  }

  // Desenha so os componentes escolhidos, preto no branco, com margem.
  function recortar(lab, w, chars, hMed, extras) {
    const ids = new Set(chars.map(c => c.id).concat(extras || []));
    let x0 = Math.min(...chars.map(c => c.x0)), x1 = Math.max(...chars.map(c => c.x1));
    let y0 = Math.min(...chars.map(c => c.y0)), y1 = Math.max(...chars.map(c => c.y1));
    // inclui pingo do i/j acima
    y0 = Math.max(0, y0 - Math.round(hMed * 0.45));
    const pad = Math.round(hMed * 0.35);
    const W = x1 - x0 + 1 + pad * 2, H = y1 - y0 + 1 + pad * 2;
    const out = new Uint8ClampedArray(W * H * 4).fill(255);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const l = lab[y * w + x];
      if (l >= 0 && (ids.has(l) || extras === 'todos')) {
        const o = ((y - y0 + pad) * W + (x - x0 + pad)) * 4;
        out[o] = out[o + 1] = out[o + 2] = 0;
      }
    }
    return { data: out, width: W, height: H };
  }

  // Pingos (do i/j) logo acima da letra.
  function pingos(comps, letra, hMed) {
    const lx0 = Math.min(...letra.map(c => c.x0)) - hMed * 0.2, lx1 = Math.max(...letra.map(c => c.x1)) + hMed * 0.2;
    const ly0 = Math.min(...letra.map(c => c.y0));
    return comps.filter(c => c.x0 >= lx0 && c.x1 <= lx1 && c.y1 < ly0 && c.y1 > ly0 - hMed * 0.6 && c.h < hMed * 0.4 && c.w < hMed * 0.5).map(c => c.id);
  }

  function localizar(imgOriginal) {
    const img = reduzir(imgOriginal, 900);
    const { width: w, height: h } = img;
    for (const limiar of [95, 120, 75]) {
      let m = mascaraPreta(img, limiar);
      m = fecharVertical(m, w, h, Math.max(1, Math.round(h * 0.006)));
      const { comps, lab } = componentes(m, w, h);
      const linha = acharLinha(comps, w, h);
      if (!linha) continue;
      const { numero, letra } = dividir(linha.chars);
      if (!numero.length || !letra.length || numero.length > 4) continue;
      const extras = pingos(comps, letra, linha.hMed);
      // reta pelo pe e pelo topo dos numeros: acompanha etiqueta torta
      const cx = c => (c.x0 + c.x1) / 2;
      const reta = sel => {
        const xs = numero.map(cx), ys = numero.map(sel), n = xs.length;
        const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
        let sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
        const k = n > 1 && sxx > 0 ? Math.max(-0.2, Math.min(0.2, sxy / sxx)) : 0;
        return x => my + k * (x - mx);
      };
      const retaBase = reta(c => c.y1), retaTopo = reta(c => c.y0);
      const xl = letra.reduce((a, c) => a + cx(c), 0) / letra.length;
      const base = retaBase(xl), topoNum = retaTopo(xl);
      const hNum = base - topoNum;
      const topoLetra = Math.min(...letra.map(c => c.y0));
      const fundoLetra = Math.max(...letra.map(c => c.y1));
      const larg = Math.max(...letra.map(c => c.x1)) - Math.min(...letra.map(c => c.x0));
      return {
        geo: { topo: (topoLetra - topoNum) / hNum, fundo: (fundoLetra - base) / hNum, pingo: extras.length > 0, fina: larg < hNum * 0.3, larg: larg / hNum, nN: numero.length },
        numeroImg: recortar(lab, w, numero, linha.hMed),
        letraImg: recortar(lab, w, letra, linha.hMed, extras),
        nNumero: numero.length, nLetra: letra.length,
        caixa: { x0: Math.min(...linha.chars.map(c => c.x0)) / w, y0: Math.min(...linha.chars.map(c => c.y0)) / h,
                 x1: Math.max(...linha.chars.map(c => c.x1)) / w, y1: Math.max(...linha.chars.map(c => c.y1)) / h }
      };
    }
    return null;
  }

  // Confere e corrige o resultado do OCR.
  function interpretar(txtNumero, txtLetra, geo) {
    const n = (txtNumero || '').replace(/[^0-9]/g, '');
    const bruto = (txtLetra || '').replace(/[^A-Za-z]/g, '').slice(0, 1);
    let l = bruto.toUpperCase();
    // i e j sao tracos finos e o OCR confunde: a perna do j desce abaixo da linha dos numeros
    if (geo && geo.larg !== undefined) {
      const confunde = !l || 'IJLTF1Y'.includes(l) || bruto === 'l';
      if (geo.larg < 0.55 && confunde) l = geo.fundo > 0.09 ? 'J' : 'I';   // traco fino: decide pela perna do j
      else if (geo.larg >= 0.55 && confunde) l = '';                        // separou errado: nao arrisca
    } else if (geo && (!l ? geo.fina : 'IJ'.includes(l) || bruto === 'L' || bruto === '1')) l = geo.fundo > 0.08 ? 'J' : 'I';
    const num = parseInt(n, 10);
    if (geo && geo.nN && n.length !== geo.nN) return { numero: isNaN(num) ? null : num, letra: l || null, ok: false }; // sobrou ou faltou digito
    const ok = n.length >= 1 && n.length <= 4 && num >= 1 && num <= 1255 && /^[A-Z]$/.test(l);
    return { numero: isNaN(num) ? null : num, letra: l || null, ok };
  }

  const api = { localizar, interpretar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Leitura = api;
})(this);
