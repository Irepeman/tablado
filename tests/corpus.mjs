/* ============================================================
   CORPUS: lo que de verdad pediría o preguntaría alguien.
   Medidas habladas, estancias, estilos, dudas de compra (envío,
   devolución, garantía, anclaje), cosas que no fabricamos, erratas
   y conversación de varios mensajes. En español y en inglés.
   Si no se fabrica algo, la respuesta tiene que decirlo y ofrecer
   una alternativa: nunca el «no he sabido traducir eso».
   node tests/corpus.mjs
   ============================================================ */
import { DEFAULT, normalize, build } from "../lib/model.js";
import { cutlist, nest, quote } from "../lib/pricing.js";
import { parseIntent } from "../lib/intent.js";
import { parseIntentEN } from "../lib/intent-en.js";

const base = () => normalize(DEFAULT());
const price = (p) => { const g = build(p); return quote(p, g, nest(cutlist(g))).gross; };
const BASE_PRICE = price(base());
const SPANISH = /\b(ancho|alto|fondo|baldas?|cajón|cajones|columnas?|puertas?|trasera|patas|zócalo|más|menos|preparada|huecos?|hazla|tablero|precio|pasa|suspendida|cuadrícula|abajo|arriba|filas|garantía|envío|madera|acabado)\b/i;
const GENERIC = /No he sabido|couldn't turn that/;
const fails = [];
let n = 0;
const col = (a, i) => a.columns[i];
const all = (a, f) => a.columns.every(f);
const reply = (r) => !r ? "" : r.ask ? r.ask : [...(r.changes || []), ...(r.notes || [])].join(" | ");

function run(lang, msgs, expect, setup) {
  n++;
  const parse = lang === "en" ? parseIntentEN : parseIntent;
  let p = base();
  if (setup) { setup(p); p = normalize(p); }
  const b = p;
  let ctx = {}, r, ok = false, err = "";
  try {
    for (const m of msgs) {
      r = parse(m, p, ctx);
      if (r && r.params) {
        const after = normalize(r.params);
        ctx = { topic: r.topic, cols: r.cols, last: r.last };
        p = after;
      }
    }
    ok = !!expect({ a: p, b, r, txt: reply(r) });
  } catch (e) { err = ` [${e.message}]`; }
  const tag = `[${lang}] «${msgs.join(" → ")}»`;
  if (!ok) fails.push(`${tag} → ${r ? (r.action ? "action " + r.action : reply(r).slice(0, 110)) : "null"}${err}`);
  if (lang === "en") {
    const leak = [reply(r), ...((r && r.suggest) || [])].find((x) => SPANISH.test(x));
    if (leak) fails.push(`${tag} leaks Spanish: «${leak.slice(0, 100)}»`);
  }
}
const es = (m, f, s) => run("es", Array.isArray(m) ? m : [m], f, s);
const en = (m, f, s) => run("en", Array.isArray(m) ? m : [m], f, s);
/* respuesta honesta: menciona lo pedido y ofrece algo (sugerencias o cambio) */
const honest = (re) => ({ r, txt }) => !!r && !GENERIC.test(txt) && re.test(txt) && (r.params || r.suggest?.length > 0);
const ans = (re) => ({ r }) => !!r && !!r.ask && !GENERIC.test(r.ask) && re.test(r.ask);
const drw = (...ks) => ({ a }) => ks.every((k, i) => col(a, i).drawers === k);
const doors = (...ds) => ({ a }) => ds.every((d, i) => col(a, i).door === d);
const nd = (x) => (x === "drawer" ? 1 : x === "drawer2" ? 2 : x === "drawer3" ? 3 : 0);
const lastCell = (c) => c.cells[c.cells.length - 1];
const hasRail = ({ a }) => a.depth >= 580 && a.columns.some((c) => c.cells.some((x) => x.startsWith("rail")));

