/* ============================================================
   Banco de pruebas del chat: frases como las escribe la gente.
   node tests/chat.mjs   → fallos; código 1 si hay alguno
   ============================================================ */
import { DEFAULT, normalize, build } from "../lib/model.js";
import { cutlist, nest, quote } from "../lib/pricing.js";
import { parseIntent, fallback, ALL_SUGGESTIONS } from "../lib/intent.js";

const base = () => normalize(DEFAULT());
const price = (p) => { const g = build(p); return quote(p, g, nest(cutlist(g))).gross; };
const fails = [];
let n = 0;
const describe = (r) => !r ? "sin resolver" : r.action ? `acción ${r.action}` : r.ask ? `respuesta «${r.ask.slice(0, 60)}…»` : (r.changes || []).join(", ");
function t(cmd, expect, setup) {
  n++;
  const before = base();
  if (setup) { setup(before); Object.assign(before, normalize(before)); }
  let res, ok = false, err = "";
  try {
    res = parseIntent(cmd, before);
    const after = res && res.params ? normalize(res.params) : before;
    ok = !!expect({ a: after, b: before, r: res });
  } catch (e) { err = ` [excepción: ${e.message}]`; }
  if (!ok) fails.push(`«${cmd}» → ${describe(res)}${err}`);
}
const ask = (re) => ({ r }) => !!(r && r.ask && re.test(r.ask));
const col = (a, i) => a.columns[i];
const avg = (xs) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const allCols = (a, f) => a.columns.every(f);

