/* ============================================================
   MOTOR PARAMÉTRICO — la única fuente de verdad
   De este módulo salen las tres cosas a la vez: la geometría 3D que ve
   el cliente, el despiece que va al taller y la base del presupuesto.
   No hay traducción entre ellas, así que lo que se renderiza es
   exactamente lo que se corta.

   Corre igual en el navegador y en el servidor: la ruta de la API
   normaliza aquí lo que devuelve el modelo antes de aceptarlo.
   Unidades: milímetros.
   ============================================================ */

import { PIECES, VAL, matShort } from "./i18n.js";

export const SHEET = { L: 2800, W: 2070, kerf: 4, margin: 10 };
export const BACK_T = 3;
export const DRAWER_H = 190;
export const GAP = 3;
/* Cada columna se divide en huecos (entre baldas), de abajo arriba.
   Un hueco puede ser: abierto, puerta, 1–3 cajones, o barra de colgar
   (con o sin puerta). Las puertas de huecos seguidos son una sola hoja. */
export const CELL_TYPES = ["open", "door", "drawer", "drawer2", "drawer3", "rail", "rail+door"];
export const MIN_FRONT = 110;        // frente de cajón más bajo que se fabrica
export const drawersIn = (x) => (x === "drawer" ? 1 : x === "drawer2" ? 2 : x === "drawer3" ? 3 : 0);
export const drawerType = (n) => (n <= 0 ? "open" : n === 1 ? "drawer" : n === 2 ? "drawer2" : "drawer3");
export const isDoor = (x) => x === "door" || x === "rail+door";
export const isRail = (x) => x === "rail" || x === "rail+door";

/* Carga de servicio 60 kg/m² y flecha admisible L/300 */
const LOAD = 5.88e-4;
const DEFL = 300;

export const MATERIALS = {
  melamina_blanca: { name: "Melamina blanca", short: "Blanco", E: 2500, rho: 680, hex: 0xedeae4, rough: 0.42, grain: false, cost: { 16: 14, 18: 16, 22: 21 } },
  melamina_negra:  { name: "Melamina negra",  short: "Negro",  E: 2500, rho: 690, hex: 0x24241f, rough: 0.38, grain: false, cost: { 16: 16, 18: 18, 22: 23 } },
  abedul:          { name: "Contrachapado de abedul", short: "Abedul", E: 8000, rho: 680, hex: 0xe2c89c, rough: 0.55, grain: true, cost: { 16: 38, 18: 44, 22: 58 } },
  roble:           { name: "Chapado en roble", short: "Roble", E: 7000, rho: 700, hex: 0xc29a64, rough: 0.5,  grain: true, cost: { 16: 42, 18: 48, 22: 62 } },
  nogal:           { name: "Chapado en nogal", short: "Nogal", E: 7000, rho: 720, hex: 0x6e4b33, rough: 0.48, grain: true, cost: { 16: 55, 18: 62, 22: 79 } },
};
export const MATKEYS = Object.keys(MATERIALS);
export const BASES = ["patas", "zocalo", "flotante"];
export const THICKNESSES = [16, 18, 22];

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const deepCopy = (o) => JSON.parse(JSON.stringify(o));
const r10 = (v) => Math.round(v / 10) * 10;

/* Luz máxima de balda sin flecha visible.
   δ = 5qL⁴/(384·E·I) ≤ L/300  con I = b·t³/12
   El ancho de la balda se cancela: solo dependen material y espesor. */
export function maxSpan(matKey, t) {
  const E = (MATERIALS[matKey] || MATERIALS.roble).E;
  return Math.cbrt((384 * E * Math.pow(t, 3)) / (DEFL * 60 * LOAD));
}

const innerH = (p) => p.height - p.baseHeight - 2 * p.thickness;
/* límites de cada hueco: 0, ejes de las baldas, alto interior */
export const cellBounds = (p, c) => [0, ...c.shelves, innerH(p)];
/* alto libre del hueco j (descontando media balda arriba y abajo) */
export function cellClear(p, c, j) {
  const b = cellBounds(p, c), last = b.length - 2, t = p.thickness;
  return (b[j + 1] - (j < last ? t / 2 : 0)) - (b[j] + (j > 0 ? t / 2 : 0));
}
const sync = (c) => { const x = colSummary(c); c.drawers = x.drawers; c.door = x.door; return c; };
export const colSummary = (c) => ({
  drawers: c.cells.reduce((a, x) => a + drawersIn(x), 0),
  door: c.cells.some(isDoor),
  rail: c.cells.some(isRail),
});

