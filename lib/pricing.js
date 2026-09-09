/* ============================================================
   DESPIECE · ANIDADO EN TABLERO · PRESUPUESTO
   El precio no se estima: se deriva pieza a pieza de la misma
   geometría que se renderiza. Por eso el margen que ve el fundador
   es el margen real de ese diseño concreto.
   ============================================================ */
import { SHEET, MATERIALS } from "./model";

export const PRICE = {
  backM2: 6.0,
  cutML: 0.75,
  sheetSetup: 8.0,
  edgeML: 2.1,
  minifix: 0.65,
  pin: 0.25,
  hingePair: 4.5,
  runnerPair: 11.5,
  leg: 6.5,
  anchor: 5.0,
  packBase: 9.0,
  packSheet: 2.5,
  ship: 39.0,
  markup: 2.25,
  vat: 0.21,
};

/* Agrupa piezas idénticas: el taller corta por referencia, no por unidad. */
export function cutlist(geo) {
  const map = new Map();
  geo.parts.forEach((p) => {
    const L = Math.round(p.L), W = Math.round(p.Wd);
    const key = `${p.label}|${L}|${W}|${p.t}|${p.edges}`;
    const q = p.qty || 1;
    if (map.has(key)) map.get(key).qty += q;
    else map.set(key, { label: p.label, L, W, t: p.t, edges: p.edges, qty: q });
  });
  return [...map.values()].sort((a, b) => b.L * b.W * b.qty - a.L * a.W * a.qty);
}

/* Anidado por bandas (first-fit decreasing sobre la altura de cada pieza).
   No es óptimo global, pero es lo que hace una seccionadora real y el
   aprovechamiento que devuelve es honesto. */
export function nest(rows) {
  const items = [];
  rows.filter((r) => r.t > 6).forEach((r) => {
    for (let i = 0; i < r.qty; i++) {
      let L = r.L, W = r.W;
      if (W > L) { const s = L; L = W; W = s; }
      items.push({ L, W, label: r.label });
    }
  });
  items.sort((a, b) => b.W - a.W);

  const usableL = SHEET.L - 2 * SHEET.margin;
  const usableW = SHEET.W - 2 * SHEET.margin;
  const sheets = [];

  items.forEach((it) => {
    if (it.L > usableL || it.W > usableW) return;
    let placed = false;
    for (const sh of sheets) {
      for (const band of sh.bands) {
        if (it.W <= band.h && band.x + it.L + SHEET.kerf <= usableL) {
          band.items.push({ ...it, x: band.x, y: band.y });
          band.x += it.L + SHEET.kerf;
          placed = true;
          break;
        }
      }
      if (placed) break;
      if (sh.y + it.W + SHEET.kerf <= usableW) {
        sh.bands.push({ y: sh.y, h: it.W, x: SHEET.margin + it.L + SHEET.kerf,
                        items: [{ ...it, x: SHEET.margin, y: sh.y }] });
        sh.y += it.W + SHEET.kerf;
        placed = true;
        break;
      }
    }
    if (!placed) {
      const sh = { y: SHEET.margin, bands: [] };
      sh.bands.push({ y: SHEET.margin, h: it.W, x: SHEET.margin + it.L + SHEET.kerf,
                      items: [{ ...it, x: SHEET.margin, y: SHEET.margin }] });
      sh.y = SHEET.margin + it.W + SHEET.kerf;
      sheets.push(sh);
    }
  });

  const yieldPct = sheets.map((sh) =>
    sh.bands.reduce((a, b) => a + b.items.reduce((s, i) => s + i.L * i.W, 0), 0) /
    (SHEET.L * SHEET.W));

  return { sheets, yield: yieldPct };
}

export function quote(p, geo, nested) {
  const M = MATERIALS[p.material];
  const t = p.thickness;
  let panelM2 = 0, backM2 = 0, edgeML = 0, cutML = 0;
  let minifix = 0, pins = 0, hinges = 0, runners = 0;

  geo.parts.forEach((x) => {
    const q = x.qty || 1;
    const area = (x.L * x.Wd) / 1e6 * q;
    if (x.t <= 6 || x.grp === "trasera") backM2 += area;
    else panelM2 += area;
    edgeML += ((x.edges === 4 ? 2 * (x.L + x.Wd) : x.edges === 1 ? x.L : 0) / 1000) * q;
    cutML += ((2 * (x.L + x.Wd)) / 1000) * q;
    if (x.grp === "balda") pins += 4;
    if (x.grp === "carcasa" || x.grp === "divisor") minifix += 4;
    if (x.id && x.id.startsWith("puerta")) hinges += 1;
    if (x.id && x.id.startsWith("cajon_")) runners += 1;
  });

  const nSheets = Math.max(1, nested.sheets.length);
  const c = {
    "Tablero": panelM2 * M.cost[t],
    "Trasera y fondos": backM2 * PRICE.backM2,
    "Corte CNC": cutML * PRICE.cutML + nSheets * PRICE.sheetSetup,
    "Canteado ABS": edgeML * PRICE.edgeML,
    "Herrajes":
      minifix * PRICE.minifix + pins * PRICE.pin + hinges * PRICE.hingePair +
      runners * PRICE.runnerPair + (p.base === "patas" ? 4 * PRICE.leg : 0) +
      (p.height > 1200 ? PRICE.anchor : 0),
    "Embalaje": PRICE.packBase + nSheets * PRICE.packSheet,
  };

  const cost = Object.values(c).reduce((a, b) => a + b, 0);
  const net = cost * PRICE.markup + PRICE.ship;
  const gross = net * (1 + PRICE.vat);
  const weight = geo.parts.reduce(
    (a, x) => a + ((x.L * x.Wd * x.t) / 1e9) * (x.t <= 6 ? 750 : M.rho) * (x.qty || 1), 0);

  return {
    c, cost, net, gross,
    margin: (net - PRICE.ship - cost) / (net - PRICE.ship),
    weight, panelM2, edgeML, cutML, nSheets,
    hw: { minifix, pins, hinges, runners },
  };
}

export const mm = (v) => Math.round(v).toLocaleString("es-ES");
export const eur = (v) =>
  v.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
export const eur2 = (v) =>
  v.toLocaleString("es-ES", { style: "currency", currency: "EUR",
                              minimumFractionDigits: 2, maximumFractionDigits: 2 });
