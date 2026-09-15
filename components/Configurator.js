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
import {
  DEFAULT, DRAWER_H, normalize, build, validate,
  maxSpan, deepCopy, clamp,
} from "@/lib/model";
import { parseIntent, fallback } from "@/lib/intent";
import { parseIntentEN, fallbackEN } from "@/lib/intent-en";
import { tr, num, matName, matShort } from "@/lib/i18n";

const LANG_KEY = "cutwise-lang";
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
  /* el chat aún no se ha tocado: al cambiar de idioma se traduce entero */
  const pristine = useRef(true);

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
    pristine.current = false;
    const en = lang === "en";
    const T = tr(lang);
    const fb = () => { const f = en ? fallbackEN(msg) : fallback(msg); return { role: "ai", text: f.ask, suggest: f.suggest }; };
    say({ role: "you", text: msg });
    const before = deepCopy(params);
    const t0 = performance.now();

    const res = en ? parseIntentEN(msg, params) : parseIntent(msg, params);
    /* órdenes sobre el diseño entero: siempre reversibles con «deshaz» */
    if (res?.action === "reset") {
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
    if (res?.ask) { say({ role: "ai", text: res.ask, suggest: res.suggest }); return; }
    if (res) {
      const after = normalize(res.params);
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
      say({ role: "ai", text: bits.join(" "), chips: diffChips(before, after, lang),
            src: (en ? ms : ms.replace(".", ",")) + " ms" });
      return;
    }

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
      const others = c.shelves.filter((_, i) => i !== selection.shelf);
      const fl = c.drawers * DRAWER_H + (c.drawers ? 40 : 0);
      const val = clamp(Math.round(nv / 32) * 32, fl + 140, Hi - 140);
      if (!others.every((o) => Math.abs(o - val) >= 140)) return;
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
          <button className="tbtn photo-btn" aria-pressed={photo} onClick={() => setPhoto((v) => !v)}>{L.photo}</button>
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
          <Chat messages={messages} busy={busy} onSend={send} lang={lang} />
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
                <b>{matName(params.material, lang)}</b> · {params.thickness} mm
              </div>
              {photo && (
                <div className="glass pill mono">
                  {photoSamples < 3 ? L.photoPreparing : L.photoSamples(photoSamples)}
                </div>
              )}
            </div>
            <div className="vp-tr">
              <button className="glass iconbtn" title={L.viewFront} aria-label={L.viewFront} onClick={() => vp.current?.frame("front")}>▣</button>
              <button className="glass iconbtn" title={L.view34} aria-label={L.view34} onClick={() => vp.current?.frame("34")}>◱</button>
              <button className="glass iconbtn" title={L.viewTop} aria-label={L.viewTop} onClick={() => vp.current?.frame("top")}>⬒</button>
            </div>
            <div className="vp-bl">
              <div className="glass hint">
                <b>{L.hintBold}</b>{L.hintRest}
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
            params={params} selection={selection} founder={founder} lang={lang}
            onEdit={onEdit} onCommitEdit={onCommitEdit}
            onPushHistory={(snap) => { history.current.push(snap); }}
            onOrder={(q, rows, nested) => setModal({ q, rows, nested })}
            onCsv={downloadCsv}
            onReset={() => { history.current.push(deepCopy(params)); setParams(normalize(DEFAULT())); setSelection(null); vp.current?.frame("34"); }}
          />
        </div>

        <div className="tabs">
          <button aria-pressed={tab === "chat"} onClick={() => setTab("chat")}>{L.tabChat}</button>
          <button aria-pressed={tab === "spec"} onClick={() => setTab("spec")}>{L.tabSpec}</button>
        </div>
      </div>

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
