/* ============================================================
   FERRETERÍA
   La lista de tornillos y herrajes no se revisa a ojo: se prueba
   contra lo que un taller da por hecho antes de abrir la caja.

   Lo que vigila:
     · toda puerta lleva bisagras, y una hoja alta lleva más de dos;
     · todo cajón lleva su par de guías, y la guía CABE en el fondo
       de su caja y es una medida que se vende (250–550, de 50 en 50);
     · toda balda lleva sus cuatro soportes;
     · un mueble alto, o colgado, nunca sale sin anclaje a pared:
       esto no es una preferencia, es que se vuelca;
     · no hay líneas de cero unidades ni cantidades a medias;
     · el coste de herrajes del presupuesto es la suma de esta lista,
       no un número aparte;
     · la lista sigue al mueble: quitar una balda quita sus soportes.

   node tests/hardware.mjs
   node tests/hardware.mjs --sheet   → la lista en CSV, como se manda al taller
   ============================================================ */
import * as M from "../lib/model.js";
import { hardware, byGroup, runnerFor, hingesFor, camsFor } from "../lib/hardware.js";
import { cutlist, nest, quote } from "../lib/pricing.js";

let n = 0; const bad = new Map();
const fail = (k, m) => { if (!bad.has(k)) bad.set(k, []); if (bad.get(k).length < 4) bad.get(k).push(m); };
const near = (a, b) => Math.abs(a - b) < 0.02;

function checkPiece(p, tag) {
  n++;
  const g = M.build(p);
  const hw = hardware(p, g);

  /* ---------- nada vacío, nada a medias ---------- */
  hw.lines.forEach((l) => {
    if (!(l.qty > 0)) fail("líneas", `${tag}: «${l.name}» con ${l.qty}`);
    if (!l.name || !l.note) fail("líneas", `${tag}: una línea sin nombre o sin para qué sirve`);
    if (!Number.isFinite(l.total) || l.total < 0) fail("líneas", `${tag}: «${l.name}» cuesta ${l.total}`);
    /* lo que se compra por unidades se compra entero: nadie vende medio tornillo */
    if ((l.unit === "ud" || l.unit === "par" || l.unit === "bote") && !Number.isInteger(l.qty))
      fail("líneas", `${tag}: «${l.name}» ${l.qty} ${l.unit}`);
  });

  /* ---------- puertas ---------- */
  const doors = g.parts.filter((x) => x.id.startsWith("puerta"));
  const hinges = hw.counts.hinges;
  if (doors.length && hinges < doors.length * 2) fail("puertas", `${tag}: ${doors.length} hojas con ${hinges} bisagras`);
  doors.forEach((d) => { if (hingesFor(d.Wd) < 2) fail("puertas", `${tag}: hoja de ${Math.round(d.Wd)} mm con menos de dos bisagras`); });
  if (!doors.length && hinges) fail("puertas", `${tag}: ${hinges} bisagras sin ninguna puerta`);

  /* ---------- cajones: la guía tiene que caber ---------- */
  const fronts = g.parts.filter((x) => x.grp === "frente" && x.drawer);
  const pairs = hw.lines.filter((l) => l.key.startsWith("runner")).reduce((a, l) => a + l.qty, 0);
  if (pairs + hw.counts.noRunner !== fronts.length)
    fail("cajones", `${tag}: ${fronts.length} cajones y ${pairs} pares de guías`);
  let shallow = 0, impossible = 0;
  fronts.forEach((f) => {
    const side = g.parts.find((x) => x.grp === "cajon" && x.drawer === f.drawer && x.id.startsWith("cjlat_"));
    if (!side) return fail("cajones", `${tag}: el cajón ${f.drawer} no tiene caja`);
    const r = runnerFor(side.L);
    if (r.mm > side.L + 0.5) fail("cajones", `${tag}: guía de ${r.mm} mm en una caja de ${Math.round(side.L)} mm`);
    if (r.kind === "ball" && (r.mm % 50 || r.mm < 250 || r.mm > 550)) fail("cajones", `${tag}: guía de ${r.mm} mm, que no se vende`);
    if (r.kind === "roller") shallow++;
    if (!r.kind) impossible++;
  });
  /* un cajón que no admite guía no se puede callar: tiene que salir en la
     verificación de fabricación, que es lo que el cliente lee */
  if (shallow || impossible) {
    const V = M.validate(p, g, "es");
    if (!V.some((x) => x.lvl === "warn" && /guía|cajones/i.test(x.t)))
      fail("avisos", `${tag}: ${shallow + impossible} cajones sin guía de bolas y ningún aviso`);
  }

  /* ---------- baldas ---------- */
  const shelves = g.parts.filter((x) => x.grp === "balda").length;
  if (hw.counts.pins !== shelves * 4) fail("baldas", `${tag}: ${shelves} baldas y ${hw.counts.pins} soportes`);

  /* ---------- carcasa ---------- */
  const divs = g.parts.filter((x) => x.grp === "divisor").length;
  if (hw.counts.joints !== 2 * (2 + divs)) fail("carcasa", `${tag}: ${divs} divisores y ${hw.counts.joints} juntas`);
  if (hw.counts.cams !== hw.counts.joints * camsFor(p.depth)) fail("carcasa", `${tag}: excéntricas por junta mal contadas`);
  if (hw.counts.cams < hw.counts.joints * 2) fail("carcasa", `${tag}: menos de dos excéntricas en alguna junta`);

  /* ---------- seguridad: un mueble alto sin anclar se vuelca ---------- */
  const anchored = hw.lines.some((l) => l.key === "bracket" || l.key === "hanger");
  if ((p.height > 1200 || p.base === "flotante") && !anchored)
    fail("anclaje", `${tag}: ${Math.round(p.height)} mm de alto, base ${p.base}, y ninguna fijación a pared`);
  if (p.base === "flotante" && !hw.lines.some((l) => l.key === "hanger"))
    fail("anclaje", `${tag}: mueble flotante sin colgadores`);

  /* ---------- el precio sale de esta lista, no de otro sitio ---------- */
  const q = quote(p, g, nest(cutlist(g)));
  if (!near(q.c.hardware, hw.cost)) fail("precio", `${tag}: herrajes ${q.c.hardware.toFixed(2)} € y lista ${hw.cost.toFixed(2)} €`);
  if (!near(q.c.edge, hw.consumCost)) fail("precio", `${tag}: canteado ${q.c.edge.toFixed(2)} € y consumibles ${hw.consumCost.toFixed(2)} €`);

  /* ---------- las dos lenguas dicen lo mismo en número ---------- */
  const en = hardware(p, M.build(p, "en"), "en");
  if (en.lines.length !== hw.lines.length || !near(en.cost, hw.cost))
    fail("idiomas", `${tag}: la lista en inglés no cuadra con la española`);
  en.lines.forEach((l) => { if (/[áéíóúñ¿¡]/i.test(l.name)) fail("idiomas", `${tag}: «${l.name}» sin traducir`); });
}

