"use client";
/* ============================================================
   VISOR 3D
   Órbita amortiguada, zoom hacia el punto bajo el cursor, paneo en
   espacio de pantalla y pinza en táctil — el estándar de los
   configuradores de producto, no la órbita cruda por defecto.

   La edición directa (arrastrar baldas y divisores) escribe sobre el
   MISMO objeto de parámetros que el chat. Ratón y lenguaje son dos
   mandos del mismo coche.
   ============================================================ */
import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import * as THREE from "three";
import { MATERIALS, build, clamp, deepCopy, legCount, cellAtHeight } from "@/lib/model";
import { woodSheet, plyEdge, panelGeometry, isWood } from "./wood";
import { buildDecor, clearDecor, floorTexture } from "./decor";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";

/* Modo foto: se suman muchas imágenes del mismo encuadre. En cada una la cámara
   se mueve una fracción de píxel (bordes limpios) y la luz principal se desplaza
   por un disco (sombras suaves, como bajo una ventana grande). Funciona con la
   misma tarjeta gráfica que el visor normal, también en Safari y en móviles:
   el trazador de rutas que había antes salía negro en Macs con chip Apple. */
const PHOTO_FRAMES = 96;
const APERTURE = 0.03;      // m: desenfoque suave del fondo, como una cámara a f/4
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
const QUAD_VS = "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";

const R_MIN = 0.55, R_MAX = 17, EASE_ROT = 0.19, EASE_ZOOM = 0.17;

