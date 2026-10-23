/*
 * cf-engine.js — a modified copy of the Colorfigures drawing engine for the Mucellit "Learn" guide.
 *
 * LICENSE NOTE (MIT). Source: the colorfigures skill, assets/core.js (the unmodified original: the skill folder).
 * MIT License. Copyright (c) 2026 April Zhu (Colorfigures; iso-glow) and Tolga Cohce (iso-figure).
 * The software may be used, copied, modified and distributed free of charge, provided that the copyright and permission
 * notice is kept in all copies. Provided "AS IS", without warranty. Full text: the LICENSE file in this folder (app/js/learn/LICENSE).
 *
 * Differences from the original (only the page shell; the drawing, shading, ink and sorting functions are the same line by line):
 *  1. mountFigure attaches to a root element (cfg.root) and does not change document.body or document.title; there is
 *     no title, description or keypad (mountKeypad). The "Made with" link is turned off with credit:false as in the
 *     original (every Learn figure is set up with credit:false; the link is never drawn, no request is made).
 *  2. Every interface text comes from cfg.text (dictionary: i18n/en.js, i18n/tr.js); the engine writes no English of its own.
 *  3. ui.unmount(): removes the window/document listeners, observers, timers and animations (the figure is set up
 *     again when the stage changes).
 *  4. ui.busy(): is an animation other than the camera running ("play from start to end" waits for it). The animation
 *     speed is multiplied by Mucellit.learn.speed (1, 2, 4).
 *  5. No inline CSS is injected: css/learn.css (fits CSP style-src 'self' 'unsafe-inline'; no inline script).
 *  6. No ?press= test parameter (the tests use the controller's JS interface).
 *  7. One namespace: the engine is inside an IIFE; only Mucellit.learn.cf is exposed (drawing functions, palettes,
 *     mountFigure/xrMount; changing camera values through getters). The original's window.__ln, window.__st,
 *     the speed global of the prototype (→ Mucellit.learn.speed), window.FIG_A/LBL_U (→ Mucellit.learn.FIG_A/LBL_U), html.nolabels and
 *     :root --accent (→ the .cf-root root) are gone.
 *  8. Smoothness on Safari/WebKit: the hand-drawn filter (feTurbulence + feDisplacementMap) was recomputed on the CPU
 *     for every frame in WebKit (real Safari, Retina: 2–7 fps). The drawing has two layers: #fig (live, without the
 *     filter; every frame and every interaction happen here) and #figF above it (a filtered, still copy). When motion
 *     starts #figF fades out and #fig shows; when motion stops (160 ms) the last frame is copied to #figF and fades in.
 *     The copy is filtered only once, while still. Measured with the fps script of the Learn prototype.
 *  9. prefers-reduced-motion: steps finish without animation (the end state in one frame), transitions are instant.
 * 10. Label and text strings are written into the SVG escaped (esc).
 * 11. (added for the app) The page error log the stand-alone version kept for its tests (window 'error' listener,
 *     html[data-errors]) is removed so that no test leftover ships; the app's tests read errors from Playwright.
 *     A simplified version of the engine of the Learn prototype.
 */
