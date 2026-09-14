/* ============================================================
   Banco de pruebas del motor de Cutwise.
   node tests/qa.mjs      → informe de fallos agrupado; código 1 si hay fallos
   ============================================================ */
import { writeFileSync } from "node:fs";
import {
  DEFAULT, normalize, build, validate, SHEET, DRAWER_H, MATKEYS, BASES, deepCopy,
} from "../lib/model.js";
import { cutlist, nest, quote } from "../lib/pricing.js";
import { parseIntent } from "../lib/intent.js";

const fails = new Map();
let checks = 0;
function check(ok, group, msg) {
  checks++;
  if (!ok) { if (!fails.has(group)) fails.set(group, []); fails.get(group).push(msg); }
}

/* ---------- aleatorio con semilla: resultados reproducibles ---------- */
let seed = 20260914;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
function randomDesign() {
  const n = 1 + Math.floor(rnd() * 6);
  return {
    width: 600 + rnd() * 2600, height: 600 + rnd() * 2000, depth: 180 + rnd() * 420,
    thickness: pick([16, 18, 22]), material: pick(MATKEYS), base: pick(BASES), back: rnd() < 0.7,
    columns: Array.from({ length: n }, () => ({
      width: 100 + rnd() * 900,
      shelves: Array.from({ length: Math.floor(rnd() * 6) }, () => rnd() * 2400),
      drawers: Math.floor(rnd() * 5), door: rnd() < 0.35,
    })),
  };
}

/* ---------- invariantes de un diseño ---------- */
const boxOf = (x) => ({ id: x.id, grp: x.grp,
  min: x.pos.map((c, i) => c - x.size[i] / 2), max: x.pos.map((c, i) => c + x.size[i] / 2) });
function overlap(a, b) {
  for (let i = 0; i < 3; i++) {
    if (Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]) <= 0.5) return false;
  }
  return true;
}

function invariants(p, tag) {
  const t = p.thickness, Hi = p.height - p.baseHeight - 2 * t;
  const sum = p.columns.reduce((a, c) => a + c.width, 0) + (p.columns.length + 1) * t;
  check(Math.abs(sum - p.width) <= 1, "anchos de columna", `${tag}: suman ${Math.round(sum)} y el ancho es ${p.width}`);
  p.columns.forEach((c, i) => {
    check(c.width >= 150, "anchos de columna", `${tag}: columna ${i + 1} mide ${c.width} mm`);
    check(c.drawers * DRAWER_H <= Hi + 0.5, "cajones que no caben",
      `${tag}: ${c.drawers} cajones (${c.drawers * DRAWER_H} mm) en un hueco de ${Hi} mm`);
    const floor = c.drawers * DRAWER_H + (c.drawers ? 40 : 0);
    c.shelves.forEach((s, j) => {
      check(s >= floor + 119 && s <= Hi - 119, "baldas fuera de sitio",
        `${tag}: balda a ${s} mm en col ${i + 1} (zona válida ${floor + 120}–${Hi - 120}, ${c.drawers} cajones)`);
      if (j) check(s - c.shelves[j - 1] >= 139, "baldas fuera de sitio", `${tag}: dos baldas a ${c.shelves[j - 1]} y ${s} mm`);
    });
  });

  const geo = build(p);
  const vis = geo.parts.filter((x) => !x.hide && x.pos);
  const W = p.width, H = p.height, D = p.depth;
  for (const x of vis) {
    const b = boxOf(x);
    const inside = b.min[0] >= -W / 2 - 0.5 && b.max[0] <= W / 2 + 0.5 &&
                   b.min[1] >= -0.5 && b.max[1] <= H + 0.5 &&
                   b.min[2] >= -D / 2 - 0.5 && b.max[2] <= D / 2 + t + 2.5;
    check(inside, "piezas fuera del mueble", `${tag}: ${x.label} (${x.id}) se sale del volumen`);
  }
  const bx = vis.map(boxOf);
  for (let i = 0; i < bx.length; i++) for (let j = i + 1; j < bx.length; j++) {
    if (overlap(bx[i], bx[j])) check(false, "piezas que se solapan", `${tag}: ${bx[i].grp} (${bx[i].id}) × ${bx[j].grp} (${bx[j].id})`);
  }
  for (const x of geo.parts) {
    const L = Math.max(x.L, x.Wd), Wd = Math.min(x.L, x.Wd);
    check(L <= SHEET.L - 2 * SHEET.margin && Wd <= SHEET.W - 2 * SHEET.margin, "piezas que no caben en el tablero",
      `${tag}: ${x.label} ${Math.round(x.L)}×${Math.round(x.Wd)}`);
  }
  for (const x of vis.filter((v) => v.grp === "frente" && v.id.startsWith("puerta"))) {
    check(x.L <= 600 + 0.5, "puertas demasiado anchas", `${tag}: ${x.label} de ${Math.round(x.L)} mm de ancho`);
  }

  const rows = cutlist(geo), nested = nest(rows);
  const eligible = rows.filter((r) => r.t > 6).reduce((a, r) => a + r.qty, 0);
  const placed = nested.sheets.reduce((a, sh) => a + sh.bands.reduce((b, bd) => b + bd.items.length, 0), 0);
  check(placed === eligible, "plan de corte incompleto", `${tag}: ${eligible} piezas, ${placed} colocadas`);
  for (const sh of nested.sheets) {
    const items = sh.bands.flatMap((b) => b.items);
    for (const it of items) {
      check(it.x >= SHEET.margin - 0.5 && it.x + it.L <= SHEET.L - SHEET.margin + 0.5 &&
            it.y >= SHEET.margin - 0.5 && it.y + it.W <= SHEET.W - SHEET.margin + 0.5,
            "plan de corte incompleto", `${tag}: pieza fuera del tablero en el anidado`);
    }
    for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
      const A = items[a], B = items[b];
      const ov = Math.min(A.x + A.L, B.x + B.L) - Math.max(A.x, B.x) > 0.5 && Math.min(A.y + A.W, B.y + B.W) - Math.max(A.y, B.y) > 0.5;
      check(!ov, "plan de corte incompleto", `${tag}: dos piezas se pisan en el tablero`);
    }
  }
  const q = quote(p, geo, nested);
  check(Number.isFinite(q.gross) && q.gross > q.net && q.net > q.cost && q.cost > 0, "presupuesto", `${tag}: importes incoherentes`);
  check(q.margin > 0.4 && q.margin < 0.7, "presupuesto", `${tag}: margen ${(q.margin * 100).toFixed(1)} %`);
  const drawers = p.columns.reduce((a, c) => a + c.drawers, 0);
  check(q.hw.runners === drawers, "presupuesto", `${tag}: ${drawers} cajones pero ${q.hw.runners} pares de guías`);
  const boxPieces = rows.filter((r) => /cajón/.test(r.label) && !/Frente/.test(r.label)).reduce((a, r) => a + r.qty, 0);
  check(boxPieces === drawers * 5, "despiece de cajones", `${tag}: ${drawers} cajones → ${boxPieces} piezas de caja (deben ser 5 por cajón)`);
  const doors = vis.filter((v) => v.id.startsWith("puerta"));
  const needHinges = doors.reduce((a, d) => a + (d.Wd <= 900 ? 2 : d.Wd <= 1600 ? 3 : d.Wd <= 2000 ? 4 : 5), 0);
  check(q.hw.hinges === needHinges, "presupuesto", `${tag}: ${doors.length} puertas necesitan ${needHinges} bisagras, se cobran ${q.hw.hinges}`);
  let v; try { v = validate(p, geo); } catch (e) { v = null; }
  check(Array.isArray(v), "validación", `${tag}: validate() lanza una excepción`);
}

