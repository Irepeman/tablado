/* ============================================================
   EL REGISTRO
   Lo único que guardamos: las reservas que alguien deja y las frases
   que el chat no ha entendido. Vive en el navegador de quien lo escribe
   (localStorage), porque no tenemos servidor ni cuentas y no queremos
   tenerlos todavía. El modo fundador lo lee y lo exporta en CSV.

   Nunca guardamos datos de tarjeta ni dirección postal: no los pedimos.
   ============================================================ */

export const KEYS = { book: "cutwise-reservas", miss: "cutwise-frases" };
const MAX = 200;                      // suficiente para los primeros clientes, y no llena el navegador

/* ---------- parte pura: se prueba en Node ---------- */

/* añade al principio y recorta; cada entrada lleva su fecha */
export function addEntry(list, entry, max = MAX) {
  const safe = Array.isArray(list) ? list : [];
  return [{ at: new Date().toISOString(), ...entry }, ...safe].slice(0, max);
}

/* resumen de un diseño: lo que un taller necesita leer de un vistazo */
export function summary(p) {
  if (!p || !Array.isArray(p.columns)) return "";
  const cells = p.columns.flatMap((c) => c.cells || []);
  const n = (f) => cells.filter(f).length;
  const bits = [
    `${Math.round(p.width)}×${Math.round(p.height)}×${Math.round(p.depth)} mm`,
    `${p.material} ${p.thickness} mm`,
    `${p.columns.length} col`,
  ];
  const doors = n((x) => x.includes("door")), drawers = n((x) => x.startsWith("drawer")), rails = n((x) => x.startsWith("rail"));
  if (doors) bits.push(`${doors} puertas`);
  if (drawers) bits.push(`${drawers} cajones`);
  if (rails) bits.push(`${rails} barras`);
  return bits.join(" · ");
}

const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
export function toCsv(rows, cols) {
  return [cols.map(cell).join(";"), ...rows.map((r) => cols.map((c) => cell(r[c])).join(";"))].join("\n");
}

/* una reserva solo cuenta si se puede contestar y se sabe qué mueble es */
export function validate(form) {
  const bad = {};
  if (!String(form.name || "").trim()) bad.name = true;
  const mail = String(form.contact || "").trim();
  const phone = mail.replace(/[\s.+-]/g, "");
  if (!(/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(mail) || /^\d{9,15}$/.test(phone))) bad.contact = true;
  return { ok: !Object.keys(bad).length, bad };
}

/* ---------- navegador ---------- */
const read = (key) => {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
};
const write = (key, list) => {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* modo privado: no pasa nada */ }
  return list;
};

export const reservations = () => read(KEYS.book);
export const misses = () => read(KEYS.miss);

/* una reserva: el mueble entero, las medidas del hueco y cómo se tomaron */
export function saveReservation({ params, form }) {
  const entry = {
    ref: "CWS-" + Date.now().toString(36).slice(-6).toUpperCase(),
    name: String(form.name || "").trim(),
    contact: String(form.contact || "").trim(),
    gap: String(form.gap || "").trim(),
    how: form.how || "",
    note: String(form.note || "").trim().slice(0, 300),
    piece: summary(params),
    params: JSON.stringify(params),
  };
  write(KEYS.book, addEntry(reservations(), entry));
  return entry;
}

/* una frase que el motor local no convirtió en un cambio: o no la entendió
   («none»), o la entendió y contestó que todavía no sabe hacerlo («ask») */
export function logMiss(text, params, lang = "es", kind = "none") {
  const t = String(text || "").trim().slice(0, 200);
  if (!t) return null;
  const entry = { text: t, lang, kind, piece: summary(params) };
  write(KEYS.miss, addEntry(misses(), entry));
  return entry;
}

export const clearAll = () => { write(KEYS.book, []); write(KEYS.miss, []); };

export const reservationsCsv = () => toCsv(reservations(), ["at", "ref", "name", "contact", "gap", "how", "note", "piece"]);
export const missesCsv = () => toCsv(misses(), ["at", "lang", "kind", "text", "piece"]);

/* texto que el cliente puede copiar o mandarnos por email */
export function asText(entry) {
  return [
    `Reserva ${entry.ref}`,
    `Mueble: ${entry.piece}`,
    entry.gap ? `Hueco: ${entry.gap}` : null,
    entry.how ? `Medido: ${entry.how}` : null,
    `Nombre: ${entry.name}`,
    `Contacto: ${entry.contact}`,
    entry.note ? `Nota: ${entry.note}` : null,
  ].filter(Boolean).join("\n");
}
