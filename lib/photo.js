/* ============================================================
   DE UNA FOTO A UN MUEBLE EDITABLE
   Visión por ordenador clásica, en el navegador y sin coste:
     1. rectify(): la foto se endereza con las 4 esquinas del mueble
        (homografía), como si estuviera hecha de frente.
     2. detectStructure(): las líneas que cruzan casi todo el mueble son
        costados, divisores, baldas o juntas de puertas y cajones. Una
        balda o un divisor dejan una arista continua; el lomo de un libro,
        no. Cada hueco se clasifica por lo oscuro y lo «movido» que está:
        un hueco abierto tiene sombra y cosas dentro; un frente es liso.
     3. toParams(): con las medidas reales, se traduce a columnas, baldas
        y huecos del motor, y pasa por normalize() como todo lo demás.
   Trabaja con {width, height, data} RGBA, así que se prueba en Node.
   ============================================================ */
import { normalize, clamp, MATERIALS } from "./model.js";

/* ---------- homografía: cuadrado unidad → cuadrilátero de la foto ---------- */
function solve(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    [b[i], b[p]] = [b[p], b[i]];
    if (Math.abs(A[i][i]) < 1e-12) return null;
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}

/* quad: [tl, tr, br, bl] en píxeles de la foto */
export function homography(quad) {
  const src = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const A = [], b = [];
  src.forEach(([u, v], k) => {
    const [x, y] = quad[k];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  });
  const h = solve(A, b);
  if (!h) return null;
  return (u, v) => {
    const w = h[6] * u + h[7] * v + 1;
    return [(h[0] * u + h[1] * v + h[2]) / w, (h[3] * u + h[4] * v + h[5]) / w];
  };
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/* proporción alto/ancho del mueble, a partir de los lados del cuadrilátero */
export const quadAspect = (q) => ((dist(q[0], q[3]) + dist(q[1], q[2])) / 2) / Math.max(1, (dist(q[0], q[1]) + dist(q[3], q[2])) / 2);

export function rectify(img, quad, long = 360) {
  const map = homography(quad);
  const a = quadAspect(quad);
  const W = a >= 1 ? Math.max(40, Math.round(long / a)) : long;
  const H = a >= 1 ? long : Math.max(40, Math.round(long * a));
  const gray = new Float32Array(W * H), rgb = new Float32Array(W * H * 3);
  const { width: iw, height: ih, data } = img;
  const px = (x, y, c) => data[(y * iw + x) * 4 + c];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      let [x, y] = map((i + 0.5) / W, (j + 0.5) / H);
      x = clamp(x, 0, iw - 1.001); y = clamp(y, 0, ih - 1.001);
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      const k = j * W + i;
      for (let c = 0; c < 3; c++) {
        const v = px(x0, y0, c) * (1 - fx) * (1 - fy) + px(x0 + 1, y0, c) * fx * (1 - fy) +
                  px(x0, y0 + 1, c) * (1 - fx) * fy + px(x0 + 1, y0 + 1, c) * fx * fy;
        rgb[k * 3 + c] = v;
      }
      gray[k] = (0.299 * rgb[k * 3] + 0.587 * rgb[k * 3 + 1] + 0.114 * rgb[k * 3 + 2]) / 255;
    }
  }
  return { width: W, height: H, gray, rgb, aspect: a };
}

/* ---------- primera propuesta de esquinas: donde se concentran las aristas ---------- */
export function guessQuad(img) {
  const S = 160, sx = img.width / S, sy = img.height / S;
  const g = new Float32Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const k = (Math.floor(j * sy) * img.width + Math.floor(i * sx)) * 4;
    g[j * S + i] = (0.299 * img.data[k] + 0.587 * img.data[k + 1] + 0.114 * img.data[k + 2]) / 255;
  }
  const colE = new Float32Array(S), rowE = new Float32Array(S);
  for (let j = 1; j < S - 1; j++) for (let i = 1; i < S - 1; i++) {
    const e = Math.abs(g[j * S + i + 1] - g[j * S + i - 1]) + Math.abs(g[(j + 1) * S + i] - g[(j - 1) * S + i]);
    colE[i] += e; rowE[j] += e;
  }
  const span = (p) => {
    const max = Math.max(...p), thr = max * 0.25;
    let a = 0, b = S - 1;
    while (a < S / 2 && p[a] < thr) a++;
    while (b > S / 2 && p[b] < thr) b--;
    return [a, b];
  };
  const [x0, x1] = span(colE), [y0, y1] = span(rowE);
  const X0 = Math.max(0, x0 - 1) * sx, X1 = Math.min(S, x1 + 2) * sx;
  const Y0 = Math.max(0, y0 - 1) * sy, Y1 = Math.min(S, y1 + 2) * sy;
  if (X1 - X0 < img.width * 0.2 || Y1 - Y0 < img.height * 0.2) {
    const m = 0.08;
    return [[img.width * m, img.height * m], [img.width * (1 - m), img.height * m],
            [img.width * (1 - m), img.height * (1 - m)], [img.width * m, img.height * (1 - m)]];
  }
  return [[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]];
}

