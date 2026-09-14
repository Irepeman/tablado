/* ============================================================
   CAPA 1 — MOTOR DE INTENCIÓN LOCAL
   Corre en el navegador. Sin llamada de red, sin coste y sin espera.
   Resuelve la gran mayoría de las ediciones reales; solo lo que no
   entiende sube a /api/design, donde está el modelo.

   Esto no es un atajo: es lo que mantiene plana la factura de modelo
   por sesión de diseño y a cero la latencia percibida.
   ============================================================ */
import {
  MATERIALS, DRAWER_H, clamp, deepCopy, addColumn,
  redistribute, setShelfCount, spaceShelves,
} from "./model.js";

const mm = (v) => Math.round(v).toLocaleString("es-ES");

export const norm = (t) =>
  t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\bq\b/g, "que").replace(/\bxq\b/g, "porque")
    .replace(/\bpa\b/g, "para").replace(/\btb\b/g, "tambien")
    .replace(/\s+/g, " ");

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
   "quítale las puertas" son la misma intención expresada de tres formas. */
const NEG = "(?:sin|no quiero|no queremos|no me|no lleva|no lleve|no tenga|no tiene|no pongas|no le pongas|no hace falta|quita|quitale|quitame|saca|sacale|elimina|borra|nada de|fuera|prescindir|olvidate)";
const POS = "(?:con|quiero|queremos|ponle|pon|poner|mete|metele|anade|anadele|agrega|dale|que tenga|que lleve|que haya|necesito|me gustaria|incluye)";
const isNeg = (s, c) => new RegExp(NEG + "[^.;,]{0,34}" + c).test(s);
const isPos = (s, c) => new RegExp(POS + "[^.;,]{0,34}" + c).test(s);

/* "una balda más" es +1, no "exactamente 1".
   Distinguir incremento de cantidad absoluta es lo que separa
   entender de hacer coincidir palabras. */
function delta(s, pat) {
  const inc = new RegExp(pat + "s?\\s+(?:mas|extra|adicionales?)|(?:otra|otro|una?\\s+mas|uno\\s+mas)\\s+" + pat + "|mas\\s+" + pat + "s?");
  const dec = new RegExp(pat + "s?\\s+menos|menos\\s+" + pat + "s?|(?:quita|quitale|saca|sacale|elimina|borra)\\w*[^.;,]{0,22}" + pat + "s?\\b");
  if (dec.test(s)) return -1;
  if (inc.test(s)) return 1;
  return null;
}

function whichCols(s, n) {
  const ord = { primera: 0, segunda: 1, tercera: 2, cuarta: 3,
                quinta: 4, sexta: 5, septima: 6, octava: 7 };
  if (/\btodas\b|\bcada\b|\btodos los\b|en general/.test(s)) return n.columns.map((_, k) => k);
  for (const k in ord) if (s.includes(k) && ord[k] < n.columns.length) return [ord[k]];
  const m = s.match(/columna\s*(?:numero\s*)?(\d+)/);
  if (m) return [clamp(Number(m[1]) - 1, 0, n.columns.length - 1)];
  if (/ultima|del final|a la derecha|\bderecha\b|\bderecho\b/.test(s)) return [n.columns.length - 1];
  if (/a la izquierda|\bizquierda\b|\bizquierdo\b|del principio/.test(s)) return [0];
  if (/\bcentro\b|central|en medio|del medio/.test(s)) return [Math.floor((n.columns.length - 1) / 2)];
  return null;
}

/* Presets de uso: aquí vive el conocimiento de oficio.
   Las medidas no son decorativas — un LP mide 315 mm. */
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
  { re: /zapat|calzado/, name: "zapatos", apply: (n) => {
      n.depth = 300; n.columns.forEach((c) => spaceShelves(n, c, 200));
      return "fondo 300 mm y huecos de 200 mm"; } },
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

/* Cuando reconozco el tema pero falta el dato, preguntar es mejor
   que adivinar — y no cuesta una llamada al modelo. */
const ASKS = [
  [/color|acabado|tono/, "Tengo cinco acabados: blanco, negro, abedul, roble y nogal. ¿Cuál te pongo?"],
  [/precio|cuesta|barat|caro|presupuesto/, "El precio se recalcula solo, abajo a la derecha. Para bajarlo: melamina en vez de chapado, menos fondo o menos columnas."],
  [/enviar|entrega|plazo|cuando llega/, "El plazo estimado sale en la ficha técnica: 12–16 días, y el envío peninsular ya va en el precio."],
  [/montar|montaje|instalar|dificil/, "Llega en plano con el despiece numerado y herrajes excéntricos. Entre 40 y 60 minutos con una llave Allen."],
  [/medida|tamano|dimension|cabe/, "Dime la medida y te la ajusto: «ancho 2,10 m», «que quepa en un hueco de 1,80» o «1,80 × 2,20»."],
];

