/* ============================================================
   Banco de pruebas de «foto → mueble» con fotos sintéticas:
   se dibuja un mueble conocido (con libros, sombras, juntas, tiradores
   y ruido), a veces en perspectiva, y se comprueba lo que se detecta.
   node tests/photo.mjs
   ============================================================ */
import { rectify, detectStructure, toParams, homography, guessQuad, summarize } from "../lib/photo.js";
import { normalize, deepCopy } from "../lib/model.js";

let seed = 77;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

/* layout: columnas con ancho relativo y huecos de abajo arriba [tipo, alto relativo] */
function draw(layout, { W = 900, H = 1100, box = [150, 120, 750, 980], wood = [190, 150, 105], base = 0.04 } = {}) {
  const data = new Uint8ClampedArray(W * H * 4);
  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const k = (Math.round(y) * W + Math.round(x)) * 4;
    data[k] = c[0]; data[k + 1] = c[1]; data[k + 2] = c[2]; data[k + 3] = 255;
  };
  const rect = (x0, y0, x1, y1, c, noise = 6) => {
    for (let y = Math.floor(y0); y < y1; y++) for (let x = Math.floor(x0); x < x1; x++) {
      const n = (rnd() - 0.5) * noise;
      set(x, y, [c[0] + n, c[1] + n, c[2] + n]);
    }
  };
  rect(0, 0, W, H, [228, 224, 214], 8);                      // pared
  rect(0, H * 0.88, W, H, [196, 170, 130], 10);              // suelo
  const [bx0, by0, bx1, by1] = box;
  const bw = bx1 - bx0, bh = by1 - by0, t = Math.max(3, bw * 0.012);
  const carBot = by1 - bh * base;
  rect(bx0, by0, bx1, carBot, wood, 5);                      // carcasa
  if (base) rect(bx0 + t * 2, carBot, bx1 - t * 2, by1, wood.map((v) => v * 0.8), 4);   // zócalo
  const dark = (x0, y0, x1, y1) => rect(x0, y0, x1, y1, wood.map((v) => v * 0.35), 3);
  const innerTop = by0 + t, innerBot = carBot - t;
  let x = bx0 + t;
  const total = layout.reduce((a, c) => a + c.w, 0);
  layout.forEach((col, ci) => {
    const cw = (bw - (layout.length + 1) * t) * (col.w / total);
    const sum = col.cells.reduce((a, c) => a + c[1], 0);
    let y = innerBot;
    col.cells.forEach(([type, hr], k) => {
      const ch = (innerBot - innerTop - (col.cells.length - 1) * t) * (hr / sum);
      const y0 = y - ch;
      if (type === "open") {
        rect(x, y0, x + cw, y, wood.map((v) => v * 0.62), 10);   // fondo en sombra
        dark(x, y0, x + cw, y0 + 3);                                // sombra bajo la balda
        let bx = x + 6;
        while (rnd() < 0.8 && bx < x + cw * 0.7) {                 // libros
          const tw = 6 + rnd() * 8, th = ch * (0.5 + rnd() * 0.3);
          rect(bx, y - th, bx + tw, y, [60 + rnd() * 160, 40 + rnd() * 120, 40 + rnd() * 120], 10);
          bx += tw + 1;
        }
      } else {
        dark(x, y0, x + cw, y0 + 2); dark(x, y - 2, x + cw, y);   // juntas
        dark(x, y0, x + 2, y); dark(x + cw - 2, y0, x + cw, y);
        if (type === "drawer") dark(x + cw * 0.4, y0 + 12, x + cw * 0.6, y0 + 16);
        else dark(x + cw - 16, y0 + ch * 0.45, x + cw - 12, y0 + ch * 0.55);
      }
      y = y0;
      if (k < col.cells.length - 1) { dark(x, y - t, x + cw, y - t + 1.5); y -= t; }
    });
    x += cw;
    if (ci < layout.length - 1) { dark(x, innerTop, x + 1.5, innerBot); dark(x + t - 1.5, innerTop, x + t, innerBot); x += t; }
  });
  return { width: W, height: H, data, quad: [[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]] };
}

