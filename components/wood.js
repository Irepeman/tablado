/* ============================================================
   MADERA PROCEDURAL
   Cada especie se genera como un TABLERO REAL de 2800 × 2070 mm, a
   ~1,4 mm por píxel, y cada pieza del mueble toma su propia región de
   ese tablero, a escala física. Así:
     · la veta tiene el tamaño real en cualquier pieza, sea un lateral
       de 2 m o un frente de cajón de 40 cm;
     · la veta sigue el lado largo de la pieza, como en un corte real;
     · dos piezas nunca muestran el mismo trozo de veta.

   El modelo de la veta es el de un corte plano de tronco: anillos de
   crecimiento (madera temprana clara → tardía oscura, con frontera
   brusca), deformados por ruido de baja frecuencia, que es lo que
   dibuja las "catedrales". Encima, poros alargados en la dirección de
   la fibra y variación de tono de la pieza.
   ============================================================ */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

export const SHEET_MM = { L: 2800, W: 2070 };

/* early/late: madera temprana y tardía (RGB sRGB). rings: anillos por mm.
   warp/wobble: amplitud en mm de la deformación lenta y media de la veta.
   pores: presencia de poro (el roble es de poro abierto, el abedul casi no). */
const SPECIES = {
  roble: {
    early: [220, 188, 140], late: [150, 107, 62], pore: [150, 110, 66],
    rings: 1 / 5, warp: 26, wobble: 7, pores: 0.32, contrast: 0.9,
    latePow: 1.7, tone: 0.09, flame: 0,
  },
  nogal: {
    early: [128, 90, 64], late: [60, 39, 27], pore: [42, 28, 20],
    rings: 1 / 5.6, warp: 34, wobble: 10, pores: 0.34, contrast: 0.68,
    latePow: 2.2, tone: 0.15, flame: 0, cool: [96, 74, 70],
  },
  abedul: {
    early: [236, 212, 168], late: [204, 167, 114], pore: [188, 154, 106],
    rings: 1 / 7.5, warp: 18, wobble: 5, pores: 0.07, contrast: 0.44,
    tone: 0.06, flame: 0.05,
  },
};
export const isWood = (key) => !!SPECIES[key];

/* ---------- ruido de valor 2D, determinista por semilla ---------- */
function makeNoise(seed) {
  let s = (seed >>> 0) || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const P = new Uint16Array(512);
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
  const V = new Float32Array(256);
  for (let i = 0; i < 256; i++) V[i] = rnd() * 2 - 1;
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const a = V[P[P[X] + Y]], b = V[P[P[X + 1] + Y]];
    const c = V[P[P[X] + Y + 1]], d = V[P[P[X + 1] + Y + 1]];
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const top = a + (b - a) * u, bot = c + (d - c) * u;
    return top + (bot - top) * v;
  };
}
function fbm(noise, x, y, oct) {
  let s = 0, a = 0.5, f = 1;
  for (let o = 0; o < oct; o++) { s += a * noise(x * f, y * f); f *= 2.03; a *= 0.5; }
  return s;
}
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* Genera color (sRGB) y altura (para relieve) de un rectángulo de
   mmL × mmW milímetros a W × H píxeles. La fibra corre a lo largo de X. */
