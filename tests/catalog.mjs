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
  drawersIn, drawerCount, isDoor, isRail, hasBox, isInner, boxesIn, boxType, BOX_MIN, BOX_H,
  HANDLES, build, railPos, railRange, setRailAt, doorKey, scaleTo, setCell, cellBounds, BOX_MAX,
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
          : item === "door+drawer" ? (x) => isInner(x)
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

/* ---- casos concretos ---- */
{
  /* doble barra: subir una no mueve la otra */
  n++;
  let p = normalize({ width: 900, height: 2400, depth: 600, base: "zocalo", baseHeight: 80, columns: [{ width: 800, shelves: [1100], cells: ["rail", "rail"] }] });
  const up0 = railPos(p, p.columns[0], 1);
  setRailAt(p, p.columns[0], 0, 700);
  p = normalize(p);
  if (railPos(p, p.columns[0], 0) !== railRange(p, p.columns[0], 0)[0] && railPos(p, p.columns[0], 0) !== 700 || railPos(p, p.columns[0], 1) !== up0)
    fail("doble barra", `bajar la de abajo mueve la de arriba: ${railPos(p, p.columns[0], 0)} / ${railPos(p, p.columns[0], 1)} (antes ${up0})`);
  setRailAt(p, p.columns[0], 1, up0 - 150);
  p = normalize(p);
  if (railPos(p, p.columns[0], 0) !== 700 || railPos(p, p.columns[0], 1) !== up0 - 150)
    fail("doble barra", `cada barra no guarda su altura: ${railPos(p, p.columns[0], 0)} / ${railPos(p, p.columns[0], 1)}`);
  /* quitar la barra y volver a ponerla: vuelve a su sitio de siempre */
  n++;
  let q = PRESETS.armario(normalize({}));
  setRailAt(q, q.columns[0], 0, 1000);
  q = normalize(q);
  q.columns[0].cells[0] = "door";
  q = normalize(q);
  if (q.columns[0].railAt) fail("barra", `la altura de una barra quitada se queda guardada: ${JSON.stringify(q.columns[0].railAt)}`);
  applyItem(q, "rail", 0, 0);
  q = normalize(q);
  if (railPos(q, q.columns[0], 0) !== railRange(q, q.columns[0], 0)[1]) fail("barra", `una barra nueva no va bajo el techo del hueco: ${railPos(q, q.columns[0], 0)}`);
  /* valores raros en railAt */
  n++;
  for (const v of ["", " ", false, true, null, [], "900", NaN]) {
    const r = normalize({ ...PRESETS.armario(normalize({})), columns: PRESETS.armario(normalize({})).columns.map((c) => ({ ...c, railAt: v })) });
    if (r.columns.some((c) => c.railAt !== undefined)) fail("barra", `railAt=${JSON.stringify(v)} se toma por una altura`);
  }
}
{
  /* cajón interior o bandeja junto a una balda vecina baja: su compartimento tiene sitio para la caja */
  n++;
  const p = normalize({ width: 1200, height: 2000, depth: 600, columns: [{ width: 580, shelves: [], cells: ["door"] }, { width: 580, shelves: [150], cells: ["open", "open"] }] });
  const r = applyItem(p, "tray", 0, 0);
  const again = normalize(deepCopy(p));
  if (!r.ok || !again.columns[0].cells.some(hasBox)) fail("cajón interior", `la bandeja desaparece: ${JSON.stringify(again.columns[0])}`);
  /* en un hueco de barra de 83 cm libres, la barra no se pierde */
  n++;
  const w = normalize({ width: 900, height: 950, depth: 600, base: "zocalo", baseHeight: 80, columns: [{ width: 864, shelves: [], cells: ["rail+door"] }] });
  applyItem(w, "door+drawer", 0, 0);
  const w2 = normalize(deepCopy(w));
  if (!w2.columns[0].cells.some(hasBox) || !w2.columns[0].cells.some(isRail)) fail("cajón interior", `el cajón interior quita la barra o no se pone: ${JSON.stringify(w2.columns[0].cells)}`);
}
{
  /* armario: llevar la puerta alta a otro hueco de la misma puerta no hace nada (antes vaciaba el de origen) */
  n++;
  const p = PRESETS.armario(normalize({}));
  const before = shape(p);
  const r = moveCell(p, { col: 1, cell: 1 }, { col: 1, cell: 2 });
  if (r.ok || shape(normalize(p)) !== before) fail("mover", `mover la puerta sobre sí misma cambia el armario: ${JSON.stringify(p.columns[1].cells)}`);
}
{
  /* una columna ancha con puerta: dos hojas, nunca una tercera sin costado donde colgarse */
  n++;
  const p = normalize({ width: 1500, columns: [{ width: 1464, shelves: [], cells: ["door"] }] });
  const leaves = build(p).parts.filter((x) => x.hinge);
  if (leaves.length !== 2 || leaves[0].hinge !== "L" || leaves[1].hinge !== "R") fail("puertas", `hojas: ${leaves.map((x) => x.hinge).join(",")}`);
  /* cada hoja tiene su clave y no se repite */
  n++;
  const ar = build(PRESETS.armario(normalize({}))).parts.filter((x) => x.hinge).map(doorKey);
  if (new Set(ar).size !== ar.length) fail("puertas", `claves de hoja repetidas: ${ar.join(" ")}`);
}