/* perspectiva: la imagen se deforma con una homografía y las esquinas con ella */
function warp(img, q2) {
  const { width: W, height: H } = img;
  const inv = homography([[0, 0], [W, 0], [W, H], [0, H]].map((_, k) => q2[k]));
  const out = new Uint8ClampedArray(W * H * 4).fill(235);
  /* muestreo inverso aproximado: se recorre el origen y se pinta en destino */
  for (let y = 0; y < H; y += 0.5) for (let x = 0; x < W; x += 0.5) {
    const [u, v] = inv(x / W, y / H);
    const X = Math.round(u), Y = Math.round(v);
    if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    const s = (Math.floor(y) * W + Math.floor(x)) * 4, d = (Y * W + X) * 4;
    for (let c = 0; c < 4; c++) out[d + c] = img.data[s + c];
  }
  const quad = img.quad.map(([x, y]) => inv(x / W, y / H).map(Math.round));
  return { width: W, height: H, data: out, quad };
}

const fails = [];
let n = 0;
function check(name, img, dims, expect) {
  n++;
  try {
    const r = rectify(img, img.quad, 480);
    const det = detectStructure(r);
    const p = toParams(det, dims);
    const again = normalize(deepCopy(p));
    if (JSON.stringify(again.columns) !== JSON.stringify(p.columns)) fails.push(`${name}: normalize() cambia el resultado`);
    const got = summarize(p);
    const bad = Object.entries(expect).filter(([k, v]) => typeof v === "function" ? !v(got, p) : got[k] !== v);
    if (bad.length) fails.push(`${name}: esperaba ${bad.map(([k, v]) => `${k}=${typeof v === "function" ? "✓" : v}`).join(", ")} · salió ${JSON.stringify(got)} ${p.material} ${p.base}`);
  } catch (e) { fails.push(`${name}: excepción ${e.message}`); }
}

const O = (h = 1) => ["open", h], D = (h = 1) => ["door", h], R = (h = 1) => ["drawer", h];
const book = Array.from({ length: 4 }, () => ({ w: 1, cells: [O(), O(), O(), O()] }));
check("estantería 4×4", draw(book, { box: [120, 100, 780, 1000] }), { width: 2400, height: 2000 }, { columns: 4, open: 16, doors: 0, drawers: 0 });
check("estantería 3×5 en blanco", draw(Array.from({ length: 3 }, () => ({ w: 1, cells: [O(), O(), O(), O(), O()] })), { wood: [236, 234, 228] }),
      { width: 1500, height: 2000 }, { columns: 3, open: 15, doors: 0 });
const wardrobe = [{ w: 1, cells: [D()] }, { w: 1, cells: [D()] }, { w: 1, cells: [R(0.12), R(0.12), D(0.76)] }, { w: 1, cells: [R(0.12), R(0.12), D(0.76)] }];
check("armario 2 módulos", draw(wardrobe, { box: [160, 60, 740, 1040] }), { width: 1800, height: 2200 },
      { columns: 3, drawers: 4, rails: (g) => g.rails >= 1, doors: (g) => g.doors >= 2 });
const sideboard = [{ w: 1, cells: [D()] }, { w: 1, cells: [R(), R(), R()] }, { w: 1, cells: [D()] }];
const sb = draw(sideboard, { W: 1000, H: 700, box: [100, 200, 900, 560], base: 0.14 });
check("aparador", sb, { width: 1800, height: 800 }, { columns: 3, doors: 2, drawers: 3, open: 0 });
check("aparador en perspectiva", warp(sb, [[40, 30], [1000, 0], [1000, 700], [20, 650]]), { width: 1800, height: 800 },
      { columns: 3, doors: 2, drawers: 3 });
const mixed = [{ w: 1, cells: [D(), O(), O()] }, { w: 1.4, cells: [R(0.5), R(0.5), O(2), O(1)] }, { w: 1, cells: [D(), O(), O()] }];
check("librería mixta", draw(mixed, { box: [110, 80, 790, 1020] }), { width: 2000, height: 2000 },
      { columns: 3, drawers: 2, doors: 2, open: (g) => g.open >= 5 });

/* esquinas propuestas: dentro de la foto y rodeando el mueble */
n++;
const g = guessQuad(sb);
if (!(g[0][0] <= 130 && g[1][0] >= 870 && g[0][1] <= 230 && g[2][1] >= 540)) fails.push(`esquinas propuestas no rodean el mueble: ${JSON.stringify(g.map((p) => p.map(Math.round)))}`);

console.log(`\nfoto: ${n} casos · ${fails.length} fallos\n`);
fails.forEach((f) => console.log("  ✗ " + f));
process.exit(fails.length ? 1 : 0);
