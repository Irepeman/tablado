# Cutwise — architecture document

Made-to-measure storage furniture, designed in the browser. You set the space, or describe it in your
own words, or send a photo, and you get the piece in 3D, an exact price, and the cut list a workshop
needs to build it. No account, no waiting for a quote.

Live: https://tablado-irene7.vercel.app · Repo: `Irepeman/tablado` · Team: Irene Peman (product and code),
Paul Menck (sales and customer interviews).

---

## 1. Principles

These are the rules we hold design decisions against.

1. **One source of truth.** A single parameter object produces the 3D view, the cut list, the cutting
   plan and the price. Nothing is modelled twice, so what the customer sees is what gets cut.
2. **The engine only emits buildable furniture.** Every input — the chat, the mouse, a photo, the
   optional server model — passes through `normalize()`, which corrects anything unbuildable before it
   reaches the screen. Manufacturing knowledge lives in code, not in prose.
3. **The AI writes parameters, never geometry.** A model may change dimensions, materials and
   compartments. It never produces shapes. This is what keeps generated designs manufacturable.
4. **Free to run, no sign-up.** The default path runs entirely in the browser. Any paid service is
   optional and the product degrades gracefully without it.
5. **Nothing ships unverified.** The full test suite runs before every deploy, and a human opens the
   live site afterwards.

---

## 2. The pipeline

```
input  →  params  →  normalize()  →  build()  →  parts[]  →  ┬→  three.js scene   (what you see)
                                                             ├→  cutlist + nest   (what gets cut)
                                                             ├→  quote            (what it costs)
                                                             └→  validate()       (what would fail)
```

`params` is plain JSON: outer dimensions, material, thickness, base, back, handle, and an array of
columns. Everything else is derived. There is no second model of the furniture anywhere in the codebase.

### The parameter object

```js
{
  width: 1800, height: 2200, depth: 600,     // mm, clamped 400–3200 / 400–2600 / 180–600
  thickness: 18,                              // 16 | 18 | 22
  material: "roble",                          // melamina_blanca | melamina_negra | abedul | roble | nogal
  base: "zocalo", baseHeight: 80,             // patas | zocalo | flotante
  back: true, handle: "bar",                  // bar | bar_brass | knob | cup | profile | push
  columns: [
    { width: 860, shelves: [1744], cells: ["rail+door", "door"], joins: [true], railAt: [1684] },
    { width: 860, shelves: [460, 900, 1320, 1744],
      cells: ["drawer2", "door", "door", "door", "door"], joins: [true, true, true, true] }
  ]
}
```

A column is a stack of **compartments** separated by shelves. Each compartment is one of:
`open`, `door`, `drawer`, `drawer2`, `drawer3`, `rail`, `rail+door`, `door+drawer` (inner drawer behind
a door) or `tray`. `joins[j]` says the door of compartment *j* continues into *j+1*, which is how a
single tall wardrobe door is expressed. `railAt` holds the height of each hanging rail.

---

## 3. Module map

| File | Lines | What it owns |
| --- | ---: | --- |
| `lib/model.js` | 752 | The engine: `normalize`, `build`, `validate`, presets, and the catalogue operations (`canPlace`, `applyItem`, `moveCell`, `addShelfInCell`, `splitColumn`) |
| `lib/pricing.js` | 160 | `cutlist` (group identical panels), `nest` (lay them on sheets), `quote` (cost → price → margin) |
| `lib/intent.js` | 1,360 | The Spanish chat engine: rules, not a language model |
| `lib/intent-en.js` | 422 | English in, Spanish engine, English out |
| `lib/photo.js` | 564 | Photo → furniture: homography, line detection, compartment classification |
| `lib/i18n.js` | 314 | Every user-visible string, ES and EN |
| `components/Viewport.js` | 1,173 | three.js scene, picking, dragging, two-finger rotation, photo mode |
| `components/Configurator.js` | 732 | Application state, history, chat wiring, catalogue placement |
| `components/SpecRail.js` | 372 | Dimensions, material, columns, cut list, price, manufacturing check |
| `components/decor.js` | 363 | Books, clothes, plants and a TV, for photo mode only. Never in the cut list |
| `components/wood.js` | 313 | Procedural wood: grain at physical scale, per panel, with real edges |
| `components/{Catalog,Chat,PhotoImport}.js` | 414 | Parts catalogue, chat panel, photo import dialog |
| `app/api/design/route.js` | 163 | Optional server copilot. Returns parameters validated with zod, then normalized |