/* ---------- estructura ---------- */
function percentile(arr, p) {
  const s = Float32Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
/* máximos con distancia mínima, de mayor a menor */
function peaks(profile, minVal, minDist, lo, hi) {
  const sm = profile.map((v, i) => (v + (profile[i - 1] ?? v) + (profile[i + 1] ?? v)) / 3);
  const idx = [...sm.keys()].filter((i) => i >= lo && i <= hi && sm[i] >= minVal &&
    sm[i] >= (sm[i - 1] ?? 0) && sm[i] >= (sm[i + 1] ?? 0)).sort((a, b) => sm[b] - sm[a]);
  const out = [];
  for (const i of idx) if (out.every((o) => Math.abs(o - i) >= minDist)) out.push(i);
  return out.sort((a, b) => a - b);
}

export function detectStructure(r) {
  const { width: W, height: H, gray, rgb } = r;
  const gx = new Float32Array(W * H), gy = new Float32Array(W * H);
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
    const k = j * W + i;
    gx[k] = Math.abs(gray[k + 1] - gray[k - 1]) / 2;
    gy[k] = Math.abs(gray[k + W] - gray[k - W]) / 2;
  }
  const Tx = Math.max(0.015, percentile(gx, 0.88)), Ty = Math.max(0.015, percentile(gy, 0.88));
  const hit = (arr, T, k, step) => Math.max(arr[k - step] ?? 0, arr[k], arr[k + step] ?? 0) > T;
  const strong = Math.max(0.045, Tx * 2, Ty * 2);

  /* divisores: aristas verticales que recorren la mayor parte de la altura */
  const j0 = Math.floor(H * 0.06), j1 = Math.ceil(H * 0.94);
  const cov = new Array(W).fill(0);
  for (let i = 1; i < W - 1; i++) {
    let c = 0;
    for (let j = j0; j < j1; j++) if (hit(gx, Tx, j * W + i, 1)) c++;
    cov[i] = c / (j1 - j0);
  }
  /* el canto interior de los costados no es un divisor: fuera las líneas pegadas a los bordes */
  const edgeM = Math.round(W * 0.06);
  const xs = [0, ...peaks(cov, 0.5, Math.max(3, Math.round(W * 0.06)), edgeM, W - 1 - edgeM), W];

  /* luminancia de referencia: el propio tablero, sobre las líneas encontradas */
  const cols = [];
  for (let c = 0; c < xs.length - 1; c++) {
    const a = xs[c], b = xs[c + 1];
    const m = Math.max(2, Math.round((b - a) * 0.08));
    const rcov = new Array(H).fill(0);
    for (let j = 1; j < H - 1; j++) {
      let n = 0, tot = 0;
      for (let i = a + m; i < b - m; i++) { tot++; if (hit(gy, Ty, j * W + i, W)) n++; }
      rcov[j] = tot ? n / tot : 0;
    }
    const edge = Math.round(H * 0.025);
    /* una balda o una junta cruzan la columna entera; el borde de una fila de libros, no */
    const ys = [0, ...peaks(rcov, 0.82, Math.max(3, Math.round(H * 0.045)), edge, H - 1 - edge), H];
    const cells = [];
    for (let k = 0; k < ys.length - 1; k++) {
      const y0 = ys[k], y1 = ys[k + 1];
      const ix0 = Math.round(a + (b - a) * 0.15), ix1 = Math.round(b - (b - a) * 0.15);
      const iy0 = Math.round(y0 + (y1 - y0) * 0.15), iy1 = Math.round(y1 - (y1 - y0) * 0.15);
      let s = 0, s2 = 0, e = 0, n = 0, cr = 0, cg = 0, cb = 0;
      for (let j = iy0; j < iy1; j++) for (let i = ix0; i < ix1; i++) {
        const q = j * W + i, v = gray[q];
        s += v; s2 += v * v; n++;
        cr += rgb[q * 3]; cg += rgb[q * 3 + 1]; cb += rgb[q * 3 + 2];
        if (gx[q] > strong || gy[q] > strong) e++;   // lomos, objetos; la veta de la madera no llega
      }
      const mean = n ? s / n : 0;
      cells.push({ y0: y0 / H, y1: y1 / H, mean, std: n ? Math.sqrt(Math.max(0, s2 / n - mean * mean)) : 0, edges: n ? e / n : 0,
                   rgb: n ? [cr / n, cg / n, cb / n] : [0, 0, 0] });
    }
    cols.push({ x0: a / W, x1: b / W, cells });
  }

  /* tablero: en cada línea detectada, el píxel más claro de una ventana de ±3 px
     es la cara del canto (el hueco de al lado queda en sombra) */
  /* por ventana, el más claro con algo de color (la madera); un libro crema o el blanco
     del papel no cuentan. Si casi no hay color, el mueble es blanco o negro. */
  const all = [], tinted = [];
  const sat = (k) => { const r0 = rgb[k * 3], g0 = rgb[k * 3 + 1], b0 = rgb[k * 3 + 2], mx = Math.max(r0, g0, b0), mn = Math.min(r0, g0, b0); return mx ? (mx - mn) / mx : 0; };
  const brightest = (ks) => {
    let best = ks[0], bestT = -1;
    for (const k of ks) {
      if (gray[k] > gray[best]) best = k;
      if (sat(k) > 0.22 && (bestT < 0 || gray[k] > gray[bestT])) bestT = k;
    }
    all.push(best);
    if (bestT >= 0) tinted.push(bestT);
  };
  const sideW = Math.max(3, Math.round(W * 0.04));
  /* los costados solo si no hay otra cosa: las esquinas pueden coger algo de pared */
  const inner = xs.length > 2 || cols.some((c) => c.cells.length > 1);
  for (let j = Math.round(H * 0.1); j < H * 0.9; j += 2) {
    if (!inner) {
      brightest(Array.from({ length: sideW }, (_, d) => j * W + d));
      brightest(Array.from({ length: sideW }, (_, d) => j * W + (W - 1 - d)));
    }
    for (const x of xs.slice(1, -1)) brightest([-3, -2, -1, 0, 1, 2, 3].map((d) => j * W + clamp(x + d, 0, W - 1)));
  }
  cols.forEach((c) => c.cells.forEach((cell, k) => {
    if (k === 0) return;
    const y = Math.round(cell.y0 * H);
    for (let i = Math.round(c.x0 * W) + 2; i < c.x1 * W - 2; i += 2) {
      brightest([-3, -2, -1, 0, 1, 2, 3].map((d) => clamp(y + d, 0, H - 1) * W + i));
    }
  }));
  const Lframe = all.length ? percentile(all.map((k) => gray[k]), 0.5) : 0.5;
  const pool = tinted.length >= all.length * 0.3 ? tinted : all;
  const Lpool = pool.length ? percentile(pool.map((k) => gray[k]), 0.5) : Lframe;
  let fr = 0, fg = 0, fb = 0, fn = 0;
  pool.forEach((k) => { if (Math.abs(gray[k] - Lpool) < 0.06) { fr += rgb[k * 3]; fg += rgb[k * 3 + 1]; fb += rgb[k * 3 + 2]; fn++; } });

  /* abierto o frente: la sombra y lo que hay dentro delatan un hueco abierto */
  let front = 0, frontR = 0, frontG = 0, frontB = 0;
  cols.forEach((c) => c.cells.forEach((cell) => {
    /* un tirador da aristas pero poca dispersión; libros y objetos, las dos cosas */
    cell.kind = cell.mean < Lframe * 0.8 || cell.std > 0.14 || (cell.edges > 0.14 && cell.std > 0.08) ? "open" : "front";
    if (cell.kind === "front") front++;
  }));
  /* color del acabado: los frentes si los hay (se ven mejor que los cantos) */
  if (front) {
    cols.forEach((c) => c.cells.forEach((cell) => {
      if (cell.kind !== "front") return;
      const ix = Math.round(((c.x0 + c.x1) / 2) * W), iy = Math.round(((cell.y0 + cell.y1) / 2) * H);
      for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
        const k = clamp(iy + dj, 0, H - 1) * W + clamp(ix + di, 0, W - 1);
        frontR += rgb[k * 3]; frontG += rgb[k * 3 + 1]; frontB += rgb[k * 3 + 2];
      }
    }));
    const n = front * 49;
    return { cols, color: [frontR / n, frontG / n, frontB / n], lframe: Lframe };
  }
  return { cols, color: fn ? [fr / fn, fg / fn, fb / fn] : [180, 150, 110], lframe: Lframe };
}