/* Cajones en un hueco muy alto: se pone una balda encima del bloque de cajones,
   alineada con la de una columna vecina si hay alguna cerca. */
function splitForDrawers(p, c, j, n, cols) {
  if (cellClear(p, c, j) <= n * 450 || c.shelves.length >= 8) return j;
  const b = cellBounds(p, c);
  const want = b[j] + n * 220;
  const top = b[j + 1] - 140, bottom = b[j] + n * MIN_FRONT + p.thickness;
  const near = (cols || p.columns).filter((o) => o !== c).flatMap((o) => o.shelves)
    .filter((v) => v >= bottom && v <= top && Math.abs(v - want) <= 140)
    .sort((a, z) => Math.abs(a - want) - Math.abs(z - want))[0];
  const at = Math.round(near ?? want);
  if (at < bottom || at > top || at < 120) return j;
  c.shelves.splice(j, 0, at);
  c.cells.splice(j, 0, c.cells[j]);          // el hueco de arriba conserva lo que tenía
  return j;
}

/* Cambia un hueco. Con cajones en un hueco alto, lo parte primero. */
export function setCell(p, c, j, type, cols) {
  if (!CELL_TYPES.includes(type) || j < 0 || j >= c.cells.length) return c;
  const n = drawersIn(type);
  if (n) j = splitForDrawers(p, c, j, n, cols);
  c.cells[j] = type;
  return sync(c);
}

export function cellAtHeight(p, c, y) {
  const b = cellBounds(p, c);
  for (let j = 0; j < b.length - 1; j++) if (y < b[j + 1]) return j;
  return b.length - 2;
}

/* Misma operación en toda una fila: «bottom», «top» o un índice */
export function setRow(p, which, type) {
  p.columns.forEach((c) => {
    const last = c.cells.length - 1;
    const j = which === "top" ? last : which === "bottom" ? 0 : which === "middle" ? Math.floor(last / 2) : Math.min(which, last);
    setCell(p, c, j, type);
  });
  return p;
}

/* N cajones en la columna, desde abajo, sin descolocar las baldas */
export function setColumnDrawers(p, c, k, cols) {
  k = clamp(Math.round(k), 0, 9);
  const closed = c.cells.some(isDoor);
  c.cells = c.cells.map((x) => (drawersIn(x) ? (closed ? "door" : "open") : x));
  if (!k) return c;
  splitForDrawers(p, c, 0, Math.min(k, 3), cols);
  let left = k;
  for (let j = 0; j < c.cells.length && left > 0; j++) {
    if (isRail(c.cells[j])) continue;
    const cap = Math.min(3, Math.floor(cellClear(p, c, j) / MIN_FRONT));
    if (cap < 1) continue;
    const m = Math.min(cap, left);
    c.cells[j] = drawerType(m);
    left -= m;
  }
  return c;
}

/* Puerta en todos los huecos que no son cajones (la barra se queda dentro) */
export function setColumnDoor(c, on) {
  c.cells = c.cells.map((x) => (drawersIn(x) ? x
    : on ? (isRail(x) ? "rail+door" : "door")
    : x === "rail+door" ? "rail" : x === "door" ? "open" : x));
  return c;
}

/* Barra de colgar: un hueco alto con balda de maletero encima */
export function addRail(p, c) {
  const Hi = innerH(p);
  const keepDrawers = drawersIn(c.cells[0]) ? c.cells[0] : null;
  const closed = c.cells.some(isDoor);
  const hat = Math.round(Hi - 340);
  const low = keepDrawers ? c.shelves[0] : null;
  c.shelves = [...(low != null && low < hat - 700 ? [low] : []), hat];
  c.cells = [...(c.shelves.length === 2 ? [keepDrawers] : []), closed ? "rail+door" : "rail", closed ? "door" : "open"];
  return sync(c);
}

export const legCount = (p) => (p.base !== "patas" ? 0 : p.width > 1600 ? 6 : 4);

export const DEFAULT = () => ({
  width: 2400, height: 2000, depth: 320, thickness: 18,
  material: "roble", base: "patas", baseHeight: 110, back: true,
  columns: Array.from({ length: 4 }, () => ({
    width: 562, shelves: [430, 860, 1290], drawers: 0, door: false,
  })),
});

