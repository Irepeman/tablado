# Tablado

Configurador de estanterías a medida. El cliente diseña hablando o arrastrando
las piezas; del mismo objeto de parámetros salen el render 3D, el despiece, el
plan de corte y el precio.

La IA es tuya: corre en **tu** servidor con **tu** clave de API. Quien entra no
necesita cuenta de nada ni ve ningún aviso de permisos.

---

## Arrancar en local

```bash
npm install
cp .env.example .env.local     # y pon tu clave dentro
npm run dev
```

Abre http://localhost:3000

La clave se saca en https://console.anthropic.com/settings/keys — empieza por
`sk-ant-`. Vive solo en `.env.local`, que está en `.gitignore`: nunca se sube al
repositorio ni llega al navegador.

**Sin clave la app funciona igual**, solo que las peticiones abiertas contestan
que el copiloto no está configurado. Todo lo demás — el editor, el despiece, el
precio y el motor de intención local — no depende del modelo.

---

## Desplegar

```bash
npm i -g vercel
vercel
vercel env add ANTHROPIC_API_KEY production
vercel --prod
```

También puedes importar el repositorio desde vercel.com y añadir
`ANTHROPIC_API_KEY` en *Settings → Environment Variables*.

---

## Cómo está montado

### El motor paramétrico es la única fuente de verdad

`lib/model.js` convierte un objeto de parámetros en una lista de piezas. Cada
pieza lleva a la vez su geometría 3D y sus medidas de taller. El render, el
despiece y el presupuesto salen de ahí, así que **lo que se ve es exactamente lo
que se corta**. No hay traducción entre el diseño y la fabricación.

`normalize()` es la red de seguridad: todo lo que entra pasa por ella —el ratón,
los controles y el modelo— y sale como un mueble fabricable o no sale.

### La resolución de intención va en dos capas

1. **`lib/intent.js`, en el navegador.** Instantáneo, sin coste y sin conexión.
   Resuelve medidas en cualquier formato, comparativos, negaciones («no quiero
   que tenga fondo»), incrementos («una balda más» ≠ «una balda»), materiales,
   columnas, cajones, puertas, y presets de uso (vinilos, libros, zapatos,
   archivadores, TV, cuarto infantil).
2. **`app/api/design/route.js`, en tu servidor.** Solo entra cuando la capa 1 no
   ha entendido nada. Usa `claude-opus-5` con salida estructurada validada por
   Zod, y con `effort: "low"` porque la tarea es corta y acotada.

Esto no es un apaño: mantiene el coste marginal por edición cerca de cero y la
latencia percibida en nada. En la interfaz, cada respuesta dice cuál de las dos
capas la resolvió y en cuánto tiempo.

### El modelo propone, el motor decide

La ruta de la API pasa por `normalize()` lo que devuelve el modelo antes de
aceptarlo. Un modelo de lenguaje no puede meter en producción una estantería que
no se sostiene.

### Verificación de fabricación

`validate()` en `lib/model.js`. La luz máxima de balda sale de la fórmula de
flecha real —`δ = 5qL⁴/(384·E·I)` con límite `L/300` y carga de 60 kg/m²— con el
módulo elástico de cada material. De ahí que melamina de 18 mm dé ~810 mm y
contrachapado de abedul ~1.190 mm.

Aquí está el activo defendible del negocio: no en el modelo, sino en estas
reglas de oficio codificadas.

---

## Estructura

```
app/
  page.js                 entrada
  layout.js               tipografías y metadatos
  globals.css             sistema de diseño (claro y oscuro)
  api/design/route.js     CAPA 2 · el modelo, con tu clave
components/
  Configurator.js         orquestador: un estado, tres formas de escribirlo
  Viewport.js             three.js · órbita amortiguada, zoom al cursor, arrastre
  Chat.js                 conversación
  SpecRail.js             parámetros, verificación, despiece, plan de corte, precio
lib/
  model.js                MOTOR PARAMÉTRICO · normalize, build, validate
  intent.js               CAPA 1 · motor de intención local
  pricing.js              despiece, anidado en tablero, presupuesto
```

---

## Protección de la factura

`RATE_LIMIT_PER_HOUR` (por defecto 30) limita las llamadas al modelo por IP y
hora, y los mensajes se recortan a 400 caracteres. El contador está en memoria,
así que se reinicia en cada arranque en frío: es un techo aproximado, suficiente
para una demo o un piloto. Para tráfico real, moverlo a Vercel KV o Upstash.

---

## Pendiente

- Los precios de `lib/pricing.js` son estimaciones razonadas de mercado, no
  presupuestos cerrados. En cuanto tengas presupuesto real de un taller,
  cámbialos ahí: el «modo fundador» pasa a mostrar tu margen de verdad.
- Falta exportar DXF para la CNC. El despiece ya tiene toda la información
  necesaria; es traducir la lista de piezas a polilíneas.
- Falta el manual de montaje autogenerado.
- Falta pasarela de pago. El botón «Enviar a fabricación» hoy solo resume el
  pedido.

---

## Nota legal que conviene tener a mano

Un producto fabricado según especificaciones del comprador está **exento del
derecho de desistimiento de 14 días** (Directiva 2011/83/UE art. 16.c; en
España, RDL 1/2007 art. 103.c). Las devoluciones son lo que destruye el
comercio electrónico de muebles, y este modelo las elimina legalmente.

Aplica también el Reglamento (UE) 2023/988 de seguridad general de productos, y
las normas EN 14749 (almacenaje doméstico) y EN 16121. El anclaje antivuelco es
obligatorio en los muebles altos y estrechos: la app ya lo detecta y lo avisa.