/* =================== ESPAÑOL =================== */
/* medidas, como se dicen */
es("mide 1,5 de ancho", ({ a }) => a.width === 1500);
es("que tenga 40 de fondo", ({ a }) => a.depth === 400);
es("altura de 1 metro", ({ a }) => a.height === 1000);
es("90x180", ({ a }) => a.width === 900 && a.height === 1800);
es("de 2 metros por 1 y medio", ({ a }) => a.width === 2000 && a.height === 1500);
es("1 metro 20 de ancho", ({ a }) => a.width === 1200);
es("que mida 180 x 200 x 35", ({ a }) => a.width === 1800 && a.height === 2000 && a.depth === 350);
es("que llegue al techo, tengo 2,50", ({ a }) => a.height >= 2400 && a.height <= 2490);
es("hasta el techo, que mide 2,40 m", ({ a }) => a.height >= 2300 && a.height <= 2390);
es("que no pase de 1,20 de alto", ({ a }) => a.height === 1200);
es("máximo 30 cm de fondo", ({ a }) => a.depth === 300);
es("tengo un hueco de 1,95 x 2,30", ({ a }) => a.width === 1940 && a.height >= 2250 && a.height <= 2300);
es("que quepa debajo de la ventana, 90 cm", ({ a, b }) => a.height <= 900 && a.height >= 850 && a.width === b.width);
es("la mitad de alta", ({ a }) => a.height === 1000);
es("2x2", ({ a }) => a.width === 2000 && a.height === 2000);
es("hazme una de 2x2", ({ a }) => a.width === 2000 && a.height === 2000);
es("dos metros diez de alto", ({ a }) => a.height === 2100);
es("un poco más alta", ({ a, b }) => a.height > b.height && a.height - b.height <= 150);
es("más profunda", ({ a, b }) => a.depth > b.depth);
/* columnas */
es("3 módulos", ({ a }) => a.columns.length === 3);
es("divídela en 5", ({ a }) => a.columns.length === 5);
es("pártela en tres", ({ a }) => a.columns.length === 3);
es("quita una columna", ({ a }) => a.columns.length === 3);
es("más columnas", ({ a }) => a.columns.length === 5);
es("columnas más estrechas", ({ a, b }) => a.columns.length === 5 && a.width === b.width);
es("columnas más anchas", ({ a, b }) => a.columns.length === 3 && a.width === b.width);
es("la del medio más ancha", ({ a, b }) => col(a, 1).width > col(b, 1).width && a.width === b.width);
es("la última columna más estrecha", ({ a, b }) => col(a, 3).width < col(b, 3).width && a.width === b.width);
es("tres columnas", ({ a }) => a.columns.length === 3);
/* baldas */
es("más baldas", ({ a }) => all(a, (c) => c.shelves.length === 4));
es("baldas cada 35", ({ a }) => all(a, (c) => c.shelves.length >= 3 && Math.abs(c.shelves[1] - c.shelves[0] - 350) <= 2));
es("huecos de 40 cm", ({ a }) => all(a, (c) => c.shelves.length >= 2 && Math.abs(c.shelves[1] - c.shelves[0] - 400) <= 2));
es("quita la balda de arriba", ({ a }) => all(a, (c) => c.shelves.length === 2 && Math.max(...c.shelves) < 1290));
es("quita la balda de abajo", ({ a }) => all(a, (c) => c.shelves.length === 2 && Math.min(...c.shelves) > 430));
es("que tenga 6 alturas", ({ a }) => all(a, (c) => c.shelves.length === 5));
es("sin baldas en la tercera", ({ a }) => col(a, 2).shelves.length === 0 && col(a, 0).shelves.length === 3);
es("cinco baldas", ({ a }) => all(a, (c) => c.shelves.length === 5));
es("ponle baldas a la derecha", ({ a }) => col(a, 3).shelves.length === 4 && col(a, 0).shelves.length === 3);
es("una balda menos", ({ a }) => all(a, (c) => c.shelves.length === 2));
/* cajones */
es("cajones abajo en todas", ({ a }) => all(a, (c) => c.drawers === 2));
es("un cajón en cada columna", ({ a }) => all(a, (c) => c.drawers === 1));
es("cajones solo en las de los lados", drw(2, 0, 0, 2));
es("3 cajones a la derecha", ({ a }) => col(a, 3).drawers === 3 && col(a, 0).drawers === 0);
es("quita un cajón", ({ a }) => col(a, 0).drawers === 1, (p) => { p.columns[0].drawers = 2; });
es("cajones en todas menos la primera", drw(0, 2, 2, 2));
es("cajones en todas excepto la última", drw(2, 2, 2, 0));
es("kiero 3 cajones", ({ a }) => col(a, 0).drawers === 3);
es("ponle 2 cajones xfa", ({ a }) => col(a, 0).drawers === 2);
es("dos cajones en el segundo cuadro", drw(0, 2, 0, 0));
es("cajones más grandes", ({ a }) => col(a, 0).drawers === 2 && col(a, 0).shelves[0] > 430, (p) => { p.columns[0].drawers = 2; });
es("¿los cajones tienen cierre suave?", ans(/guía/));
/* puertas */
es("puertas en las del centro", doors(false, true, true, false));
es("puertas alternas", doors(true, false, true, false));
es("que la mitad tenga puertas", doors(true, false, true, false));
es("puerta en la segunda", doors(false, true, false, false));
es("quita las puertas", ({ a }) => all(a, (c) => !c.door), (p) => p.columns.forEach((c) => { c.door = true; }));
es("puertas correderas", honest(/abatible/));
es("puertas solo abajo", ({ a }) => all(a, (c) => c.cells[0] === "door" && lastCell(c) !== "door"));
/* acabados */
es("color madera", ({ a }) => a.material === "roble", (p) => { p.material = "melamina_blanca"; });
es("blanco roto", ({ a }) => a.material === "melamina_blanca");
es("lacada en blanco", ({ a }) => a.material === "melamina_blanca");
es("roble oscuro", ({ a }) => a.material === "nogal");
es("negro mate", ({ a }) => a.material === "melamina_negra");
es("en haya", honest(/abedul|roble|nogal/));
es("de pino", honest(/abedul|roble|nogal/));
es("de madera maciza", honest(/maciza/));
es("de mdf", honest(/melamina/));
/* base y trasera */
es("con patas altas", ({ a, b }) => a.base === "patas" && a.baseHeight > b.baseHeight);
es("que se apoye en el suelo", ({ a }) => a.base === "zocalo");
es("colgada", ({ a }) => a.base === "flotante");
es("sin patas porfavor", ({ a }) => a.base !== "patas");
es("patas doradas", honest(/negr/));
es("trasera blanca", honest(/trasera/));
es("sin fondo", ({ a }) => a.back === false);
/* estancias y usos */
es("para el salón", ans(/salón/));
es("para cómics", ({ a }) => a.depth === 280);
es("para dvds", ({ a }) => a.depth === 200);
es("para el baño", ({ a }) => a.material === "melamina_blanca");
es("para el garaje", ({ a }) => a.thickness === 22);
es("para separar ambientes", ({ a }) => a.back === false);
es("quiero un armario", hasRail);
es("una mesita de noche", ({ a }) => a.width <= 500 && a.height <= 600 && a.columns.length === 1 && col(a, 0).drawers >= 1);
es("un aparador", ({ a }) => a.height <= 900 && all(a, (c) => c.door));
es("para una tele de 55 pulgadas", ({ a }) => a.width >= 1400 && a.height <= 600);
es("librería para el despacho", ({ a }) => a.depth >= 280);
es("estantería en esquina", honest(/esquina|rincón/));
es("para un techo abuhardillado", honest(/inclinad|abuhardill/));
es("escalonada", honest(/escalon|altura/));
/* presupuesto */
es("presupuesto de 900 euros", ({ a }) => price(a) < BASE_PRICE);
es("lo más barato posible", ({ a }) => a.material === "melamina_blanca" && !a.back && a.thickness === 16);
es("¿por qué es tan caro?", ans(/€/));
es("¿hay descuentos?", ans(/descuent|precio/));
/* dudas de compra */
es("¿hacéis envíos a Canarias?", ans(/peninsular|Península/));
es("¿se puede devolver?", ans(/medida/));
es("¿viene montada?", ans(/minutos/));
es("¿necesito herramientas?", ans(/llave|Allen/));
es("¿qué garantía tiene?", ans(/3 años/));
es("¿de qué material es?", ans(/roble/i));
es("¿es sostenible?", ans(/%/));
es("¿cómo se ancla a la pared?", ans(/antivuelco|pared/));
es("¿aguanta una tele?", ans(/kg/));
es("¿se puede desmontar?", ans(/desmont|herrajes/));
/* conversación y humor */
es("no me gusta", ans(/.+/));
es("está bien así", ans(/.+/));
es("sorpréndeme", ans(/.+/));
es("hazla más bonita", ans(/.+/));
es("hazla moderna", ({ a }) => a.material === "melamina_blanca");
es("estilo japandi", ({ a }) => a.material === "roble" && a.base === "zocalo", (p) => { p.material = "nogal"; });
es("estilo vintage", ({ a }) => a.material === "nogal");
es("vuelve a la anterior", ({ r }) => r?.action === "undo");
es("la de antes", ({ r }) => r?.action === "undo");
es(["quiero cajones", "otro más"], drw(3, 0, 0, 0));
es(["quiero cajones en la tercera", "quita uno"], drw(0, 0, 1, 0));
es(["pon cajones en todas", "menos en la primera"], drw(0, 2, 2, 2));
es(["hazla más ancha", "más"], ({ a, b }) => a.width === b.width + 520);
es(["hazla más ancha", "un poco más"], ({ a, b }) => a.width > b.width + 260);
es(["Estilo nórdico", "pero en blanco"], ({ a }) => a.material === "melamina_blanca" && a.base === "patas");
es(["pon puertas en la segunda", "y en la cuarta"], doors(false, true, false, true));
es(["una balda más en la primera", "otra"], ({ a }) => col(a, 0).shelves.length === 5 && col(a, 1).shelves.length === 3);