Total application code: about 7,100 lines, plus 1,500 lines of tests.

---

## 4. The three ways to design a piece

**Direct manipulation.** Sliders and column controls; drag a shelf or a divider in the 3D view; tap a
compartment to change what it holds; drag a part (door, drawers, rail, handle) from the catalogue onto
a compartment. Every gesture goes through the same catalogue API as the chat, so nothing can be placed
by hand that the engine would refuse.

**Chat, with no model and no cost.** `lib/intent.js` parses Spanish with regular expressions and a
small amount of context memory, and returns a parameter patch plus an explanation of what it changed.
It costs nothing per message and answers instantly. When it does not understand, it says what it can
do. If an API key is configured, unresolved messages go to the server model instead, which returns
parameters (never geometry) validated by zod. Without a key, the client stops asking after the first
unresolved message.

**From a photo.** Classical computer vision in the browser, no model and no upload: rectify the
photo with a homography from the four corners, find the lines that cross the whole piece, classify
each compartment by brightness, texture and edges, detect handles, drop the plinth and the cornice,
then map the result onto the engine's columns and compartments. The photo never leaves the device.

---

## 5. What the engine knows about furniture

- **Shelf sag.** δ = 5qL⁴/(384·E·I) with I = bt³/12. The limit is L/300 at 60 kg/m², which gives a
  maximum span per material and thickness. Over it, the app says so and offers to add a column.
- **Sheet limits.** A piece that does not fit on a 2800 × 2070 mm board is flagged; long horizontals
  split over the nearest divider, where the joint is supported.
- **Compartment rules.** A hanging rail needs 600 mm of clear height, an inner drawer 150 mm, a drawer
  front at least 110 mm, a drawer column at least 250 mm wide. Doors are at most two leaves, because a
  third leaf has no carcass edge to hinge on. Fronts are inset with a 3 mm gap, so nothing protrudes.
- **Hardware.** Hinges per leaf height, runner pairs per drawer, handles per front, levelling feet,
  wall anchor above 1.2 m, and the hanging rail priced as tube plus supports rather than as board.

`validate()` turns all of this into the manufacturing check the customer sees, with a one-click fix
where there is one.

---

## 6. Price

Derived from the same parts, never estimated: board area at the material's sheet price, back panel,
edge banding by metre, CNC cutting by metre plus a setup per sheet, hardware by count, packing per
sheet, then markup, shipping and 21% VAT. Founder mode shows the breakdown and the real margin for
that exact design.

| Preset | Size (mm) | Pieces | Sheets | Price incl. VAT | Margin |
| --- | --- | ---: | ---: | ---: | ---: |
| Bookcase | 2400 × 2000 × 320 | 20 | 2 | €1,523 | 56% |
| Bookcase with doors | 2400 × 2000 × 320 | 24 | 2 | €1,807 | 56% |
| Wardrobe | 1800 × 2200 × 600 | 32 | 3 | €2,784 | 56% |
| Sideboard | 1800 × 800 × 420 | 29 | 2 | €1,393 | 56% |
| TV unit | 1800 × 500 × 400 | 19 | 1 | €926 | 56% |
| Chest of drawers | 1000 × 900 × 450 | 42 | 1 | €1,352 | 56% |

The costs behind these numbers are estimates. No supplier has quoted us yet, which makes this the
least certain part of the product.

---

## 7. Tests

`npm test` runs six files and takes about two seconds.

| File | What it proves |
| --- | --- |
| `tests/qa.mjs` | 857,084 checks: nothing overlaps, nothing escapes the carcass, every piece fits a sheet, the cut list is complete, `normalize` is idempotent |
| `tests/catalog.mjs` | 5,608 random catalogue operations: the part lands where it was dropped, other columns do not change |
| `tests/photo.mjs` | 40 synthetic photos, including perspective and visible side panels |
| `tests/chat.mjs` · `chat-en.mjs` | 329 phrases written the way customers write them |
| `tests/corpus.mjs` | 226 cases that must never regress |

The suite is the gate: if anything fails, nothing is deployed. It is also what made parallel AI review
possible — three agents could edit the same codebase because the tests graded them.

---

## 8. Stack and deployment

Next.js 15 (App Router) and React 19 on Vercel, deployed automatically on every push to `main`.
three.js 0.169 for the 3D view, with ambient occlusion, soft shadows and an accumulation renderer for
photo mode. zod validates anything the optional server model returns. Plain JavaScript, no TypeScript,
no CSS framework, no state library.