function generate(key, W, H, mmL, mmW, seed) {
  const S = SPECIES[key];
  const nWarp = makeNoise(seed), nMid = makeNoise(seed * 31 + 5);
  const nTone = makeNoise(seed * 97 + 11), nPore = makeNoise(seed * 7 + 3);
  const nFine = makeNoise(seed * 13 + 17), nRing = makeNoise(seed * 53 + 29);
  const nFlame = makeNoise(seed * 19 + 7);
  const col = new Uint8Array(W * H * 4);
  const hgt = new Uint8Array(W * H * 4);
  const sx = mmL / W, sy = mmW / H;

  /* Lo lento se calcula en una rejilla gruesa y se interpola: es invisible
     a simple vista y divide el coste por ~50. */
  const G = 8, gw = Math.ceil(W / G) + 2, gh = Math.ceil(H / G) + 2;
  const warpF = new Float32Array(gw * gh), toneF = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const x = i * G * sx, y = j * G * sy;
      warpF[j * gw + i] =
        fbm(nWarp, x * 0.0011, y * 0.0034, 4) * S.warp +
        fbm(nMid, x * 0.0046, y * 0.013, 3) * S.wobble;
      toneF[j * gw + i] = fbm(nTone, x * 0.0007, y * 0.0019, 3);
    }
  }

  const [er, eg, eb] = S.early, [lr, lg, lb] = S.late, [pr, pg, pb] = S.pore;
  for (let py = 0; py < H; py++) {
    const y = py * sy;
    const gj = py / G, j0 = gj | 0, fj = gj - j0;
    for (let px = 0; px < W; px++) {
      const x = px * sx;
      const gi = px / G, i0 = gi | 0, fi = gi - i0;
      const k = j0 * gw + i0;
      const w0 = warpF[k] + (warpF[k + 1] - warpF[k]) * fi;
      const w1 = warpF[k + gw] + (warpF[k + gw + 1] - warpF[k + gw]) * fi;
      const warp = w0 + (w1 - w0) * fj;
      const t0 = toneF[k] + (toneF[k + 1] - toneF[k]) * fi;
      const t1 = toneF[k + gw] + (toneF[k + gw + 1] - toneF[k + gw]) * fi;
      const tone = t0 + (t1 - t0) * fj;

      /* anillo de crecimiento: temprana → tardía con frontera brusca,
         y cada anillo con su propia intensidad */
      const r = (y + warp) * S.rings;
      const ring = Math.floor(r);
      const phase = r - ring;
      const strength = 0.55 + 0.45 * (nRing(ring * 0.37, 1.7) * 0.5 + 0.5);
      const late = Math.pow(phase, S.latePow || 2.6) * strength;

      /* poro alargado en la fibra; más en la madera temprana */
      const pn = nPore(x * 0.1, y * 0.5);
      const pore = smooth(0.34, 0.78, pn) * S.pores * (0.45 + 0.55 * (1 - late));
      const fine = nFine(x * 0.017, y * 0.26) * 0.5 + 0.5;

      let d = late * S.contrast + fine * 0.07;
      if (d > 1) d = 1;
      let R = er + (lr - er) * d, Gc = eg + (lg - eg) * d, B = eb + (lb - eb) * d;
      R += (pr - R) * pore; Gc += (pg - Gc) * pore; B += (pb - B) * pore;

      let m = 1 + tone * S.tone * 2;
      if (S.flame) m *= 1 + S.flame * fbm(nFlame, x * 0.028 + warp * 0.02, y * 0.004, 2) * 2;
      R *= m; Gc *= m; B *= m;
      if (S.cool && tone > 0) {                // el nogal vira a gris violáceo por zonas
        const c = Math.min(1, tone * 1.6) * 0.35;
        R += (S.cool[0] - R) * c; Gc += (S.cool[1] - Gc) * c; B += (S.cool[2] - B) * c;
      }

      const o = (py * W + px) * 4;
      col[o] = R > 255 ? 255 : R < 0 ? 0 : R;
      col[o + 1] = Gc > 255 ? 255 : Gc < 0 ? 0 : Gc;
      col[o + 2] = B > 255 ? 255 : B < 0 ? 0 : B;
      col[o + 3] = 255;
      const h = 255 * (1 - (late * 0.45 + pore * 0.9));
      hgt[o] = hgt[o + 1] = hgt[o + 2] = h < 0 ? 0 : h;
      hgt[o + 3] = 255;
    }
  }
  return { col, hgt };
}

function dataTex(data, W, H, renderer, { srgb, repeatS = false }) {
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = repeatS ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();   // clave en ángulos rasantes
  t.needsUpdate = true;
  return t;
}

const seedFor = (key) => ({ roble: 11, nogal: 23, abedul: 37 }[key] || 5);
const sheetCache = new Map();

/** Tablero completo de una especie: color + relieve. Se genera una vez. */
export function woodSheet(key, renderer) {
  if (sheetCache.has(key)) return sheetCache.get(key);
  const W = 2048, H = Math.round((2048 * SHEET_MM.W) / SHEET_MM.L);
  const t0 = performance.now();
  const { col, hgt } = generate(key, W, H, SHEET_MM.L, SHEET_MM.W, seedFor(key));
  const out = {
    map: dataTex(col, W, H, renderer, { srgb: true }),
    bump: dataTex(hgt, W, H, renderer, { srgb: false }),
  };
  sheetCache.set(key, out);
  if (process.env.NODE_ENV !== "production") {
    console.info(`[madera] ${key}: ${W}×${H} en ${Math.round(performance.now() - t0)} ms`);
  }
  return out;
}

/* Canto de contrachapado: las chapas cruzadas y las líneas de cola son
   lo que hace reconocible el abedul a primera vista. ~1,4 mm por chapa. */
