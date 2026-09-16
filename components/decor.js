/* ============================================================
   DECORACIÓN PARA EL MODO FOTO
   Lo que convierte un render en una foto de catálogo: la habitación
   (tarima y pared con rodapié) y objetos de verdad en el mueble —
   libros, cajas, jarrones, plantas, una tele sobre el mueble de TV y
   ropa en la barra del armario. Todo sale del diseño actual: solo se
   decoran los huecos abiertos y la colocación depende de cada hueco,
   así que no cambia de un fotograma a otro.
   Nada de esto entra en el despiece ni en el precio.
   ============================================================ */
import * as THREE from "three";
import { cellBounds, isRail, isDoor, BACK_T } from "@/lib/model";

const MM = 0.001;
const mats = new Map();
const mat = (hex, rough = 0.8, metal = 0) => {
  const k = `${hex}_${rough}_${metal}`;
  if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal }));
  return mats.get(k);
};
const BOX = new THREE.BoxGeometry(1, 1, 1);
const SCREEN = new THREE.MeshPhysicalMaterial({ color: 0x050607, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 });

/* aleatorio con semilla: el mismo hueco siempre se decora igual */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BOOKS = [0x6b4f3a, 0x2f4858, 0xa3472f, 0xd9c9a3, 0x39594a, 0x8c8c88, 0xe8e2d4, 0x1f2a36, 0xb5896b, 0x7a2e2e, 0xc7b59a, 0x4a5a6a];
const CLOTHES = [0xe9e5dc, 0x2f3b4c, 0x8a9a8c, 0xc4a484, 0x1e1e1e, 0xb24a3b, 0x6d7f99, 0xdcd3c2];

function block(w, h, d, color, rough = 0.8) {
  const m = new THREE.Mesh(BOX, mat(color, rough));
  m.scale.set(w * MM, h * MM, d * MM);
  m.position.y = (h / 2) * MM;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/* fila de libros de pie, a veces con uno inclinado al final; origen: abajo a la izquierda */
function bookRow(width, maxH, depth, r) {
  const g = new THREE.Group();
  let x = 0;
  const baseH = Math.min(maxH, 180 + r() * 110);
  while (x < width - 30) {
    const t = 22 + r() * 24, h = baseH * (0.78 + r() * 0.22), d = Math.min(depth, 150 + r() * 60);
    if (x + t > width) break;
    const b = block(t, h, d, BOOKS[Math.floor(r() * BOOKS.length)], 0.75);
    b.position.set((x + t / 2) * MM, (h / 2) * MM, 0);
    g.add(b);
    x += t + 0.5;
  }
  if (r() < 0.5 && x > 120) {
    /* el último, apoyado en la fila */
    const t = 26, h = baseH * 0.9, d = Math.min(depth, 170);
    const b = block(t, h, d, BOOKS[Math.floor(r() * BOOKS.length)], 0.75);
    const ang = 0.22;
    b.rotation.z = -ang;
    b.position.set((x + Math.sin(ang) * h / 2 + t / 2) * MM, (Math.cos(ang) * h / 2 + 6) * MM, 0);
    g.add(b);
    x += Math.sin(ang) * h + t;
  }
  g.userData.width = x;
  return g;
}

/* pila de libros tumbados; origen: abajo en el centro */
function bookStack(maxH, r) {
  const g = new THREE.Group();
  let y = 0;
  const n = 3 + Math.floor(r() * 4);
  for (let k = 0; k < n; k++) {
    const t = 22 + r() * 18;
    if (y + t > maxH) break;
    const b = block(200 + r() * 50, t, 150 + r() * 40, BOOKS[Math.floor(r() * BOOKS.length)], 0.75);
    b.position.set((r() - 0.5) * 12 * MM, (y + t / 2) * MM, (r() - 0.5) * 10 * MM);
    b.rotation.y = (r() - 0.5) * 0.12;
    g.add(b);
    y += t;
  }
  return g;
}

/* jarrón de cerámica, a veces con ramas secas */
function vase(h, r) {
  const g = new THREE.Group();
  const rad = h * (0.22 + r() * 0.1);
  const pts = [
    [0, 0], [rad * 0.75, 0], [rad, h * 0.25], [rad * 0.95, h * 0.55], [rad * 0.45, h * 0.85], [rad * 0.35, h], [rad * 0.3, h],
  ].map(([x, y]) => new THREE.Vector2(x * MM, y * MM));
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 36), mat([0xefebe3, 0xc9a27e, 0x7b8a7a, 0x2c2c2a][Math.floor(r() * 4)], 0.45));
  body.castShadow = true;
  g.add(body);
  if (r() < 0.7) {
    for (let k = 0; k < 3; k++) {
      const len = h * (0.9 + r() * 0.8);
      const s = new THREE.Mesh(new THREE.CylinderGeometry(1.2 * MM, 2 * MM, len * MM, 6), mat(0x5b4633, 0.9));
      s.position.set(0, (h + len / 2 - 10) * MM, 0);
      s.rotation.z = (r() - 0.5) * 0.7;
      s.rotation.x = (r() - 0.5) * 0.5;
      s.castShadow = true;
      g.add(s);
    }
  }
  return g;
}