/* ---------- 1. Fuzzing: 600 diseños aleatorios + casos límite ---------- */
for (let k = 0; k < 600; k++) invariants(normalize(randomDesign()), `aleatorio #${k}`);
const edge = {
  "bajo con 4 cajones": { height: 600, columns: [{ width: 500, shelves: [200], drawers: 4, door: false }] },
  "ancho máximo 3200": { width: 3200, columns: [{ width: 1000, shelves: [], drawers: 0, door: false }, { width: 1000, shelves: [], drawers: 0, door: false }] },
  "ancho máximo, 1 columna": { width: 3200, columns: [{ width: 3000, shelves: [500], drawers: 0, door: false }] },
  "columna ancha con puerta": { width: 1600, columns: [{ width: 1500, shelves: [], drawers: 0, door: true }] },
  "cajones + puerta": { columns: [{ width: 560, shelves: [900], drawers: 2, door: true }] },
  "alto máximo con puerta": { height: 2600, base: "flotante", columns: [{ width: 500, shelves: [], drawers: 0, door: true }] },
  "8 columnas estrechas": { width: 1400, columns: Array.from({ length: 8 }, () => ({ width: 100, shelves: [300], drawers: 1, door: false })) },
};
for (const [name, d] of Object.entries(edge)) invariants(normalize(d), `límite: ${name}`);

