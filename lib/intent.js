/* ============================================================
   CAPA 1 — MOTOR DE INTENCIÓN LOCAL
   Corre en el navegador. Sin llamada de red, sin coste y sin espera.

   Devuelve una de estas formas:
     { params, changes, notes }   cambio en el diseño
     { action: "reset" | "undo" } orden sobre el diseño entero
     { ask, suggest? }            respuesta o pregunta, con sugerencias pulsables
     null                         no entendido → fallback() da sugerencias

   Cada frase que el chat debe entender está en tests/chat.mjs.
   ============================================================ */
import {
  MATERIALS, DRAWER_H, BACK_T, clamp, deepCopy, addColumn,
  redistribute, setShelfCount, spaceShelves, setDrawers, normalize, build, maxSpan,
  setCell, drawerType, drawersIn, addRail, PRESETS, isRail, cellClear, MIN_FRONT, canPlace, applyItem, setOwnDoor,
} from "./model.js";
import { cutlist, nest, quote, eur } from "./pricing.js";
import { STR, matName } from "./i18n.js";

const mm = (v) => Math.round(v).toLocaleString("es-ES");

/* Cada respuesta nueva se escribe en los dos idiomas aquí mismo; intent-en.js
   la busca en EN_TEXT. También se registra la primera frase (antes de «:»),
   que es la que se usa como nota. */
export const EN_TEXT = new Map();
const A = (es, en) => {
  EN_TEXT.set(es, en);
  const i = es.indexOf(":"), j = en.indexOf(":");
  if (i > 0 && j > 0) EN_TEXT.set(es.slice(0, i).toLowerCase(), en.slice(0, j).toLowerCase());
  return es;
};

export const norm = (t) =>
  t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?¡!]/g, " ")
    .replace(/\bq\b|\bk\b/g, "que").replace(/\bkiero\b/g, "quiero")
    .replace(/\bxq\b/g, "porque").replace(/\bpa\b|\bxa\b/g, "para")
    .replace(/\btb\b/g, "tambien")
    .replace(/\s+/g, " ").trim();

/* «un metro ochenta», «metro y medio», «dos metros y diez» → cifras */
const UNITS_W = { un: 1, uno: 1, una: 1, dos: 2, tres: 3 };
const TENS_W = { medio: 50, diez: 10, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50,
                 sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
function spokenLengths(s) {
  return s
    .replace(/(^|\s)(?:(un|uno|dos|tres)\s+)?metros?\s+(?:y\s+)?(medio|diez|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)\b/g,
      (_, lead, a, b) => `${lead}${a ? UNITS_W[a] : 1},${String(TENS_W[b]).padStart(2, "0")} m`)
    .replace(/(^|\s)(un|uno|dos|tres)\s+metros?\b/g, (_, lead, a) => `${lead}${UNITS_W[a]} m`)
    .replace(/\b(\d)\s+metros?\s+(?:y\s+)?(\d{1,2})\b(?!\s*(?:mm|cm|m\b|metros?))/g, (_, a, b) => `${a},${b.padStart(2, "0")} m`)
    .replace(/\b(\d+)\s+y\s+medio\b/g, "$1,5")
    .replace(/\b(\d+(?:,\d+)?)\s+metros?\b/g, "$1 m");
}

const WORDNUM = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
                  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };

/* "2,10 m" · "210 cm" · "2100" · "2.4m" → milímetros */
function parseLen(txt) {
  if (!txt) return null;
  const m = txt.match(/(\d+(?:[.,]\d+)?)\s*(mm|cm|m|metros?|centimetros?|milimetros?)?/);
  if (!m) return null;
  let v = parseFloat(m[1].replace(",", "."));
  const u = m[2] || "";
  if (/^m/.test(u) && !/^mm|^mil/.test(u)) v *= 1000;
  else if (/^c/.test(u)) v *= 10;
  else if (!u) { if (v < 10) v *= 1000; else if (v <= 400) v *= 10; }
  return Math.round(v);
}

function grab(s, words) {
  for (const w of words) {
    let m = s.match(new RegExp(w + "\\w*\\s*(?:de\\s*)?(\\d+(?:[.,]\\d+)?\\s*(?:mm|cm|m|metros?)?)"));
    if (m) return parseLen(m[1]);
    m = s.match(new RegExp("(\\d+(?:[.,]\\d+)?\\s*(?:mm|cm|m|metros?)?)\\s*(?:de\\s*)?" + w));
    if (m) return parseLen(m[1]);
  }
  return null;
}

function count(s, re) {
  const m = s.match(re);
  if (!m) return null;
  return /^\d+$/.test(m[1]) ? Number(m[1]) : (WORDNUM[m[1]] ?? null);
}

/* Negación y afirmación: "sin trasera", "no quiero que tenga fondo",
   "quítale las puertas" son la misma intención dicha de tres formas. */
const NEG = "(?:sin|no quiero|no queremos|no me|no lleva|no lleve|no tenga|no tiene|no pongas|no le pongas|no hace falta|quita|quitale|quitame|saca|sacale|elimina|borra|nada de|fuera|prescindir|olvidate)";
const POS = "(?:con|quiero|queremos|ponle|pon|poner|mete|metele|anade|anadele|agrega|dale|que tenga|que lleve|que haya|necesito|me gustaria|incluye)";
const SPAN = "(?:(?!\\by\\b|\\bcon\\b|\\bpero\\b)[^.;,]){0,34}";   // no cruza «y», «con», «pero»
const isNeg = (s, c) => new RegExp(NEG + SPAN + c).test(s);
const isPos = (s, c) => new RegExp(POS + "(?:(?!\\by\\b|\\bsin\\b|\\bpero\\b)[^.;,]){0,34}" + c).test(s);

/* «una balda más» es +1, no "exactamente 1". */
/* «añade N» / «quita N» suman o restan N; «pon N» fija la cantidad (lo resuelve count()). */
const NUMW = "(\\d+|un|una|uno|dos|tres|cuatro|cinco|seis)";
const toN = (w) => (/^\d+$/.test(w) ? Number(w) : WORDNUM[w] || 1);
function delta(s, pat) {
  const subN = s.match(new RegExp("(?:quita|quitale|saca|sacale|elimina|borra)\\w*\\s+" + NUMW + "\\s+" + pat));
  if (subN) return -toN(subN[1]);
  const addN = s.match(new RegExp("(?:anade|anadele|agrega|agregale|suma|sumale|mete|metele)\\w*\\s+" + NUMW + "\\s+" + pat));
  if (addN) return toN(addN[1]);
  const inc = new RegExp(pat + "s?\\s+(?:mas|extra|adicionales?)(?!\\s+(?:anch|estrech|grande|peque|alt|baj|fond|separad|junt))|(?:otra|otro|una?\\s+mas|uno\\s+mas)\\s+" + pat + "|mas\\s+" + pat + "s?");
  const dec = new RegExp(pat + "s?\\s+menos|menos\\s+" + pat + "s?|(?:quita|quitale|saca|sacale|elimina|borra)\\w*(?:(?!\\by\\b)[^.;,]){0,22}" + pat + "(?:es|s)?\\b");
  if (dec.test(s)) return -1;
  if (inc.test(s)) return 1;
  return null;
}

function whichCols(s, n) {
  const k = n.columns.length;
  const ex = s.match(/(?:\btod[oa]s\b|\bcada\b)[^.;]*?\b(?:menos|excepto|salvo|quitando)\s+(?:en\s+)?(.+)$/) ||
             s.match(/\b(?:excepto|salvo)\s+(?:en\s+)?(.+)$/);
  if (ex) {
    const out = whichCols(ex[1], n);
    if (out && out.length < k) return n.columns.map((_, i) => i).filter((i) => !out.includes(i));
  }
  if (/altern|intercalad|una si,? una no|\bla mitad\b(?! de)/.test(s) && k > 1) return n.columns.map((_, i) => i).filter((i) => i % 2 === 0);
  const ord = { primera: 0, segunda: 1, tercera: 2, cuarta: 3,
                quinta: 4, sexta: 5, septima: 6, octava: 7 };
  if (/\btodas\b|\btodos\b|\bcada\b|en general/.test(s)) return n.columns.map((_, i) => i);
  if (/(?:los|las de los) lados|laterales|extremos/.test(s) && k > 1) return [0, k - 1];
  if (/las del (?:centro|medio)|centrales|las de en medio/.test(s) && k > 2) return n.columns.map((_, i) => i).slice(1, -1);
  /* «el segundo cuadro», «el tercer hueco»: en masculino solo con sustantivo detrás */
  const mo = s.match(/\b(primer|primero|segundo|tercer|tercero|cuarto|quinto|sexto)\s+(?:cuadro|hueco|modulo|compartimento|espacio|bloque)/);
  const MASC = { primer: 0, primero: 0, segundo: 1, tercer: 2, tercero: 2, cuarto: 3, quinto: 4, sexto: 5 };
  if (mo && MASC[mo[1]] < k) return [MASC[mo[1]]];
  for (const w in ord) if (s.includes(w) && ord[w] < k) return [ord[w]];
  const m = s.match(/columna\s*(?:numero\s*)?(\d+)/);
  if (m) return [clamp(Number(m[1]) - 1, 0, k - 1)];
  if (/ultima|del final|a la derecha|\bderecha\b|\bderecho\b/.test(s)) return [k - 1];
  if (/a la izquierda|\bizquierda\b|\bizquierdo\b|del principio/.test(s)) return [0];
  if (/\bcentro\b|central|en medio|del medio/.test(s)) return [Math.floor((k - 1) / 2)];
  return null;
}

/* Cambia el ancho de UNA columna sin tocar el total: el resto absorbe la diferencia. */
function setColumnWidth(n, i, w) {
  const t = n.thickness, k = n.columns.length;
  const inner = n.width - (k + 1) * t;
  const target = clamp(w, 150, inner - 150 * (k - 1));
  const others = n.columns.filter((_, j) => j !== i);
  const osum = others.reduce((a, c) => a + c.width, 0) || 1;
  others.forEach((c) => { c.width = (c.width / osum) * (inner - target); });
  n.columns[i].width = target;
}