/* planta en maceta: sansevieria, hojas altas y estrechas que salen del centro */
const BLADE = (() => {
  /* hoja: base ancha que se afila hacia la punta, algo curvada */
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0);
  shape.bezierCurveTo(-0.55, 0.35, -0.3, 0.8, 0, 1);
  shape.bezierCurveTo(0.3, 0.8, 0.55, 0.35, 0.5, 0);
  shape.closePath();
  return new THREE.ShapeGeometry(shape, 10);
})();
function plant(h, r) {
  const g = new THREE.Group();
  const potH = h * 0.3, potR = h * 0.16;
  const pot = new THREE.Mesh(new THREE.LatheGeometry(
    [[0, 0], [potR * 0.78, 0], [potR, potH], [potR * 1.06, potH], [potR * 1.06, potH * 1.04], [potR * 0.9, potH * 1.04]]
      .map(([x, y]) => new THREE.Vector2(x * MM, y * MM)), 32),
    mat([0xb86b4b, 0xe9e4da, 0x3b3b39][Math.floor(r() * 3)], 0.7));
  pot.castShadow = true;
  g.add(pot);
  const soil = new THREE.Mesh(new THREE.CircleGeometry(potR * 0.92 * MM, 24), mat(0x3a2c22, 1));
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = potH * 0.97 * MM;
  g.add(soil);
  const greens = [0x2f5a35, 0x3d6b3b, 0x4a7a44, 0x355f3f];
  const n = 15 + Math.floor(r() * 6);
  for (let k = 0; k < n; k++) {
    const len = (h - potH) * (0.6 + r() * 0.45), wid = len * (0.17 + r() * 0.07);
    const leafMat = new THREE.MeshStandardMaterial({ color: greens[Math.floor(r() * greens.length)], roughness: 0.55, side: THREE.DoubleSide });
    const blade = new THREE.Mesh(BLADE, leafMat);
    blade.scale.set(wid * MM, len * MM, 1);
    const a = (k / n) * Math.PI * 2 + r() * 0.5;
    const rr = potR * 0.55 * r();
    blade.position.set(Math.cos(a) * rr * MM, potH * 0.95 * MM, Math.sin(a) * rr * MM);
    blade.rotation.set(0, a + Math.PI / 2 + (r() - 0.5) * 0.8, 0);
    blade.rotateX((0.12 + r() * 0.38) * (r() < 0.5 ? 1 : -1));
    blade.castShadow = true;
    g.add(blade);
  }
  return g;
}

/* caja de almacenaje de tela */
function storageBox(w, h, d, r) {
  const g = new THREE.Group();
  const c = [0xcfc6b6, 0x8f8a80, 0x3d4a52, 0xb9a88f][Math.floor(r() * 4)];
  g.add(block(w, h, d, c, 0.95));
  const hole = block(w * 0.28, 18, 2, 0x2a2724, 1);
  hole.position.set(0, (h * 0.78) * MM, (d / 2 + 1) * MM);
  g.add(hole);
  return g;
}

/* tele de pie sobre el mueble */
function tv(width) {
  const g = new THREE.Group();
  const h = width * 0.575, foot = 60;
  const stand = block(width * 0.3, 12, 200, 0x1c1c1c, 0.5);
  g.add(stand);
  const neck = block(40, foot, 30, 0x1c1c1c, 0.5);
  neck.position.set(0, (12 + foot / 2) * MM, -40 * MM);
  g.add(neck);
  const body = block(width, h, 28, 0x121212, 0.45);
  body.position.set(0, (12 + foot + h / 2) * MM, -40 * MM);
  g.add(body);
  const screen = new THREE.Mesh(BOX, SCREEN);
  screen.scale.set((width - 16) * MM, (h - 16) * MM, 1 * MM);
  screen.position.set(0, (12 + foot + h / 2) * MM, (-40 + 14.5) * MM);
  g.add(screen);
  return g;
}