No database, no authentication, no cookies, no analytics. The design lives in the browser; the photo
never leaves it. Cost per design: zero.

**Dependencies we avoid, and why.** No CAD kernel: our parametric model is small and a kernel would
dictate the data model. No GPU path tracer: we removed `three-gpu-pathtracer` and `three-mesh-bvh`
after they rendered black on Safari and Apple Silicon. No UI library, no analytics SDK, and no paid
API as a hard dependency, because the product has to work when we cannot pay.

---

## 9. Tradeoffs we accept on purpose

- **Rectangular pieces only.** No sloped ceilings or spaces under stairs, although both appear in our
  own problem statement.
- **The chat is rules, not a model.** Free and instant, and it fails on phrasing we did not anticipate.
- **Nothing is stored.** No accounts, no saved designs, and no log of what the chat failed to
  understand, which is why eighteen chat bugs sat there until a user hit them.
- **Prices come from estimated costs**, not from supplier quotes.
- **Realism over physical simulation.** Photo mode is there to make people trust the piece, not to
  compute light accurately.

---

## 10. Data we keep

Today: nothing. No accounts, no saved designs, no cookies, no analytics, and no log of what the chat
fails to understand. That is a deliberate tradeoff that has already cost us — eighteen chat failures
sat in the product until a user ran into them — and it is the next thing to change.

What we will keep, once the reserve flow exists, and why each field earns its place:

| Field | Why we need it | Note |
| --- | --- | --- |
| The design's parameters | It is the order. Without it there is nothing to cut | No personal data in it |
| The measurements, and how they were taken (typed, from a photo, measured by us) | Tells us whether customers can measure their own space, which is open assumption 3 | |
| Name and one contact (email or phone) | To send the payment link and the delivery date | Never sold, never used for anything else |
| Timestamp and whether they committed | The only honest measure of whether anyone wants this | |
| Later: the workshop, the quote, the real cost, the lead time, and any piece remade | Turns our estimated prices into measured ones | Added when the first order is cut |
| Every phrase the chat could not parse, with the design at that moment | Fixes the product where it actually breaks | No contact details attached |

What we will never keep: card details (a payment provider handles those, we never see them), postal
addresses before an order exists, and anything we cannot explain to the person who gave it to us.

## 11. Open assumptions

1. People with an awkward space will pay around twice the IKEA price for an exact fit.
2. A local workshop can cut, edge and drill from our cut list without redrawing, at a cost that leaves
   a margin.
3. Customers can measure their own space accurately enough that the piece fits.
4. The 56% gross margin survives contact with real supplier prices.

What we are building next is the one thing that tests all four: a reserve flow with a refundable €50
deposit that stores the design, the measurements and whether it converted, plus logging of the phrases
the chat does not understand. That is also the first piece of the only defense we think we can own: a
record of real spaces, real cut lists and real workshop costs.

---

## 12. Session log

| Date | Decision | Why |
| --- | --- | --- |
| 13 Sep | One parametric model feeds 3D, cut list and price | Anything else lets the render and the workshop disagree |
| 14 Sep | The in-app AI runs on the device, with the server model optional | Nobody should need an account or spend credits to use the app |
| 15 Sep | Procedural wood at physical scale, per panel | People buy furniture on how it looks |
| 16 Sep | Removed the GPU path tracer | It rendered black on Safari and Apple Silicon |
| 17 Sep | Compartment model (`cells` + `joins`) replaces counting drawers | A wardrobe is compartments, not a number of drawers |
| 20 Sep | Parts catalogue with drag and drop, sharing the chat's rules | Two ways in, one set of rules |
| 21 Sep | Photo → furniture with classical CV, in the browser | A model would cost money and send the photo away |
| 21 Sep | Three AI reviewers in parallel, graded by the test suite | Found 37 real defects in 20 minutes |
| 22 Sep | Inset fronts, two-leaf doors, rail priced as hardware | The third leaf had nowhere to hinge; the rail was billed as board |
| 28 Sep | Doors no longer move between compartments on touch | A long press was moving them by accident on iPad |
| 13 Oct | Copycat test: an AI rebuilt the visible product in ~30 minutes | It matched our published price exactly and missed by 47% elsewhere |
| 13 Oct | Hackathon: shipped the conversational design path and scrapped the rest | We tried several ways for a customer to shape a piece; only one had to survive, and talking to it beat every menu we tried |
| 25 Oct | Renamed this file `architecturedoc.md`, added "Data we keep" | The course names the file; and the next thing we build is the first data we will ever store |
