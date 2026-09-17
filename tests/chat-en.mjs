/* ============================================================
   Banco de pruebas del chat en inglés.
   Además de cada frase, comprueba que en inglés no se cuela ninguna
   palabra en español y que cada sugerencia en inglés funciona.
   node tests/chat-en.mjs   → fallos; código 1 si hay alguno
   ============================================================ */
import { DEFAULT, normalize, build } from "../lib/model.js";
import { cutlist, nest, quote } from "../lib/pricing.js";
import { parseIntentEN, fallbackEN, ALL_SUGGESTIONS_EN } from "../lib/intent-en.js";

const base = () => normalize(DEFAULT());
const price = (p) => { const g = build(p); return quote(p, g, nest(cutlist(g))).gross; };
const SPANISH = /\b(ancho|alto|fondo|baldas?|cajón|cajones|columnas?|puertas?|trasera|patas|zócalo|más|menos|preparada|huecos?|hazla|tablero|precio|pasa|suspendida|cuadrícula|balda|abajo|arriba|filas)\b/i;
const fails = [];
let n = 0;
const texts = (r) => !r ? [] : r.ask ? [r.ask, ...(r.suggest || [])] : [...(r.changes || []), ...(r.notes || [])];
const describe = (r) => !r ? "unresolved" : r.action ? `action ${r.action}` : r.ask ? `reply «${r.ask.slice(0, 60)}…»` : (r.changes || []).join(", ");
function t(cmd, expect, setup) {
  n++;
  const before = base();
  if (setup) { setup(before); Object.assign(before, normalize(before)); }
  let res, ok = false, err = "";
  try {
    res = parseIntentEN(cmd, before);
    const after = res && res.params ? normalize(res.params) : before;
    ok = !!expect({ a: after, b: before, r: res });
  } catch (e) { err = ` [exception: ${e.message}]`; }
  if (!ok) fails.push(`«${cmd}» → ${describe(res)}${err}`);
  const leak = texts(res).find((x) => SPANISH.test(x));
  if (leak) fails.push(`«${cmd}» leaks Spanish: «${leak}»`);
}
const ask = (re) => ({ r }) => !!(r && r.ask && re.test(r.ask));
const col = (a, i) => a.columns[i];
const avg = (xs) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const allCols = (a, f) => a.columns.every(f);

