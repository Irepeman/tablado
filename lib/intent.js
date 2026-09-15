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
} from "./model.js";
import { cutlist, nest, quote, eur } from "./pricing.js";

const mm = (v) => Math.round(v).toLocaleString("es-ES");

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
    .replace(/(^|\s)(un|uno|dos|tres)\s+metros?\b/g, (_, lead, a) => `${lead}${UNITS_W[a]} m`);
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
  { re: /libros?\b|biblioteca|libreria|leer/, name: "libros", apply: (n) => {
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
  { re: /\btele\b|television|\btv\b/, name: "mueble de TV", apply: (n) => {
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
  [/minimalist/, "melamina_blanca", "zocalo", "estilo minimalista"],
  [/elegante|lujo|sofisticad|clasic/, "nogal", null, "más elegante"],
  [/calid|rustic|acogedor/, "roble", null, "más cálida"],
];

export const STARTERS = ["Que quepa en un hueco de 2,10 m", "Estilo nórdico", "Dos cajones abajo a la izquierda"];

/* Lo que no hace, dicho con honestidad y con alternativas que sí funcionan. */
const UNSUP = [
  [/\bgris|\brojo|\bazul|\bverde|\bamarill|\brosa\b|\bmorad|\bnaranja/,
   "Ese color no lo tengo: los acabados son blanco, negro, abedul, roble y nogal.", ["Hazla blanca", "En nogal", "Estilo industrial"]],
  [/cristal|vidrio/,
   "Puertas de cristal no hago todavía: todas las piezas salen de tablero. Puedo poner puertas de madera o dejar los huecos abiertos.", ["Pon puertas", "Sin puertas"]],
  [/\bluz\b|luces|\bled\b|ilumina/,
   "La iluminación no la incluyo por ahora. Sin trasera, la luz de la habitación pasa entre los huecos.", ["Sin trasera", "Estilo minimalista"]],
  [/escritorio|\bmesa\b|\bcama\b|\bsilla\b|\bsofa\b/,
   "De momento solo diseño estanterías y muebles de almacenaje. Un mueble bajo con cajones o uno para la tele sí puedo.", ["Mueble bajo con cajones", "Para la tele"]],
  [/ruedas/,
   "Ruedas no pongo: el mueble apoya en patas, en zócalo o va colgado de la pared.", ["Con patas", "Con zócalo", "A la pared"]],
  [/\bmetal|\bacero|\bhierro/,
   "Solo trabajo con tablero; el negro mate da un aire industrial muy parecido.", ["Estilo industrial", "Hazla negra"]],
  [/tirador/,
   "Los tiradores son de serie en negro mate; todavía no se pueden cambiar.", ["Pon puertas"]],
];

const HELP = "Puedo cambiar las medidas («un metro ochenta de ancho», «que quepa en un hueco de 2,10 m»), el acabado, las columnas, las baldas, los cajones, las puertas, las patas y la trasera. También entiendo estilos («nórdico», «industrial»), usos («para vinilos», «para el recibidor») y presupuesto («que cueste menos de 1000 €»). Y te respondo cuánto cuesta, cuánto pesa o cuánto aguanta.";

/* Preguntas: se contestan con los datos reales del diseño actual. */
function infoAnswer(s, cur) {
  const has = (re) => re.test(s);
  if (has(/cuanto (?:cuesta|vale|sale|me sale)|que precio|el precio|presupuesto/) && !has(/barat|menos de|economic|baja|reduc/)) {
    const q = priceOf(cur);
    return { ask: `Ahora mismo sale por ${eur(q.gross)}, con IVA y envío peninsular incluidos. Se recalcula con cada cambio.`,
             suggest: ["Hazla más barata", "Que cueste menos de 1000 €"] };
  }
  if (has(/aguanta (?:libros|peso|mucho|bien|el peso)|cuanto (?:peso )?(?:aguanta|soporta)|cuantos kilos|kilos? aguanta|es resistente|se comba|se doblan?/)) {
    const L = Math.max(...cur.columns.map((c) => c.width));
    const t = cur.thickness, E = MATERIALS[cur.material].E;
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
  if (has(/tarda|plazo|cuando llega|entrega|cuanto tiempo/)) {
    return { ask: "Entre 12 y 16 días desde el pedido: se corta por control numérico, se cantea y se envía en plano. El envío peninsular va incluido." };
  }
  if (has(/montar|montaje|instalar|dificil de montar|como se monta/)) {
    return { ask: "Llega en plano con cada pieza numerada y herrajes excéntricos. Se monta en 40–60 minutos con una llave Allen, y el manual sale de tu propio despiece." };
  }
  if (has(/recomiend|aconsej|que material|cual es mejor|que madera/)) {
    return { ask: "Para un salón, roble: cálido y resistente. Para un estilo nórdico, abedul, que se ve la chapa en los cantos. Nogal si quieres algo más elegante. Y melamina si prima el precio.",
             suggest: ["En roble", "Estilo nórdico", "Hazla más barata"] };
  }
  if (has(/que puedes hacer|que sabes hacer|\bayuda\b|como funciona|que se puede|que cosas/)) {
    return { ask: HELP, suggest: STARTERS };
  }
  return null;
}

const RESET = /(?:empieza|empezar|empezamos|comienza|vuelve a empezar|volver a empezar)\b.*\b(?:cero|nuevo|principio)|\bdesde cero\b|\bborra(?:r|lo)? todo\b|^quita(?:lo)? todo$|\belimina(?:r|lo)?\s+(?:este|esta|el|la|todo el|toda la)?\s*(?:armario|mueble|estanteria|diseno|todo)\b|\breset|\breinicia/;
const UNDO = /\bdeshaz|\bdeshacer|\bvuelve atras|\bcomo estaba\b|^no,? asi no|\banula (?:lo|eso|el ultimo)|\bmejor como antes/;
const GREET = /^(?:hola|buenas|hey|ey|buenos dias|buenas tardes|buenas noches)\b/;
const THANKS = /^(?:gracias|genial|perfecto|guay|vale|ok|okey|me gusta|muy bien)\b/;
const ASKS = [
  [/color|acabado|tono/, "Tengo cinco acabados: blanco, negro, abedul, roble y nogal. ¿Cuál te pongo?", ["Hazla blanca", "En nogal", "En roble"]],
  [/medida|tamano|dimension|cabe/, "Dime la medida y te la ajusto: «ancho 2,10 m», «que quepa en un hueco de 1,80» o «1,80 × 2,20».", ["Que quepa en un hueco de 2,10 m"]],
];

/**
 * Resuelve una petición contra el diseño actual.
 */
function parseCore(msg, current) {
  const s = spokenLengths(norm(msg));
  if (!s) return null;

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
  if (/(?:en|un|el)\s+hueco\s+de|entre pared|que quepa|caber|encaj|nicho|alcoba/.test(s)) {
    const v = parseLen((s.match(/(\d+(?:[.,]\d+)?\s*(?:mm|cm|m|metros?)?)/) || [])[1]);
    if (v && v >= 410 && v <= 3210) {
      n.width = v - 10;
      ch.push(`ancho ${mm(n.width)} mm`);
      notes.push("he dejado 10 mm de holgura para poder meterla en el hueco");
    }
  }

  /* ---- cuadrícula: «3x4 huecos», «cuadrícula de 3 por 4» ---- */
  let gridDone = false;
  const gridM = /hueco|cuadricula|casilla|cubo|fila/.test(s) ? s.match(/(\d)\s*(?:x|×|por)\s*(\d)\b/) : null;
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
  const H = grab(s, ["alt", "altura"]);
  const D = grab(s, ["fondo", "profundidad", "profund"]);   // "fondo" con número = profundidad
  if (W) { n.width = W; ch.push(`ancho ${mm(W)} mm`); }
  if (H && !legEdit) { n.height = H; ch.push(`alto ${mm(H)} mm`); }
  if (D) { n.depth = D; ch.push(`fondo ${mm(D)} mm`); }
  const xy = gridDone ? null : s.match(/(\d+(?:[.,]\d+)?)\s*(?:m|mm|cm)?\s*(?:x|×|por)\s*(\d+(?:[.,]\d+)?)\s*(m|mm|cm|metros?)?/);
  if (xy && !W && !H) {
    const a = parseLen(xy[1] + (xy[3] || "")), b = parseLen(xy[2] + (xy[3] || ""));
    if (a && b) { n.width = a; n.height = b; ch.push(`${mm(a)} × ${mm(b)} mm`); }
  }

  /* ---- una columna concreta: «la primera más ancha», «la segunda de 80 cm» ---- */
  let colEdit = false;
  const tc = whichCols(s, n);
  if (!gridDone && tc && tc.length === 1 && /columna|hueco/.test(s)) {
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

  /* ---- comparativos ---- */
  if (!colEdit) {
    if (/mas anch|ensanch|mas amplia/.test(s)) { n.width += mag; ch.push(`ancho ${mm(n.width)} mm`); }
    if (/mas estrech|menos anch|estrechala/.test(s)) { n.width -= mag; ch.push(`ancho ${mm(n.width)} mm`); }
    if (/mas grande|hazla grande/.test(s)) { n.width += mag; n.height += mag; ch.push("más grande"); }
    if (/mas peque|mas compact|menos grande/.test(s)) { n.width -= mag; n.height -= mag; ch.push("más pequeña"); }
  }
  if (!legEdit) {
    if (/mas alt|subela|hasta el techo|al techo/.test(s)) { n.height += /techo/.test(s) ? 500 : mag; ch.push(`alto ${mm(n.height)} mm`); }
    if (/mas baj|menos alt|bajala|mas cort/.test(s)) { n.height -= mag; ch.push(`alto ${mm(n.height)} mm`); }
  }
  if (/mas fond|mas hond|mas profund/.test(s)) { n.depth += 70; ch.push(`fondo ${mm(n.depth)} mm`); }
  if (/menos fond|poco fondo|menos profund/.test(s)) { n.depth -= 70; ch.push(`fondo ${mm(n.depth)} mm`); }

  /* ---- material, estilo y espesor ---- */
  const MSYN = [
    [/blanc/, "melamina_blanca"],
    [/negr|antracit/, "melamina_negra"],
    [/nogal|walnut|madera oscura/, "nogal"],          // antes que «madera» a secas
    [/abedul|contrachap|plywood|madera clara/, "abedul"],
    [/roble|\boak\b|madera natural|\bmadera\b/, "roble"],
  ];
  for (const [re, k] of MSYN) {
    if (re.test(s)) { n.material = k; ch.push(MATERIALS[k].short.toLowerCase()); break; }
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
  } else if (/zocalo|al suelo|hasta el suelo|pegada al suelo/.test(s)) {
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
  const colsOf = s.match(/(\d+|dos|tres|cuatro|cinco|seis|siete|ocho)\s*columnas?\s+de\s+(\d+(?:[.,]\d+)?\s*(?:mm|cm|m)?)/);
  const dCol = delta(s, "(?:columna|modulo|vano|division)");
  const nc = count(s, /(\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*(?:columnas?|modulos?|vanos?|cuerpos?)\b/);
  if (colsOf && !gridDone) {
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
  const every = s.match(/cada\s+(\d+(?:[.,]\d+)?\s*(?:mm|cm|m)?)/);
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
  if (gridDone) {
    // ya resuelto
  } else if (shelvesOff) {
    cols.forEach((c) => { c.shelves = []; });
    ch.push(`sin baldas${where}`);
  } else if (every && /balda|estante|repisa/.test(s)) {
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

  /* ---- cajones ---- */
  if (!comoda && /caj[oó]n|cajones|cajoner/.test(s)) {
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

  /* ---- puertas ---- */
  if (/puertas?/.test(s)) {
    const on = !isNeg(s, "puerta");
    (tgt ? tgt.map((x) => n.columns[x]) : n.columns).forEach((c) => { c.door = on; });
    ch.push(on ? "con puertas" : "sin puertas");
  }
  if (/cerrada|que no se vea|ocultar|esconder/.test(s) && !/puertas?|por detras/.test(s)) {
    n.columns.forEach((c) => { c.door = true; });
    n.back = true;
    ch.push("cerrada con puertas");
  }

  /* ---- usos y estancias ---- */
  for (const u of USES) {
    if (u.re.test(s)) {
      const note = u.apply(n);
      ch.push(`preparada para ${u.name}`);
      if (note) notes.push(note);
      break;
    }
  }

  /* ---- presupuesto: se prueban ahorros hasta llegar al precio ---- */
  const budgetM = s.match(/(?:menos de|por debajo de|maximo(?: de)?|como mucho|no mas de|hasta)\s*(\d[\d.]*)\s*(?:€|e\b|euros?)/);
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
      if (cheaper && !budgetM && applied.length) break;   // «más barata»: el ahorro más grande
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
const WHERE = /\btod[oa]s\b|\bcada\b|\bresto\b|\blados\b|\bcentro\b|\bmedio\b|\bprimer|\bsegund|\btercer|\bcuart|\bquint|\bsext|\bultim|izquierd|derech|\bcolumnas?\b|\bcuadros?\b|\bhuecos?\b|\bcasillas?\b|\bmodulos?\b|\btambien\b/;
const MOVE = /\bmejor\b|\bmueve\w*|\bpasa(?:los|las)?\b|\ben vez de\b|\bcambia(?:los|las)? de sitio/;
/* el sustantivo es el grupo 1; delante puede ir «dos», «una mas», «otra» */
const TOPIC = /(?:\b(?:\d+|un|una|dos|tres|cuatro|cinco|seis|otra|otro)\s+(?:mas\s+|menos\s+)?)?\b(cajon(?:es)?|baldas?|puertas?)\b(?:\s+(?:mas|menos)\b)?/;
export const topicOf = (msg) => (norm(msg).match(TOPIC) || [null])[0];

/**
 * Resuelve una petición contra el diseño actual.
 * ctx.topic: de qué se habló en el último cambio («cajones», «una balda mas»).
 * Devuelve además topic, para la siguiente frase.
 */
export function parseIntent(msg, current, ctx = {}) {
  let used = msg;
  let r = parseCore(msg, current);
  const s0 = norm(msg);
  if (!r && ctx.topic && WHERE.test(s0) && !TOPIC.test(s0)) {
    used = `${ctx.topic} ${msg}`;
    r = parseCore(used, current);
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
  "Cajones en todas las columnas", "Mejor los cajones a la derecha", "Deshaz",
];