/* ---------- color → acabado ---------- */
export function guessMaterial([r, g, b]) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  if (l < 0.22) return "melamina_negra";
  if (s < 0.14 && l > 0.62) return "melamina_blanca";
  if (s < 0.12 && l < 0.4) return "melamina_negra";
  if (l > 0.76) return "abedul";           // con la luz de una foto, el roble claro llega a 0,74
  if (l > 0.4) return "roble";
  return "nogal";
}

/* ---------- a parámetros del motor ---------- */
export function toParams(det, dims) {
  const width = clamp(Math.round(dims.width), 400, 3200);
  const height = clamp(Math.round(dims.height), 400, 2600);
  const t = 18;
  let cols = det.cols.map((c) => ({ ...c, cells: c.cells.map((x) => ({ ...x })) }));

  /* el zócalo o las patas: franjas bajas al pie (a veces dos, entre patas y suelo), en todas las columnas */
  let base = height >= 1500 ? "zocalo" : "patas", baseHeight = base === "zocalo" ? 80 : 110;
  const lowRun = (c) => {
    let hsum = 0, n = 0, busy = 0;
    for (let k = c.cells.length - 1; k > 0; k--) {
      const cell = c.cells[k], hmm = (cell.y1 - cell.y0) * height;
      if (hsum + hmm > 230) break;
      hsum += hmm; n++;
      busy = Math.max(busy, cell.std);          // entre patas, al menos una franja se ve movida
    }
    return { hsum, n, busy, top: n ? c.cells[c.cells.length - n].y0 : 1 };
  };
  let runs = cols.map(lowRun);
  /* si en alguna columna no se ve la línea del pie (una pata la tapa), vale la de las demás */
  const withRun = runs.filter((x) => x.n > 0);
  if (withRun.length && withRun.length >= Math.ceil((cols.length * 2) / 3) && withRun.length < cols.length) {
    const top = withRun.map((x) => x.top).sort((a, b) => a - b)[Math.floor(withRun.length / 2)];
    cols.forEach((c, i) => {
      if (runs[i].n) return;
      const last = c.cells[c.cells.length - 1];
      if (last.y0 < top - 0.01 && last.y1 > top) {
        c.cells.splice(c.cells.length - 1, 1, { ...last, y1: top }, { ...last, y0: top, std: withRun[0].busy });
      }
    });
    runs = cols.map(lowRun);
  }
  if (runs.every((x) => x.n > 0)) {
    /* un zócalo es liso; entre patas se ven las patas y lo que hay detrás */
    base = runs.reduce((a, x) => a + x.busy, 0) / runs.length > 0.09 ? "patas" : "zocalo";
    /* la más baja: las esquinas suelen coger algo de suelo por debajo */
    baseHeight = Math.round(clamp(Math.min(...runs.map((x) => x.hsum)), 60, base === "patas" ? 160 : 140));
    cols.forEach((c, i) => c.cells.splice(c.cells.length - runs[i].n, runs[i].n));
  }
  if (dims.base) { base = dims.base; baseHeight = base === "patas" ? 110 : base === "zocalo" ? 80 : 0; }
  const bh = base === "flotante" ? 0 : baseHeight;
  const Hi = height - bh - 2 * t;
  /* la carcasa ocupa de arriba de la foto hasta el pie del último hueco */
  const botFrac = Math.max(...cols.map((c) => c.cells[c.cells.length - 1].y1));
  const toMM = (f) => (1 - f / botFrac) * (height - bh) - t;

  /* celdas con tipo y altura real */
  cols.forEach((c) => {
    c.width = (c.x1 - c.x0) * width;
    c.cells = c.cells.filter((x) => ((x.y1 - x.y0) / botFrac) * (height - bh) >= 60);   // una junta, no un hueco
    c.cells.forEach((x) => {
      const hmm = ((x.y1 - x.y0) / botFrac) * (height - bh);
      x.type = x.kind === "open" ? "open" : hmm <= 380 && c.width >= 250 ? "drawer" : "door";
    });
  });

  /* puertas de un mismo módulo: hojas contiguas que llegan del techo al suelo */
  for (let i = 0; i < cols.length - 1; i++) {
    const a = cols[i], b = cols[i + 1];
    const allDoor = (c) => c.cells.length > 0 && c.cells.every((x) => x.type === "door");
    if (allDoor(a) && allDoor(b) && a.width + b.width <= 1150) {
      a.x1 = b.x1; a.width += b.width;
      cols.splice(i + 1, 1);
      i--;
    }
  }

  const columns = cols.map((c) => {
    /* de abajo arriba: huecos, con los cajones seguidos agrupados en uno (hasta 3) */
    const cells = [...c.cells].reverse();
    const groups = [];
    cells.forEach((x) => {
      const g = groups[groups.length - 1];
      if (x.type === "drawer" && g && g.type === "drawer" && g.n < 3) { g.n++; g.top = x.y0; }
      else groups.push({ type: x.type, n: 1, top: x.y0, bottom: x.y1 });
    });
    const shelves = [], types = [], joins = [];
    groups.forEach((g, k) => {
      const type = g.type === "drawer" ? (g.n === 1 ? "drawer" : g.n === 2 ? "drawer2" : "drawer3") : g.type;
      const lo = clamp(toMM(g.bottom), 0, Hi), hi = clamp(toMM(g.top), 0, Hi);
      /* una puerta muy alta esconde un armario: barra bajo el maletero o baldas */
      if (type === "door" && hi - lo > 1100) {
        if (c.width >= 600) {
          shelves.push(Math.round(hi - 340));
          types.push("rail+door", "door"); joins.push(true);
        } else {
          const n = Math.max(1, Math.floor((hi - lo) / 380) - 1);
          for (let s = 1; s <= n; s++) shelves.push(Math.round(lo + ((hi - lo) * s) / (n + 1)));
          for (let s = 0; s <= n; s++) types.push("door");
          for (let s = 0; s < n; s++) joins.push(true);
        }
      } else types.push(type);
      if (k < groups.length - 1) { shelves.push(Math.round(hi)); joins.push(false); }
    });
    return { width: c.width, shelves, cells: types, joins };
  });

  /* casi todos los muebles tienen columnas iguales: si se parecen, se igualan */
  const ws = columns.map((c) => c.width);
  if (columns.length > 1 && Math.max(...ws) / Math.min(...ws) < 1.25) {
    const avg = ws.reduce((a, b) => a + b, 0) / ws.length;
    columns.forEach((c) => { c.width = avg; });
  }
  /* baldas a casi la misma altura en columnas distintas: a la misma */
  const all = columns.flatMap((c) => c.shelves).sort((a, b) => a - b);
  const groups = [];
  all.forEach((v) => { const g = groups[groups.length - 1]; if (g && v - g[g.length - 1] <= 45) g.push(v); else groups.push([v]); });
  const snap = (v) => { const g = groups.find((x) => x.includes(v)); return Math.round(g.reduce((a, b) => a + b, 0) / g.length); };
  columns.forEach((c) => { c.shelves = c.shelves.map(snap); });

  const material = dims.material && MATERIALS[dims.material] ? dims.material : guessMaterial(det.color);
  const doors = columns.some((c) => c.cells.some((x) => x.includes("door")));
  const depth = dims.depth || (doors && height >= 1500 ? 600 : height >= 1500 ? 320 : 450);
  return normalize({
    width, height, depth, thickness: t, material, base, baseHeight: bh, back: true, handle: "bar",
    columns,
  });
}

/* resumen para enseñar antes de crear */
export function summarize(p) {
  let open = 0, doors = 0, drawers = 0, rails = 0;
  p.columns.forEach((c) => c.cells.forEach((x) => {
    if (x === "open") open++;
    if (x.includes("door")) doors++;
    if (x.startsWith("drawer")) drawers += x === "drawer" ? 1 : x === "drawer2" ? 2 : 3;
    if (x.startsWith("rail")) rails++;
  }));
  return { columns: p.columns.length, open, doors, drawers, rails };
}
