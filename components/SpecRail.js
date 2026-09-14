"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { woodSwatchURL } from "./wood";
import {
  MATERIALS, MATKEYS, THICKNESSES, SHEET, DRAWER_H,
  maxSpan, validate, addColumn, redistribute, setShelfCount, deepCopy, build,
} from "@/lib/model";
import { cutlist, nest, quote, PRICE, mm, eur, eur2 } from "@/lib/pricing";

/* Campo numérico con borrador propio: se escribe libremente y el valor solo
   se aplica al pulsar Intro o salir del campo (Esc cancela). Antes, cada
   tecla pasaba por normalize() y al teclear «2» el campo saltaba a 600. */
function NumField({ value, onCommit }) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const cancel = useRef(false);
  useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);
  const commit = () => {
    setEditing(false);
    if (cancel.current) { cancel.current = false; setDraft(String(value)); return; }
    let v = Number(String(draft).replace(",", ".").trim());
    if (Number.isFinite(v) && v > 0 && v < 10) v *= 1000;     // «2,1» → 2100 mm
    if (Number.isFinite(v) && v > 0 && Math.round(v) !== value) onCommit(Math.round(v));
    else setDraft(String(value));
  };
  return (
    <input className="numin mono" inputMode="decimal" value={draft}
           onFocus={(e) => { setEditing(true); e.target.select(); }}
           onChange={(e) => setDraft(e.target.value)}
           onBlur={commit}
           onKeyDown={(e) => {
             if (e.key === "Enter") e.currentTarget.blur();
             if (e.key === "Escape") { cancel.current = true; e.currentTarget.blur(); }
           }} />
  );
}

