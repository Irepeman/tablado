/* ============================================================
   FERRETERÍA — tornillos, herrajes y taladros
   Un despiece no se puede fabricar: son tableros cortados y nada más.
   Lo que un taller necesita además es esto: con qué se une cada junta,
   qué bisagra admite una puerta enrasada, qué guía cabe en ese fondo,
   y dónde van los taladros.

   Sale de la MISMA geometría que el 3D y el despiece, pieza a pieza,
   así que la lista no puede contradecir al mueble: si quitas una balda
   desaparecen sus cuatro soportes.

   Lo que se ha seguido (y lo que no):
   · Sistema 32: taladros de Ø5 mm cada 32 mm, la fila delantera a 37 mm
     del canto. Es la retícula de la que cuelgan baldas, bisagras y guías.
   · Excéntrica Ø15 mm alojada 12,5 mm + perno M6, con espiga de haya 8×30
     para que la junta no gire. Dos por junta hasta 400 mm de fondo, tres
     hasta 550, cuatro por encima.
   · Bisagra de cazoleta Ø35 mm: la cazoleta se aloja 12,5–13 mm y su centro
     va a unos 22,5 mm del canto. El brazo tiene que ser ACODADO (inset):
     nuestras puertas van enrasadas con el mueble, no solapadas, y una
     bisagra recta no cierra así. La plantilla del fabricante manda sobre
     esta cota: cambia con la marca y con el solape.
   · Guía de bolas de extracción total, altura 45 mm, en pasos de 50 mm de
     250 a 550, unos 30 kg por par. Pide 12,5 mm de holgura por lado, que
     es exactamente lo que el motor deja entre la caja del cajón y el
     costado.
   Unidades: milímetros. Cantidades: unidades reales, sin redondear al alza.
   ============================================================ */
import { legCount } from "./model.js";

/* Precio de compra del taller, € por unidad. No es el precio de venta:
   de aquí sale el coste de herrajes del presupuesto. */
export const COST = {
  cam: 0.65,          // excéntrica + perno
  dowel: 0.04,        // espiga de haya 8×30
  pin: 0.25,          // soporte de balda Ø5
  hinge: 2.25,        // bisagra acodada con base y amortiguador
  euroScrew: 0.07,    // tornillo euro 6,3×13
  screw: 0.05,        // tornillo de aglomerado (cualquier medida)
  runner: 11.5,       // par de guías de bolas
  roller: 6.0,        // par de guías de rodillos (cajón corto)
  handle: { bar: 4.5, bar_brass: 9.5, knob: 3.5, cup: 6.5, profile: 8, push: 12 },
  profileML: 12.0,    // perfil gola de aluminio, € por metro
  railM: 9.0,         // tubo ovalado, € por metro
  railSupport: 1.5,   // soporte de barra
  leg: 6.5,           // pata regulable
  bracket: 1.4,       // escuadra de fijación
  hanger: 7.5,        // colgador invisible (par) para mueble suspendido
  plug: 0.12,         // taco Ø8×40
  glue: 4.2,          // cola D3, bote de 250 ml
  edgeML: 2.1,        // canto ABS, € por metro
};

