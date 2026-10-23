/*
 * cf-sayfa.js — Colorfigures sayfa özellikleri (yakınlaştırma, figür üstü uyarı, telefonda etiket listesi, çerçeve
 * yüksekliği, içini-gör gölgesi). Kaynak: colorfigures skill'i scripts/build.py içindeki HEAD/TAIL betikleri.
 *
 * LİSANS NOTU (MIT). MIT License. Copyright (c) 2026 April Zhu (Colorfigures; iso-glow) ve Tolga Cohce (iso-figure).
 * Telif ve izin notu bütün kopyalarda korunur; yazılım garantisiz verilir. Tam metin: LICENSE.
 *
 * Asıldan farkı: satır içi <script> yerine ayrı dosya (CSP script-src 'self'); her figür kurulumunda çağrılır ve
 * sökülebilir (cfKur → ui.sok); düğme adları (yakınlaştır/uzaklaştır/sıfırla) sözlükten; klavye takımı yok.
 * Stiller css/ogren.css içinde.
 */
'use strict';
(function (kok) {
const KC = kok.KitapCilt.ogren, { mountFigure, xrMount } = KC.cf;
// asıldaki window.FIG_A / window.LBL_U / global cfKur yerine KitapCilt.ogren altında
KC.FIG_A = () => innerWidth <= 560 ? 1.1 : .75;
KC.LBL_U = () => { if (innerWidth > 560) return 0; const s = document.getElementById('fig'); return s && s.clientWidth && s.viewBox.baseVal.width ? s.viewBox.baseVal.width / s.clientWidth : 0; };

/** Figürü kurar: mountFigure + xrMount + sayfa özellikleri. Dönen ui.sok() hepsini söker. */
KC.cfKur = function cfKur(cfg){
  const ui = mountFigure(cfg), M = cfg.metin || {};
  xrMount(() => ui, { xr: cfg.xr, etiket: cfg.etiket, degisti: cfg.gorunumDegisti });
  const on = (h, tip, fn, opt) => { h.addEventListener(tip, fn, opt); ui.temizle(() => h.removeEventListener(tip, fn, opt)); };
  const gozle = (hedef, fn, opt) => { const o = new MutationObserver(fn); o.observe(hedef, opt); ui.temizle(() => o.disconnect()); return o; };
  // rAF ve setTimeout kimlikleri ayrı sayaçlardır (aynı sayı ikisinde de olabilir): her biri kendi işleviyle iptal edilir
  const raf = [], zaman = [];
  ui.temizle(() => { raf.forEach(cancelAnimationFrame); zaman.forEach(clearTimeout); });
  const fig = document.getElementById('fig'), stage = document.querySelector('.cf-kok .stage');

  // anahtarların yeri (masaüstünde istatistiklerin üstünde, telefonda figürün altında)
  raf.push(requestAnimationFrame(() => { const v = document.querySelector('.cf-kok .vset'), s = document.getElementById('stats'), z = document.querySelector('.cf-kok .zwrap');
    if (!v) return; if (z && z.parentNode === v.parentNode) z.after(v); else if (s && s.parentNode) s.parentNode.insertBefore(v, s); }));

  // yakınlaştırma (iki parmak, ctrl/cmd + tekerlek, − 100% + düğmeleri)
  const wrap = document.createElement('div'); wrap.className = 'zwrap'; fig.parentNode.insertBefore(wrap, fig); wrap.appendChild(fig);
  const figF = document.getElementById('figF'); if (figF) wrap.appendChild(figF);   // filtreli durgun katman #fig'in üstünde
  const chip = document.createElement('div'); chip.className = 'zchip';
  const zb = (cls, ad, yazi) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.setAttribute('aria-label', ad || ''); b.textContent = yazi; chip.appendChild(b); return b; };
  const zm = zb('zm', M.uzaklas, '−'), zp = zb('zp', M.sifirla, '100%'), zi = zb('zi', M.yakinlas, '+');
  wrap.appendChild(chip);
  let s = 1, tx = 0, ty = 0;
  const box = () => ({ w: fig.clientWidth, h: fig.clientHeight });
  const grain = () => { const fl = document.getElementById('hand'); if (!fl) return;
    const ts = [...fl.querySelectorAll('feTurbulence')]; if (!ts.length) return;
    const g = ts.find(t => t.getAttribute('result') === 'n1') || ts[0];
    if (!g.dataset.f0) g.dataset.f0 = g.getAttribute('baseFrequency');
    const v = (parseFloat(g.dataset.f0) * s).toFixed(4); if (g.getAttribute('baseFrequency') !== v) g.setAttribute('baseFrequency', v); };
  const apply = () => { const { w, h } = box(); s = Math.min(5, Math.max(1, s));
    if (s <= 1.001){ s = 1; tx = ty = 0; } else { tx = Math.min(0, Math.max(w - w*s, tx)); ty = Math.min(0, Math.max(h - h*s, ty)); }
    fig.style.transform = s === 1 ? '' : `translate(${tx}px,${ty}px) scale(${s})`; wrap.classList.toggle('on', s > 1);
    zp.textContent = Math.round(s*100) + '%'; grain(); };
  const fd = document.getElementById('fdefsF'); if (fd) gozle(fd, () => grain(), { childList: true, subtree: true });
  const zoomAt = (k, px, py) => { const s2 = Math.min(5, Math.max(1, s*k)); tx = px - (px - tx)*s2/s; ty = py - (py - ty)*s2/s; s = s2; apply(); };
  const local = e => { const r = wrap.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  on(wrap, 'wheel', e => {
    if (e.ctrlKey || e.metaKey){ e.preventDefault(); const [x, y] = local(e); zoomAt(Math.exp(-Math.max(-50, Math.min(50, e.deltaY))*.006), x, y); }
    else if (s > 1){ e.preventDefault(); tx -= e.deltaX; ty -= e.deltaY; apply(); } }, { passive: false });
  const center = () => { const { w, h } = box(); return [w/2, h/2]; };
  zi.onclick = () => zoomAt(1.5, ...center());
  zm.onclick = () => zoomAt(1/1.5, ...center());
  zp.onclick = () => { s = 1; apply(); };
  on(chip, 'pointerdown', e => e.stopPropagation());
  const pts = new Map(); let pinch = null;
  const two = () => { const [a, b] = [...pts.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x)/2, y: (a.y + b.y)/2 }; };
  on(wrap, 'pointerdown', e => { if (e.pointerType !== 'touch') return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2){ pinch = two(); e.stopPropagation(); } }, true);
  on(wrap, 'pointermove', e => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size === 2){ e.stopPropagation(); e.preventDefault(); const n = two(), r = wrap.getBoundingClientRect();
      tx += n.x - pinch.x; ty += n.y - pinch.y; zoomAt(n.d / pinch.d, n.x - r.left, n.y - r.top); pinch = n; } }, true);
  const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
  on(wrap, 'pointerup', up, true); on(wrap, 'pointercancel', up, true);
  on(window, 'resize', apply);

  // masaüstünde çerçeve pencereye sığsın
  const fit = () => { fig.style.maxHeight = ''; if (innerWidth <= 560) return;
    const room = innerHeight * .78; if (room < fig.clientHeight) fig.style.maxHeight = Math.max(320, room) + 'px'; };
  raf.push(requestAnimationFrame(fit)); on(window, 'resize', fit); zaman.push(setTimeout(fit, 400));

  // uyarı balonu figürün üstünde
  const toast = document.getElementById('toast'); if (toast) wrap.appendChild(toast);

  // telefonda etiketler numaralı rozet, adlar figürün altında liste
  const lg = document.createElement('div'); lg.className = 'lgd'; wrap.parentNode.insertBefore(lg, wrap.nextSibling);
  const hs = document.createElement('style'); document.head.appendChild(hs); ui.temizle(() => hs.remove());
  let sig = '', sel = 0, qq = 0, names = '', num = new Map();
  const renum = () => { if (innerWidth > 560) return; const gs = [...fig.querySelectorAll('.tag[data-t]')];
    const key = gs.map(g => g.dataset.t).sort().join('|');
    if (key !== names){ names = key; num = new Map(); const vb = fig.viewBox.baseVal, cx = vb.x + vb.width/2;
      const at = g => { const r = g.querySelector('rect'); return r ? [+r.getAttribute('x') + r.getAttribute('width')/2, +r.getAttribute('y')] : [0, 0]; };
      gs.map(g => [g.dataset.t, ...at(g)]).sort((a, b) => ((a[1] > cx) - (b[1] > cx)) || a[2] - b[2]).forEach(([t]) => { if (!num.has(t)) num.set(t, num.size + 1); }); }
    for (const g of gs){ const n = String(num.get(g.dataset.t)); if (g.dataset.n !== n){ g.dataset.n = n; const t = g.querySelector('text'); if (t) t.textContent = n; } } };
  const mark = () => { hs.textContent = sel ? `#fig .tag[data-n="${sel}"] rect{fill:#231e16!important}#fig .tag[data-n="${sel}"] text{fill:#fff4d6}#fig .tag[data-n="${sel}"] path{stroke-width:2.4}` : '';
    for (const x of lg.children) x.classList.toggle('sel', +x.dataset.n === sel); };
  const upd = () => { qq = 0; const m = new Map();
    if (innerWidth <= 560) for (const g of fig.querySelectorAll('.tag[data-n]')){ const n = +g.dataset.n; if (!m.has(n)) m.set(n, [g.dataset.t, g.classList.contains('on')]); }
    const a = [...m].sort((x, y) => x[0] - y[0]), sg = JSON.stringify(a); if (sg === sig) return; sig = sg;
    lg.classList.toggle('has', a.length > 0); lg.textContent = '';
    for (const [n, [t, onn]] of a){ const b = document.createElement('button'); b.type = 'button'; b.dataset.n = n; if (onn) b.className = 'on';
      const bb = document.createElement('b'); bb.textContent = n; const sp = document.createElement('span'); sp.textContent = t; b.append(bb, sp); lg.appendChild(b); }
    mark(); };
  on(lg, 'click', e => { const b = e.target.closest('button'); if (!b) return; sel = sel === +b.dataset.n ? 0 : +b.dataset.n; mark(); });
  gozle(fig, () => { renum(); if (!qq) qq = requestAnimationFrame(upd); }, { childList: true, subtree: true }); renum();
  on(window, 'resize', () => { if (!qq) qq = requestAnimationFrame(upd); }); upd();
  ui.temizle(() => cancelAnimationFrame(qq));
  void stage;
  ui.dinlen(true);   // ilk kare doğrudan filtreli (aşama değişiminde filtresiz kare görünmez)
  return ui;
};
})(typeof self !== 'undefined' ? self : this);
