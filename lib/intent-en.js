/* ============================================================
   CHAT EN INGLÉS
   Un solo motor para los dos idiomas: la frase en inglés se traduce
   al español canónico que ya entiende parseIntent() —probado con 106
   frases— y la respuesta se traduce de vuelta. Así no hay dos motores
   que acaben diciendo cosas distintas. tests/chat-en.mjs lo comprueba.
   ============================================================ */
import { parseIntent, fallback, ALL_SUGGESTIONS, EN_TEXT } from "./intent.js";

/* ---------- entrada: inglés → español. El orden importa. ---------- */
const IN = [
  [/[’‘]/g, "'"],
  [/(\d),(\d{3})\b/g, "$1$2"],                               // 1,800 → 1800
  [/\bmet(?:er|re)s?\b/g, "m"], [/\bcentimet(?:er|re)s?\b/g, "cm"], [/\bmillimet(?:er|re)s?\b/g, "mm"],
  [/\b(\d{2,3})[\s-]*(?:inches|inch|")/g, " $1 pulgadas "],
  [/\b(?:inches|inch|feet|foot|ft)\b/g, " unidad_imperial "],
  [/€\s*(\d[\d.]*)/g, "$1 €"],                               // €1000 → 1000 €
  [/\b(\d[\d.]*)\s*(?:euros?|eur)\b/g, "$1 €"],
  /* órdenes sobre el diseño entero */
  [/\b(?:start (?:over|again|from scratch)|from scratch|begin again|reset(?: it| the design)?)\b/g, " empieza de cero "],
  [/\b(?:delete|clear|remove) everything\b|\bdelete it all\b/g, " borra todo "],
  [/\b(?:delete|remove|erase|clear|scrap)\s+(?:this|the)?\s*(?:unit|bookcase|shelving unit|cabinet|design|thing)\b/g, " elimina este armario "],
  [/\b(?:undo(?: that| it)?|go back|revert(?: that)?|put it back)\b/g, " deshaz "],
  /* presupuesto, antes que «cost» como pregunta */
  [/\b(?:that )?costs? (?:less than|under|below|at most)\s*/g, " que cueste menos de "],
  [/\b(?:under|below|less than|at most|no more than|max(?:imum)?(?: of)?)\s+(?=\d[\d.]*\s*€)/g, " menos de "],
  [/\b(?:cheaper|less expensive|more affordable|lower the price|reduce the price)\b/g, " mas barata "],
  /* vocabulario de conversación y compra (antes que las reglas genéricas) */
  [/\b(?:bottom|lower) (?:row|boxes|cubbies|compartments|cells|section|part|ones)\b/g, " fila de abajo "],
  [/\b(?:top|upper) (?:row|boxes|cubbies|compartments|cells|section|part|ones)\b/g, " fila de arriba "],
  [/\bmiddle (?:row|boxes|compartments|section)\b/g, " fila del medio "],
  [/\bdoors? (?:at the bottom|below|down low)\b|\bbottom doors\b/g, " puertas abajo "],
  [/\b(?:hanging|clothes|closet|wardrobe) (?:rail|rod|bar)\b|\bto hang (?:clothes|coats|shirts|things)\b|\bhangers?\b/g, " barra de colgar "],
  [/\b(?:no|remove the|take out the) (?:hanging |clothes )?rail\b/g, " sin barra "],
  [/\b(?:bigger|larger|taller|deeper) drawers\b/g, " cajones mas grandes "],
  [/\broom divider\b|\bdivide the room\b|\bseparate (?:the )?(?:spaces|rooms)\b/g, " separar ambientes "],
  [/\b(?:split|divide) (?:it )?into\b/g, " dividela en "],
  [/\b(?:all but|all except|everything but|except(?: for)?|apart from|other than)\b/g, " todas menos "],
  [/\b(?:alternat\w*|every other)\b/g, " alternas "],
  [/\bonly\b/g, " solo "],
  [/\b(?:remove|take out|delete) the (?:top|highest|upper) shelf\b/g, " quita la balda de arriba "],
  [/\b(?:remove|take out|delete) the (?:bottom|lowest) shelf\b/g, " quita la balda de abajo "],
  [/\bthe (?:middle|center|centre) (?:one|column)\b/g, " la del medio "],
  [/\bunder (?:the |a )?window\b/g, " debajo de la ventana "], [/\bwindow\b/g, " ventana "], [/\bradiator\b/g, " radiador "],
  [/\bsliding\b/g, " correderas "],
  [/\boff[- ]white\b|\bivory\b|\bcream\b/g, " blanco roto "],
  [/\bwood(?:en)? colou?r\b/g, " color madera "],
  [/\bdark (?:oak|wood)\b/g, " roble oscuro "],
  [/\bsolid wood\b/g, " madera maciza "],
  [/\bbeech\b/g, " haya "], [/\bpine\b/g, " pino "], [/\bcherry\b/g, " cerezo "], [/\bteak\b/g, " teca "], [/\bmaple\b/g, " arce "],
  [/\b(?:tall|high|long) legs\b/g, " patas altas "],
  [/\b(?:standing )?on the floor\b|\bfloor level\b/g, " en el suelo "],
  [/\b(?:comics?|manga|magazines?)\b/g, " comics "],
  [/\b(?:dvds?|blu-?rays?|video ?games|films|movies)\b/g, " dvds "], [/\bcds\b|\bcd\b/g, " cds "],
  [/\b(?:bathroom|towels)\b/g, " bano "], [/\b(?:garage|shed|storage room|heavy loads?)\b/g, " garaje "],
  [/\b(?:wardrobe|closet)\b/g, " armario "],
  [/\b(?:bedside table|nightstand|night stand)\b/g, " mesita de noche "],
  [/\b(?:sideboard|buffet|credenza)\b/g, " aparador "],
  [/\bcorner(?: unit| shelf| bookcase)?\b|\bl-shaped\b/g, " esquina "],
  [/\b(?:sloped|slanted|sloping) ceiling\b|\battic\b/g, " techo inclinado "],
  [/\bstepped\b/g, " escalonada "],
  [/\bwhy (?:is it |does it cost )?(?:so )?(?:expensive|much)\b|\b(?:too|so) expensive\b/g, " por que es tan caro "],
  [/\b(?:discounts?|promo(?: codes?)?|coupons?)\b/g, " descuentos "],
  [/\bcanary islands\b|\bcanaries\b/g, " canarias "], [/\bbalearic(?: islands)?\b/g, " baleares "],
  [/\b(?:do you )?(?:ship|deliver)\b/g, " envian "],
  [/\b(?:return it|send it back|refund|returns?)\b/g, " devolver "],
  [/\b(?:come|comes|arrive|arrives)(?: already)? (?:assembled|built)\b|\bpre-?assembled\b/g, " viene montada "],
  [/\btake it apart\b|\bdisassembl\w*|\bdismantl\w*/g, " desmontar "],
  [/\btools?\b/g, " herramientas "],
  [/\bwarranty\b|\bguarantee\b/g, " garantia "],
  [/\bwhat(?:'s| is) it made (?:of|from)\b|\bwhat material is it\b/g, " de que material es "],
  [/\bsustainab\w*|\beco[- ]?friendly\b|\benvironment\w*|\bwaste\b/g, " sostenible "],
  [/\banchor\w*|\btip(?:ping)? over\b|\bfall over\b/g, " anclaje "],
  [/\bi (?:don't|do not|dont) like it\b/g, " no me gusta "],
  [/\bsurprise me\b|\byou (?:choose|decide|pick)\b/g, " sorprendeme "],
  [/\b(?:the )?(?:previous one|previous version|one before)\b/g, " la anterior "],
  [/\bbudget(?: is)?(?: of)?\s*/g, " presupuesto de "],
  [/\bas cheap as possible\b|\bcheapest(?: possible| option)?\b/g, " lo mas barato posible "],
  /* preguntas */
  [/\bhow much (?:weight )?(?:can|will|does) (?:it|each shelf|a shelf|the shelves) (?:hold|take|support|carry)\b|\bhow strong is it\b|\b(?:can|will) it hold (?:books|weight)\b|\bwill (?:it|the shelves) sag\b|\bhold books\b/g, " cuanto peso aguanta "],
  [/\bhow (?:much does it weigh|heavy is it|heavy)\b|\b(?:its|the) weight\b/g, " cuanto pesa "],
  [/\bhow many (?:pieces|parts|panels|boards)\b/g, " cuantas piezas "],
  [/\b(?:hold|support|carry)\b/g, " aguanta "],
  [/\bhow long\b[^?]*|\bdelivery time\b|\bwhen (?:will|does) it arrive\b|\blead time\b/g, " cuanto tarda "],
  [/\b(?:hard|difficult|easy) to (?:assemble|build|put together)\b|\bhow (?:do i|to) assemble(?: it)?\b|\bassembly\b/g, " dificil de montar "],
  [/\b(?:what|which) (?:material|wood|finish)\b[^?]*\brecommend\b|\bdo you recommend\b|\bwhich (?:material|wood) is best\b/g, " que material me recomiendas "],
  [/\bwhat can you do\b|\bhow does (?:this|it) work\b|^\s*help\b/g, " que puedes hacer "],
  [/\bhow much\b[^?]*|\bwhat(?:'s| is) the (?:price|cost)\b|^\s*(?:price|cost)\b/g, " cuanto cuesta "],
  [/^\s*(?:hi|hello|hey|good (?:morning|afternoon|evening))\b/g, " hola "],
  [/^\s*(?:thanks|thank you|great|perfect|awesome|cool|nice)\b/g, " gracias "],
  /* negación y conectores (el motor corta las negaciones en «y», «con», «pero») */
  [/\bi (?:don't|do not|dont) want\b/g, " no quiero "],
  [/\bi (?:want|would like|'d like|need)\b/g, " quiero "],
  [/\b(?:and|also)\b/g, " y "], [/\bbut\b/g, " pero "],
  /* hueco */
  [/\bfits? (?:it )?(?:in(?:to)?|inside) (?:a|an|the) (\d[\d.]*\s*(?:mm|cm|m)?) (?:gap|space|alcove|niche|recess|opening)\b/g, " que quepa en un hueco de $1 "],
  [/\bfits? (?:it )?(?:in(?:to)?|inside) (?:a|an|the) (?:gap|space|alcove|niche|recess|opening)(?: of)?\b/g, " que quepa en un hueco de "],
  /* una columna concreta con medida: «first column 80 cm (wide)» */
  [/\b(?:column|section|bay)\s+(?:to\s+)?(\d[\d.]*\s*(?:mm|cm|m))(?:\s+wide)?\b/g, " columna de $1 "],
  [/\b(?:equal|even) (?:width )?columns\b|\bcolumns (?:the )?same width\b|\beven out (?:the )?columns\b/g, " columnas iguales "],
  /* medidas */
  [/(\d[\d.]*\s*(?:mm|cm|m)?)\s+wide\b/g, "$1 de ancho "],
  [/(\d[\d.]*\s*(?:mm|cm|m)?)\s+(?:tall|high)\b/g, "$1 de alto "],
  [/(\d[\d.]*\s*(?:mm|cm|m)?)\s+deep\b/g, "$1 de fondo "],
  [/\bwidth\b/g, " ancho "], [/\bheight\b/g, " alto "], [/\bdepth\b/g, " fondo "],
  /* patas, antes que «taller» / «shorter» */
  [/\b(?:taller|higher|longer) legs\b/g, " patas mas altas "],
  [/\b(?:shorter|lower) legs\b/g, " patas mas bajas "],
  [/(\d[\d.]*\s*(?:mm|cm))\s+legs\b/g, " patas de $1 "],
  [/\blegs (?:of )?(\d[\d.]*\s*(?:mm|cm))/g, " patas de $1 "],
  /* baldas: mover y separar, antes que «lower» y «more» */
  [/\b(?:move|put) (?:the )?shelves (?:up|higher)\b|\braise (?:the )?shelves\b/g, " sube las baldas "],
  [/\b(?:move|put) (?:the )?shelves (?:down|lower)\b|\blower (?:the )?shelves\b/g, " baja las baldas "],
  [/\b(?:further|farther|more) apart\b|\bmore spread out\b|\bmore space between\b/g, " mas separadas "],
  [/\bcloser(?: together)?\b/g, " mas juntas "],
  [/\b(?:every|each)\s+(?=\d)/g, " cada "],
  /* quitar todo un tipo de pieza */
  [/\b(?:remove|take out|get rid of|delete) (?:all )?(?:the )?drawers\b/g, " quita los cajones "],
  [/\b(?:remove|take out|get rid of|delete) (?:all )?(?:the )?shelves\b/g, " quita las baldas "],
  /* comparativos */
  [/\b(?:a (?:little|bit)|slightly|a touch)\b/g, " un poco "],
  [/\b(?:a lot|way|much)\b/g, " mucho "],
  [/\bmake (?:it|the (?:unit|bookcase|shelving))\b/g, " hazla "],
  [/\bwider\b/g, " mas ancha "], [/\bnarrower\b/g, " mas estrecha "],
  [/\b(?:taller|higher)\b/g, " mas alta "], [/\b(?:shorter|lower)\b/g, " mas baja "],
  [/\bdeeper\b/g, " mas fondo "], [/\b(?:shallower|less deep|less depth)\b/g, " menos fondo "],
  [/\b(?:bigger|larger)\b/g, " mas grande "], [/\b(?:smaller|more compact)\b/g, " mas pequena "],
  [/\b(?:to the ceiling|floor to ceiling)\b/g, " hasta el techo "],
  [/\bceilings?\b/g, " techo "],
  [/\b(?:stronger|sturdier|more robust|thicker)\b/g, " mas resistente "],
  [/\b(?:thickness|thick)\b/g, " espesor "],
  /* material y estilo */
  [/\blight wood\b/g, " madera clara "], [/\bdark wood\b/g, " madera oscura "],
  [/\bwhite\b/g, " blanca "], [/\bblack\b/g, " negra "],
  [/\b(?:birch|plywood)\b/g, " abedul "], [/\boak\b/g, " roble "], [/\bwalnut\b/g, " nogal "],
  [/\bwood(?:en)?\b/g, " madera "],
  [/\b(?:nordic|scandinavian|scandi)\b/g, " nordico "], [/\bminimal(?:ist)?\b/g, " minimalista "],
  [/\b(?:elegant|luxury|luxurious|classy)\b/g, " elegante "], [/\b(?:warm(?:er)?|rustic|cosy|cozy)\b/g, " calida "],
  /* usos y estancias */
  [/\blow (?:unit|cabinet|sideboard) with drawers\b/g, " mueble bajo con cajones "],
  [/\b(?:dresser|chest of drawers)\b/g, " comoda "],
  [/\b(?:vinyl(?: records)?|records|lps)\b/g, " vinilos "],
  [/\b(?:paperbacks?|pocket books?)\b/g, " libros de bolsillo "],
  [/\bbooks?\b/g, " libros "], [/\bshoes?\b/g, " zapatos "],
  [/\b(?:hallway|entryway|entrance|hall)\b/g, " recibidor "], [/\b(?:kitchen|pantry)\b/g, " cocina "],
  [/\b(?:bedroom|clothes)\b/g, " dormitorio "], [/\bplants?\b/g, " plantas "],
  [/\b(?:tv|television)(?: unit| stand)?\b/g, " tele "], [/\b(?:kids|children|toys?)\b/g, " juguetes "],
  [/\b(?:office|files|folders|binders)\b/g, " archivadores "],
  /* lo que no hace: se traduce para que el motor dé la respuesta honesta */
  [/\bgr[ae]y\b/g, " gris "], [/\bred\b/g, " rojo "], [/\bblue\b/g, " azul "], [/\bgreen\b/g, " verde "],
  [/\byellow\b/g, " amarillo "], [/\bpink\b/g, " rosa "], [/\bpurple\b/g, " morado "],
  [/\bglass\b/g, " cristal "], [/\b(?:lights?|lighting|led)\b/g, " luces "],
  [/\bdesk\b/g, " escritorio "], [/\btable\b/g, " mesa "], [/\bbed\b/g, " cama "], [/\bchair\b/g, " silla "],
  [/\b(?:sofa|couch)\b/g, " sofa "], [/\b(?:wheels|casters|castors)\b/g, " ruedas "],
  [/\b(?:metal|steel|iron)\b/g, " metal "], [/\bhandles?\b/g, " tirador "],
  /* montaje */
  [/\b(?:wall[- ]mounted|wall[- ]hung|on the wall|floating|hang it(?: on the wall)?)\b/g, " a la pared "],
  [/\b(?:down to the floor|to the floor|floor[- ]standing)\b/g, " hasta el suelo "],
  [/\bopen back\b/g, " sin trasera "],
  [/\b(?:closed(?: off)?|hide (?:the )?contents)\b/g, " que no se vea "],
  /* piezas */
  [/\b(?:back panel|backing|back)\b/g, " trasera "],
  [/\bshelves\b/g, " baldas "], [/\bshelf\b/g, " balda "],
  [/\bdrawers\b/g, " cajones "], [/\bdrawer\b/g, " cajon "],
  [/\bdoors\b/g, " puertas "], [/\bdoor\b/g, " puerta "],
  [/\b(?:columns|sections|bays|modules)\b/g, " columnas "], [/\b(?:column|section|bay|module)\b/g, " columna "],
  [/\b(?:legs|feet)\b/g, " patas "], [/\b(?:plinth|kickboard|base ?board)\b/g, " zocalo "],
  [/\b(?:rows|levels|tiers)\b/g, " filas "], [/\bgrid\b/g, " cuadricula "],
  [/\b(?:cubbies|cubes|compartments|slots|cells|openings)\b/g, " huecos "], [/\b(?:gap|alcove|niche|recess)\b/g, " hueco "],
  /* posiciones */
  [/\bon (?:both )?(?:the )?(?:sides|ends)\b|\bthe (?:outer|side) ones\b/g, " en las de los lados "],
  [/\bthe (?:middle|central|inner) ones\b/g, " las del centro "],
  [/\bfirst\b/g, " primera "], [/\bsecond\b/g, " segunda "], [/\bthird\b/g, " tercera "],
  [/\bfourth\b/g, " cuarta "], [/\bfifth\b/g, " quinta "], [/\bsixth\b/g, " sexta "], [/\blast\b/g, " ultima "],
  [/\bleft\b/g, " izquierda "], [/\bright\b/g, " derecha "],
  [/\b(?:middle|center|centre)\b/g, " del medio "], [/\bbottom\b/g, " abajo "],
  [/\b(?:all|every|each)\b/g, " todas "],
  /* cantidades y verbos */
  [/\banother\b/g, " otra "], [/\bmore\b/g, " mas "], [/\b(?:less|fewer)\b/g, " menos "],
  [/\bone\b/g, " una "], [/\btwo\b/g, " dos "], [/\bthree\b/g, " tres "], [/\bfour\b/g, " cuatro "],
  [/\bfive\b/g, " cinco "], [/\bsix\b/g, " seis "], [/\bseven\b/g, " siete "], [/\beight\b/g, " ocho "],
  [/\b(?:a|an)\b/g, " una "],
  [/\bat\b/g, " a "],                                         // después de «a» → «una»
  [/\b(?:move|shift)\b|\binstead\b|\brather\b/g, " mejor "],
  [/\b(?:too|as well)\b/g, " tambien "],
  [/\b(?:boxes|cubbies)\b/g, " cuadros "],
  [/\b(?:add|include)\b/g, " anade "],
  [/\b(?:remove|take out|take away|get rid of|delete)\b/g, " quita "],
  [/\b(?:put|place|give it|give)\b/g, " pon "],
  [/\bwithout\b|\bno\b(?!\s+(?:me|quiero|en)\b)/g, " sin "], [/\bwith\b/g, " con "], [/\bby\b/g, " por "], [/\bof\b/g, " de "],
];

export function toSpanish(msg) {
  let s = ` ${String(msg || "").toLowerCase()} `;
  for (const [re, rep] of IN) s = s.replace(re, rep);
  return s.replace(/\s+/g, " ").trim();
}

/* ---------- salida: español → inglés ---------- */
const HELP_EN = "I can change the size (“1.80 m wide”, “fit it into a 2.10 m gap”), the finish, columns, shelves, drawers, doors, legs and back panel. I also understand styles (“Nordic”, “industrial”), uses (“for vinyl records”, “for the hallway”) and budget (“under €1000”). And I can tell you what it costs, weighs or can hold.";

/* respuestas completas y avisos */
const OUT_FULL = [
  [/^Ahora mismo sale por (.+?), con IVA y envío peninsular incluidos\. Se recalcula con cada cambio\.$/,
   "Right now it's $1, VAT and mainland Spain shipping included. It updates with every change."],
  [/^Cada balda de la columna más ancha \((\S+) mm\) aguanta unos (\S+) kg repartidos sin combarse a la vista\. Una balda llena de libros pesa unos (\S+) kg, así que va sobrada\.$/,
   "Each shelf in the widest column ($1 mm) holds about $2 kg spread evenly without visible sag. A shelf full of books weighs about $3 kg, so there's plenty of margin."],
  [/^Cada balda de la columna más ancha \((\S+) mm\) aguanta unos (\S+) kg repartidos sin combarse a la vista\. Una balda llena de libros pesa unos (\S+) kg, así que va justa: sube el espesor o añade una columna\.$/,
   "Each shelf in the widest column ($1 mm) holds about $2 kg spread evenly without visible sag. A shelf full of books weighs about $3 kg, so it's tight: go thicker or add a column."],
  [/^Montada pesa unos (\S+) kg\. Llega en (\S+) o (\S+) cajas planas\.$/,
   "Assembled it weighs about $1 kg. It ships in $2 or $3 flat boxes."],
  [/^Son (\S+) piezas, cortadas de (\S+) tableros\. El despiece completo está en el panel de la derecha\.$/,
   "$1 pieces, cut from $2 boards. The full cut list is in the right-hand panel."],
  [/^Entre 12 y 16 días[\s\S]*$/, "12 to 16 days from order: CNC-cut, edge-banded and shipped flat. Mainland Spain shipping is included."],
  [/^Llega en plano con cada pieza numerada[\s\S]*$/, "It arrives flat with every piece numbered and cam-lock fittings. It takes 40–60 minutes with an Allen key, and the manual comes from your own cut list."],
  [/^Para un salón, roble[\s\S]*$/, "For a living room, oak: warm and hard-wearing. For a Nordic look, birch, with the plies showing on the edges. Walnut for something more elegant. And melamine if price comes first."],
  [/^¡Hola! Cuéntame qué quieres guardar o dónde va el mueble y lo ajusto\. /, "Hi! Tell me what you want to store or where the unit goes and I'll adjust it. "],
  [/Puedo cambiar las medidas[\s\S]*$/, HELP_EN],
  [/^¡A ti![\s\S]*$/, "You're welcome! We can keep refining it, or you can send it to manufacturing."],
  [/^Tengo cinco acabados[\s\S]*$/, "I have five finishes: white, black, birch, oak and walnut. Which one?"],
  [/^Dime la medida y te la ajusto[\s\S]*$/, "Give me the size and I'll adjust it: “2.10 m wide”, “fit it into a 1.80 m gap” or “1.80 × 2.20”."],
  [/^Ya está en la opción más económica[\s\S]*$/, "It's already the cheapest option at this size. To go lower, reduce the width or height."],
  [/^No he sabido traducir eso a un cambio[\s\S]*$/, "I couldn't turn that into a change. Try saying it another way, or tap a suggestion:"],
  [/^Ese color no lo tengo[\s\S]*$/, "I don't have that colour: the finishes are white, black, birch, oak and walnut."],
  [/^Puertas de cristal no hago todavía[\s\S]*$/, "No glass doors yet: every piece is cut from board. I can add wooden doors or leave the openings open."],
  [/^La iluminación no la incluyo por ahora[\s\S]*$/, "Lighting isn't included yet. Without a back panel, the room's light comes through the openings."],
  [/^De momento solo diseño estanterías[\s\S]*$/, "For now I only design shelving and storage. A low unit with drawers or a TV unit, yes."],
  [/^Ruedas no pongo[\s\S]*$/, "No wheels: the unit stands on legs, on a plinth, or hangs on the wall."],
  [/^Solo trabajo con tablero[\s\S]*$/, "I only work with board; matt black gives a very similar industrial look."],
  [/^Los tiradores son de serie[\s\S]*$/, "Handles come standard in matt black and can't be changed yet."],
];

/* cambios aplicados (la lista de «ch») */
const USE_EN = {
  "vinilos": "vinyl records", "libro de bolsillo": "paperbacks", "libros": "books", "zapatos": "shoes",
  "cocina": "the kitchen", "dormitorio": "the bedroom", "plantas": "plants", "cómoda": "a chest of drawers",
  "archivo": "files", "mueble de TV": "a TV unit", "cuarto infantil": "a kids' room",
  "CDs": "CDs", "películas y videojuegos": "films and video games", "el baño": "the bathroom", "el garaje": "the garage",
  "separar ambientes": "dividing a room", "mesita de noche": "a bedside table", "aparador": "a sideboard",
};
const BUDGET = {
  "melamina blanca": "white melamine", "tablero de 16 mm": "16 mm board", "sin trasera": "no back panel",
  "sin puertas": "no doors", "sin cajones": "no drawers", "menos fondo": "less depth",
};
const OUT_CHANGE = [
  [/^ancho (\S+) mm$/, "width $1 mm"], [/^alto (\S+) mm$/, "height $1 mm"], [/^fondo (\S+) mm$/, "depth $1 mm"],
  [/^(\S+) × (\S+) mm$/, "$1 × $2 mm"],
  [/^cuadrícula de (\d) × (\d) huecos$/, "$1 × $2 grid"],
  [/^columna (\d+) de (\S+) mm$/, "column $1 at $2 mm"],
  [/^columnas iguales$/, "equal columns"],
  [/^armario$/, "wardrobe"], [/^barra de colgar$/, "hanging rail"], [/^sin barra de colgar$/, "no hanging rail"],
  [/^puertas$/, "doors"], [/^huecos abiertos$/, "open compartments"], [/^cajones más altos$/, "taller drawers"],
  [/^(\S+) × (\S+) × (\S+) mm$/, "$1 × $2 × $3 mm"],
  [/^sin la balda de arriba$/, "top shelf removed"], [/^sin la balda de abajo$/, "bottom shelf removed"],
  [/^estilo japandi$/, "Japandi style"], [/^estilo boho$/, "boho style"], [/^estilo vintage$/, "vintage style"],
  [/^más grande$/, "bigger"], [/^más pequeña$/, "smaller"],
  [/^blanco$/, "white"], [/^negro$/, "black"], [/^abedul$/, "birch"], [/^roble$/, "oak"], [/^nogal$/, "walnut"],
  [/^estilo nórdico$/, "Nordic style"], [/^estilo industrial$/, "industrial style"],
  [/^estilo minimalista$/, "minimalist style"], [/^más elegante$/, "more elegant"], [/^más cálida$/, "warmer"],
  [/^espesor (\d+) mm$/, "$1 mm thick"],
  [/^suspendida$/, "wall-hung"], [/^con patas$/, "on legs"], [/^con zócalo$/, "on a plinth"],
  [/^patas de (\S+) mm$/, "$1 mm legs"],
  [/^sin trasera$/, "no back panel"], [/^con trasera$/, "with a back panel"],
  [/^(\d+) columnas de (\S+) mm$/, "$1 columns of $2 mm"], [/^(\d+) columnas$/, "$1 columns"], [/^1 columna$/, "1 column"],
  [/^sin baldas$/, "no shelves"], [/^baldas cada (\S+) mm$/, "shelves every $1 mm"],
  [/^baldas 100 mm más arriba$/, "shelves 100 mm higher"], [/^baldas 100 mm más abajo$/, "shelves 100 mm lower"],
  [/^baldas más separadas$/, "shelves further apart"], [/^baldas más juntas$/, "shelves closer together"],
  [/^balda a (\S+) mm del suelo$/, "a shelf at $1 mm from the floor"],
  [/^(\d+) filas$/, "$1 rows"],
  [/^una balda más$/, "one more shelf"], [/^una balda menos$/, "one shelf fewer"],
  [/^(\d+) baldas más$/, "$1 more shelves"], [/^(\d+) baldas menos$/, "$1 fewer shelves"],
  [/^1 balda$/, "1 shelf"], [/^(\d+) baldas$/, "$1 shelves"],
  [/^sin cajones$/, "no drawers"],
  [/^un cajón más$/, "one more drawer"], [/^un cajón menos$/, "one drawer fewer"],
  [/^(\d+) cajones más$/, "$1 more drawers"], [/^(\d+) cajones menos$/, "$1 fewer drawers"],
  [/^1 cajón$/, "1 drawer"], [/^(\d+) cajones$/, "$1 drawers"],
  [/^con puertas$/, "with doors"], [/^sin puertas$/, "no doors"], [/^cerrada con puertas$/, "closed with doors"],
  [/^preparada para (.+)$/, (_, x) => `set up for ${USE_EN[x] || x}`],
];

/* notas */
const TAIL = {
  "": "", " — un LP mide 315 mm": " — an LP is 315 mm",
  ", a la medida de tarros y botes": ", sized for jars and tins", ", medida de archivador": ", sized for binders",
};
const OUT_NOTE = [
  [/^he dejado 10 mm de holgura para poder meterla en el hueco$/, "I left 10 mm of clearance so it slides into the gap"],
  [/^he dejado 10 mm de holgura en cada medida para poder meterla en el hueco$/, "I left 10 mm of clearance on each side so it fits the gap"],
  [/^10 mm menos de alto para que quepa debajo$/, "10 mm lower so it fits underneath"],
  [/^con (\S+) mm de techo, así puedes levantarla sin que roce$/, "with a $1 mm ceiling, so you can stand it up without scraping"],
  [/^(\S+) mm de ancho para una tele de (\d+) pulgadas$/, "$1 mm wide for a $2-inch TV"],
  [/^fondo (\S+) mm y huecos de (\S+) mm(.*)$/, (_, a, b, tail) => `${a} mm deep with ${b} mm openings${TAIL[tail] ?? ""}`],
  [/^fondo (\S+) mm, cerrada con puertas$/, "$1 mm deep, closed with doors"],
  [/^sin trasera para que pase la luz, fondo (\S+) mm$/, "no back panel so light comes through, $1 mm deep"],
  [/^altura (\S+) mm con cajones en todas las columnas$/, "$1 mm high with drawers in every column"],
  [/^altura (\S+) mm, fondo (\S+) mm y cajones alternos$/, "$1 mm high, $2 mm deep with alternating drawers"],
  [/^altura (\S+) mm para que lleguen, y anclaje antivuelco$/, "$1 mm high so children can reach, with an anti-tip anchor"],
  [/^el precio pasa de (.+?) a (.+?)(; por debajo de eso no llego sin cambiar las medidas)?$/,
   (_, a, b, lim) => `the price goes from ${a} to ${b}${lim ? "; I can't go lower without changing the size" : ""}`],
  [/^ese color no lo tengo/, "I don't have that colour"],
  [/^puertas de cristal no hago todavía/, "no glass doors yet"],
  [/^la iluminación no la incluyo/, "no lighting yet"],
  [/^de momento solo diseño estanterías/, "I only design shelving for now"],
  [/^ruedas no pongo/, "no wheels"],
  [/^solo trabajo con tablero/, "board only, no metal"],
  [/^los tiradores son de serie/, "handles are standard matt black"],
];

/* 2.090 → 2,090 · 1.433 € → €1,433 */
const numsEN = (s) => s.replace(/(\d)\.(\d{3})(?!\d)/g, "$1,$2")
  .replace(/(\d[\d,]*)\s*€/g, (_, v) => "€" + Number(v.replace(/,/g, "")).toLocaleString("en-IE"));

export function toEnglish(text) {
  if (!text) return text;
  if (EN_TEXT.has(text)) return numsEN(EN_TEXT.get(text));
  let s = text;
  for (const [re, rep] of OUT_FULL) s = s.replace(re, rep);
  return numsEN(s);
}
function changeEN(c) {
  let core = c, where = "";
  const SUF = [[/ en la fila de abajo$/, () => " in the bottom row"], [/ en la fila de arriba$/, () => " in the top row"],
               [/ en la fila del medio$/, () => " in the middle row"],
               [/ en todas las columnas$/, () => " in every column"], [/ en esas columnas$/, () => " in those columns"],
               [/ en la columna (\d+)$/, (m) => ` in column ${m[1]}`], [/ en esa columna$/, () => " in that column"]];
  for (const [re, fn] of SUF) {
    const m = core.match(re);
    if (m) { where = fn(m); core = core.slice(0, m.index); break; }
  }
  const parts = core.split(", ");
  if (parts.every((x) => BUDGET[x])) return parts.map((x) => BUDGET[x]).join(", ");
  for (const [re, rep] of OUT_CHANGE) if (re.test(core)) return numsEN(core.replace(re, rep)) + where;
  return numsEN(core) + where;
}
function noteEN(n) {
  if (EN_TEXT.has(n)) return numsEN(EN_TEXT.get(n));
  for (const [re, rep] of OUT_NOTE) if (re.test(n)) return numsEN(n.replace(re, rep));
  return numsEN(n);
}

/* sugerencias pulsables: cada una, en inglés, vuelve a entrar por toSpanish() */
const SUG = {
  "Que quepa en un hueco de 2,10 m": "Fit it into a 2.10 m gap", "Estilo nórdico": "Nordic style",
  "Dos cajones abajo a la izquierda": "Two drawers bottom left", "Hazla blanca": "Make it white",
  "En nogal": "In walnut", "Estilo industrial": "Industrial style", "Pon puertas": "Add doors",
  "Sin puertas": "No doors", "Sin trasera": "No back panel", "Estilo minimalista": "Minimalist style",
  "Mueble bajo con cajones": "Low unit with drawers", "Para la tele": "For the TV", "Con patas": "On legs",
  "Con zócalo": "On a plinth", "A la pared": "Wall-mounted", "Hazla negra": "Make it black", "En roble": "In oak",
  "Hazla más barata": "Make it cheaper", "Que cueste menos de 1000 €": "Under €1000",
  "Espesor de 22 mm": "22 mm thick", "Una columna más": "One more column", "Menos fondo": "Less depth",
  "Hazla más pequeña": "Make it smaller", "5 columnas": "5 columns",
  "La primera columna más ancha": "Make the first column wider", "Baldas cada 30 cm": "Shelves every 30 cm",
  "Una balda más en la segunda": "One more shelf in the second", "Quita los cajones": "Remove the drawers",
  "Puertas en las de los lados": "Doors on the sides", "Deshaz": "Undo",
  "Cajones en todas las columnas": "Drawers in every column", "Mejor los cajones a la derecha": "Move the drawers to the right",
  "Con trasera": "With a back panel", "Para libros": "For books", "Para el dormitorio": "For the bedroom",
};
export const sugEN = (s) => SUG[s] || s;
export const ALL_SUGGESTIONS_EN = [...new Set(ALL_SUGGESTIONS.map(sugEN))];

export function parseIntentEN(msg, current, ctx = {}) {
  const r = parseIntent(toSpanish(msg), current, ctx);
  if (!r) return null;
  if (r.action) return r;
  if (r.ask) return { ask: r.askEn ? numsEN(r.askEn) : toEnglish(r.ask), suggest: (r.suggest || []).map(sugEN) };
  return { params: r.params, changes: r.changes.map(changeEN), notes: r.notes.map(noteEN),
           suggest: r.suggest ? r.suggest.map(sugEN) : null, topic: r.topic, cols: r.cols, last: r.last };
}

export function fallbackEN(msg) {
  const f = fallback(toSpanish(msg));
  return { ask: toEnglish(f.ask), suggest: f.suggest.map(sugEN) };
}
