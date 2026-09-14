"use client";
/* ============================================================
   ORQUESTADOR
   Un único objeto de parámetros. Lo escriben tres cosas: el ratón
   sobre la pieza, los controles del panel y el lenguaje natural.
   Cualquiera de las tres pasa por normalize() antes de aplicarse.

   Resolución en dos capas:
     1. parseIntent() en el navegador — instantáneo y sin coste.
     2. /api/design — el modelo, en tu servidor, solo si la 1 falla.
   ============================================================ */
import { useCallback, useEffect, useRef, useState } from "react";
import Viewport from "./Viewport";
import Chat from "./Chat";
import SpecRail from "./SpecRail";
import {
  DEFAULT, MATERIALS, DRAWER_H, normalize, build, validate,
  maxSpan, deepCopy, clamp,
} from "@/lib/model";
import { parseIntent } from "@/lib/intent";
import { mm } from "@/lib/pricing";

/* Lo que el motor local sabe hacer. Se dice cuando no entiende algo:
   una lista de lo posible enseña más que un "no te he entendido". */
const NO_ENTIENDO =
  "No he pillado ese cambio. Puedo con medidas («ancho 2,10 m», «que quepa en un hueco " +
  "de 1,80», «1,80 × 2,20»), acabado, columnas, baldas, cajones, puertas, base y trasera " +
  "— o dime para qué la quieres: vinilos, libros, zapatos, archivadores, la tele.";

const INTRO = [
  { role: "ai", text: "Estantería de 2,40 × 2,00 m en roble, cuatro columnas. Dime qué cambiar: medidas, material, columnas, baldas, cajones, puertas — o para qué la quieres («para vinilos», «para libros»). También puedes arrastrar las baldas y los divisores directamente sobre la pieza." },
  { role: "sys", text: "El motor de diseño corre en tu dispositivo: sin cuenta, sin espera y sin coste. Escribe como hablarías con un carpintero." },
];

function diffChips(a, b) {
  const out = [];
  const f = (k, l) => { if (Math.round(a[k]) !== Math.round(b[k])) out.push(`${l} ${mm(b[k])}mm`); };
  f("width", "ancho"); f("height", "alto"); f("depth", "fondo");
  if (a.thickness !== b.thickness) out.push(`espesor ${b.thickness}mm`);
  if (a.material !== b.material) out.push(MATERIALS[b.material].short.toLowerCase());
  if (a.base !== b.base) out.push(b.base);
  if (a.back !== b.back) out.push(b.back ? "con trasera" : "sin trasera");
  if (a.columns.length !== b.columns.length) out.push(`${b.columns.length} columnas`);
  const d = (x) => x.columns.reduce((s, c) => s + c.drawers, 0);
  if (d(a) !== d(b)) out.push(`${d(b)} cajones`);
  const s = (x) => x.columns.reduce((n, c) => n + c.shelves.length, 0);
  if (s(a) !== s(b)) out.push(`${s(b)} baldas`);
  const dr = (x) => x.columns.filter((c) => c.door).length;
  if (dr(a) !== dr(b)) out.push(`${dr(b)} puertas`);
  return out;
}