/* ---------- 2. El chat: frases reales y su resultado esperado ---------- */
const base = () => normalize(DEFAULT());
const T = [
  ["ponle dos cajones abajo a la izquierda", null, (a) => a.columns[0].drawers === 2 && a.columns.slice(1).every((c) => c.drawers === 0)],
  ["tres cajones en la columna 2", null, (a) => a.columns[1].drawers === 3],
  ["cajones en todas", null, (a) => a.columns.every((c) => c.drawers === 2)],
  ["quita los cajones", (b) => b.columns.forEach((c) => (c.drawers = 2)), (a) => a.columns.every((c) => c.drawers === 0)],
  ["quita un cajón de la primera", (b) => (b.columns[0].drawers = 3), (a) => a.columns[0].drawers === 2],
  ["un cajón más en la tercera", null, (a) => a.columns[2].drawers === 1],
  ["pon puertas", null, (a) => a.columns.every((c) => c.door)],
  ["puerta en la segunda", null, (a) => a.columns[1].door && !a.columns[0].door],
  ["quita las puertas", (b) => b.columns.forEach((c) => (c.door = true)), (a) => a.columns.every((c) => !c.door)],
  ["sin puertas", (b) => b.columns.forEach((c) => (c.door = true)), (a) => a.columns.every((c) => !c.door)],
  ["cinco baldas", null, (a) => a.columns.every((c) => c.shelves.length === 5)],
  ["quita las baldas", null, (a) => a.columns.every((c) => c.shelves.length === 0)],
  ["una balda más en la cuarta", null, (a, b) => a.columns[3].shelves.length === b.columns[3].shelves.length + 1 && a.columns[0].shelves.length === b.columns[0].shelves.length],
  ["baldas cada 30 cm", null, (a) => a.columns.every((c) => c.shelves.length >= 4 && c.shelves.every((s, i) => i === 0 || Math.abs(s - c.shelves[i - 1] - 300) <= 2))],
  ["ancho 2,10 m", null, (a) => a.width === 2100],
  ["1,80 x 2,20", null, (a) => a.width === 1800 && a.height === 2200],
  ["que quepa en un hueco de 1,5 m", null, (a) => a.width === 1490],
  ["hazla de madera oscura", null, (a) => a.material === "nogal"],
  ["en madera clara", null, (a) => a.material === "abedul"],
  ["blanca", null, (a) => a.material === "melamina_blanca"],
  ["cerrada por detrás", (b) => (b.back = false), (a) => a.back === true && a.columns.every((c) => !c.door)],
  ["sin trasera", null, (a) => a.back === false],
  ["no quiero que tenga fondo", null, (a) => a.back === false],
  ["fondo de 40 cm", null, (a) => a.depth === 400 && a.back === true],
  ["a la pared", null, (a) => a.base === "flotante"],
  ["con patas", (b) => { b.base = "zocalo"; b.baseHeight = 80; }, (a) => a.base === "patas"],
  ["con zócalo", null, (a) => a.base === "zocalo"],
  ["5 columnas", null, (a) => a.columns.length === 5 && Math.max(...a.columns.map((c) => c.width)) - Math.min(...a.columns.map((c) => c.width)) <= 2],
  ["una columna más", null, (a, b) => a.columns.length === b.columns.length + 1],
  ["quita una columna", null, (a, b) => a.columns.length === b.columns.length - 1],
  ["más ancha", null, (a, b) => a.width === b.width + 260],
  ["un poco más estrecha", null, (a, b) => a.width === b.width - 130],
  ["más alta", null, (a, b) => a.height === b.height + 260],
  ["espesor de 22 mm", null, (a) => a.thickness === 22],
  ["que sea más resistente", null, (a) => a.thickness === 22],
  ["prepárala para vinilos", null, (a) => a.depth === 340 && a.columns.every((c) => c.shelves.every((s, i) => i === 0 || Math.abs(s - c.shelves[i - 1] - 348) <= 2))],
  ["para libros", null, (a) => a.depth === 280],
  ["mueble para la tele", null, (a) => a.height === 560],
  ["que no se vea lo de dentro", null, (a) => a.columns.every((c) => c.door)],
  ["dos cajones y puerta en la tercera", null, (a) => a.columns[2].drawers === 2 && a.columns[2].door && !a.columns[0].door],
  ["4 cajones", (b) => { b.height = 700; }, (a) => a.columns[0].drawers * DRAWER_H <= a.height - a.baseHeight - 2 * a.thickness],
  ["hola", null, (a, b, r) => r === null || !!r.ask],
  ["¿cuánto cuesta?", null, (a, b, r) => !!(r && r.ask)],
  ["quiero una estantería", null, (a, b, r) => r === null || !!r.ask || JSON.stringify(a) === JSON.stringify(b)],
];
for (const [cmd, setup, expect] of T) {
  const before = base();
  if (setup) { setup(before); Object.assign(before, normalize(before)); }
  let res, after, ok;
  try {
    res = parseIntent(cmd, before);
    after = res && res.params ? normalize(res.params) : before;
    ok = !!expect(after, before, res);
  } catch (e) { ok = false; }
  check(ok, "chat", `«${cmd}» → ${res ? (res.ask ? "pregunta" : (res.changes || []).join(", ")) : "sin resolver"}`);
  if (after) invariants(after, `chat «${cmd}»`);
}

/* ---------- informe ---------- */
const total = [...fails.values()].reduce((a, v) => a + v.length, 0);
console.log(`\n${checks} comprobaciones · ${total} fallos en ${fails.size} grupos\n`);
for (const [g, list] of fails) {
  console.log(`✗ ${g} (${list.length})`);
  [...new Set(list)].slice(0, 5).forEach((m) => console.log("    " + m));
  if (new Set(list).size > 5) console.log(`    … y ${new Set(list).size - 5} más`);
}
if (process.env.QA_JSON) writeFileSync(process.env.QA_JSON, JSON.stringify(Object.fromEntries(fails)));
process.exit(total ? 1 : 0);