/**
 * Resuelve una petición contra el diseño actual.
 * @returns {null | {ask:string} | {params:object, changes:string[], notes:string[]}}
 */
export function parseIntent(msg, current) {
  const n = deepCopy(current);
  const s = norm(msg);
  const ch = [];
  const notes = [];
  const Hi = () => n.height - n.baseHeight - 2 * n.thickness;

  /* ---- medidas ---- */
  if (/hueco|entre pared|que quepa|caber|encaj|nicho|alcoba/.test(s)) {
    const v = parseLen((s.match(/(\d+(?:[.,]\d+)?\s*(?:mm|cm|m|metros?)?)/) || [])[1]);
    if (v && v >= 410 && v <= 3210) {
      n.width = v - 10;
      ch.push(`ancho ${mm(n.width)} mm`);
      notes.push("he dejado 10 mm de holgura para poder meterla en el hueco");
    }
  }
  const W = grab(s, ["anch", "ancho", "anchura", "largo"]);
  const H = grab(s, ["alt", "altura"]);
  const D = grab(s, ["fondo", "profundidad", "profund"]); // "fondo" con número = profundidad
  if (W) { n.width = W; ch.push(`ancho ${mm(W)} mm`); }
  if (H) { n.height = H; ch.push(`alto ${mm(H)} mm`); }
  if (D) { n.depth = D; ch.push(`fondo ${mm(D)} mm`); }

  const xy = s.match(/(\d+(?:[.,]\d+)?)\s*(?:m|mm|cm)?\s*(?:x|×|por)\s*(\d+(?:[.,]\d+)?)\s*(m|mm|cm|metros?)?/);
  if (xy && !W && !H) {
    const a = parseLen(xy[1] + (xy[3] || "")), b = parseLen(xy[2] + (xy[3] || ""));
    if (a && b) { n.width = a; n.height = b; ch.push(`${mm(a)} × ${mm(b)} mm`); }
  }

  const mag = /un poco|ligera|algo mas|un pelin|poquito/.test(s) ? 130
            : /bastante|mucho|bien mas|el doble/.test(s) ? 450 : 260;
  if (/mas anch|ensanch|mas grande|mas amplia/.test(s)) { n.width += mag; ch.push(`ancho ${mm(n.width)} mm`); }
  if (/mas estrech|menos anch|mas peque|estrechala/.test(s)) { n.width -= mag; ch.push(`ancho ${mm(n.width)} mm`); }
  if (/mas alt|subela|hasta el techo|al techo/.test(s)) { n.height += /techo/.test(s) ? 500 : mag; ch.push(`alto ${mm(n.height)} mm`); }
  if (/mas baj|menos alt|bajala|mas cort/.test(s)) { n.height -= mag; ch.push(`alto ${mm(n.height)} mm`); }
  if (/mas fond|mas hond|mas profund/.test(s)) { n.depth += 70; ch.push(`fondo ${mm(n.depth)} mm`); }
  if (/menos fond|mas fina|poco fondo|menos profund/.test(s)) { n.depth -= 70; ch.push(`fondo ${mm(n.depth)} mm`); }

  /* ---- material y espesor ---- */
  const MSYN = [
    [/blanc/, "melamina_blanca"],
    [/negr|antracit/, "melamina_negra"],
    [/nogal|walnut|madera oscura/, "nogal"],          // antes que «madera» a secas
    [/abedul|contrachap|plywood|madera clara|escandinav|nordic/, "abedul"],
    [/roble|\boak\b|madera natural|\bmadera\b/, "roble"],
  ];
  for (const [re, k] of MSYN) {
    if (re.test(s)) { n.material = k; ch.push(MATERIALS[k].short.toLowerCase()); break; }
  }

  const th = s.match(/(\d{2})\s*mm\s*(?:de\s*)?(?:espesor|grosor|grueso)/) ||
             s.match(/(?:espesor|grosor)\s*(?:de\s*)?(\d{2})/);
  if (th) {
    const v = [16, 18, 22].reduce((a, b) =>
      Math.abs(b - Number(th[1])) < Math.abs(a - Number(th[1])) ? b : a);
    n.thickness = v; ch.push(`espesor ${v} mm`);
  } else if (/mas gruesa|mas resistente|refuerza|que aguante|mas robusta|mas fuerte/.test(s)) {
    n.thickness = n.thickness === 16 ? 18 : 22;
    ch.push(`espesor ${n.thickness} mm`);
  }

  /* ---- base y trasera ---- */
  const CPATA = "(?:patas|pies|apoyos)";
  if (/flotante|a la pared|en la pared|suspend|colgad|volad|que flote/.test(s) || isNeg(s, CPATA)) {
    n.base = "flotante"; n.baseHeight = 0; ch.push("suspendida");
  } else if (isPos(s, CPATA) || /\bpatas\b/.test(s)) {
    n.base = "patas"; n.baseHeight = 110; ch.push("con patas");
  } else if (/zocalo|al suelo|hasta el suelo|pegada al suelo/.test(s)) {
    n.base = "zocalo"; n.baseHeight = 80; ch.push("con zócalo");
  }

  const CBACK = D ? "(?:trasera|panel trasero|espalda|por detras)"
                  : "(?:trasera|fondo|panel trasero|espalda|por detras)";
  if (isNeg(s, CBACK) || /abierta por detras|pasante|difana|se vea la pared/.test(s)) {
    n.back = false; ch.push("sin trasera");
  } else if (isPos(s, CBACK) || /cerrada por detras|tape la pared/.test(s)) {
    n.back = true; ch.push("con trasera");
  }

  /* ---- columnas ---- */
  const dCol = delta(s, "(?:columna|modulo|vano|division)");
  const nc = count(s, /(\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*(?:columnas?|modulos?|vanos?|cuerpos?)\b/);
  if (dCol != null) {
    if (dCol > 0) addColumn(n);
    else if (n.columns.length > 1) n.columns.pop();
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
  const dSh = delta(s, "(?:balda|estante|repisa|nivel)");
  const nb = count(s, /(\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho)\s*(?:baldas?|estantes?|niveles?|repisas?|alturas?)\b/);
  // «quita las baldas» vacía la columna; «una balda menos» quita solo una
  const shelvesOff = /(?:quita\w*|saca\w*|elimina\w*|borra\w*)\s+(?:todas\s+)?las\s+(?:baldas|estantes|repisas)\b|sin baldas|nada de baldas|ninguna balda/.test(s);
  const every = s.match(/cada\s+(\d+(?:[.,]\d+)?\s*(?:mm|cm|m)?)/);
  if (shelvesOff) {
    cols.forEach((c) => { c.shelves = []; });
    ch.push(`sin baldas${tgt ? " en esa columna" : ""}`);
  } else if (every && /balda|estante|repisa|nivel/.test(s)) {
    const gap = clamp(parseLen(every[1]), 150, 800);
    cols.forEach((c) => spaceShelves(n, c, gap));
    ch.push(`baldas cada ${mm(gap)} mm`);
  } else if (dSh != null) {
    cols.forEach((c) => setShelfCount(n, c, c.shelves.length + dSh));
    ch.push(`una balda ${dSh > 0 ? "más" : "menos"}${tgt ? " en esa columna" : ""}`);
  } else if (nb != null) {
    cols.forEach((c) => setShelfCount(n, c, nb));
    ch.push(`${nb} balda${nb === 1 ? "" : "s"}${tgt ? " en esa columna" : ""}`);
  } else if (isPos(s, "(?:baldas?|estantes?)\\b")) {
    cols.forEach((c) => setShelfCount(n, c, c.shelves.length + 1));
    ch.push("una balda más");
  }

  /* ---- cajones y puertas ---- */
  if (/caj[oó]n|cajones|cajoner/.test(s)) {
    const dDr = delta(s, "(?:cajon|cajoner)");
    const target = tgt ? tgt.map((x) => n.columns[x]) : [n.columns[0]];
    const drawersOff = /(?:quita\w*|saca\w*|elimina\w*|borra\w*)\s+(?:todos\s+)?los\s+cajones\b|sin cajones|nada de cajones|ningun cajon/.test(s);
    if (drawersOff) {
      (tgt ? target : n.columns).forEach((c) => { c.drawers = 0; });
      ch.push("sin cajones");
    } else if (dDr != null) {
      target.forEach((c) => { c.drawers = clamp(c.drawers + dDr, 0, 4); });
      ch.push(`un cajón ${dDr > 0 ? "más" : "menos"}${tgt ? " en esa columna" : ""}`);
    } else {
      const k = isNeg(s, "caj") ? 0
              : (count(s, /(\d+|un|una|dos|tres|cuatro)\s*cajones?\b/) ?? 2);
      target.forEach((c) => { c.drawers = clamp(k, 0, 4); });
      ch.push(k ? `${k} ${k === 1 ? "cajón" : "cajones"}${tgt ? " en esa columna" : ""}` : "sin cajones");
    }
  }
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

  /* ---- presets de uso ---- */
  for (const u of USES) {
    if (u.re.test(s)) {
      const note = u.apply(n);
      ch.push(`preparada para ${u.name}`);
      if (note) notes.push(note);
      break;
    }
  }

  if (!ch.length) {
    for (const [re, q] of ASKS) if (re.test(s)) return { ask: q };
    return null;
  }
  return { params: n, changes: ch, notes };
}
