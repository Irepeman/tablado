/* ============================================================
   Revisión general: no prueba una pieza, prueba el mueble entero.
   Monta muchos muebles —los seis tipos a tamaños extremos, cada tipo
   de hueco en todas partes, repartos de cajón a mano, materiales,
   bases y tiradores— y de cada uno comprueba que:
     · ninguna pieza sale con NaN, con medida cero ni fuera del mueble;
     · los frentes de un hueco no se pisan ni se salen de él;
     · el despiece, el anidado y el presupuesto dan números de verdad;
     · normalize() aplicado dos veces da exactamente lo mismo;
     · encoger y estirar a lo bestia no añade ni quita columnas.
   node tests/audit.mjs
   ============================================================ */
import * as M from "../lib/model.js";
import { cutlist, nest, quote } from "../lib/pricing.js";

let n = 0; const bad = new Map();
const fail = (k, m) => { if (!bad.has(k)) bad.set(k, []); if (bad.get(k).length < 4) bad.get(k).push(m); };
const fin = (v) => Number.isFinite(v);

function audit(p, tag) {
  n++;
  for (const lang of ["es", "en"]) {
    const g = M.build(p, lang);
    const Hi = p.height - p.baseHeight - 2 * p.thickness;
    for (const x of g.parts) {
      if (!x.pos || !x.size) { fail("geometría", `${tag}: ${x.id} sin pos/size`); continue; }
      if (!x.pos.every(fin) || !x.size.every(fin)) { fail("geometría", `${tag}: ${x.id} con NaN`); continue; }
      if (x.size.some((v) => v <= 0)) fail("geometría", `${tag}: ${x.id} mide ${x.size.map(Math.round).join("×")}`);
      if (!x.hw) {
        if (!fin(x.L) || !fin(x.Wd) || x.L <= 0 || x.Wd <= 0) fail("despiece", `${tag}: ${x.id} L=${x.L} Wd=${x.Wd}`);
        if (!x.label) fail("despiece", `${tag}: ${x.id} sin nombre`);
      }
      const top = x.pos[1] + x.size[1] / 2, bot = x.pos[1] - x.size[1] / 2;
      if (bot < -1 || top > p.height + 1) fail("geometría", `${tag}: ${x.id} se sale del mueble (${Math.round(bot)}..${Math.round(top)} de ${p.height})`);
      if (Math.abs(x.pos[0]) > p.width / 2 + 120) fail("geometría", `${tag}: ${x.id} se sale de ancho`);
    }
    /* frentes de un mismo hueco: ni se pisan ni se salen */
    const byCell = new Map();
    g.parts.filter((x) => x.grp === "frente" && x.idx != null).forEach((x) => {
      const k = `${x.col}_${x.cell}`; if (!byCell.has(k)) byCell.set(k, []); byCell.get(k).push(x);
    });
    for (const [k, xs] of byCell) {
      xs.sort((a, b) => a.pos[1] - b.pos[1]);
      for (let i = 1; i < xs.length; i++) {
        if (xs[i].pos[1] - xs[i].size[1] / 2 < xs[i - 1].pos[1] + xs[i - 1].size[1] / 2 - 0.5) fail("frentes", `${tag}: ${k} dos frentes se pisan`);
      }
      const col = p.columns[xs[0].col], b = M.cellBounds(p, col);
      const y0 = p.baseHeight + p.thickness;
      const lo = xs[0].pos[1] - xs[0].size[1] / 2 - y0, hi = xs[xs.length - 1].pos[1] + xs[xs.length - 1].size[1] / 2 - y0;
      if (lo < b[xs[0].cell] - 1 || hi > b[xs[0].cell + 1] + 1) fail("frentes", `${tag}: ${k} el bloque se sale de su hueco`);
    }
    if (lang === "es") {
      const rows = cutlist(g), nested = nest(rows), q = quote(p, g, nested);
      if (!rows.length) fail("despiece", `${tag}: despiece vacío`);
      if (!fin(q.gross) || q.gross <= 0) fail("precio", `${tag}: total ${q.gross}`);
      if (!fin(q.weight) || q.weight <= 0) fail("precio", `${tag}: peso ${q.weight}`);
      if (!Array.isArray(nested.sheets) || nested.sheets.length < 1) fail("despiece", `${tag}: ${nested.sheets} tableros`);
      [].concat(nested.yield).forEach((y) => { if (!fin(y) || y <= 0 || y > 1) fail("despiece", `${tag}: aprovechamiento ${y}`); });
      rows.forEach((r) => { if (!fin(r.L) || !fin(r.W) || r.L <= 0 || r.W <= 0) fail("despiece", `${tag}: fila ${r.label} ${r.L}×${r.W}`); });
      M.validate(p, g, "es").forEach((f) => { if (!f.d || !f.t) fail("avisos", `${tag}: aviso incompleto`); });
    }
  }
  if (JSON.stringify(M.normalize(M.deepCopy(p))) !== JSON.stringify(p)) fail("normalize", `${tag}: normalize no es estable`);
}