/* ------------------------------------------------------------
   normalize() — la red de seguridad.
   Todo lo que entra pasa por aquí: el chat, el ratón y el modelo.
   Garantiza que el objeto siempre describe un mueble fabricable.
   ------------------------------------------------------------ */
export function normalize(input) {
  const d = DEFAULT();
  const p = Object.assign({}, d, input || {});

  p.thickness = THICKNESSES.includes(Number(p.thickness)) ? Number(p.thickness) : 18;
  if (!MATERIALS[p.material]) p.material = "roble";
  if (!BASES.includes(p.base)) p.base = "patas";
  p.back = !!p.back;
  p.width  = clamp(r10(Number(p.width)  || d.width),   400, 3200);
  p.height = clamp(r10(Number(p.height) || d.height),  400, 2600);   // 400: muebles de TV y bancos
  p.depth  = clamp(r10(Number(p.depth)  || d.depth),   180,  600);
  p.baseHeight =
    p.base === "patas"  ? clamp(Number(p.baseHeight) || 110, 60, 220)
  : p.base === "zocalo" ? clamp(Number(p.baseHeight) || 80,  50, 160)
  : 0;

  const t = p.thickness;
  let cols = Array.isArray(p.columns) && p.columns.length ? p.columns : d.columns;
  cols = cols.slice(0, 8).map((c) => ({
    width: Math.max(120, Number(c && c.width) || 400),
    shelves: Array.isArray(c && c.shelves)
      ? c.shelves.map(Number).filter((n) => Number.isFinite(n))
      : [],
    cells: Array.isArray(c && c.cells) ? c.cells.map((x) => (CELL_TYPES.includes(x) ? x : "open")) : null,
    /* campos de siempre: si cambian, se traducen a huecos más abajo */
    drawers: c && c.drawers != null ? clamp(Math.round(Number(c.drawers) || 0), 0, 9) : null,
    door: c && c.door != null ? !!c.door : null,
  }));

  /* El ancho interior se reparte EXACTAMENTE entre columnas y divisores.
     Si el modelo devuelve anchos que no suman, se reescalan en proporción. */
  const MINC = 150;
  const capacity = p.width - 2 * t - (cols.length - 1) * t;
  if (capacity < cols.length * MINC) {
    cols = cols.slice(0, Math.max(1, Math.floor(capacity / MINC)));
  }
  const inner = p.width - 2 * t - (cols.length - 1) * t;
  const sum = cols.reduce((a, c) => a + c.width, 0) || 1;
  let acc = 0;
  cols.forEach((c, i) => {
    if (i === cols.length - 1) c.width = Math.round(inner - acc);
    else { c.width = Math.max(MINC, Math.round((c.width / sum) * inner)); acc += c.width; }
  });
  if (cols[cols.length - 1].width < MINC) {
    const each = inner / cols.length;
    let a2 = 0;
    cols.forEach((c, i) => {
      c.width = i === cols.length - 1 ? Math.round(inner - a2) : Math.round(each);
      if (i < cols.length - 1) a2 += c.width;
    });
  }

  /* Ninguna columna por encima de 1.500 mm: ningún tablero salva esa luz sin
     combarse, y así balda, frente y puerta caben siempre en un tablero.
     Se parte la columna en dos con un divisor en medio. */
  const MAXC = 1500;
  for (let guard = 0; guard < 16; guard++) {
    const i = cols.findIndex((c) => c.width > MAXC);
    if (i < 0 || cols.length >= 8) break;
    const c = cols[i];
    const w1 = Math.floor((c.width - t) / 2), w2 = c.width - t - w1;
    cols.splice(i, 1, { ...deepCopy(c), width: w1 }, { ...deepCopy(c), width: w2 });
  }

  /* Baldas dentro del hueco útil, por encima de los cajones,
     con 140 mm mínimos entre ellas. */
  const Hi = p.height - p.baseHeight - 2 * t;
  p.columns = cols;
  cols.forEach((c) => {
    /* baldas: dentro del hueco útil y a 140 mm como mínimo entre ellas;
       si una sobra, los dos huecos que separaba se juntan */
    const sorted = c.shelves.map((v) => clamp(Math.round(v), 120, Hi - 120)).sort((a, b) => a - b);
    let cells = c.cells ? c.cells.slice() : null;
    const kept = [];
    sorted.forEach((v) => {
      if (Hi < 380 || kept.length >= 8 || (kept.length && v - kept[kept.length - 1] < 140)) {
        if (cells && cells.length > kept.length + 1) {
          const a = cells[kept.length], b = cells[kept.length + 1];
          cells.splice(kept.length, 2, a === "open" ? b : a);
        }
        return;
      }
      kept.push(v);
    });
    c.shelves = kept;
    const n = kept.length + 1;
    cells = (cells || []).slice(0, n);
    while (cells.length < n) cells.push(cells.length && isDoor(cells[cells.length - 1]) ? "door" : "open");
    c.cells = cells;
    const before = colSummary(c);
    if (c.door != null && c.door !== before.door) setColumnDoor(c, c.door);
    if (c.drawers != null && c.drawers !== before.drawers) setColumnDrawers(p, c, c.drawers, cols);
    /* lo que no cabe en su hueco se reduce: menos cajones, o sin barra */
    c.cells = c.cells.map((x, j) => {
      const h = cellClear(p, c, j), nd = drawersIn(x);
      if (nd) return drawerType(Math.min(nd, 3, Math.floor(h / MIN_FRONT)));
      if (isRail(x) && h < 600) return isDoor(x) ? "door" : "open";
      return x;
    });
    const after = colSummary(c);
    c.drawers = after.drawers;
    c.door = after.door;
  });

  p.columns = cols;
  return p;
}

