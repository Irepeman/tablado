/* ============================================================
   Banco de pruebas del registro: lo que se guarda de una reserva y de
   una frase que el chat no entendió. Solo la parte pura, la que no
   depende del navegador.
   node tests/record.mjs
   ============================================================ */
import { addEntry, summary, toCsv, validate } from "../lib/record.js";
import { PRESETS, normalize } from "../lib/model.js";

const fails = [];
let n = 0;
const t = (name, ok) => { n++; if (!ok) fails.push(name); };

/* una entrada nueva va la primera y lleva su fecha */
{
  const a = addEntry([], { ref: "A" });
  const b = addEntry(a, { ref: "B" });
  t("la última reserva va primero", b[0].ref === "B" && b[1].ref === "A");
  t("cada entrada lleva fecha", !Number.isNaN(Date.parse(b[0].at)));
  t("no se guarda sin límite", addEntry(Array.from({ length: 500 }, (_, i) => ({ ref: i })), { ref: "X" }, 200).length === 200);
  t("una lista rota no rompe nada", addEntry(null, { ref: "A" }).length === 1);
}

/* el resumen del mueble: lo que un taller lee de un vistazo */
{
  const p = PRESETS.armario(normalize({}));
  const s = summary(p);
  t("el resumen trae las medidas", s.includes("1800×2200×600 mm"));
  t("el resumen trae el material", s.includes("roble"));
  t("el resumen cuenta puertas y cajones", /puertas/.test(s) && /cajones/.test(s) && /barras/.test(s));
  t("sin mueble no revienta", summary(null) === "" && summary({}) === "");
}

/* una reserva sirve si se puede contestar */
{
  t("hace falta nombre", !validate({ name: "", contact: "a@b.com" }).ok);
  t("vale un email", validate({ name: "Ana", contact: "ana@correo.es" }).ok);
  t("vale un teléfono", validate({ name: "Ana", contact: "612 345 678" }).ok);
  t("no vale cualquier cosa", !validate({ name: "Ana", contact: "hola" }).ok);
  t("dice qué campo falla", validate({ name: "", contact: "hola" }).bad.name === true);
}

/* CSV: punto y coma, comillas escapadas, una fila por reserva */
{
  const csv = toCsv([{ a: 'di "hola"', b: 2 }, { a: "x", b: 3 }], ["a", "b"]);
  const lines = csv.split("\n");
  t("el CSV tiene cabecera y filas", lines.length === 3 && lines[0] === '"a";"b"');
  t("las comillas se escapan", lines[1].includes('""hola""'));
  t("un campo que falta sale vacío", toCsv([{ a: 1 }], ["a", "b"]).split("\n")[1] === '"1";""');
}

console.log(`\nregistro: ${n} comprobaciones · ${fails.length} fallos\n`);
fails.forEach((f) => console.log("  ✗ " + f));
process.exit(fails.length ? 1 : 0);