{
  /* estirar por una esquina: lo de dentro se reparte igual que estaba */
  const frac = (q) => q.columns.map((c) => c.shelves.map((v) => (v / (q.height - q.baseHeight - 2 * q.thickness)).toFixed(2)).join(","));
  for (const k of PRESET_KEYS) {
    const p = PRESETS[k](normalize({}));
    for (const [w, h] of [[3000, 2400], [900, 1100], [p.width, 2600], [1600, p.height]]) {
      n++;
      const q = scaleTo(p, { width: w, height: h });
      if (q.width !== w || q.height !== h) fail("estirar", `${k}: pedía ${w}×${h} y salió ${q.width}×${q.height}`);
      if (q.columns.length !== p.columns.length) fail("estirar", `${k} ${w}×${h}: cambian las columnas (${p.columns.length} → ${q.columns.length})`);
      const a = frac(p).join(" | "), b = frac(q).join(" | ");
      if (a !== b) fail("estirar", `${k} ${w}×${h}: las baldas se descolocan · ${a} → ${b}`);
      if (JSON.stringify(normalize(deepCopy(q)).columns) !== JSON.stringify(q.columns)) fail("estirar", `${k} ${w}×${h}: normalize lo vuelve a cambiar`);
    }
  }
  /* los límites del taller mandan */
  n++;
  const lim = scaleTo(PRESETS.armario(normalize({})), { width: 99999, height: 1 });
  if (lim.width !== 3200 || lim.height !== 400) fail("estirar", `fuera de rango: ${lim.width}×${lim.height}`);
  /* una barra de colgar sube y baja con el mueble */
  n++;
  let ar = PRESETS.armario(normalize({}));
  setRailAt(ar, ar.columns[0], 0, railRange(ar, ar.columns[0], 0)[0] + 100);
  ar = normalize(ar);
  const rel = railPos(ar, ar.columns[0], 0) / (ar.height - ar.baseHeight - 2 * ar.thickness);
  const big = scaleTo(ar, { width: ar.width, height: 2500 });
  const rel2 = railPos(big, big.columns[0], 0) / (big.height - big.baseHeight - 2 * big.thickness);
  if (Math.abs(rel - rel2) > 0.02) fail("estirar", `la barra no sigue al mueble: ${rel.toFixed(2)} → ${rel2.toFixed(2)}`);
}