export function redistribute(p) {
  const each = (p.width - 2 * p.thickness - (p.columns.length - 1) * p.thickness) / p.columns.length;
  p.columns.forEach((c) => { c.width = each; });
  return p;
}

export function setShelfCount(p, c, k) {
  const Hi = p.height - p.baseHeight - 2 * p.thickness;
  const floor = 0;
  const n = clamp(Math.round(k), 0, 8);
  c.shelves = Array.from({ length: n }, (_, i) =>
    Math.round(floor + ((Hi - floor) * (i + 1)) / (n + 1)));
  return c;
}

export function spaceShelves(p, c, gap) {
  const Hi = p.height - p.baseHeight - 2 * p.thickness;
  const floor = 0;
  const k = Math.max(0, Math.floor((Hi - floor) / gap) - 1);
  c.shelves = Array.from({ length: k }, (_, i) => Math.round(floor + gap * (i + 1)));
  return c;
}

/* Cambiar los cajones reparte otra vez las baldas de ESA columna por encima,
   con las mismas baldas: antes quedaban apretadas contra el cajón de arriba. */
export function setDrawers(p, c, k) {
  c.drawers = clamp(Math.round(k), 0, 9);
  return c;
}

export function addColumn(p) {
  if (p.columns.length >= 8) return p;
  const w = Math.max(...p.columns.map((c) => c.width));
  const i = p.columns.findIndex((c) => c.width === w);
  p.columns.splice(i + 1, 0, deepCopy(p.columns[i]));
  return p;
}

/* ------------------------------------------------------------
   build() — parámetros a piezas.
   Cada pieza lleva a la vez su geometría 3D (pos/size) y sus medidas
   de taller (L, Wd, t, cantos). Un solo objeto, dos destinos.
   ------------------------------------------------------------ */