/* ropa colgada de la barra: gancho sobre la barra, percha y prenda debajo.
   rail = altura de la barra desde el suelo del hueco */
function clothes(width, rail, depth, r) {
  const g = new THREE.Group();
  const hookGeo = new THREE.TorusGeometry(16 * MM, 2 * MM, 6, 16, Math.PI);
  let x = 45;
  while (x < width - 45) {
    const t = 28 + r() * 34, h = Math.min(rail - 120, 600 + r() * 380), w = depth * (0.7 + r() * 0.1);
    const hook = new THREE.Mesh(hookGeo, mat(0xb9b9b4, 0.35, 1));
    hook.rotation.y = Math.PI / 2;
    hook.position.set(x * MM, (rail + 2) * MM, 0);
    g.add(hook);
    const bar = block(9, 9, w * 0.92, 0x8a6a48, 0.6);
    bar.position.set(x * MM, (rail - 40) * MM, 0);
    g.add(bar);
    const piece = block(t, h, w, CLOTHES[Math.floor(r() * CLOTHES.length)], 0.95);
    piece.position.set(x * MM, (rail - 46 - h / 2) * MM, 0);
    piece.rotation.y = (r() - 0.5) * 0.12;
    g.add(piece);
    x += t + 8 + r() * 26;
  }
  return g;
}

/* ------------------------------------------------------------
   Coloca la decoración en el grupo (dentro de la raíz del mueble)
   ------------------------------------------------------------ */
export function buildDecor(group, p, geo) {
  clearDecor(group);
  if (!geo) return;
  const t = p.thickness, D = p.depth;
  const zFront = D / 2 - 12, zBack = -D / 2 + (p.back ? BACK_T : 0) + 10;
  const usableD = zFront - zBack;
  const tall = p.height > 1300;
  let xx = geo.x0;
  p.columns.forEach((c, i) => {
    const bnd = cellBounds(p, c), last = c.cells.length - 1;
    c.cells.forEach((type, j) => {
      const lo = bnd[j] + (j > 0 ? t / 2 : 0), hi = bnd[j + 1] - (j < last ? t / 2 : 0);
      const h = hi - lo, w = c.width, y = geo.y0 + lo;
      const r = rng(i * 7919 + j * 104729 + Math.round(w) * 31 + Math.round(h));
      const zOf = (d) => (zFront - 20 - d / 2) * MM;
      if (isRail(type)) {
        const cl = clothes(w, hi - lo - 60, usableD, r);   // la barra va a 60 mm del techo del hueco
        cl.position.set(xx * MM, y * MM, ((zFront + zBack) / 2) * MM);
        group.add(cl);
        return;
      }
      /* detrás de las puertas de un armario: ropa doblada, se ve con «Abrir» */
      if (isDoor(type) && D >= 500 && h >= 150 && w >= 300) {
        const stacks = w >= 650 ? 2 : 1;
        for (let k = 0; k < stacks; k++) {
          let yy = 0;
          const pile = new THREE.Group();
          while (yy < Math.min(h - 40, 320)) {
            const th = 24 + r() * 22;
            const f = block(270 + r() * 30, th, 250 + r() * 30, CLOTHES[Math.floor(r() * CLOTHES.length)], 0.95);
            f.position.set((r() - 0.5) * 10 * MM, (yy + th / 2) * MM, (r() - 0.5) * 10 * MM);
            pile.add(f);
            yy += th;
          }
          pile.position.set((xx + (w / (stacks + 1)) * (k + 1)) * MM, y * MM, zOf(280));
          group.add(pile);
        }
        return;
      }
      if (type !== "open" || h < 150 || w < 160) return;
      const pick = r();
      if (pick < (tall ? 0.5 : 0.35)) {
        if (h < 210) {
          const s = bookStack(h - 15, r);
          s.position.set((xx + w / 2) * MM, y * MM, zOf(180));
          group.add(s);
        } else {
          const fill = w * (0.45 + r() * 0.4);
          const row = bookRow(fill, h - 25, usableD - 30, r);
          const fromLeft = r() < 0.5;
          row.position.set((fromLeft ? xx + 8 : xx + w - 8 - row.userData.width) * MM, y * MM, zOf(Math.min(usableD - 30, 200)));
          group.add(row);
          const rest = w - row.userData.width - 30;
          if (rest > 150 && h > 220 && r() < 0.55) {
            const v = vase(Math.min(h - 40, 150 + r() * 80), r);
            v.position.set((fromLeft ? xx + w - rest / 2 : xx + rest / 2) * MM, y * MM, zOf(120));
            group.add(v);
          }
        }
      } else if (pick < (tall ? 0.66 : 0.6) && h >= 180) {
        const bw = Math.min(w - 40, 330), bh = Math.min(h - 30, 260), bd = Math.min(usableD - 20, 320);
        const b = storageBox(bw, bh, bd, r);
        b.position.set((xx + w / 2) * MM, y * MM, zOf(bd));
        group.add(b);
      } else if (pick < 0.8 && h >= 220) {
        const o = r() < 0.5 ? vase(Math.min(h - 50, 160 + r() * 90), r) : plant(Math.min(h - 30, 280 + r() * 90), r);
        o.position.set((xx + w * (0.3 + r() * 0.4)) * MM, y * MM, zOf(140));
        group.add(o);
      }
    });
    xx += c.width + t;
  });

  /* encima del mueble, si es bajo: tele en el mueble de TV; si no, jarrón, libros y un cuadro */
  if (p.height <= 1300) {
    const top = p.height, r = rng(Math.round(p.width) * 13 + Math.round(p.height));
    const onTop = (obj, x, z = 0) => { obj.position.set(x * MM, top * MM, z * MM); group.add(obj); };
    if (p.height <= 650 && p.width >= 1300) {
      onTop(tv(Math.min(1450, p.width * 0.72)), 0);
      if (p.width >= 1600) onTop(plant(300 + r() * 120, r), p.width / 2 - 140, 20);
    } else if (p.width >= 600) {
      onTop(vase(260 + r() * 120, r), -p.width / 2 + 170, 0);
      onTop(bookStack(120, r), -p.width / 2 + 420, 10);
      if (p.width >= 1000) {
        const frame = new THREE.Group();
        frame.add(block(420, 540, 22, 0x2a2622, 0.6));
        const art = block(360, 470, 2, [0xd8cdb8, 0x9aa8a0, 0xc9a58a][Math.floor(r() * 3)], 0.9);
        art.position.set(0, 35 * MM, 12 * MM);
        frame.add(art);
        frame.rotation.x = -0.12;
        onTop(frame, p.width / 2 - 320, -D / 2 + 60);
      }
    }
  }
}