/* filas, armario y barra de colgar */
es("cajones en los cuadrados de abajo", ({ a }) => all(a, (c) => nd(c.cells[0]) >= 1 && c.shelves[0] === 430));
es("tres cajones en la fila de abajo", ({ a }) => all(a, (c) => c.cells[0] === "drawer3"));
es("puertas en la fila de arriba", ({ a }) => all(a, (c) => lastCell(c) === "door" && c.cells[0] !== "door"));
es("los huecos de abajo con puertas", ({ a }) => all(a, (c) => c.cells[0] === "door"));
es("pon una barra de colgar", hasRail);
es("para colgar ropa", hasRail);
es("quita la barra", ({ a }) => a.columns.every((c) => !c.cells.some((x) => x.startsWith("rail"))), (p) => { p.columns[0].cells = ["rail", "open"]; p.columns[0].shelves = [1500]; });
es("un armario blanco de 2 metros", ({ a }) => a.material === "melamina_blanca" && a.width === 2000 && a.depth >= 580);
/* la frase de la captura: todos los huecos, también partiendo de la librería con puertas */
const everyCell = (re) => ({ a }) => all(a, (c) => c.cells.every((x) => re.test(x)));
es("cajones en todos los huecos", ({ a }) => all(a, (c) => c.cells.every((x) => x === "drawer")));
es("cajones en todos los huecos", ({ a }) => everyCell(/^drawer/)({ a }) && all(a, (c) => !c.door),
   (p) => p.columns.forEach((c) => { c.cells = ["door", "open", "open", "open"]; }));