const T = {
  es: {
    cam: ["Excéntrica Ø15 + perno M6", "Alojamiento Ø15×12,5 mm en el horizontal; perno roscado al canto del vertical"],
    dowel: ["Espiga de haya 8×30 mm", "Dos por junta, encoladas: son las que impiden que la junta gire"],
    pin: ["Soporte de balda Ø5 mm", "Cuatro por balda, en la línea de taladros del sistema 32"],
    hinge: ["Bisagra cazoleta Ø35 mm, 110°, brazo acodado (puerta enrasada), con amortiguador", "Base recta de 0 mm. Las puertas van embutidas en el hueco, no solapadas"],
    euroScrew: ["Tornillo euro 6,3×13 mm", "Fija las bases de bisagra y las guías en los taladros Ø5 del costado"],
    screwCup: ["Tornillo aglomerado 4×16 mm", "Dos por cazoleta de bisagra"],
    screwBox: ["Tornillo aglomerado 3,5×30 mm", "Montaje de las cajas de cajón: dos por esquina"],
    screwFront: ["Tornillo aglomerado 4×30 mm", "Sujeta el frente a la caja del cajón, dos por frente, con regulación"],
    screwRunner: ["Tornillo de cabeza plana 3,5×16 mm", "Cuatro al costado y cuatro al lateral del cajón, por cada par de guías"],
    screwBack: ["Tornillo 3×16 mm (o grapa de 10 mm)", "Trasera de 3 mm, un punto cada 150 mm por todo el perímetro"],
    screwLeg: ["Tornillo aglomerado 4×16 mm", "Cuatro por pata, en la pletina"],
    screwPlinth: ["Tornillo aglomerado 4×40 mm", "Zócalo contra el suelo del mueble"],
    runner: (mm) => [`Guía de bolas extracción total 45 mm, ${mm} mm (par)`, "Carga ~30 kg. Atornillada a la línea de 37 mm del costado"],
    roller: (mm) => [`Guía de rodillos 45 mm, ${mm} mm (par)`, "La caja es más corta que la guía de bolas más corta (250 mm): aquí solo entra rodillo, con extracción parcial"],
    handle: { bar: "Tirador de barra", bar_brass: "Tirador de barra en latón", knob: "Pomo", cup: "Uñero embutido", profile: "Perfil gola de aluminio", push: "Pestillo de presión (push)" },
    handleNote: { bar: "Dos tornillos M4 pasantes por frente", bar_brass: "Dos tornillos M4 pasantes por frente", knob: "Un tornillo M4 pasante por frente", cup: "Fresado en el frente, dos tornillos 4×16", profile: "Se atornilla al canto superior del frente", push: "Uno por frente: sin tirador, abre por presión" },
    screwHandle: ["Tornillo M4×30 mm", "Pasante, de dentro del frente al tirador"],
    rail: ["Tubo de colgar ovalado 30×15 mm", "Cortado a la medida de la columna"],
    railSupport: ["Soporte de barra ovalada", "Uno en cada costado; con uno central si la columna pasa de 900 mm"],
    leg: ["Pata regulable M8, 100 mm", "Regulación ±15 mm para suelos que no están a nivel"],
    bracket: ["Escuadra de fijación 60×60 mm", "Del mueble a la pared, por el interior y arriba"],
    hanger: ["Colgador invisible para mueble suspendido (par)", "El mueble no apoya en el suelo: lo sostiene la pared"],
    plug: ["Taco Ø8×40 + tornillo 5×60 mm", "Dos por punto de anclaje. Taco de nailon para tabique macizo"],
    glue: ["Cola blanca D3, bote de 250 ml", "Solo en las espigas: las excéntricas tienen que poder desmontarse"],
    edge: ["Canto ABS 22×0,8 mm", "Metros ya con un 10% de merma para el canteado"],
    groups: { carcase: "Carcasa", shelves: "Baldas", doors: "Puertas", drawers: "Cajones", fronts: "Frentes y tiradores", rails: "Barras de colgar", base: "Base y anclaje", consum: "Consumibles" },
    units: { ud: "ud", pair: "par", m: "m", pot: "bote" },
    notes: [
      "Taladros del sistema 32: filas de Ø5 mm cada 32 mm en los costados y divisores, la primera fila a 37 mm del canto delantero. De ella cuelgan baldas, bisagras y guías.",
      "Las excéntricas van alojadas a Ø15×12,5 mm en el tablero horizontal, y el perno roscado al canto del vertical.",
      "Cazoleta de bisagra: Ø35 mm, 12,5–13 mm de profundidad, centro a unos 22,5 mm del canto. Confirma la cota con la plantilla de la bisagra que compres: cambia con la marca.",
      "El fondo del cajón, de 6 mm, entra en ranura a 10 mm del canto inferior de los laterales. No se atornilla.",
      "Las puertas y los frentes van embutidos, con 3 mm de junta por lado. Por eso la bisagra tiene que ser de brazo acodado.",
    ],
  },
  en: {
    cam: ["Cam fitting Ø15 + M6 bolt", "Ø15×12.5 mm housing in the horizontal panel; bolt threaded into the vertical edge"],
    dowel: ["Beech dowel 8×30 mm", "Two per joint, glued: these are what stop the joint rotating"],
    pin: ["Shelf pin Ø5 mm", "Four per shelf, on the System 32 hole line"],
    hinge: ["Concealed hinge Ø35 mm cup, 110°, cranked arm (inset door), soft close", "Straight 0 mm mounting plate. The doors sit inside the opening, not overlaid"],
    euroScrew: ["Euro screw 6.3×13 mm", "Fixes hinge plates and runners into the Ø5 holes in the side panel"],
    screwCup: ["Chipboard screw 4×16 mm", "Two per hinge cup"],
    screwBox: ["Chipboard screw 3.5×30 mm", "Drawer box assembly: two per corner"],
    screwFront: ["Chipboard screw 4×30 mm", "Holds the front to the drawer box, two per front, adjustable"],
    screwRunner: ["Pan head screw 3.5×16 mm", "Four into the side panel and four into the drawer side, per pair of runners"],
    screwBack: ["Screw 3×16 mm (or 10 mm staple)", "3 mm back panel, one point every 150 mm all round"],
    screwLeg: ["Chipboard screw 4×16 mm", "Four per leg, through the base plate"],
    screwPlinth: ["Chipboard screw 4×40 mm", "Plinth to the cabinet bottom"],
    runner: (mm) => [`Full-extension ball-bearing runner 45 mm, ${mm} mm (pair)`, "About 30 kg. Screwed to the 37 mm line on the side panel"],
    roller: (mm) => [`Roller runner 45 mm, ${mm} mm (pair)`, "The box is shorter than the shortest ball-bearing runner (250 mm): only a roller fits here, with partial extension"],
    handle: { bar: "Bar handle", bar_brass: "Brass bar handle", knob: "Knob", cup: "Recessed cup pull", profile: "Aluminium gola profile", push: "Push latch" },
    handleNote: { bar: "Two M4 screws through each front", bar_brass: "Two M4 screws through each front", knob: "One M4 screw through each front", cup: "Routed into the front, two 4×16 screws", profile: "Screwed to the top edge of the front", push: "One per front: no handle, opens by pressure" },
    screwHandle: ["Screw M4×30 mm", "Through the front, from the inside into the handle"],
    rail: ["Oval hanging tube 30×15 mm", "Cut to the width of the column"],
    railSupport: ["Oval rail support", "One at each side; add a centre one if the column is over 900 mm"],
    leg: ["Adjustable leg M8, 100 mm", "±15 mm of adjustment for floors that are not level"],
    bracket: ["Fixing bracket 60×60 mm", "Cabinet to wall, inside and high up"],
    hanger: ["Invisible wall hanger for suspended units (pair)", "The unit does not stand on the floor: the wall holds it"],
    plug: ["Wall plug Ø8×40 + screw 5×60 mm", "Two per anchor point. Nylon plug, solid wall"],
    glue: ["PVA wood glue D3, 250 ml", "Dowels only: the cam fittings have to come apart again"],
    edge: ["ABS edging 22×0.8 mm", "Metres, including 10% waste for the edgebander"],
    groups: { carcase: "Carcase", shelves: "Shelves", doors: "Doors", drawers: "Drawers", fronts: "Fronts and handles", rails: "Hanging rails", base: "Base and wall fixing", consum: "Consumables" },
    units: { ud: "pcs", pair: "pair", m: "m", pot: "tub" },
    notes: [
      "System 32 drilling: rows of Ø5 mm holes every 32 mm in sides and dividers, the first row 37 mm from the front edge. Shelves, hinges and runners all hang off it.",
      "Cam fittings are housed Ø15×12.5 mm in the horizontal panel, with the bolt threaded into the edge of the vertical one.",
      "Hinge cup: Ø35 mm, 12.5–13 mm deep, centre about 22.5 mm from the edge. Confirm it against the template of the hinge you buy: it changes with the brand.",
      "The 6 mm drawer bottom sits in a groove 10 mm up from the bottom edge of the sides. It is not screwed.",
      "Doors and fronts are inset, with a 3 mm gap all round. That is why the hinge has to have a cranked arm.",
    ],
  },
};