/* 1 · los muebles de catálogo, a tamaños extremos */
for (const k of M.PRESET_KEYS) {
  for (const [w, h, d] of [[400, 400, 180], [900, 700, 250], [1800, 2000, 400], [3200, 2600, 600], [2400, 1200, 320]]) {
    checkPiece(M.scaleTo(M.PRESETS[k](M.normalize({})), { width: w, height: h, depth: d }), `${k} ${w}×${h}×${d}`);
  }
}
/* 2 · cada tipo de hueco, en todas partes */
for (const t of M.CELL_TYPES) {
  let p = M.scaleTo(M.PRESETS.estanteria(M.normalize({})), { width: 2400, height: 2400, depth: 600 });
  p.columns.forEach((c, i) => c.cells.forEach((_, j) => { if (M.canPlace(p, t, i, j, true).ok) M.applyItem(p, t, i, j, true); }));
  checkPiece(M.normalize(p), `${t} en todo el mueble`);
}
/* 3 · bases, tiradores, materiales y espesores */
for (const base of M.BASES) for (const hd of M.HANDLES) {
  checkPiece(M.normalize({ ...M.PRESETS.comoda(M.normalize({})), base, handle: hd }), `base ${base} · tirador ${hd}`);
}
for (const mat of M.MATKEYS) for (const th of M.THICKNESSES) {
  checkPiece(M.normalize({ ...M.PRESETS.armario(M.normalize({})), material: mat, thickness: th }), `${mat} ${th} mm`);
}

/* 4 · la lista sigue al mueble: quitar una balda quita cuatro soportes */
{
  const p = M.normalize(M.PRESETS.estanteria(M.normalize({})));
  const before = hardware(p, M.build(p)).counts.pins;
  const q = M.deepCopy(p);
  M.setShelfCount(q, q.columns[0], Math.max(0, q.columns[0].shelves.length - 1));
  const after = hardware(M.normalize(q), M.build(M.normalize(q))).counts.pins;
  if (after !== before - 4) fail("sigue al mueble", `quitar una balda: ${before} → ${after} soportes`);
  n++;
}
/* 5 · un fondo más corto obliga a una guía más corta */
{
  const base = M.PRESETS.comoda(M.normalize({}));
  const hondo = M.normalize(M.scaleTo(base, { depth: 600 }));
  const corto = M.normalize(M.scaleTo(base, { depth: 300 }));
  const len = (p) => hardware(p, M.build(p)).lines.filter((l) => l.key.startsWith("runner")).map((l) => l.key);
  if (JSON.stringify(len(hondo)) === JSON.stringify(len(corto)))
    fail("sigue al mueble", `600 mm y 300 mm de fondo piden la misma guía: ${len(hondo)}`);
  n++;
}

/* ---------- la lista para el taller ---------- */
if (process.argv.includes("--sheet")) {
  const p = M.normalize(M.PRESETS.armario(M.normalize({})));
  const hw = hardware(p, M.build(p));
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = byGroup(hw).flatMap((s) => s.lines.map((l) => [s.title, l.name, l.qty, l.unit, l.note]));
  console.log("﻿" + [["Grupo", "Herraje", "Cantidad", "Unidad", "Dónde va"].map(cell).join(";"),
    ...rows.map((r) => r.map(cell).join(";"))].join("\n"));
  process.exit(0);
}

const total = [...bad.values()].reduce((a, v) => a + v.length, 0);
console.log(`\nferretería: ${n} muebles · ${total} fallos\n`);
for (const [k, v] of bad) {
  console.log(`✗ ${k} (${v.length})`);
  v.forEach((m) => console.log("    " + m));
}
process.exit(total ? 1 : 0);