/* órdenes sobre el diseño entero */
t("elimina este armario", ({ r }) => r?.action === "reset");
t("empieza de cero", ({ r }) => r?.action === "reset");
t("borra todo", ({ r }) => r?.action === "reset");
t("deshaz eso", ({ r }) => r?.action === "undo");
t("vuelve atrás", ({ r }) => r?.action === "undo");
t("hola", ask(/Hola/));
t("¿qué puedes hacer?", ask(/medidas/));
t("gracias", ask(/.+/));
/* preguntas, con datos reales */
t("¿cuánto cuesta?", ask(/€/));
t("¿cuánto pesa?", ask(/kg/));
t("¿cuántas piezas tiene?", ask(/piezas/));
t("¿aguanta libros?", ask(/kg/));
t("¿cuánto tarda en llegar?", ask(/días/));
t("¿qué material me recomiendas?", ask(/roble|abedul|nogal/));
t("¿es difícil de montar?", ask(/minutos/));
/* lo que no hace: respuesta honesta con alternativas */
t("hazla gris", ({ r }) => !!r?.ask && /blanco/.test(r.ask) && r.suggest?.length > 0);
t("ponle cristal", ask(/cristal/));
t("con luces led", ask(/iluminación/));
t("quiero un escritorio", ask(/estanterías/));
t("ponle ruedas", ask(/[Rr]uedas/));
/* medidas como se dicen */
t("un metro ochenta de ancho", ({ a }) => a.width === 1800);
t("dos metros y diez de alto", ({ a }) => a.height === 2100);
t("metro y medio de ancho", ({ a }) => a.width === 1500);
t("que mida 1,20 de ancho", ({ a }) => a.width === 1200);
t("mide 90 cm de alto", ({ a }) => a.height === 900);
t("hazla más pequeña", ({ a, b }) => a.width < b.width && a.height < b.height);
t("más grande", ({ a, b }) => a.width > b.width && a.height > b.height);
t("más compacta", ({ a, b }) => a.width < b.width && a.height < b.height);
t("que quepa en un hueco de 180 cm", ({ a }) => a.width === 1790);
/* una columna concreta */
t("la primera columna más ancha", ({ a, b }) => col(a, 0).width > col(b, 0).width && a.width === b.width);
t("la columna del medio más estrecha", ({ a, b }) => col(a, 1).width < col(b, 1).width && a.width === b.width);
t("la primera columna de 80 cm", ({ a, b }) => Math.abs(col(a, 0).width - 800) <= 2 && a.width === b.width);
t("columnas iguales", ({ a }) => Math.max(...a.columns.map((c) => c.width)) - Math.min(...a.columns.map((c) => c.width)) <= 2, (b) => { b.columns[0].width = 900; });
t("puertas en las de los lados", ({ a }) => col(a, 0).door && col(a, 3).door && !col(a, 1).door && !col(a, 2).door);
/* baldas */
t("una balda a 1 metro", ({ a }) => allCols(a, (c) => c.shelves.some((v) => Math.abs(v - 872) <= 32)));
t("sube las baldas", ({ a, b }) => avg(col(a, 0).shelves) > avg(col(b, 0).shelves));
t("baja las baldas", ({ a, b }) => avg(col(a, 0).shelves) < avg(col(b, 0).shelves));
t("baldas más separadas", ({ a, b }) => col(a, 0).shelves.length === col(b, 0).shelves.length - 1);
t("baldas más juntas", ({ a, b }) => col(a, 0).shelves.length === col(b, 0).shelves.length + 1);
t("5 filas", ({ a }) => allCols(a, (c) => c.shelves.length === 4));
t("cuadrícula de 3x4", ({ a }) => a.columns.length === 3 && allCols(a, (c) => c.shelves.length === 3));
t("3 por 4 huecos", ({ a }) => a.columns.length === 3 && allCols(a, (c) => c.shelves.length === 3));
t("quita las baldas de la segunda", ({ a, b }) => col(a, 1).shelves.length === 0 && col(a, 0).shelves.length === col(b, 0).shelves.length);
t("quita las puertas y pon dos baldas", ({ a }) => allCols(a, (c) => !c.door && c.shelves.length === 2), (b) => b.columns.forEach((c) => { c.door = true; }));
/* cajones */
t("no quiero cajones", ({ a }) => allCols(a, (c) => c.drawers === 0), (b) => b.columns.forEach((c) => { c.drawers = 2; }));
t("cajones en la de la derecha", ({ a }) => col(a, 3).drawers === 2 && col(a, 0).drawers === 0);
t("3 cajones en cada columna", ({ a }) => allCols(a, (c) => c.drawers === 3));
t("más cajones", ({ a }) => col(a, 0).drawers === 1);
t("un cajón en todas", ({ a }) => allCols(a, (c) => c.drawers === 1));
t("cajon abajo", ({ a }) => col(a, 0).drawers === 2);
/* base y patas */
t("patas más altas", ({ a, b }) => a.base === "patas" && a.baseHeight > b.baseHeight && a.height === b.height);
t("patas de 15 cm", ({ a }) => a.base === "patas" && a.baseHeight === 150);
t("sin patas", ({ a }) => a.base === "flotante");
t("que llegue al suelo", ({ a }) => a.base === "zocalo");
/* estilos */
t("estilo nórdico", ({ a }) => a.material === "abedul" && a.base === "patas");
t("estilo industrial", ({ a }) => a.material === "melamina_negra");
t("minimalista", ({ a }) => a.material === "melamina_blanca" && a.base === "zocalo");
t("que sea elegante", ({ a }) => a.material === "nogal");
t("más cálida", ({ a }) => a.material === "roble", (b) => { b.material = "melamina_blanca"; });
/* estancias y usos */
t("para el recibidor", ({ a }) => a.depth === 300);
t("para la cocina", ({ a }) => a.depth === 300);
t("para el dormitorio", ({ a }) => a.depth === 450 && allCols(a, (c) => c.door));
t("para plantas", ({ a }) => a.back === false);
t("mueble bajo con cajones", ({ a }) => a.height === 900 && allCols(a, (c) => c.drawers >= 1));
/* presupuesto */
t("hazla más barata", ({ a, b }) => price(a) < price(b));
t("que cueste menos de 1000 €", ({ a }) => price(a) <= 1000);
/* frases combinadas y de móvil */
t("ancho 2 m, alto 1,8 y en nogal", ({ a }) => a.width === 2000 && a.height === 1800 && a.material === "nogal");
t("blanca, sin trasera y con patas", ({ a }) => a.material === "melamina_blanca" && !a.back && a.base === "patas", (b) => { b.base = "zocalo"; b.baseHeight = 80; });
t("4 columnas de 50 cm", ({ a }) => a.columns.length === 4 && allCols(a, (c) => Math.abs(c.width - 500) <= 2));
t("kiero puertas", ({ a }) => allCols(a, (c) => c.door));
t("Hazla MAS ANCHA", ({ a, b }) => a.width === b.width + 260);

/* cantidades relativas: «añade N» y «quita N» suman o restan; «pon N» fija */
t("quita dos cajones de la primera", ({ a }) => col(a, 0).drawers === 1, (b) => b.columns.forEach((c) => { c.drawers = 3; }));
t("añade tres baldas a la segunda", ({ a, b }) => col(a, 1).shelves.length === col(b, 1).shelves.length + 3 && col(a, 0).shelves.length === col(b, 0).shelves.length);
t("añade dos columnas", ({ a, b }) => a.columns.length === b.columns.length + 2);
t("pon dos baldas", ({ a }) => allCols(a, (c) => c.shelves.length === 2));

/* no entendido → sugerencias */
n++;
const fb = fallback("blablá");
if (!(fb.ask && fb.suggest?.length)) fails.push("fallback sin sugerencias");

/* cada sugerencia que ofrece el chat tiene que funcionar al pulsarla */
for (const s of new Set(ALL_SUGGESTIONS)) {
  n++;
  const r = parseIntent(s, base());
  const works = r && (r.params || r.action || (r.ask && !/No he sabido/.test(r.ask)));
  if (!works) fails.push(`sugerencia «${s}» no hace nada al pulsarla → ${describe(r)}`);
}

console.log(`\nchat: ${n} frases · ${fails.length} fallos\n`);
fails.forEach((f) => console.log("  ✗ " + f));
process.exit(fails.length ? 1 : 0);