/* 1 · los seis muebles, a muchos tamaños */
for (const k of M.PRESET_KEYS) {
  for (const [w, h, d] of [[400,400,180],[900,700,250],[1800,2000,400],[3200,2600,600],[2400,1200,320]]) {
    audit(M.scaleTo(M.PRESETS[k](M.normalize({})), { width: w, height: h, depth: d }), `${k} ${w}×${h}×${d}`);
  }
}
/* 2 · todos los tipos de hueco en todas las filas y columnas */
for (const t of M.CELL_TYPES) {
  for (const [w, h] of [[2400, 2000], [900, 900], [1200, 2600]]) {
    let p = M.scaleTo(M.PRESETS.estanteria(M.normalize({})), { width: w, height: h, depth: 600 });
    p.columns.forEach((c, i) => c.cells.forEach((_, j) => { if (M.canPlace(p, t, i, j, true).ok) M.applyItem(p, t, i, j, true); }));
    audit(M.normalize(p), `${t} en todo ${w}×${h}`);
  }
}
/* 3 · repartos de cajón a mano, en los extremos */
for (const t of ["drawer2", "drawer3", "door+drawer2", "door+drawer3"]) {
  let p = M.scaleTo(M.PRESETS.estanteria(M.normalize({})), { width: 2400, height: 2000, depth: 600 });
  if (!M.canPlace(p, t, 0, 0, true).ok) continue;
  M.applyItem(p, t, 0, 0, true); p = M.normalize(p);
  const j = p.columns[0].cells.findIndex((x) => M.drawerCount(x) > 1);
  if (j < 0) continue;
  for (const mm of [0, 1, 110, 200, 9999]) {
    for (let k = 0; k < M.drawerBand(p, p.columns[0], j).n; k++) {
      const q = M.deepCopy(p);
      M.setDrawerH(q, q.columns[0], j, k, mm);
      audit(M.normalize(q), `${t} cajón ${k} a ${mm}`);
    }
  }
  /* y que aguante encoger y estirar con el reparto puesto */
  const q = M.deepCopy(p); M.setDrawerH(q, q.columns[0], j, 0, 250);
  audit(M.scaleTo(M.normalize(q), { width: 700, height: 800 }), `${t} reparto + encogido`);
  audit(M.scaleTo(M.scaleTo(M.normalize(q), { width: 700, height: 800 }), { width: 2400, height: 2000 }), `${t} reparto + ida y vuelta`);
}
/* 4 · encoger y estirar a lo bestia, todos los muebles, varias veces */
for (const k of M.PRESET_KEYS) {
  let p = M.PRESETS[k](M.normalize({}));
  const was = [p.columns.length, p.columns.map((c) => c.shelves.length).join("")];
  for (let i = 0; i < 6; i++) {
    p = M.scaleTo(p, { width: 1, height: 1 });
    p = M.scaleTo(p, { width: 9999, height: 9999 });
  }
  const now = [p.columns.length, p.columns.map((c) => c.shelves.length).join("")];
  if (JSON.stringify(was) !== JSON.stringify(now)) fail("tamaño", `${k}: seis idas y vueltas cambian el mueble ${JSON.stringify(was)} → ${JSON.stringify(now)}`);
  audit(p, `${k} tras seis idas y vueltas`);
}
/* 5 · materiales, espesores, bases, tiradores */
for (const mat of M.MATKEYS) for (const th of M.THICKNESSES) for (const base of ["patas", "zocalo", "flotante"]) {
  audit(M.normalize({ ...M.PRESETS.libreria(M.normalize({})), material: mat, thickness: th, base }), `${mat} ${th} ${base}`);
}
for (const hd of M.HANDLES) audit(M.normalize({ ...M.PRESETS.comoda(M.normalize({})), handle: hd }), `tirador ${hd}`);

const total = [...bad.values()].reduce((a, v) => a + v.length, 0);
console.log(`\nrevisión: ${n} muebles · ${total} fallos\n`);
for (const [k, v] of bad) {
  console.log(`✗ ${k} (${v.length})`);
  v.forEach((m) => console.log("    " + m));
}
process.exit(total ? 1 : 0);
