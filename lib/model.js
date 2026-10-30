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
export const CELL_TYPES = ["open", "door", "drawer", "drawer2", "drawer3", "rail", "rail+door",
  "door+drawer", "door+drawer2", "door+drawer3", "tray"];
/* Tiradores: uno para todo el mueble, como en los configuradores de catálogo.
   bar: barra negra · bar_brass: barra de latón · knob: pomo · cup: embutido (uñero)
   profile: perfil gola de aluminio · push: sin tirador, apertura por presión */
export const HANDLES = ["bar", "bar_brass", "knob", "cup", "profile", "push"];
export const MIN_FRONT = 110;        // frente de cajón más bajo que se fabrica
export const drawersIn = (x) => (x === "drawer" ? 1 : x === "drawer2" ? 2 : x === "drawer3" ? 3 : 0);
export const drawerType = (n) => (n <= 0 ? "open" : n === 1 ? "drawer" : n === 2 ? "drawer2" : "drawer3");
/* door+drawer[2|3]: puerta con un bloque de 1 a 3 cajones interiores detrás, como
   en un armario de verdad · tray: bandeja extraíble (zapatero).
   Antes solo cabía un cajón interior suelto, con un palmo de aire encima: ni se
   fabrica así ni se vende así. */
export const boxesIn = (x) => (x === "door+drawer" ? 1 : x === "door+drawer2" ? 2 : x === "door+drawer3" ? 3 : x === "tray" ? 1 : 0);
export const boxType = (n) => (n <= 1 ? "door+drawer" : n === 2 ? "door+drawer2" : "door+drawer3");
export const isInner = (x) => x === "door+drawer" || x === "door+drawer2" || x === "door+drawer3";
export const hasBox = (x) => isInner(x) || x === "tray";
export const drawerCount = (x) => drawersIn(x) + boxesIn(x);
export const BOX_MIN = 150;           // hueco libre mínimo por cada cajón interior o bandeja
export const BOX_H = 200;             // lo que ocupa de alto un cajón interior en el bloque
export const BOX_MAX = 280;           // frente de cajón interior más alto que sigue pareciendo un cajón
export const isDoor = (x) => x === "door" || x === "rail+door" || isInner(x);
export const isRail = (x) => x === "rail" || x === "rail+door";
/* una hoja de puerta por dónde está y lo que mide: los ids cambian al partir o
   mover huecos, y una puerta abierta no puede pasar a ser otra */
export const doorKey = (x) => `${x.col}:${Math.round(x.pos[0])}:${Math.round(x.pos[1] - x.Wd / 2)}:${Math.round(x.pos[1] + x.Wd / 2)}`;
/* c.joins[j]: la puerta del hueco j sigue en el hueco j+1 (una sola hoja alta,
   como en un armario). Una puerta soltada en un hueco es suya: no se une. */
export const joinsOf = (c) => (Array.isArray(c.joins) && c.joins.length === c.cells.length - 1
  ? c.joins : Array.from({ length: Math.max(0, c.cells.length - 1) }, () => true));

/* c.mix[j]: qué parte del hueco se lleva cada cajón del bloque, en tanto por uno.
   null = todos iguales, que es lo normal. Va en paralelo a cells, como joins:
   así se puede estirar un cajón y que los demás se repartan lo que queda. */
export const mixOf = (c) => (Array.isArray(c.mix) && c.mix.length === c.cells.length
  ? c.mix : c.cells.map(() => null));
export const cleanMix = (m, n) => {
  if (!Array.isArray(m) || m.length !== n || n < 2) return null;
  const v = m.map((x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : 0));
  const sum = v.reduce((a, x) => a + x, 0);
  return sum > 0 && v.every((x) => x > 0) ? v.map((x) => x / sum) : null;
};
/* el reparto del bloque de n frentes del hueco j (suma 1) */
export const shareOf = (c, j, n) =>
  cleanMix(mixOf(c)[j], n) || Array.from({ length: n }, () => 1 / n);
export function setOwnDoor(c, j) {
  c.joins = joinsOf(c).slice();
  if (j > 0) c.joins[j - 1] = false;
  if (j < c.joins.length) c.joins[j] = false;
  return c;
}
/* lo que cabe en un hueco de h mm libres: menos cajones, o sin barra ni caja */
export function fitType(x, h) {
  const nd = drawersIn(x);
  if (nd) return drawerType(Math.min(nd, 3, Math.floor(h / MIN_FRONT)));
  if (isRail(x) && h < 600) return isDoor(x) ? "door" : "open";
  if (isInner(x)) {
    const fit = Math.min(boxesIn(x), Math.floor(h / BOX_MIN));
    return fit < 1 ? "door" : boxType(fit);
  }
  if (hasBox(x) && h < BOX_MIN) return isDoor(x) ? "door" : "open";
  return x;
}

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
  drawers: c.cells.reduce((a, x) => a + drawerCount(x), 0),
  door: c.cells.some(isDoor),
  rail: c.cells.some(isRail),
});

