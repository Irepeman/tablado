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
    drawers: clamp(Math.round(Number(c && c.drawers) || 0), 0, 4),
    door: !!(c && c.door),
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
  const maxDrawers = Math.max(0, Math.floor(Hi / DRAWER_H));
  cols.forEach((c) => {
    c.drawers = Math.min(c.drawers, maxDrawers);             // que los cajones quepan en el hueco
    const floor = c.drawers * DRAWER_H + (c.drawers ? 40 : 0);
    if (floor + 120 > Hi - 120) { c.shelves = []; return; }  // sin sitio encima: no hay baldas
    const kept = [];
    c.shelves = c.shelves
      .map((s) => clamp(Math.round(s), floor + 120, Hi - 120))
      .sort((a, b) => a - b)
      .filter((s) => {
        if (kept.some((x) => Math.abs(x - s) < 140)) return false;
        kept.push(s);
        return true;
      })
      .slice(0, 8);
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
  const floor = c.drawers * DRAWER_H + (c.drawers ? 40 : 0);
  const n = clamp(Math.round(k), 0, 8);
  c.shelves = Array.from({ length: n }, (_, i) =>
    Math.round(floor + ((Hi - floor) * (i + 1)) / (n + 1)));
  return c;
}

export function spaceShelves(p, c, gap) {
  const Hi = p.height - p.baseHeight - 2 * p.thickness;
  const floor = c.drawers * DRAWER_H + (c.drawers ? 40 : 0);
  const k = Math.max(0, Math.floor((Hi - floor) / gap) - 1);
  c.shelves = Array.from({ length: k }, (_, i) => Math.round(floor + gap * (i + 1)));
  return c;
}

/* Cambiar los cajones reparte otra vez las baldas de ESA columna por encima,
   con las mismas baldas: antes quedaban apretadas contra el cajón de arriba. */
export function setDrawers(p, c, k) {
  const next = clamp(Math.round(k), 0, 4);
  if (next === c.drawers) return c;
  c.drawers = next;
  return setShelfCount(p, c, c.shelves.length);
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

    for (let k = 0; k < c.drawers; k++) {
      const fh = DRAWER_H - GAP;
      add({ id: `cajon_${i}_${k}`, label: P.drawerFront(i + 1), grp: "frente", col: i,
            L: c.width - GAP, Wd: fh, t, edges: 4,
            pos: [cx, y0 + k * DRAWER_H + fh / 2 + GAP / 2, D / 2 + t / 2 + 1],
            size: [c.width - GAP, fh, t] });
      /* La caja del cajón se dibuja: sin trasera se ve desde detrás.
         12,5 mm de holgura por lado para las guías; el fondo entra en ranura. */
      const bw = c.width - 25, bd = D - 60, zb = D / 2 - 5 - bd / 2;
      const yb = y0 + k * DRAWER_H + 20, sh = DRAWER_H - 70, eh = DRAWER_H - 80;
      [x + 12.5 + 6, x + 12.5 + bw - 6].forEach((sx, s2) => add({
        id: `cjlat_${i}_${k}_${s2}`, label: P.drawerSide(i + 1), grp: "cajon", col: i,
        L: bd, Wd: sh, t: 12, edges: 1, pos: [sx, yb + sh / 2, zb], size: [12, sh, bd] }));
      add({ id: `cjfondo_${i}_${k}`, label: P.drawerBottom(i + 1), grp: "cajon", col: i,
            L: c.width - 40, Wd: bd, t: 6, edges: 0, pos: [cx, yb + 3, zb], size: [bw - 24, 6, bd - 24] });
      [zb + bd / 2 - 6, zb - bd / 2 + 6].forEach((ez, e2) => add({
        id: `cjtest_${i}_${k}_${e2}`, label: P.drawerEnd(i + 1), grp: "cajon", col: i,
        L: c.width - 49, Wd: eh, t: 12, edges: 1, pos: [cx, yb + 6 + eh / 2, ez], size: [bw - 24, eh, 12] }));
    }

    if (c.door) {
      const dBot = c.drawers * DRAWER_H;
      const dh = Hi - dBot - GAP;
      if (dh > 150) {
        /* Hojas de 600 mm como máximo: más ancha, la puerta descuelga las bisagras. */
        const leaves = Math.max(1, Math.ceil((c.width - GAP) / 600));
        const leaf = (c.width - leaves * GAP) / leaves;
        const yC = y0 + dBot + dh / 2 + GAP / 2, zC = D / 2 + t / 2 + 1;
        for (let k = 0; k < leaves; k++) {
          const left = x + GAP / 2 + k * (leaf + GAP);
          add({ id: leaves > 1 ? `puerta_${i}_${k}` : `puerta_${i}`, label: P.door(i + 1),
                grp: "frente", col: i, hinge: k < Math.ceil(leaves / 2) ? "L" : "R",
                L: leaf, Wd: dh, t, edges: 4, pos: [left + leaf / 2, yC, zC], size: [leaf, dh, t] });
        }
      }
    }

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