function priceOf(p) {
  const q = normalize(p);
  const g = build(q);
  return quote(q, g, nest(cutlist(g)));
}

/* Usos y estancias: aquí vive el conocimiento de oficio. Un LP mide 315 mm. */
const USES = [
  { re: /\bcds?\b|compact disc|discos compactos/, name: "CDs", apply: (n) => {
      n.depth = 180; n.columns.forEach((c) => spaceShelves(n, c, 170));
      return "fondo 180 mm y huecos de 170 mm"; } },
  { re: /\bdvds?\b|blu.?ray|videojuegos|peliculas/, name: "películas y videojuegos", apply: (n) => {
      n.depth = 200; n.columns.forEach((c) => spaceShelves(n, c, 220));
      return "fondo 200 mm y huecos de 220 mm"; } },
  { re: /\bbano\b|toallas|\baseo\b/, name: "el baño", apply: (n) => {
      n.material = "melamina_blanca"; n.depth = 300; n.columns.forEach((c) => spaceShelves(n, c, 300));
      return A("melamina blanca, que aguanta mejor la humedad que la chapa; no la pongas junto a la ducha",
               "white melamine, which handles humidity better than veneer; keep it away from the shower"); } },
  { re: /garaje|trastero|herramientas de|cargas? pesad/, name: "el garaje", apply: (n) => {
      n.thickness = 22; n.material = "melamina_blanca"; n.depth = 400;
      return A("tablero de 22 mm y 400 mm de fondo para cargas pesadas", "22 mm board and 400 mm deep for heavy loads"); } },
  { re: /separar ambientes|separador|divisor de ambientes|dividir (?:el )?(?:salon|espacio|habitacion)/, name: "separar ambientes", apply: (n) => {
      n.back = false; n.base = "zocalo"; n.baseHeight = 80;
      return A("sin trasera, para que se vea por los dos lados; conviene fijarla al suelo o al techo",
               "no back panel so it works from both sides; it should be fixed to the floor or ceiling"); } },
  { re: /cabecero|detras de la cama|encima de la cama|sobre la cama/, name: "cabecero", apply: (n) => {
      n.width = 1800; n.height = 1000; n.depth = 250; n.base = "zocalo"; n.baseHeight = 80; n.back = true;
      n.columns = Array.from({ length: 3 }, () => ({ width: 580, shelves: [], cells: ["open"] }));
      n.columns.forEach((c) => setShelfCount(n, c, 1));
      return A("1.800 × 1.000 mm y 250 de fondo, detrás de una cama de matrimonio", "1,800 × 1,000 mm and 250 deep, behind a double bed"); } },
  { re: /mesita|mesilla|mesa de noche/, name: "mesita de noche", apply: (n) => {
      n.width = 450; n.height = 550; n.depth = 380; n.base = "patas"; n.baseHeight = 110;
      n.columns = [{ width: 450 - 2 * n.thickness, shelves: [224], cells: ["open", "drawer"] }];
      return A("450 × 550 mm y 380 de fondo, con un cajón y un hueco abierto", "450 × 550 mm and 380 deep, with one drawer and an open space"); } },
  { re: /aparador|buffet|credenza/, name: "aparador", apply: (n) => {
      n.height = 800; n.depth = 420; n.base = "patas"; n.baseHeight = 110;
      n.columns.forEach((c) => { c.door = true; c.drawers = 0; setShelfCount(n, c, 1); });
      return A("800 mm de alto, 420 de fondo y puertas en todas las columnas", "800 mm high, 420 deep, with doors on every column"); } },
  { re: /vinilo|\bdiscos?\b|\blps?\b|tocadiscos/, name: "vinilos", apply: (n) => {
      n.depth = 340;
      const k = clamp(Math.round((n.width - 2 * n.thickness) / 348), 1, 8);
      while (n.columns.length < k) addColumn(n);
      while (n.columns.length > k) n.columns.pop();
      redistribute(n);
      n.columns.forEach((c) => spaceShelves(n, c, 348));
      return "fondo 340 mm y huecos de 348 mm — un LP mide 315 mm"; } },
  { re: /bolsillo/, name: "libro de bolsillo", apply: (n) => {
      n.depth = 200; n.columns.forEach((c) => spaceShelves(n, c, 240));
      return "fondo 200 mm y huecos de 240 mm"; } },
  { re: /libros?\b|biblioteca|libreria|leer|comic|manga|revista/, name: "libros", apply: (n) => {
      n.depth = 280; n.columns.forEach((c) => spaceShelves(n, c, 320));
      return "fondo 280 mm y huecos de 320 mm"; } },
  { re: /zapat|calzado|recibidor|\bentrada\b/, name: "zapatos", apply: (n) => {
      n.depth = 300; n.columns.forEach((c) => spaceShelves(n, c, 200));
      return "fondo 300 mm y huecos de 200 mm"; } },
  { re: /cocina|despensa/, name: "cocina", apply: (n) => {
      n.depth = 300; n.columns.forEach((c) => spaceShelves(n, c, 280));
      return "fondo 300 mm y huecos de 280 mm, a la medida de tarros y botes"; } },
  { re: /dormitorio|\bropa\b|vestidor/, name: "dormitorio", apply: (n) => {
      n.depth = 450; n.back = true; n.columns.forEach((c) => { c.door = true; });
      return "fondo 450 mm, cerrada con puertas"; } },
  { re: /plantas?\b|macetas/, name: "plantas", apply: (n) => {
      n.depth = 250; n.back = false;
      return "sin trasera para que pase la luz, fondo 250 mm"; } },
  { re: /comoda|cajonera|mueble bajo con cajones/, name: "cómoda", apply: (n) => {
      n.height = 900; n.columns.forEach((c) => { c.drawers = 3; c.shelves = []; c.door = false; });
      return "altura 900 mm con cajones en todas las columnas"; } },
  { re: /carpeta|archivador|oficina|documentos|despacho/, name: "archivo", apply: (n) => {
      n.depth = 340; n.columns.forEach((c) => spaceShelves(n, c, 345));
      return "fondo 340 mm y huecos de 345 mm, medida de archivador"; } },
  { re: /\btele\b|television|\btv\b|pulgadas/, name: "mueble de TV", apply: (n) => {
      n.height = 560; n.depth = 400; n.base = "patas"; n.baseHeight = 110;
      n.columns.forEach((c, k) => { c.shelves = []; c.drawers = k % 2 ? 0 : 1; });
      return "altura 560 mm, fondo 400 mm y cajones alternos"; } },
  { re: /juguete|\bninos?\b|infantil/, name: "cuarto infantil", apply: (n) => {
      n.height = 1200; n.depth = 320; n.base = "zocalo"; n.baseHeight = 80;
      n.columns.forEach((c) => spaceShelves(n, c, 340));
      return "altura 1.200 mm para que lleguen, y anclaje antivuelco"; } },
];

const STYLES = [
  [/nordic|escandinav/, "abedul", "patas", "estilo nórdico"],
  [/industrial/, "melamina_negra", "patas", "estilo industrial"],
  [/minimalist|modern|contemporan|actual\b/, "melamina_blanca", "zocalo", "estilo minimalista"],
  [/japandi/, "roble", "zocalo", "estilo japandi"],
  [/\bboho|bohemi/, "roble", "patas", "estilo boho"],
  [/vintage|retro|mid.?century/, "nogal", "patas", "estilo vintage"],
  [/elegante|lujo|sofisticad|clasic/, "nogal", null, "más elegante"],
  [/calid|rustic|acogedor/, "roble", null, "más cálida"],
];

export const STARTERS = ["Que quepa en un hueco de 2,10 m", "Estilo nórdico", "Dos cajones abajo a la izquierda"];