/* whole-design commands */
t("delete this unit", ({ r }) => r?.action === "reset");
t("start over", ({ r }) => r?.action === "reset");
t("undo that", ({ r }) => r?.action === "undo");
t("go back", ({ r }) => r?.action === "undo");
t("hello", ask(/Hi/));
t("what can you do?", ask(/size/));
t("thanks", ask(/.+/));
/* questions with real data */
t("how much does it cost?", ask(/€/));
t("how heavy is it?", ask(/kg/));
t("how many pieces?", ask(/pieces/));
t("can it hold books?", ask(/kg/));
t("how long does delivery take?", ask(/days/));
t("what material do you recommend?", ask(/oak|birch|walnut/));
t("is it hard to assemble?", ask(/minutes/));
/* unsupported, answered honestly */
t("make it grey", ({ r }) => !!r?.ask && /white/.test(r.ask) && r.suggest?.length > 0);
t("can it have glass?", ask(/glass/));
t("with led lights", ask(/[Ll]ighting/));
t("I want a desk", ask(/shelving/));
t("add wheels", ask(/[Ww]heels/));
/* sizes */
t("1.80 m wide", ({ a }) => a.width === 1800);
t("2.10 m tall", ({ a }) => a.height === 2100);
t("width 1.5 m", ({ a }) => a.width === 1500);
t("90 cm high", ({ a }) => a.height === 900);
t("make it smaller", ({ a, b }) => a.width < b.width && a.height < b.height);
t("bigger", ({ a, b }) => a.width > b.width && a.height > b.height);
t("more compact", ({ a, b }) => a.width < b.width && a.height < b.height);
t("fit it into a 180 cm gap", ({ a }) => a.width === 1790);
t("make it 1,800 mm wide", ({ a }) => a.width === 1800);
/* one column */
t("make the first column wider", ({ a, b }) => col(a, 0).width > col(b, 0).width && a.width === b.width);
t("make the middle column narrower", ({ a, b }) => col(a, 1).width < col(b, 1).width && a.width === b.width);
t("make the first column 80 cm wide", ({ a, b }) => Math.abs(col(a, 0).width - 800) <= 2 && a.width === b.width);
t("equal columns", ({ a }) => Math.max(...a.columns.map((c) => c.width)) - Math.min(...a.columns.map((c) => c.width)) <= 2, (b) => { b.columns[0].width = 900; });
t("doors on the sides", ({ a }) => col(a, 0).door && col(a, 3).door && !col(a, 1).door && !col(a, 2).door);
/* shelves */
t("a shelf at 1 m", ({ a }) => allCols(a, (c) => c.shelves.some((v) => Math.abs(v - 872) <= 32)));
t("raise the shelves", ({ a, b }) => avg(col(a, 0).shelves) > avg(col(b, 0).shelves));
t("lower the shelves", ({ a, b }) => avg(col(a, 0).shelves) < avg(col(b, 0).shelves));
t("shelves further apart", ({ a, b }) => col(a, 0).shelves.length === col(b, 0).shelves.length - 1);
t("shelves closer together", ({ a, b }) => col(a, 0).shelves.length === col(b, 0).shelves.length + 1);
t("5 rows", ({ a }) => allCols(a, (c) => c.shelves.length === 4));
t("3 by 4 grid", ({ a }) => a.columns.length === 3 && allCols(a, (c) => c.shelves.length === 3));
t("remove the shelves from the second", ({ a, b }) => col(a, 1).shelves.length === 0 && col(a, 0).shelves.length === col(b, 0).shelves.length);
t("shelves every 30 cm", ({ a }) => allCols(a, (c) => c.shelves.length >= 4 && c.shelves.every((v, i) => i === 0 || Math.abs(v - c.shelves[i - 1] - 300) <= 2)));
/* drawers */
t("no drawers", ({ a }) => allCols(a, (c) => c.drawers === 0), (b) => b.columns.forEach((c) => { c.drawers = 2; }));
t("drawers on the right", ({ a }) => col(a, 3).drawers === 2 && col(a, 0).drawers === 0);
t("3 drawers in each column", ({ a }) => allCols(a, (c) => c.drawers === 3));
t("more drawers", ({ a }) => col(a, 0).drawers === 1);
t("one drawer in all columns", ({ a }) => allCols(a, (c) => c.drawers === 1));
t("two drawers bottom left", ({ a }) => col(a, 0).drawers === 2 && col(a, 1).drawers === 0);
t("remove two drawers from the first", ({ a }) => col(a, 0).drawers === 1, (b) => b.columns.forEach((c) => { c.drawers = 3; }));
t("add three shelves to the second", ({ a, b }) => col(a, 1).shelves.length === col(b, 1).shelves.length + 3);
t("put two shelves", ({ a }) => allCols(a, (c) => c.shelves.length === 2));
/* base and legs */
t("taller legs", ({ a, b }) => a.base === "patas" && a.baseHeight > b.baseHeight && a.height === b.height);
t("15 cm legs", ({ a }) => a.base === "patas" && a.baseHeight === 150);
t("no legs", ({ a }) => a.base === "flotante");
t("down to the floor", ({ a }) => a.base === "zocalo");
/* styles */
t("Nordic style", ({ a }) => a.material === "abedul" && a.base === "patas");
t("industrial style", ({ a }) => a.material === "melamina_negra");
t("minimalist", ({ a }) => a.material === "melamina_blanca" && a.base === "zocalo");
t("make it elegant", ({ a }) => a.material === "nogal");
t("warmer", ({ a }) => a.material === "roble", (b) => { b.material = "melamina_blanca"; });
/* rooms and uses */
t("for the hallway", ({ a }) => a.depth === 300);
t("for the kitchen", ({ a }) => a.depth === 300);
t("for the bedroom", ({ a }) => a.depth === 450 && allCols(a, (c) => c.door));
t("for plants", ({ a }) => a.back === false);
t("low unit with drawers", ({ a }) => a.height === 900 && allCols(a, (c) => c.drawers >= 1));
t("make it for vinyl records", ({ a }) => a.depth === 340);
/* budget */
t("make it cheaper", ({ a, b }) => price(a) < price(b));
t("under €1000", ({ a }) => price(a) <= 1000);
t("that costs less than 1000 euros", ({ a }) => price(a) <= 1000);
/* combined and casual */
t("2 m wide, 1.8 m tall and in walnut", ({ a }) => a.width === 2000 && a.height === 1800 && a.material === "nogal");
t("white, no back panel and on legs", ({ a }) => a.material === "melamina_blanca" && !a.back && a.base === "patas", (b) => { b.base = "zocalo"; b.baseHeight = 80; });
t("4 columns of 50 cm", ({ a }) => a.columns.length === 4 && allCols(a, (c) => Math.abs(c.width - 500) <= 2));
t("I want doors", ({ a }) => allCols(a, (c) => c.door));
t("I don't want a back panel", ({ a }) => a.back === false);
t("2 metres wide", ({ a }) => a.width === 2000);
t("make it 2.4 meters wide and 35 centimetres deep", ({ a }) => a.width === 2400 && a.depth === 350);
t("how much is it?", ask(/€\d,\d{3}/));
t("MAKE IT WIDER", ({ a, b }) => a.width === b.width + 260);

