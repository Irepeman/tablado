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
import { MATERIALS, DRAWER_H, build, clamp, deepCopy, legCount } from "@/lib/model";
import { woodSheet, plyEdge, panelGeometry, isWood } from "./wood";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

const R_MIN = 0.55, R_MAX = 17, EASE_ROT = 0.19, EASE_ZOOM = 0.17;

const Viewport = forwardRef(function Viewport(
  { params, onChange, onCommit, selection, onSelect, exploded, showScale, photo, onPhotoProgress, open }, ref) {
  const canvasRef = useRef(null);
  const S = useRef(null);              // todo el estado imperativo de three.js
  const propsRef = useRef({});
  propsRef.current = { params, onChange, onCommit, selection, onSelect, exploded, showScale, photo, onPhotoProgress, open };

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
      pt: null, photoOn: false, photoEnv: null, rasterEnv: null,
      ptSceneDirty: true, ptCamDirty: false, lastCam: new THREE.Matrix4(), lastReport: 0,
      box: new THREE.BoxGeometry(1, 1, 1),
      meshes: [], geo: null, grain: {}, mats: {},
      backMat: new THREE.MeshStandardMaterial({ color: 0xb9ae99, roughness: 0.9 }),
      metalMat: new THREE.MeshStandardMaterial({ color: 0x2b2b28, roughness: 0.36, metalness: 0.85 }),
      chromeMat: new THREE.MeshStandardMaterial({ color: 0xd9d9d6, roughness: 0.22, metalness: 1 }),
      /* zonas de toque de cada hueco: invisibles; la seleccionada, tintada */
      pickMat: new THREE.MeshBasicMaterial({ color: 0x2e5e42, transparent: true, opacity: 0, depthWrite: false }),
      selCellMat: new THREE.MeshBasicMaterial({ color: 0x3f8a5e, transparent: true, opacity: 0.2, depthWrite: false }),
      extra: [], cells: {},
      cam: { theta: -0.52, phi: 1.32, r: 5.2, target: new THREE.Vector3(0, 1, 0),
             tTheta: -0.52, tPhi: 1.32, tR: 5.2, tTarget: new THREE.Vector3(0, 1, 0) },
      ray: new THREE.Raycaster(), ptr: new THREE.Vector2(),
      dragPlane: new THREE.Plane(), hitPt: new THREE.Vector3(),
      drag: null, mode: null, last: { x: 0, y: 0 }, moved: 0,
      pointers: new Map(), pinchDist: 0, pinchMid: { x: 0, y: 0 },
      raf: 0, alive: true,
    };
    S.current = st;

    /* ----- tema: el fondo del visor sigue al de la página ----- */
    const syncTheme = () => {
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
    const pickAt = (e) => {
      setPtr(e);
      st.ray.setFromCamera(st.ptr, camera);
      const hits = st.ray.intersectObjects(st.meshes, false);
      return hits.find((h) => h.object.userData && h.object.userData.drag) || hits[0] || null;
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
      else if (u && u.grp === "divisor") onSelect({ k: "div", div: u.div });
      else if (u && u.col != null && u.cell != null) onSelect({ k: "cell", col: u.col, cell: u.cell });
      else onSelect(null);
    };

    const onDown = (e) => {
      canvas.setPointerCapture(e.pointerId);
      st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (st.pointers.size === 2) {
        st.drag = null; st.mode = "pinch";
        const [a, b] = [...st.pointers.values()];
        st.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        st.pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        return;
      }
      if (st.pointers.size > 2) return;
      st.last = { x: e.clientX, y: e.clientY };
      st.moved = 0;
      if (e.button === 1 || e.button === 2 || e.shiftKey || e.altKey) { st.mode = "pan"; return; }
      const hit = pickAt(e);
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
      if (!st.pointers.has(e.pointerId)) return;
      st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (st.mode === "pinch" && st.pointers.size >= 2) {
        const [a, b] = [...st.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (st.pinchDist > 0) {
          st.cam.tR = clamp(st.cam.tR * (st.pinchDist / d), R_MIN, R_MAX);
          panBy(mid.x - st.pinchMid.x, mid.y - st.pinchMid.y);
        }
        st.pinchDist = d; st.pinchMid = mid;
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
          const v = clamp(Math.round((st.drag.base + d) / 32) * 32, fl + 140, Hi - 140);
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
        st.last = { x: e.clientX, y: e.clientY };
      }
    };

    const onUp = (e) => {
      st.pointers.delete(e.pointerId);
      if (st.mode === "drag" && st.drag) {
        if (st.moved > 4) propsRef.current.onCommit(st.drag.snap);
        st.drag = null;
      } else if (st.mode === "orbit" && st.moved < 5 && e.type === "pointerup") {
        const hit = pickAt(e);
        selectFrom(hit ? hit.object.userData : null);
      }
      if (st.pointers.size === 0) st.mode = null;
      else if (st.pointers.size === 1) {
        const [q] = [...st.pointers.values()];
        st.last = { x: q.x, y: q.y };
        st.mode = "orbit";
      }
    };

    const onWheel = (e) => {
      e.preventDefault();
      let d = e.deltaY;
      if (e.deltaMode === 1) d *= 16;
      else if (e.deltaMode === 2) d *= 100;
      d = clamp(d, -140, 140);
      // la pinza del trackpad llega como wheel con ctrlKey y deltas pequeños
      zoomAt(e, Math.exp(d * (e.ctrlKey ? 0.0115 : 0.0021)));
    };
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
        st.ptCamDirty = true;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      stepCam();
      if (st.photoOn && st.pt) {
        /* Modo foto: cada fotograma suma una muestra. Si la cámara se mueve
           se reinicia la acumulación y se ve el render normal hasta converger. */
        camera.updateMatrixWorld();
        if (st.ptSceneDirty) {
          st.pt.setScene(scene, camera);
          st.pt.updateEnvironment();
          st.ptSceneDirty = false;
          st.lastCam.copy(camera.matrixWorld);
        } else if (st.ptCamDirty || !camera.matrixWorld.equals(st.lastCam)) {
          st.pt.updateCamera();
          st.lastCam.copy(camera.matrixWorld);
          st.ptCamDirty = false;
        }
        st.pt.renderSample();
        const now = performance.now();
        if (now - st.lastReport > 250) {
          st.lastReport = now;
          propsRef.current.onPhotoProgress?.(Math.floor(st.pt.samples));
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
      canvas.removeEventListener("dblclick", onDbl);
      canvas.removeEventListener("contextmenu", noMenu);
      st.pt?.dispose();
      composer.dispose();
      renderer.dispose();
    };
  }, []);

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
    const handle = (x, horizontal) => {
      const len = horizontal ? Math.min(x.L * 0.42, 180) : Math.min(x.Wd * 0.25, 220);
      const hnd = new THREE.Mesh(horizontal
        ? new THREE.BoxGeometry(len / 1000, 0.009, 0.022)
        : new THREE.BoxGeometry(0.009, len / 1000, 0.022), st.metalMat);
      hnd.castShadow = true;
      hnd.userData = x;                   // tocar el tirador selecciona su hueco
      st.meshes.push(hnd);
      return { hnd, len };
    };
    const rail = (part) => {
      const [px, py, pz] = part.pos;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, part.L / 1000, 24), st.chromeMat);
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
      const m = new THREE.Mesh(g, isBack ? st.backMat : [faceMat(isSel), edgeMat(isSel)]);
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
        /* puerta: gira sobre el canto de las bisagras, por detrás de la hoja */
        const side = part.hinge === "L" ? -1 : 1;
        const pivot = new THREE.Group();
        pivot.position.set((px + side * part.L / 2) / 1000, py / 1000, (pz - t / 2) / 1000);
        pivot.rotation.y = openNow ? side * 1.9 : 0;
        m.position.set((-side * part.L / 2) / 1000, 0, t / 2000);
        pivot.add(m);
        const { hnd, len } = handle(part, false);
        const bottom = part.pos[1] - part.Wd / 2, top = part.pos[1] + part.Wd / 2;
        const yh = clamp(1000, bottom + len / 2 + 60, top - len / 2 - 60);
        hnd.position.set((-side * (part.L - 40)) / 1000, (yh - py) / 1000, (t + 11) / 1000);
        pivot.add(hnd);
        st.root.add(pivot);
        st.extra.push(pivot);
        return;
      }
      m.position.set(px / 1000, py / 1000, pz / 1000);
      st.root.add(m);
      if (part.grp === "frente") {
        /* cajón: tirador horizontal centrado cerca del canto superior */
        const { hnd } = handle(part, true);
        hnd.position.set(px / 1000, (py + part.Wd / 2 - Math.min(45, part.Wd / 3)) / 1000, (pz + t / 2 + 11) / 1000);
        st.root.add(hnd);
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
    st.ptSceneDirty = true;   // el trazador reconstruye su escena si cambia el mueble
  }, [params, selection, exploded, showScale, open]);

  /* ---------- modo foto: trazado de rutas ----------
     La librería se carga solo al activarlo: no pesa en la carga inicial y no
     se evalúa en el servidor. Solo admite entornos equirectangulares, así que
     mientras dura se usa un degradado de estudio y luego se restaura el
     nuestro. El plano de sombra (ShadowMaterial) no lo entiende: se oculta,
     y el suelo real recibe las sombras trazadas. */
  useEffect(() => {
    const st = S.current;
    if (!st) return;
    let cancelled = false;
    if (photo) {
      (async () => {
        if (!st.pt) {
          const { WebGLPathTracer, GradientEquirectTexture } = await import("three-gpu-pathtracer");
          if (cancelled) return;
          const pt = new WebGLPathTracer(st.renderer);
          pt.tiles.set(2, 2);
          pt.bounces = 6;
          pt.minSamples = 3;
          pt.renderDelay = 80;
          pt.fadeDuration = 400;
          pt.filterGlossyFactor = 0.5;
          pt.dynamicLowRes = true;
          pt.lowResScale = 0.25;
          pt.textureSize.set(2048, 2048);    // que la veta no se emborrone
          const env = new GradientEquirectTexture();
          env.topColor.set(0xfaf7f0);
          env.bottomColor.set(0x6f6a60);
          env.exponent = 2;
          env.update();
          st.pt = pt;
          st.photoEnv = env;
        }
        if (cancelled) return;
        st.rasterEnv = st.scene.environment;
        st.scene.environment = st.photoEnv;
        st.scene.environmentIntensity = 1.0;
        st.shadowPlane.visible = false;
        st.fig.visible = false;
        st.ptSceneDirty = true;
        st.photoOn = true;
      })();
    } else if (st.photoOn) {
      st.photoOn = false;
      st.scene.environment = st.rasterEnv;
      st.scene.environmentIntensity = 0.7;
      st.shadowPlane.visible = true;
      st.fig.visible = !!propsRef.current.showScale;
      propsRef.current.onPhotoProgress?.(0);
    }
    return () => { cancelled = true; };
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
      c.tTarget.set(0, lift + h * 0.5, 0);
      c.tR = Math.max(w, h) * 1.62 + 1.0;
      if (preset === "front") { c.tTheta = 0; c.tPhi = Math.PI / 2; }
      if (preset === "34") { c.tTheta = -0.52; c.tPhi = 1.32; }
      if (preset === "top") { c.tTheta = -0.22; c.tPhi = 0.4; c.tR = Math.max(w, h) * 1.5 + 1.2; }
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
    geo() { return S.current?.geo; },
  }), []);

  return <canvas ref={canvasRef} className="gl" />;
});

export default Viewport;