'use strict';
(function (root) {
root.Mucellit = root.Mucellit || {};
const MC = root.Mucellit.learn = root.Mucellit.learn || {};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let LN = {};   // label numbers (per figure; window.__ln in the original)

/* ---------- palettes ---------- */
const PALS = {
  mustard: { l:'#f4b829', m:'#d49c1f', d:'#4e4a18' },
  tomato:  { l:'#ef6a4c', m:'#cf5038', d:'#4a2219' },
  mint:    { l:'#93d3b0', m:'#71b693', d:'#1f4034' },
  cobalt:  { l:'#76a0e2', m:'#5a82c6', d:'#1c2948' },
  blush:   { l:'#f3a6bb', m:'#d8869c', d:'#4b2430' },
};
const METAL   = { l:'#eef0f0', m:'#c6ccce', d:'#8f989b' };
const CLEAR   = { l:'#e4f2f4', m:'#c4dfe4', d:'#97b9c0' };
const CERAMIC = { l:'#fbfaf3', m:'#e3e0d2', d:'#bdb8a6' };
const DARK    = { l:'#55504a', m:'#3d3935', d:'#272421' };
const INK = '#231e16';

/* ---------- projection (x = depth toward viewer-right, y = toward viewer-left, z = up) ---------- */
const C = Math.cos(Math.PI/6), S = Math.sin(Math.PI/6);
let OX = 0, OY = 0;
/* Free orthographic camera (internal names start with CAM_ / cam so they never clash with a figure's own names). YAW turns the viewer around the vertical axis (45° = the classic front-left view),
   PITCH is how far it looks down (35.26° = true isometric). At the defaults P() is exactly the old isometric
   projection, so every figure drawn for it still lines up. Drag the figure to orbit; double-click to reset.
   rotV(n) maps a world direction into the default view's frame, so vis / tone / any "sum of rotV > 0" test keep
   working at every angle: the viewer is always (1,1,1) and the light stays put relative to the viewer. */
let VIEW = 0, RC = [0, 0], RCZ = 0;
const VIEW_NAMES = ['front', 'left side', 'back', 'right side'];
const TURNS = [0, 2];
const YAW0 = 45, PITCH0 = Math.atan(1/Math.SQRT2) * 180/Math.PI, CAM_K = Math.sqrt(1.5);
let YAW = YAW0, PITCH = PITCH0, CAM_R, CAM_U, CAM_V, CAM_D;                       // right, up, toward viewer, screen-down
const camBasis = (yaw, pitch) => { const t = yaw*Math.PI/180, p = pitch*Math.PI/180, ct = Math.cos(t), st = Math.sin(t), cp = Math.cos(p), sp2 = Math.sin(p);
  return { R:[st,-ct,0], U:[-sp2*ct,-sp2*st,cp], V:[cp*ct,cp*st,sp2] }; };
const CAM_B0 = camBasis(YAW0, PITCH0);
// CAM_LIM: how far (deg) the camera may turn either side of the front view; null = all the way round (set per figure)
let CAM_LIM = null;
function setCam(yaw, pitch){ YAW = CAM_LIM == null ? yaw : Math.max(YAW0 - CAM_LIM, Math.min(YAW0 + CAM_LIM, yaw));
  PITCH = CAM_LIM == null ? Math.max(6, Math.min(78, pitch)) : Math.max(15, Math.min(62, pitch)); const b = camBasis(YAW, PITCH); CAM_R = b.R; CAM_U = b.U; CAM_V = b.V; CAM_D = CAM_U.map(v => -v); }
setCam(YAW0, PITCH0);
const camDot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const rotV = n => { const r = camDot(n,CAM_R), u = camDot(n,CAM_U), v = camDot(n,CAM_V); return [0,1,2].map(i => CAM_B0.R[i]*r + CAM_B0.U[i]*u + CAM_B0.V[i]*v); };
// the light's ground direction turns with the viewer's yaw only (shadows always fall toward the lower left of the screen)
const yawTurn = ([x,y]) => { const t = (YAW - YAW0)*Math.PI/180, c = Math.cos(t), s = Math.sin(t); return [x*c - y*s, x*s + y*c]; };
const rotXY = (x,y) => [x, y];                                                // kept for old callers
const P0 = (x,y,z) => [(x-y)*C + OX, (x+y)*S - z + OY];                       // raw iso
const P  = (x,y,z) => { const q = [x-RC[0], y-RC[1], z-RCZ];
  return [CAM_K*camDot(q,CAM_R) + (RC[0]-RC[1])*C + OX, CAM_K*camDot(q,CAM_D) + (RC[0]+RC[1])*S - RCZ + OY]; };
const Dv = (x,y,z) => [CAM_K*camDot([x,y,z],CAM_R), CAM_K*camDot([x,y,z],CAM_D)];
// distance toward the viewer: draw parts with smaller depth first
const depthOf = p => camDot(p, CAM_V);
// sort [{at:[x,y,z], svg}] back-to-front for the current camera. A part may also give box:[[x0,y0,z0],[x1,y1,z1]]:
// when two boxes are separated along x, y or z, the one on the viewer's side goes last (a centre point alone gets long
// or wrapping parts wrong: a pole beside a row of keys, a spout reaching past a cup).
const boxMid = b => [0,1,2].map(k => (b[0][k] + b[1][k]) / 2);
const sepOrder = (p, q) => { if (!p.box || !q.box) return 0;
  for (let k = 0; k < 3; k++){ if (p.box[1][k] <= q.box[0][k] + 1e-6) return CAM_V[k] >= 0 ? -1 : 1; if (q.box[1][k] <= p.box[0][k] + 1e-6) return CAM_V[k] >= 0 ? 1 : -1; }
  return 0; };
const byDepth = parts => parts.filter(Boolean).sort((p,q) => sepOrder(p,q) || (depthOf(p.at || boxMid(p.box)) - depthOf(q.at || boxMid(q.box)))).map(p => p.svg).join('');
// the half of a vertical ring that faces the viewer / is turned away, as [from, to] angles in degrees (0 = +x, 90 = +y)
const nearHalf = () => [YAW - 90, YAW + 90], farHalf = () => [YAW + 90, YAW + 270];
// an open container (cup, bin, cone, drum) between two rings: far inner wall, then its contents, then the near outer wall
const openShell = (A, B, colour, contents = '') => loft(A, B, colour, true) + contents + loft(A, B, colour);
const f  = v => v.toFixed(1);
const pd = (pts, close=true) => 'M' + pts.map(p => { const q = P(p[0],p[1],p[2]); return f(q[0])+' '+f(q[1]); }).join('L') + (close ? 'Z' : '');
const sp = pts => 'M' + pts.map(q => f(q[0])+' '+f(q[1])).join('L') + 'Z';

/* ---------- 2D shapes in a plane's (u,v) coords (v up), mapped to 3D by a plane ---------- */
const arcUV  = (cu,cv,r,a0,a1,n=7) => { const o=[]; for (let i=0;i<=n;i++){ const a=(a0+(a1-a0)*i/n)*Math.PI/180; o.push([cu+r*Math.cos(a), cv+r*Math.sin(a)]); } return o; };
const rrUV   = (u0,v0,u1,v1,r,n=7) => r <= 0 ? rectUV(u0,v0,u1,v1) : [...arcUV(u1-r,v0+r,r,-90,0,n), ...arcUV(u1-r,v1-r,r,0,90,n), ...arcUV(u0+r,v1-r,r,90,180,n), ...arcUV(u0+r,v0+r,r,180,270,n)];
const rectUV = (u0,v0,u1,v1) => [[u0,v0],[u1,v0],[u1,v1],[u0,v1]];
const ellUV  = (cu,cv,ru,rv,n=24) => Array.from({length:n}, (_,i) => { const a=i/n*2*Math.PI; return [cu+ru*Math.cos(a), cv+rv*Math.sin(a)]; });
const PX = x => ([u,v]) => [x,u,v];      // front-facing plane x = const   (u = y, v = z)
const PY = y => ([u,v]) => [u,y,v];      // side plane y = const           (u = x, v = z)
const PZ = z => ([u,v]) => [u,v,z];      // horizontal plane z = const     (u = x, v = y)
const on = (plane, uv) => uv.map(plane);

/* ---------- vectors + shading ---------- */
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]], dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm=a=>{ const l=Math.hypot(...a)||1; return a.map(v=>v/l); };
const avg=ps=>ps.reduce((s,p)=>[s[0]+p[0]/ps.length,s[1]+p[1]/ps.length,s[2]+p[2]/ps.length],[0,0,0]);
const vis = n => { const r = rotV(n); return r[0]+r[1]+r[2] > 1e-6; };   // viewer looks from (+1,+1,+1) after the turn
const facing = vis;                                                       // readable alias: is this face toward the viewer?
const SHADOW_K = 0.85, AZ_MIN = 20, AZ_MAX = 160;
// cast shadows are drawn shorter than the shading light implies (0.45 × height instead of 0.85 ×): long shadows of tall
// parts on thin supports (a lamp shade, a fan head) land far from the object and read as separate blobs
const SHADOW_LEN = 0.45;
let L = [0,0,1], SH = [0,0];
function setLight(deg){ const a=deg*Math.PI/180; SH=[SHADOW_K*Math.cos(a), SHADOW_K*Math.sin(a)]; L=norm([-SH[0],-SH[1],1]); }
const LIN = norm([.6,.2,1]);                       // fixed light for interiors / small props
// Three flat tones, but blended across a narrow band at each step, so a face that turns past a threshold while the
// figure rotates fades between tones instead of snapping (at rest almost every face still sits on a pure tone).
const SOFT = .18;
const step3 = (d, hi, lo, m) => { const ss = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a)/(b - a))); return k*k*(3 - 2*k); };
  const a = ss(hi - SOFT, hi + SOFT, d), b = ss(lo - SOFT, lo + SOFT, d);
  return a >= 1 ? m.l : b <= 0 ? m.d : a > 0 ? mix(m.m, m.l, a) : b < 1 ? mix(m.d, m.m, b) : m.m; };