{
  /* el bloque de cajones interiores: uno, dos o tres, y siempre detrás de la puerta */
  for (const [type, want] of [["door+drawer", 1], ["door+drawer2", 2], ["door+drawer3", 3]]) {
    n++;
    let p = PRESETS.armario(normalize({}));
    setCell(p, p.columns[0], 0, type, p.columns);
    p = normalize(p);
    const cell = p.columns[0].cells.findIndex(isInner);
    if (cell < 0) { fail("cajón interior", `${type} no se pone`); continue; }
    if (boxesIn(p.columns[0].cells[cell]) !== want) fail("cajón interior", `${type} se queda en ${p.columns[0].cells[cell]}`);
    const g = build(p);
    const fronts = g.parts.filter((x) => x.col === 0 && x.id.startsWith("cajoni_"));
    if (fronts.length !== want) fail("cajón interior", `${type} dibuja ${fronts.length} frentes`);
    /* los frentes no se montan unos sobre otros ni se salen del compartimento */
    const ys = fronts.map((x) => [x.pos[1] - x.size[1] / 2, x.pos[1] + x.size[1] / 2]).sort((a, b) => a[0] - b[0]);
    for (let k = 1; k < ys.length; k++) if (ys[k][0] < ys[k - 1][1]) fail("cajón interior", `${type}: dos frentes se pisan`);
    /* y hay una puerta que los tapa */
    const door = g.parts.find((x) => x.id.startsWith("puerta_0_") && x.cells && x.cells[0] <= cell && x.cells[1] >= cell);
    if (!door) fail("cajón interior", `${type} se queda a la vista: sin puerta delante`);
    else if (door.pos[1] - door.size[1] / 2 > ys[0][0] + 1 || door.pos[1] + door.size[1] / 2 < ys[ys.length - 1][1] - 1) {
      fail("cajón interior", `${type}: la puerta no llega a taparlos`);
    }
    /* un par de guías por cajón */
    if (g.parts.filter((x) => x.col === 0 && x.runner).length !== want) fail("cajón interior", `${type}: guías mal contadas`);
  }
  /* soltar otro cajón interior encima apila, y al tercero se planta */
  n++;
  let q = PRESETS.armario(normalize({}));
  applyItem(q, "door+drawer", 0, 0);
  const seq = [];
  for (let k = 0; k < 4; k++) {
    const r = applyItem(q, "door+drawer", 0, q.columns[0].cells.findIndex(isInner));
    q = normalize(q);
    seq.push(r.ok ? boxesIn(q.columns[0].cells.find(isInner)) : r.reason);
  }
  if (seq.join(",") !== "2,3,maxBox,maxBox") fail("cajón interior", `apilar da ${seq.join(",")}`);
  /* un hueco que no da para tres deja los que quepan, no los borra */
  n++;
  const tight = normalize({ width: 900, height: 900, depth: 600, base: "zocalo", baseHeight: 80,
                            columns: [{ width: 864, shelves: [], cells: ["door+drawer3"] }] });
  const got = boxesIn(tight.columns[0].cells[0]);
  if (!(got >= 1 && got <= 3) || !isInner(tight.columns[0].cells[0])) fail("cajón interior", `hueco justo: ${tight.columns[0].cells[0]}`);
  if (got * BOX_MIN > tight.height - tight.baseHeight - 2 * tight.thickness) fail("cajón interior", `caben ${got} y no caben`);

  /* el bloque LLENA su hueco: nada de un cajón suelto con un palmo de aire encima.
     Se prueba en muebles de todas las alturas y en todos los huecos de la columna. */
  for (const H of [900, 1400, 2000, 2200]) {
    for (const nb of [1, 2, 3]) {
      for (let j = 0; j < 4; j++) {
        n++;
        let p = normalize(scaleTo(PRESETS.estanteria(normalize({})), { width: 2400, height: H, depth: 420 }));
        const c = p.columns[0];
        if (j >= c.cells.length) continue;
        const type = boxType(nb);
        if (!canPlace(p, type, 0, j, true).ok) continue;
        applyItem(p, type, 0, j, true);
        p = normalize(p);
        const cc = p.columns[0], cell = cc.cells.findIndex(isInner);
        if (cell < 0) { fail("cajón interior", `H${H} n${nb} hueco${j}: no se pone`); continue; }
        const g = build(p), lat = g.parts.find((x) => x.id === "lat_i");
        const y0 = lat.pos[1] - lat.size[1] / 2 + p.thickness;   // suelo interior, no canto del lateral
        const b = cellBounds(p, cc);
        const fronts = g.parts.filter((x) => x.col === 0 && x.id.startsWith("cajoni_"));
        const top = Math.max(...fronts.map((x) => x.pos[1] + x.size[1] / 2)) - y0;
        const air = b[cell + 1] - top;
        if (air > 45) fail("cajón interior", `H${H} n${nb} hueco${j}: ${Math.round(air)} mm de aire encima`);
        if (air < -1) fail("cajón interior", `H${H} n${nb} hueco${j}: los cajones se salen por arriba`);
      }
    }
  }

  /* la balda de encima no se mueve si el hueco ya da cajones de un alto normal:
     moverla por moverlo descuadra la línea con las columnas de al lado */
  for (const [row, nb] of [[0, 2], [2, 2], [1, 2]]) {
    n++;
    let p = normalize(scaleTo(PRESETS.estanteria(normalize({})), { width: 2400, height: 2000, depth: 320 }));
    const before = JSON.stringify(p.columns[2].shelves);
    if (!canPlace(p, boxType(nb), 2, row, true).ok) { fail("cajón interior", `fila ${row}: no cabe`); continue; }
    applyItem(p, boxType(nb), 2, row, true);
    p = normalize(p);
    if (JSON.stringify(p.columns[2].shelves) !== before) {
      fail("cajón interior", `fila ${row}: la balda se mueve sin falta (${before} -> ${JSON.stringify(p.columns[2].shelves)})`);
    }
  }

  /* si hay que moverla, los frentes tienen que salir de un alto de cajón */
  for (const [row, nb] of [[0, 1], [0, 3], [2, 1], [2, 3]]) {
    n++;
    let p = normalize(scaleTo(PRESETS.estanteria(normalize({})), { width: 2400, height: 2000, depth: 320 }));
    if (!canPlace(p, boxType(nb), 2, row, true).ok) continue;
    applyItem(p, boxType(nb), 2, row, true);
    p = normalize(p);
    const fr = build(p).parts.filter((x) => x.col === 2 && x.id.startsWith("cajoni_"));
    const bad = fr.find((x) => x.size[1] < BOX_MIN - 1 || x.size[1] > BOX_MAX + 1);
    if (bad) fail("cajón interior", `fila ${row} con ${nb}: frente de ${Math.round(bad.size[1])} mm`);
  }

  /* el panel PONE el número que se pulsa: de tres se puede bajar a uno */
  n++;
  let r3 = PRESETS.armario(normalize({}));
  applyItem(r3, "door+drawer3", 0, 0, true);
  for (const [to, want] of [["door+drawer", 1], ["door+drawer2", 2], ["door+drawer3", 3], ["door+drawer", 1]]) {
    const at = r3.columns[0].cells.findIndex(isInner);
    const chk = canPlace(r3, to, 0, at, true);
    if (!chk.ok) { fail("cajón interior", `el panel no deja poner ${to}: ${chk.reason}`); continue; }
    applyItem(r3, to, 0, at, true);
    r3 = normalize(r3);
    const got2 = boxesIn(r3.columns[0].cells.find(isInner));
    if (got2 !== want) fail("cajón interior", `el panel pone ${to} y salen ${got2}`);
  }
}

const total = [...fails.values()].reduce((a, v) => a + v.length, 0);
console.log(`\ncatálogo: ${n} operaciones · ${total} fallos\n`);
for (const [g, list] of fails) {
  console.log(`✗ ${g} (${list.length})`);
  list.slice(0, 3).forEach((m) => console.log("    " + m.split(" · ").slice(-3).join(" · ")));
}
process.exit(total ? 1 : 0);
