/* ============================================================
   LA RESPUESTA
   Lo que el cliente lee y lo que el mueble hace, en un solo sitio.

   Antes esto vivía dentro del componente del chat, así que la respuesta
   solo existía en un navegador: no se podía probar ni juzgar. Ahora el
   chat y el banco de pruebas llaman a la misma función, de modo que lo
   que juzgamos es la respuesta de verdad, palabra por palabra.

   answer() devuelve dos cosas separadas a propósito:
     said → el texto que sale por pantalla
     did  → lo que ha pasado con el mueble (medidas, precio, avisos)
   Un juez tiene que poder mirar las dos. Una respuesta puede sonar
   perfecta y haber dejado el mueble mal.
   ============================================================ */

import { normalize, build, validate, deepCopy } from "./model.js";
import { cutlist, nest, quote } from "./pricing.js";
import { parseIntent, fallback } from "./intent.js";
import { parseIntentEN, fallbackEN } from "./intent-en.js";
import { tr, num } from "./i18n.js";
import { rules as learnedRules, rewrite as applyLearned } from "./learn.js";

/* lee la frase; si el motor no la resuelve, prueba una sola vez con las
   palabras aprobadas y dice con cuáles la ha leído */
export function readWith(text, params, ctx = {}, lang = "es", learned = null) {
  const read = (t) => (lang === "en" ? parseIntentEN(t, params, ctx) : parseIntent(t, params, ctx));
  let res = read(text);
  if (res) return { res, readAs: null };
  const l = applyLearned(text, learned || learnedRules());
  if (l.used.length) {
    const r2 = read(l.text);
    if (r2 && !r2.ask) return { res: r2, readAs: l.used };
  }
  return { res: null, readAs: null };
}

/* el texto exacto que ve el cliente cuando el cambio se aplica.
   El orden importa: primero lo que ha cambiado, luego por qué, y al final
   lo que hemos tenido que corregir. El mensaje no puede contradecir el mueble. */
export function replyText(res, after, readAs = null, lang = "es") {
  const T = tr(lang);
  const warn = validate(after, build(after, lang), lang).find((f) => f.lvl === "warn");
  const bits = [res.changes.join(", ").replace(/^./, (c) => c.toUpperCase()) + "."];
  /* la nota es una frase aparte: empieza en mayúscula como cualquier otra */
  if (res.notes.length) bits.push(res.notes.join("; ").replace(/^./, (c) => c.toUpperCase()) + ".");
  const req = res.params;
  if (req.columns.length !== after.columns.length) bits.push(T.colsAdjusted(after.columns.length));
  for (const [k, lo, hi] of [["width", 400, 3200], ["height", 400, 2600], ["depth", 180, 600]]) {
    if (Math.abs(Math.round(req[k]) - after[k]) > 10) bits.push(T.dimAdjusted(T.dimNames[k], num(lo, lang), num(hi, lang), num(after[k], lang)));
  }
  const reqDr = req.columns.reduce((acc, c) => acc + (c.drawers || 0), 0);
  const aftDr = after.columns.reduce((acc, c) => acc + c.drawers, 0);
  if (aftDr < reqDr) bits.push(T.drawersAdjusted(aftDr));
  if (warn) bits.push(T.watch + warn.d.replace(/^./, (c) => c.toLowerCase()));
  if (readAs) bits.push(T.readAs(readAs.map((u) => `«${u.from}» = «${u.to}»`).join(", ")));
  return bits.join(" ");
}

/* una frase entera, de principio a fin, sin navegador.
   kind dice QUÉ clase de respuesta es, que es lo primero que mira un juez:
     change   → ha cambiado el mueble
     ask      → ha contestado sin cambiar nada
     blocked  → ha visto una orden dentro del texto y no ha tocado nada
     action   → deshacer o empezar de nuevo
     none     → no la ha entendido (sale la respuesta de reserva)  */
export function answer(text, params, lang = "es", opts = {}) {
  const before = normalize(deepCopy(params));
  const { res, readAs } = readWith(text, before, opts.ctx || {}, lang, opts.learned);
  const did = (p) => {
    const g = build(p, lang);
    return {
      width: p.width, height: p.height, depth: p.depth,
      material: p.material, thickness: p.thickness,
      columns: p.columns.map((c) => ({
        shelves: c.shelves.length,
        drawers: c.drawers,
        doors: c.cells.filter((x) => /door/.test(x)).length,
        rails: c.cells.filter((x) => /^rail/.test(x)).length,
      })),
      price: quote(p, g, nest(cutlist(g))).gross,
      warns: validate(p, g, lang).filter((w) => w.lvl === "warn").map((w) => w.d),
    };
  };

  if (!res) {
    const f = lang === "en" ? fallbackEN(text) : fallback(text);
    return { kind: "none", said: f.ask, changed: false, before: did(before), did: did(before), readAs: null };
  }
  if (res.action) {
    return { kind: "action", action: res.action, said: res.action === "undo" ? tr(lang).undone : tr(lang).resetDone,
             changed: true, before: did(before), did: did(before), readAs: null };
  }
  if (res.ask) {
    return { kind: res.blocked ? "blocked" : "ask", blocked: res.blocked || null, said: res.ask,
             changed: false, before: did(before), did: did(before), readAs: null };
  }
  const after = normalize(res.params);
  return { kind: "change", said: replyText(res, after, readAs, lang), changed: true,
           before: did(before), did: did(after), readAs: readAs && readAs.map((u) => `${u.from}=${u.to}`) };
}