export function build(p, lang = "es") {
  const P = PIECES[lang] || PIECES.es;
  const t = p.thickness, W = p.width, H = p.height, D = p.depth, b = p.baseHeight;
  const Hc = H - b, Hi = Hc - 2 * t, x0 = -W / 2 + t, y0 = b + t;
  const shelfD = p.back ? D - BACK_T : D;
  const parts = [];
  const add = (o) => { parts.push(o); return o; };

  add({ id: "lat_i", label: P.latL, grp: "carcasa", L: Hc, Wd: D, t, edges: 1,
        pos: [-W / 2 + t / 2, b + Hc / 2, 0], size: [t, Hc, D] });
  add({ id: "lat_d", label: P.latR, grp: "carcasa", L: Hc, Wd: D, t, edges: 1,
        pos: [W / 2 - t / 2, b + Hc / 2, 0], size: [t, Hc, D] });
  /* Tramos horizontales (techo, suelo, zócalo): si no caben en un tablero se
     parten sobre el divisor más cercano al centro, que es donde apoya la junta. */
  const usable = SHEET.L - 2 * SHEET.margin;
  const divX = [];
  { let xx = x0; p.columns.forEach((c, i) => { if (i < p.columns.length - 1) divX.push(xx + c.width + t / 2); xx += c.width + t; }); }
  const L0 = -W / 2 + t, L1 = W / 2 - t;
  const runs = (L1 - L0 <= usable || !divX.length) ? [[L0, L1]]
    : (() => { const cut = divX.reduce((a, v) => (Math.abs(v) < Math.abs(a) ? v : a), divX[0]); return [[L0, cut], [cut, L1]]; })();
  const addRuns = (id, label, grp, y, z, h, d, wd) => runs.forEach(([a, e], k) => add({
    id: runs.length > 1 ? `${id}_${k}` : id, label: runs.length > 1 ? `${label} (${k + 1}/2)` : label,
    grp, L: e - a, Wd: wd, t, edges: 1, pos: [(a + e) / 2, y, z], size: [e - a, h, d] }));
  addRuns("techo", P.top, "carcasa", b + Hc - t / 2, 0, t, D, D);
  addRuns("suelo", P.bottom, "carcasa", b + t / 2, 0, t, D, D);

  let x = x0;
  p.columns.forEach((c, i) => {
    const cx = x + c.width / 2;

    c.shelves.forEach((s, j) => {
      add({ id: `balda_${i}_${j}`, label: P.shelf(i + 1), grp: "balda", col: i, shelf: j,
            L: c.width, Wd: shelfD, t, edges: 1, drag: "y",
            pos: [cx, y0 + s, p.back ? BACK_T / 2 : 0], size: [c.width, t, shelfD] });
    });

    const cells = c.cells || [];
    const bnd = [0, ...c.shelves, Hi], last = cells.length - 1;
    const cLo = (j) => bnd[j] + (j > 0 ? t / 2 : 0), cHi = (j) => bnd[j + 1] - (j < last ? t / 2 : 0);
    const zF = D / 2 + t / 2 + 1;
    for (let j = 0; j <= last; ) {
      const nd = drawersIn(cells[j]);
      if (nd) {
        /* los frentes cubren el hueco hasta el eje de las baldas; la caja va dentro */
        const lo = bnd[j], fh = (bnd[j + 1] - lo) / nd, slot = (cHi(j) - cLo(j)) / nd;
        for (let k = 0; k < nd; k++) {
          const key = `${i}_${j}_${k}`;
          add({ id: `cajon_${key}`, label: P.drawerFront(i + 1), grp: "frente", col: i, cell: j, drawer: key,
                L: c.width - GAP, Wd: fh - GAP, t, edges: 4,
                pos: [cx, y0 + lo + k * fh + fh / 2, zF], size: [c.width - GAP, fh - GAP, t] });
          /* caja: 12,5 mm de holgura por lado para las guías; el fondo entra en ranura */
          const bw = c.width - 25, bd = D - 60, zb = D / 2 - 5 - bd / 2;
          const sh = Math.max(50, slot - 40), eh = sh - 10, yb = y0 + cLo(j) + k * slot + 20;
          [x + 12.5 + 6, x + 12.5 + bw - 6].forEach((sx, s2) => add({
            id: `cjlat_${key}_${s2}`, label: P.drawerSide(i + 1), grp: "cajon", col: i, cell: j, drawer: key,
            L: bd, Wd: sh, t: 12, edges: 1, pos: [sx, yb + sh / 2, zb], size: [12, sh, bd] }));
          add({ id: `cjfondo_${key}`, label: P.drawerBottom(i + 1), grp: "cajon", col: i, cell: j, drawer: key,
                L: c.width - 40, Wd: bd, t: 6, edges: 0, pos: [cx, yb + 3, zb], size: [bw - 24, 6, bd - 24] });
          [zb + bd / 2 - 6, zb - bd / 2 + 6].forEach((ez, e2) => add({
            id: `cjtest_${key}_${e2}`, label: P.drawerEnd(i + 1), grp: "cajon", col: i, cell: j, drawer: key,
            L: c.width - 49, Wd: eh, t: 12, edges: 1, pos: [cx, yb + 6 + eh / 2, ez], size: [bw - 24, eh, 12] }));
        }
        j++;
      } else if (isDoor(cells[j])) {
        /* huecos seguidos con puerta: una sola puerta alta, como en un armario */
        let e = j;
        while (e < last && isDoor(cells[e + 1])) e++;
        const lo = bnd[j], dh = bnd[e + 1] - lo - GAP;
        if (dh > 150) {
          /* hojas de 600 mm como máximo: más ancha, la puerta descuelga las bisagras */
          const leaves = Math.max(1, Math.ceil((c.width - GAP) / 600));
          const leaf = (c.width - leaves * GAP) / leaves;
          for (let k = 0; k < leaves; k++) {
            const left = x + GAP / 2 + k * (leaf + GAP);
            add({ id: `puerta_${i}_${j}_${k}`, label: P.door(i + 1), grp: "frente", col: i, cell: j, cells: [j, e],
                  hinge: leaves > 1 ? (k < Math.ceil(leaves / 2) ? "L" : "R")
                    : p.columns.length > 1 && i >= p.columns.length / 2 ? "R" : "L",
                  L: leaf, Wd: dh, t, edges: 4, pos: [left + leaf / 2, y0 + lo + (bnd[e + 1] - lo) / 2, zF], size: [leaf, dh, t] });
          }
        }
        j = e + 1;
      } else j++;
    }
    /* barra de colgar: herraje, no sale del tablero; a 60 mm de la balda de encima */
    cells.forEach((x2, j) => {
      if (!isRail(x2)) return;
      add({ id: `barra_${i}_${j}`, label: P.rail(i + 1), grp: "barra", hw: true, col: i, cell: j,
            L: c.width - 10, Wd: 25, t: 25, edges: 0,
            pos: [cx, y0 + cHi(j) - 60, p.back ? BACK_T / 2 : 0], size: [c.width - 10, 25, 25] });
    });

    if (i < p.columns.length - 1) {
      add({ id: `div_${i}`, label: P.divider, grp: "divisor", div: i, drag: "x",
            L: Hi, Wd: shelfD, t, edges: 1,
            pos: [x + c.width + t / 2, y0 + Hi / 2, p.back ? BACK_T / 2 : 0], size: [t, Hi, shelfD] });
    }
    x += c.width + t;
  });

  if (p.back) {
    const bw = W - 2 * t, bh = Hc - 2 * t;
    const fits = Math.max(bw, bh) <= usable && Math.min(bw, bh) <= SHEET.W - 2 * SHEET.margin;
    if (fits) {
      add({ id: "trasera", label: P.back, grp: "trasera", L: bw, Wd: bh, t: BACK_T, edges: 0,
            pos: [0, b + Hc / 2, -D / 2 + BACK_T / 2], size: [bw, bh, BACK_T] });
    } else {
      /* Una trasera por hueco: entera no cabe en ningún tablero. */
      let xx = x0;
      p.columns.forEach((c, i) => {
        add({ id: `trasera_${i}`, label: P.backCol(i + 1), grp: "trasera", L: c.width, Wd: bh,
              t: BACK_T, edges: 0, pos: [xx + c.width / 2, b + Hc / 2, -D / 2 + BACK_T / 2],
              size: [c.width, bh, BACK_T] });
        xx += c.width + t;
      });
    }
  }

  if (p.base === "zocalo") {
    addRuns("zoc_f", P.plinthF, "base", b / 2, D / 2 - 40 - t / 2, b, t, b);
    addRuns("zoc_t", P.plinthB, "base", b / 2, -D / 2 + 20 + t / 2, b, t, b);
    /* zócalos laterales, bajo cada costado: se ven al girar el mueble */
    [-1, 1].forEach((sg, s2) => add({ id: `zoc_l_${s2}`, label: P.plinthS, grp: "base",
          L: D - 60, Wd: b, t, edges: 1,
          pos: [sg * (W / 2 - t / 2), b / 2, D / 2 - 40 - (D - 60) / 2], size: [t, b, D - 60] }));
  }

  return { parts, Hc, Hi, x0, y0, shelfD };
}