export default function Configurator() {
  const [params, setParams] = useState(() => normalize(DEFAULT()));
  const [messages, setMessages] = useState(INTRO);
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState(null);
  const [founder, setFounder] = useState(false);
  const [exploded, setExploded] = useState(false);
  const [showScale, setShowScale] = useState(false);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState("");
  const [selBox, setSelBox] = useState(null);
  const [tab, setTab] = useState("spec");
  const [photo, setPhoto] = useState(false);
  const [photoSamples, setPhotoSamples] = useState(0);
  /* refleja en la cabecera lo que de verdad hay detrás, no lo que nos gustaría */
  const [copilotOn, setCopilotOn] = useState(null);

  const history = useRef([]);
  /* null = sin comprobar · false = este despliegue no tiene copiloto.
     En cuanto se sabe, se deja de gastar un viaje al servidor. */
  const copilot = useRef(null);
  const vp = useRef(null);
  const toastT = useRef(null);

  const say = (m) => setMessages((xs) => [...xs, m]);
  const flash = (t) => {
    setToast(t);
    clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast(""), 2600);
  };

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

  /* panel flotante sobre la pieza seleccionada */
  useEffect(() => {
    if (!selection) { setSelBox(null); return; }
    let raf;
    const tick = () => {
      const geo = vp.current?.geo();
      const part = geo?.parts.find((x) =>
        selection.k === "shelf"
          ? x.grp === "balda" && x.col === selection.col && x.shelf === selection.shelf
          : x.grp === "divisor" && x.div === selection.div);
      const pr = part && vp.current?.project(part);
      const next = pr ? { x: clamp(pr.x + 16, 8, pr.w - 215), y: clamp(pr.y - 14, 8, pr.h - 150) } : null;
      // solo si se mueve: antes re-renderizaba toda la app 60 veces por segundo
      setSelBox((prev) => (prev && next && Math.abs(prev.x - next.x) < 0.5 && Math.abs(prev.y - next.y) < 0.5) ? prev : next);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [selection]);

  /* ---------------- chat: capa local, luego servidor ---------------- */
  const send = useCallback(async (msg) => {
    if (busy) return;
    say({ role: "you", text: msg });
    const before = deepCopy(params);
    const t0 = performance.now();

    const res = parseIntent(msg, params);
    if (res?.ask) { say({ role: "ai", text: res.ask }); return; }
    if (res) {
      const after = normalize(res.params);
      history.current.push(before);
      setParams(after);
      setSelection(null);
      const warn = validate(after, build(after)).find((f) => f.lvl === "warn");
      const bits = [res.changes.join(", ").replace(/^./, (c) => c.toUpperCase()) + "."];
      if (res.notes.length) bits.push(res.notes.join("; ") + ".");
      // Si normalize() corrigió lo pedido, se dice: el mensaje no puede contradecir el resultado.
      const req = res.params;
      if (req.columns.length !== after.columns.length) {
        bits.push(`He dejado ${after.columns.length} columnas: ninguna puede pasar de 1,5 m, no hay tablero que aguante esa luz.`);
      }
      for (const [k, name, lo, hi] of [["width", "ancho", 400, 3200], ["height", "alto", 400, 2600], ["depth", "fondo", 180, 600]]) {
        if (Math.abs(Math.round(req[k]) - after[k]) > 10) bits.push(`El ${name} va de ${mm(lo)} a ${mm(hi)} mm: lo he dejado en ${mm(after[k])} mm.`);
      }
      const reqDr = req.columns.reduce((acc, c) => acc + (c.drawers || 0), 0);
      const aftDr = after.columns.reduce((acc, c) => acc + c.drawers, 0);
      if (aftDr < reqDr) bits.push(`Con esta altura no caben tantos cajones: he dejado ${aftDr}.`);
      if (warn) bits.push("Ojo: " + warn.d.replace(/^./, (c) => c.toLowerCase()));
      say({ role: "ai", text: bits.join(" "), chips: diffChips(before, after),
            src: (performance.now() - t0).toFixed(1).replace(".", ",") + " ms" });
      return;
    }

    if (copilot.current === false) { say({ role: "ai", text: NO_ENTIENDO }); return; }

    setBusy(true);
    say({ role: "ai", text: "Pensando…", pending: true });
    try {
      const r = await fetch("/api/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, params }),
      });
      const data = await r.json();
      setMessages((xs) => xs.filter((m) => !m.pending));
      if (data.error === "sin_clave") {
        copilot.current = false;
        setCopilotOn(false);
        say({ role: "ai", text: NO_ENTIENDO });
        return;
      }
      if (!r.ok || !data.params) {
        say({ role: "ai", text: data.reply || NO_ENTIENDO });
        return;
      }
      copilot.current = true;
      setCopilotOn(true);
      const after = normalize(data.params);
      history.current.push(before);
      setParams(after);
      setSelection(null);
      say({ role: "ai", text: data.reply || "Hecho.", chips: diffChips(before, after), src: "server" });
    } catch {
      setMessages((xs) => xs.filter((m) => !m.pending));
      say({ role: "ai", text: NO_ENTIENDO });
    } finally {
      setBusy(false);
    }
  }, [busy, params]);

  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return flash("Nada que deshacer");
    setParams(normalize(prev));
    setSelection(null);
  };

  const downloadCsv = (rows, q) => {
    const csv = [
      "Pieza;Unidades;Largo_mm;Ancho_mm;Espesor_mm;Cantos",
      ...rows.map((r) => `${r.label};${r.qty};${r.L};${r.W};${r.t};${r.edges === 4 ? "4" : r.edges === 1 ? "1 (frontal)" : "0"}`),
      "",
      `Material;${MATERIALS[params.material].name} ${params.thickness} mm`,
      `Tableros;${q.nSheets}`,
      `Canto ABS m;${q.edgeML.toFixed(1)}`,
      `Peso kg;${Math.round(q.weight)}`,
    ].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cutwise-despiece-${mm(params.width)}x${mm(params.height)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    flash("Despiece descargado");
  };

  /* ---------------- panel flotante de la pieza ---------------- */
  const shelfBox = () => {
    const c = params.columns[selection.col];
    const v = c.shelves[selection.shelf];
    const Hi = params.height - params.baseHeight - 2 * params.thickness;
    const over = c.width > maxSpan(params.material, params.thickness);
    const set = (nv) => {
      const others = c.shelves.filter((_, i) => i !== selection.shelf);
      const fl = c.drawers * DRAWER_H + (c.drawers ? 40 : 0);
      const val = clamp(Math.round(nv / 32) * 32, fl + 140, Hi - 140);
      if (!others.every((o) => Math.abs(o - val) >= 140)) return;
      onCommitEdit((() => { const n = deepCopy(params); n.columns[selection.col].shelves[selection.shelf] = val; return n; })());
    };
    return (
      <>
        <h4>Balda · columna {selection.col + 1}</h4>
        <div className="selrow">
          <label>Altura</label>
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
          <label>Luz</label>
          <span className="mono" style={{ fontSize: 11.5, color: over ? "var(--amber)" : "var(--ink-2)" }}>
            {mm(c.width)} / {mm(maxSpan(params.material, params.thickness))} mm
          </span>
          <button className="kill" onClick={() => {
            const n = deepCopy(params);
            n.columns[selection.col].shelves.splice(selection.shelf, 1);
            setSelection(null); onCommitEdit(n);
          }}>Quitar</button>
        </div>
      </>
    );
  };

  const divBox = () => {
    const a = params.columns[selection.div], b = params.columns[selection.div + 1];
    if (!b) return null;
    const total = a.width + b.width;
    return (
      <>
        <h4>Divisor {selection.div + 1}</h4>
        <div className="selrow">
          <label>Izq.</label>
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
          <label>Der.</label>
          <span className="mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>{mm(b.width)} mm</span>
          <button className="kill" onClick={() => {
            const n = deepCopy(params);
            const w = a.width + b.width + n.thickness;
            n.columns.splice(selection.div + 1, 1);
            n.columns[selection.div].width = w;
            setSelection(null); onCommitEdit(n);
          }}>Quitar</button>
        </div>
      </>
    );
  };

  return (
    <div className="app">
      <header className="bar">
        <div className="brand"><b>Cutwise</b><span>Estantería a medida</span></div>
        <div className="bar-sep" />
        <div className="bar-note">
          {copilotOn
            ? <>Copiloto <b>en tu servidor</b></>
            : <>Motor de diseño <b>en el dispositivo</b></>}
        </div>
        <div className="bar-right">
          <button className="tbtn" aria-pressed={showScale} onClick={() => setShowScale((v) => !v)}>Escala 1,70 m</button>
          <button className="tbtn" aria-pressed={exploded} onClick={() => setExploded((v) => !v)}>Despiece</button>
          <button className="tbtn photo-btn" aria-pressed={photo} onClick={() => setPhoto((v) => !v)}>Modo foto</button>
          <button className="tbtn" aria-pressed={founder} onClick={() => setFounder((v) => !v)}>Modo fundador</button>
          <button className="tbtn" onClick={undo}>Deshacer</button>
        </div>
      </header>

      <div className="main">
        <div className={"rail-wrap" + (tab === "chat" ? "" : " hide-sm")}>
          <Chat messages={messages} busy={busy} onSend={send} />
        </div>

        <section className="stage">
          <Viewport
            ref={vp} params={params} selection={selection}
            exploded={exploded} showScale={showScale}
            photo={photo} onPhotoProgress={setPhotoSamples}
            onChange={onEdit} onCommit={(snap) => { history.current.push(snap); }}
            onSelect={setSelection}
          />
          <div className="hud">
            <div className="vp-tl">
              <div className="glass pill mono">
                {mm(params.width)} × {mm(params.height)} × {mm(params.depth)} mm
              </div>
              <div className="glass pill">
                <b>{MATERIALS[params.material].name}</b> · {params.thickness} mm
              </div>
              {photo && (
                <div className="glass pill mono">
                  {photoSamples < 3 ? "Modo foto · preparando…" : `Modo foto · ${photoSamples} muestras`}
                </div>
              )}
            </div>
            <div className="vp-tr">
              <button className="glass iconbtn" title="Vista frontal" onClick={() => vp.current?.frame("front")}>▣</button>
              <button className="glass iconbtn" title="Vista 3/4" onClick={() => vp.current?.frame("34")}>◱</button>
              <button className="glass iconbtn" title="Vista cenital" onClick={() => vp.current?.frame("top")}>⬒</button>
            </div>
            <div className="vp-bl">
              <div className="glass hint">
                <b>Arrastra una balda</b> o un divisor para editarla. Girar: arrastrar · Zoom: rueda
                o pinza, hacia el cursor · Mover: clic derecho o Mayús · Doble clic para enfocar.
              </div>
            </div>
            {selection && selBox && (
              <div className="glass selbox on" style={{ left: selBox.x, top: selBox.y }}>
                {selection.k === "shelf" ? shelfBox() : divBox()}
              </div>
            )}
          </div>
        </section>

        <div className={"rail-wrap" + (tab === "spec" ? "" : " hide-sm")}>
          <SpecRail
            params={params} selection={selection} founder={founder}
            onEdit={onEdit} onCommitEdit={onCommitEdit}
            onPushHistory={(snap) => { history.current.push(snap); }}
            onOrder={(q, rows, nested) => setModal({ q, rows, nested })}
            onCsv={downloadCsv}
            onReset={() => { history.current.push(deepCopy(params)); setParams(normalize(DEFAULT())); setSelection(null); vp.current?.frame("34"); }}
          />
        </div>

        <div className="tabs">
          <button aria-pressed={tab === "chat"} onClick={() => setTab("chat")}>Copiloto</button>
          <button aria-pressed={tab === "spec"} onClick={() => setTab("spec")}>Diseño y precio</button>
        </div>
      </div>

      {modal && (
        <div className="veil on" onClick={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="modal">
            <h3>Listo para control numérico</h3>
            <p>Esto es lo que sale del configurador hacia el taller. Ni un paso manual entre el render y la máquina.</p>
            {[
              ["Referencia", `CWS-${Date.now().toString(36).slice(-6).toUpperCase()}`],
              ["Medidas", `${mm(params.width)}×${mm(params.height)}×${mm(params.depth)}`],
              ["Material", `${MATERIALS[params.material].name} ${params.thickness} mm`],
              ["Piezas de tablero", modal.rows.reduce((a, r) => a + r.qty, 0)],
              ["Tableros / aprovechamiento", `${modal.q.nSheets} · ${Math.round(
                (modal.nested.yield.reduce((a, b) => a + b, 0) / Math.max(1, modal.nested.yield.length)) * 100)}%`],
              ["Canto ABS", `${modal.q.edgeML.toFixed(1)} m`],
              ["Peso de envío", `${Math.round(modal.q.weight)} kg`],
            ].map(([k, v]) => (
              <div className="ordrow" key={k}><span>{k}</span><span>{v}</span></div>
            ))}
            <p style={{ margin: "16px 0 0", fontSize: 12, color: "var(--ink-3)" }}>
              Producto fabricado según especificaciones del comprador: exento del derecho de
              desistimiento (RDL 1/2007, art. 103.c). Prototipo de demostración — no se cobra nada.
            </p>
            <button className="cta" style={{ marginTop: 16 }} onClick={() => setModal(null)}>Cerrar</button>
          </div>
        </div>
      )}

      <div className={"toast" + (toast ? " on" : "")}>{toast}</div>
    </div>
  );
}