/* Lo que no hace, dicho con honestidad y con alternativas que sí funcionan. */
const UNSUP = [
  [/esquina|rinconera|en forma de l\b/,
   A("En esquina todavía no: cada mueble es recto. Lo habitual es poner dos, uno en cada pared, que se junten en el rincón.",
     "No corner units yet: each unit is straight. The usual fix is two units, one on each wall, meeting in the corner."),
   ["Hazla más pequeña", "Que quepa en un hueco de 2,10 m"]],
  [/abuhardill|techo inclinado|buhardilla|pared inclinada|bajo cubierta/,
   A("Con techo inclinado todavía no corto en diagonal: lo mejor es darle la altura del punto más bajo, o poner dos muebles de alturas distintas.",
     "No angled cuts for sloped ceilings yet: best to use the height of the lowest point, or two units of different heights."),
   ["Hazla más pequeña"]],
  [/escalonad|en escalera/,
   A("Escalonada todavía no: todas las columnas tienen la misma altura. Puedo quitar baldas arriba en algunas columnas para que lo parezca.",
     "Stepped shapes aren't available yet: all columns have the same height. I can remove top shelves in some columns to suggest it."),
   ["Hazla más pequeña"]],
  [/(?:patas|pies)\s+(?:\w+\s+)?(?:dorad|platead|laton|cromad|de madera|de metal|metalic)/,
   A("Las patas son de serie en negro mate: todavía no se pueden cambiar.", "Legs come in matte black as standard: they can't be changed yet."),
   ["Con zócalo", "A la pared"]],
  [/trasera\s+(?:en\s+|de\s+)?(?:color\s+)?(?:blanc|negr|gris|de otro color|distint)/,
   A("La trasera va a juego con el acabado: todavía no se puede elegir aparte.", "The back panel matches the finish: it can't be chosen separately yet."),
   ["Sin trasera", "Con trasera"]],
  [/\bhaya\b|\bpino\b|cerezo|\bteca\b|fresno|\bolmo\b|bambu|castano|wengue|\bcedro\b|\barce\b/,
   A("Esa madera no la tengo: trabajo con contrachapado de abedul y chapa de roble o nogal, además de melamina blanca y negra.",
     "I don't have that wood: I work with birch plywood and oak or walnut veneer, plus white and black melamine."),
   ["En roble", "Estilo nórdico", "En nogal"]],
  [/maciz/,
   A("Maciza no: uso contrachapado de abedul y tablero chapado en roble o nogal, que no se tuerce con la humedad como la madera maciza.",
     "Not solid wood: I use birch plywood and oak or walnut veneered board, which doesn't warp with humidity the way solid wood does."),
   ["En roble", "En nogal"]],
  [/\bmdf\b|aglomerado/,
   A("Los acabados son melamina blanca o negra, contrachapado de abedul y chapa de roble o nogal: el MDF lacado no lo hago.",
     "The finishes are white or black melamine, birch plywood, and oak or walnut veneer: I don't do lacquered MDF."),
   ["Hazla blanca", "En roble"]],
  [/\bgris|\brojo|\bazul|\bverde|\bamarill|\brosa\b|\bmorad|\bnaranja/,
   "Ese color no lo tengo: los acabados son blanco, negro, abedul, roble y nogal.", ["Hazla blanca", "En nogal", "Estilo industrial"]],
  [/cristal|vidrio/,
   "Puertas de cristal no hago todavía: todas las piezas salen de tablero. Puedo poner puertas de madera o dejar los huecos abiertos.", ["Pon puertas", "Sin puertas"]],
  [/\bluz\b|luces|\bled\b|ilumina/,
   "La iluminación no la incluyo por ahora. Sin trasera, la luz de la habitación pasa entre los huecos.", ["Sin trasera", "Estilo minimalista"]],
  [/\bcama\b|\bcamas\b/,
   A("Una cama no la fabrico, pero sí lo de alrededor: una mesita de noche o un cabecero con baldas.",
     "I don't make beds, but I can make what goes around one: a bedside table or a headboard with shelves."),
   ["Una mesita de noche", "Cabecero con baldas"]],
  [/escritorio|\bmesa\b(?! de noche)|\bsilla\b|\bsofa\b/,
   "De momento solo diseño estanterías y muebles de almacenaje. Un mueble bajo con cajones o uno para la tele sí puedo.", ["Mueble bajo con cajones", "Para la tele"]],
  [/ruedas/,
   "Ruedas no pongo: el mueble apoya en patas, en zócalo o va colgado de la pared.", ["Con patas", "Con zócalo", "A la pared"]],
  [/\bmetal|\bacero|\bhierro/,
   "Solo trabajo con tablero; el negro mate da un aire industrial muy parecido.", ["Estilo industrial", "Hazla negra"]],
];

const NOT_YET = [
  [/cierre (?:suave|amortiguad|lento)|\bguias?\b/,
   A("Los cajones llevan guías metálicas de serie; todavía no se puede elegir el tipo de guía (cierre amortiguado o apertura por presión).",
     "Drawers come with metal runners as standard; you can't choose the runner type (soft-close or push-to-open) yet."),
   ["Dos cajones abajo a la izquierda"]],
  [/corredera|deslizante/,
   A("Solo hago puertas abatibles, con bisagra: las correderas todavía no.",
     "Only hinged doors for now: sliding doors aren't available yet."),
   ["Pon puertas", "Sin puertas"]],
];

const HELP = "Puedo cambiar las medidas («un metro ochenta de ancho», «que quepa en un hueco de 2,10 m»), el acabado, las columnas, las baldas, los cajones, las puertas, las patas y la trasera. También entiendo estilos («nórdico», «industrial»), usos («para vinilos», «para el recibidor») y presupuesto («que cueste menos de 1000 €»). Y te respondo cuánto cuesta, cuánto pesa o cuánto aguanta.";

/* Preguntas: se contestan con los datos reales del diseño actual. */
function infoAnswer(s, cur) {
  const has = (re) => re.test(s);
  if (has(/cuanto (?:cuesta|vale|sale|me sale)|que precio|el precio|presupuesto/) && !has(/barat|menos de|economic|baja|reduc|\d/)) {
    const q = priceOf(cur);
    return { ask: `Ahora mismo sale por ${eur(q.gross)}, con IVA y envío peninsular incluidos. Se recalcula con cada cambio.`,
             suggest: ["Hazla más barata", "Que cueste menos de 1000 €"] };
  }
  if (has(/aguanta (?:libros|peso|mucho|bien|el peso)|cuanto (?:peso )?(?:aguanta|soporta)|cuantos kilos|kilos? aguanta|es resistente|se comba|se doblan?|\baguantar(?:ia)?\b|\bsoportar(?:ia)?\b|\baguanta\b|\bsoporta\b|\bresiste\b|puede con/)) {
    const L = Math.max(...cur.columns.map((c) => c.width));
    const t = cur.thickness, E = MATERIALS[cur.material].E;
    if (has(/\btele\b|television|\btv\b|pantalla/)) {
      /* la tele va encima: el techo del mueble apoya en los costados y divisores */
      const top = (384 * E * t ** 3) / (300 * 60 * L ** 3) * L * cur.depth / 9.81;
      const ok = top >= 30;
      return {
        ask: `${ok ? "Sí" : "Justo"}: una tele de 55 pulgadas pesa unos 15–20 kg y el techo del mueble, apoyado cada ${mm(L)} mm, aguanta unos ${Math.round(top)} kg repartidos${ok ? "." : ". Mejor sube el espesor o añade una columna."}`,
        askEn: `${ok ? "Yes" : "Only just"}: a 55-inch TV weighs about 15–20 kg and the top of the unit, supported every ${Math.round(L).toLocaleString("en-GB")} mm, holds about ${Math.round(top)} kg spread evenly${ok ? "." : ". Better to go thicker or add a column."}`,
        suggest: ok ? ["Para la tele"] : ["Espesor de 22 mm", "Una columna más"] };
    }
    const d = cur.back ? cur.depth - BACK_T : cur.depth;
    const kg = (384 * E * t ** 3) / (300 * 60 * L ** 3) * L * d / 9.81;   // flecha admisible L/300
    const books = (L / 1000) * 35;                                          // ~35 kg por metro de libros
    return { ask: `Cada balda de la columna más ancha (${mm(L)} mm) aguanta unos ${Math.round(kg)} kg repartidos sin combarse a la vista. Una balda llena de libros pesa unos ${Math.round(books)} kg, así que ${kg > books * 1.3 ? "va sobrada" : "va justa: sube el espesor o añade una columna"}.`,
             suggest: ["Espesor de 22 mm", "Una columna más"] };
  }
  if (has(/cuanto pesa|que peso tiene|peso total|pesa mucho/)) {
    const q = priceOf(cur);
    return { ask: `Montada pesa unos ${Math.round(q.weight)} kg. Llega en ${q.nSheets + 1} o ${q.nSheets + 2} cajas planas.`,
             suggest: ["Sin trasera", "Menos fondo"] };
  }
  if (has(/cuantas piezas|cuantos tableros|piezas tiene|cuantas tablas/)) {
    const g = build(cur);
    const rows = cutlist(g);
    const pieces = rows.reduce((a, r) => a + r.qty, 0);
    return { ask: `Son ${pieces} piezas, cortadas de ${nest(rows).sheets.length} tableros. El despiece completo está en el panel de la derecha.` };
  }
  if (has(/(?:envi|entreg|mand|lleg)\w*[^.;]*\b(?:canarias|baleares|islas|ceuta|melilla|portugal|francia|extranjero|fuera de espana|europa|andorra)|\b(?:canarias|baleares)\b/)) {
    return { ask: A("Por ahora solo enviamos a la Península, con el envío incluido en el precio. Islas y extranjero, todavía no.",
                    "For now we only ship to mainland Spain, with shipping included in the price. Islands and abroad, not yet.") };
  }
  if (has(/tarda|plazo|cuando llega|entrega|cuanto tiempo/)) {
    return { ask: "Entre 12 y 16 días desde el pedido: se corta por control numérico, se cantea y se envía en plano. El envío peninsular va incluido." };
  }
  if (has(/desmont|mudanza/)) {
    return { ask: A("Sí: va con herrajes excéntricos, así que se desmonta y se vuelve a montar para una mudanza sin estropearse.",
                    "Yes: it uses cam fittings, so you can take it apart and put it back together for a move without damage.") };
  }
  if (has(/montar|montaje|montad|instalar|herramient|dificil de montar|como se monta/)) {
    return { ask: "Llega en plano con cada pieza numerada y herrajes excéntricos. Se monta en 40–60 minutos con una llave Allen, y el manual sale de tu propio despiece." };
  }
  if (has(/de que (?:material|madera) es|que material (?:es|tiene|lleva|usa)|de que esta hecha|que madera (?:es|tiene|lleva|usa)/)) {
    return { ask: `Es ${matName(cur.material, "es").toLowerCase()} de ${cur.thickness} mm, con canto ABS en las partes vistas${cur.back ? " y trasera de 3 mm" : ""}.`,
             askEn: `It's ${matName(cur.material, "en").toLowerCase()}, ${cur.thickness} mm thick, with ABS edging on the visible edges${cur.back ? " and a 3 mm back panel" : ""}.`,
             suggest: ["En roble", "En nogal", "Hazla blanca"] };
  }
  if (has(/recomiend|aconsej|que material|cual es mejor|que madera/)) {
    return { ask: "Para un salón, roble: cálido y resistente. Para un estilo nórdico, abedul, que se ve la chapa en los cantos. Nogal si quieres algo más elegante. Y melamina si prima el precio.",
             suggest: ["En roble", "Estilo nórdico", "Hazla más barata"] };
  }
  if (has(/por que (?:es )?tan car|por que cuesta tanto|por que es car|muy car[oa]|demasiado car/)) {
    const q = priceOf(cur);
    const top = Object.entries(q.c).sort((a, b) => b[1] - a[1]).slice(0, 2);
    const pct = (v) => Math.round((v / q.cost) * 100);
    const t = cur.thickness, M = MATERIALS[cur.material];
    const ratio = Math.round(M.cost[t] / MATERIALS.melamina_blanca.cost[t]);
    const nm = (l, k) => STR[l].costs[k].toLowerCase();
    return {
      ask: `Sale por ${eur(q.gross)} con IVA y envío. Lo que más pesa es ${nm("es", top[0][0])} (${pct(top[0][1])} % del coste) y ${nm("es", top[1][0])} (${pct(top[1][1])} %).` +
           (M.grain ? ` La chapa de madera cuesta unas ${ratio} veces lo que la melamina blanca.` : ""),
      askEn: `It's ${eur(q.gross)} with VAT and shipping. The biggest costs are ${nm("en", top[0][0])} (${pct(top[0][1])}% of the cost) and ${nm("en", top[1][0])} (${pct(top[1][1])}%).` +
           (M.grain ? ` Wood veneer costs about ${ratio} times as much as white melamine.` : ""),
      suggest: ["Hazla más barata", "Que cueste menos de 1000 €"] };
  }
  if (has(/descuent|rebaja|oferta|cupon|codigo promocional|promocion/)) {
    return { ask: A("De momento no hay descuentos: el precio sale del coste real de cada pieza. Para bajarlo, lo que más se nota es pasar a melamina o quitar la trasera.",
                    "No discounts for now: the price comes from the real cost of each piece. To bring it down, switching to melamine or removing the back panel makes the biggest difference."),
             suggest: ["Hazla más barata"] };
  }
  if (has(/devol|devuelv|desistimiento|reembolso/)) {
    return { ask: A("Al hacerse a medida, no tiene los 14 días de desistimiento de una compra normal. Si llega dañada o con un defecto, la cubre la garantía legal y se repone la pieza.",
                    "Because it's made to measure, it doesn't have the usual 14-day right of withdrawal. If it arrives damaged or faulty, the legal guarantee covers it and the piece is replaced.") };
  }
  if (has(/garantia/)) {
    return { ask: A("Tiene 3 años de garantía legal, como cualquier producto nuevo comprado en España.",
                    "It comes with 3 years of legal guarantee, like any new product bought in Spain.") };
  }
  if (has(/sostenib|ecologic|medio ambiente|residuo|desperdicio|reciclad/)) {
    const ny = nest(cutlist(build(cur)));
    const pct = Math.round((ny.yield.reduce((a, b) => a + b, 0) / Math.max(1, ny.yield.length)) * 100);
    return { ask: `Se corta solo lo que pides: este diseño aprovecha el ${pct} % de los tableros, y no hay muebles esperando en un almacén.`,
             askEn: `Only what you order gets cut: this design uses ${pct}% of the boards, and there's no stock sitting in a warehouse.` };
  }
  if (has(/ancl|antivuelco|volcar|vuelque|se cae|caerse|fijar(?:la)? a la pared/)) {
    return { ask: A("Si mide más de 1,2 m de alto, lleva un kit antivuelco con escuadras para atornillarla a la pared (norma EN 14749). Si va suspendida, necesita anclajes a un muro macizo.",
                    "If it's taller than 1.2 m, it comes with an anti-tip kit with brackets to screw it to the wall (EN 14749). If it's wall-hung, it needs anchors into solid masonry.") };
  }
  if (has(/que puedes hacer|que sabes hacer|\bayuda\b|como funciona|que se puede|que cosas/)) {
    return { ask: HELP, suggest: STARTERS };
  }
  return null;
}