/* bisagras por altura de hoja: una hoja de 2 m con dos bisagras se descuelga */
export const hingesFor = (h) => (h <= 900 ? 2 : h <= 1600 ? 3 : h <= 2000 ? 4 : 5);
/* excéntricas por junta: una junta de 600 mm de fondo con dos se abre por el medio */
export const camsFor = (depth) => (depth <= 400 ? 2 : depth <= 550 ? 3 : 4);
/* La guía comercial que CABE en esa caja. Las de bolas empiezan en 250 mm y
   van de 50 en 50 hasta 550. Por debajo de eso no hay guía de bolas: un cajón
   de 24 cm se monta con guía de rodillos de 200, y por debajo de 200 mm no hay
   nada que montar y lo dice validate(). */
export const RUNNER_MIN = 250, RUNNER_MAX = 550, ROLLER_MIN = 200;
export function runnerFor(boxDepth) {
  if (boxDepth >= RUNNER_MIN) {
    const n = Math.min(RUNNER_MAX, Math.floor(boxDepth / 50) * 50);
    return { mm: n, kind: "ball" };
  }
  if (boxDepth >= ROLLER_MIN) return { mm: ROLLER_MIN, kind: "roller" };
  return { mm: 0, kind: null };
}

export function hardware(p, geo, lang = "es") {
  const L = T[lang] || T.es;
  const U = L.units;
  const parts = geo.parts;
  const lines = [];
  const add = (grp, key, pair, qty, unit, cost) => {
    if (!(qty > 0)) return;
    /* el mismo tornillo en dos sitios es una sola línea de compra */
    const same = lines.find((x) => x.grp === grp && x.name === pair[0] && x.unit === unit);
    if (same) { same.qty = Math.round((same.qty + qty) * 100) / 100; same.total = same.qty * cost; return; }
    lines.push({ grp, key, name: pair[0], note: pair[1], qty: Math.round(qty * 100) / 100, unit, cost, total: qty * cost });
  };

  /* ---------- carcasa: cada vertical se une al techo y al suelo ---------- */
  const nDiv = parts.filter((x) => x.grp === "divisor").length;
  const joints = 2 * (2 + nDiv);
  const cams = joints * camsFor(p.depth);
  const dowels = joints * 2;
  add("carcase", "cam", L.cam, cams, U.ud, COST.cam);
  add("carcase", "dowel", L.dowel, dowels, U.ud, COST.dowel);

  /* ---------- baldas ---------- */
  const shelves = parts.filter((x) => x.grp === "balda").reduce((a, x) => a + (x.qty || 1), 0);
  add("shelves", "pin", L.pin, shelves * 4, U.ud, COST.pin);

  /* ---------- puertas ---------- */
  const doors = parts.filter((x) => x.id && x.id.startsWith("puerta"));
  const hinges = doors.reduce((a, x) => a + hingesFor(x.Wd) * (x.qty || 1), 0);
  add("doors", "hinge", L.hinge, hinges, U.ud, COST.hinge);
  add("doors", "euroScrew", L.euroScrew, hinges * 2, U.ud, COST.euroScrew);
  add("doors", "screwCup", L.screwCup, hinges * 2, U.ud, COST.screw);

  /* ---------- cajones: la guía se elige por el fondo de SU caja ---------- */
  const boxes = parts.filter((x) => x.grp === "frente" && x.drawer);
  const byLen = new Map();
  let noRunner = 0;
  boxes.forEach((f) => {
    const side = parts.find((x) => x.grp === "cajon" && x.drawer === f.drawer && x.id.startsWith("cjlat_"));
    const r = runnerFor(side ? side.L : p.depth - 60);
    if (!r.kind) { noRunner++; return; }
    const k = `${r.kind}${r.mm}`;
    byLen.set(k, { ...r, n: (byLen.get(k)?.n || 0) + 1 });
  });
  [...byLen.values()].sort((a, b) => a.mm - b.mm).forEach((r) =>
    add("drawers", `runner${r.mm}`, r.kind === "roller" ? L.roller(r.mm) : L.runner(r.mm), r.n, U.pair,
        r.kind === "roller" ? COST.roller : COST.runner));
  const nBoxes = boxes.length - noRunner;
  add("drawers", "screwRunner", L.screwRunner, nBoxes * 8, U.ud, COST.screw);
  add("drawers", "screwBox", L.screwBox, nBoxes * 8, U.ud, COST.screw);
  add("drawers", "screwFront", L.screwFront, nBoxes * 2, U.ud, COST.screw);

  /* ---------- tiradores ---------- */
  const fronts = parts.filter((x) => x.grp === "frente" && !x.nohandle).length;
  const h = p.handle || "bar";
  if (fronts) {
    if (h === "profile") {
      /* la gola se vende por metro y se corta al ancho de cada frente */
      const ml = parts.filter((x) => x.grp === "frente" && !x.nohandle)
        .reduce((a, x) => a + x.L / 1000, 0);
      add("fronts", "profile", [L.handle.profile, L.handleNote.profile], Math.round(ml * 10) / 10, U.m, COST.profileML);
    } else {
      add("fronts", h, [L.handle[h], L.handleNote[h]], fronts, U.ud, COST.handle[h] ?? COST.handle.bar);
      if (h === "bar" || h === "bar_brass") add("fronts", "screwHandle", L.screwHandle, fronts * 2, U.ud, COST.screw);
      if (h === "knob") add("fronts", "screwHandle", L.screwHandle, fronts, U.ud, COST.screw);
      if (h === "cup") add("fronts", "screwCup2", L.screwCup, fronts * 2, U.ud, COST.screw);
    }
  }

  /* ---------- barras de colgar ---------- */
  const rails = parts.filter((x) => x.grp === "barra");
  if (rails.length) {
    const ml = rails.reduce((a, x) => a + x.L / 1000, 0);
    /* una barra de más de 900 mm se vence por el medio: lleva soporte central */
    const sup = rails.reduce((a, x) => a + (x.L > 900 ? 3 : 2), 0);
    add("rails", "rail", L.rail, Math.round(ml * 100) / 100, U.m, COST.railM);
    add("rails", "railSupport", L.railSupport, sup, U.ud, COST.railSupport);
  }

  /* ---------- trasera ---------- */
  const backs = parts.filter((x) => x.grp === "trasera");
  const backScrews = backs.reduce((a, x) => a + Math.ceil((2 * (x.L + x.Wd)) / 150), 0);
  add("carcase", "screwBack", L.screwBack, backScrews, U.ud, COST.screw);

  /* ---------- base y anclaje ---------- */
  const legs = legCount(p);
  add("base", "leg", L.leg, legs, U.ud, COST.leg);
  add("base", "screwLeg", L.screwLeg, legs * 4, U.ud, COST.screw);
  const plinth = parts.filter((x) => x.grp === "base").length;
  add("base", "screwPlinth", L.screwPlinth, plinth * 4, U.ud, COST.screw);

  /* Un mueble alto que no se ancla se vuelca encima de quien abre el cajón de
     arriba. Uno flotante no se sostiene de otra forma. */
  const floating = p.base === "flotante";
  const anchors = floating ? Math.max(1, Math.ceil(p.width / 900)) : p.height > 1200 ? Math.max(2, p.columns.length) : 0;
  if (floating) {
    add("base", "hanger", L.hanger, anchors, U.pair, COST.hanger);
    add("base", "plug", L.plug, anchors * 4, U.ud, COST.plug);
  } else if (anchors) {
    add("base", "bracket", L.bracket, anchors, U.ud, COST.bracket);
    add("base", "plug", L.plug, anchors * 2, U.ud, COST.plug);
    add("base", "screwLeg2", L.screwLeg, anchors * 2, U.ud, COST.screw);
  }

  /* ---------- consumibles ---------- */
  const edgeML = parts.reduce((a, x) => {
    if (x.hw || x.t <= 6) return a;
    const per = x.edges === 4 ? 2 * (x.L + x.Wd) : x.edges === 1 ? x.L : 0;
    return a + (per / 1000) * (x.qty || 1);
  }, 0) * 1.1;
  add("consum", "edge", L.edge, Math.round(edgeML * 10) / 10, U.m, COST.edgeML);
  if (dowels) add("consum", "glue", L.glue, Math.ceil(dowels / 120), U.pot, COST.glue);

  /* el canteado y la cola los cobra el presupuesto en su propia línea: aquí
     van en la lista porque el taller los tiene que comprar igual */
  const cost = lines.filter((x) => x.grp !== "consum").reduce((a, x) => a + x.total, 0);
  const consumCost = lines.filter((x) => x.grp === "consum").reduce((a, x) => a + x.total, 0);
  const pieces = lines.filter((x) => x.unit !== U.m && x.unit !== U.pot)
    .reduce((a, x) => a + (x.unit === U.pair ? x.qty * 2 : x.qty), 0);

  return {
    lines, cost, consumCost, edgeML, pieces, notes: L.notes, groups: L.groups,
    counts: { joints, cams, dowels, pins: shelves * 4, hinges, runners: nBoxes, noRunner, handles: fronts, rails: rails.length, legs, anchors, backScrews },
  };
}

/* el orden en que un taller lo lee: carcasa primero, consumibles al final */
export const GROUP_ORDER = ["carcase", "shelves", "doors", "drawers", "fronts", "rails", "base", "consum"];

export function byGroup(hw) {
  return GROUP_ORDER
    .map((g) => ({ g, title: hw.groups[g], lines: hw.lines.filter((x) => x.grp === g) }))
    .filter((x) => x.lines.length);
}
