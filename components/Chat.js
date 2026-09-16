"use client";
import { useEffect, useRef, useState } from "react";
import { tr } from "@/lib/i18n";

export default function Chat({ messages, busy, onSend, onPhoto, lang = "es" }) {
  const L = tr(lang);
  const [text, setText] = useState("");
  const scrollRef = useRef(null);
  const taRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = (e) => {
    e?.preventDefault();
    const v = text.trim();
    if (!v || busy) return;
    setText("");
    if (taRef.current) taRef.current.style.height = "auto";
    onSend(v);
  };

  return (
    <aside className="rail left">
      <div className="rail-head">
        <span className="dot" />
        <h2>{L.copilot}</h2>
      </div>

      <div className="scroll" ref={scrollRef}>
        <div className="chat">
          {messages.map((m, i) =>
            m.role === "you" ? (
              <div className="msg you" key={i}>
                {m.image && <img className="msg-img" src={m.image} alt={L.photoMsg} />}
                {m.text}
              </div>
            ) : m.role === "sys" ? (
              <div className="msg sys" key={i}>{m.text}</div>
            ) : (
              <div className="msg ai" key={i}>
                <span className="av">C</span>
                <div className="txt">
                  {m.text}
                  {m.chips?.length > 0 && (
                    <div className="chg">
                      {m.chips.map((c, j) => <i key={j}>{c}</i>)}
                    </div>
                  )}
                  {m.src && (
                    <span className="src">
                      {m.src === "server"
                        ? <>{L.resolvedServer[0]}<b>{L.resolvedServer[1]}</b></>
                        : <>{L.resolvedLocal[0]}<b>{L.resolvedLocal[1]}</b> · {m.src}</>}
                    </span>
                  )}
                  {m.suggest?.length > 0 && (
                    <div className="sugg">
                      {m.suggest.map((x) => (
                        <button key={x} className="chip" onClick={() => onSend(x)} disabled={busy}>{x}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
        </div>
      </div>

      <div className="chips">
        {L.seeds.map((s) => (
          <button className="chip" key={s} onClick={() => onSend(s)} disabled={busy}>
            {s}
          </button>
        ))}
      </div>

      <div className="composer">
        <form onSubmit={submit}>
          <button type="button" className="photo-pick" title={L.fromPhoto} aria-label={L.fromPhoto} disabled={busy}
                  onClick={() => fileRef.current?.click()}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
              <circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
            </svg>
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden
                 onChange={(e) => {
                   const f = e.target.files?.[0];
                   e.target.value = "";
                   if (!f) return;
                   onPhoto?.(f, text.trim());
                   setText("");
                 }} />
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            placeholder={L.placeholder}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) submit(e);
            }}
          />
          <button className="send" type="submit" disabled={busy || !text.trim()}>
            {L.send}
          </button>
        </form>
      </div>
    </aside>
  );
}