function Seg({ options, value, onPick }) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button key={String(v)} aria-pressed={String(v) === String(value)}
                onClick={() => onPick(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export default function SpecRail({
  params, selection, founder, onEdit, onCommitEdit, onPushHistory, onOrder, onCsv, onReset,
}) {
  const p = params;
  const t = p.thickness;

  /* las fichas enseñan la misma madera que el 3D, no un degradado */
  const [swatch, setSwatch] = useState({});
  useEffect(() => {
    setSwatch({ roble: woodSwatchURL("roble"), nogal: woodSwatchURL("nogal"),
                abedul: woodSwatchURL("abedul") });
  }, []);

  const { geo, rows, nested, q, flags, span } = useMemo(() => {
    const geo = build(p);
    const rows = cutlist(geo);
    const nested = nest(rows);
    return {
      geo, rows, nested,
      q: quote(p, geo, nested),
      flags: validate(p, geo),
      span: maxSpan(p.material, t),
    };
  }, [p, t]);

  const edit = (fn) => { const n = deepCopy(p); fn(n); onCommitEdit(n); };
  /* deslizadores: se guarda el estado de ANTES al pulsar y se apila al soltar,
     para que «Deshacer» vuelva al valor previo al arrastre */
  const snap = useRef(null);
  const grab = () => { if (!snap.current) snap.current = deepCopy(p); };
  const release = () => { if (snap.current) { onPushHistory(snap.current); snap.current = null; } };
  const maxDrawers = Math.min(4, Math.max(0, Math.floor((p.height - p.baseHeight - 2 * p.thickness) / DRAWER_H)));
  const live = (fn) => { const n = deepCopy(p); fn(n); onEdit(n); };

  const pieces = rows.reduce((a, r) => a + r.qty, 0);
  const avgYield = nested.yield.length
    ? nested.yield.reduce((a, b) => a + b, 0) / nested.yield.length : 0;

  return (
    <aside className="rail right">
      <div className="scroll">
        <section className="sec">
          <h3>Medidas
            <em className="mono">
              {p.columns.length} col · {p.columns.reduce((a, c) => a + c.shelves.length, 0)} baldas
            </em>
          </h3>
          {[["Ancho", "width", 400, 3200], ["Alto", "height", 400, 2600], ["Fondo", "depth", 180, 600]]
            .map(([label, key, min, max]) => (
              <div className="f" key={key}>
                <label htmlFor={key}>{label}</label>
                <input id={key} type="range" min={min} max={max} step={10} value={p[key]}
                       onPointerDown={grab} onKeyDown={grab}
                       onChange={(e) => live((n) => { n[key] = Number(e.target.value); })}
                       onPointerUp={release} onKeyUp={release} onBlur={release} />
                <NumField value={p[key]} onCommit={(v) => edit((n) => { n[key] = v; })} />
              </div>
            ))}
        </section>

        <section className="sec">
          <h3>Material</h3>
          <div className="swatches">
            {MATKEYS.map((k) => {
              const M = MATERIALS[k];
              const hex = "#" + M.hex.toString(16).padStart(6, "0");
              return (
                <button className="sw" key={k} aria-pressed={p.material === k}
                        onClick={() => edit((n) => { n.material = k; })}>
                  <div className="pat" style={{
                    backgroundColor: hex,
                    backgroundImage: swatch[k] ? `url(${swatch[k]})` : undefined,
                    backgroundSize: "cover",
                  }} />
                  <small>{M.short}</small>
                </button>
              );
            })}
          </div>
          <div className="f" style={{ marginTop: 10 }}>
            <label>Espesor</label>
            <Seg value={t} options={THICKNESSES.map((v) => [v, `${v} mm`])}
                 onPick={(v) => edit((n) => { n.thickness = Number(v); })} />
          </div>
          <div className="f">
            <label>Base</label>
            <Seg value={p.base}
                 options={[["patas", "Patas"], ["zocalo", "Zócalo"], ["flotante", "Suspendido"]]}
                 onPick={(v) => edit((n) => {
                   n.base = v;
                   n.baseHeight = v === "patas" ? 110 : v === "zocalo" ? 80 : 0;
                 })} />
          </div>
          <div className="f">
            <label>Trasera</label>
            <Seg value={p.back} options={[[true, "Con trasera"], [false, "Sin trasera"]]}
                 onPick={(v) => edit((n) => { n.back = v === true || v === "true"; })} />
          </div>
        </section>

        <section className="sec">
          <h3>Columnas
            <em>
              <button className="mini" onClick={() => edit((n) => {
                redistribute(n);
                n.columns.forEach((c) => setShelfCount(n, c, c.shelves.length || 3));
              })}>Repartir</button>
            </em>
          </h3>
          <div className="cols">
            {p.columns.map((c, i) => {
              const over = c.width > span;
              const sel = selection &&
                ((selection.k === "shelf" && selection.col === i) ||
                 (selection.k === "div" && selection.div === i));
              return (
                <div className={"col" + (sel ? " sel" : "")} key={i}>
                  <span className="n">{i + 1}</span>
                  <span className="w" style={over ? { color: "var(--amber)", fontWeight: 600 } : undefined}>
                    {mm(c.width)}
                  </span>
                  <span className="meta">
                    {c.shelves.length} baldas
                    {c.drawers ? ` · ${c.drawers} cajones` : ""}
                    {c.door ? " · puerta" : ""}
                  </span>
                  <div className="acts">
                    <button className="mini" disabled={!c.shelves.length} title="Quitar una balda"
                      onClick={() => edit((n) => setShelfCount(n, n.columns[i], c.shelves.length - 1))}>−balda</button>
                    <button className="mini" title="Añadir una balda"
                      onClick={() => edit((n) => setShelfCount(n, n.columns[i], c.shelves.length + 1))}>+balda</button>
                    <button className="mini" disabled={!c.drawers} title="Quitar un cajón"
                      onClick={() => edit((n) => { n.columns[i].drawers = c.drawers - 1; })}>−cajón</button>
                    <button className="mini" disabled={c.drawers >= maxDrawers} title="Añadir un cajón"
                      onClick={() => edit((n) => { n.columns[i].drawers = c.drawers + 1; })}>+cajón</button>
                    <button className="mini"
                      onClick={() => edit((n) => { n.columns[i].door = !c.door; })}>
                      {c.door ? "−puerta" : "+puerta"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 5, marginTop: 8 }}>
            <button className="mini" style={{ flex: 1, padding: 5 }}
                    onClick={() => edit((n) => { addColumn(n); redistribute(n); })}>+ Columna</button>
            <button className="mini" style={{ flex: 1, padding: 5 }}
                    onClick={() => edit((n) => {
                      if (n.columns.length < 2) return;
                      const w = Math.min(...n.columns.map((c) => c.width));
                      n.columns.splice(n.columns.findIndex((c) => c.width === w), 1);
                      redistribute(n);
                    })}>− Columna</button>
          </div>
        </section>

        <section className="sec">
          <h3>Verificación de fabricación</h3>
          <div className="flags">
            {flags.map((f, i) => (
              <div className={"flag " + f.lvl} key={i}>
                <span className="ic">{f.lvl === "warn" ? "▲" : "●"}</span>
                <div>
                  <b>{f.t}</b><br />{f.d}
                  {f.fix === "addColumn" && (
                    <><br /><button onClick={() => edit((n) => { addColumn(n); redistribute(n); })}>
                      Añadir divisor
                    </button></>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="sec">
          <h3>Ficha técnica</h3>
          <dl className="stats">
            {[
              ["Superficie de tablero", `${q.panelM2.toFixed(2)}`, "m²"],
              ["Peso montado", `${Math.round(q.weight)}`, "kg"],
              ["Canto aplicado", `${q.edgeML.toFixed(1)}`, "m"],
              ["Luz máx. admisible", mm(span), "mm"],
              ["Herrajes", `${q.hw.minifix + q.hw.pins + q.hw.hinges + q.hw.runners * 2}`, "ud"],
              ["Plazo estimado", "12–16", "días"],
            ].map(([k, v, u]) => (
              <div className="stat" key={k}>
                <dt>{k}</dt><dd>{v} <small>{u}</small></dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="sec">
          <h3>Despiece <em className="mono">{pieces} piezas</em></h3>
          <div className="tblwrap">
            <table className="cut">
              <thead>
                <tr><th>Pieza</th><th className="r">Ud</th><th className="r">Largo</th>
                    <th className="r">Ancho</th><th className="r">Canto</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.label}</td><td className="r">{r.qty}</td>
                    <td className="r">{r.L}</td><td className="r">{r.W}</td>
                    <td className="r">{r.edges === 4 ? "4c" : r.edges === 1 ? "1c" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="sec">
          <h3>Plan de corte
            <em className="mono">
              {nested.sheets.length} tablero{nested.sheets.length !== 1 ? "s" : ""} · {Math.round(avgYield * 100)}% aprov.
            </em>
          </h3>
          <div className="sheets">
            {nested.sheets.map((sh, i) => (
              <figure className="sheet-wrap" key={i}>
                <figcaption>
                  <span>Tablero {i + 1} · {SHEET.L}×{SHEET.W}×{t}</span>
                  <span>{Math.round(nested.yield[i] * 100)}%</span>
                </figcaption>
                <svg viewBox={`0 0 ${SHEET.L} ${SHEET.W}`} preserveAspectRatio="xMidYMid meet">
                  <rect x="0" y="0" width={SHEET.L} height={SHEET.W} fill="none"
                        stroke="var(--line-2)" strokeWidth="8" strokeDasharray="24 16" />
                  {sh.bands.flatMap((b) => b.items).map((it, j) => (
                    <g key={j}>
                      <rect x={it.x} y={it.y} width={it.L} height={it.W}
                            fill="var(--pine-soft)" stroke="var(--pine)" strokeWidth="6" />
                      <text x={it.x + it.L / 2} y={it.y + it.W / 2 + 22} fontSize="58"
                            fill="var(--ink-3)" textAnchor="middle"
                            fontFamily="IBM Plex Mono, monospace">{it.L}×{it.W}</text>
                    </g>
                  ))}
                </svg>
              </figure>
            ))}
          </div>
        </section>
      </div>

      <div className="sec price">
        <div className="pr-main">
          <span className="v">{eur(q.gross)}</span>
          <span className="u">IVA incl. · envío peninsular</span>
        </div>
        <div className="pr-sub">
          {pieces} piezas · {nested.sheets.length} tablero{nested.sheets.length !== 1 ? "s" : ""} de{" "}
          {MATERIALS[p.material].short} · montaje en 40–60 min
        </div>

        {founder && (
          <div className="founder on">
            <h5>Unidad económica</h5>
            {Object.entries(q.c).map(([k, v]) => (
              <div className="fr" key={k}><span>{k}</span><span>{eur2(v)}</span></div>
            ))}
            <div className="fr"><span>Envío</span><span>{eur2(PRICE.ship)}</span></div>
            <div className="fr tot"><span>Coste directo</span><span>{eur2(q.cost + PRICE.ship)}</span></div>
            <div className="fr tot">
              <span>Margen bruto</span>
              <span>{Math.round(q.margin * 100)}% · {eur2(q.net - PRICE.ship - q.cost)}</span>
            </div>
          </div>
        )}

        <button className="cta" onClick={() => onOrder(q, rows, nested)}>Enviar a fabricación</button>
        <div className="cta-sub">
          <button onClick={() => onCsv(rows, q)}>Descargar despiece</button>
          <button onClick={onReset}>Empezar de cero</button>
        </div>
      </div>
    </aside>
  );
}