const RESET = /(?:empieza|empezar|empezamos|comienza|vuelve a empezar|volver a empezar)\b.*\b(?:cero|nuevo|principio)|\bdesde cero\b|\bborra(?:r|lo)? todo\b|^quita(?:lo)? todo$|\belimina(?:r|lo)?\s+(?:este|esta|el|la|todo el|toda la)?\s*(?:armario|mueble|estanteria|diseno|todo)\b|\breset|\breinicia/;
const UNDO = /\b(?:la|version) anterior\b|\bla de antes\b|\bdeshaz|\bdeshacer|\bvuelve atras|\bcomo estaba\b|^no,? asi no|\banula (?:lo|eso|el ultimo)|\bmejor como antes/;
const GREET = /^(?:hola|buenas|hey|ey|buenos dias|buenas tardes|buenas noches)\b/;
const THANKS = /^(?:gracias|genial|perfecto|perfecta|guay|vale|ok|okey|me gusta|muy bien|esta bien|asi esta bien|me vale|me encanta)\b/;
const ASKS = [
  [/tirador|pomo/,
   A("Hay seis tiradores: barra negra, barra de latón, pomo, embutido, gola de aluminio o push, sin tirador. ¿Cuál pongo?",
     "There are six handles: black bar, brass bar, knob, recessed, aluminium gola profile or push, with no handle. Which one?"),
   ["Tiradores de latón", "Pomos", "Sin tiradores"]],
  [/no me gusta|no me convence|\bfea?\b/,
   A("¿Qué cambiarías? Puedo probar otro estilo o acabado:", "What would you change? I can try another style or finish:"),
   ["Estilo nórdico", "Estilo industrial", "En nogal"]],
  [/sorprend|lo que (?:tu )?veas|decide tu|elige tu|bonita|chula/,
   A("Te propongo tres caminos; toca uno y lo aplico:", "Here are three directions; tap one and I'll apply it:"),
   ["Estilo nórdico", "Estilo industrial", "En nogal"]],
  [/\bsalon\b|comedor|sala de estar/,
   A("Para un salón suele funcionar una librería alta en roble o un mueble bajo para la tele. ¿Qué vas a guardar?",
     "For a living room, a tall oak bookcase or a low TV unit usually works. What will you store?"),
   ["Para libros", "Para la tele", "En roble"]],
  [/color|acabado|tono/, "Tengo cinco acabados: blanco, negro, abedul, roble y nogal. ¿Cuál te pongo?", ["Hazla blanca", "En nogal", "En roble"]],
  [/medida|tamano|dimension|cabe/, "Dime la medida y te la ajusto: «ancho 2,10 m», «que quepa en un hueco de 1,80» o «1,80 × 2,20».", ["Que quepa en un hueco de 2,10 m"]],
];

/**
 * Resuelve una petición contra el diseño actual.
 */