/* ------------------------------------------------------------
   validate() — reglas de fabricación (DFM).
   Aquí vive el conocimiento de oficio, y es el activo real:
   no está en el modelo de lenguaje, está en estas reglas.
   ------------------------------------------------------------ */
export function validate(p, geo, lang = "es") {
  const V = VAL[lang] || VAL.es;
  const out = [];
  const t = p.thickness;
  const span = maxSpan(p.material, t);
  const worst = Math.max(...p.columns.map((c) => c.width));

  if (worst > span) {
    out.push({ lvl: "warn", fix: "addColumn", t: V.spanOverT,
      d: V.spanOver(Math.round(worst), Math.round(span), matShort(p.material, lang).toLowerCase(), t) });
  } else if (worst > span * 0.88) {
    out.push({ lvl: "warn", t: V.spanNearT,
      d: V.spanNear(Math.round(worst), Math.round(span)) });
  }

  const over = geo.parts.filter((x) => !x.hide &&
    (Math.max(x.L, x.Wd) > SHEET.L - 2 * SHEET.margin ||
     Math.min(x.L, x.Wd) > SHEET.W - 2 * SHEET.margin));
  if (over.length) {
    out.push({ lvl: "warn", t: V.sheetT,
      d: V.sheet(over[0].label, Math.round(over[0].L), Math.round(over[0].Wd), SHEET.L, SHEET.W) });
  }

  if (p.height > 1200 && p.depth < 400) {
    out.push({ lvl: "ok", t: V.anchorT,
      d: V.anchor(Math.round(p.height), Math.round(p.depth)) });
  }
  if (p.base === "flotante" && p.width > 1600) {
    out.push({ lvl: "warn", t: V.floatT,
      d: V.float(Math.round(p.width)) });
  }

  if (p.columns.some((c) => (c.cells || []).some(isRail)) && p.depth < 500) {
    out.push({ lvl: "warn", fix: "hangDepth", t: V.railT, d: V.rail(Math.round(p.depth)) });
  }
  p.columns.forEach((c, i) => {
    if (c.drawers && c.width < 250) {
      out.push({ lvl: "warn", t: V.narrowT,
        d: V.narrow(i + 1, Math.round(c.width)) });
    }
  });

  if (out.every((o) => o.lvl !== "warn")) {
    out.unshift({ lvl: "ok", t: V.okT,
      d: V.ok });
  }
  return out;
}

