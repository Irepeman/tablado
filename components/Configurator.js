"use client";
/* ============================================================
   ORQUESTADOR
   Un único objeto de parámetros. Lo escriben tres cosas: el ratón
   sobre la pieza, los controles del panel y el lenguaje natural.
   Cualquiera de las tres pasa por normalize() antes de aplicarse.

   Resolución en dos capas:
     1. parseIntent() en el navegador — instantáneo y sin coste.
     2. /api/design — el modelo, en tu servidor, solo si la 1 falla.

   Idioma: español o inglés. El motor es el mismo; lib/intent-en.js
   traduce la frase a la entrada y la respuesta a la salida.
   ============================================================ */
import { useCallback, useEffect, useRef, useState } from "react";
import Viewport from "./Viewport";
import Chat from "./Chat";
import SpecRail from "./SpecRail";
import Catalog from "./Catalog";
import PhotoImport from "./PhotoImport";
import Reserve from "./Reserve";
import {
  DEFAULT, normalize, build, validate,
  maxSpan, deepCopy, clamp, setCell, isRail, cellBounds, cellAtHeight, PRESETS,
  canPlace, applyItem, moveCell, isDoor, setOwnDoor, railPos, railRange, setRailAt, doorKey,
} from "@/lib/model";
import { parseIntent, fallback } from "@/lib/intent";
import { parseIntentEN, fallbackEN } from "@/lib/intent-en";
import { tr, num, matName, matShort } from "@/lib/i18n";
import { logMiss } from "@/lib/record";

const LANG_KEY = "cutwise-lang";
/* piezas que van DENTRO del mueble: al colocarlas, las puertas se abren para ver dónde caen */
const INSIDE = ["shelf", "rail", "divider", "door+drawer", "tray"];
const intro = (lang) => {
  const L = tr(lang);
  return [{ role: "ai", text: L.intro }, { role: "sys", text: L.introSys }];
};

const CHIP_WORDS = {
  es: { width: "ancho", height: "alto", depth: "fondo", thick: "espesor", back: "con trasera", noBack: "sin trasera",
        cols: "columnas", drawers: "cajones", shelves: "baldas", doors: "puertas",
        base: { patas: "patas", zocalo: "zócalo", flotante: "suspendida" } },
  en: { width: "width", height: "height", depth: "depth", thick: "thickness", back: "with back", noBack: "no back",
        cols: "columns", drawers: "drawers", shelves: "shelves", doors: "doors",
        base: { patas: "legs", zocalo: "plinth", flotante: "wall-hung" } },
};

function diffChips(a, b, lang) {
  const w = CHIP_WORDS[lang] || CHIP_WORDS.es;
  const out = [];
  const f = (k) => { if (Math.round(a[k]) !== Math.round(b[k])) out.push(`${w[k]} ${num(b[k], lang)}mm`); };
  f("width"); f("height"); f("depth");
  if (a.thickness !== b.thickness) out.push(`${w.thick} ${b.thickness}mm`);
  if (a.material !== b.material) out.push(matShort(b.material, lang).toLowerCase());
  if (a.base !== b.base) out.push(w.base[b.base] || b.base);
  if (a.back !== b.back) out.push(b.back ? w.back : w.noBack);
  if (a.columns.length !== b.columns.length) out.push(`${b.columns.length} ${w.cols}`);
  const d = (x) => x.columns.reduce((s, c) => s + c.drawers, 0);
  if (d(a) !== d(b)) out.push(`${d(b)} ${w.drawers}`);
  const s = (x) => x.columns.reduce((n, c) => n + c.shelves.length, 0);
  if (s(a) !== s(b)) out.push(`${s(b)} ${w.shelves}`);
  const dr = (x) => x.columns.filter((c) => c.door).length;
  if (dr(a) !== dr(b)) out.push(`${dr(b)} ${w.doors}`);
  return out;
}