/* conversation: each message applies to the previous result, with the last topic */
function conv(msgs, expect, setup) {
  n++;
  let p = base();
  if (setup) { setup(p); p = normalize(p); }
  let ctx = {}, res, ok = false, err = "";
  try {
    for (const m of msgs) {
      res = parseIntentEN(m, p, ctx);
      if (res && res.params) { p = normalize(res.params); ctx = { topic: res.topic }; }
    }
    ok = !!expect({ a: p, r: res });
  } catch (e) { err = ` [exception: ${e.message}]`; }
  if (!ok) fails.push(`«${msgs.join(" → ")}» → ${describe(res)}${err}`);
  const leak = [...texts(res), ...((res && res.suggest) || [])].find((x) => SPANISH.test(x));
  if (leak) fails.push(`«${msgs.join(" → ")}» leaks Spanish: «${leak}»`);
}
conv(["I want drawers", "in all the boxes"], ({ a }) => allCols(a, (c) => c.cells.every((x) => x.startsWith("drawer"))));
conv(["I want drawers"], ({ a, r }) => col(a, 0).drawers === 2 && /column 1/.test(r.changes.join(" ")) && r.suggest?.length === 2);
conv(["I want drawers", "move them to the right"], ({ a }) => col(a, 3).drawers === 2 && col(a, 0).drawers === 0);
conv(["add doors to the first column", "the third one too"], ({ a }) => col(a, 0).door && col(a, 2).door && !col(a, 1).door);
conv(["one more shelf in the second", "and in the fourth"], ({ a }) => col(a, 1).shelves.length === 4 && col(a, 3).shelves.length === 4 && col(a, 0).shelves.length === 3);
conv(["two drawers in every column"], ({ a, r }) => allCols(a, (c) => c.drawers === 2) && /every column/.test(r.changes.join(" ")));

/* not understood → suggestions, in English */
n++;
const fb = fallbackEN("blah blah");
if (!(fb.ask && fb.suggest?.length)) fails.push("fallback without suggestions");
if ([fb.ask, ...fb.suggest].some((x) => SPANISH.test(x))) fails.push(`fallback leaks Spanish: «${fb.ask}» ${fb.suggest.join(" | ")}`);

/* every English suggestion must work when tapped, and be in English */
for (const s of ALL_SUGGESTIONS_EN) {
  n++;
  if (SPANISH.test(s)) { fails.push(`suggestion not translated: «${s}»`); continue; }
  const r = parseIntentEN(s, base());
  const works = r && (r.params || r.action || (r.ask && !/couldn't turn that/.test(r.ask)));
  if (!works) fails.push(`suggestion «${s}» does nothing when tapped → ${describe(r)}`);
}

/* plinth height, not unit height */
t("make the plinth 10 cm", ({ a, b }) => a.base === "zocalo" && a.baseHeight === 100 && a.height === b.height);
t("lower plinth", ({ a, b }) => a.base === "zocalo" && a.baseHeight < 80 && a.height === b.height, (p) => { p.base = "zocalo"; p.baseHeight = 80; });

console.log(`\nchat EN: ${n} phrases · ${fails.length} failures\n`);
fails.forEach((f) => console.log("  ✗ " + f));
process.exit(fails.length ? 1 : 0);
