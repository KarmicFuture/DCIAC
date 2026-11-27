import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/* Experimental: the one-line diagram drawn with three.js. The standard SVG diagram is
   still rendered, hidden, inside the host. This module reads its lines, breakers,
   transformers, batteries, nodes and hall taps, so the 3D board always matches it, and a
   click on a 3D node clicks the same SVG control. Power flows as moving light along
   every energized conductor; a conductor at risk pulses, and an open or failed one goes
   red and dark. */

type Seg = { ax: number; az: number; bx: number; bz: number; tone: string };
type Spark = { seg: number; t: number };

type OnelineGl = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  world: THREE.Group;
  hits: THREE.Object3D[];
  pulses: THREE.MeshStandardMaterial[];
  segs: Seg[];
  sparks: Spark[];
  points: THREE.Points | null;
  key: string;
  frame: number;
  tick: number;
  observer: ResizeObserver | null;
  tip: HTMLElement | null;
  host: HTMLElement | null;
  framed: boolean;
};

let og: OnelineGl | null = null;
let failed = false;

const TONE: Record<string, string> = {
  live: "#ffd166", hit: "#ff9f43", failed: "#ff3b3b", dim: "#4b5563", dead: "#8b95a5", future: "#3a4250",
  hot: "#ff6b6b", warm: "#ff9f43",
};
const FLOWS = { live: 0.012, hit: 0.006 };

function calm() {
  return !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function toneOf(el: Element) {
  const cls = " " + (el.getAttribute("class") || "") + " ";
  for (const name of ["failed", "hit", "hot", "warm", "dim", "dead", "future", "live"]) {
    if (cls.indexOf(" " + name + " ") >= 0) return name;
  }
  return "live";
}

function attr(el: Element, name: string) {
  return parseFloat(el.getAttribute(name) || "0") || 0;
}

function translateOf(el: Element) {
  const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(el.getAttribute("transform") || "");
  return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 };
}

function label(text: string, sub: string, color = "#e6edf3") {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = sub ? 160 : 96;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.Object3D();
  ctx.font = "600 56px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 12);
  if (sub) {
    ctx.font = "40px system-ui, sans-serif";
    ctx.fillStyle = "#9fb0c3";
    ctx.fillText(sub, 256, 92);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(96, (96 * canvas.height) / canvas.width, 1);
  return sprite;
}

function create(): OnelineGl | null {
  if (failed) return null;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
  } catch (err) {
    failed = true;
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.className = "floor3d-canvas";
  renderer.domElement.setAttribute("data-onelinegl", "canvas");
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b0f14");
  const camera = new THREE.PerspectiveCamera(38, 1, 5, 6000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 200;
  controls.maxDistance = 2600;
  scene.add(new THREE.HemisphereLight("#b8c8ff", "#14100a", 1.0));
  const key = new THREE.DirectionalLight("#ffffff", 1.1);
  key.position.set(-300, 900, 600);
  scene.add(key);
  const world = new THREE.Group();
  scene.add(world);
  const made: OnelineGl = { renderer, scene, camera, controls, world, hits: [], pulses: [], segs: [], sparks: [], points: null, key: "", frame: 0, tick: 0, observer: null, tip: null, host: null, framed: false };
  renderer.domElement.addEventListener("click", (event) => pick(made, event, true));
  renderer.domElement.addEventListener("pointermove", (event) => pick(made, event, false));
  return made;
}

function clear(group: THREE.Group) {
  group.traverse((obj: any) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    }
  });
  group.clear();
}

function glowMat(tone: string, strength = 0.5) {
  const c = new THREE.Color(TONE[tone] || TONE.live);
  return new THREE.MeshStandardMaterial({
    color: c.clone().multiplyScalar(0.35), emissive: c, emissiveIntensity: tone === "future" ? 0.15 : strength,
    roughness: 0.5, metalness: 0.3, transparent: tone === "future", opacity: tone === "future" ? 0.45 : 1,
  });
}

