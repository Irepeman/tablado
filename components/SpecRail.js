"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { woodSwatchURL } from "./wood";
import {
  MATERIALS, MATKEYS, THICKNESSES, SHEET, MIN_FRONT, PRESET_KEYS, HANDLES,
  maxSpan, validate, addColumn, redistribute, setShelfCount, setDrawers, deepCopy, build, isRail, cellClear, minSize, clamp,
} from "@/lib/model";

/* Dibujo de cada tipo de mueble, en línea: se lee de un vistazo */
function PresetIcon({ k }) {
  const box = (x, y, w, h, extra = "") => <rect x={x} y={y} width={w} height={h} rx="1" {...(extra ? { className: extra } : {})} />;
  const g = {
    estanteria: <>{box(6, 4, 36, 32)}<path d="M18 4v32M30 4v32M6 15h36M6 26h36" /></>,
    libreria: <>{box(6, 4, 36, 32)}<path d="M18 4v32M30 4v32M6 15h36M6 26h36" />{box(7, 27, 10, 8, "fill")}{box(19, 27, 10, 8, "fill")}{box(31, 27, 10, 8, "fill")}</>,
    armario: <>{box(10, 2, 28, 36)}<path d="M24 2v36M10 9h28" /><path d="M14 13h7" className="thin" /><circle cx="22" cy="24" r="0.9" /><circle cx="26" cy="24" r="0.9" /></>,
    aparador: <>{box(4, 14, 40, 18)}<path d="M17 14v18M31 14v18M17 20h14M17 26h14M8 38l1-6M40 38l-1-6" /></>,
    tv: <>{box(4, 20, 40, 12)}<path d="M15 20v12M33 20v12M8 36l1-4M40 36l-1-4" />{box(16, 4, 16, 11)}</>,
    comoda: <>{box(10, 8, 28, 26)}<path d="M24 8v26M10 16.5h28M10 25h28M13 38l1-4M35 38l-1-4" /></>,
  };
  return <svg viewBox="0 0 48 40" width="42" height="35" aria-hidden="true" className="picon">{g[k]}</svg>;
}
import { cutlist, nest, quote, PRICE } from "@/lib/pricing";
import { tr, num, money, matShort } from "@/lib/i18n";
import { reservations, misses, reservationsCsv, missesCsv, clearAll } from "@/lib/record";

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

/* ------------------------------------------------------------
   EL REGISTRO (modo fundador)
   Las reservas que ha dejado alguien y las frases que el chat no
   entendió. Es lo único que el producto guarda, y es la materia prima
   de lo que queremos defender: saber qué espacios y qué palabras reales
   aparecen, y cuáles de ellos acaban en un encargo.
   ------------------------------------------------------------ */
function RecordPanel({ L }) {
  const [book, setBook] = useState([]);
  const [miss, setMiss] = useState([]);
  const refresh = () => { setBook(reservations()); setMiss(misses()); };
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);          // se llena mientras alguien usa la app
    return () => clearInterval(t);
  }, []);
  const save = (name, text) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8" }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const when = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };

  return (
    <div className="founder on record">
      <h5>{L.recordTitle}</h5>
      <div className="fr"><span>{L.recordBook(book.length)}</span><span>{L.recordMiss(miss.length)}</span></div>
      {!book.length && !miss.length && <p className="catalog-note">{L.recordEmpty}</p>}
      {book.slice(0, 4).map((r) => (
        <div className="rec" key={r.ref}>
          <b>{r.ref}</b> · {r.name} · {r.contact}
          <small>{r.piece}{r.gap ? ` · hueco ${r.gap}` : ""} · {when(r.at)}</small>
        </div>
      ))}
      {miss.slice(0, 4).map((m, i) => (
        <div className="rec miss" key={m.at + i}>
          “{m.text}”
          <small>{m.lang} · {when(m.at)}</small>
        </div>
      ))}
      <div className="cta-sub">
        <button onClick={() => save("cutwise-reservas.csv", reservationsCsv())}>{L.recordCsv}</button>
        <button onClick={() => { clearAll(); refresh(); }}>{L.recordClear}</button>
      </div>
      <p className="catalog-note">{L.recordNote}</p>
    </div>
  );
}