/* Cajones en un hueco muy alto: se pone una balda encima del bloque de cajones,
   alineada con la de una columna vecina si hay alguna cerca. */
function splitForDrawers(p, c, j, n, cols, inner = false) {
  /* si el hueco ya tiene cajones, se cambian en el sitio: partirlo añadía cajones de más */
  const need = inner ? n * BOX_H + 220 : Math.max(620, n * 450);
  if (drawerCount(c.cells[j]) || cellClear(p, c, j) <= need || c.shelves.length >= 8) return j;
  const b = cellBounds(p, c), t = p.thickness, last = b.length - 2;
  /* bloque de cajones interiores o bandeja: su propio compartimento abajo, tan alto
     como el bloque que va a llevar (unos 20 cm por cajón, más el aire); con balda
     fija encima, y arriba, si hay barra, sitio para colgar */
  const want = b[j] + (inner ? n * BOX_H + 60 : n * 220);
  const top = b[j + 1] - (inner && isRail(c.cells[j]) ? 600 + t / 2 + (j < last ? t / 2 : 0) : 140);
  const bottom = b[j] + (inner ? Math.max(140, n * BOX_MIN + t / 2 + (j > 0 ? t / 2 : 0) + 1) : Math.max(140, n * MIN_FRONT + t));
  const near = (cols || p.columns).filter((o) => o !== c).flatMap((o) => o.shelves)
    .filter((v) => v >= bottom && v <= top && Math.abs(v - want) <= 140)
    .sort((a, z) => Math.abs(a - want) - Math.abs(z - want))[0];
  const at = Math.round(inner ? clamp(near ?? want, bottom, top) : near ?? want);
  if (at < bottom || at > top || at < 120) return j;
  c.joins = joinsOf(c).slice();
  c.shelves.splice(j, 0, at);
  c.mix = mixOf(c).slice();
  c.cells.splice(j, 0, c.cells[j]);          // el hueco de arriba conserva lo que tenía
  c.mix.splice(j, 0, null);                  // el de abajo nace con los cajones iguales
  /* el cajón interior va detrás de la MISMA puerta que el resto del módulo, como en un armario de verdad */
  c.joins.splice(j, 0, inner && isDoor(c.cells[j + 1]));
  c.cells[j + 1] = fitType(c.cells[j + 1], cellClear(p, c, j + 1));
  return j;
}

/* Cambia un hueco. Con cajones en un hueco alto, lo parte primero. */
export function setCell(p, c, j, type, cols, split = true) {
  if (!CELL_TYPES.includes(type) || j < 0 || j >= c.cells.length) return c;
  const n = drawersIn(type);
  /* un cajón interior o una bandeja en un hueco alto no sustituye lo que hay (la barra, las baldas):
     se le hace sitio abajo y el resto sigue encima */
  /* un bloque de cajones interiores con balda encima no parte el hueco: fitBox
     mueve esa balda y el mueble no gana una línea más. Sobre una barra sí se
     parte, que la barra tiene que quedarse colgando arriba */
  if (split && hasBox(type) && !hasBox(c.cells[j])
      && !(isInner(type) && j < c.shelves.length && !isRail(c.cells[j])))
    j = splitForDrawers(p, c, j, boxesIn(type), cols, true);
  else if (n && split) j = splitForDrawers(p, c, j, n, cols);
  if (drawerCount(type) !== drawerCount(c.cells[j])) { c.mix = mixOf(c).slice(); c.mix[j] = null; }
  c.cells[j] = type;
  /* la balda de encima se pone a la altura del bloque, para que lo llene justo */
  if (split && isInner(type)) {
    const fit = fitBox(p, c, j, boxesIn(type), cols);
    if (fit.at != null) {
      c.shelves[j] = fit.at;
      c.cells[j + 1] = fitType(c.cells[j + 1], cellClear(p, c, j + 1));
    }
  }
  return sync(c);
}

/* El bloque de cajones del hueco j: cuántos son, cuánto alto se reparten y
   qué es lo menos que puede medir un frente. null si ahí no hay cajones. */