const tone  = (n,m) => step3(dot(rotV(n),L),   -.15, -.45, m);   // exterior, follows the sun
const toneI = (n,m) => step3(dot(rotV(n),LIN),  .6,   .05, m);   // interior / props
const mix = (a,b,t) => '#' + [1,3,5].map(i => Math.round(parseInt(a.substr(i,2),16)*(1-t) + parseInt(b.substr(i,2),16)*t).toString(16).padStart(2,'0')).join('');
const matOf = hex => ({ l:hex, m:mix(hex,'#000000',.16), d:mix(hex,'#000000',.42) });
const ease = t => t<.5 ? 2*t*t : 1-Math.pow(-2*t+2,2)/2;

/* ---------- drawing primitives (all return SVG strings) ---------- */
const ink   = (d,w=1.0) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`;
const fill  = (d,c,extra='') => `<path d="${d}" fill="${c}" ${extra}/>`;
const face  = (d,c) => `<path d="${d}" fill="${c}" stroke="${c}" stroke-width=".7" stroke-linejoin="round"/>`;
const shape = (pts,c,w=.9) => fill(pd(pts),c) + (w ? ink(pd(pts),w) : '');
const line  = (pts,w=.9) => ink(pd(pts,false),w);
// Loft between two rings of equal length (closed). colour(n) picks each strip's fill; flip = seen from inside.
function loft(A, B, colour, flip=false){
  const n=A.length, cen=avg(A.concat(B)); let s='';
  for (let i=0;i<n;i++){
    const a0=A[i], a1=A[(i+1)%n], b1=B[(i+1)%n], b0=B[i];
    let nr = norm(cross(sub(a1,a0), sub(b0,a0)));
    if (!isFinite(nr[0])) continue;
    if (dot(nr, sub(avg([a0,a1,b1,b0]), cen)) < 0) nr = nr.map(v=>-v);
    if (flip) nr = nr.map(v=>-v);
    if (vis(nr)) s += face(pd([a0,a1,b1,b0]), colour(nr));
  }
  return s;
}
function hull(pts){
  pts = pts.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]); const lo=[], up=[];
  for (const p of pts){ while(lo.length>=2 && cr(lo[lo.length-2],lo[lo.length-1],p)<=0) lo.pop(); lo.push(p); }
  for (const p of pts.reverse()){ while(up.length>=2 && cr(up[up.length-2],up[up.length-1],p)<=0) up.pop(); up.push(p); }
  lo.pop(); up.pop(); return lo.concat(up);
}
// Silhouette ink, weighted by how thick the part is on screen (like a hand inker): the w you pass is the most it gets.
// Thickness = 2 × area / perimeter of the outline (a rod's diameter, about half a box's width), as a share of the
// frame width. A long thin rod, a handle or a knob stays light (~1–1.5); a grinder, kettle or machine body gets the
// heavy ~2.4–2.8. Thin parts stay thin and parts keep air between them.
const hullInk = (pts3, w=1.4) => { const h = hull(pts3.map(p=>P(...p))); let a = 0, per = 0;
  for (let i = 0; i < h.length; i++){ const p = h[i], q = h[(i+1) % h.length]; a += p[0]*q[1] - q[0]*p[1]; per += Math.hypot(q[0]-p[0], q[1]-p[1]); }
  const thick = per ? Math.abs(a) / per / (INK_K * INK_REF_VB) : 0;
  return ink(sp(h), Math.min(w, .9 + 20*thick)); };
// Axis-aligned box: three visible faces, shaded, each outlined. shade = tone (sunlit) or toneI (interior).
function box(x0,y0,z0,x1,y1,z1,m,shade=toneI,w=.9){
  // all six faces, drawn only when they face the viewer (sides first, then top) — correct in every VIEW
  const F = [
    [[0,1,0],  [[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]]],
    [[1,0,0],  [[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1]]],
    [[0,-1,0], [[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]]],
    [[-1,0,0], [[x0,y0,z0],[x0,y1,z0],[x0,y1,z1],[x0,y0,z1]]],
    [[0,0,1],  [[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]]] ];
  return F.filter(([n]) => vis(n)).map(([n,q]) => shape(q, shade(n,m), w)).join('');
}
// Rounded-profile extrusion: profile (u=y, v=z) swept along x from x0 to x1. Body of most machines.
function extrude(profileUV, x0, x1, m, shade=tone){ return loft(on(PX(x0),profileUV), on(PX(x1),profileUV), n=>shade(n,m)); }
// Vertical cylinder (axis z) centred (x,y), radius r from z0 to z1, with top cap.
function cyl(x,y,z0,z1,r,m,shade=toneI,w=1.2,n=24){
  const A=on(PZ(z0),ellUV(x,y,r,r,n)), B=on(PZ(z1),ellUV(x,y,r,r,n));
  return loft(A,B,nr=>shade(nr,m)) + fill(pd(B),shade([0,0,1],m)) + hullInk([...A,...B],w) + ink(pd(B),w*.8);
}
// Cylinder lying along x (e.g. a knob or dial sticking out of a front face): centred (y,z), from x0 to x1.
function cylX(x0,x1,y,z,r,m,shade=toneI,w=1.1,n=20){
  const A=on(PX(x0),ellUV(y,z,r,r,n)), B=on(PX(x1),ellUV(y,z,r,r,n));
  // cap on whichever end faces the viewer (the +x end in VIEW 0)
  const capB = vis([1,0,0]), cap = capB ? B : A, cn = capB ? [1,0,0] : [-1,0,0];
  return loft(A,B,nr=>shade(nr,m)) + (vis(cn) ? fill(pd(cap),shade(cn,m)) : '') + hullInk([...A,...B],w) + (vis(cn) ? ink(pd(cap),w*.8) : '');
}
// Cylinder between any two 3D points a and b (a lamp arm, a rod, a pipe at an angle, a handle bar), radius r.
// The end facing the viewer gets a cap. For a tapered part (a cone, a lamp shade) pass r1 for the radius at b.
function rod(a, b, r, m, shade=toneI, w=1, r1=r, n=16){
  const d = norm(sub(b, a)), u = norm(cross(d, Math.abs(d[2]) < .9 ? [0,0,1] : [1,0,0])), v = cross(d, u);
  const ring = (p, rr) => Array.from({length:n}, (_,i) => { const t = i/n*2*Math.PI, c = Math.cos(t)*rr, s2 = Math.sin(t)*rr;
    return [p[0] + u[0]*c + v[0]*s2, p[1] + u[1]*c + v[1]*s2, p[2] + u[2]*c + v[2]*s2]; });
  const A = ring(a, r), B = ring(b, r1), capB = vis(d), cap = capB ? B : A, cn = capB ? d : d.map(x => -x);
  return loft(A, B, nr => shade(nr, m)) + (Math.max(r, r1) > 0 ? fill(pd(cap), shade(cn, m)) + ink(pd(cap), w*.8) : '') + hullInk([...A, ...B], w);
}
// Text lying flat on a front plane x = const, centred at (y,z) baseline; reads left-to-right on screen.
// text sits on a face: if its reading direction comes out mirrored (or edge-on), that face is turned away, so the text is hidden
const txM = (o, U, V) => (U[0]*V[1] - U[1]*V[0]) <= .02 * Math.hypot(...U) * Math.hypot(...V) ? `matrix(0 0 0 0 ${f(o[0])} ${f(o[1])})` : `matrix(${U[0].toFixed(4)} ${U[1].toFixed(4)} ${V[0].toFixed(4)} ${V[1].toFixed(4)} ${f(o[0])} ${f(o[1])})`;
const tx = (x,y,z,str,size,col=INK,weight=700) => { const o=P(x,y,z);
  return `<text transform="${txM(o, Dv(0,-1,0), Dv(0,0,-1))}" font-size="${size}" fill="${col}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-weight="${weight}" letter-spacing=".04em">${esc(str)}</text>`; };