export default function SpecRail({
  params, selection, founder, onEdit, onCommitEdit, onPushHistory, onOrder, onCsv, onReset, onPreset, onReserve, lang = "es",
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
  /* cuántos cajones caben en la columna: hasta 3 por hueco, según su altura */
  const drawerCap = (c) => c.cells.reduce((a, x, j) => a + (isRail(x) ? 0 : Math.min(3, Math.floor(cellClear(p, c, j) / MIN_FRONT))), 0);
  const live = (fn) => { const next = deepCopy(p); fn(next); onEdit(next); };

  const pieces = rows.reduce((a, r) => a + r.qty, 0);
  const avgYield = nested.yield.length
    ? nested.yield.reduce((a, b) => a + b, 0) / nested.yield.length : 0;

  return (
    <aside className="rail right">
      <div className="scroll">
        <section className="sec">
          <h3>{L.presetsH}</h3>
          <div className="presets">
            {PRESET_KEYS.map((k) => (
              <button key={k} className="preset" onClick={() => onPreset?.(k)}>
                <PresetIcon k={k} />
                <span>{L.presets[k]}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="sec">
          <h3>{L.measures}
            <em className="mono">
              {L.colsShelves(p.columns.length, p.columns.reduce((a, c) => a + c.shelves.length, 0))}
            </em>
          </h3>
          {/* el tope de abajo lo marcan las columnas y las baldas que ya tiene: encogerlo
              más las borraba, y volver a estirarlo no las devolvía */}
          {[[L.width, "width", 400, 3200], [L.heightL, "height", 400, 2600], [L.depth, "depth", 180, 600]]
            .map(([label, key, min, max]) => {
              const lim = minSize(p);
              const lo = Math.max(min, Math.min(lim[key] ?? min, p[key]));
              return (
              <div className="f" key={key}>
                <label htmlFor={key}>{label}</label>
                <input id={key} type="range" min={lo} max={max} step={10} value={p[key]}
                       onPointerDown={grab} onKeyDown={grab}
                       onChange={(e) => live((x) => { x[key] = clamp(Number(e.target.value), lo, max); })}
                       onPointerUp={release} onKeyUp={release} onBlur={release} />
                <NumField value={p[key]} onCommit={(v) => edit((x) => { x[key] = clamp(v, lo, max); })} />
              </div>
              );
            })}
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
          <div className="f">
            <label htmlFor="handle-style">{L.handleL}</label>
            <select id="handle-style" className="sel" value={p.handle || "bar"}
                    onChange={(e) => edit((x) => { x.handle = e.target.value; })}>
              {HANDLES.map((h) => <option key={h} value={h}>{L.items["h:" + h]}</option>)}
            </select>
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
                    {c.cells.some(isRail) ? ` · ${L.withRail}` : ""}
                  </span>
                  <div className="acts">
                    <button className="mini" disabled={!c.shelves.length} title={L.tMinusShelf}
                      onClick={() => edit((x) => setShelfCount(x, x.columns[i], c.shelves.length - 1))}>{L.minusShelf}</button>
                    <button className="mini" title={L.tPlusShelf}
                      onClick={() => edit((x) => setShelfCount(x, x.columns[i], c.shelves.length + 1))}>{L.plusShelf}</button>
                    <button className="mini" disabled={!c.drawers} title={L.tMinusDrawer}
                      onClick={() => edit((x) => setDrawers(x, x.columns[i], c.drawers - 1))}>{L.minusDrawer}</button>
                    <button className="mini" disabled={c.drawers >= drawerCap(c)} title={L.tPlusDrawer}
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
                  {f.fix === "hangDepth" && (
                    <><br /><button onClick={() => edit((x) => { x.depth = 580; })}>{L.fixDepth}</button></>
                  )}
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
              [L.st.hw, `${q.hw.minifix + q.hw.pins + q.hw.hinges + q.hw.runners * 2 + q.hw.rails * 3}`, L.units.ud],
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

        {founder && <RecordPanel L={L} />}

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

        <button className="cta" onClick={onReserve}>{L.reserve}</button>
        <div className="cta-sub">
          <button onClick={() => onOrder(q, rows, nested)}>{L.order}</button>
          <button onClick={() => onCsv(rows, q)}>{L.csv}</button>
          <button onClick={onReset}>{L.reset}</button>
        </div>
      </div>
    </aside>
  );
}