export function drawerBand(p, c, j) {
  const x = c && c.cells[j], nd = drawersIn(x), nb = boxesIn(x);
  const h = c ? cellClear(p, c, j) : 0;
  const n = nd || (isInner(x) ? Math.max(1, Math.min(nb, Math.floor(h / BOX_MIN))) : 0);
  if (!n) return null;
  const inner = !nd;
  /* span: lo que multiplica el reparto en build(). gap: la junta que se come
     cada frente. total: la suma de los frentes de verdad, que es lo que se ve
     y lo que se escribe en el panel. */
  const gap = inner ? 0 : GAP;
  const span = inner ? h - 20 - (n - 1) * GAP : h - GAP;
  return { n, inner, gap, span, total: span - n * gap, min: MIN_FRONT,
           front: (q) => q * span - gap, share: (mm) => (mm + gap) / span };
}

/* Estira o encoge UN cajón del bloque; los demás se reparten lo que queda, sin
   bajar nunca del frente más pequeño que se fabrica. El hueco no cambia de
   tamaño: lo que gana uno lo pierden los otros. */
export function setDrawerH(p, c, j, k, mm) {
  const b = drawerBand(p, c, j);
  if (!b || b.n < 2 || k < 0 || k >= b.n) return c;
  const cur = shareOf(c, j, b.n).map(b.front);
  const want = clamp(Math.round(mm), b.min, Math.round(b.total - (b.n - 1) * b.min));
  let left = want - cur[k];
  const others = cur.map((_, i) => i).filter((i) => i !== k);
  for (let pass = 0; pass < 4 && Math.abs(left) > 0.5; pass++) {
    const can = others.filter((i) => left < 0 || cur[i] - b.min > 0.5);
    if (!can.length) break;
    const each = left / can.length;
    can.forEach((i) => { const v = Math.max(b.min, cur[i] - each); left -= cur[i] - v; cur[i] = v; });
  }
  cur[k] = b.total - others.reduce((a, i) => a + cur[i], 0);
  c.mix = mixOf(c).slice();
  c.mix[j] = cur.map(b.share);
  return c;
}