// Text on a side plane y = const, centred at (x,z).
const txY = (x,y,z,str,size,col=INK,weight=700) => { const o=P(x,y,z);
  return `<text transform="${txM(o, Dv(1,0,0), Dv(0,0,-1))}" font-size="${size}" fill="${col}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-weight="${weight}" letter-spacing=".04em">${esc(str)}</text>`; };
// A board for the object to stand on (a tray, a desk top, a counter): a rounded slab from (x0,y0) to (x1,y1), h thick.
// Draw it first.
const BOARD = { l:'#e6e1d4', m:'#cfc8b8', d:'#aaa293' }, WOOD = { l:'#d9a86c', m:'#bf8a4f', d:'#8e6236' };
const boardTop = (x0,y0,x1,y1,h=3,r=5) => on(PZ(h), rrUV(x0,y0,x1,y1,r));
function board(x0,y0,x1,y1,h=3,r=5,m=BOARD){
  const A = on(PZ(0), rrUV(x0,y0,x1,y1,r)), B = boardTop(x0,y0,x1,y1,h,r);
  return loft(A, B, n => toneI(n, m)) + fill(pd(B), m.l) + ink(pd(B), 1) + hullInk([...A, ...B], 1.8);
}
// Group helpers: clickable target, clip to an opening.
const act  = (name, inner, data='') => `<g data-act="${name}" ${data}>${inner}</g>`;
let _clipN = 0;
// Part label (for "how does it work" figures): a cream pill with a leader line to a 3D point on the part.
// dx, dy = where the pill sits, in screen units at the reference zoom (they scale with the figure like stroke widths).
// on = that part is working right now (the pill turns the accent colour). Labels can be hidden with the Labels switch.
function tag(p3, dx, dy, text, on=false){
  // on a phone (LBL_U = drawing units per screen px) the pill is a numbered badge and the names go in a legend under the figure
  const u = MC.LBL_U ? MC.LBL_U() : 0, n = LN[text] || (LN[text] = Object.keys(LN).length + 1);
  const k = INK_K, [X,Y] = P(...p3), fs = u ? 10*u : 8.6*k, h = u ? 17*u : fs*1.8, w = u ? h*(n > 9 ? 1.3 : 1) : text.length*fs*.62 + fs*1.5, cx = X + dx*k, cy = Y + dy*k;
  return `<g class="tag${on ? ' on' : ''}" data-n="${n}" data-t="${esc(text)}"><path d="M${f(X)} ${f(Y)}L${f(cx)} ${f(cy)}" fill="none" stroke="${INK}" stroke-width="1"/>`
    + `<circle cx="${f(X)}" cy="${f(Y)}" r="${f(1.3*k)}" fill="${INK}"/>`
    + `<rect x="${f(cx-w/2)}" y="${f(cy-h/2)}" width="${f(w)}" height="${f(h)}" rx="${f(h/2)}" fill="${on ? 'var(--accent,#f4b829)' : '#fff4d6'}" stroke="${INK}" stroke-width="1.2"/>`
    + `<text x="${f(cx)}" y="${f(cy+fs*.36)}" font-size="${f(fs)}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-weight="800" letter-spacing=".04em" fill="${INK}">${u ? n : esc(text)}</text></g>`;
}
const clipTo = (pts3, inner) => { const id = 'k' + (++_clipN); return `<clipPath id="${id}"><path d="${pd(pts3)}"/></clipPath><g clip-path="url(#${id})">${inner}</g>`; };

/* ---------- constant on-screen line weight ----------
   Stroke widths are written in model units, and each figure is zoomed to fill the frame, so a small
   object would get fat lines. INK_K rescales every stroke-width (and the wobble/grain filter) so all
   figures match the reference zoom of the booth / vending machine (viewBox ≈ 585 units wide). */
const INK_REF_VB = 585;
let INK_K = 1;
const inkScale = svg => INK_K === 1 ? svg : svg.replace(/stroke-width="([\d.]+)"/g, (_, w) => `stroke-width="${(+w * INK_K).toFixed(2)}"`);


// Learn v2: the hand-drawn jitter slider is gone; the value is fixed at the old slider's lowest value (min="0").
const WOB_MIN = 0;
const filterFor = k => `<filter id="hand" x="-3%" y="-3%" width="106%" height="106%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="${(0.045/k).toFixed(4)}" numOctaves="2" seed="4" result="warp"/>
  <feDisplacementMap id="wob" in="SourceGraphic" in2="warp" scale="${(WOB_MIN*k).toFixed(2)}" xChannelSelector="R" yChannelSelector="G" result="wob"/>
  <feTurbulence type="fractalNoise" baseFrequency="${(0.9/k).toFixed(4)}" numOctaves="3" seed="11" result="n1"/>
  <feColorMatrix in="n1" type="matrix" values=".3 0 0 0 .84  .3 0 0 0 .84  .3 0 0 0 .84  0 0 0 0 1" result="grain"/>
  <feTurbulence type="fractalNoise" baseFrequency="${(0.012/k).toFixed(4)}" numOctaves="2" seed="7" result="n2"/>
  <feColorMatrix in="n2" type="matrix" values=".3 0 0 0 .85  .3 0 0 0 .85  .3 0 0 0 .85  0 0 0 0 1" result="blot"/>
  <feBlend in="wob" in2="grain" mode="multiply" result="g1"/><feBlend in="g1" in2="blot" mode="multiply" result="g2"/>
  <feComposite in="g2" in2="wob" operator="in"/></filter>`;

/* The hand-drawn filter's noise never changes, but browsers recompute every feTurbulence each time the drawing changes
   (on phones SVG filters run on the CPU, so this is most of the cost of a frame). bakeNoise renders each noise layer once
   into an image and swaps it in: coarse layers as one small image over the whole view (they are smooth, so scaling up
   is invisible), fine grain as a seamless tile. If anything fails (an old browser), the live filter simply stays. */
