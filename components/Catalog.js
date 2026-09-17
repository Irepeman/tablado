"use client";
/* ============================================================
   CATÁLOGO DE PIEZAS
   Frentes y cajones, interior y tiradores, con un dibujo de cada uno.
   Con ratón o lápiz se arrastran sobre el mueble; en pantalla táctil
   (o con teclado) se tocan y luego se toca el hueco. El resaltado y la
   validación los hace el visor con las reglas del motor (canPlace).
   ============================================================ */
import { useRef, useState } from "react";
import { CATALOG } from "@/lib/model";
import { tr } from "@/lib/i18n";

const BRASS = "#b8924f";

/* dibujos de 44×36: un frente de mueble y la pieza */
export function PartIcon({ k }) {
  const frame = <rect x="8" y="3" width="28" height="30" rx="1.5" />;
  const hbar = (y) => <path d={`M18 ${y}h8`} className="hd" />;
  const icons = {
    door: <>{frame}<path d="M31 14v8" className="hd" /></>,
    drawer: <>{frame}{hbar(9)}</>,
    drawer2: <>{frame}<path d="M8 18h28" />{hbar(8)}{hbar(23)}</>,
    drawer3: <>{frame}<path d="M8 13h28M8 23h28" />{hbar(7)}{hbar(17)}{hbar(27)}</>,
    "door+drawer": <>{frame}<rect x="12" y="21" width="20" height="9" className="dash" /><path d="M31 9v6" className="hd" /></>,
    tray: <>{frame}<rect x="10" y="25" width="24" height="6" className="fill" /><path d="M19 28h6" className="hd" /></>,
    open: <><rect x="8" y="3" width="28" height="30" rx="1.5" className="dash" /><path d="M17 13l10 10M27 13l-10 10" className="thin" /></>,
    shelf: <>{frame}<path d="M8 18h28" className="thick" /></>,
    rail: <>{frame}<path d="M8 9h28" /><path d="M11 13h22" className="thick" /><path d="M22 13v3l-6 5h12l-6-5" className="thin" /></>,
    divider: <>{frame}<path d="M22 3v30" className="thick" /></>,
    "h:bar": <><rect x="8" y="6" width="28" height="24" rx="1.5" /><path d="M16 18h12" className="hd" /></>,
    "h:bar_brass": <><rect x="8" y="6" width="28" height="24" rx="1.5" /><path d="M16 18h12" className="hd" stroke={BRASS} /></>,
    "h:knob": <><rect x="8" y="6" width="28" height="24" rx="1.5" /><circle cx="22" cy="18" r="3" className="dot" /></>,
    "h:cup": <><rect x="8" y="6" width="28" height="24" rx="1.5" /><rect x="16" y="15.5" width="12" height="5" rx="2.5" className="fill" /></>,
    "h:profile": <><rect x="8" y="9" width="28" height="21" rx="1.5" /><path d="M8 6h28" className="thick" /></>,
    "h:push": <><rect x="8" y="6" width="28" height="24" rx="1.5" /><circle cx="22" cy="18" r="2" className="dot" /><circle cx="22" cy="18" r="5.5" className="thin" /></>,
  };
  return <svg viewBox="0 0 44 36" width="44" height="36" aria-hidden="true" className="picon part-icon">{icons[k]}</svg>;
}

export default function Catalog({ lang, placing, onTap, onDragMove, onDrop, onClose }) {
  const L = tr(lang);
  const [ghost, setGhost] = useState(null);
  const lastType = useRef(null);

  const down = (item) => (e) => {
    lastType.current = e.pointerType;
    if (e.pointerType === "touch" || e.button !== 0) return;   // táctil: tocar y tocar el hueco
    e.preventDefault();
    const d = { item, x0: e.clientX, y0: e.clientY, on: false };
    const move = (ev) => {
      if (!d.on && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 8) return;
      d.on = true;
      const ok = onDragMove(item, ev.clientX, ev.clientY);
      setGhost({ item, x: ev.clientX, y: ev.clientY, ok });
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setGhost(null);
      /* cancelado (el navegador se ha quedado el gesto): no se suelta nada */
      if (ev.type === "pointercancel") onDrop(item, NaN, NaN);
      else if (d.on) onDrop(item, ev.clientX, ev.clientY);
      else onTap(item);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <div className="glass catalog" role="dialog" aria-label={L.piecesTitle}>
      <div className="catalog-head">
        <b>{L.piecesTitle}</b>
        <button className="xbtn" aria-label={L.cancel} onClick={onClose}>×</button>
      </div>
      {Object.entries(CATALOG).map(([g, items]) => (
        <section key={g} className="catalog-group">
          <h5>{L.groups[g]}</h5>
          <div className="parts">
            {items.map((k) => (
              <button key={k} className="part" aria-pressed={placing === k} title={L.itemsHelp[k] || L.items[k]}
                      onPointerDown={down(k)}
                      onClick={() => { if (lastType.current !== "mouse" && lastType.current !== "pen") onTap(k); lastType.current = null; }}>
                <PartIcon k={k} />
                <span>{L.items[k]}</span>
              </button>
            ))}
          </div>
          {g === "handles" && <p className="catalog-note">{L.handlesWhole}</p>}
        </section>
      ))}
      <p className="catalog-note">{L.catalogHint}</p>
      {ghost && (
        <div className={"part-ghost" + (ghost.ok ? " ok" : " bad")} style={{ left: ghost.x, top: ghost.y }}>
          <PartIcon k={ghost.item} />
          <span>{L.items[ghost.item]}</span>
        </div>
      )}
    </div>
  );
}