export default function Configurator() {
  const [lang, setLang] = useState("es");
  const L = tr(lang);
  const mm = (v) => num(v, lang);
  const [params, setParams] = useState(() => normalize(DEFAULT()));
  const [messages, setMessages] = useState(() => intro("es"));
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState(null);
  const [founder, setFounder] = useState(false);
  const [exploded, setExploded] = useState(false);
  const [showScale, setShowScale] = useState(false);
  const [modal, setModal] = useState(null);
  const [reserving, setReserving] = useState(false);   // formulario de reserva abierto
  const [toast, setToast] = useState("");
  const [selBox, setSelBox] = useState(null);
  const [tab, setTab] = useState("spec");
  const [photo, setPhoto] = useState(false);
  const [photoSamples, setPhotoSamples] = useState(0);
  const [openView, setOpenView] = useState(false);
  const [showParts, setShowParts] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);   // { file, hint }
  const [placing, setPlacing] = useState(null);      // pieza del catálogo esperando un toque en un hueco
  const [dragItem, setDragItem] = useState(null);    // pieza del catálogo que se está arrastrando
  const [openDoors, setOpenDoors] = useState([]);    // hojas abiertas tocándolas (doorKey: dónde está y cuánto mide)
  /* tocar una hoja: con todo abierto («Abrir»), se cierra solo esa y las demás siguen abiertas */
  const toggleDoor = (key, on, all = []) => {
    if (!on && openView) { setOpenView(false); setOpenDoors(all.filter((k) => k !== key)); return; }
    setOpenDoors((xs) => (on ? (xs.includes(key) ? xs : [...xs, key]) : xs.filter((x) => x !== key)));
  };
  /* hojas de la puerta que cubre un hueco, en el mueble ya cambiado */
  const doorKeysAt = (p, col, cell) => build(normalize(p), lang).parts
    .filter((x) => x.hinge && x.col === col && x.cells && cell >= x.cells[0] && cell <= x.cells[1]).map(doorKey);
  /* refleja en la cabecera lo que de verdad hay detrás, no lo que nos gustaría */
  const [copilotOn, setCopilotOn] = useState(null);

  const history = useRef([]);
  /* null = sin comprobar · false = este despliegue no tiene copiloto.
     En cuanto se sabe, se deja de gastar un viaje al servidor. */
  const copilot = useRef(null);
  const vp = useRef(null);
  const toastT = useRef(null);
  const selRef = useRef(null);
  const partsOpen = useRef(false);
  partsOpen.current = showParts;
  /* el chat aún no se ha tocado: al cambiar de idioma se traduce entero */
  const pristine = useRef(true);
  /* de qué se habló en el último cambio: «en todas» se refiere a eso */
  const convo = useRef({});

  const say = (m) => setMessages((xs) => [...xs, m]);
  const flash = (t) => {
    setToast(t);
    clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast(""), 2600);
  };

  /* ---------------- idioma ---------------- */
  const applyLang = useCallback((next, announce) => {
    setLang(next);
    document.documentElement.lang = next;
    try { localStorage.setItem(LANG_KEY, next); } catch {}
    if (pristine.current) setMessages(intro(next));
    else if (announce) setMessages((xs) => [...xs, { role: "sys", text: tr(next).switched }]);
  }, []);

  /* el título lo fija Next al cargar; se reescribe cada vez que cambia el idioma */
  useEffect(() => {
    const title = `Cutwise · ${tr(lang).tagline}`;
    document.title = title;
    const t = setTimeout(() => { document.title = title; }, 400);
    return () => clearTimeout(t);
  }, [lang]);

  useEffect(() => {
    let saved = null;
    try { saved = localStorage.getItem(LANG_KEY); } catch {}
    const guess = saved || (/^en\b/i.test(navigator.language || "") ? "en" : "es");
    if (guess !== "es") applyLang(guess, false);
  }, [applyLang]);

  /* onEdit: cambio en curso (arrastre, slider). No entra en el historial. */
  const onEdit = useCallback((next) => setParams(normalize(next)), []);
  /* onCommitEdit: cambio cerrado. El estado previo queda para deshacer. */
  const onCommitEdit = useCallback((next) => {
    setParams((prev) => {
      history.current.push(deepCopy(prev));
      if (history.current.length > 60) history.current.shift();
      return normalize(next);
    });
  }, []);

  useEffect(() => { vp.current?.frame("34", true); }, []);
  /* una puerta que ya no existe (se ha quitado, partido o cambiado de tamaño) deja de estar abierta:
     si no, al volver a poner una puerta ahí aparecería abierta */
  useEffect(() => {
    const keys = new Set(build(params).parts.filter((x) => x.hinge).map(doorKey));
    setOpenDoors((xs) => (xs.every((k) => keys.has(k)) ? xs : xs.filter((k) => keys.has(k))));
  }, [params]);
  /* lo elegido tiene que seguir existiendo tras deshacer, el chat o quitar una columna */
  const selValid = !!selection && (() => {
    const c = params.columns[selection.col];
    if (selection.k === "shelf") return c?.shelves[selection.shelf] != null;
    if (selection.k === "cell") return c?.cells[selection.cell] != null;
    if (selection.k === "rail") return isRail(c?.cells[selection.cell]);
    if (selection.k === "div") return selection.div < params.columns.length - 1;
    return false;
  })();
  useEffect(() => { if (selection && !selValid) setSelection(null); }, [selection, selValid]);
  /* en el móvil, el editor del hueco y el catálogo ocupan el mismo sitio abajo */
  useEffect(() => { if (selection && window.innerWidth <= 900) setShowParts(false); }, [selection]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !/INPUT|TEXTAREA/.test(e.target.tagName)) { setSelection(null); setPlacing(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* panel flotante sobre la pieza seleccionada */
  useEffect(() => {
    if (!selection) { setSelBox(null); return; }
    let raf;
    const tick = () => {
      const geo = vp.current?.geo();
      const part = selection.k === "cell" ? vp.current?.cellPart(selection.col, selection.cell) : geo?.parts.find((x) =>
        selection.k === "rail" ? x.grp === "barra" && x.col === selection.col && x.cell === selection.cell
        : selection.k === "shelf"
          ? x.grp === "balda" && x.col === selection.col && x.shelf === selection.shelf
          : x.grp === "divisor" && x.div === selection.div);
      const r = part && vp.current?.projectBox(part);
      let next = null;
      if (r) {
        const PW = selRef.current?.offsetWidth || 240, PH = selRef.current?.offsetHeight || 220, G = 14, M = 8;
        if (window.innerWidth <= 900) next = { dock: true, x: 0, y: 0 };   // móvil: abajo, fuera del 3D
        else {
          const ML = partsOpen.current ? 270 : M;                  // con el catálogo abierto, a su derecha
          let x = r.x1 + G, y;
          if (x + PW > r.w - M) x = r.x0 - G - PW;                 // a la izquierda si no cabe a la derecha
          if (x < ML) {                                             // ni a un lado ni a otro: encima o debajo
            x = clamp((r.x0 + r.x1) / 2 - PW / 2, ML, r.w - PW - M);
            y = r.y0 - G - PH >= M ? r.y0 - G - PH : clamp(r.y1 + G, M, r.h - PH - M);
          } else y = clamp((r.y0 + r.y1) / 2 - PH / 2, M, r.h - PH - M);
          next = { x, y };
        }
      }
      // solo si se mueve: antes re-renderizaba toda la app 60 veces por segundo
      setSelBox((prev) => (prev && next && !!prev.dock === !!next.dock && Math.abs(prev.x - next.x) < 0.5 && Math.abs(prev.y - next.y) < 0.5) ? prev : next);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [selection]);

  /* ---------------- chat: capa local, luego servidor ---------------- */
  const send = useCallback(async (msg) => {
    if (busy) return;
    pristine.current = false;
    const en = lang === "en";
    const T = tr(lang);
    const fb = () => { const f = en ? fallbackEN(msg) : fallback(msg); return { role: "ai", text: f.ask, suggest: f.suggest }; };
    say({ role: "you", text: msg });
    const before = deepCopy(params);
    const t0 = performance.now();

    const ctx = convo.current;
    const res = en ? parseIntentEN(msg, params, ctx) : parseIntent(msg, params, ctx);
    /* órdenes sobre el diseño entero: siempre reversibles con «deshaz» */
    if (res?.action === "reset") {
      convo.current = {};
      history.current.push(before);
      setParams(normalize(DEFAULT()));
      setSelection(null);
      say({ role: "ai", text: T.resetDone, suggest: [T.resetChip] });
      return;
    }
    if (res?.action === "undo") {
      const prev = history.current.pop();
      if (!prev) { say({ role: "ai", text: T.nothingToUndo }); return; }
      setParams(normalize(prev));
      setSelection(null);
      say({ role: "ai", text: T.undone });
      return;
    }
    if (res?.ask) {
      /* ha contestado pero no ha cambiado nada: también es una pista de lo que falta */
      logMiss(msg, params, lang, "ask");
      say({ role: "ai", text: res.ask, suggest: res.suggest });
      return;
    }
    if (res) {
      const after = normalize(res.params);
      convo.current = { topic: res.topic, cols: res.cols, last: res.last };
      history.current.push(before);
      setParams(after);
      setSelection(null);
      const warn = validate(after, build(after, lang), lang).find((f) => f.lvl === "warn");
      const bits = [res.changes.join(", ").replace(/^./, (c) => c.toUpperCase()) + "."];
      if (res.notes.length) bits.push(res.notes.join("; ") + ".");
      // Si normalize() corrigió lo pedido, se dice: el mensaje no puede contradecir el resultado.
      const req = res.params;
      if (req.columns.length !== after.columns.length) bits.push(T.colsAdjusted(after.columns.length));
      for (const [k, lo, hi] of [["width", 400, 3200], ["height", 400, 2600], ["depth", 180, 600]]) {
        if (Math.abs(Math.round(req[k]) - after[k]) > 10) bits.push(T.dimAdjusted(T.dimNames[k], num(lo, lang), num(hi, lang), num(after[k], lang)));
      }
      const reqDr = req.columns.reduce((acc, c) => acc + (c.drawers || 0), 0);
      const aftDr = after.columns.reduce((acc, c) => acc + c.drawers, 0);
      if (aftDr < reqDr) bits.push(T.drawersAdjusted(aftDr));
      if (warn) bits.push(T.watch + warn.d.replace(/^./, (c) => c.toLowerCase()));
      const ms = (performance.now() - t0).toFixed(1);
      say({ role: "ai", text: bits.join(" "), chips: diffChips(before, after, lang), suggest: res.suggest || undefined,
            src: (en ? ms : ms.replace(".", ",")) + " ms" });
      return;
    }

    /* el motor local no ha sabido: se apunta la frase, que es la única pista
       de por dónde falla el producto (y lo único que guardamos del chat) */
    logMiss(msg, params, lang, "none");

    if (copilot.current === false) { say(fb()); return; }

    setBusy(true);
    say({ role: "ai", text: T.thinking, pending: true });
    try {
      const r = await fetch("/api/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, params, lang }),
      });
      const data = await r.json();
      setMessages((xs) => xs.filter((m) => !m.pending));
      if (data.error === "sin_clave") {
        copilot.current = false;
        setCopilotOn(false);
        say(fb());
        return;
      }
      if (!r.ok || !data.params) {
        say(data.reply ? { role: "ai", text: data.reply } : fb());
        return;
      }
      copilot.current = true;
      setCopilotOn(true);
      const after = normalize(data.params);
      history.current.push(before);
      setParams(after);
      setSelection(null);
      say({ role: "ai", text: data.reply || (en ? "Done." : "Hecho."), chips: diffChips(before, after, lang), src: "server" });
    } catch {
      setMessages((xs) => xs.filter((m) => !m.pending));
      say(fb());
    } finally {
      setBusy(false);
    }
  }, [busy, params, lang]);

  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return flash(L.undoEmpty);
    setParams(normalize(prev));
    setSelection(null);
  };

  const downloadCsv = (rows, q) => {
    const csv = [
      L.csvHead,
      ...rows.map((r) => `${r.label};${r.qty};${r.L};${r.W};${r.t};${L.csvEdges[r.edges] ?? "0"}`),
      "",
      `${L.csvMat};${matName(params.material, lang)} ${params.thickness} mm`,
      `${L.csvSheets};${q.nSheets}`,
      `${L.csvEdge};${q.edgeML.toFixed(1)}`,
      `${L.csvWeight};${Math.round(q.weight)}`,
    ].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cutwise-${L.csvFile}-${Math.round(params.width)}x${Math.round(params.height)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    flash(L.csvDone);
  };

  /* ---------------- panel flotante de la pieza ---------------- */
  const shelfBox = () => {
    const c = params.columns[selection.col];
    const v = c.shelves[selection.shelf];
    const Hi = params.height - params.baseHeight - 2 * params.thickness;
    const over = c.width > maxSpan(params.material, params.thickness);
    const set = (nv) => {
      if (!Number.isFinite(nv) || nv === v) return;             // salir de la casilla sin cambiarla no es un cambio
      const others = c.shelves.filter((_, i) => i !== selection.shelf);
      const val = clamp(Math.round(nv / 32) * 32, 140, Hi - 140);
      if (val === v || !others.every((o) => Math.abs(o - val) >= 140)) return;
      onCommitEdit((() => { const n = deepCopy(params); n.columns[selection.col].shelves[selection.shelf] = val; return n; })());
    };
    return (
      <>
        <h4>{L.shelfOfCol(selection.col + 1)}</h4>
        <div className="selrow">
          <label>{L.height}</label>
          <input className="numin mono" defaultValue={v} key={v}
                 onBlur={(e) => set(Number(e.target.value))}
                 onKeyDown={(e) => e.key === "Enter" && set(Number(e.target.value))} />
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>mm</span>
          <div className="stepper">
            <button onClick={() => set(v - 32)}>−</button>
            <button onClick={() => set(v + 32)}>+</button>
          </div>
        </div>
        <div className="selrow">
          <label>{L.span}</label>
          <span className="mono" style={{ fontSize: 11.5, color: over ? "var(--amber)" : "var(--ink-2)" }}>
            {mm(c.width)} / {mm(maxSpan(params.material, params.thickness))} mm
          </span>
          <button className="kill" onClick={() => {
            const n = deepCopy(params);
            n.columns[selection.col].shelves.splice(selection.shelf, 1);
            setSelection(null); onCommitEdit(n);
          }}>{L.remove}</button>
        </div>
      </>
    );
  };

  /* ---------------- barra de colgar: altura ----------------
     La barra va atornillada a los costados: sube y baja dentro de su hueco.
     Se mide desde el suelo, como se mide en casa. */
  const railBox = () => {
    const c = params.columns[selection.col];
    const j = selection.cell;
    if (!c || !isRail(c.cells[j])) return null;
    /* suelo interior del mueble, medido desde el suelo de la habitación (suspendido: colgado a 42 cm, como en el 3D) */
    const off = params.baseHeight + params.thickness + (params.base === "flotante" ? 420 : 0);
    const railY = Math.round(railPos(params, c, j) + off);
    const [a, z] = railRange(params, c, j);
    const floorJ = cellBounds(params, c)[j] + (j > 0 ? params.thickness / 2 : 0);
    const set = (y) => {
      if (!Number.isFinite(y) || Math.round(clamp(y - off, a, z)) === Math.round(railY - off)) return;
      const n = deepCopy(params);
      setRailAt(n, n.columns[selection.col], j, y - off);
      onCommitEdit(n);
    };
    return (
      <>
        <h4>{L.railTitle(selection.col + 1)}</h4>
        <div className="selrow">
          <label>{L.height}</label>
          <input className="numin mono" defaultValue={railY} key={railY}
                 onBlur={(e) => set(Number(e.target.value))}
                 onKeyDown={(e) => e.key === "Enter" && set(Number(e.target.value))} />
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>mm</span>
          <div className="stepper">
            <button disabled={railY - off <= a} onClick={() => set(railY - 50)}>−</button>
            <button disabled={railY - off >= z} onClick={() => set(railY + 50)}>+</button>
          </div>
        </div>
        <p className="cellnote">{L.railHelp(mm(railY - off - floorJ), mm(a + off), mm(z + off))}</p>
        <div className="selrow">
          <button className="kill" onClick={() => {
            const n = deepCopy(params);
            const cc = n.columns[selection.col];
            cc.cells[j] = cc.cells[j] === "rail+door" ? "door" : "open";
            setSelection(null); onCommitEdit(n);
          }}>{L.remove}</button>
        </div>
      </>
    );
  };

  /* ¿se puede soltar aquí? El visor pregunta mientras se arrastra */
  const canDropAt = (item, tg) => {
    if (!tg || !item) return false;
    if (item.startsWith("h:")) return true;
    if (tg.col == null || (tg.cell == null && item !== "divider")) return false;
    return canPlace(params, item, tg.col, tg.cell).ok;
  };
  const why = (r) => (r.reason === "short" ? L.why.short(r.need) : L.why[r.reason] ?? L.why.nowhere);
  const placeItem = (item, tg) => {
    if (!tg || (!item.startsWith("h:") && tg.col == null)) { flash(L.why.nowhere); return false; }
    const n = deepCopy(params);
    const r = applyItem(n, item, tg.col ?? 0, tg.cell);
    if (!r.ok) { flash(why(r)); return false; }
    onCommitEdit(n);
    flash(L.placed(L.items[item]) + (r.deeper ? ` · ${L.deeper}` : ""));
    /* dentro de un hueco con puerta: la puerta se queda abierta para ver lo que se ha puesto */
    const behindDoor = INSIDE.includes(item) && item !== "divider" && tg.cell != null &&
      isDoor(params.columns[tg.col]?.cells[tg.cell]);
    if (behindDoor) doorKeysAt(n, tg.col, tg.cell).forEach((k) => toggleDoor(k, true));
    setSelection(null);
    vp.current?.flash(item.startsWith("h:") ? tg : { col: tg.col, cell: tg.cell }, item);
    return true;
  };
  const onMoveCell = (from, to) => {
    if (to.col == null || to.cell == null) { flash(L.why.nowhere); return; }
    const n = deepCopy(params);
    const r = moveCell(n, from, to);
    if (!r.ok) { if (r.reason !== "same") flash(why(r)); return; }
    onCommitEdit(n);
    flash(L.moved + (r.deeper ? ` · ${L.deeper}` : ""));
    setSelection({ k: "cell", col: to.col, cell: to.cell });
  };

  const CELL_OPTIONS = ["open", "door", "drawer", "drawer2", "drawer3", "door+drawer", "tray", "rail", "rail+door"];
  const cellBox = () => {
    const c = params.columns[selection.col];
    if (!c) return null;
    const j = Math.min(selection.cell, c.cells.length - 1);
    const pick = (type) => {
      const n = deepCopy(params);
      if (type === "rail+door") {
        const wasDoor = isDoor(n.columns[selection.col].cells[j]);
        setCell(n, n.columns[selection.col], j, type, n.columns);
        if (!wasDoor) setOwnDoor(n.columns[selection.col], j);
        if (n.depth < 500) n.depth = 580;                       // para colgar hacen falta 500 mm
      } else if (!applyItem(n, type, selection.col, j).ok) return;
      onCommitEdit(n);
    };
    const wholeRow = () => {
      const n = deepCopy(params);
      const b = cellBounds(params, c);
      const mid = (b[j] + b[j + 1]) / 2, type = c.cells[j];
      n.columns.forEach((cc, i) => {
        if (i === selection.col) return;
        const jj = cellAtHeight(n, cc, mid);
        if (!canPlace(n, type, i, jj).ok) return;                // donde no cabe, se deja
        const wasDoor = isDoor(cc.cells[jj]);
        setCell(n, cc, jj, type, n.columns);
        if (isDoor(type) && !wasDoor) setOwnDoor(cc, jj);
      });
      if (isRail(type) && n.depth < 500) n.depth = 580;
      onCommitEdit(n);
      flash(L.rowDone);
    };
    return (
      <>
        <h4>{L.cellTitle(selection.col + 1, j + 1)}</h4>
        <div className="cellgrid">
          {CELL_OPTIONS.map((ty) => {
            const chk = canPlace(params, ty, selection.col, j);
            return (
              <button key={ty} className="mini" aria-pressed={c.cells[j] === ty} disabled={!chk.ok}
                      title={chk.ok ? L.itemsHelp[ty] : why(chk)} onClick={() => pick(ty)}>
                {L.cellTypes[ty]}
              </button>
            );
          })}
        </div>
        {isDoor(c.cells[j]) && (openView || doorKeysAt(params, selection.col, j).some((k) => openDoors.includes(k))) && <p className="cellnote">{L.doorOpenHint}</p>}
        <button className="rowbtn" disabled={!canPlace(params, "shelf", selection.col, j).ok}
                title={canPlace(params, "shelf", selection.col, j).ok ? L.itemsHelp.shelf : why(canPlace(params, "shelf", selection.col, j))}
                onClick={() => { const n = deepCopy(params); if (applyItem(n, "shelf", selection.col, j).ok) onCommitEdit(n); }}>
          {L.addShelfHere}
        </button>
        {params.columns.length > 1 && <button className="rowbtn" style={{ marginTop: 4 }} onClick={wholeRow}>{L.wholeRow}</button>}
      </>
    );
  };

  const applyPreset = (k) => {
    history.current.push(deepCopy(params));
    const next = PRESETS[k](params);
    setParams(next);
    setOpenDoors([]);
    setSelection(null);
    convo.current = {};
    pristine.current = false;
    const m = (v) => (v / 1000).toLocaleString(lang === "en" ? "en-GB" : "es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    say({ role: "ai", text: L.presetSaid(L.presets[k], m(next.width), m(next.height)) });
    flash(L.presetApplied(L.presets[k]));
    setTimeout(() => vp.current?.frame("34"), 30);
  };

  const divBox = () => {
    const a = params.columns[selection.div], b = params.columns[selection.div + 1];
    if (!b) return null;
    const total = a.width + b.width;
    return (
      <>
        <h4>{L.divider(selection.div + 1)}</h4>
        <div className="selrow">
          <label>{L.left}</label>
          <input className="numin mono" defaultValue={Math.round(a.width)} key={Math.round(a.width)}
                 onBlur={(e) => {
                   const na = clamp(Math.round(Number(e.target.value) / 10) * 10, 150, total - 150);
                   const n = deepCopy(params);
                   n.columns[selection.div].width = na;
                   n.columns[selection.div + 1].width = total - na;
                   onCommitEdit(n);
                 }} />
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>mm</span>
        </div>
        <div className="selrow">
          <label>{L.right}</label>
          <span className="mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>{mm(b.width)} mm</span>
          <button className="kill" onClick={() => {
            const n = deepCopy(params);
            const w = a.width + b.width + n.thickness;
            n.columns.splice(selection.div + 1, 1);
            n.columns[selection.div].width = w;
            setSelection(null); onCommitEdit(n);
          }}>{L.remove}</button>
        </div>
      </>
    );
  };

  return (
    <div className="app">
      <header className="bar">
        <div className="brand"><b>Cutwise</b><span>{L.tagline}</span></div>
        <div className="bar-sep" />
        <div className="bar-note">
          {copilotOn
            ? <>{L.engineServer[0]}<b>{L.engineServer[1]}</b></>
            : <>{L.engineLocal[0]}<b>{L.engineLocal[1]}</b></>}
        </div>
        <div className="bar-right">
          <button className="tbtn" aria-pressed={showScale} onClick={() => setShowScale((v) => !v)}>{L.scale}</button>
          <button className="tbtn" aria-pressed={exploded} onClick={() => setExploded((v) => !v)}>{L.exploded}</button>
          <button className="tbtn photo-btn" aria-pressed={photo} title={L.photoTitle}
                  onClick={() => { setPhoto((v) => !v); setSelection(null); setOpenView(false); setOpenDoors([]); setPlacing(null); }}>{L.photo}</button>
          <button className="tbtn" aria-pressed={founder} onClick={() => setFounder((v) => !v)}>{L.founder}</button>
          <button className="tbtn" onClick={undo}>{L.undo}</button>
        </div>
        <div className="lang" role="group" aria-label="Idioma / Language">
          <button aria-pressed={lang === "es"} lang="es" title="Español" onClick={() => lang !== "es" && applyLang("es", true)}>ES</button>
          <button aria-pressed={lang === "en"} lang="en" title="English" onClick={() => lang !== "en" && applyLang("en", true)}>EN</button>
        </div>
      </header>

      <div className="main">
        <div className={"rail-wrap" + (tab === "chat" ? "" : " hide-sm")}>
          <Chat messages={messages} busy={busy} onSend={send} lang={lang}
                onPhoto={(file, hint) => setPhotoFile({ file, hint })} />
        </div>

        <section className="stage">
          <Viewport
            ref={vp} params={params} selection={selection}
            exploded={exploded} showScale={showScale}
            photo={photo} onPhotoProgress={setPhotoSamples}
            open={openView || INSIDE.includes(placing) || INSIDE.includes(dragItem)}
            openDoors={openDoors} onToggleDoor={toggleDoor}
            onChange={onEdit} onCommit={(snap) => { history.current.push(snap); }}
            onSelect={setSelection}
            placing={placing} canDropAt={canDropAt} onMoveCell={onMoveCell}
            onPlace={(tg) => { if (placing && placeItem(placing, tg)) setPlacing(null); }}
          />
          <div className="hud">
            <div className="vp-tl">
              <div className="glass pill mono">
                {mm(params.width)} × {mm(params.height)} × {mm(params.depth)} mm
              </div>
              <div className="glass pill">
                <b>{matName(params.material, lang)}</b> · {params.thickness} mm
              </div>
              {photo && (
                <div className="glass pill photo-pill" role="status">
                  {photoSamples < 1
                    ? <><span className="photo-bar"><i style={{ width: `${Math.round(photoSamples * 100)}%` }} /></span>
                        {photoSamples === 0 ? L.photoHold : L.photoWorking(Math.round(photoSamples * 100))}</>
                    : <>{L.photoReady}
                        <button className="photo-dl" onClick={() => vp.current?.snapshot((blob) => {
                          if (!blob) return;
                          const a = document.createElement("a");
                          a.href = URL.createObjectURL(blob);
                          a.download = `cutwise-${Math.round(params.width)}x${Math.round(params.height)}.png`;
                          a.click();
                          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
                          flash(L.photoSaved);
                        })}>{L.photoDownload}</button></>}
                </div>
              )}
            </div>
            <div className="vp-tr">
              <button className="glass pill-btn parts-btn" aria-pressed={showParts} title={L.piecesTitle}
                      onClick={() => { setShowParts((v) => !v); setPlacing(null); }}>＋ {L.piecesBtn}</button>
              <button className="glass pill-btn" aria-pressed={openView || openDoors.length > 0} title={L.openTitle}
                      onClick={() => { if (openView || openDoors.length) { setOpenView(false); setOpenDoors([]); } else setOpenView(true); }}>
                {openView || openDoors.length ? L.closeDoors : L.open}
              </button>
              <button className="glass iconbtn" title={L.viewFront} aria-label={L.viewFront} onClick={() => vp.current?.frame("front")}>▣</button>
              <button className="glass iconbtn" title={L.view34} aria-label={L.view34} onClick={() => vp.current?.frame("34")}>◱</button>
              <button className="glass iconbtn" title={L.viewTop} aria-label={L.viewTop} onClick={() => vp.current?.frame("top")}>⬒</button>
            </div>
            {!showParts && (
              <div className="vp-bl">
                <div className="glass hint">
                  <b>{L.hintBold}</b>{L.hintRest}
                </div>
              </div>
            )}
            {showParts && (
              <Catalog lang={lang} placing={placing}
                       onClose={() => { setShowParts(false); setPlacing(null); }}
                       onTap={(k) => { setSelection(null); setPlacing((cur) => (cur === k ? null : k)); if (window.innerWidth <= 900) setShowParts(false); }}
                       onDragMove={(k, x, y) => { setDragItem(k); return !!vp.current?.dropAt(x, y, k)?.ok; }}
                       onDrop={(k, x, y) => { const tg = vp.current?.dropAt(x, y, k); vp.current?.clearDrop(); setPlacing(null); setDragItem(null); if (tg) placeItem(k, tg); }} />
            )}
            {placing && (
              <div className="glass placing-bar" role="status">
                <span>{L.placing(L.items[placing])}</span>
                <button onClick={() => setPlacing(null)}>{L.cancel}</button>
              </div>
            )}
            {selValid && selBox && (
              <div ref={selRef} className={"glass selbox on" + (selection.k === "cell" ? " wide" : "") + (selBox.dock ? " dock" : "")}
                   style={selBox.dock ? undefined : { left: selBox.x, top: selBox.y }}>
                {selection.k === "shelf" ? shelfBox() : selection.k === "cell" ? cellBox() : selection.k === "rail" ? railBox() : divBox()}
              </div>
            )}
          </div>
        </section>

        <div className={"rail-wrap" + (tab === "spec" ? "" : " hide-sm")}>
          <SpecRail
            params={params} selection={selection} founder={founder} lang={lang}
            onEdit={onEdit} onCommitEdit={onCommitEdit}
            onPushHistory={(snap) => { history.current.push(snap); }}
            onOrder={(q, rows, nested) => setModal({ q, rows, nested })}
            onCsv={downloadCsv} onPreset={applyPreset} onReserve={() => setReserving(true)}
            onReset={() => { history.current.push(deepCopy(params)); setParams(normalize(DEFAULT())); setSelection(null); setOpenDoors([]); vp.current?.frame("34"); }}
          />
        </div>

        <div className="tabs">
          <button aria-pressed={tab === "chat"} onClick={() => setTab("chat")}>{L.tabChat}</button>
          <button aria-pressed={tab === "spec"} onClick={() => setTab("spec")}>{L.tabSpec}</button>
        </div>
      </div>

      {photoFile && (
        <PhotoImport file={photoFile.file} hint={photoFile.hint} lang={lang}
          onCancel={() => setPhotoFile(null)}
          onCreate={(next, sum) => {
            pristine.current = false;
            history.current.push(deepCopy(params));
            setParams(next);
            setSelection(null);
            setOpenDoors([]);
            setPhoto(false);
            convo.current = {};
            const url = URL.createObjectURL(photoFile.file);
            say({ role: "you", text: photoFile.hint, image: url });
            say({ role: "ai", text: L.photoDone(L.photoFound(sum)), chips: diffChips(params, next, lang),
                  suggest: lang === "en" ? ["Make it white", "In walnut", "No back panel"] : ["Hazla blanca", "En nogal", "Sin trasera"] });
            setPhotoFile(null);
            setTab("spec");
            setTimeout(() => vp.current?.frame("34"), 40);
          }} />
      )}
      {reserving && (
        <Reserve params={params} lang={lang}
                 onClose={() => setReserving(false)}
                 onSaved={() => flash(L.reserveDone)} />
      )}
      {modal && (
        <div className="veil on" onClick={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="modal">
            <h3>{L.modalTitle}</h3>
            <p>{L.modalText}</p>
            {[
              [L.ref, `CWS-${Date.now().toString(36).slice(-6).toUpperCase()}`],
              [L.dims, `${mm(params.width)}×${mm(params.height)}×${mm(params.depth)}`],
              [L.material, `${matName(params.material, lang)} ${params.thickness} mm`],
              [L.boardPieces, modal.rows.reduce((a, r) => a + r.qty, 0)],
              [L.sheetsYield, `${modal.q.nSheets} · ${Math.round(
                (modal.nested.yield.reduce((a, b) => a + b, 0) / Math.max(1, modal.nested.yield.length)) * 100)}%`],
              [L.edgeBanding, `${modal.q.edgeML.toFixed(1)} m`],
              [L.shipWeight, `${Math.round(modal.q.weight)} kg`],
            ].map(([k, v]) => (
              <div className="ordrow" key={k}><span>{k}</span><span>{v}</span></div>
            ))}
            <p style={{ margin: "16px 0 0", fontSize: 12, color: "var(--ink-3)" }}>{L.legalNote}</p>
            <button className="cta" style={{ marginTop: 16 }} onClick={() => setModal(null)}>{L.close}</button>
          </div>
        </div>
      )}

      <div className={"toast" + (toast ? " on" : "")}>{toast}</div>
    </div>
  );
}