const Viewport = forwardRef(function Viewport(
  { params, onChange, onCommit, selection, onSelect, exploded, showScale, photo, onPhotoProgress, open, openCols = [], onToggleDoor,
    placing, onPlace, canDropAt, onMoveCell }, ref) {
  const canvasRef = useRef(null);
  const S = useRef(null);              // todo el estado imperativo de three.js
  const propsRef = useRef({});
  propsRef.current = { params, onChange, onCommit, selection, onSelect, exploded, showScale, photo, onPhotoProgress, open,
    openCols, onToggleDoor, placing, onPlace, canDropAt, onMoveCell };

  /* ---------- montaje: escena, luces, entorno, controles ---------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    /* Neutral (Khronos PBR Neutral) en lugar de ACES: ACES aclara y
       desatura los tonos medios y el roble salía color crema. Aquí el
       cliente compra por el color, así que el render tiene que ser fiel
       a la ficha de material. */
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 80);
    const root = new THREE.Group();
    scene.add(root);
    /* Estudio con paneles de luz en lugar de un degradado pintado: son los
       reflejos que un fotógrafo de producto pondría sobre el barniz. */
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environmentIntensity = 0.7;

    const key = new THREE.DirectionalLight(0xfff6e8, 1.25);
    const keyBase = new THREE.Vector3(2.6, 4.2, 3.2);
    key.position.set(2.6, 4.2, 3.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3.4, bottom: -1.4, near: 0.5, far: 14 });
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.02;
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xdfe8f2, 0.34);
    fill.position.set(-4, 2, -2);
    scene.add(fill);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8577, 0.18));

    const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(30, 30),
      new THREE.ShadowMaterial({ opacity: 0.24 }));
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.receiveShadow = true;
    scene.add(shadowPlane);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30),
      new THREE.MeshStandardMaterial({ color: 0xcfcabc, roughness: 0.94 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.002;
    scene.add(floor);

    const wall = new THREE.Mesh(new THREE.PlaneGeometry(30, 14),
      new THREE.MeshStandardMaterial({ color: 0xe3dfd4, roughness: 0.97 }));
    wall.position.set(0, 7, -2.2);
    wall.receiveShadow = true;
    scene.add(wall);

    const floorBase = floor.material;
    const floorPhoto = new THREE.MeshStandardMaterial({ map: null, roughness: 0.52, metalness: 0 });
    const skirting = new THREE.Mesh(new THREE.BoxGeometry(30, 0.08, 0.015),
      new THREE.MeshStandardMaterial({ color: 0xf3f1ec, roughness: 0.6 }));
    skirting.visible = false;
    skirting.receiveShadow = true;
    scene.add(skirting);
    const decor = new THREE.Group();
    root.add(decor);

    /* silueta de 1,70 m: la referencia de escala que usa cualquier catálogo */
    const fig = new THREE.Group();
    fig.visible = false;
    scene.add(fig);
    {
      const c = document.createElement("canvas");
      c.width = 200; c.height = 520;
      const g = c.getContext("2d");
      g.fillStyle = "rgba(46,94,66,.30)";
      g.beginPath(); g.arc(100, 58, 32, 0, 7); g.fill();
      g.beginPath(); g.moveTo(100, 96);
      g.bezierCurveTo(150, 110, 158, 180, 150, 250);
      g.lineTo(140, 330); g.lineTo(132, 500); g.lineTo(108, 500);
      g.lineTo(104, 350); g.lineTo(96, 350); g.lineTo(92, 500);
      g.lineTo(68, 500); g.lineTo(60, 330); g.lineTo(50, 250);
      g.bezierCurveTo(42, 180, 50, 110, 100, 96); g.fill();
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.654, 1.7),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      m.position.y = 0.85;
      fig.add(m);
    }

    /* Oclusión ambiental (GTAO): oscurece esquinas interiores, uniones y el
       contacto con el suelo. En muebles de cajas es el mayor salto de realismo.
       En móviles pesa demasiado y se apaga. */
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const gtao = new GTAOPass(scene, camera, 1, 1);
    gtao.updateGtaoMaterial({ radius: 0.2, distanceExponent: 1.4, thickness: 1.2,
                              distanceFallOff: 1, scale: 1.15, samples: 16 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    gtao.blendIntensity = 0.9;
    gtao.enabled = !(window.matchMedia("(pointer: coarse)").matches ||
                     Math.min(window.innerWidth, window.innerHeight) < 500);
    composer.addPass(gtao);
    composer.addPass(new OutputPass());   // tono Neutral + sRGB, al final de la cadena

    const st = {
      renderer, scene, camera, root, fig, floor, wall, shadowPlane,
      photoOn: false, ph: null, lastReport: 0,
      box: new THREE.BoxGeometry(1, 1, 1),
      meshes: [], geo: null, grain: {}, mats: {},
      metalMat: new THREE.MeshStandardMaterial({ color: 0x2b2b28, roughness: 0.36, metalness: 0.85 }),
      chromeMat: new THREE.MeshStandardMaterial({ color: 0xd9d9d6, roughness: 0.22, metalness: 1 }),
      railSelMat: new THREE.MeshStandardMaterial({ color: 0xc97a3c, roughness: 0.35, metalness: 0.4,
        emissive: new THREE.Color(0x8a3f12), emissiveIntensity: 0.3 }),
      brassMat: new THREE.MeshStandardMaterial({ color: 0xc19a5b, roughness: 0.3, metalness: 1 }),
      aluMat: new THREE.MeshStandardMaterial({ color: 0xbfc2c3, roughness: 0.38, metalness: 1 }),
      recessMat: new THREE.MeshStandardMaterial({ color: 0x151513, roughness: 0.55, metalness: 0.4 }),
      dropOk: new THREE.MeshBasicMaterial({ color: 0x3f8a5e, transparent: true, opacity: 0.38, depthWrite: false }),
      dropBad: new THREE.MeshBasicMaterial({ color: 0xc0412b, transparent: true, opacity: 0.32, depthWrite: false }),
      dropMesh: null, move: null,
      /* zonas de toque de cada hueco: invisibles; la seleccionada, tintada */
      pickMat: new THREE.MeshBasicMaterial({ color: 0x2e5e42, transparent: true, opacity: 0, depthWrite: false }),
      selCellMat: new THREE.MeshBasicMaterial({ color: 0x3f8a5e, transparent: true, opacity: 0.2, depthWrite: false }),
      extra: [], cells: {},
      cam: { theta: -0.52, phi: 1.32, r: 5.2, target: new THREE.Vector3(0, 1, 0),
             tTheta: -0.52, tPhi: 1.32, tR: 5.2, tTarget: new THREE.Vector3(0, 1, 0) },
      ray: new THREE.Raycaster(), ptr: new THREE.Vector2(),
      dragPlane: new THREE.Plane(), hitPt: new THREE.Vector3(),
      drag: null, mode: null, last: { x: 0, y: 0 }, moved: 0,
      pointers: new Map(), pinchDist: 0, pinchMid: { x: 0, y: 0 }, pinchAng: 0,
      spin: null, vel: { t: 0, p: 0 }, lastMoveT: 0,     // inercia al soltar un giro
      wheel: { t: 0, pad: false }, gesture: null,        // trackpad: dos dedos y pellizco
      raf: 0, alive: true,
    };
    S.current = st;
    st.key = key; st.keyBase = keyBase; st.gtao = gtao; st.composer = composer;
    /* montar o desmontar la habitación y la decoración de la foto */
    st.stage = (on) => {
      const p = propsRef.current.params;
      if (on) {
        floorPhoto.map = floorTexture(renderer);
        floor.material = floorPhoto;
        const z = -p.depth / 2000 - 0.016;           // el mueble, apoyado en la pared
        wall.position.z = z;
        wall.material.color.set(0xebe7df);
        skirting.position.set(0, 0.04, z + 0.0075);
        skirting.visible = true;
        shadowPlane.material.opacity = 0.3;
        if (propsRef.current.exploded) clearDecor(decor);
        else buildDecor(decor, p, st.geo);
      } else {
        floor.material = floorBase;
        wall.position.z = -2.2;
        skirting.visible = false;
        shadowPlane.material.opacity = 0.24;
        clearDecor(decor);
        syncTheme();
      }
    };
    /* resaltado del hueco donde se va a soltar una pieza: fuera de st.meshes, no se toca */
    st.dropMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), st.dropOk);
    st.dropMesh.visible = false;
    st.dropMesh.renderOrder = 10;
    root.add(st.dropMesh);

    /* ----- tema: el fondo del visor sigue al de la página ----- */
    const syncTheme = () => {
      if (S.current?.photoOn) return;               // la foto siempre es una habitación clara
      const cs = getComputedStyle(document.documentElement);
      const bg = cs.getPropertyValue("--paper-3").trim() || "#e7e4da";
      const col = new THREE.Color(bg);
      const dark = col.getHSL({}).l < 0.45;
      scene.background = col;
      floor.material.color.set(dark ? 0x24281f : 0xcfcabc);
      wall.material.color.set(dark ? 0x2b3027 : 0xe3dfd4);
      renderer.toneMappingExposure = dark ? 0.8 : 0.95;
    };
    syncTheme();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", syncTheme);
    const themeObs = new MutationObserver(syncTheme);
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    /* ----- cámara ----- */
    const clampTarget = () => {
      const p = propsRef.current.params;
      const w = p.width / 2000 + 0.9, h = p.height / 1000 + 0.6, d = p.depth / 1000 + 1.4;
      st.cam.tTarget.x = clamp(st.cam.tTarget.x, -w, w);
      st.cam.tTarget.y = clamp(st.cam.tTarget.y, -0.15, h);
      st.cam.tTarget.z = clamp(st.cam.tTarget.z, -d, d);
    };
    const writeCam = () => {
      const c = st.cam;
      camera.position.set(
        c.target.x + c.r * Math.sin(c.phi) * Math.sin(c.theta),
        c.target.y + c.r * Math.cos(c.phi),
        c.target.z + c.r * Math.sin(c.phi) * Math.cos(c.theta));
      camera.lookAt(c.target);
    };
    const stepCam = () => {
      const c = st.cam;
      if (st.spin) {
        c.tTheta += st.spin.t; c.tPhi += st.spin.p;
        st.spin.t *= 0.94; st.spin.p *= 0.86;
        if (Math.abs(st.spin.t) < 2e-4 && Math.abs(st.spin.p) < 2e-4) st.spin = null;
      }
      c.tPhi = clamp(c.tPhi, 0.22, 1.6);
      c.tR = clamp(c.tR, R_MIN, R_MAX);
      const dT = c.tTheta - c.theta, dP = c.tPhi - c.phi, dR = c.tR - c.r;
      const dTg = c.tTarget.clone().sub(c.target);
      if (Math.abs(dT) < 1e-4 && Math.abs(dP) < 1e-4 && Math.abs(dR) < 1e-4 && dTg.lengthSq() < 1e-8) {
        c.theta = c.tTheta; c.phi = c.tPhi; c.r = c.tR; c.target.copy(c.tTarget);
      } else {
        c.theta += dT * EASE_ROT; c.phi += dP * EASE_ROT; c.r += dR * EASE_ZOOM;
        c.target.addScaledVector(dTg, EASE_ZOOM);
      }
      writeCam();
    };
    st.stepCam = stepCam;
    st.clampTarget = clampTarget;

    const setPtr = (e) => {
      const r = canvas.getBoundingClientRect();
      st.ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      st.ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      return r;
    };
    /* Antes se cogía cualquier balda o divisor que cruzara el rayo, aunque
       estuviera escondido detrás de una puerta o un cajón: al tocar el frente
       se arrastraba la pieza de detrás. Ahora manda la superficie más cercana.
       Las zonas de hueco son planos invisibles justo detrás del frente: una
       balda o un divisor solo gana si está pegado a ese plano (su canto o los
       primeros centímetros), y si no se toca el hueco. */
    const pickAt = (e) => {
      setPtr(e);
      st.ray.setFromCamera(st.ptr, camera);
      const hits = st.ray.intersectObjects(st.meshes, false);
      if (!hits.length) return null;
      const first = hits[0];
      const solid = hits.find((h) => h.object.userData?.grp !== "hueco");
      /* la barra de colgar es fina y está al fondo: si el rayo la toca, es que se apunta a ella */
      if (solid && solid.object.userData.grp === "barra") return solid;
      if (solid && solid.object.userData.drag && solid.distance - first.distance < 0.07) return solid;
      if (first.object.userData?.grp === "hueco") return first;
      return solid || first;
    };
    /* el punto del mundo bajo el cursor: la pieza si la hay, si no un
       plano encarado a la cámara que pasa por el objetivo */
    const pointUnder = (e) => {
      setPtr(e);
      st.ray.setFromCamera(st.ptr, camera);
      const hits = st.ray.intersectObjects(st.meshes, false);
      if (hits.length) return hits[0].point.clone();
      const n = camera.getWorldDirection(new THREE.Vector3()).negate();
      const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(n, st.cam.tTarget);
      const out = new THREE.Vector3();
      return st.ray.ray.intersectPlane(pl, out) ? out : st.cam.tTarget.clone();
    };
    /* Hueco bajo un punto de la pantalla: el plano del hueco si se toca, y si se
       toca cualquier pieza (un frente, un costado), la columna y la altura del punto. */
    const targetAt = (clientX, clientY) => {
      const r = canvas.getBoundingClientRect();
      if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
      /* soltar encima del catálogo o de un panel no pone nada en el hueco que queda detrás */
      if (document.elementFromPoint(clientX, clientY) !== canvas) return null;
      st.ptr.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      st.ray.setFromCamera(st.ptr, camera);
      const p = propsRef.current.params, geo = st.geo;
      if (!geo) return null;
      for (const h of st.ray.intersectObjects(st.meshes, false)) {
        const u = h.object.userData;
        if (!u) continue;
        if (u.grp === "hueco") return { col: u.col, cell: u.cell };
        const t = p.thickness;
        const xm = h.point.x * 1000, ym = (h.point.y - st.root.position.y) * 1000 - geo.y0;
        let xx = geo.x0;
        for (let i = 0; i < p.columns.length; i++) {
          const c = p.columns[i];
          /* los frentes tapan también el canto de los costados: la primera y la última columna llegan hasta fuera */
          const ex0 = i === 0 ? t : t / 2, ex1 = i === p.columns.length - 1 ? t : t / 2;
          if (xm >= xx - ex0 && xm <= xx + c.width + ex1) {
            if (ym < -t || ym > geo.Hi + t) return { col: i, cell: null };
            return { col: i, cell: cellAtHeight(p, c, clamp(ym, 0, geo.Hi - 1)) };
          }
          xx += c.width + t;
        }
        return { col: null, cell: null };
      }
      return null;
    };
    /* pinta el resaltado: un hueco, una columna entera (divisor) o todo el frente (tiradores) */
    const showDrop = (target, ok, item) => {
      const p = propsRef.current.params, geo = st.geo, m = st.dropMesh;
      if (!target || !geo) { m.visible = false; return; }
      const t = p.thickness, z = (p.depth / 2 + t + 8) / 1000;
      let box = null;
      if (item && item.startsWith("h:")) {
        box = [0, p.baseHeight + (p.height - p.baseHeight) / 2, p.width, p.height - p.baseHeight];
      } else if (target.col != null && item === "divider") {
        let xx = geo.x0;
        for (let i = 0; i < target.col; i++) xx += p.columns[i].width + t;
        const c = p.columns[target.col];
        box = [xx + c.width / 2, geo.y0 + geo.Hi / 2, c.width, geo.Hi];
      } else if (target.col != null && target.cell != null) {
        const info = st.cells[`${target.col}_${target.cell}`];
        if (info) box = [info.pos[0], info.pos[1], info.size[0], info.size[1]];
      }
      if (!box) { m.visible = false; return; }
      m.material = ok ? st.dropOk : st.dropBad;
      m.position.set(box[0] / 1000, box[1] / 1000, z);
      m.scale.set(box[2] / 1000, box[3] / 1000, 0.004);
      m.visible = true;
    };
    st.targetAt = targetAt;
    st.showDrop = showDrop;

    const zoomAt = (e, factor) => {
      const p = pointUnder(e);
      const nr = clamp(st.cam.tR * factor, R_MIN, R_MAX);
      const applied = nr / st.cam.tR;
      st.cam.tTarget.lerp(p, clamp((1 - applied) * 0.8, -0.45, 0.45));
      clampTarget();
      st.cam.tR = nr;
    };
    const panBy = (dx, dy) => {
      const r = canvas.getBoundingClientRect();
      const k = (2 * st.cam.tR * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, r.height);
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
      st.cam.tTarget.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      clampTarget();
    };

    const selectFrom = (u) => {
      const { onSelect } = propsRef.current;
      if (u && u.grp === "balda") onSelect({ k: "shelf", col: u.col, shelf: u.shelf });
      else if (u && u.grp === "barra") onSelect({ k: "rail", col: u.col, cell: u.cell });
      else if (u && u.grp === "divisor") onSelect({ k: "div", div: u.div });
      else if (u && u.col != null && u.cell != null) onSelect({ k: "cell", col: u.col, cell: u.cell });
      else onSelect(null);
    };

    /* Tocar una puerta la abre (y elige su hueco para editar dentro); tocar la hoja
       abierta la cierra. Se queda abierta mientras se colocan cosas dentro. */
    const tapOn = (hit) => {
      const u = hit ? hit.object.userData : null;
      const pr = propsRef.current;
      if (u && u.grp === "frente" && u.hinge && !pr.exploded) {
        const isOpen = !!pr.open || (pr.openCols || []).includes(u.col);
        pr.onToggleDoor?.(u.col, !isOpen);
        if (isOpen) { pr.onSelect(null); return; }
      }
      selectFrom(u);
    };

    const onDown = (e) => {
      st.spin = null;
      st.vel = { t: 0, p: 0 };
      canvas.setPointerCapture(e.pointerId);
      st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (st.pointers.size === 2) {
        st.drag = null; st.mode = "pinch";
        const [a, b] = [...st.pointers.values()];
        st.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        st.pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        st.pinchAng = Math.atan2(b.y - a.y, b.x - a.x);
        return;
      }
      if (st.pointers.size > 2) return;
      st.last = { x: e.clientX, y: e.clientY };
      st.moved = 0;
      if (e.button === 1 || e.button === 2 || e.shiftKey || e.altKey) { st.mode = "pan"; return; }
      const hit = pickAt(e);
      /* con un hueco elegido, arrastrar su frente, su barra o su tirador lo lleva a otro hueco */
      const sel = propsRef.current.selection, hu = hit && hit.object.userData;
      const own = sel && sel.k === "cell" && hu && hu.col === sel.col && e.button === 0 && !propsRef.current.placing &&
        ["frente", "cajon", "barra", "hueco"].includes(hu.grp) &&
        (hu.cells ? sel.cell >= hu.cells[0] && sel.cell <= hu.cells[1] : hu.cell === sel.cell) &&
        (propsRef.current.params.columns[sel.col]?.cells[sel.cell] || "open") !== "open";
      if (own) {
        st.mode = "move";
        st.move = { from: { col: sel.col, cell: sel.cell }, to: null };
        return;
      }
      if (propsRef.current.placing) { st.mode = "orbit"; return; }   // colocando: el toque pone la pieza
      const hu0 = hit && hit.object.userData;
      if (hu0 && hu0.grp === "barra" && e.button === 0) {
        /* la barra cuelga de la balda de encima: arrastrarla sube o baja esa balda.
           En el hueco de arriba del todo no hay balda que mover: solo se elige. */
        const p = propsRef.current.params, c = p.columns[hu0.col];
        if (c && hu0.cell < c.shelves.length) {
          const n = camera.getWorldDirection(new THREE.Vector3()).negate();
          st.dragPlane.setFromNormalAndCoplanarPoint(n, hit.point);
          st.ray.ray.intersectPlane(st.dragPlane, st.hitPt);
          const lower = hu0.cell > 0 ? c.shelves[hu0.cell - 1] + p.thickness / 2 : 0;
          st.drag = {
            u: { ...hu0, shelf: hu0.cell }, axis: "y", start: st.hitPt.clone(),
            base: c.shelves[hu0.cell], baseNext: 0, snap: deepCopy(p),
            min: lower + 600 + p.thickness / 2,           // la barra necesita 60 cm libres debajo
          };
          st.mode = "drag";
        } else st.mode = "orbit";
        selectFrom(hu0);
        return;
      }
      if (hit && hit.object.userData.drag && e.button === 0) {
        const u = hit.object.userData;
        const p = propsRef.current.params;
        const n = camera.getWorldDirection(new THREE.Vector3()).negate();
        st.dragPlane.setFromNormalAndCoplanarPoint(n, hit.object.position);
        st.ray.ray.intersectPlane(st.dragPlane, st.hitPt);
        st.drag = {
          u, axis: u.drag, start: st.hitPt.clone(),
          base: u.drag === "y" ? p.columns[u.col].shelves[u.shelf] : p.columns[u.div].width,
          baseNext: u.drag === "x" ? p.columns[u.div + 1].width : 0,
          snap: deepCopy(p),
        };
        st.mode = "drag";
        selectFrom(u);
      } else st.mode = "orbit";
    };

    const onMove = (e) => {
      /* colocando una pieza del catálogo: el hueco bajo el puntero se resalta */
      if (!st.pointers.size && propsRef.current.placing) {
        const tg = targetAt(e.clientX, e.clientY);
        showDrop(tg, !!tg && !!propsRef.current.canDropAt?.(propsRef.current.placing, tg), propsRef.current.placing);
        return;
      }
      if (!st.pointers.has(e.pointerId)) return;
      if (st.mode === "move" && st.move) {
        st.moved += Math.abs(e.clientX - st.last.x) + Math.abs(e.clientY - st.last.y);
        st.last = { x: e.clientX, y: e.clientY };
        if (st.moved > 12) {
          const tg = targetAt(e.clientX, e.clientY);
          const src = propsRef.current.params.columns[st.move.from.col].cells[st.move.from.cell];
          const same = tg && tg.col === st.move.from.col && tg.cell === st.move.from.cell;
          st.move.to = tg && !same ? tg : null;
          showDrop(tg, !!st.move.to && !!propsRef.current.canDropAt?.(src, tg), src);
          canvas.style.cursor = "grabbing";
        }
        return;
      }
      st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (st.mode === "pinch" && st.pointers.size >= 2) {
        const [a, b] = [...st.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (st.pinchDist > 0) {
          st.cam.tR = clamp(st.cam.tR * (st.pinchDist / d), R_MIN, R_MAX);
          panBy(mid.x - st.pinchMid.x, mid.y - st.pinchMid.y);
          /* girar los dos dedos en el sentido del reloj gira el mueble como arrastrar a la derecha */
          let da = ang - st.pinchAng;
          if (da > Math.PI) da -= 2 * Math.PI;
          if (da < -Math.PI) da += 2 * Math.PI;
          st.cam.tTheta -= da * 1.2;
        }
        st.pinchDist = d; st.pinchMid = mid; st.pinchAng = ang;
        return;
      }

      const dx = e.clientX - st.last.x, dy = e.clientY - st.last.y;
      st.moved += Math.abs(dx) + Math.abs(dy);

      if (st.mode === "drag" && st.drag) {
        setPtr(e);
        st.ray.setFromCamera(st.ptr, camera);
        if (!st.ray.ray.intersectPlane(st.dragPlane, st.hitPt)) return;
        const p = deepCopy(propsRef.current.params);
        const t = p.thickness;
        const Hi = p.height - p.baseHeight - 2 * t;
        if (st.drag.axis === "y") {
          const d = (st.hitPt.y - st.drag.start.y) * 1000;
          const c = p.columns[st.drag.u.col];
          const others = c.shelves.filter((_, i) => i !== st.drag.u.shelf);
          const fl = 0;
          // salto de 32 mm: el sistema 32 real de ebanistería
          const v = clamp(Math.round((st.drag.base + d) / 32) * 32, Math.max(fl + 140, st.drag.min || 0), Hi - 140);
          if (others.every((o) => Math.abs(o - v) >= 140)) {
            c.shelves[st.drag.u.shelf] = v;
            propsRef.current.onChange(p);
          }
        } else {
          const d = (st.hitPt.x - st.drag.start.x) * 1000;
          const i = st.drag.u.div;
          const total = st.drag.base + st.drag.baseNext;
          const na = clamp(Math.round((st.drag.base + d) / 10) * 10, 150, total - 150);
          p.columns[i].width = na;
          p.columns[i + 1].width = total - na;
          propsRef.current.onChange(p);
        }
        st.last = { x: e.clientX, y: e.clientY };
        return;
      }
      if (st.mode === "pan") { panBy(dx, dy); st.last = { x: e.clientX, y: e.clientY }; return; }
      if (st.mode === "orbit") {
        st.cam.tTheta -= dx * 0.0068;
        st.cam.tPhi -= dy * 0.0062;
        const now = performance.now(), dt = clamp(now - st.lastMoveT, 4, 60);
        st.vel.t = st.vel.t * 0.5 + (-dx * 0.0068 / dt) * 0.5;
        st.vel.p = st.vel.p * 0.5 + (-dy * 0.0062 / dt) * 0.5;
        st.lastMoveT = now;
        st.last = { x: e.clientX, y: e.clientY };
      }
    };

    const onUp = (e) => {
      st.pointers.delete(e.pointerId);
      if (st.mode === "move" && st.move) {
        showDrop(null);
        canvas.style.cursor = propsRef.current.placing ? "copy" : "";
        if (st.moved > 12) {
          if (st.move.to && e.type === "pointerup") propsRef.current.onMoveCell?.(st.move.from, st.move.to);
        } else {
          tapOn(pickAt(e));
        }
        st.move = null;
        st.mode = null;
        return;
      }
      if (st.mode === "orbit" && st.moved < 9 && e.type === "pointerup" && propsRef.current.placing) {
        /* modo colocar: el toque pone la pieza en vez de elegir */
        showDrop(null);
        propsRef.current.onPlace?.(targetAt(e.clientX, e.clientY));
        st.mode = null;
        return;
      }
      if (st.mode === "drag" && st.drag) {
        if (st.moved > 4) propsRef.current.onCommit(st.drag.snap);
        st.drag = null;
      } else if (st.mode === "orbit" && st.moved < 5 && e.type === "pointerup") {
        tapOn(pickAt(e));
      } else if (st.mode === "orbit" && st.pointers.size === 0 && performance.now() - st.lastMoveT < 70) {
        /* soltar a medio giro: sigue girando y frena (velocidad por fotograma a 60 fps) */
        st.spin = { t: clamp(st.vel.t * 16, -0.09, 0.09), p: clamp(st.vel.p * 16, -0.05, 0.05) };
      }
      if (st.pointers.size === 0) st.mode = null;
      else if (st.pointers.size === 1) {
        const [q] = [...st.pointers.values()];
        st.last = { x: q.x, y: q.y };
        st.mode = "orbit";
      }
    };

    /* Rueda del ratón: zoom. Trackpad: deslizar con dos dedos gira el mueble
       (a los lados gira, arriba y abajo inclina) y la inercia de macOS lo deja
       girando; pellizcar hace zoom (en Chrome y Firefox llega como rueda con
       ctrlKey; en Safari, como gesturechange, más abajo).
       Para distinguir ratón y trackpad: el trackpad manda deltas finos y
       seguidos (wheelDeltaY = −3·deltaY en Chrome y Safari) o desplazamiento
       lateral; una ráfaga conserva su clasificación hasta 250 ms sin eventos. */
    const looksLikePad = (e) => {
      if (e.deltaMode !== 0) return false;
      if (Math.abs(e.deltaX) > 0.5) return true;
      if (typeof e.wheelDeltaY === "number" && e.wheelDeltaY !== 0) return Math.abs(e.wheelDeltaY + 3 * e.deltaY) < 2;
      return Math.abs(e.deltaY) < 40 && !Number.isInteger(e.deltaY * 4);
    };
    const onWheel = (e) => {
      e.preventDefault();
      st.spin = null;
      let dx = e.deltaX, dy = e.deltaY;
      if (e.deltaMode === 1) { dx *= 16; dy *= 16; } else if (e.deltaMode === 2) { dx *= 100; dy *= 100; }
      if (e.ctrlKey) {
        if (!st.gesture) zoomAt(e, Math.exp(clamp(dy, -140, 140) * 0.0115));
        return;
      }
      const now = performance.now();
      if (now - st.wheel.t > 250) st.wheel.pad = looksLikePad(e);
      st.wheel.t = now;
      if (st.wheel.pad) {
        /* con el desplazamiento natural de macOS, deltaX va al revés que los dedos:
           así el mueble sigue a los dedos, igual que al arrastrar */
        st.cam.tTheta += clamp(dx, -120, 120) * 0.0052;
        st.cam.tPhi += clamp(dy, -120, 120) * 0.0042;
      } else {
        zoomAt(e, Math.exp(clamp(dy || dx, -140, 140) * 0.0021));
      }
    };
    /* Safari en Mac: pellizco y giro de dos dedos en el trackpad.
       scale y rotation son absolutos desde el inicio del gesto. Sin
       preventDefault, Safari hace zoom a toda la página. */
    const onGestureStart = (e) => { e.preventDefault(); st.spin = null; st.gesture = { scale: 1, rot: 0 }; };
    const onGestureChange = (e) => {
      e.preventDefault();
      const g = st.gesture || { scale: 1, rot: 0 };
      if (e.scale > 0) zoomAt(e, clamp(g.scale / e.scale, 0.8, 1.25));
      st.cam.tTheta -= ((e.rotation - g.rot) * Math.PI / 180) * 1.2;
      st.gesture = { scale: e.scale, rot: e.rotation };
    };
    const onGestureEnd = (e) => { e.preventDefault(); st.gesture = null; };
    const onDbl = (e) => {
      st.cam.tTarget.copy(pointUnder(e));
      clampTarget();
      st.cam.tR = clamp(st.cam.tR * 0.6, R_MIN, R_MAX);
    };
    const noMenu = (e) => e.preventDefault();

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    const onLeave = () => { if (!st.pointers.size) showDrop(null); };
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("gesturestart", onGestureStart);
    canvas.addEventListener("gesturechange", onGestureChange);
    canvas.addEventListener("gestureend", onGestureEnd);
    canvas.addEventListener("dblclick", onDbl);
    canvas.addEventListener("contextmenu", noMenu);

    const loop = () => {
      if (!st.alive) return;
      const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
      const pr = renderer.getPixelRatio();
      if (canvas.width !== Math.round(w * pr) || canvas.height !== Math.round(h * pr)) {
        renderer.setSize(w, h, false);
        composer.setPixelRatio(pr);
        composer.setSize(w, h);
        if (st.ph) st.ph.resize = true;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      stepCam();
      if (st.photoOn && st.ph) {
        const ph = st.ph, now = performance.now();
        const bw = renderer.domElement.width, bh = renderer.domElement.height;
        if (ph.resize || ph.accA.width !== bw || ph.accA.height !== bh) {
          ph.accA.setSize(bw, bh); ph.accB.setSize(bw, bh);
          ph.resize = false; ph.dirty = true;
        }
        camera.updateMatrixWorld();
        if (ph.dirty || !camera.matrixWorld.equals(ph.lastCam)) {
          /* se ha movido algo: se empieza de nuevo cuando la cámara se quede quieta */
          ph.lastCam.copy(camera.matrixWorld);
          ph.n = 0; ph.still = now; ph.dirty = false;
        }
        if (ph.n === 0 && now - ph.still < 180) {
          composer.render();
        } else if (ph.n < PHOTO_FRAMES) {
          const i = ph.n + 1;
          camera.setViewOffset(bw, bh, halton(i, 2) - 0.5, halton(i, 3) - 0.5, bw, bh);
          /* luz de ventana: la principal repartida en un disco de 1,2 m (sombras muy suaves) */
          const ang = i * 2.39996, rad = Math.sqrt(i / PHOTO_FRAMES) * 1.2;   // espiral de Fibonacci
          key.position.set(keyBase.x + Math.cos(ang) * rad, keyBase.y + Math.sin(ang) * rad * 0.6, keyBase.z + Math.sin(ang) * rad);
          /* objetivo: la cámara se mueve por la apertura mirando al mueble; lo lejano se desenfoca */
          const la = i * 2.39996 + 1.3, lr = Math.sqrt(i / PHOTO_FRAMES) * APERTURE;
          const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
          const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
          camera.position.addScaledVector(right, Math.cos(la) * lr).addScaledVector(up, Math.sin(la) * lr);
          camera.lookAt(st.cam.target);
          camera.updateMatrixWorld();
          composer.renderToScreen = false;
          composer.render();
          composer.renderToScreen = true;
          camera.clearViewOffset();
          writeCam();
          camera.updateMatrixWorld();
          key.position.copy(keyBase);
          ph.accMat.uniforms.tAcc.value = ph.accA.texture;
          ph.accMat.uniforms.tNew.value = composer.readBuffer.texture;
          ph.accMat.uniforms.w.value = 1 / i;
          renderer.setRenderTarget(ph.accB);
          ph.accQuad.render(renderer);
          [ph.accA, ph.accB] = [ph.accB, ph.accA];
          ph.n = i;
          renderer.setRenderTarget(null);
          ph.copyMat.uniforms.t.value = ph.accA.texture;
          ph.copyQuad.render(renderer);
        } else {
          renderer.setRenderTarget(null);
          ph.copyQuad.render(renderer);
        }
        if (now - st.lastReport > 150) {
          st.lastReport = now;
          propsRef.current.onPhotoProgress?.(ph.n / PHOTO_FRAMES);
        }
      } else {
        composer.render();
      }
      st.raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      st.alive = false;
      cancelAnimationFrame(st.raf);
      mq.removeEventListener("change", syncTheme);
      themeObs.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("gesturestart", onGestureStart);
      canvas.removeEventListener("gesturechange", onGestureChange);
      canvas.removeEventListener("gestureend", onGestureEnd);
      canvas.removeEventListener("dblclick", onDbl);
      canvas.removeEventListener("contextmenu", noMenu);
      if (st.ph) { st.ph.accA.dispose(); st.ph.accB.dispose(); st.ph.accQuad.dispose(); st.ph.copyQuad.dispose(); }
      composer.dispose();
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    const st = S.current;
    if (!st || !canvasRef.current) return;
    canvasRef.current.style.cursor = placing ? "copy" : "";
    if (!placing) st.showDrop?.(null);
  }, [placing]);

  /* ---------- reconstruir la malla cuando cambia el diseño ---------- */
  useEffect(() => {
    const st = S.current;
    if (!st) return;
    const p = params;

    /* cada pieza tiene ahora su propia geometría a tamaño real: se libera */
    st.meshes.forEach((m) => { st.root.remove(m); m.geometry.dispose(); });
    st.meshes = [];
    st.extra.forEach((o) => st.root.remove(o));
    st.extra = [];
    const geo = build(p);
    st.geo = geo;

    const R = st.renderer;
    const M = MATERIALS[p.material];
    const wood = isWood(p.material);

    const faceMat = (sel) => {
      const ck = p.material + (sel ? "_s" : "");
      if (st.mats[ck]) return st.mats[ck];
      let m;
      if (sel) {
        m = new THREE.MeshStandardMaterial({
          color: 0xc97a3c, roughness: 0.5, metalness: 0,
          emissive: new THREE.Color(0x8a3f12), emissiveIntensity: 0.22 });
      } else if (wood) {
        const sheet = woodSheet(p.material, R);
        m = new THREE.MeshPhysicalMaterial({
          map: sheet.map, bumpMap: sheet.bump, bumpScale: 1.0,
          roughness: M.rough, metalness: 0,
          clearcoat: 0.3, clearcoatRoughness: 0.45 });   // barniz satinado
      } else {
        m = new THREE.MeshPhysicalMaterial({ color: M.hex, roughness: M.rough, metalness: 0,
          clearcoat: 0.18, clearcoatRoughness: 0.3 });      // melamina: brillo suave
      }
      st.mats[ck] = m;
      return m;
    };
    /* canto: chapas cruzadas en el contrachapado; canto chapado en el resto */
    const edgeMat = (sel) => {
      if (sel || p.material !== "abedul") return faceMat(sel);
      const ck = "ply_" + p.thickness;
      if (!st.mats[ck]) {
        st.mats[ck] = new THREE.MeshStandardMaterial({
          map: plyEdge(p.thickness, R), roughness: 0.72, metalness: 0 });
      }
      return st.mats[ck];
    };

    const t = p.thickness;
    const openNow = !!open && !exploded;
    const pull = openNow ? (p.depth - 60) * 0.6 : 0;          // cajones sacados
    /* Tiradores con el estilo del mueble. El origen del grupo es el anclaje sobre
       la cara del frente y la pieza sale hacia +z. Tocar un tirador elige su hueco. */
    const style = p.handle || "bar";
    const handle = (x, vertical) => {
      if (style === "push" || x.nohandle) return null;
      const g = new THREE.Group();
      const put = (geom, mat, px, py, pz) => {
        const m = new THREE.Mesh(geom, mat);
        m.position.set(px, py, pz);
        m.castShadow = true;
        m.userData = x;
        g.add(m);
        st.meshes.push(m);
      };
      if (style === "bar" || style === "bar_brass") {
        /* barra sobre dos patas, separada 30 mm del frente */
        const mat = style === "bar" ? st.metalMat : st.brassMat;
        const L = (vertical ? Math.min(x.Wd * 0.25, 220) : Math.min(x.L * 0.42, 180)) / 1000;
        put(vertical ? new THREE.BoxGeometry(0.01, L, 0.01) : new THREE.BoxGeometry(L, 0.01, 0.01), mat, 0, 0, 0.03);
        for (const sg of [-1, 1]) {
          const o = sg * (L / 2 - 0.012);
          put(new THREE.CylinderGeometry(0.0035, 0.0035, 0.028, 10).rotateX(Math.PI / 2), mat, vertical ? 0 : o, vertical ? o : 0, 0.014);
        }
        g.userData.len = L * 1000;
      } else if (style === "knob") {
        put(new THREE.CylinderGeometry(0.006, 0.008, 0.022, 20).rotateX(Math.PI / 2), st.metalMat, 0, 0, 0.011);
        put(new THREE.SphereGeometry(0.015, 24, 16).scale(1, 1, 0.6), st.metalMat, 0, 0, 0.028);
        g.userData.len = 30;
      } else if (style === "cup") {
        /* embutido: marco de aluminio enrasado y el hueco para los dedos */
        const w = vertical ? 0.03 : 0.12, h = vertical ? 0.12 : 0.03;
        put(new THREE.BoxGeometry(w, h, 0.003), st.aluMat, 0, 0, 0.0015);
        put(new THREE.BoxGeometry(w - 0.01, h - 0.01, 0.002), st.recessMat, 0, 0, 0.0032);
        g.userData.len = 120;
      } else if (style === "profile") {
        /* gola: perfil de aluminio a lo largo de todo el canto de apertura */
        const len = (vertical ? x.Wd : x.L) / 1000;
        put(vertical ? new THREE.BoxGeometry(0.018, len, 0.016) : new THREE.BoxGeometry(len, 0.018, 0.016), st.aluMat, 0, 0, 0.008);
        g.userData.len = len * 1000;
        g.userData.edge = true;
      }
      return g;
    };
    const rail = (part) => {
      const [px, py, pz] = part.pos;
      const selR = selection && selection.k === "rail" && selection.col === part.col && selection.cell === part.cell;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, part.L / 1000, 24), selR ? st.railSelMat : st.chromeMat);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(px / 1000, py / 1000, pz / 1000);
      bar.castShadow = true;
      bar.userData = part;
      st.root.add(bar); st.meshes.push(bar);
      [-1, 1].forEach((sg) => {        // soportes atornillados al costado
        const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.006, 24), st.chromeMat);
        fl.rotation.z = Math.PI / 2;
        fl.position.set((px + sg * (part.L / 2 + 2)) / 1000, py / 1000, pz / 1000);
        fl.userData = part;
        st.root.add(fl); st.meshes.push(fl);
      });
    };

    /* trasera: tablero fino con el mismo acabado, mate y sin barniz */
    const backMat = () => {
      const ck = "back_" + p.material;
      if (!st.mats[ck]) {
        st.mats[ck] = wood
          ? new THREE.MeshStandardMaterial({ map: woodSheet(p.material, R).map, color: 0xe9e2d6, roughness: 0.8, metalness: 0 })
          : new THREE.MeshStandardMaterial({ color: M.hex, roughness: 0.62, metalness: 0 });
      }
      return st.mats[ck];
    };

    geo.parts.forEach((part) => {
      if (part.hide || !part.pos) return;
      if (part.grp === "barra") { rail(part); return; }
      const isBack = part.grp === "trasera";
      const isSel = selection && (
        (selection.k === "shelf" && part.grp === "balda" &&
         part.col === selection.col && part.shelf === selection.shelf) ||
        (selection.k === "div" && part.grp === "divisor" && part.div === selection.div) ||
        /* hueco elegido: se resalta su frente (la puerta o los cajones) */
        (selection.k === "cell" && part.grp === "frente" && part.col === selection.col &&
         (part.cells ? selection.cell >= part.cells[0] && selection.cell <= part.cells[1] : part.cell === selection.cell)));
      const g = panelGeometry(part.size, part.id, !isBack && p.material === "abedul");
      const m = new THREE.Mesh(g, isBack ? backMat() : [faceMat(isSel), edgeMat(isSel)]);
      let [px, py, pz] = part.pos;
      if (exploded) {
        if (part.grp === "frente" || part.grp === "cajon") pz += 260;
        if (isBack) pz -= 230;
        if (part.grp === "balda") pz += 90;
      }
      if (part.drawer) pz += pull;
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData = part;
      st.meshes.push(m);
      if (part.grp === "frente" && part.hinge) {
        /* puerta embutida: gira sobre la arista delantera del lado de las bisagras, así sale hacia fuera sin chocar con el costado */
        const side = part.hinge === "L" ? -1 : 1;
        const pivot = new THREE.Group();
        pivot.position.set((px + side * part.L / 2) / 1000, py / 1000, (pz + t / 2) / 1000);
        /* abierta si se abre todo, o si se ha abierto esa puerta tocándola */
        const openHere = openNow || (!exploded && openCols.includes(part.col));
        pivot.rotation.y = openHere ? side * 1.5 : 0;   // ~86°: las hojas vecinas no se cruzan
        m.position.set((-side * part.L / 2) / 1000, 0, -t / 2000);
        pivot.add(m);
        const hnd = handle(part, true);
        if (hnd) {
          const len = hnd.userData.len;
          const bottom = part.pos[1] - part.Wd / 2, top = part.pos[1] + part.Wd / 2;
          const yh = hnd.userData.edge ? py : clamp(1000, bottom + len / 2 + 60, top - len / 2 - 60);
          hnd.position.set((-side * (part.L - (hnd.userData.edge ? 9 : 40))) / 1000, (yh - py) / 1000, 0);
          pivot.add(hnd);
        }
        st.root.add(pivot);
        st.extra.push(pivot);
        return;
      }
      m.position.set(px / 1000, py / 1000, pz / 1000);
      st.root.add(m);
      if (part.grp === "frente") {
        /* cajón: tirador horizontal centrado cerca del canto superior; la gola, en el canto */
        const hnd = handle(part, false);
        if (hnd) {
          const dy = hnd.userData.edge ? part.Wd / 2 - 9 : part.Wd / 2 - Math.min(45, part.Wd / 3);
          hnd.position.set(px / 1000, (py + dy) / 1000, (pz + t / 2) / 1000);
          st.root.add(hnd);
          st.extra.push(hnd);
        }
      }
    });

    /* zonas de toque: una por hueco, justo detrás del plano frontal */
    st.cells = {};
    {
      let xx = geo.x0;
      p.columns.forEach((c, i) => {
        const bnd = [0, ...c.shelves, geo.Hi], last = c.shelves.length;
        for (let j = 0; j <= last; j++) {
          const lo = bnd[j] + (j > 0 ? t / 2 : 0), hi = bnd[j + 1] - (j < last ? t / 2 : 0);
          const info = { grp: "hueco", col: i, cell: j,
            pos: [xx + c.width / 2, geo.y0 + (lo + hi) / 2, p.depth / 2 - 8], size: [c.width - 2, hi - lo - 2, 4] };
          st.cells[`${i}_${j}`] = info;
          const sel = !!selection && selection.k === "cell" && selection.col === i && selection.cell === j;
          const pk = new THREE.Mesh(new THREE.BoxGeometry(info.size[0] / 1000, info.size[1] / 1000, 0.004),
                                    sel ? st.selCellMat : st.pickMat);
          pk.position.set(info.pos[0] / 1000, info.pos[1] / 1000, (info.pos[2] + (sel && openNow ? 0 : 0)) / 1000);
          pk.visible = sel;                 // invisible, pero recibe el toque
          pk.userData = info;
          st.root.add(pk);
          st.meshes.push(pk);
        }
        xx += c.width + t;
      });
    }

    if (p.base === "patas") {
      const r = 0.017, h = p.baseHeight / 1000;
      const legs = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      if (legCount(p) === 6) legs.push([0, -1], [0, 1]);   // apoyo central en muebles anchos
      legs.forEach(([sx, sz]) => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.72, r, h, 14), st.metalMat);
        leg.position.set((sx * (p.width / 2 - 70)) / 1000, h / 2, (sz * (p.depth / 2 - 60)) / 1000);
        leg.castShadow = true;
        leg.userData = { grp: "pata" };
        st.root.add(leg);
        st.meshes.push(leg);
      });
    }

    st.root.position.y = p.base === "flotante" ? 0.42 : 0;
    st.fig.position.set((p.width / 2 + 560) / 1000, 0, p.depth / 2000);
    st.fig.visible = !!showScale && !st.photoOn;
    if (st.ph) st.ph.dirty = true;   // la foto vuelve a empezar si cambia el mueble
    if (st.photoOn) st.stage(true);
  }, [params, selection, exploded, showScale, open, openCols.join(",")]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- modo foto: acumulación ---------- */
  useEffect(() => {
    const st = S.current;
    if (!st) return;
    const { renderer, key } = st;
    const setShadow = (size) => {
      key.shadow.mapSize.set(size, size);
      key.shadow.map?.dispose();
      key.shadow.map = null;
    };
    if (photo) {
      if (!st.ph) {
        const bw = renderer.domElement.width, bh = renderer.domElement.height;
        const rt = () => new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, depthBuffer: false });
        const accMat = new THREE.ShaderMaterial({
          uniforms: { tAcc: { value: null }, tNew: { value: null }, w: { value: 1 } },
          vertexShader: QUAD_VS,
          fragmentShader: "uniform sampler2D tAcc; uniform sampler2D tNew; uniform float w; varying vec2 vUv;" +
            "void main() { gl_FragColor = mix(texture2D(tAcc, vUv), texture2D(tNew, vUv), w); }",
          depthTest: false, depthWrite: false,
        });
        const copyMat = new THREE.ShaderMaterial({
          uniforms: { t: { value: null } },
          vertexShader: QUAD_VS,
          fragmentShader: "uniform sampler2D t; varying vec2 vUv; void main() {" +
            " vec3 c = texture2D(t, vUv).rgb;" +
            " c = mix(c, c * c * (3.0 - 2.0 * c), 0.2);" +
            " c *= vec3(1.02, 1.0, 0.97);" +
            " c *= mix(1.0, 0.8, smoothstep(0.38, 0.9, distance(vUv, vec2(0.5)) * 1.15));" +
            " gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0); }",
          depthTest: false, depthWrite: false,
        });
        st.ph = { accA: rt(), accB: rt(), accMat, copyMat, accQuad: new FullScreenQuad(accMat), copyQuad: new FullScreenQuad(copyMat),
                  lastCam: new THREE.Matrix4(), n: 0, still: 0, dirty: true, resize: false };
      }
      st.ph.dirty = true;
      st.gtaoWas = st.gtao.enabled;
      st.gtao.enabled = true;               // en la foto, siempre con oclusión ambiental
      st.gtao.updateGtaoMaterial({ radius: 0.35 });
      setShadow(4096);
      st.photoOn = true;
      st.stage(true);
      st.fig.visible = false;
    } else if (st.photoOn) {
      st.photoOn = false;
      st.stage(false);
      st.gtao.enabled = st.gtaoWas;
      st.gtao.updateGtaoMaterial({ radius: 0.2 });
      setShadow(2048);
      st.fig.visible = !!propsRef.current.showScale;
      propsRef.current.onPhotoProgress?.(0);
    }
  }, [photo]);

  useImperativeHandle(ref, () => ({
    cellPart: (col, j) => S.current?.cells?.[`${col}_${j}`] || null,
    frame(preset, instant) {
      const st = S.current;
      if (!st) return;
      const p = propsRef.current.params;
      const h = p.height / 1000, w = p.width / 1000;
      const lift = p.base === "flotante" ? 0.42 : 0;
      const c = st.cam;
      const d = p.depth / 1000;
      c.tTarget.set(0, lift + h * 0.5, 0);
      /* distancia para que quepa a lo ancho y a lo alto con el aspecto real del visor:
         en un móvil vertical el ancho manda, y antes el mueble salía cortado */
      const rect = canvasRef.current.getBoundingClientRect();
      const aspect = clamp(rect.width / Math.max(1, rect.height), 0.35, 3);
      const vf = (st.camera.fov * Math.PI) / 360, hf = Math.atan(Math.tan(vf) * aspect);
      const fit = (ww, hh) => clamp(Math.max((hh / 2 + 0.1) / Math.tan(vf), (ww / 2 + 0.1) / Math.tan(hf)) * 1.12 + d / 2, R_MIN, R_MAX);
      /* el ángulo más cercano al actual: tras varias vueltas, no desenrosca todas */
      const near = (a) => a + 2 * Math.PI * Math.round((c.theta - a) / (2 * Math.PI));
      if (preset === "front") { c.tTheta = near(0); c.tPhi = Math.PI / 2; c.tR = fit(w, h); }
      if (preset === "34") { c.tTheta = near(-0.52); c.tPhi = 1.32; c.tR = fit(w * 0.87 + d * 0.5, h + d * 0.25); }
      if (preset === "top") { c.tTheta = near(-0.22); c.tPhi = 0.4; c.tR = fit(w, d + h * 0.4); }
      st.spin = null;
      if (instant) {
        c.theta = c.tTheta; c.phi = c.tPhi; c.r = c.tR; c.target.copy(c.tTarget);
      }
    },
    /* proyecta una pieza a coordenadas de pantalla, para el panel flotante */
    project(part) {
      const st = S.current;
      if (!st || !part?.pos) return null;
      const v = new THREE.Vector3(
        part.pos[0] / 1000, (part.pos[1] + part.size[1] / 2) / 1000, part.pos[2] / 1000 + 0.16)
        .add(st.root.position).project(st.camera);
      const r = canvasRef.current.getBoundingClientRect();
      return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height, w: r.width, h: r.height };
    },
    /* arrastrando una pieza del catálogo: resalta el hueco bajo el puntero */
    dropAt(clientX, clientY, item) {
      const st = S.current;
      if (!st?.targetAt) return null;
      const tg = st.targetAt(clientX, clientY);
      const ok = !!tg && !!propsRef.current.canDropAt?.(item, tg);
      st.showDrop(tg, ok, item);
      return tg ? { ...tg, ok } : null;
    },
    clearDrop() { S.current?.showDrop?.(null); },
    /* la foto acumulada como PNG: se dibuja y se lee en la misma tarea */
    snapshot(cb) {
      const st = S.current;
      if (!st?.ph) return cb(null);
      st.renderer.setRenderTarget(null);
      st.ph.copyQuad.render(st.renderer);
      st.renderer.domElement.toBlob((blob) => cb(blob), "image/png");
    },
    flash(target, item) {
      const st = S.current;
      if (!st?.showDrop) return;
      clearTimeout(st.flashT);
      /* tras reconstruir la malla (el hueco puede haber cambiado de tamaño) */
      requestAnimationFrame(() => requestAnimationFrame(() => {
        st.showDrop(target, true, item);
        st.flashT = setTimeout(() => st.showDrop(null), 700);
      }));
    },
    projectBox(part) {
      const st = S.current;
      if (!st || !part?.pos) return null;
      const r = canvasRef.current.getBoundingClientRect();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const v = new THREE.Vector3(
          (part.pos[0] + sx * part.size[0] / 2) / 1000,
          (part.pos[1] + sy * part.size[1] / 2) / 1000,
          (part.pos[2] + sz * part.size[2] / 2) / 1000).add(st.root.position).project(st.camera);
        const px = (v.x * 0.5 + 0.5) * r.width, py = (-v.y * 0.5 + 0.5) * r.height;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      return { x0, y0, x1, y1, w: r.width, h: r.height };
    },
    geo() { return S.current?.geo; },
  }), []);

  return <canvas ref={canvasRef} className="gl" />;
});

export default Viewport;
