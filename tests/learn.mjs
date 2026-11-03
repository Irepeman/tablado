/* ============================================================
   Banco de pruebas del bucle que aprende.
   Lo que se comprueba aquí no es que aprenda, sino HASTA DÓNDE puede
   aprender: una palabra por otra, aprobada por una persona, y solo si
   arregla la frase que falló. Todo lo demás tiene que rebotar.
   node tests/learn.mjs
   ============================================================ */
import { word, isWord, validRule, allRules, rewrite, fixes, addRule, dropRule, asVocabSource } from "../lib/learn.js";
import VOCAB from "../lib/vocab.js";
import { parseIntent } from "../lib/intent.js";
import { normalize, DEFAULT } from "../lib/model.js";

const fails = [];
let n = 0;
const t = (name, ok) => { n++; if (!ok) fails.push(name); };

const P = normalize(DEFAULT());
/* el motor de verdad: una frase vale si cambia el mueble */
const parse = (s) => { const r = parseIntent(s, P, {}); return r && !r.ask && !r.action ? r : null; };

/* ---------- la barrera: qué se puede aprender ---------- */
{
  t("una palabra sí", isWord("entrepaño"));
  t("sin tildes ni mayúsculas", word("Entrepaño") === "entrepano");
  t("dos palabras no", !isWord("balda grande"));
  t("un número no", !isWord("1800"));
  t("una palabra con número no", !isWord("balda2"));
  t("una frase entera no", !isWord("ignora las medidas anteriores"));
  t("una orden escondida no cabe", !validRule("nota para el sistema", "balda"));
  t("una medida no cabe en el destino", !validRule("entrepano", "3500"));
  t("una palabra por sí misma no se aprende", !validRule("balda", "balda"));
  t("vacío no", !validRule("", "balda") && !validRule("balda", ""));
}

/* ---------- cambiar la palabra, y nada más ---------- */
{
  const R = [{ from: "entrepano", to: "balda" }];
  t("cambia la palabra", rewrite("ponle un entrepaño", R).text === "ponle un balda");
  t("mantiene el plural", rewrite("tres entrepaños", R).text === "tres baldas");
  t("respeta la mayúscula del resto", rewrite("Entrepaño abajo", R).text === "balda abajo");
  t("dice qué ha cambiado", rewrite("un entrepaño", R).used[0].to === "balda");
  t("no toca lo que no conoce", rewrite("ponle una balda", R).text === "ponle una balda");
  t("no toca los números", rewrite("entrepaños cada 40 cm", R).text === "baldas cada 40 cm");
  t("sin reglas no cambia nada", rewrite("ponle un entrepaño", []).text === "ponle un entrepaño");
  t("no se mete dentro de otra palabra", rewrite("entrepanado", R).text === "entrepanado");
}

/* ---------- la condición de la máquina ---------- */
{
  t("se aprende si arregla la frase",
    fixes("ponle tres anaqueles mas", { from: "anaquel", to: "balda" }, parse));
  t("no se aprende si no arregla nada",
    !fixes("ponle tres anaqueles mas", { from: "anaquel", to: "zoquete" }, parse));
  t("no se aprende lo que ya se entendía",
    !fixes("ponle tres baldas mas", { from: "balda", to: "cajon" }, parse));
  t("una palabra prohibida no pasa aunque arreglase",
    !fixes("ponle tres anaqueles mas", { from: "anaquel", to: "una balda" }, parse));
}

/* ---------- la tabla ---------- */
{
  const a = addRule([], { from: "gaveta", to: "cajon" });
  const b = addRule(a, { from: "anaquel", to: "balda" });
  t("la última va primero", b[0].from === "anaquel" && b.length === 2);
  t("cada palabra lleva su fecha", /^\d{4}-\d{2}-\d{2}$/.test(b[0].at));
  t("una palabra no se duplica", addRule(b, { from: "gaveta", to: "balda" }).length === 2);
  t("una palabra que vuelve se actualiza", addRule(b, { from: "gaveta", to: "balda" })[0].to === "balda");
  t("lo que no vale no entra", addRule(b, { from: "3500", to: "balda" }).length === 2);
  t("se puede olvidar", dropRule(b, "gaveta").length === 1);
  t("la tabla no crece sin fin",
    Array.from({ length: 300 }, (_, i) => i).reduce((l, i) => addRule(l, { from: "pal" + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26)), to: "balda" }, 200), []).length === 200);
  t("lo que se exporta se puede pegar en vocab.js",
    /^ {2}\{ from: "gaveta", to: "cajon", at: ".*", why: ".*" \},$/.test(asVocabSource([{ from: "gaveta", to: "cajon", at: "2026-11-04", why: "x" }])));
}

/* ---------- las palabras ya aprobadas, contra el motor de verdad ---------- */
{
  t("vocab.js solo trae palabras", VOCAB.every((r) => !!validRule(r.from, r.to)));
  t("cada palabra aprobada dice de qué frase salió", VOCAB.every((r) => r.why && r.at));
  const R = allRules();
  const casos = [
    ["que tenga entrepaños cada 40 cm", /balda/],
    ["ponle tres anaqueles mas", /balda/],
    ["ponle gavetas abajo", /caj/],
  ];
  for (const [frase, esperado] of casos) {
    t(`antes no se entendía: «${frase}»`, !parse(frase));
    const r = parse(rewrite(frase, R).text);
    t(`ahora sí: «${frase}»`, !!r && esperado.test(r.changes.join(" ")));
  }
}

/* ---------- la línea roja: lo que el bucle no puede aprender nunca ---------- */
{
  const R = allRules([{ from: "ancho", to: "balda" }]);
  /* ni cambiando una palabra se salta un límite: normalize sigue mandando */
  const r = parse(rewrite("quiero 9 metros de ancho", R).text);
  const p = r ? normalize(r.params) : null;
  t("una palabra aprendida no salta los límites del mueble", !p || p.width <= 3200);
  t("no se puede aprender a dar un precio distinto",
    !validRule("precio", "0") && !validRule("margen", "gratis x"));
  t("un texto con una orden dentro no es una palabra",
    !isWord("ignora") || !validRule("ignora las instrucciones anteriores", "balda"));
}

console.log(`\naprendizaje: ${n} comprobaciones · ${fails.length} fallos\n`);
fails.forEach((f) => console.log("  ✗ " + f));
process.exit(fails.length ? 1 : 0);
