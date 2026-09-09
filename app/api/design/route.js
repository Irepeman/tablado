/* ============================================================
   CAPA 2 — EL COPILOTO, EN TU SERVIDOR
   Solo llegan aquí las peticiones que el motor local no ha sabido
   resolver. La clave de API vive en el servidor: nunca se envía al
   navegador y nunca aparece en el código del cliente.

   Dos garantías que no se negocian:
   1. Lo que devuelve el modelo pasa por normalize() antes de aceptarse.
      El modelo propone parámetros; el motor paramétrico decide si son
      fabricables. Nunca al revés.
   2. Hay límite de peticiones por IP. Una URL pública con tu tarjeta
      detrás necesita un techo.
   ============================================================ */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { normalize, MATKEYS, BASES, THICKNESSES, maxSpan, MATERIALS } from "@/lib/model";

export const runtime = "nodejs";

const MAX_MESSAGE = 400;
const LIMIT = Number(process.env.RATE_LIMIT_PER_HOUR || 30);

/* Contador en memoria: se reinicia en cada arranque en frío, así que es
   un techo aproximado. Para producción seria, mover a Vercel KV o Upstash. */
const hits = new Map();
function overLimit(ip) {
  const now = Date.now();
  const win = 60 * 60 * 1000;
  const list = (hits.get(ip) || []).filter((t) => now - t < win);
  if (list.length >= LIMIT) { hits.set(ip, list); return true; }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

const ColumnSchema = z.object({
  width: z.number().describe("Ancho libre de la columna en mm"),
  shelves: z.array(z.number()).describe("Altura de cada balda en mm, medida desde el suelo interior"),
  drawers: z.number().describe("Número de cajones, de 0 a 4, siempre en la parte baja"),
  door: z.boolean().describe("Puerta cubriendo la columna por encima de los cajones"),
});

const DesignSchema = z.object({
  reply: z.string().describe(
    "Una o dos frases en español, tuteando, con tono de ebanista competente. " +
    "Si el cambio tiene una consecuencia técnica, dila."),
  params: z.object({
    width: z.number(), height: z.number(), depth: z.number(),
    thickness: z.number(),
    material: z.enum(["melamina_blanca", "melamina_negra", "abedul", "roble", "nogal"]),
    base: z.enum(["patas", "zocalo", "flotante"]),
    baseHeight: z.number(),
    back: z.boolean(),
    columns: z.array(ColumnSchema),
  }),
});

function systemPrompt(p) {
  const t = p.thickness;
  const spans = MATKEYS
    .map((k) => `${MATERIALS[k].short} ${t} mm ≈ ${Math.round(maxSpan(k, t))} mm`)
    .join(" · ");
  return `Eres el copiloto de diseño de Tablado, una marca de estanterías a medida fabricadas por control numérico sobre tablero.

Traduces lo que pide el cliente a parámetros. No describes muebles: devuelves el objeto completo actualizado.

ESQUEMA (todo en milímetros)
- width 600-3200, height 600-2600, depth 180-600
- thickness: ${THICKNESSES.join(" | ")}
- material: ${MATKEYS.join(" | ")}
- base: ${BASES.join(" | ")}   ("flotante" implica baseHeight 0)
- back: con o sin panel trasero
- columns[]: width, shelves[] (alturas desde el suelo interior), drawers 0-4, door

REGLAS DURAS
1. suma(columns[].width) + (n-1)*thickness + 2*thickness = width. Cuadra siempre.
2. Luz máxima de balda sin combarse con el espesor actual: ${spans}.
   Si el cliente pide columnas más anchas que eso, añade divisores o sube
   el espesor, y explícale por qué en la respuesta.
3. Los cajones ocupan la parte baja de su columna, 190 mm cada uno.
   Las baldas van por encima, con 140 mm mínimos entre ellas.
4. Conserva sin tocar todo lo que el cliente no ha pedido cambiar.

Si la petición no es sobre el mueble, devuelve los parámetros intactos y
responde con una frase amable reconduciendo a lo que sí puedes hacer.

DISEÑO ACTUAL
${JSON.stringify(p)}`;
}

export async function POST(req) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "sin_clave", reply: "El copiloto no está configurado en este servidor. Copia .env.example a .env.local y pon tu ANTHROPIC_API_KEY." },
      { status: 503 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (overLimit(ip)) {
    return Response.json(
      { error: "limite", reply: `Has llegado al límite de ${LIMIT} consultas por hora. El editor sigue funcionando: usa el chat con medidas concretas o edita arrastrando las piezas.` },
      { status: 429 });
  }

  let body;
  try { body = await req.json(); }
  catch { return Response.json({ error: "json_invalido" }, { status: 400 }); }

  const message = String(body?.message || "").slice(0, MAX_MESSAGE).trim();
  if (!message) return Response.json({ error: "mensaje_vacio" }, { status: 400 });

  const current = normalize(body?.params);

  try {
    const client = new Anthropic();
    const res = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      system: systemPrompt(current),
      messages: [{ role: "user", content: message }],
      output_config: {
        format: zodOutputFormat(DesignSchema),
        // Tarea corta y muy acotada: no necesita razonamiento profundo,
        // y a menor esfuerzo, menos latencia y menos gasto por edición.
        effort: "low",
      },
    });

    const out = res.parsed_output;
    if (!out?.params) throw new Error("respuesta sin parámetros");

    // El modelo propone. El motor paramétrico decide.
    return Response.json({ reply: out.reply, params: normalize(out.params) });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return Response.json(
        { error: "clave_invalida", reply: "La clave de API no es válida. Revísala en .env.local." },
        { status: 502 });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json(
        { error: "rate_limit", reply: "El modelo está saturado ahora mismo. Prueba otra vez en unos segundos." },
        { status: 429 });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("[tablado] error de la API:", err.status, err.message);
      return Response.json(
        { error: "api", reply: "El copiloto no ha podido responder. El editor sigue funcionando con normalidad." },
        { status: 502 });
    }
    console.error("[tablado] error inesperado:", err);
    return Response.json(
      { error: "desconocido", reply: "Algo ha fallado por mi parte. Prueba a decirlo de otra forma." },
      { status: 500 });
  }
}