function parseCore(msg, current) {
  const s = spokenLengths(norm(msg));
  if (!s) return null;

  /* ---- peticiones que no se pueden cumplir tal cual ---- */
  for (const [re, text, sug] of NOT_YET) if (re.test(s)) return { ask: text, suggest: sug };

  /* ---- órdenes sobre el diseño entero ---- */
  if (RESET.test(s)) return { action: "reset" };
  if (UNDO.test(s)) return { action: "undo" };

  /* ---- preguntas ---- */
  const info = infoAnswer(s, current);
  if (info) return info;

  const n = deepCopy(current);
  const ch = [];
  const notes = [];
  let suggest = null;
  const mag = /un poco|ligera|algo mas|un pelin|poquito/.test(s) ? 130
            : /bastante|mucho|bien mas|el doble/.test(s) ? 450 : 260;

  const legM = s.match(/(?:patas|pies)\s+(?:de|a)\s+(\d+(?:[.,]\d+)?\s*(?:mm|cm|m)?)/);
  const legUp = /patas[^.;,]{0,10}mas alt|patas altas|mas altas? las patas/.test(s);
  const legDown = /patas[^.;,]{0,10}mas (?:baj|cort)|patas bajas/.test(s);
  const legEdit = !!(legM || legUp || legDown);
  const comoda = /comoda|cajonera|mueble bajo con cajones/.test(s);

  /* ---- hueco ---- */
  let fitDone = false;
  const under = /ventana|debajo de|bajo (?:la|el)\b|radiador|encimera/.test(s);
  if (/(?:en|un|el)\s+hueco\s+de|entre pared|que quepa|caber|encaj|nicho|alcoba/.test(s) || under) {
    const two = s.match(/(\d+(?:[.,]\d+)?)\s*(?:mm|cm|m)?\s*(?:x|×|por)\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m|metros?)?/);
    const v = parseLen((s.match(/(\d+(?:[.,]\d+)?\s*(?:mm|cm|m|metros?)?)/) || [])[1]);
    if (two) {
      const u = two[3] || "";
      n.width = parseLen(two[1] + u) - 10; n.height = parseLen(two[2] + u) - 10;
      ch.push(`${mm(n.width)} × ${mm(n.height)} mm`);
      notes.push("he dejado 10 mm de holgura en cada medida para poder meterla en el hueco");
      fitDone = true;
    } else if (v && under && v >= 410 && v <= 2610) {
      n.height = v - 10;
      ch.push(`alto ${mm(n.height)} mm`);
      notes.push("10 mm menos de alto para que quepa debajo");
      fitDone = true;
    } else if (v && v >= 410 && v <= 3210) {
      fitDone = true;
      n.width = v - 10;
      ch.push(`ancho ${mm(n.width)} mm`);
      notes.push("he dejado 10 mm de holgura para poder meterla en el hueco");
    }
  }

  /* ---- armario: 600 mm de fondo, barra bajo el maletero, cajones abajo ---- */
  if (/\barmario\b|ropero|guardarropa/.test(s)) {
    Object.assign(n, deepCopy(PRESETS.armario(n)));
    ch.push("armario");
    /* «un armario de 2 metros»: sin decir qué medida, es el ancho */
    const bare = !/anch|alt|fondo|profund|techo|hueco/.test(s) && !/\d\s*(?:x|×|por)\s*\d/.test(s) &&
                 s.match(/(\d+(?:[.,]\d+)?\s*(?:mm|cm|m)\b)/);
    const bw = bare ? parseLen(bare[1]) : null;
    if (bw && bw >= 600 && bw <= 3200) { n.width = bw; ch.push(`ancho ${mm(bw)} mm`); }
    notes.push(A("600 mm de fondo para las perchas, barra bajo el maletero y cajones abajo",
                 "600 mm deep for hangers, a rail under the top shelf and drawers below"));
  }

  /* ---- cuadrícula: «3x4 huecos», «cuadrícula de 3 por 4» ---- */
  let gridDone = false;
  const gridM = !fitDone && /hueco|cuadricula|casilla|cubo|fila/.test(s) ? s.match(/(?<![\d.,])(\d)\s*(?:x|×|por)\s*(\d)\b(?![.,]\d)/) : null;
  if (gridM) {
    const a = clamp(Number(gridM[1]), 1, 8), b = clamp(Number(gridM[2]), 1, 8);
    while (n.columns.length < a) addColumn(n);
    while (n.columns.length > a) n.columns.pop();
    redistribute(n);
    n.columns.forEach((c) => setShelfCount(n, c, b - 1));
    ch.push(`cuadrícula de ${a} × ${b} huecos`);
    gridDone = true;
  }

  /* ---- medidas ---- */
  const W = grab(s, ["anch", "ancho", "anchura", "largo"]);
  const H = grab(s.replace(/\d+\s*(?:alturas|niveles|pisos|filas)\b/g, " "), ["alt", "altura"]);
  const D = grab(s, ["fondo", "profundidad", "profund"]);   // "fondo" con número = profundidad
  if (W) { n.width = W; ch.push(`ancho ${mm(W)} mm`); }
  if (H && !legEdit) { n.height = H; ch.push(`alto ${mm(H)} mm`); }
  if (D) { n.depth = D; ch.push(`fondo ${mm(D)} mm`); }
  const xyz = gridDone || fitDone ? null : s.match(/(\d+(?:[.,]\d+)?)\s*(?:x|×|por)\s*(\d+(?:[.,]\d+)?)\s*(?:x|×|por)\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?/);
  if (xyz) {
    const u = xyz[4] || "";
    n.width = parseLen(xyz[1] + u); n.height = parseLen(xyz[2] + u); n.depth = parseLen(xyz[3] + u);
    ch.push(`${mm(n.width)} × ${mm(n.height)} × ${mm(n.depth)} mm`);
  }
  let ceilDone = false;
  const ceilV = /techo/.test(s) ? parseLen((s.match(/(\d+(?:[.,]\d+)?\s*(?:mm|cm|m)?)/) || [])[1]) : null;
  if (ceilV && ceilV >= 1800 && ceilV <= 3300) {
    /* al levantarla, la diagonal (alto y fondo) tiene que pasar bajo el techo */
    n.height = Math.floor((Math.sqrt(ceilV ** 2 - n.depth ** 2) - 10) / 10) * 10;
    ch.push(`alto ${mm(n.height)} mm`);
    notes.push(`con ${mm(ceilV)} mm de techo, así puedes levantarla sin que roce`);
    ceilDone = true;
  }
  const xy = gridDone || fitDone || xyz || ceilDone ? null : s.match(/(\d+(?:[.,]\d+)?)\s*(?:m|mm|cm)?\s*(?:x|×|por)\s*(\d+(?:[.,]\d+)?)\s*(m|mm|cm|metros?)?/);
  if (xy && !W && !H) {
    const a = parseLen(xy[1] + (xy[3] || "")), b = parseLen(xy[2] + (xy[3] || ""));
    if (a && b) { n.width = a; n.height = b; ch.push(`${mm(a)} × ${mm(b)} mm`); }
  }

  /* ---- una columna concreta: «la primera más ancha», «la segunda de 80 cm» ---- */
  let colEdit = false;
  const tc = whichCols(s, n);
  if (!gridDone && tc && tc.length === 1 && (/columna|hueco|cuadro|modulo/.test(s) ||
      /\b(?:la|el) (?:del|de la|de en) (?:medio|centro|izquierda|derecha)\b|\b(?:la|el) (?:primera|segunda|tercera|cuarta|quinta|ultima|primero|segundo)\b/.test(s))) {
    const i = tc[0];
    const valM = s.match(/(?:columna|hueco)[^.;,\d]{0,20}?(?:de|mida|mide|a)\s+(\d+(?:[.,]\d+)?\s*(?:mm|cm|m)\b)/);
    const step = mag === 130 ? 50 : mag === 450 ? 200 : 100;
    let w = null;
    if (valM) w = parseLen(valM[1]);
    else if (/mas anch|mas grande|ensanch/.test(s)) w = n.columns[i].width + step;
    else if (/mas estrech|mas peque/.test(s)) w = n.columns[i].width - step;
    if (w != null) {
      setColumnWidth(n, i, w);
      colEdit = true;
      ch.push(`columna ${i + 1} de ${mm(n.columns[i].width)} mm`);
    }
  }
  if (/columnas? iguales|mismo ancho|reparte (?:las )?columnas|iguala(?:r)? (?:las )?columnas/.test(s)) {
    redistribute(n); colEdit = true; ch.push("columnas iguales");
  }
  if (!colEdit && /columnas\s+(?:mas\s+)?(?:estrech|pequen|finas)/.test(s)) {
    addColumn(n); redistribute(n); colEdit = true; ch.push(`${n.columns.length} columnas`);
  } else if (!colEdit && /columnas\s+(?:mas\s+)?(?:anch|grande)/.test(s) && n.columns.length > 1) {
    n.columns.pop(); redistribute(n); colEdit = true; ch.push(`${n.columns.length} columnas`);
  }

  /* ---- comparativos ---- */
  if (!colEdit) {
    if (/mas anch|ensanch|mas amplia/.test(s)) { n.width += mag; ch.push(`ancho ${mm(n.width)} mm`); }
    if (/mas estrech|menos anch|estrechala/.test(s)) { n.width -= mag; ch.push(`ancho ${mm(n.width)} mm`); }
    if (/mas grande|hazla grande/.test(s)) { n.width += mag; n.height += mag; ch.push("más grande"); }
    if (/mas peque|mas compact|menos grande/.test(s)) { n.width -= mag; n.height -= mag; ch.push("más pequeña"); }
  }
  if (!legEdit) {
    if (/la mitad de (?:alta|alto)|mitad de altura/.test(s)) { n.height = Math.round(n.height / 2); ch.push(`alto ${mm(n.height)} mm`); }
    if (/la mitad de (?:ancha|ancho)/.test(s)) { n.width = Math.round(n.width / 2); ch.push(`ancho ${mm(n.width)} mm`); }
    if (!ceilDone && /mas alt|subela|hasta el techo|al techo/.test(s)) { n.height += /techo/.test(s) ? 500 : mag; ch.push(`alto ${mm(n.height)} mm`); }
    if (/mas baj|menos alt|bajala|mas cort/.test(s)) { n.height -= mag; ch.push(`alto ${mm(n.height)} mm`); }
  }
  if (/mas fond|mas hond|mas profund/.test(s)) { n.depth += 70; ch.push(`fondo ${mm(n.depth)} mm`); }
  if (/menos fond|poco fondo|menos profund/.test(s)) { n.depth -= 70; ch.push(`fondo ${mm(n.depth)} mm`); }

  /* ---- material, estilo y espesor ---- */
  const MSYN = [
    [/blanc/, "melamina_blanca"],
    [/negr|antracit/, "melamina_negra"],
    [/nogal|walnut|madera oscura|roble oscuro/, "nogal"],          // antes que «madera» a secas
    [/abedul|contrachap|plywood|madera clara/, "abedul"],
    [/roble|\boak\b|madera natural|\bmadera\b/, "roble"],
  ];
  const sMat = s.replace(/(?:trasera|patas|pies|tiradores?|pomos?)\s+(?:en\s+|de\s+)?(?:color\s+)?\w+/g, " ");
  for (const [re, k] of MSYN) {
    if (re.test(sMat)) { n.material = k; ch.push(MATERIALS[k].short.toLowerCase()); break; }
  }
  for (const [re, mat, base, label] of STYLES) {
    if (re.test(s)) {
      n.material = mat;
      if (base) { n.base = base; n.baseHeight = base === "patas" ? 110 : base === "zocalo" ? 80 : 0; }
      ch.push(label);
      break;
    }
  }
  const th = s.match(/(\d{2})\s*mm\s*(?:de\s*)?(?:espesor|grosor|grueso)/) ||
             s.match(/(?:espesor|grosor)\s*(?:de\s*)?(\d{2})/);
  if (th) {
    const v = [16, 18, 22].reduce((a, b) => Math.abs(b - Number(th[1])) < Math.abs(a - Number(th[1])) ? b : a);
    n.thickness = v; ch.push(`espesor ${v} mm`);
  } else if (/mas gruesa|mas resistente|refuerza|que aguante|mas robusta|mas fuerte/.test(s)) {
    n.thickness = n.thickness === 16 ? 18 : 22;
    ch.push(`espesor ${n.thickness} mm`);
  }

  /* ---- base, patas y trasera ---- */
  const CPATA = "(?:patas|pies|apoyos)";
  if (/flotante|a la pared|en la pared|suspend|colgad|volad|que flote/.test(s) || isNeg(s, CPATA)) {
    n.base = "flotante"; n.baseHeight = 0; ch.push("suspendida");
  } else if (!legEdit && (isPos(s, CPATA) || /\bpatas\b/.test(s))) {
    n.base = "patas"; n.baseHeight = 110; ch.push("con patas");
  } else if (/zocalo|al suelo|hasta el suelo|pegada al suelo|apoy\w* en el suelo|en el suelo|sobre el suelo/.test(s)) {
    n.base = "zocalo"; n.baseHeight = 80; ch.push("con zócalo");
  }
  if (legM) {
    n.base = "patas"; n.baseHeight = clamp(parseLen(legM[1]), 60, 220);
    ch.push(`patas de ${mm(n.baseHeight)} mm`);
  } else if (legUp || legDown) {
    const cur = current.base === "patas" ? current.baseHeight : 110;
    n.base = "patas"; n.baseHeight = clamp(cur + (legUp ? 40 : -30), 60, 220);
    ch.push(`patas de ${mm(n.baseHeight)} mm`);
  }

  const CBACK = D ? "(?:trasera|panel trasero|espalda|por detras)"
                  : "(?:trasera|fondo|panel trasero|espalda|por detras)";
  if (isNeg(s, CBACK) || /abierta por detras|pasante|difana|se vea la pared/.test(s)) {
    n.back = false; ch.push("sin trasera");
  } else if (isPos(s, CBACK) || /cerrada por detras|tape la pared/.test(s)) {
    n.back = true; ch.push("con trasera");
  }

  /* ---- columnas ---- */
  const divM = s.match(/(?:divid|parte|partel|separ)\w*\s+en\s+(\d+|dos|tres|cuatro|cinco|seis|siete|ocho)\b/);
  const colsOf = s.match(/(\d+|dos|tres|cuatro|cinco|seis|siete|ocho)\s*columnas?\s+de\s+(\d+(?:[.,]\d+)?\s*(?:mm|cm|m)?)/);
  const dCol = delta(s, "(?:columna|modulo|vano|division)");
  const nc = count(s, /(\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*(?:columnas?|modulos?|vanos?|cuerpos?)\b/);
  if (divM && !gridDone) {
    const k = clamp(/^\d+$/.test(divM[1]) ? Number(divM[1]) : WORDNUM[divM[1]], 1, 8);
    while (n.columns.length < k) addColumn(n);
    while (n.columns.length > k) n.columns.pop();
    redistribute(n);
    ch.push(`${k} columnas`);
  } else if (colsOf && !gridDone) {
    const k = clamp(/^\d+$/.test(colsOf[1]) ? Number(colsOf[1]) : WORDNUM[colsOf[1]], 1, 8);
    const w = parseLen(colsOf[2]);
    while (n.columns.length < k) addColumn(n);
    while (n.columns.length > k) n.columns.pop();
    n.columns.forEach((c) => { c.width = w; });
    n.width = k * w + (k + 1) * n.thickness;
    ch.push(`${k} columnas de ${mm(w)} mm`);
  } else if (gridDone) {
    // la cuadrícula ya fijó las columnas
  } else if (!colEdit && dCol != null) {
    for (let k = 0; k < Math.abs(dCol); k++) {
      if (dCol > 0) addColumn(n);
      else if (n.columns.length > 1) n.columns.pop();
    }
    redistribute(n);
    ch.push(`${n.columns.length} columnas`);
  } else if (nc != null) {
    const k = clamp(nc, 1, 8);
    while (n.columns.length < k) addColumn(n);
    while (n.columns.length > k) n.columns.pop();
    redistribute(n);
    ch.push(`${k} columna${k === 1 ? "" : "s"}`);
  } else if (/divide mas|mas divisiones/.test(s)) {
    addColumn(n); redistribute(n); ch.push(`${n.columns.length} columnas`);
  }

  /* ---- baldas ---- */
  const tgt = whichCols(s, n);
  const cols = tgt ? tgt.map((k) => n.columns[k]) : n.columns;
  const shelvesOff = /(?:quita\w*|saca\w*|elimina\w*|borra\w*)\s+(?:todas\s+)?las\s+(?:baldas|estantes|repisas)\b|sin baldas|nada de baldas|ninguna balda/.test(s);
  const everyM = s.match(/cada\s+(\d+(?:[.,]\d+)?\s*(?:mm|cm|m)?)/);
  const gapsM = s.match(/\bhuecos\s+de\s+(\d+(?:[.,]\d+)?\s*(?:mm|cm|m)?)/);
  const every = everyM && /balda|estante|repisa/.test(s) ? everyM : gapsM;
  const posM = s.match(/(?:balda|estante|repisa)s?\s+a\s+(\d+(?:[.,]\d+)?\s*(?:mm|cm|m|metros?)?)/);
  const moveUp = /sube (?:las |la )?baldas?|baldas? mas arriba/.test(s);
  const moveDown = /baja (?:las |la )?baldas?|baldas? mas abajo/.test(s);
  const apart = /mas separad/.test(s);
  const closer = /mas junt|(?:baldas?|estantes?)[^.;,]{0,12}juntas/.test(s);
  const rowsN = count(s, /(\d+|dos|tres|cuatro|cinco|seis|siete|ocho)\s*(?:filas|niveles|alturas|pisos)\b/);
  const dSh = delta(s, "(?:balda|estante|repisa)");
  const nb = count(s, /(\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho)\s*(?:baldas?|estantes?|repisas?)\b/);
  const where = !tgt ? ""
    : tgt.length > 1 && tgt.length === n.columns.length ? " en todas las columnas"
    : tgt.length > 1 ? " en esas columnas" : ` en la columna ${tgt[0] + 1}`;
  const edgeOff = s.match(/(?:quita|saca|elimina|borra)\w*\s+(?:la\s+)?(?:balda|estante|repisa)\s+(?:de\s+)?(?:mas\s+)?(arriba|superior|de encima|alta|abajo|inferior|baja)/);
  if (gridDone) {
    // ya resuelto
  } else if (edgeOff) {
    const up = /arriba|superior|encima|alta/.test(edgeOff[1]);
    cols.forEach((c) => {
      if (!c.shelves.length) return;
      const v = up ? Math.max(...c.shelves) : Math.min(...c.shelves);
      c.shelves.splice(c.shelves.indexOf(v), 1);
    });
    ch.push(`${up ? "sin la balda de arriba" : "sin la balda de abajo"}${where}`);
  } else if (shelvesOff) {
    cols.forEach((c) => { c.shelves = []; });
    ch.push(`sin baldas${where}`);
  } else if (every) {
    const gap = clamp(parseLen(every[1]), 150, 800);
    cols.forEach((c) => spaceShelves(n, c, gap));
    ch.push(`baldas cada ${mm(gap)} mm`);
  } else if (moveUp || moveDown) {
    cols.forEach((c) => { c.shelves = c.shelves.map((v) => v + (moveUp ? 100 : -100)); });
    ch.push(`baldas 100 mm más ${moveUp ? "arriba" : "abajo"}`);
  } else if (apart || closer) {
    cols.forEach((c) => setShelfCount(n, c, Math.max(0, c.shelves.length + (apart ? -1 : 1))));
    ch.push(apart ? "baldas más separadas" : "baldas más juntas");
  } else if (posM) {
    const h = parseLen(posM[1]);
    const inner = h - n.baseHeight - n.thickness;
    cols.forEach((c) => { c.shelves = c.shelves.filter((v) => Math.abs(v - inner) >= 140).concat(inner); });
    ch.push(`balda a ${mm(h)} mm del suelo`);
  } else if (rowsN != null) {
    cols.forEach((c) => setShelfCount(n, c, rowsN - 1));
    ch.push(`${rowsN} filas${where}`);
  } else if (dSh != null) {
    cols.forEach((c) => setShelfCount(n, c, c.shelves.length + dSh));
    const q = Math.abs(dSh);
    ch.push(`${q === 1 ? "una balda" : `${q} baldas`} ${dSh > 0 ? "más" : "menos"}${where}`);
  } else if (nb != null) {
    cols.forEach((c) => setShelfCount(n, c, nb));
    ch.push(`${nb} balda${nb === 1 ? "" : "s"}${where}`);
  } else if (isPos(s, "(?:baldas?|estantes?)\\b")) {
    cols.forEach((c) => setShelfCount(n, c, c.shelves.length + 1));
    ch.push("una balda más");
  }

  /* ---- filas ---- */
  const ROWN = "(?:cuadrad|cuadro|hueco|casilla|compartiment|fila|parte|zona|modulo)\\w*";
  const rowWhich =
      new RegExp(ROWN + "\\s+(?:de\\s+)?(?:mas\\s+)?(?:abajo|inferior)|abajo del todo|fila inferior|puertas?\\s+(?:solo\\s+)?(?:abajo|bajas)").test(s) ? "bottom"
    : new RegExp(ROWN + "\\s+(?:de\\s+)?(?:mas\\s+)?(?:arriba|superior)|arriba del todo|fila superior|puertas?\\s+(?:solo\\s+)?(?:arriba|altas)").test(s) ? "top"
    : new RegExp(ROWN + "\\s+(?:del\\s+|de en\\s+)?medio|fila central").test(s) ? "middle" : null;
  let rowDone = false;

  /* ---- todos los huecos: cada hueco de cada columna, no solo una fila ----
     «cajones en todos los huecos» llenaba solo el hueco de abajo porque se
     leía como «en todas las columnas». */
  const ALLC = /\b(?:tod[oa]s|cada)\s+(?:(?:los|las|the)\s+)?(?:hueco|cuadro|cuadrado|casilla|compartimento|espacio|cubo)s?\b/;
  const cellType = /caj[oó]n|cajones/.test(s) ? "drawers"
    : /puertas?/.test(s) && !isNeg(s, "puerta") ? "door"
    : /barra|colgar/.test(s) ? "rail"
    : /abiert|vaci|sin nada|sin puertas|quita\w* (?:las puertas|los cajones)/.test(s) ? "open" : null;
  if (!rowWhich && cellType && ALLC.test(s)) {
    const all = n.columns.map((_, i) => i);
    let idx = whichCols(s, n);
    if (!idx || idx.length === all.length) idx = whichCols(s.replace(ALLC, " "), n) || all;
    const want = cellType === "drawers" ? count(s, /(\d+|un|una|dos|tres)\s*cajon(?:es)?\b/) : null;
    idx.forEach((i) => {
      const c = n.columns[i];
      /* de arriba abajo: si un hueco muy alto se parte, no descoloca los que faltan */
      for (let j = c.cells.length - 1; j >= 0; j--) {
        const h = cellClear(n, c, j);
        if (cellType === "drawers") {
          const nd = clamp(want ?? Math.round(h / 450), 1, Math.min(3, Math.floor(h / MIN_FRONT)));
          if (h >= MIN_FRONT) setCell(n, c, j, drawerType(nd), n.columns, false);
        } else if (cellType === "rail") {
          if (h >= 600) setCell(n, c, j, c.cells[j] === "door" ? "rail+door" : "rail", n.columns);
        } else {
          setCell(n, c, j, cellType, n.columns);
          if (cellType === "door") setOwnDoor(c, j);
        }
      }
    });
    if (cellType === "rail" && n.depth < 580) {
      n.depth = 580;
      notes.push(A("580 mm de fondo, para que las perchas no rocen", "580 mm deep so hangers don't rub"));
    }
    const what = cellType === "drawers" ? (want === 1 ? "un cajón" : want ? `${want} cajones` : "cajones")
      : cellType === "door" ? "puertas" : cellType === "rail" ? "barra de colgar" : "huecos abiertos";
    const where = idx.length === all.length ? " en todos los huecos"
      : idx.length === 1 ? ` en todos los huecos de la columna ${idx[0] + 1}` : " en los huecos de esas columnas";
    ch.push(what + where);
    rowDone = true;
  }

  if (!rowDone && rowWhich && /caj[oó]n|cajones|puertas?|abiert|barra|colgar/.test(s)) {
    const targets = tgt || n.columns.map((_, i) => i);
    const nd = /caj/.test(s) ? clamp(count(s, /(\d+|un|una|dos|tres)\s*cajon(?:es)?\b/) ?? 2, 1, 3) : 0;
    const type = nd ? drawerType(nd)
      : /puerta/.test(s) && !isNeg(s, "puerta") ? "door"
      : /barra|colgar/.test(s) ? "rail" : "open";
    targets.forEach((i) => {
      const c = n.columns[i], last = c.cells.length - 1;
      const jr = rowWhich === "top" ? last : rowWhich === "bottom" ? 0 : Math.floor(last / 2);
      setCell(n, c, jr, type, n.columns);
      if (type === "door") setOwnDoor(c, jr);
    });
    const what = nd ? `${nd} ${nd === 1 ? "cajón" : "cajones"}` : type === "door" ? "puertas" : type === "rail" ? "barra de colgar" : "huecos abiertos";
    ch.push(`${what} en la fila ${{ bottom: "de abajo", top: "de arriba", middle: "del medio" }[rowWhich]}`);
    rowDone = true;
  }

  /* ---- cajón interior y bandeja extraíble ---- */
  let boxDone = false;
  const innerQ = /cajon\w*\s+interior|cajon\w*\s+(?:por\s+)?dentro|cajon\w*\s+(?:detras|tras)\s+(?:de\s+)?la\s+puerta/.test(s);
  const trayQ = /\bbandejas?\b|zapatero\w*\s+extraible|extraible\w*\s+(?:para\s+)?(?:los\s+)?zapat/.test(s);
  if (!rowDone && (innerQ || trayQ)) {
    const type = innerQ ? "door+drawer" : "tray";
    const done = [];
    (tgt || [0]).forEach((i) => {
      const c = n.columns[i];
      /* el hueco más bajo donde quepa; la bandeja, donde no haya cajones */
      const j = c.cells.findIndex((x, jj) => canPlace(n, type, i, jj).ok && !drawersIn(x));
      if (j >= 0 && applyItem(n, type, i, j).ok) done.push(i);
    });
    if (!done.length) {
      return { ask: A("Ahí no cabe: hace falta un hueco de 15 cm de alto en una columna de 25 cm de ancho.",
                      "It doesn't fit there: it needs a compartment 15 cm high in a column 25 cm wide."),
               suggest: ["Menos columnas"] };
    }
    const where = done.length === n.columns.length && done.length > 1 ? " en todas las columnas"
      : done.length === 1 ? ` en la columna ${done[0] + 1}` : " en esas columnas";
    ch.push((innerQ ? "cajón interior" : "bandeja extraíble") + where);
    boxDone = true;
  }

  /* ---- cajones ---- */
  const biggerDr = /cajon\w*\s+(?:mas\s+)?(?:grandes|altos|hondos|profundos)/.test(s);
  if (!rowDone && !boxDone && biggerDr && n.columns.some((c) => c.drawers)) {
    /* cajones más altos: sube la balda que tienen encima */
    const HiB = n.height - n.baseHeight - 2 * n.thickness;
    (tgt ? tgt.map((x) => n.columns[x]) : n.columns).forEach((c) => {
      const j = c.cells.findIndex((x) => drawersIn(x));
      if (j < 0 || j >= c.shelves.length) return;
      c.shelves[j] = Math.min(c.shelves[j] + 100, (c.shelves[j + 1] ?? HiB) - 140);
    });
    ch.push("cajones más altos");
  } else if (!rowDone && !boxDone && !comoda && /caj[oó]n|cajones|cajoner/.test(s)) {
    const dDr = delta(s, "(?:cajon|cajoner)");
    const target = tgt ? tgt.map((x) => n.columns[x]) : [n.columns[0]];
    const drawersOff = /(?:quita\w*|saca\w*|elimina\w*|borra\w*)\s+(?:todos\s+)?los\s+cajones\b|sin cajones|nada de cajones|ningun cajon/.test(s);
    /* sin decir dónde van a la primera columna, y se dice cuál */
    const whereDr = where || " en la columna 1";
    if (drawersOff) {
      (tgt ? target : n.columns).forEach((c) => setDrawers(n, c, 0));
      ch.push("sin cajones");
    } else if (dDr != null) {
      target.forEach((c) => setDrawers(n, c, c.drawers + dDr));
      const q = Math.abs(dDr);
      ch.push(`${q === 1 ? "un cajón" : `${q} cajones`} ${dDr > 0 ? "más" : "menos"}${whereDr}`);
    } else {
      const neg = isNeg(s, "caj");
      const k = neg ? 0 : (count(s, /(\d+|un|una|dos|tres|cuatro)\s*cajon(?:es)?\b/) ?? 2);
      (tgt ? target : neg ? n.columns : target).forEach((c) => setDrawers(n, c, k));
      ch.push(k ? `${k} ${k === 1 ? "cajón" : "cajones"}${whereDr}` : "sin cajones");
      if (k && !tgt && n.columns.length > 1) suggest = ["Cajones en todas las columnas", "Mejor los cajones a la derecha"];
    }
  }

  /* ---- barra de colgar ---- */
  let railDone = false;
  if (/sin barra|quita\w*\s+(?:la\s+)?barra/.test(s)) {
    n.columns.forEach((c) => { c.cells = c.cells.map((x) => (x === "rail" ? "open" : x === "rail+door" ? "door" : x)); });
    ch.push("sin barra de colgar");
  } else if (!rowDone && /\bbarra\b|colgar|perchas?\b|colgador/.test(s)) {
    const idx = tgt || [n.columns.reduce((bi, c, i, arr) => (c.width > arr[bi].width ? i : bi), 0)];
    idx.forEach((i) => addRail(n, n.columns[i]));
    if (n.depth < 580) {
      n.depth = 580;
      notes.push(A("580 mm de fondo, para que las perchas no rocen", "580 mm deep so hangers don't rub"));
    }
    ch.push(idx.length > 1 && idx.length === n.columns.length ? "barra de colgar en todas las columnas" : `barra de colgar en la columna ${idx[0] + 1}`);
    railDone = true;
  }

  /* ---- puertas ---- */
  if (!rowDone && !boxDone && /puertas?/.test(s)) {
    const on = !isNeg(s, "puerta");
    (tgt ? tgt.map((x) => n.columns[x]) : n.columns).forEach((c) => { c.door = on; });
    ch.push(on ? "con puertas" : "sin puertas");
  }
  if (/cerrada|que no se vea|ocultar|esconder/.test(s) && !/puertas?|por detras/.test(s)) {
    n.columns.forEach((c) => { c.door = true; });
    n.back = true;
    ch.push("cerrada con puertas");
  }

  /* ---- tiradores: uno para todo el mueble ---- */
  const HANDLE_Q = [
    [/sin tiradores?|apertura (?:por )?(?:presion|push)|\bpush\b|tip.?on|pulsador/, "push", "sin tiradores (push)"],
    [/(?:tiradores?|barras?)\s+(?:de\s+|en\s+)?(?:laton|dorad|oro)|\blaton\b/, "bar_brass", "tiradores de latón"],
    [/\bpomos?\b/, "knob", "pomos"],
    [/unero|embutid|cazoleta|tiradores?\s+(?:integrad|escondid|ocult)/, "cup", "tiradores embutidos"],
    [/\bgola\b|perfil de aluminio|tiradores?\s+de\s+perfil/, "profile", "gola de aluminio"],
    [/tiradores?\s+(?:de\s+)?(?:barra|negros?|normales|de siempre)/, "bar", "tiradores de barra negros"],
  ];
  for (const [re, h, label] of HANDLE_Q) {
    if (re.test(s)) { n.handle = h; ch.push(label); break; }
  }

  /* ---- usos y estancias ---- */
  for (const u of railDone || boxDone ? [] : USES) {
    if (u.re.test(s)) {
      const note = u.apply(n);
      ch.push(`preparada para ${u.name}`);
      if (note) notes.push(note);
      const inch = u.name === "mueble de TV" && s.match(/(\d{2,3})\s*(?:pulgadas|")/);
      if (inch) {
        n.width = Math.max(n.width, Math.round((Number(inch[1]) * 22.1 + 200) / 10) * 10);
        notes.push(`${mm(n.width)} mm de ancho para una tele de ${inch[1]} pulgadas`);
      }
      break;
    }
  }

  /* ---- presupuesto: se prueban ahorros hasta llegar al precio ---- */
  const budgetM = s.match(/(?:menos de|por debajo de|maximo(?: de)?|como mucho|no mas de|hasta|presupuesto(?: es)?(?: de)?)\s*(\d[\d.]*)\s*(?:€|e\b|euros?)/);
  const cheapest = /lo mas barat[oa]|lo mas economic|el minimo precio/.test(s);
  const cheaper = /mas barat|economic|menos cara|abarat|que cueste menos|reduce el precio|baja el precio/.test(s);
  if (budgetM || cheaper) {
    const before = priceOf(n).gross;
    const goal = budgetM ? Number(budgetM[1].replace(/\./g, "")) : 0;
    const steps = [
      ["melamina blanca", (p) => (MATERIALS[p.material].grain ? ((p.material = "melamina_blanca"), true) : false)],
      ["tablero de 16 mm", (p) => (p.thickness > 16 && Math.max(...p.columns.map((c) => c.width)) <= maxSpan(p.material, 16) ? ((p.thickness = 16), true) : false)],
      ["sin trasera", (p) => (p.back ? ((p.back = false), true) : false)],
      ["sin puertas", (p) => (p.columns.some((c) => c.door) ? (p.columns.forEach((c) => { c.door = false; }), true) : false)],
      ["sin cajones", (p) => (p.columns.some((c) => c.drawers) ? (p.columns.forEach((c) => { c.drawers = 0; }), true) : false)],
      ["menos fondo", (p) => (p.depth > 260 ? ((p.depth = Math.max(250, p.depth - 60)), true) : false)],
    ];
    const applied = [];
    for (const [label, fn] of steps) {
      if (budgetM && priceOf(n).gross <= goal) break;
      if (fn(n)) applied.push(label);
      if (cheaper && !budgetM && !cheapest && applied.length) break;   // «más barata»: el ahorro más grande
    }
    const after = priceOf(n).gross;
    if (!applied.length && !ch.length) {
      return { ask: "Ya está en la opción más económica con estas medidas. Para bajar más, reduce el ancho o el alto.",
               suggest: ["Hazla más pequeña", "Menos fondo"] };
    }
    if (applied.length) ch.push(applied.join(", "));
    notes.push(`el precio pasa de ${eur(before)} a ${eur(after)}` +
               (budgetM && after > goal ? "; por debajo de eso no llego sin cambiar las medidas" : ""));
  }

  const unsup = UNSUP.find(([re]) => re.test(s));
  if (!ch.length) {
    if (unsup) return { ask: unsup[1], suggest: unsup[2] };
    if (GREET.test(s)) return { ask: "¡Hola! Cuéntame qué quieres guardar o dónde va el mueble y lo ajusto. " + HELP, suggest: STARTERS };
    if (THANKS.test(s)) return { ask: "¡A ti! Si quieres, seguimos afinando o lo envías a fabricación.", suggest: ["Hazla más barata", "Estilo nórdico"] };
    for (const [re, q, sug] of ASKS) if (re.test(s)) return { ask: q, suggest: sug };
    return null;
  }
  if (unsup) notes.push(unsup[1].split(":")[0].toLowerCase());
  return { params: n, changes: ch, notes, suggest };
}

/* Conversación: «quiero cajones» → «en todos los cuadros». Si la frase solo dice
   DÓNDE, se completa con lo último de lo que se habló (ctx.topic). */
const WHERE = /\bcuadrados?\b|\bfila\b|\babajo\b|\barriba\b|\btod[oa]s\b|\bcada\b|\bresto\b|\blados\b|\bcentro\b|\bmedio\b|\bprimer|\bsegund|\btercer|\bcuart|\bquint|\bsext|\bultim|izquierd|derech|\bcolumnas?\b|\bcuadros?\b|\bhuecos?\b|\bcasillas?\b|\bmodulos?\b|\btambien\b/;
const MOVE = /\bmejor\b|\bmueve\w*|\bpasa(?:los|las)?\b|\ben vez de\b|\bcambia(?:los|las)? de sitio|\bsolo\b|\bunicamente\b|\bexcepto\b|\bsalvo\b|(?:\btod[oa]s\b|\bcada\b)[^.;]*\bmenos\b/;
/* el sustantivo es el grupo 1; delante puede ir «dos», «una mas», «otra» */
const TOPIC = /(?:\b(?:\d+|un|una|dos|tres|cuatro|cinco|seis|otra|otro)\s+(?:mas\s+|menos\s+)?)?\b(cajon(?:es)?|baldas?|puertas?)\b(?:\s+(?:mas|menos)\b)?/;
export const topicOf = (msg) => (norm(msg).match(TOPIC) || [null])[0];

/**
 * Resuelve una petición contra el diseño actual.
 * ctx.topic: de qué se habló en el último cambio («cajones», «una balda mas»).
 * Devuelve además topic, para la siguiente frase.
 */
/* «otro más», «quita uno», «más», «un poco más»: solo una cantidad */
const BARE = /^(?:y\s+)?(?:otr[oa](?:\s+un[oa])?(?:\s+mas)?|un[oa]?\s+mas|(?:un poco\s+|un poquito\s+)?mas(?:\s+(?:todavia|aun))?|aun mas|(?:quita|saca|pon|anade|mete)\w*\s+(?:un[oa]?|otr[oa]|\d+)|un[oa] menos|menos)$/;
const EXCEPT = /^(?:y\s+)?(?:menos|excepto|salvo|quitando)\b|^(?:pero\s+)?no en\b/;

export function parseIntent(msg, current, ctx = {}) {
  let used = msg;
  let r = parseCore(msg, current);
  const s0 = norm(msg);
  if (!r && ctx.topic && EXCEPT.test(s0) && !TOPIC.test(s0)) {
    /* «menos en la primera» = en todas menos esa */
    used = `${ctx.topic} en todas ${msg.replace(/^\s*(?:y\s+)?(?:pero\s+)?no en\b/i, "menos en")}`;
    r = parseCore(used, current);
  } else if (!r && ctx.topic && WHERE.test(s0) && !TOPIC.test(s0)) {
    used = `${ctx.topic} ${msg}`;
    r = parseCore(used, current);
  } else if (!r && BARE.test(s0)) {
    const sing = ctx.topic ? (ctx.topic.match(/cajon|balda|puerta/) || [])[0] : null;
    const k = current.columns.length, cs = ctx.cols || [];
    const ORD = ["primera", "segunda", "tercera", "cuarta", "quinta", "sexta", "septima", "octava"];
    const loc = cs.length === 1 ? ` en la ${ORD[cs[0]]}` : cs.length > 1 && cs.length === k ? " en todas" : "";
    if (sing && sing !== "puerta") {
      const minus = /quita|saca|menos/.test(s0);
      const q = (s0.match(/\d+/) || [])[0];
      const fem = sing === "balda";
      used = q ? `${minus ? "quita" : "anade"} ${q} ${sing}${loc}`
               : minus ? `quita ${fem ? "una" : "un"} ${sing}${loc}` : `${fem ? "otra" : "otro"} ${sing}${loc}`;
      r = parseCore(used, current);
    } else if (ctx.last && !/quita|saca|menos/.test(s0)) {
      /* «más» repite el último cambio; «un poco más» lo repite a medias */
      used = /poco|poquito/.test(s0) ? `${ctx.last} un poco` : ctx.last;
      r = parseCore(used, current);
    }
  }
  if (r && r.params) {
    const s = spokenLengths(norm(used));
    const tp = (s.match(TOPIC) || [])[1] || "";
    const tgt = MOVE.test(s) ? whichCols(s, r.params) : null;
    /* «mejor a la derecha»: se quita de donde estaba */
    if (tgt) r.params.columns.forEach((c, i) => {
      if (tgt.includes(i)) return;
      if (/^caj/.test(tp)) setDrawers(r.params, c, 0);
      if (/^puert/.test(tp)) c.door = false;
    });
    r.topic = topicOf(used) || ctx.topic || null;
    r.last = used;
    const same = r.params.columns.length === current.columns.length;
    r.cols = same ? r.params.columns.map((c, i) => {
      const o = current.columns[i];
      return c.drawers !== o.drawers || c.shelves.length !== o.shelves.length || c.door !== o.door ? i : -1;
    }).filter((i) => i >= 0) : [];
  }
  return r;
}

/* Cuando no se entiende nada: sugerencias según lo que sí se ha reconocido. */
export function fallback(msg) {
  const s = norm(msg);
  const sug = [];
  if (/columna/.test(s)) sug.push("5 columnas", "La primera columna más ancha");
  if (/balda|estante/.test(s)) sug.push("Baldas cada 30 cm", "Una balda más en la segunda");
  if (/cajon/.test(s)) sug.push("Dos cajones abajo a la izquierda", "Quita los cajones");
  if (/puerta/.test(s)) sug.push("Pon puertas", "Puertas en las de los lados");
  if (!sug.length) sug.push(...STARTERS);
  return { ask: "No he sabido traducir eso a un cambio. Prueba a decirlo de otra forma, o toca una sugerencia:",
           suggest: sug.slice(0, 3) };
}

/* Todas las sugerencias que el chat puede ofrecer: tests/chat.mjs comprueba
   que cada una funciona de verdad al pulsarla. */
export const ALL_SUGGESTIONS = [
  ...STARTERS,
  ...UNSUP.flatMap((u) => u[2]),
  ...ASKS.flatMap((a) => a[2]),
  "Hazla más barata", "Que cueste menos de 1000 €", "Espesor de 22 mm", "Una columna más",
  "Sin trasera", "Menos fondo", "En roble", "Estilo nórdico", "Hazla más pequeña",
  "5 columnas", "La primera columna más ancha", "Baldas cada 30 cm", "Una balda más en la segunda",
  "Dos cajones abajo a la izquierda", "Quita los cajones", "Pon puertas", "Puertas en las de los lados",
  "Cajones en todas las columnas", "Mejor los cajones a la derecha", "Con trasera", "Deshaz",
  "Tiradores de latón", "Pomos", "Sin tiradores", "Menos columnas", "Una mesita de noche", "Cabecero con baldas",
  ...NOT_YET.flatMap((u) => u[2]),
];
