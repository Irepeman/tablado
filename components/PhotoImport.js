"use client";
/* ============================================================
   CREAR DESDE UNA FOTO
   La foto se queda en el navegador: no se sube a ningún servidor.
   Se ajustan las 4 esquinas del mueble, se ve encima lo detectado
   (divisores, baldas y el tipo de cada hueco) y, con las medidas,
   se crea un mueble del motor listo para seguir editando.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from "react";
import { rectify, detectStructure, toParams, guessQuad, homography, quadAspect, summarize } from "@/lib/photo";
import { MATKEYS, clamp } from "@/lib/model";
import { tr, matShort } from "@/lib/i18n";

const MAX_SIDE = 1400;

/* «1,80», «180 cm», «1800 mm», «2x2» → mm */
function lenOf(txt) {
  const m = String(txt || "").replace(",", ".").match(/(\d+(?:\.\d+)?)\s*(mm|cm|m)?\b/);
  if (!m) return null;
  let v = parseFloat(m[1]);
  const u = m[2] || "";
  if (u === "m" || (!u && v < 10)) v *= 1000;
  else if (u === "cm" || (!u && v <= 400)) v *= 10;
  return Math.round(v);
}

export default function PhotoImport({ file, hint = "", lang = "es", onCancel, onCreate }) {
  const L = tr(lang);
  const [img, setImg] = useState(null);          // { url, data: ImageData, w, h }
  const [quad, setQuad] = useState(null);
  const [dims, setDims] = useState({ width: "", height: "", depth: "" });
  const [touched, setTouched] = useState({});
  const [material, setMaterial] = useState(null);
  const [error, setError] = useState("");
  const svgRef = useRef(null);
  const dragK = useRef(-1);

  /* cargar la foto, reducida, y leer sus píxeles */
  useEffect(() => {
    let url = null, alive = true;
    (async () => {
      try {
        const bmp = await createImageBitmap(file);
        const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
        const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(bmp, 0, 0, w, h);
        const data = g.getImageData(0, 0, w, h);
        url = URL.createObjectURL(file);
        if (!alive) return;
        setImg({ url, data, w, h });
        setQuad(guessQuad(data));
      } catch {
        if (alive) setError(L.photoError);
      }
    })();
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [file]);  // eslint-disable-line react-hooks/exhaustive-deps

  /* medidas: la que diga el mensaje, o una estimación por la forma */
  const aspect = quad ? quadAspect(quad) : 1;
  const hintW = useMemo(() => {
    const two = String(hint).replace(/,/g, ".").match(/(\d+(?:\.\d+)?)\s*(?:x|×|por)\s*(\d+(?:\.\d+)?)/);
    return two ? [lenOf(two[1]), lenOf(two[2])] : [lenOf(hint), null];
  }, [hint]);
  const width = touched.width ? lenOf(dims.width) : hintW[0] || (aspect > 1.15 ? 1200 : 1800);
  const height = touched.height ? lenOf(dims.height) : hintW[1] || clamp(Math.round((width * aspect) / 10) * 10, 400, 2600);
  const depth = touched.depth ? lenOf(dims.depth) : null;

  /* detección: se recalcula al mover una esquina o cambiar una medida */
  const result = useMemo(() => {
    if (!img || !quad || !width || !height) return null;
    try {
      const r = rectify(img.data, quad, 480);
      const det = detectStructure(r);
      const params = toParams(det, { width, height, depth: depth || undefined, material: material || undefined });
      return { det, params, sum: summarize(params) };
    } catch {
      return null;
    }
  }, [img, quad, width, height, depth, material]);

  /* líneas detectadas, llevadas de vuelta a la foto */
  const overlay = useMemo(() => {
    if (!result || !quad) return null;
    const map = homography(quad);
    const line = (u0, v0, u1, v1) => [map(u0, v0), map(u1, v1)];
    const lines = [], labels = [];
    result.det.cols.forEach((c, i) => {
      if (i > 0) lines.push({ k: "v", p: line(c.x0, 0, c.x0, 1) });
      c.cells.forEach((cell, j) => {
        if (j > 0) lines.push({ k: "h", p: line(c.x0, cell.y0, c.x1, cell.y0) });
        labels.push({ p: map((c.x0 + c.x1) / 2, (cell.y0 + cell.y1) / 2), kind: cell.kind });
      });
    });
    return { lines, labels };
  }, [result, quad]);

  const toSvg = (e) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const q = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [clamp(q.x, 0, img.w), clamp(q.y, 0, img.h)];
  };
  const onMove = (e) => {
    if (dragK.current < 0) return;
    const p = toSvg(e);
    setQuad((q) => q.map((c, k) => (k === dragK.current ? p : c)));
  };

  const s = result?.sum;
  const detMat = result ? result.params.material : null;
  const handleR = img ? Math.max(img.w, img.h) * 0.018 : 10;

  return (
    <div className="veil on photo-veil" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal photo-modal" role="dialog" aria-label={L.fromPhoto}>
        <h3>{L.fromPhoto}</h3>
        <p>{L.photoHelp}</p>
        {error && <p className="photo-err">{error}</p>}
        {img && quad && (
          <div className="photo-body">
            <div className="photo-stage">
              <svg ref={svgRef} viewBox={`0 0 ${img.w} ${img.h}`} className="photo-svg"
                   onPointerMove={onMove} onPointerUp={() => { dragK.current = -1; }} onPointerCancel={() => { dragK.current = -1; }}>
                <image href={img.url} x="0" y="0" width={img.w} height={img.h} />
                <polygon points={quad.map((p) => p.join(",")).join(" ")} className="pq" />
                {overlay?.lines.map((l, i) => (
                  <line key={i} x1={l.p[0][0]} y1={l.p[0][1]} x2={l.p[1][0]} y2={l.p[1][1]} className={"pl " + l.k} />
                ))}
                {overlay?.labels.map((b, i) => (
                  <text key={i} x={b.p[0]} y={b.p[1]} className={"plab " + b.kind} fontSize={handleR * 1.4}>
                    {b.kind === "open" ? "·" : "▭"}
                  </text>
                ))}
                {quad.map((p, k) => (
                  <circle key={k} cx={p[0]} cy={p[1]} r={handleR} className="ph"
                          onPointerDown={(e) => { dragK.current = k; e.currentTarget.ownerSVGElement.setPointerCapture(e.pointerId); }} />
                ))}
              </svg>
            </div>
            <div className="photo-side">
              <div className="photo-sum">
                {s ? L.photoFound(s) : L.photoNothing}
              </div>
              <div className="photo-fields">
                {[["width", L.width, width], ["height", L.heightL, height], ["depth", L.depth, depth ?? result?.params.depth]].map(([k, label, v]) => (
                  <label key={k} className="pf">
                    <span>{label}</span>
                    <input className="numin mono" inputMode="decimal" value={touched[k] ? dims[k] : v ?? ""}
                           onChange={(e) => { setTouched((t) => ({ ...t, [k]: true })); setDims((d) => ({ ...d, [k]: e.target.value })); }} />
                    <em>mm</em>
                  </label>
                ))}
                <label className="pf">
                  <span>{L.photoFinish}</span>
                  <select className="sel" value={material || detMat || "roble"} onChange={(e) => setMaterial(e.target.value)}>
                    {MATKEYS.map((m) => <option key={m} value={m}>{matShort(m, lang)}{!material && m === detMat ? ` · ${L.photoAuto}` : ""}</option>)}
                  </select>
                </label>
              </div>
              <p className="catalog-note">{L.photoTip}</p>
              <div className="photo-actions">
                <button className="ghost" onClick={onCancel}>{L.cancel}</button>
                <button className="cta" disabled={!result} onClick={() => result && onCreate(result.params, s)}>{L.photoCreate}</button>
              </div>
            </div>
          </div>
        )}
        {!img && !error && <p>{L.photoLoading}</p>}
      </div>
    </div>
  );
}
