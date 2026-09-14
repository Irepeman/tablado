"use client";
import { useEffect, useRef, useState } from "react";

const SEEDS = [
  "Que quepa en un hueco de 2,10 m",
  "Prepárala para vinilos",
  "No quiero que tenga fondo",
  "Dos cajones abajo a la izquierda",
];

export default function Chat({ messages, busy, onSend }) {
  const [text, setText] = useState("");
  const scrollRef = useRef(null);
  const taRef = useRef(null);

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
        <h2>Copiloto</h2>
      </div>

      <div className="scroll" ref={scrollRef}>
        <div className="chat">
          {messages.map((m, i) =>
            m.role === "you" ? (
              <div className="msg you" key={i}>{m.text}</div>
            ) : m.role === "sys" ? (
              <div className="msg sys" key={i}>{m.text}</div>
            ) : (
              <div className="msg ai" key={i}>
                <span className="av">T</span>
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
                        ? <>Resuelto por el <b>copiloto</b></>
                        : <>Resuelto <b>en el navegador</b> · {m.src}</>}
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
        {SEEDS.map((s) => (
          <button className="chip" key={s} onClick={() => onSend(s)} disabled={busy}>
            {s}
          </button>
        ))}
      </div>

      <div className="composer">
        <form onSubmit={submit}>
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            placeholder="Dime qué quieres cambiar…"
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
            Enviar
          </button>
        </form>
      </div>
    </aside>
  );
}