/* ------------------------------------------------------------
   Tipos de mueble: puntos de partida que se pueden seguir editando.
   Conservan acabado y espesor. Medidas de armario: 600 mm de fondo
   (perchas de 450 mm), barra a 60 mm bajo el maletero.
   ------------------------------------------------------------ */
const col = (width, shelves, cells) => ({ width, shelves, cells });
export const PRESETS = {
  estanteria: (cur) => normalize({ ...DEFAULT(), material: cur.material, thickness: cur.thickness }),
  libreria: (cur) => normalize({ ...DEFAULT(), material: cur.material, thickness: cur.thickness,
    columns: Array.from({ length: 4 }, () => col(562, [430, 860, 1290], ["door", "open", "open", "open"])) }),
  armario: (cur) => {
    const p = { width: 1800, height: 2200, depth: 600, thickness: cur.thickness, material: cur.material,
      base: "zocalo", baseHeight: 80, back: true };
    const Hi = p.height - p.baseHeight - 2 * p.thickness, hat = Hi - 340;
    p.columns = [
      col(860, [hat], ["rail+door", "door"]),
      col(860, [460, 900, 1320, hat], ["drawer2", "door", "door", "door", "door"]),
    ];
    return normalize(p);
  },
  aparador: (cur) => normalize({ width: 1800, height: 800, depth: 420, thickness: cur.thickness, material: cur.material,
    base: "patas", baseHeight: 110, back: true,
    columns: [col(560, [320], ["door", "door"]), col(560, [], ["drawer3"]), col(560, [320], ["door", "door"])] }),
  tv: (cur) => normalize({ width: 1800, height: 500, depth: 400, thickness: cur.thickness, material: cur.material,
    base: "patas", baseHeight: 110, back: true,
    columns: [col(500, [], ["drawer"]), col(700, [], ["open"]), col(500, [], ["drawer"])] }),
  comoda: (cur) => normalize({ width: 1000, height: 900, depth: 450, thickness: cur.thickness, material: cur.material,
    base: "patas", baseHeight: 110, back: true,
    columns: [col(480, [], ["drawer3"]), col(480, [], ["drawer3"])] }),
};
export const PRESET_KEYS = Object.keys(PRESETS);