/* Vuelve a dejarlos todos iguales */
export function evenDrawers(c, j) {
  c.mix = mixOf(c).slice();
  c.mix[j] = null;
  return c;
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
  /* los cajones interiores y las bandejas cuentan, pero no se tocan */
  k = Math.max(0, clamp(Math.round(k), 0, 40) - c.cells.reduce((a, x) => a + boxesIn(x), 0));
  const closed = c.cells.some(isDoor);
  c.cells = c.cells.map((x) => (drawersIn(x) ? (closed ? "door" : "open") : x));
  if (!k) return c;
  splitForDrawers(p, c, 0, Math.min(k, 3), cols);
  let left = k;
  for (let j = 0; j < c.cells.length && left > 0; j++) {
    if (isRail(c.cells[j]) || hasBox(c.cells[j])) continue;
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
  if (on) c.joins = Array.from({ length: Math.max(0, c.cells.length - 1) }, () => true);   // una puerta alta
  c.cells = c.cells.map((x) => (drawersIn(x) ? x
    : on ? (isRail(x) ? "rail+door" : x === "tray" ? "door+drawer" : isInner(x) ? x : "door")
    : x === "rail+door" ? "rail" : x === "door" ? "open" : isInner(x) ? "tray" : x));
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
  c.joins = Array.from({ length: c.cells.length - 1 }, () => true);
  return sync(c);
}

/* Altura de la barra de colgar (eje, desde el suelo interior del mueble).
   Por defecto, 60 mm bajo el techo del hueco. c.railAt la fija a mano: la barra
   va atornillada a los costados con soportes, así que puede ir a cualquier altura
   del hueco, dejando 60 mm arriba para el gancho y 540 mm debajo para colgar.
   c.railAt es una lista de alturas: cada una vale para la barra en cuyo recorrido
   cae, así dos barras en la misma columna (doble barra) llevan cada una la suya. */
export const RAIL_TOP = 60, RAIL_HANG = 540;
export function railRange(p, c, j) {
  const b = cellBounds(p, c), last = b.length - 2, t = p.thickness;
  const lo = b[j] + (j > 0 ? t / 2 : 0), hi = b[j + 1] - (j < last ? t / 2 : 0);
  return [Math.min(lo + RAIL_HANG, hi - RAIL_TOP), hi - RAIL_TOP];
}
const railList = (c) => (Array.isArray(c.railAt) ? c.railAt : Number.isFinite(c.railAt) ? [c.railAt] : []);
export function railPos(p, c, j) {
  const [a, z] = railRange(p, c, j);
  return railList(c).find((v) => v >= a && v <= z) ?? z;
}
export function setRailAt(p, c, j, y) {
  const [a, z] = railRange(p, c, j);
  c.railAt = [...railList(c).filter((v) => v < a || v > z), Math.round(clamp(y, a, z))];
  return c;
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
  if (!HANDLES.includes(p.handle)) p.handle = "bar";
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
    joins: Array.isArray(c && c.joins) ? c.joins.map(Boolean) : null,
    mix: Array.isArray(c && c.mix) ? c.mix.slice() : null,
    /* campos de siempre: si cambian, se traducen a huecos más abajo */
    drawers: c && c.drawers != null ? clamp(Math.round(Number(c.drawers) || 0), 0, 40) : null,
    door: c && c.door != null ? !!c.door : null,
    railAt: c ? (Array.isArray(c.railAt) ? c.railAt : [c.railAt]).filter((v) => typeof v === "number" && Number.isFinite(v)).map(Math.round) : [],
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
    /* lo que traía la columna ANTES de ajustar nada: los campos de siempre
       (cajones, puerta) solo reescriben la columna si alguien los ha cambiado,
       no porque aquí se haya reducido algo que no cabía */
    const given = cells ? colSummary({ cells }) : null;
    let joins = cells ? (c.joins && c.joins.length === cells.length - 1 ? c.joins.slice()
      : Array.from({ length: Math.max(0, cells.length - 1) }, () => true)) : null;
    let mix = cells ? (Array.isArray(c.mix) && c.mix.length === cells.length ? c.mix.slice()
      : cells.map(() => null)) : null;
    const kept = [];
    sorted.forEach((v) => {
      if (Hi < 380 || kept.length >= 8 || (kept.length && v - kept[kept.length - 1] < 140)) {
        if (cells && cells.length > kept.length + 1) {
          const a = cells[kept.length], b = cells[kept.length + 1];
          cells.splice(kept.length, 2, a === "open" ? b : a);
          joins.splice(kept.length, 1);
          mix.splice(kept.length, 2, null);
        }
        return;
      }
      kept.push(v);
    });
    c.shelves = kept;
    const n = kept.length + 1;
    cells = (cells || []).slice(0, n);
    joins = (joins || []).slice(0, n - 1);
    while (cells.length < n) cells.push(cells.length && isDoor(cells[cells.length - 1]) ? "door" : "open");
    while (joins.length < n - 1) joins.push(true);
    mix = (mix || []).slice(0, n);
    while (mix.length < n) mix.push(null);
    c.cells = cells;
    c.joins = joins;
    c.mix = mix;
    const ref = given || { drawers: -1, door: null };
    if (c.door != null && (given ? c.door !== given.door : c.door !== colSummary(c).door)) setColumnDoor(c, c.door);
    if (c.drawers != null && (given ? c.drawers !== ref.drawers : c.drawers !== colSummary(c).drawers)) setColumnDrawers(p, c, c.drawers, cols);
    /* lo que no cabe en su hueco se reduce: menos cajones, o sin barra */
    c.cells = c.cells.map((x, j) => fitType(x, cellClear(p, c, j)));
    if (c.joins.length !== c.cells.length - 1) c.joins = Array.from({ length: c.cells.length - 1 }, (_, k) => c.joins[k] ?? true);
    /* un reparto a mano solo vale mientras el bloque tenga esos mismos cajones */
    c.mix = c.cells.map((x, j) => cleanMix(mixOf(c)[j], drawerCount(x)));
    const after = colSummary(c);
    c.drawers = after.drawers;
    c.door = after.door;
    /* alturas de barra: solo las que caen en el recorrido de una barra que sigue ahí */
    const railAt = c.railAt.filter((v, k, all) => all.indexOf(v) === k && c.cells.some((x, j) => {
      if (!isRail(x)) return false;
      const [a, z] = railRange(p, c, j);
      return v >= a && v <= z;
    }));
    if (railAt.length) c.railAt = railAt; else delete c.railAt;
  });

  p.columns = cols;
  return p;
}

/* ------------------------------------------------------------
   Estirar el mueble por una esquina.
   Cambian el ancho y el alto, y lo de dentro se reparte igual que estaba:
   las columnas guardan su proporción (lo hace normalize) y las baldas y las
   barras se mueven con el alto interior, en vez de quedarse clavadas en sus
   milímetros y dejar un hueco enorme arriba.
   ------------------------------------------------------------ */