function bakeNoise(svg){
  const fl = document.getElementById('hand'); if (!fl || typeof Image === 'undefined') return;
  const NS = 'http://www.w3.org/2000/svg', vb = svg.viewBox.baseVal;
  const x0 = vb.x - vb.width*.35, y0 = vb.y - vb.height*.35, w0 = vb.width*1.7, h0 = vb.height*1.7;
  for (const t of [...fl.querySelectorAll('feTurbulence')]){
    const fq = parseFloat(t.getAttribute('baseFrequency')), oct = +(t.getAttribute('numOctaves') || 1);
    if (!(fq > 0)) continue;
    const fine = fq * Math.max(w0, h0) > 80;
    if (fine) continue;   // fine grain stays live: a repeated tile leaves faint seams on some GPUs
    const rx = fine ? 0 : x0, ry = fine ? 0 : y0, rw = fine ? 48 / fq : w0, rh = fine ? 48 / fq : h0;
    const ppu = fq * (fine ? 7 : 5) * Math.pow(2, Math.max(0, oct - 1) * .5), PW = Math.ceil(rw * ppu), PH = Math.ceil(rh * ppu);
    if (PW * PH > 1200 * 1200) continue;
    const tb = t.cloneNode(); tb.removeAttribute('result'); if (fine) tb.setAttribute('stitchTiles', 'stitch');
    const src = `<svg xmlns="${NS}" width="${PW}" height="${PH}" viewBox="${rx} ${ry} ${rw} ${rh}"><filter id="n" filterUnits="userSpaceOnUse" x="${rx}" y="${ry}" width="${rw}" height="${rh}" color-interpolation-filters="sRGB">${tb.outerHTML}</filter><rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" filter="url(#n)"/></svg>`;
    const img = new Image();
    img.onload = () => { try {
      const c = document.createElement('canvas'); c.width = PW; c.height = PH; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      // store the noise's colour values fully opaque: the filter reads its colour channels, and an image with
      // see-through pixels would be read premultiplied (darker) by some browsers
      const px = g.getImageData(0, 0, PW, PH); for (let i = 3; i < px.data.length; i += 4) px.data[i] = 255; g.putImageData(px, 0, 0);
      const url = c.toDataURL('image/png'), res = t.getAttribute('result');
      const im = document.createElementNS(NS, 'feImage');
      // a tile must sit inside the filter's region (the drawing's box) or it gets clipped: anchor it at the drawing's
      // centre, snapped to whole tiles so the grain keeps the same phase as the live noise would
      let ox = rx, oy = ry;
      if (fine){ const bb = svg.getElementById ? document.getElementById('art').getBBox() : { x: 0, y: 0, width: 0, height: 0 };
        ox = Math.floor((bb.x + bb.width/2) / rw) * rw; oy = Math.floor((bb.y + bb.height/2) / rh) * rh; }
      for (const [k, v] of [['x', ox], ['y', oy], ['width', rw], ['height', rh], ['preserveAspectRatio', 'none']]) im.setAttribute(k, v);
      im.setAttribute('href', url); im.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);
      if (!t.isConnected) return;
      if (fine){ im.setAttribute('result', res + '_tile'); const tl = document.createElementNS(NS, 'feTile'); tl.setAttribute('in', res + '_tile'); tl.setAttribute('result', res); t.replaceWith(im, tl); }
      else { im.setAttribute('result', res); t.replaceWith(im); }
    } catch (e) {} };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
  }
}

/* mountFigure({
     root: Element,                 // the element the figure is set up in (its content is removed)
     text: { view, from, rotates, see_inside, labels, zoom_in, zoom_out, reset, … },
     title, size:[W,D,H], center, state, scene(st, m), buttons:[{label, onClick(st, ui)}], stats(st), acts, turn:'full',
     xr: 0|1, label: true|false     // see inside / labels at the start (kept between stages)
   }) -> ui = { st, render, animate(step, camera), flash(text, ms), busy(), unmount(), camTo } */
