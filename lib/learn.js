/* ============================================================
   EL BUCLE QUE APRENDE
   Lo que el producto aprende de quien lo usa, y hasta dónde puede aprender.

   De dónde sale: el registro de frases que el chat no resolvió, más las
   frases que el cliente deshizo justo después (las entendió mal, pero con
   tanta seguridad que nadie se habría enterado).

   Qué se aprende: UNA PALABRA POR OTRA. Nada más. «entrepaño» pasa a ser
   «balda» antes de que el motor lea la frase, y a partir de ahí todo ocurre
   como siempre: las mismas reglas, los mismos límites, el mismo precio.
   Una línea aprendida no puede traer un número, ni una frase, ni una orden.

   Quién decide: una persona. Ninguna palabra entra sola. Y la máquina pone
   su propia condición encima de la nuestra: solo deja guardar la palabra si
   con ella la frase que falló pasa a entenderse. Si no arregla nada, no entra.
   ============================================================ */

import VOCAB from "./vocab.js";

export const LEARN_KEY = "cutwise-aprendido";
const MAX_RULES = 200;

/* ---------- parte pura: se prueba en Node ---------- */

/* una palabra desnuda: sin tildes, sin mayúsculas, sin nada alrededor */
export const word = (s) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/* la barrera de lo que se puede aprender: una sola palabra, solo letras.
   Así una línea aprendida no puede colar una medida ni una orden dentro. */
export const isWord = (s) => /^[a-z]{2,24}$/.test(word(s));

export function validRule(from, to) {
  const f = word(from), t = word(to);
  if (!isWord(f) || !isWord(t)) return null;
  if (f === t) return null;
  return { from: f, to: t };
}

/* las aprobadas y commiteadas, más las que la fundadora acaba de aprobar
   en su navegador; si una palabra está en las dos, manda la nueva */
export function allRules(local = []) {
  const map = new Map();
  for (const r of [...VOCAB, ...local]) {
    const v = validRule(r.from, r.to);
    if (v) map.set(v.from, { ...r, ...v });
  }
  return [...map.values()];
}

/* el plural se devuelve como vino, y en el castellano de la palabra nueva:
   «entrepaños» → «baldas» (vocal, +s), «anaqueles» → «baldas» (no «baldaes») */
const plural = (w) => (/[aeiou]$/.test(w) ? w + "s" : w + "es");
function lookup(token, byWord) {
  const w = word(token);
  if (byWord.has(w)) return { to: byWord.get(w).to, from: w };
  for (const cut of ["es", "s"]) {
    if (w.length > cut.length + 2 && w.endsWith(cut)) {
      const stem = w.slice(0, -cut.length);
      if (byWord.has(stem)) return { to: plural(byWord.get(stem).to), from: stem };
    }
  }
  return null;
}

/* cambia las palabras aprendidas y dice cuáles ha cambiado.
   Se hace ANTES de que el motor lea la frase, y una sola vez. */
export function rewrite(text, rules = allRules()) {
  const byWord = new Map(rules.map((r) => [r.from, r]));
  const used = [];
  const out = String(text || "").replace(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g, (tok) => {
    const hit = lookup(tok, byWord);
    if (!hit) return tok;
    used.push({ from: tok, to: hit.to });
    return hit.to;
  });
  return { text: out, used };
}

/* la condición de la máquina: la palabra solo se guarda si con ella la frase
   que falló pasa a entenderse. `parse` es la del motor, que se pasa desde fuera
   para que este archivo no sepa nada del chat. */
export function fixes(phrase, rule, parse) {
  const v = validRule(rule.from, rule.to);
  if (!v) return false;
  const before = parse(String(phrase || ""));
  if (before) return false;                       // si ya se entendía, no hay nada que aprender
  return !!parse(rewrite(phrase, [v]).text);
}

export function addRule(list, rule, max = MAX_RULES) {
  const v = validRule(rule.from, rule.to);
  if (!v) return list;
  const rest = (Array.isArray(list) ? list : []).filter((r) => word(r.from) !== v.from);
  return [{ at: new Date().toISOString().slice(0, 10), ...rule, ...v }, ...rest].slice(0, max);
}

export const dropRule = (list, from) =>
  (Array.isArray(list) ? list : []).filter((r) => word(r.from) !== word(from));

/* lo que se pega en lib/vocab.js para que deje de vivir en un navegador */
export const asVocabSource = (list) =>
  list.map((r) => `  { from: ${JSON.stringify(word(r.from))}, to: ${JSON.stringify(word(r.to))}, at: ${JSON.stringify(r.at || "")}, why: ${JSON.stringify(r.why || "")} },`).join("\n");

/* ---------- navegador ---------- */

export function localRules() {
  try { return JSON.parse(localStorage.getItem(LEARN_KEY) || "[]"); } catch { return []; }
}
function writeLocal(list) {
  try { localStorage.setItem(LEARN_KEY, JSON.stringify(list)); } catch { /* modo privado */ }
  return list;
}
export const rules = () => allRules(localRules());

/* aprobar: la persona ya ha dicho que sí; aquí comprueba la máquina */
export function approve({ phrase, from, to, why }, parse) {
  const v = validRule(from, to);
  if (!v) return { ok: false, reason: "palabra" };
  if (!fixes(phrase, v, parse)) return { ok: false, reason: "no-arregla" };
  writeLocal(addRule(localRules(), { ...v, why: why || phrase }));
  return { ok: true, rule: v };
}
export const forget = (from) => writeLocal(dropRule(localRules(), from));
export const clearLearned = () => writeLocal([]);