const plyCache = new Map();
export function plyEdge(t, renderer) {
  if (plyCache.has(t)) return plyCache.get(t);
  const plies = t <= 16 ? 11 : t >= 22 ? 15 : 13;
  const W = 512, H = 128;
  const data = new Uint8Array(W * H * 4);
  const n = makeNoise(71), n2 = makeNoise(89);
  for (let py = 0; py < H; py++) {
    const v = (py + 0.5) / H * plies;
    const idx = Math.floor(v), within = v - idx;
    const faceVeneer = idx === 0 || idx === plies - 1;
    const base = faceVeneer ? [238, 219, 184] : idx % 2 ? [214, 187, 144] : [228, 204, 164];
    const glue = Math.max(smooth(0.1, 0, within), smooth(0.9, 1, within));
    for (let px = 0; px < W; px++) {
      const x = (px / W) * 400;   // 400 mm de canto por repetición
      const m = 1 + n(x * 0.021, idx * 3.7) * 0.07 + n2(x * 0.14, v * 9) * 0.035;
      const o = (py * W + px) * 4;
      for (let c = 0; c < 3; c++) {
        const glueC = [150, 118, 78][c];
        const val = (base[c] + (glueC - base[c]) * glue * 0.85) * m;
        data[o + c] = val > 255 ? 255 : val;
      }
      data[o + 3] = 255;
    }
  }
  const tex = dataTex(data, W, H, renderer, { srgb: true, repeatS: true });
  plyCache.set(t, tex);
  return tex;
}

/** Muestra pequeña para las fichas de material: la misma madera que el 3D. */
export function woodSwatchURL(key) {
  if (!SPECIES[key] || typeof document === "undefined") return null;
  const W = 180, H = 64;
  const { col } = generate(key, W, H, 520, 185, seedFor(key) + 3);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(col.buffer), W, H), 0, 0);
  return c.toDataURL("image/jpeg", 0.88);
}

/* ------------------------------------------------------------
   Geometría de panel con UV en milímetros reales.
   · Cara vista: la fibra sigue el lado largo; la pieza toma su propia
     región del tablero, elegida de forma estable a partir de su id.
   · Cantos: chapas del contrachapado, o la misma chapa de madera
     (canto chapado) en roble y nogal.
   Grupo de material 0 = cara, 1 = canto.
   ------------------------------------------------------------ */
function hash2(str) {
  let h1 = 2166136261, h2 = 5381;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = (Math.imul(h2, 33) ^ c) >>> 0;
  }
  return [((h1 >>> 0) % 10007) / 10007, (h2 % 10009) / 10009];
}

export function panelGeometry(sizeMm, id, plyEdges) {
  const dims = sizeMm;
  const minD = Math.min(...dims);
  /* Canto suavizado de ~1,2 mm: un tablero real nunca tiene la arista viva,
     y ese filo de luz en cada canto es lo que distingue una foto de un render.
     Por debajo de 6 mm (la trasera) no se nota: caja simple. */
  const g = minD >= 6
    ? new RoundedBoxGeometry(dims[0] / 1000, dims[1] / 1000, dims[2] / 1000, 2, Math.min(1.2, minD * 0.3) / 1000)
    : new THREE.BoxGeometry(dims[0] / 1000, dims[1] / 1000, dims[2] / 1000);

  const thin = dims.indexOf(minD);
  let long = dims.indexOf(Math.max(...dims));
  if (long === thin) long = (thin + 1) % 3;
  const mid = 3 - thin - long;

  const [h1, h2] = hash2(String(id));
  const offU = h1 * Math.max(0, SHEET_MM.L - dims[long]);
  const offV = h2 * Math.max(0, SHEET_MM.W - dims[mid]);

  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const idx = g.index;
  const vert = (i) => (idx ? idx.getX(i) : i);
  const total = idx ? idx.count : pos.count;
  const groups = g.groups.length ? g.groups.map((x) => ({ ...x })) : [{ start: 0, count: total }];

  /* El lado de la caja se decide por grupo (media de normales), no por
     vértice: así la franja redondeada del canto no mezcla dos mapeos. */
  const sideAxis = (start, count) => {
    let ax = 0, ay = 0, az = 0;
    for (let i = start; i < start + count; i++) {
      const v = vert(i);
      ax += Math.abs(nor.getX(v)); ay += Math.abs(nor.getY(v)); az += Math.abs(nor.getZ(v));
    }
    return ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
  };

  g.clearGroups();
  for (const gr of groups) {
    const na = sideAxis(gr.start, gr.count);
    for (let i = gr.start; i < gr.start + gr.count; i++) {
      const v = vert(i);
      const pnt = [
        pos.getX(v) * 1000 + dims[0] / 2,
        pos.getY(v) * 1000 + dims[1] / 2,
        pos.getZ(v) * 1000 + dims[2] / 2,
      ];
      let u, w;
      if (na === thin) {
        u = (pnt[long] + offU) / SHEET_MM.L;
        w = (pnt[mid] + offV) / SHEET_MM.W;
      } else {
        const e = na === long ? mid : long;
        if (plyEdges) { u = pnt[e] / 400; w = Math.min(1, Math.max(0, pnt[thin] / dims[thin])); }
        else { u = (pnt[e] + offU) / SHEET_MM.L; w = (pnt[thin] + offV) / SHEET_MM.W; }
      }
      uv.setXY(v, u, w);
    }
    g.addGroup(gr.start, gr.count, na === thin ? 0 : 1);
  }
  uv.needsUpdate = true;
  return g;
}