function build(g: OnelineGl, svg: SVGSVGElement) {
  clear(g.world);
  g.hits = [];
  g.pulses = [];
  g.segs = [];
  g.sparks = [];
  g.points = null;
  const vb = (svg.getAttribute("viewBox") || "0 0 980 420").split(/\s+/).map(Number);
  const cx = vb[2] / 2;
  const cz = vb[3] / 2;
  const P = (x: number, y: number) => ({ x: x - cx, z: y - cz });
  const outside = (el: Element) => !!el.closest(".ol-legend");

  const board = new THREE.Mesh(new THREE.BoxGeometry(vb[2] + 60, 8, vb[3] + 40), new THREE.MeshStandardMaterial({ color: "#141b24", roughness: 0.9 }));
  board.position.y = -4;
  g.world.add(board);
  const grid = new THREE.GridHelper(Math.max(vb[2], vb[3]) + 60, 40, "#1f2a36", "#18212b");
  grid.position.y = 0.4;
  g.world.add(grid);

  const addSeg = (a, b, tone: string) => {
    const pa = P(a.x, a.y);
    const pb = P(b.x, b.y);
    const len = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    if (len < 1) return;
    g.segs.push({ ax: pa.x, az: pa.z, bx: pb.x, bz: pb.z, tone });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 4, 4), glowMat(tone, tone === "failed" ? 0.9 : 0.35));
    bar.position.set((pa.x + pb.x) / 2, 3, (pa.z + pb.z) / 2);
    bar.rotation.y = -Math.atan2(pb.z - pa.z, pb.x - pa.x);
    g.world.add(bar);
    if (tone === "hit") g.pulses.push(bar.material as THREE.MeshStandardMaterial);
    const flow = FLOWS[tone];
    if (flow) {
      const n = Math.max(1, Math.round(len / 45));
      for (let i = 0; i < n; i += 1) g.sparks.push({ seg: g.segs.length - 1, t: i / n });
    }
  };

  svg.querySelectorAll("line.ol-line").forEach((el) => {
    if (outside(el)) return;
    addSeg({ x: attr(el, "x1"), y: attr(el, "y1") }, { x: attr(el, "x2"), y: attr(el, "y2") }, toneOf(el));
  });
  svg.querySelectorAll("path.ol-line").forEach((el) => {
    if (outside(el)) return;
    const nums = (el.getAttribute("d") || "").match(/-?[\d.]+/g) || [];
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: parseFloat(nums[i]), y: parseFloat(nums[i + 1]) });
    for (let i = 1; i < pts.length; i += 1) addSeg(pts[i - 1], pts[i], toneOf(el));
  });

  svg.querySelectorAll("g.ol-breaker").forEach((el) => {
    if (outside(el)) return;
    const t = translateOf(el);
    const p = P(t.x, t.y);
    const tone = toneOf(el);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 14, 20), glowMat(tone, 0.4));
    body.position.set(p.x, 7, p.z);
    g.world.add(body);
    if (tone === "hit") g.pulses.push(body.material as THREE.MeshStandardMaterial);
  });
  svg.querySelectorAll("g.ol-xfmr").forEach((el) => {
    if (outside(el)) return;
    const t = translateOf(el);
    const p = P(t.x, t.y);
    const tone = toneOf(el);
    [-8, 8].forEach((dx) => {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(11, 3, 12, 32), glowMat(tone, 0.55));
      coil.position.set(p.x + dx, 14, p.z);
      g.world.add(coil);
    });
    const tag = label("XFMR", "");
    tag.position.set(p.x, 46, p.z);
    g.world.add(tag);
  });
  svg.querySelectorAll("g.ol-batt").forEach((el) => {
    if (outside(el)) return;
    const t = translateOf(el);
    const p = P(t.x, t.y);
    const tone = toneOf(el);
    for (let i = 0; i < 4; i += 1) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(4, 14 + (i % 2) * 10, 24), glowMat(tone, 0.4));
      plate.position.set(p.x - 10 + i * 7, 10, p.z);
      g.world.add(plate);
    }
  });
  svg.querySelectorAll("g.ol-utility").forEach((el) => {
    const r = el.querySelector("rect");
    if (!r) return;
    const p = P(attr(r, "x") + attr(r, "width") / 2, attr(r, "y") + attr(r, "height") / 2);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(6, 14, 70, 4), new THREE.MeshStandardMaterial({ color: "#8a96a8", metalness: 0.6, roughness: 0.4 }));
    tower.position.set(p.x, 35, p.z);
    g.world.add(tower);
    const tag = label("Utility", "");
    tag.position.set(p.x, 86, p.z);
    g.world.add(tag);
  });

  const texts = (el: Element) => ({
    main: (el.querySelector(".ol-label") || { textContent: "" }).textContent || "",
    sub: (el.querySelector(".ol-sub") || { textContent: "" }).textContent || "",
  });
  svg.querySelectorAll("g.ol-node").forEach((el) => {
    const r = el.querySelector("rect");
    if (!r) return;
    const w = attr(r, "width");
    const d = attr(r, "height");
    const p = P(attr(r, "x") + w / 2, attr(r, "y") + d / 2);
    const tone = toneOf(el);
    const mat = new THREE.MeshStandardMaterial({
      color: "#1d2733", roughness: 0.45, metalness: 0.4,
      emissive: new THREE.Color(TONE[tone] || TONE.live), emissiveIntensity: tone === "live" ? 0.08 : (tone === "future" ? 0.02 : 0.35),
      transparent: tone === "future", opacity: tone === "future" ? 0.45 : 1,
    });
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, 26, d), mat);
    box.position.set(p.x, 13, p.z);
    const t = texts(el);
    box.userData = { el, label: t.main + (t.sub ? " · " + t.sub : "") };
    g.world.add(box);
    g.hits.push(box);
    if (tone === "hit" || tone === "failed" || tone === "hot") g.pulses.push(mat);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: TONE[tone] || TONE.live }));
    box.add(edge);
    if (/\bpicked\b/.test(el.getAttribute("class") || "")) {
      const ring = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 10, 34, d + 10)), new THREE.LineBasicMaterial({ color: "#8b6cff" }));
      ring.position.copy(box.position);
      g.world.add(ring);
    }
    const tag = label(t.main, t.sub);
    // The outlet and server rows are tight; their labels sit lower and smaller.
    if (d < 40) tag.scale.multiplyScalar(0.62);
    tag.position.set(p.x, d < 40 ? 36 : 52, p.z);
    g.world.add(tag);
  });
  svg.querySelectorAll("g.ol-hall").forEach((el) => {
    const c = el.querySelector("circle");
    if (!c) return;
    const p = P(attr(c, "cx") + 50, attr(c, "cy"));
    const tone = toneOf(el);
    const hall = new THREE.Mesh(new THREE.BoxGeometry(110, 22, 24), new THREE.MeshStandardMaterial({
      color: "#25303d", roughness: 0.6,
      emissive: new THREE.Color(TONE[tone] || TONE.live), emissiveIntensity: tone === "live" ? 0.12 : (tone === "future" ? 0.02 : 0.4),
      transparent: tone === "future", opacity: tone === "future" ? 0.4 : 1,
    }));
    hall.position.set(p.x, 11, p.z);
    const t = texts(el);
    hall.userData = { el, label: t.main + (t.sub ? " · " + t.sub : "") };
    g.world.add(hall);
    g.hits.push(hall);
    if (tone === "hit" || tone === "failed") g.pulses.push(hall.material as THREE.MeshStandardMaterial);
    const tag = label(t.main, t.sub);
    tag.position.set(p.x + 100, 18, p.z);
    g.world.add(tag);
  });
  // The battery hit areas are their own controls in the SVG.
  svg.querySelectorAll('g[data-act="ol-pick"]:not(.ol-node):not(.ol-hall)').forEach((el) => {
    const r = el.querySelector("rect");
    if (!r) return;
    const p = P(attr(r, "x") + attr(r, "width") / 2, attr(r, "y") + attr(r, "height") / 2);
    const zone = new THREE.Mesh(new THREE.BoxGeometry(attr(r, "width"), 30, attr(r, "height")), new THREE.MeshBasicMaterial({ visible: false }));
    zone.position.set(p.x, 15, p.z);
    zone.userData = { el, label: el.getAttribute("aria-label") || "" };
    g.world.add(zone);
    g.hits.push(zone);
  });

  const pos = new Float32Array(g.sparks.length * 3);
  const col = new Float32Array(g.sparks.length * 3);
  g.sparks.forEach((s, i) => {
    const c = new THREE.Color(TONE[g.segs[s.seg].tone]);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 10, vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
  g.world.add(g.points);
  placeSparks(g);
  return Math.max(vb[2], vb[3]);
}

function placeSparks(g: OnelineGl) {
  if (!g.points) return;
  const pos = g.points.geometry.getAttribute("position") as THREE.BufferAttribute;
  g.sparks.forEach((s, i) => {
    const seg = g.segs[s.seg];
    pos.setXYZ(i, seg.ax + (seg.bx - seg.ax) * s.t, 7, seg.az + (seg.bz - seg.az) * s.t);
  });
  pos.needsUpdate = true;
}

function loop(g: OnelineGl) {
  g.frame = requestAnimationFrame(() => loop(g));
  g.tick += 1;
  if (!calm()) {
    const t = g.tick / 60;
    g.pulses.forEach((m) => { m.emissiveIntensity = 0.25 + 0.6 * Math.abs(Math.sin(t * 3)); });
    g.sparks.forEach((s) => {
      const seg = g.segs[s.seg];
      // Speed in board units, so long and short conductors carry the same current speed.
      const len = Math.max(1, Math.hypot(seg.bx - seg.ax, seg.bz - seg.az));
      s.t += (FLOWS[seg.tone] || 0) * 45 / len * 6;
      if (s.t > 1) s.t -= 1;
    });
    placeSparks(g);
  }
  g.controls.update();
  g.renderer.render(g.scene, g.camera);
}

function pick(g: OnelineGl, event: MouseEvent, open: boolean) {
  const rect = g.renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(mouse, g.camera);
  const hit = ray.intersectObjects(g.hits, false)[0];
  const data = hit ? hit.object.userData : null;
  g.renderer.domElement.style.cursor = data ? "pointer" : "grab";
  if (g.tip) {
    g.tip.hidden = !data;
    if (data) {
      g.tip.textContent = data.label;
      g.tip.style.left = event.clientX - rect.left + 12 + "px";
      g.tip.style.top = event.clientY - rect.top + 12 + "px";
    }
  }
  // SVG elements have no click(); dispatch the same bubbling click the app listens for.
  if (open && data && data.el && data.el.isConnected) data.el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function stop() {
  if (!og) return;
  cancelAnimationFrame(og.frame);
  og.frame = 0;
  if (og.observer) og.observer.disconnect();
  og.observer = null;
  og.renderer.domElement.remove();
  og.host = null;
}

export function syncOnelineGl() {
  const host = document.getElementById("oneline-gl-host");
  if (!host) return stop();
  const svg = host.querySelector(".gl-source svg") as SVGSVGElement | null;
  if (!og) og = create();
  if (!og || !svg) {
    host.setAttribute("data-onelinegl", "unsupported");
    if (!host.querySelector(".floor3d-note")) {
      const note = document.createElement("p");
      note.className = "floor3d-note";
      note.textContent = "This browser cannot draw the experimental 3D one-line (WebGL is off). Turn Experimental off to see the standard diagram.";
      host.appendChild(note);
    }
    return;
  }
  const g = og;
  const source = svg.outerHTML;
  let h = 0;
  for (let i = 0; i < source.length; i += 1) h = (h * 31 + source.charCodeAt(i)) | 0;
  const key = source.length + ":" + h;
  if (key !== g.key) {
    const span = build(g, svg);
    if (!g.framed) {
      g.camera.position.set(-span * 0.12, span * 0.62, span * 0.62);
      g.controls.target.set(0, 0, 0);
      g.controls.update();
      g.framed = true;
    }
    g.key = key;
  }
  g.host = host;
  if (g.renderer.domElement.parentElement !== host) {
    host.appendChild(g.renderer.domElement);
    const tip = document.createElement("div");
    tip.className = "floor3d-tip";
    tip.hidden = true;
    host.appendChild(tip);
    g.tip = tip;
  }
  const fit = () => {
    const w = Math.max(1, host.clientWidth);
    const hh = Math.max(1, host.clientHeight);
    g.renderer.setSize(w, hh, false);
    g.camera.aspect = w / hh;
    g.camera.updateProjectionMatrix();
  };
  fit();
  if (g.observer) g.observer.disconnect();
  g.observer = new ResizeObserver(fit);
  g.observer.observe(host);
  host.setAttribute("data-onelinegl", "ready");
  host.setAttribute("data-nodes", String(g.hits.length));
  host.setAttribute("data-segments", String(g.segs.length));
  if (!g.frame) loop(g);
}