es("un cajón en cada hueco", ({ a }) => all(a, (c) => c.cells.every((x) => x === "drawer")));
es("puertas en todos los huecos", everyCell(/^door$/));
es("cajones en todos los huecos de la primera columna", ({ a }) => col(a, 0).cells.every((x) => /^drawer/.test(x)) && col(a, 1).drawers === 0);
es("cajones en todos los huecos menos en la primera", ({ a }) => col(a, 0).drawers === 0 && col(a, 3).cells.every((x) => /^drawer/.test(x)));
es("cajones en todos los huecos de abajo", ({ a }) => all(a, (c) => /^drawer/.test(c.cells[0]) && c.cells[1] === "open"));
es(["quiero cajones", "en todos los huecos"], everyCell(/^drawer/));
en("drawers in every compartment", everyCell(/^drawer/));
en("a drawer in each cubby", ({ a }) => all(a, (c) => c.cells.every((x) => x === "drawer")));
es(["quiero cajones", "en los cuadrados de abajo"], ({ a }) => all(a, (c) => nd(c.cells[0]) >= 1));

/* piezas: tiradores, cajón interior y bandeja extraíble */
es("tiradores de latón", ({ a }) => a.handle === "bar_brass" && a.material === "roble");
es("ponle pomos", ({ a }) => a.handle === "knob");
es("sin tiradores", ({ a }) => a.handle === "push");
es("con apertura push", ({ a }) => a.handle === "push");
es("tiradores embutidos", ({ a }) => a.handle === "cup");
es("uñeros", ({ a }) => a.handle === "cup");
es("gola de aluminio", ({ a }) => a.handle === "profile");
es("tiradores negros", ({ a }) => a.handle === "bar" && a.material === "roble", (p) => { p.handle = "knob"; });
es("pomos negros", ({ a }) => a.handle === "knob" && a.material === "roble");
es("cambia los tiradores", ans(/pomo/));
es("un cajón interior en la segunda", ({ a }) => col(a, 1).cells.includes("door+drawer") && col(a, 0).drawers === 0);
es("tres cajones interiores en la primera", ({ a }) => col(a, 0).cells.includes("door+drawer3"));
es("dos cajones interiores", ({ a }) => a.columns.some((c) => c.cells.includes("door+drawer2")));
es("bandeja extraíble para zapatos", ({ a }) => col(a, 0).cells.includes("tray") && a.depth === 320);
es("zapatero extraíble en todas", ({ a }) => all(a, (c) => c.cells.includes("tray")));
es("blanca y con tiradores de latón", ({ a }) => a.material === "melamina_blanca" && a.handle === "bar_brass");
es(["quiero cajones", "sin tiradores"], ({ a }) => col(a, 0).drawers === 2 && a.handle === "push");

