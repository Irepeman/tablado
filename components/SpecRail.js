"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { woodSwatchURL } from "./wood";
import {
  MATERIALS, MATKEYS, THICKNESSES, SHEET, DRAWER_H,
  maxSpan, validate, addColumn, redistribute, setShelfCount, setDrawers, deepCopy, build,
} from "@/lib/model";
import { cutlist, nest, quote, PRICE } from "@/lib/pricing";
import { tr, num, money, matShort } from "@/lib/i18n";

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
  params, selection, founder, onEdit, onCommitEdit, onPushHistory, onOrder, onCsv, onReset, lang = "es",
}) {
  const L = tr(lang);
  const p = params;
  const t = p.thickness;
  const n = (v) => num(v, lang);
  const eur = (v) => money(v, lang, 0);
  const eur2 = (v) => money(v, lang, 2);

  /* las fichas enseñan la misma madera que el 3D, no un degradado */
  const [swatch, setSwatch] = useState({});
  useEffect(() => {
    setSwatch({ roble: woodSwatchURL("roble"), nogal: woodSwatchURL("nogal"),
                abedul: woodSwatchURL("abedul") });
  }, []);

  const { rows, nested, q, flags, span } = useMemo(() => {
    const geo = build(p, lang);
    const rows = cutlist(geo);
    const nested = nest(rows);
    return {
      rows, nested,
      q: quote(p, geo, nested),
      flags: validate(p, geo, lang),
      span: maxSpan(p.material, t),
    };
  }, [p, t, lang]);

  const edit = (fn) => { const next = deepCopy(p); fn(next); onCommitEdit(next); };
  /* deslizadores: se guarda el estado de ANTES al pulsar y se apila al soltar,
     para que «Deshacer» vuelva al valor previo al arrastre */
  const snap = useRef(null);
  const grab = () => { if (!snap.current) snap.current = deepCopy(p); };
  const release = () => { if (snap.current) { onPushHistory(snap.current); snap.current = null; } };
  const maxDrawers = Math.min(4, Math.max(0, Math.floor((p.height - p.baseHeight - 2 * p.thickness) / DRAWER_H)));
  const live = (fn) => { const next = deepCopy(p); fn(next); onEdit(next); };

  const pieces = rows.reduce((a, r) => a + r.qty, 0);
  const avgYield = nested.yield.length
    ? nested.yield.reduce((a, b) => a + b, 0) / nested.yield.length : 0;

  return (
    <aside className="rail right">
      <div className="scroll">
        <section className="sec">
          <h3>{L.measures}
            <em className="mono">
              {L.colsShelves(p.columns.length, p.columns.reduce((a, c) => a + c.shelves.length, 0))}
            </em>
          </h3>
          {[[L.width, "width", 400, 3200], [L.heightL, "height", 400, 2600], [L.depth, "depth", 180, 600]]
            .map(([label, key, min, max]) => (
              <div className="f" key={key}>
                <label htmlFor={key}>{label}</label>
                <input id={key} type="range" min={min} max={max} step={10} value={p[key]}
                       onPointerDown={grab} onKeyDown={grab}
                       onChange={(e) => live((x) => { x[key] = Number(e.target.value); })}
                       onPointerUp={release} onKeyUp={release} onBlur={release} />
                <NumField value={p[key]} onCommit={(v) => edit((x) => { x[key] = v; })} />
              </div>
            ))}
        </section>

        <section className="sec">
          <h3>{L.materialH}</h3>
          <div className="swatches">
            {MATKEYS.map((k) => {
              const M = MATERIALS[k];
              const hex = "#" + M.hex.toString(16).padStart(6, "0");
              return (
                <button className="sw" key={k} aria-pressed={p.material === k}
                        onClick={() => edit((x) => { x.material = k; })}>
                  <div className="pat" style={{
                    backgroundColor: hex,
                    backgroundImage: swatch[k] ? `url(${swatch[k]})` : undefined,
                    backgroundSize: "cover",
                  }} />
                  <small>{matShort(k, lang)}</small>
                </button>
              );
            })}
          </div>
          <div className="f" style={{ marginTop: 10 }}>
            <label>{L.thickness}</label>
            <Seg value={t} options={THICKNESSES.map((v) => [v, `${v} mm`])}
                 onPick={(v) => edit((x) => { x.thickness = Number(v); })} />
          </div>
          <div className="f">
            <label>{L.base}</label>
            <Seg value={p.base}
                 options={[["patas", L.baseOpts.patas], ["zocalo", L.baseOpts.zocalo], ["flotante", L.baseOpts.flotante]]}
                 onPick={(v) => edit((x) => {
                   x.base = v;
                   x.baseHeight = v === "patas" ? 110 : v === "zocalo" ? 80 : 0;
                 })} />
          </div>
          <div className="f">
            <label>{L.back}</label>
            <Seg value={p.back} options={[[true, L.withBack], [false, L.noBack]]}
                 onPick={(v) => edit((x) => { x.back = v === true || v === "true"; })} />
          </div>
        </section>

        <section className="sec">
          <h3>{L.columns}
            <em>
              <button className="mini" onClick={() => edit((x) => {
                redistribute(x);
                x.columns.forEach((c) => setShelfCount(x, c, c.shelves.length || 3));
              })}>{L.even}</button>
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
                    {n(c.width)}
                  </span>
                  <span className="meta">
                    {L.shelvesN(c.shelves.length)}
                    {c.drawers ? ` · ${L.drawersN(c.drawers)}` : ""}
                    {c.door ? ` · ${L.withDoor}` : ""}
                  </span>
                  <div className="acts">
                    <button className="mini" disabled={!c.shelves.length} title={L.tMinusShelf}
                      onClick={() => edit((x) => setShelfCount(x, x.columns[i], c.shelves.length - 1))}>{L.minusShelf}</button>
                    <button className="mini" title={L.tPlusShelf}
                      onClick={() => edit((x) => setShelfCount(x, x.columns[i], c.shelves.length + 1))}>{L.plusShelf}</button>
                    <button className="mini" disabled={!c.drawers} title={L.tMinusDrawer}
                      onClick={() => edit((x) => setDrawers(x, x.columns[i], c.drawers - 1))}>{L.minusDrawer}</button>
                    <button className="mini" disabled={c.drawers >= maxDrawers} title={L.tPlusDrawer}
                      onClick={() => edit((x) => setDrawers(x, x.columns[i], c.drawers + 1))}>{L.plusDrawer}</button>
                    <button className="mini"
                      onClick={() => edit((x) => { x.columns[i].door = !c.door; })}>
                      {c.door ? L.minusDoor : L.plusDoor}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 5, marginTop: 8 }}>
            <button className="mini" style={{ flex: 1, padding: 5 }}
                    onClick={() => edit((x) => { addColumn(x); redistribute(x); })}>{L.addCol}</button>
            <button className="mini" style={{ flex: 1, padding: 5 }}
                    onClick={() => edit((x) => {
                      if (x.columns.length < 2) return;
                      const w = Math.min(...x.columns.map((c) => c.width));
                      x.columns.splice(x.columns.findIndex((c) => c.width === w), 1);
                      redistribute(x);
                    })}>{L.delCol}</button>
          </div>
        </section>

        <section className="sec">
          <h3>{L.checks}</h3>
          <div className="flags">
            {flags.map((f, i) => (
              <div className={"flag " + f.lvl} key={i}>
                <span className="ic">{f.lvl === "warn" ? "▲" : "●"}</span>
                <div>
                  <b>{f.t}</b><br />{f.d}
                  {f.fix === "addColumn" && (
                    <><br /><button onClick={() => edit((x) => { addColumn(x); redistribute(x); })}>
                      {L.addDivider}
                    </button></>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="sec">
          <h3>{L.datasheet}</h3>
          <dl className="stats">
            {[
              [L.st.area, q.panelM2.toFixed(2), L.units.m2],
              [L.st.weight, `${Math.round(q.weight)}`, L.units.kg],
              [L.st.edge, q.edgeML.toFixed(1), L.units.m],
              [L.st.span, n(span), L.units.mm],
              [L.st.hw, `${q.hw.minifix + q.hw.pins + q.hw.hinges + q.hw.runners * 2}`, L.units.ud],
              [L.st.lead, "12–16", L.units.days],
            ].map(([k, v, u]) => (
              <div className="stat" key={k}>
                <dt>{k}</dt><dd>{v} <small>{u}</small></dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="sec">
          <h3>{L.cutlist} <em className="mono">{L.piecesN(pieces)}</em></h3>
          <div className="tblwrap">
            <table className="cut">
              <thead>
                <tr><th>{L.th.piece}</th><th className="r">{L.th.qty}</th><th className="r">{L.th.len}</th>
                    <th className="r">{L.th.wid}</th><th className="r">{L.th.edge}</th></tr>
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
          <h3>{L.cutplan}
            <em className="mono">{L.sheetsYieldShort(nested.sheets.length, Math.round(avgYield * 100))}</em>
          </h3>
          <div className="sheets">
            {nested.sheets.map((sh, i) => (
              <figure className="sheet-wrap" key={i}>
                <figcaption>
                  <span>{L.sheetN(i + 1)} · {SHEET.L}×{SHEET.W}×{t}</span>
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
            {!nested.sheets.length && <p style={{ fontSize: 12, color: "var(--ink-3)", margin: 0 }}>{L.noSheets}</p>}
          </div>
        </section>
      </div>

      <div className="sec price">
        <div className="pr-main">
          <span className="v">{eur(q.gross)}</span>
          <span className="u">{L.priceNote}</span>
        </div>
        <div className="pr-sub">
          {L.priceSub(pieces, nested.sheets.length, matShort(p.material, lang))}
        </div>

        {founder && (
          <div className="founder on">
            <h5>{L.unitEco}</h5>
            {Object.entries(q.c).map(([k, v]) => (
              <div className="fr" key={k}><span>{L.costs[k] || k}</span><span>{eur2(v)}</span></div>
            ))}
            <div className="fr"><span>{L.shipping}</span><span>{eur2(PRICE.ship)}</span></div>
            <div className="fr tot"><span>{L.directCost}</span><span>{eur2(q.cost + PRICE.ship)}</span></div>
            <div className="fr tot">
              <span>{L.grossMargin}</span>
              <span>{Math.round(q.margin * 100)}% · {eur2(q.net - PRICE.ship - q.cost)}</span>
            </div>
          </div>
        )}

        <button className="cta" onClick={() => onOrder(q, rows, nested)}>{L.order}</button>
        <div className="cta-sub">
          <button onClick={() => onCsv(rows, q)}>{L.csv}</button>
          <button onClick={onReset}>{L.reset}</button>
        </div>
      </div>
    </aside>
  );
}
