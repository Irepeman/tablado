/* ============================================================
   Banco de pruebas del catálogo: operaciones seguidas, como las haría
   alguien arrastrando piezas. Tras cada una se comprueba:
   · que normalize() no «corrige» nada (si corrige, el 3D enseña algo
     distinto de lo que se soltó y cambian otros huecos);
   · que las demás columnas no cambian;
   · que el hueco donde se soltó tiene la pieza.
   node tests/catalog.mjs
   ============================================================ */
import {
  DEFAULT, normalize, deepCopy, PRESETS, PRESET_KEYS, CATALOG, canPlace, applyItem, moveCell,
  drawersIn, drawerCount, isDoor, isRail, hasBox, HANDLES, build,
} from "../lib/model.js";

let seed = 915;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const ITEMS = [...CATALOG.fronts, ...CATALOG.inside, ...CATALOG.handles];
const shape = (p) => JSON.stringify(p.columns.map((c) => [Math.round(c.width), c.shelves, c.cells]));
const colShape = (c) => JSON.stringify([Math.round(c.width), c.shelves, c.cells]);

const fails = new Map();
let n = 0;
const fail = (group, msg) => { if (!fails.has(group)) fails.set(group, []); fails.get(group).push(msg); };

for (let run = 0; run < 400; run++) {
  const k = pick(PRESET_KEYS);
  let p = PRESETS[k](normalize({ material: pick(["roble", "melamina_blanca"]), handle: pick(HANDLES) }));
  const log = [k];
  for (let step = 0; step < 14; step++) {
    n++;
    const col = Math.floor(rnd() * p.columns.length);
    const cell = Math.floor(rnd() * p.columns[col].cells.length);
    const before = deepCopy(p);
    const q = deepCopy(p);
    const doMove = rnd() < 0.25;
    let r, what;
    if (doMove) {
      const to = { col: Math.floor(rnd() * p.columns.length), cell: 0 };
      to.cell = Math.floor(rnd() * p.columns[to.col].cells.length);
      what = `mover ${col + 1}.${cell + 1} → ${to.col + 1}.${to.cell + 1} (${p.columns[col].cells[cell]})`;
      r = moveCell(q, { col, cell }, to);
    } else {
      const item = pick(ITEMS);
      what = `${item} en ${col + 1}.${cell + 1} (había ${p.columns[col].cells[cell]})`;
      const ok = canPlace(q, item, col, cell).ok;
      r = applyItem(q, item, col, cell);
      if (ok !== r.ok) fail("canPlace ≠ applyItem", `${log.join(" · ")} · ${what}`);
      if (r.ok && !item.startsWith("h:")) {
        const c = q.columns[col];
        const want = item === "open" ? (x) => x === "open"
          : item === "door" ? (x) => isDoor(x)
          : item === "rail" ? (x) => isRail(x)
          : item === "tray" ? (x) => hasBox(x)
          : item === "door+drawer" ? (x) => x === "door+drawer"
          : drawersIn(item) ? (x) => x === item : null;
        /* la pieza tiene que estar en ese hueco (o, si se partió, en el de abajo) */
        if (want && !want(c.cells[cell])) fail("la pieza no queda donde se suelta", `${log.join(" · ")} · ${what} → ${c.cells.join(",")}`);
        /* una puerta soltada donde no había puerta cubre solo ese hueco */
        if (item === "door" && !isDoor(p.columns[col].cells[cell]) && isDoor(c.cells[cell])) {
          const leaf = build(normalize(deepCopy(q))).parts.find((x) => x.id.startsWith(`puerta_${col}_`) && x.cells && x.cells[0] <= cell && x.cells[1] >= cell);
          if (!leaf || leaf.cells[0] !== cell || leaf.cells[1] !== cell) fail("la puerta se une a otra", `${log.join(" · ")} · ${what} → ${leaf ? leaf.cells.join("-") : "sin puerta"}`);
        }
      }
    }
    if (!r.ok) { if (JSON.stringify(q) !== JSON.stringify(before)) fail("rechazada pero cambia cosas", `${log.join(" · ")} · ${what}`); continue; }
    const norm = normalize(deepCopy(q));
    norm.columns.forEach((c, i) => { if (c.joins.length !== c.cells.length - 1) fail("uniones de puertas", `${what} → columna ${i + 1}`); });
    if (shape(norm) !== shape(q)) {
      fail("normalize() cambia lo que se acaba de poner", `${log.join(" · ")} · ${what}\n        antes  ${shape(q)}\n        después ${shape(norm)}`);
    }
    /* las demás columnas, intactas (el divisor inserta una columna y se salta) */
    if (!/divider/.test(what)) {
      const touched = new Set([col]);
      if (doMove) touched.add(Number(what.match(/→ (\d+)\./)[1]) - 1);
      before.columns.forEach((c, i) => {
        if (touched.has(i)) return;
        if (colShape(c) !== colShape(norm.columns[i])) fail("cambian otras columnas", `${log.join(" · ")} · ${what} → columna ${i + 1}`);
      });
    }
    log.push(what);
    p = norm;
  }
}

const total = [...fails.values()].reduce((a, v) => a + v.length, 0);
console.log(`\ncatálogo: ${n} operaciones · ${total} fallos\n`);
for (const [g, list] of fails) {
  console.log(`✗ ${g} (${list.length})`);
  list.slice(0, 3).forEach((m) => console.log("    " + m.split(" · ").slice(-3).join(" · ")));
}
process.exit(total ? 1 : 0);