/* la conversación de la captura: tele, y la pregunta de si la aguanta */
es("crea el mueble para una cama", honest(/mesita|cabecero/));
es("cabecero con baldas", ({ a }) => a.height === 1000 && a.depth === 250 && a.columns.length === 3);
es(["pues para una tele", "puede aguantar una tele?"], ({ r, a }) => !!r?.ask && /kg/.test(r.ask) && a.height === 560);
es("¿soportaría una televisión grande?", ans(/kg/));

/* =================== ENGLISH =================== */
en("can it hold a TV on top?", ans(/kg/));
en("a headboard with shelves", ({ a }) => a.height === 1000 && a.depth === 250);
en("brass handles", ({ a }) => a.handle === "bar_brass");
en("knobs please", ({ a }) => a.handle === "knob");
en("handleless, push to open", ({ a }) => a.handle === "push");
en("recessed handles", ({ a }) => a.handle === "cup");
en("an inner drawer in the second column", ({ a }) => col(a, 1).cells.includes("door+drawer"));
en("three inner drawers in the first column", ({ a }) => col(a, 0).cells.includes("door+drawer3"));
en("a pull-out shoe rack", ({ a }) => col(a, 0).cells.includes("tray"));
en("change the handles", ans(/knob/));
en("drawers in the bottom row", ({ a }) => all(a, (c) => nd(c.cells[0]) >= 1));
en("doors on the top row", ({ a }) => all(a, (c) => lastCell(c) === "door" && c.cells[0] !== "door"));
en("add a clothes rail", hasRail);
en("bigger drawers", ({ a }) => col(a, 0).shelves[0] > 430, (p) => { p.columns[0].drawers = 2; });
en("make it 1.5 m wide", ({ a }) => a.width === 1500);
en("40 cm deep", ({ a }) => a.depth === 400);
en("fit it under the window, 90 cm", ({ a, b }) => a.height <= 900 && a.height >= 850 && a.width === b.width);
en("floor to ceiling, my ceiling is 2.5 m", ({ a }) => a.height >= 2400 && a.height <= 2490);
en("split it into 5", ({ a }) => a.columns.length === 5);
en("remove a column", ({ a }) => a.columns.length === 3);
en("make the middle one wider", ({ a, b }) => col(a, 1).width > col(b, 1).width && a.width === b.width);
en("no shelves in the third", ({ a }) => col(a, 2).shelves.length === 0 && col(a, 0).shelves.length === 3);
en("remove the top shelf", ({ a }) => all(a, (c) => c.shelves.length === 2 && Math.max(...c.shelves) < 1290));
en("6 levels", ({ a }) => all(a, (c) => c.shelves.length === 5));
en("drawers in all but the first", drw(0, 2, 2, 2));
en("a drawer in every column", ({ a }) => all(a, (c) => c.drawers === 1));
en("drawers only on the sides", drw(2, 0, 0, 2));
en("sliding doors", honest(/hinged/));
en("doors on the middle ones", doors(false, true, true, false));
en("alternate doors", doors(true, false, true, false));
en("wood colour", ({ a }) => a.material === "roble", (p) => { p.material = "melamina_blanca"; });
en("off-white", ({ a }) => a.material === "melamina_blanca");
en("dark oak", ({ a }) => a.material === "nogal");
en("in beech", honest(/birch|oak|walnut/));
en("solid wood", honest(/solid/));
en("matte black", ({ a }) => a.material === "melamina_negra");
en("tall legs", ({ a, b }) => a.base === "patas" && a.baseHeight > b.baseHeight);
en("standing on the floor", ({ a }) => a.base === "zocalo");
en("for comics", ({ a }) => a.depth === 280);
en("for DVDs", ({ a }) => a.depth === 200);
en("for the bathroom", ({ a }) => a.material === "melamina_blanca");
en("for the garage", ({ a }) => a.thickness === 22);
en("a room divider", ({ a }) => a.back === false);
en("a wardrobe", hasRail);
en("a bedside table", ({ a }) => a.width <= 500 && a.height <= 600 && a.columns.length === 1);
en("a sideboard", ({ a }) => a.height <= 900 && all(a, (c) => c.door));
en("for a 55 inch TV", ({ a }) => a.width >= 1400 && a.height <= 600);
en("a corner unit", honest(/corner/));
en("budget of 900 euros", ({ a }) => price(a) < BASE_PRICE);
en("as cheap as possible", ({ a }) => a.material === "melamina_blanca" && !a.back && a.thickness === 16);
en("why is it so expensive?", ans(/€/));
en("any discounts?", ans(/discount|price/));
en("do you ship to the Canary Islands?", ans(/mainland/));
en("can I return it?", ans(/made to/));
en("does it come assembled?", ans(/minutes/));
en("do I need tools?", ans(/Allen|key/));
en("what's the warranty?", ans(/3 years/));
en("what is it made of?", ans(/oak/i));
en("is it sustainable?", ans(/%/));
en("how do I anchor it to the wall?", ans(/anti-tip|wall/));
en("can a shelf hold a TV?", ans(/kg/));
en("I don't like it", ans(/.+/));
en("surprise me", ans(/.+/));
en("make it modern", ({ a }) => a.material === "melamina_blanca");
en("go back to the previous one", ({ r }) => r?.action === "undo");
en(["I want drawers", "another one"], drw(3, 0, 0, 0));
en(["add drawers to every column", "except the first"], drw(0, 2, 2, 2));
en(["make it wider", "more"], ({ a, b }) => a.width === b.width + 520);
en(["I want drawers in the third", "remove one"], drw(0, 0, 1, 0));
en(["Nordic style", "but in white"], ({ a }) => a.material === "melamina_blanca" && a.base === "patas");

console.log(`\ncorpus: ${n} casos · ${fails.length} fallos\n`);
fails.forEach((f) => console.log("  ✗ " + f));
process.exit(fails.length ? 1 : 0);
