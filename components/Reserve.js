"use client";
/* ============================================================
   RESERVAR
   El diseño deja de ser una demo: se guarda con las medidas del hueco,
   cómo se tomaron y a quién contestar. Todo en este navegador; no hay
   servidor ni cuentas. Nunca se piden datos de tarjeta ni dirección.
   ============================================================ */
import { useState } from "react";
import { saveReservation, validate, asText, summary } from "@/lib/record";
import { tr } from "@/lib/i18n";

/* a dónde llegan las reservas; vacío = el cliente se la copia y nos la manda */
const INBOX = "";

export default function Reserve({ params, lang = "es", onClose, onSaved }) {
  const L = tr(lang);
  const [form, setForm] = useState({ gap: "", how: "tape", name: "", contact: "", note: "" });
  const [bad, setBad] = useState({});
  const [done, setDone] = useState(null);
  const [copied, setCopied] = useState(false);
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setBad((b) => ({ ...b, [k]: false })); };

  const submit = () => {
    const v = validate(form);
    if (!v.ok) { setBad(v.bad); return; }
    /* se guarda cómo lo midió con las palabras que leyó, no la clave interna */
    const entry = saveReservation({ params, form: { ...form, how: L.fHowOpts[form.how] || form.how } });
    setDone(entry);
    onSaved?.(entry);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(asText(done)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* sin portapapeles */ }
  };

  return (
    <div className="veil on" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal reserve" role="dialog" aria-label={L.reserveTitle}>
        {!done ? (
          <>
            <h3>{L.reserveTitle}</h3>
            <p>{L.reserveText}</p>
            <div className="ordrow"><span>{L.dims}</span><span className="mono">{summary(params)}</span></div>

            <label className="rf">
              <span>{L.fGap}</span>
              <input className="numin" value={form.gap} onChange={set("gap")} placeholder="210 × 240 × 60" inputMode="text" />
              <em>{L.fGapHint}</em>
            </label>
            <label className="rf">
              <span>{L.fHow}</span>
              <select className="sel" value={form.how} onChange={set("how")}>
                {Object.entries(L.fHowOpts).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className={"rf" + (bad.name ? " bad" : "")}>
              <span>{L.fName}</span>
              <input className="numin" value={form.name} onChange={set("name")} autoComplete="name" />
              {bad.name && <em className="err">{L.fBad.name}</em>}
            </label>
            <label className={"rf" + (bad.contact ? " bad" : "")}>
              <span>{L.fContact}</span>
              <input className="numin" value={form.contact} onChange={set("contact")} autoComplete="email" inputMode="email" />
              {bad.contact && <em className="err">{L.fBad.contact}</em>}
            </label>
            <label className="rf">
              <span>{L.fNote}</span>
              <input className="numin" value={form.note} onChange={set("note")} />
              <em>{L.fNoteHint}</em>
            </label>

            <p className="catalog-note">{L.reservePrivacy}</p>
            <div className="photo-actions">
              <button className="ghost" onClick={onClose}>{L.cancel}</button>
              <button className="cta" onClick={submit}>{L.reserveSend}</button>
            </div>
          </>
        ) : (
          <>
            <h3>{L.reserveDone}</h3>
            <p>{L.reserveDoneText(done.ref)}</p>
            <pre className="resumen">{asText(done)}</pre>
            <div className="photo-actions">
              <button className="ghost" onClick={copy}>{copied ? L.reserveCopied : L.reserveCopy}</button>
              {INBOX && (
                <a className="cta" href={`mailto:${INBOX}?subject=${encodeURIComponent("Reserva " + done.ref)}&body=${encodeURIComponent(asText(done))}`}>
                  {L.reserveMail}
                </a>
              )}
              <button className="cta" onClick={onClose}>{L.close}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
