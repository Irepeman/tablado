# Start here

This is the full source of Cutwise. Live app: https://tablado-irene7.vercel.app

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # six test files, about two seconds
```

No API key, no database, no account. The `.env.example` key is optional and only switches on a server
copilot for chat messages the on-device engine cannot parse.

## Read it in this order

1. **`doc.md`** — the architecture document: principles, the pipeline, the module map, what the engine
   knows about furniture, how the price is derived, and the open assumptions. Start here.
2. **`lib/model.js`** — the engine, and the only place furniture is defined. `normalize()` is the
   safety net that every input passes through; `build()` turns parameters into parts that carry both
   their 3D position and their workshop dimensions; `validate()` holds the manufacturing rules.
3. **`lib/pricing.js`** — `cutlist` groups identical panels, `nest` lays them on 2800 × 2070 sheets,
   `quote` turns parts into cost, price and margin.
4. **`components/Viewport.js`** — the three.js scene and every gesture: picking, dragging shelves and
   rails, moving what a compartment holds, two-finger rotation, and photo mode.
5. **`components/Configurator.js`** — application state, undo history, and the wiring between the
   chat, the catalogue and the viewer.
6. **`lib/intent.js`** — the chat, built from rules rather than a model, so it costs nothing to run.
7. **`lib/photo.js`** — photo to furniture: homography, line detection, compartment classification.
   It runs in the browser; the photo is never uploaded.
8. **`tests/`** — what each rule is worth. `qa.mjs` alone is 857,084 checks.

## The one idea

A single parameter object produces the 3D view, the cut list, the cutting plan and the price. Nothing
is modelled twice, so what the customer sees on screen is exactly what a workshop would cut.