function mountFigure(cfg){
  const root = cfg.root, M = cfg.text || {}, clear = [];
  const on = (h, type, fn, opt) => { h.addEventListener(type, fn, opt); clear.push(() => h.removeEventListener(type, fn, opt)); };
  LN = {};
  root.classList.add('cf-root', 'cf-motion');
  root.innerHTML = `
    <div class="stage">
      ${cfg.buttons && cfg.buttons.length ? '<div class="actions" id="btns"></div>' : ''}
      ${cfg.stats ? '<div class="stats" id="stats"></div>' : ''}
      <div class="toast" id="toast" role="status"></div>
      <svg id="fig" role="img"><defs id="fdefs"></defs><g id="art"></g></svg>
      <svg id="figF" aria-hidden="true" focusable="false"><defs id="fdefsF"></defs><g id="artF" filter="url(#hand)"></g></svg>
    </div>
    <div class="controls">
      <div class="ctl"><span class="ctl-name" id="l-see"></span><div class="row"><button type="button" id="vreset"></button><button type="button" id="vspin" aria-pressed="false"></button></div></div>
    </div>
    ${cfg.credit === false ? '' : '<footer class="made-with"><a href="https://april-zhu.com/colorfigures" target="_blank" rel="noopener">Made with Colorfigures ↗</a></footer>'}`;
  const write = (id, s) => { const e = document.getElementById(id); if (e) e.textContent = s || ''; };
  write('l-see', M.view); write('vreset', M.fromFront); write('vspin', M.rotates);
  document.getElementById('fig').setAttribute('aria-label', cfg.title || '');
  const st = cfg.state || {};
  st.pal = 'mustard';   // the accent colour is fixed: the yellow of the palette (the colour picker is gone)
  if (st.az == null) st.az = 105;
  const q = new URLSearchParams(location.search);
  CAM_LIM = cfg.turn === 'full' || q.get('free') === '1' ? null : 60;

  // frame: the same calculation as the original engine
  const [W,D,H] = cfg.size, pts = [];
  OX = OY = 0; RC = cfg.center || [W/2, D/2]; RCZ = H/2;
  VIEW = 0; setCam(YAW0, PITCH0);
  for (const x of [0,W]) for (const y of [0,D]) for (const z of [0,H]) pts.push(P(x,y,z));
  const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);
  const bw = Math.max(...xs)-Math.min(...xs), bh = Math.max(...ys)-Math.min(...ys);
  const PA = MC.FIG_A ? MC.FIG_A() : .75, A = PA === .75 ? .75 : Math.min(PA, Math.max(.75, bh/.88/(bw/.74)*1.08)), vbW = Math.max(bw/.74, bh/.88/A), vbH = vbW*A;
  OX = (vbW-bw)/2 + (PA === .75 ? vbW*.06 : 0) - Math.min(...xs); OY = (PA === .75 ? vbH*.04 : (vbH - bh)*.3) - Math.min(...ys);
  const svg = document.getElementById('fig'), figF = document.getElementById('figF');
  svg.setAttribute('viewBox', `0 0 ${f(vbW)} ${f(vbH)}`); figF.setAttribute('viewBox', `0 0 ${f(vbW)} ${f(vbH)}`);
  INK_K = vbW / INK_REF_VB;
  document.getElementById('fdefsF').innerHTML = filterFor(INK_K);
  bakeNoise(figF);

  const art = document.getElementById('art'), artF = document.getElementById('artF');
  const ui = { st, text: M, root };
  /* two layers (difference 8): motion = #fig visible, #figF faded; still = the last frame filtered in #figF.
     The transition is in CSS (learn.css: .cf-motion, opacity transition); figF follows the box and the zoom of #fig. */
  let motion = true, dinT = 0, artHam = null, copyRaw = null;
  const reconcile = () => { const s2 = figF.style; s2.left = svg.offsetLeft + 'px'; s2.top = svg.offsetTop + 'px'; s2.width = svg.offsetWidth + 'px'; s2.height = svg.offsetHeight + 'px'; s2.transform = svg.style.transform; };
  const intoMotion = () => { clearTimeout(dinT); if (!motion){ motion = true; root.classList.add('cf-motion'); } };
  ui.rest = (instant) => { clearTimeout(dinT); if (dead || steps.size) return;
    if (copyRaw !== artHam){ copyRaw = artHam;   // clip names are separate in the second layer (so that no id appears twice)
      artF.innerHTML = art.innerHTML.replace(/id="k(\d+)"/g, 'id="kF$1"').replace(/url\(#k(\d+)\)/g, 'url(#kF$1)'); }
    reconcile(); motion = false;
    if (instant){ root.classList.add('cf-instant'); root.classList.remove('cf-motion'); void figF.getBoundingClientRect(); requestAnimationFrame(() => root.classList.remove('cf-instant')); }
    else root.classList.remove('cf-motion'); };
  ui.still = () => !motion;
  ui.render = () => { _clipN = 0; root.style.setProperty('--accent', PALS[st.pal].l); const h = inkScale(cfg.scene(st, PALS[st.pal]));
    if (ui.drawStats) ui.drawStats();
    if (h === artHam){ if (motion){ clearTimeout(dinT); dinT = setTimeout(() => ui.rest(false), 160); } return; }
    art.innerHTML = h; artHam = h; intoMotion(); dinT = setTimeout(() => ui.rest(false), 160); };
  on(window, 'resize', reconcile);
  { const ro = new ResizeObserver(reconcile); ro.observe(svg); ro.observe(root); clear.push(() => ro.disconnect());
    const mo = new MutationObserver(reconcile); mo.observe(svg, { attributes: true, attributeFilter: ['style'] }); clear.push(() => mo.disconnect()); }
  const statsEl = document.getElementById('stats'), prevStats = {};
  ui.drawStats = () => { if (!statsEl) return;
    const list = cfg.stats(st).filter(Boolean);
    const key = JSON.stringify(list.map(x => [x.label, String(x.value), !!x.small]));
    if (statsEl._k === key) return; statsEl._k = key;
    statsEl.textContent = '';
    for (const x of list){ const d = document.createElement('div'); d.className = 'stat' + (x.small ? ' small' : '');
      const k = document.createElement('div'); k.className = 'k'; k.textContent = x.label;
      const v = document.createElement('div'); v.className = 'v'; v.textContent = String(x.value);
      if (prevStats[x.label] != null && prevStats[x.label] !== v.textContent) v.classList.add('bump'); prevStats[x.label] = v.textContent;
      d.append(k, v); statsEl.appendChild(d); } };
  let flashT = 0;
  const toast = document.getElementById('toast');
  ui.flash = (text, ms=1600) => { ui._flash = true; toast.textContent = text; toast.classList.add('show');
    clearTimeout(flashT); flashT = setTimeout(() => { ui._flash = false; toast.classList.remove('show'); }, ms / Math.max(1, (MC.speed || 1) / 2)); };
  // single frame driver (as in the original); camera animations are not counted by busy()
  const steps = new Set(), camera = new Set(); let driving = false, lastT = 0, fbT = 0, dead = false;
  // reduced motion (difference 9): every step runs to its end in this frame (chained sub-steps included), one frame is drawn
  const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;   // (root here is the figure root, not the window)
  const frame = () => { if (!driving || dead) return; driving = false; clearTimeout(fbT);
    const reducedMotion = reduce(), now = performance.now(), dt = reducedMotion ? 1e4 : Math.max(0, Math.min(.05, (now - lastT) / 1000)) * (MC.speed || 1); lastT = now;
    try { for (let kind = 0; kind < (reducedMotion ? 400 : 1) && steps.size; kind++) for (const s of [...steps]) if (s(dt) === false){ steps.delete(s); camera.delete(s); }
      ui.render(); }
    catch (e) { steps.clear(); camera.clear(); setTimeout(() => { throw e; }, 0); return; }   // the error is not hidden, but the animation does not get stuck
    if (steps.size) drive(); };
  const drive = () => { if (driving || dead) return; driving = true; requestAnimationFrame(frame); fbT = setTimeout(frame, 60); };
  // reduced motion: a step runs to its end as soon as it is added (inside the action, with the chained ones); no in-between frame is drawn
  let completing = false;
  const complete = () => { if (completing) return; completing = true;
    try { for (let kind = 0; kind < 400 && steps.size; kind++) for (const s of [...steps]) if (s(1e4) === false){ steps.delete(s); camera.delete(s); } }
    finally { completing = false; } };
  ui.animate = (step, isCamera) => { if (!steps.size && !driving) lastT = performance.now(); steps.add(step); if (isCamera) camera.add(step);
    if (reduce()){ complete(); if (!completing) drive(); return; } drive(); };
  ui.invalidate = () => drive();
  ui.busy = () => { for (const s of steps) if (!camera.has(s)) return true; return false; };

  on(svg, 'pointerdown', e => { if (e.button) return; const a = e.target.closest('[data-act]'); if (!a || !cfg.acts || !cfg.acts[a.dataset.act]) return;
    e.preventDefault(); cfg.acts[a.dataset.act](st, a, ui); ui.render(); });
  let drag = null, spin = false, camAnim = 0;
  const camTo = (y, p, ms=700) => { const y0 = YAW, p0 = PITCH, dy = ((y - y0 + 540) % 360) - 180, id = ++camAnim; let t = 0;
    ui.animate(dt => { if (id !== camAnim) return false; t += dt*1000; const k = Math.min(1, t / ms), e = ease(k); setCam(y0 + dy*e, p0 + (p - p0)*e); return k < 1; }, true); };
  ui.camTo = camTo;
  on(svg, 'pointerdown', e => { if (e.button || e.target.closest('[data-act]')) return;
    camAnim++; drag = { x:e.clientX, y:e.clientY, yaw:YAW, pitch:PITCH }; svg.classList.add('drag'); try { svg.setPointerCapture(e.pointerId); } catch (_) {} });
  on(svg, 'pointermove', e => { if (!drag) return; const k = 300 / svg.getBoundingClientRect().width;
    setCam(drag.yaw + (e.clientX - drag.x)*.55*k, drag.pitch + (e.clientY - drag.y)*.35*k); ui.invalidate(); });
  const endDrag = () => { drag = null; svg.classList.remove('drag'); };
  on(svg, 'pointerup', endDrag); on(svg, 'pointercancel', endDrag);
  on(svg, 'dblclick', e => { if (!e.target.closest('[data-act]')) camTo(YAW0, PITCH0); });
  on(window, 'keydown', e => { const k = { ArrowLeft:[-15,0], ArrowRight:[15,0], ArrowUp:[0,8], ArrowDown:[0,-8] }[e.key];
    if (!k || !e.target || !e.target.closest || !e.target.closest('.cf-root') && e.target !== document.body) return;
    if (/input|textarea|select/i.test(e.target.tagName)) return; e.preventDefault(); camTo(YAW + k[0], PITCH + k[1], 260); });
  const vsp = document.getElementById('vspin');
  document.getElementById('vreset').onclick = () => { spin = false; vsp.setAttribute('aria-pressed', false); camTo(YAW0, PITCH0); };
  vsp.onclick = () => { if (reduce()){ spin = false; vsp.setAttribute('aria-pressed', false); return; }   // reduced motion: no continuous rotation
    spin = !spin; vsp.setAttribute('aria-pressed', spin); camAnim++;
    let dir = 1;
    if (spin) ui.animate(dt => { if (!spin || dead) return false; if (!drag){ let y = YAW + dir*dt*18;
      if (CAM_LIM != null && Math.abs(y - YAW0) >= CAM_LIM - .5){ dir = -dir; y = YAW + dir*dt*18; } setCam(y, PITCH); } return true; }, true); };
  if (q.has('yaw') || q.has('pitch')) setCam(+(q.get('yaw') ?? YAW0), +(q.get('pitch') ?? PITCH0));
  const btns = document.getElementById('btns');
  ui.buttons = [];
  if (btns) cfg.buttons.forEach(b => {
    const wrap = document.createElement('div'); wrap.className = 'stepwrap';
    const el = document.createElement('button'); el.type = 'button'; el.className = 'act'; el.textContent = b.label;
    if (b.id) el.dataset.step = b.id;
    wrap.appendChild(el); btns.appendChild(wrap); ui.buttons.push(el);
    el.onclick = () => { b.onClick(st, ui); ui.render(); };
  });
  ui.unmount = () => { dead = true; steps.clear(); camera.clear(); driving = false; clearTimeout(fbT); clearTimeout(flashT); clearTimeout(dinT); camAnim++; spin = false;
    while (clear.length) { try { clear.pop()(); } catch (_) {} }
    root.textContent = ''; };
  ui.clear = fn => clear.push(fn);
  setLight(st.az); ui.render();
  return ui;
}


/* ---------- see-through + labels kit (shared; the figure supplies its own working parts) ----------
   xrCallouts(items, B): pills in two columns either side of the object, sorted top to bottom so leaders never cross.
     items: [{ at:[x,y,z], text, on }], B: the object's bounds [x0, x1, y0, y1, z0, z1].
   xrGhost(body, mech, k, OUTp, x0, x1, m): far walls faintly, the working parts, then the case as a ghost over them.
   xrMount(getUI, caption): the See-through / Labels switches (top right), the caption under the figure, label hiding. */
function xrCallouts(items, B){
  const pts = []; for (const x of [B[0], B[1]]) for (const y of [B[2], B[3]]) for (const z of [B[4], B[5]]) pts.push(P(x, y, z));
  const xmin = Math.min(...pts.map(p => p[0])), xmax = Math.max(...pts.map(p => p[0])), cx = (xmin + xmax)/2;
  // on a phone (LBL_U = drawing units per screen px) each label is a numbered badge and the names go in a legend under the figure
  const k = INK_K, u = MC.LBL_U ? MC.LBL_U() : 0, fs = u ? 10*u : 8.6*k, hgt = u ? 17*u : fs*1.8, gap = hgt + (u ? 3*u : 3*k);
  const L = [], R = [];
  const svgEl = document.getElementById('fig'), vb = svgEl.viewBox.baseVal, btn = document.getElementById('btns');
  const wMax = u ? hgt*1.3 + 12*k : Math.max(...items.map(it => it.text.length))*fs*.62 + fs*1.5 + 12*k;
  const roomL = xmin - vb.x >= wMax, roomR = vb.x + vb.width - xmax >= wMax;
  for (const it of items){ const [X, Y] = P(...it.at); ((X < cx && roomL) || !roomR ? L : R).push({ ...it, X, Y }); }
  let s = '';
  let top = { [-1]: fs, [1]: fs + 30*k };
  if (btn && svgEl.getScreenCTM()){ const r = btn.getBoundingClientRect(), q = new DOMPoint(r.right, r.bottom + 50).matrixTransform(svgEl.getScreenCTM().inverse());
    if (q.y > 0) top[-1] = q.y + hgt; }
  for (const [col, side] of [[L, -1], [R, 1]]){
    col.sort((a, b) => a.Y - b.Y);
    let y = -1e9; for (const c of col){ c.py = Math.max(c.Y, y + gap, top[side]); y = c.py; }
    const shift = col.length ? Math.max(0, col.reduce((a, c) => a + c.py - c.Y, 0) / col.length) : 0;
    const room = col.length ? col[0].py - top[side] : 0; for (const c of col) c.py -= Math.min(shift, room);
    for (const c of col){
      c.n = LN[c.text] || (LN[c.text] = Object.keys(LN).length + 1); const w = u ? hgt*(c.n > 9 ? 1.3 : 1) : c.text.length*fs*.62 + fs*1.5;
      let px = side < 0 ? xmin - 10*k - w/2 : xmax + 10*k + w/2; px = Math.max(vb.x + w/2 + 2*k, Math.min(vb.x + vb.width - w/2 - 2*k, px));
      const ex = px - side*w/2;
      s += `<g class="tag${c.on ? ' on' : ''}" data-n="${c.n}" data-t="${esc(c.text)}"><path d="M${f(c.X)} ${f(c.Y)}L${f(ex + side*-4*k)} ${f(c.py)}L${f(ex)} ${f(c.py)}" fill="none" stroke="${INK}" stroke-width="1"/>`
        + `<circle cx="${f(c.X)}" cy="${f(c.Y)}" r="${f(1.4*k)}" fill="${INK}"/>`
        + `<rect x="${f(px - w/2)}" y="${f(c.py - hgt/2)}" width="${f(w)}" height="${f(hgt)}" rx="${f(hgt/2)}" fill="${c.on ? 'var(--accent,#f4b829)' : '#fff4d6'}" stroke="${INK}" stroke-width="1.2"/>`
        + `<text x="${f(px)}" y="${f(c.py + fs*.36)}" font-size="${f(fs)}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-weight="800" letter-spacing=".04em" fill="${INK}">${u ? c.n : esc(c.text)}</text></g>`;
    }
  }
  return s;
}
function xrGhost(body, mech, k, OUTp, x0, x1, m){
  const fF = facing([1,0,0]), fB = facing([-1,0,0]);
  const far = `<g opacity="${f(.5*k)}">` + loft(on(PX(x0), OUTp), on(PX(x1), OUTp), n => mix(toneI(n.map(v => -v), m), '#f2efe7', .55), true)
    + (fF ? fill(pd(on(PX(x0), OUTp)), mix(m.d, '#f2efe7', .5)) : '') + (fB ? fill(pd(on(PX(x1), OUTp)), mix(m.d, '#f2efe7', .5)) : '') + `</g>`;
  return far + mech + `<g opacity="${f(1 - .8*k)}">${body}</g>` + `<g opacity="${f(.6*k)}">` + hullInk([...on(PX(x0), OUTp), ...on(PX(x1), OUTp)], 2.8) + `</g>`;
}

// See inside / Labels switches (the original xrMount with a root element and a dictionary; start state cfg.xr / cfg.label)
function xrMount(getUI, cfg = {}){
  const ui = getUI(), html = ui.root, M = ui.text || {}, q = new URLSearchParams(location.search);   // the label switch is on the .cf-root root (html in the original)
  const label = q.get('labels') === '1' || !!cfg.label;
  html.classList.toggle('nolabels', !label);
  if (ui.st.xr == null){ ui.st.xr = 0; ui.st.xrT = 0; }
  if (q.get('xr') === '1' || cfg.xr) ui.st.xr = ui.st.xrT = 1;
  const vset = document.createElement('div'); vset.className = 'vset';
  const row = document.createElement('div'); row.className = 'vrow'; vset.appendChild(row);
  const mk = (id, s) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'act'; b.id = id; b.setAttribute('aria-pressed', 'false'); b.textContent = s || ''; row.appendChild(b); return b; };
  const xrb = mk('xrb', M.see_inside), lblb = mk('lblb', M.labels);
  document.querySelector('.cf-root .stage').appendChild(vset);
  const place = () => { const sp = document.getElementById('stats'); vset.style.top = sp ? (sp.offsetTop + sp.offsetHeight + 10) + 'px' : ''; };
  place(); const ro = new ResizeObserver(place); ro.observe(document.getElementById('stats') || vset); ui.clear(() => ro.disconnect());
  const sync = () => { xrb.setAttribute('aria-pressed', !!getUI().st.xrT); lblb.setAttribute('aria-pressed', !html.classList.contains('nolabels')); };
  xrb.onclick = () => { const u = getUI(), st = u.st; st.xr = st.xr || 0; st.xrT = st.xrT ? 0 : 1; sync(); if (cfg.changed) cfg.changed({ xr: !!st.xrT });
    u.animate(dt => { const g = Math.sign(st.xrT - st.xr); st.xr = Math.min(1, Math.max(0, st.xr + g*dt/.7)); return st.xr !== st.xrT; }, true); };
  lblb.onclick = () => { html.classList.toggle('nolabels'); sync(); if (cfg.changed) cfg.changed({ label: !html.classList.contains('nolabels') }); };
  sync();
  ui.render();
}
// same, for a body lofted between two horizontal rings A (bottom) and B (top)
function xrGhostRings(body, mech, k, A, B, m){
  const far = `<g opacity="${f(.5*k)}">` + loft(A, B, n => mix(toneI(n.map(v => -v), m), '#f2efe7', .55), true) + fill(pd(A), mix(m.d, '#f2efe7', .5)) + `</g>`;
  return far + mech + `<g opacity="${f(1 - .8*k)}">${body}</g>` + `<g opacity="${f(.6*k)}">` + hullInk([...A, ...B], 2.8) + `</g>`;
}
// generic see-through for any figure: the whole drawing fades back and the inside parts show over it.
//   opts: { mech(st, k) -> svg, inside(st) -> label items, surface(st) -> label items (optional), B: bounds, getSt() }
// washer-style ghost for an object without a single box case: its inside parts first, then the object pale over them
const xrUnder = (svg, mech, k) => `<g opacity="${f(k)}">${mech}</g><g opacity="${f(1 - .62*k)}">${svg}</g>`;
function xrWrap(sceneFn, opts){
  return function(){
    let s = sceneFn.apply(this, arguments);
    const st = opts.getSt(), k = ease(st.xr || 0);
    if (k > 0 && opts.under) s = xrUnder(s, opts.mech(st, k), k);   // the whole drawing is the object
    else if (k > 0 && !opts.inline) s = `<g opacity="${f(1 - .5*k)}">${s}</g><g opacity="${f(k)}">${opts.mech(st, k)}</g>`;   // inline: the figure ghosts its own case
    const items = k > .6 ? opts.inside(st) : opts.surface ? opts.surface(st) : [];
    return s + (items.length ? xrCallouts(items, opts.B) : '');
  };
}

/* ---------- exposed interface (one namespace: Mucellit.learn.cf) ----------
   Functions and constants are fixed bindings; changing camera / line scale values are read through getters. */
MC.cf = Object.freeze({
  PALS, METAL, CLEAR, CERAMIC, DARK, INK, BOARD, WOOD, YAW0, PITCH0,
  get CAM_V(){ return CAM_V; }, get CAM_R(){ return CAM_R; }, get CAM_U(){ return CAM_U; }, get YAW(){ return YAW; }, get PITCH(){ return PITCH; }, get INK_K(){ return INK_K; },
  setCam, camDot, rotV, P, P0, Dv, depthOf, byDepth, nearHalf, farHalf, openShell, f, pd, sp, arcUV, rrUV, rectUV, ellUV, PX, PY, PZ, on,
  sub, dot, cross, norm, avg, vis, facing, setLight, tone, toneI, mix, matOf, ease, ink, fill, face, shape, line, loft, hull, hullInk, box,
  extrude, cyl, cylX, rod, txM, tx, txY, boardTop, board, act, tag, clipTo, esc,
  mountFigure, xrCallouts, xrGhost, xrMount, xrGhostRings, xrUnder, xrWrap
});
})(typeof self !== 'undefined' ? self : this);