export function scaleTo(p, next) {
  const out = deepCopy(p);
  out.width = clamp(r10(Number(next.width) || p.width), 400, 3200);
  out.height = clamp(r10(Number(next.height) || p.height), 400, 2600);
  out.depth = clamp(r10(Number(next.depth) || p.depth), 180, 600);
  const before = innerH(p), after = out.height - out.baseHeight - 2 * out.thickness;
  const k = before > 0 ? after / before : 1;
  if (k !== 1) {
    out.columns.forEach((c) => {
      c.shelves = (c.shelves || []).map((v) => Math.round(v * k));
      if (Array.isArray(c.railAt)) c.railAt = c.railAt.map((v) => Math.round(v * k));
    });
  }
  return normalize(out);
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
  c.drawers = clamp(Math.round(k), 0, 40);
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

    const cells = c.cells || [];
    const jn0 = joinsOf(c);
    c.shelves.forEach((s, j) => {
      /* detrás de una puerta alta (embutida) la balda retrocede lo que mide la puerta */
      const back = isDoor(cells[j]) && isDoor(cells[j + 1]) && jn0[j] ? t + 2 : 0;
      add({ id: `balda_${i}_${j}`, label: P.shelf(i + 1), grp: "balda", col: i, shelf: j,
            L: c.width, Wd: shelfD - back, t, edges: 1, drag: "y",
            pos: [cx, y0 + s, (p.back ? BACK_T / 2 : 0) - back / 2], size: [c.width, t, shelfD - back] });
    });

    const bnd = [0, ...c.shelves, Hi], last = cells.length - 1;
    const cLo = (j) => bnd[j] + (j > 0 ? t / 2 : 0), cHi = (j) => bnd[j + 1] - (j < last ? t / 2 : 0);
    /* Frentes embutidos: puertas y cajones van DENTRO del hueco, enrasados con el
       canto del mueble y con 3 mm de junta alrededor. Visto de lado no sobresale
       nada: el mueble es una caja limpia (como Tylko o la carpintería a medida). */
    const zF = D / 2 - t / 2;
    const fW = c.width - 2 * GAP, fcx = cx, fx0 = x + GAP;
    for (let j = 0; j <= last; ) {
      const nd = drawersIn(cells[j]);
      if (nd) {
        /* los frentes cubren el hueco hasta el eje de las baldas; la caja va dentro */
        const lo = cLo(j) + GAP / 2, hi = cHi(j) - GAP / 2;
        /* cada cajón se lleva su parte del hueco: iguales salvo que se haya
           estirado uno a mano, y entonces los demás se reparten el resto */
        const qs = shareOf(c, j, nd);
        let fy = 0, sy = 0;
        for (let k = 0; k < nd; k++) {
          const key = `${i}_${j}_${k}`;
          const fh = (hi - lo) * qs[k], slot = (cHi(j) - cLo(j)) * qs[k];
          add({ id: `cajon_${key}`, label: P.drawerFront(i + 1), grp: "frente", col: i, cell: j, drawer: key,
                idx: k, of: nd, L: fW, Wd: fh - GAP, t, edges: 4,
                pos: [fcx, y0 + lo + fy + fh / 2, zF], size: [fW, fh - GAP, t] });
          /* caja: 12,5 mm de holgura por lado para las guías; el fondo entra en ranura.
             Empieza detrás del frente embutido. */
          const bw = c.width - 25, bd = D - 60 - t, zb = D / 2 - t - 3 - bd / 2;
          const sh = Math.max(50, slot - 40), eh = sh - 10, yb = y0 + cLo(j) + sy + 20;
          fy += fh; sy += slot;
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
        const jn = joinsOf(c);
        while (e < last && isDoor(cells[e + 1]) && jn[e]) e++;
        /* 3 mm de junta arriba y abajo, como los cajones */
        const lo = cLo(j) + GAP, hi = cHi(e) - GAP;
        const dh = hi - lo;
        if (dh > 90) {                   // el hueco más bajo posible (140 mm entre ejes) aún lleva puerta
          /* hojas de 600 mm, y dos como mucho: una tercera hoja en medio no tendría costado
             donde atornillar las bisagras */
          const leaves = clamp(Math.ceil(fW / 600), 1, 2);
          const leaf = (fW - (leaves - 1) * GAP) / leaves;
          for (let k = 0; k < leaves; k++) {
            const left = fx0 + k * (leaf + GAP);
            add({ id: `puerta_${i}_${j}_${k}`, label: P.door(i + 1), grp: "frente", col: i, cell: j, cells: [j, e],
                  hinge: leaves > 1 ? (k === 0 ? "L" : "R")
                    : p.columns.length > 1 && i >= p.columns.length / 2 ? "R" : "L",
                  L: leaf, Wd: dh, t, edges: 4, pos: [left + leaf / 2, y0 + (lo + hi) / 2, zF], size: [leaf, dh, t] });
          }
        }
        j = e + 1;
      } else j++;
    }
    /* cajón interior (detrás de la puerta, retranqueado para que la hoja cierre
       por delante) y bandeja extraíble (frente bajo, enrasado con el mueble) */
    cells.forEach((x2, j) => {
      const h = cHi(j) - cLo(j);
      if (!hasBox(x2) || h < BOX_MIN) return;
      const inner = isInner(x2);
      /* el bloque interior lleva los cajones que quepan, apilados desde abajo y
         llenando su compartimento: un cajón solo flotando no es un mueble */
      const n = inner ? Math.max(1, Math.min(boxesIn(x2), Math.floor(h / BOX_MIN))) : 1;
      /* el frente tapa el hueco de lado a lado, con la junta justa: 8 mm por
         lado, como un cajón de verdad. Antes se dejaban 30 y se veía el costado
         del mueble a los dos lados del cajón. */
      const fw = inner ? c.width - 16 : c.width - 4;
      const qs = inner ? shareOf(c, j, n) : [1];
      const avail = h - 20 - (n - 1) * GAP;
      const zf = inner ? D / 2 - 25 - t / 2 : D / 2 - t / 2 - 1;
      const fhOf = (k) => (inner ? avail * qs[k] : 90);
      /* la caja deja a cada lado lo que ocupa una guía de bolas (12,5 mm) y su holgura */
      const bw = c.width - 26, bd = inner ? D - 90 : D - t - 50;
      const zb = zf - t / 2 - 1 - bd / 2;
      let by = 0;
      for (let k = 0; k < n; k++) {
        const key = `${i}_${j}_b${k}`;
        const fh = fhOf(k), sh = inner ? Math.max(60, fh - 40) : 70, eh = sh - 10;
        const yb = y0 + cLo(j) + 10 + by;
        by += fh + GAP;
        add({ id: `${inner ? "cajoni" : "bandeja"}_${key}`, label: inner ? P.innerFront(i + 1) : P.trayFront(i + 1),
              grp: "frente", col: i, cell: j, drawer: key, idx: k, of: n, runner: true, inner, nohandle: inner,
              L: fw, Wd: fh, t, edges: inner ? 1 : 4, pos: [cx, yb + fh / 2, zf], size: [fw, fh, t] });
        [cx - bw / 2 + 6, cx + bw / 2 - 6].forEach((sx, s2) => add({
          id: `cjlat_${key}_${s2}`, label: P.drawerSide(i + 1), grp: "cajon", col: i, cell: j, drawer: key,
          L: bd, Wd: sh, t: 12, edges: 1, pos: [sx, yb + sh / 2, zb], size: [12, sh, bd] }));
        add({ id: `cjfondo_${key}`, label: P.drawerBottom(i + 1), grp: "cajon", col: i, cell: j, drawer: key,
              L: bw - 15, Wd: bd, t: 6, edges: 0, pos: [cx, yb + 3, zb], size: [bw - 24, 6, bd - 24] });
        [zb + bd / 2 - 6, zb - bd / 2 + 6].forEach((ez, e2) => add({
          id: `cjtest_${key}_${e2}`, label: P.drawerEnd(i + 1), grp: "cajon", col: i, cell: j, drawer: key,
          L: bw - 24, Wd: eh, t: 12, edges: 1, pos: [cx, yb + 6 + eh / 2, ez], size: [bw - 24, eh, 12] }));
      }
    });
    /* barra de colgar: herraje, no sale del tablero; a 60 mm de la balda de encima */
    cells.forEach((x2, j) => {
      if (!isRail(x2)) return;
      add({ id: `barra_${i}_${j}`, label: P.rail(i + 1), grp: "barra", hw: true, col: i, cell: j,
            L: c.width - 10, Wd: 25, t: 25, edges: 0,
            pos: [cx, y0 + railPos(p, c, j), p.back ? BACK_T / 2 : 0], size: [c.width - 10, 25, 25] });
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
/* el tirador elegido se conserva al cambiar de tipo de mueble */
for (const k of Object.keys(PRESETS)) {
  const make = PRESETS[k];
  PRESETS[k] = (cur) => ({ ...make(cur), handle: HANDLES.includes(cur.handle) ? cur.handle : "bar" });
}
export const PRESET_KEYS = Object.keys(PRESETS);

/* ------------------------------------------------------------
   Catálogo de piezas: lo que se arrastra sobre el mueble.
   canPlace() dice si cabe y por qué no; applyItem() lo coloca.
   Las dos pasan por las mismas reglas que normalize().
   ------------------------------------------------------------ */
export const CATALOG = {
  fronts: ["door", "drawer", "drawer2", "drawer3", "door+drawer", "tray", "open"],
  inside: ["shelf", "rail", "divider"],
  handles: HANDLES.map((h) => "h:" + h),
};

/* Cuántos cajones interiores quedan al soltar otro encima de un bloque (el
   catálogo apila, hasta tres); desde el panel se pone el número que se pulsa. */
const stackTo = (cur, item, set) =>
  set || !isInner(cur) ? boxesIn(item) : Math.min(3, boxesIn(cur) + boxesIn(item));

/* El bloque de cajones manda en su hueco: dice dónde tiene que quedar la balda
   de encima para que lo llene justo, sin aire ni apreturas. Sube si faltan
   centímetros, BAJA si sobran, y el palmo que sobra se lo queda el hueco de
   arriba. No toca nada: lo usan canPlace (para decir que no) y setCell (para
   hacerlo). at null = se deja la balda donde está. */
function fitBox(p, c, j, n, cols) {
  const b = cellBounds(p, c), t = p.thickness, last = c.cells.length - 1;
  /* alto de cada frente si la balda de encima se pusiera ahí */
  const front = (top) => ((top - (j < last ? t / 2 : 0) - b[j] - (j > 0 ? t / 2 : 0)) - 20 - (n - 1) * GAP) / n;
  const fits = (top) => front(top) >= BOX_MIN && front(top) <= BOX_MAX;
  /* si con la balda donde está los cajones ya salen de un alto normal, no se
     toca: mover una balda que no estorba rompe la línea de las otras columnas */
  if (fits(b[j + 1])) return { at: null };
  const need = n * BOX_H + 60;
  if (j >= c.shelves.length) return front(b[j + 1]) >= BOX_MIN ? { at: null } : { short: need };
  const keep = isRail(c.cells[j + 1]) ? 600 : 140;
  const room = (v) => v > b[j] + 120 && v + keep <= b[j + 2] && fits(v);
  /* y si hay que moverla, se busca primero la balda de una columna de al lado,
     para que las líneas del mueble sigan cuadrando */
  const near = (cols || p.columns).filter((o) => o !== c).flatMap((o) => o.shelves).filter(room)
    .sort((a, z) => Math.abs(a - b[j] - need) - Math.abs(z - b[j] - need))[0];
  const at = near ?? (room(b[j] + need) ? b[j] + need : null);
  return at == null ? { short: need } : { at: Math.round(at) };
}

/* set: el panel del hueco PONE lo que se pulsa (tres cajones -> uno, si eso se
   pulsa); el catálogo, en cambio, APILA lo que se suelta encima. */
export function canPlace(p, item, col, cell, set = false) {
  if (!item) return { ok: false, reason: "nowhere" };
  if (item.startsWith("h:")) return HANDLES.includes(item.slice(2)) ? { ok: true, whole: true } : { ok: false, reason: "nowhere" };
  const c = p.columns[col];
  if (!c) return { ok: false, reason: "nowhere" };
  if (item === "divider") {
    if (p.columns.length >= 8) return { ok: false, reason: "maxCols" };
    if ((c.width - p.thickness) / 2 < 150) return { ok: false, reason: "narrow", need: 2 * 150 + p.thickness };
    return { ok: true, column: true };
  }
  if (cell == null || cell < 0 || cell >= c.cells.length) return { ok: false, reason: "nowhere" };
  const h = cellClear(p, c, cell), nd = drawersIn(item);
  if ((nd || hasBox(item)) && c.width < 250) return { ok: false, reason: "narrowDrawer", need: 250 };
  if (nd && h < nd * MIN_FRONT) return { ok: false, reason: "short", need: nd * MIN_FRONT };
  if (isInner(item)) {
    const n = stackTo(c.cells[cell], item, set);
    if (!set && isInner(c.cells[cell]) && n === boxesIn(c.cells[cell])) return { ok: false, reason: "maxBox" };
    const fit = fitBox(p, c, cell, n, p.columns);
    return fit.short ? { ok: false, reason: "short", need: fit.short } : { ok: true };
  }
  if (hasBox(item) && h < boxesIn(item) * BOX_MIN) return { ok: false, reason: "short", need: boxesIn(item) * BOX_MIN };
  if (isRail(item) && h < 600) return { ok: false, reason: "short", need: 600 };
  if (item === "shelf") {
    const b = cellBounds(p, c);
    if (c.shelves.length >= 8 || innerH(p) < 380 || b[cell + 1] - b[cell] < 2 * 140) return { ok: false, reason: "short", need: 2 * 140 };
  }
  return { ok: true };
}

/* Divide un hueco en dos con una balda en medio. Lo que había se queda:
   la barra, arriba (cuelga del techo del hueco); lo demás, abajo. */
export function addShelfInCell(p, c, j) {
  const b = cellBounds(p, c), x = c.cells[j];
  const mid = Math.round((b[j] + b[j + 1]) / 2);
  const closed = isDoor(x);
  const lower = isRail(x) ? (closed ? "door" : "open") : x;
  const upper = isRail(x) ? x : closed ? "door" : "open";
  c.joins = joinsOf(c).slice();
  c.shelves.splice(j, 0, mid);
  c.mix = mixOf(c).slice();
  c.cells.splice(j, 1, lower, upper);
  c.mix.splice(j, 1, null, null);
  c.joins.splice(j, 0, closed);                 // detrás de una puerta, la balda no parte la puerta
  c.cells[j] = fitType(c.cells[j], cellClear(p, c, j));
  c.cells[j + 1] = fitType(c.cells[j + 1], cellClear(p, c, j + 1));
  return sync(c);
}

/* Divide una columna en dos iguales con un divisor */
export function splitColumn(p, i) {
  const c = p.columns[i], t = p.thickness;
  const w1 = Math.floor((c.width - t) / 2), w2 = c.width - t - w1;
  p.columns.splice(i, 1, { ...deepCopy(c), width: w1 }, { ...deepCopy(c), width: w2 });
  return p;
}

export function applyItem(p, item, col, cell, set = false) {
  const r = canPlace(p, item, col, cell, set);
  if (!r.ok) return r;
  if (item.startsWith("h:")) { p.handle = item.slice(2); return r; }
  if (item === "divider") { splitColumn(p, col); return r; }
  const c = p.columns[col];
  if (item === "shelf") { addShelfInCell(p, c, cell); return r; }
  const cur = c.cells[cell];
  const wasDoor = isDoor(cur);
  /* lo que se suelta encima de una puerta sigue detrás de la puerta */
  let type = item;
  if (item === "rail" && isDoor(cur)) type = "rail+door";
  if (item === "door" && isRail(cur)) type = "rail+door";
  if (item === "tray" && isDoor(cur)) type = "door+drawer";
  /* otro cajón interior donde ya hay un bloque: se apila, hasta tres */
  if (isInner(type)) type = boxType(stackTo(cur, type, set));
  setCell(p, c, cell, type, p.columns);
  /* una puerta nueva es la de ese hueco, no se pega a la de al lado */
  if (isDoor(type) && !wasDoor) setOwnDoor(c, cell);
  if (isRail(type) && p.depth < 500) { p.depth = 580; r.deeper = true; }
  return r;
}

/* Arrastrar lo que hay en un hueco a otro: el de origen queda abierto */
export function moveCell(p, from, to) {
  const fc = p.columns[from.col], src = fc && fc.cells[from.cell];
  if (!src || src === "open") return { ok: false, reason: "empty" };
  /* al mismo hueco, o a uno que ya tiene lo mismo (una puerta sobre la misma puerta alta): nada que mover.
     Antes el origen se quedaba vacío y parecía que la puerta desaparecía */
  if ((from.col === to.col && from.cell === to.cell) || p.columns[to.col]?.cells[to.cell] === src) return { ok: false, reason: "same" };
  const r = canPlace(p, src, to.col, to.cell, true);
  if (!r.ok) return r;
  fc.cells[from.cell] = "open";
  sync(fc);
  const tc = p.columns[to.col], wasDoor = isDoor(tc.cells[to.cell]);
  setCell(p, tc, to.cell, src, p.columns);
  if (isDoor(src) && !wasDoor) setOwnDoor(tc, to.cell);
  if (isRail(src) && p.depth < 500) { p.depth = 580; r.deeper = true; }
  return r;
}