export function clearDecor(group) {
  for (const o of [...group.children]) {
    group.remove(o);
    o.traverse((m) => { if (!m.isMesh) return;
      if (m.geometry !== BOX && m.geometry !== BLADE) m.geometry.dispose();
      if (m.material.side === THREE.DoubleSide) m.material.dispose(); });
  }
}

/* tarima de roble claro, dibujada: 2 × 2 m por repetición */
let floorTex = null;
export function floorTexture(renderer) {
  if (floorTex) return floorTex;
  const S = 1024, c = document.createElement("canvas");
  c.width = S; c.height = S;
  const g = c.getContext("2d");
  const r = rng(20260916);
  const plankW = S / 11;                           // ~180 mm
  for (let row = 0; row < 11; row++) {
    let x = -r() * S * 0.5;
    while (x < S) {
      const len = S * (0.42 + r() * 0.45);
      const tone = 172 + r() * 26;
      g.fillStyle = `rgb(${tone}, ${tone * 0.84}, ${tone * 0.68})`;
      g.fillRect(x, row * plankW, len, plankW);
      /* veta: líneas finas a lo largo de la tabla */
      for (let k = 0; k < 26; k++) {
        const yy = row * plankW + r() * plankW;
        g.strokeStyle = `rgba(96, 64, 36, ${0.05 + r() * 0.1})`;
        g.lineWidth = 0.6 + r() * 1.4;
        g.beginPath();
        g.moveTo(x, yy);
        g.bezierCurveTo(x + len * 0.3, yy + (r() - 0.5) * 6, x + len * 0.7, yy + (r() - 0.5) * 6, x + len, yy + (r() - 0.5) * 4);
        g.stroke();
      }
      g.fillStyle = "rgba(60, 40, 22, 0.55)";
      g.fillRect(x, row * plankW, 1.5, plankW);     // junta entre tablas
      x += len;
    }
    g.fillStyle = "rgba(60, 40, 22, 0.5)";
    g.fillRect(0, row * plankW, S, 1.5);
  }
  floorTex = new THREE.CanvasTexture(c);
  floorTex.colorSpace = THREE.SRGBColorSpace;
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(15, 15);                     // plano de 30 m
  floorTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return floorTex;
}
