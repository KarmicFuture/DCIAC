import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/* Experimental: any CSS 3D world drawn with three.js. Used for Floor › Outside and the
   Plan build scene. The CSS world is still rendered, hidden, inside the host: its
   rackboxes, feeds and pipes carry their geometry in CSS variables (--x, --y, --w, --d,
   --h, --len, --ang) and their behavior in data-act. This module reads those, so the 3D
   scene can never drift from the standard one, and a click on a 3D object clicks the
   very element the standard scene would have. */

type Line = { ax: number; az: number; bx: number; bz: number; y: number; color: THREE.Color; speed: number; failed: boolean };
type Spark = { line: number; t: number };

type WorldGl = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  world: THREE.Group;
  hits: THREE.Object3D[];
  fans: THREE.Object3D[];
  pulses: { mat: THREE.MeshStandardMaterial; base: number }[];
  lines: Line[];
  sparks: Spark[];
  points: THREE.Points | null;
  key: string;
  kind: string;
  frame: number;
  tick: number;
  observer: ResizeObserver | null;
  tip: HTMLElement | null;
  host: HTMLElement | null;
};

let gw: WorldGl | null = null;
let failed = false;

const FEED = new THREE.Color("#ffd166");
const SUPPLY = new THREE.Color("#4fb3ff");
const RETURN = new THREE.Color("#ff7a3d");
const FAIL = new THREE.Color("#ff3b3b");

function calm() {
  return !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function num(el: HTMLElement, name: string) {
  return parseFloat(el.style.getPropertyValue(name)) || 0;
}

function create(): WorldGl | null {
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
  renderer.domElement.setAttribute("data-worldgl", "canvas");
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0d1117");
  scene.fog = new THREE.Fog("#0d1117", 2600, 6000);
  const camera = new THREE.PerspectiveCamera(40, 1, 5, 9000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.minDistance = 250;
  controls.maxDistance = 4500;
  controls.autoRotate = !calm();
  controls.autoRotateSpeed = 0.25;
  scene.add(new THREE.HemisphereLight("#a9c1ff", "#1a1206", 0.95));
  const sun = new THREE.DirectionalLight("#fff4e0", 1.15);
  sun.position.set(-800, 1400, 900);
  scene.add(sun);
  const world = new THREE.Group();
  scene.add(world);
  const made: WorldGl = { renderer, scene, camera, controls, world, hits: [], fans: [], pulses: [], lines: [], sparks: [], points: null, key: "", kind: "", frame: 0, tick: 0, observer: null, tip: null, host: null };
  renderer.domElement.addEventListener("click", (event) => pick(made, event, true));
  renderer.domElement.addEventListener("pointermove", (event) => pick(made, event, false));
  renderer.domElement.addEventListener("pointerdown", () => { controls.autoRotate = false; });
  return made;
}

function clear(group: THREE.Group) {
  group.traverse((obj: any) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
  });
  group.clear();
}

// Offset of an element's containing .pod, if any, so nested boxes land in world space.
function podOffset(el: HTMLElement) {
  const pod = el.parentElement && (el.parentElement.closest(".pod") as HTMLElement | null);
  return pod ? { x: num(pod, "--x"), y: num(pod, "--y") } : { x: 0, y: 0 };
}

function boxColor(el: HTMLElement) {
  const raw = el.style.getPropertyValue("--heat").trim();
  const c = new THREE.Color();
  try { c.set(raw || "#8892a0"); } catch (err) { c.set("#8892a0"); }
  // The standard scene is drawn on a light floor; lift dark gear so it reads at night.
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  if (hsl.l < 0.22) c.setHSL(hsl.h, hsl.s, 0.22);
  return c;
}

function build(g: WorldGl, source: HTMLElement) {
  clear(g.world);
  g.hits = [];
  g.fans = [];
  g.pulses = [];
  g.lines = [];
  g.sparks = [];
  g.points = null;
  const boxes = Array.from(source.querySelectorAll(".rackbox")) as HTMLElement[];
  const feeds = Array.from(source.querySelectorAll(".feed, .pipe")) as HTMLElement[];
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  const grow = (x: number, z: number) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); };
  boxes.forEach((el) => { const o = podOffset(el); grow(o.x + num(el, "--x"), o.y + num(el, "--y")); grow(o.x + num(el, "--x") + num(el, "--w"), o.y + num(el, "--y") + num(el, "--d")); });
  feeds.forEach((el) => {
    const x = num(el, "--x"), y = num(el, "--y"), len = num(el, "--len"), ang = (num(el, "--ang") * Math.PI) / 180;
    grow(x, y);
    grow(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
  });
  if (!isFinite(minX)) { minX = 0; maxX = 1000; minZ = 0; maxZ = 800; }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const span = Math.max(maxX - minX, maxZ - minZ, 400);
  const grass = !!source.querySelector(".grass-slab");
  const ground = new THREE.Mesh(new THREE.BoxGeometry(span * 1.3, 6, span * 1.3), new THREE.MeshStandardMaterial({ color: grass ? "#1f3324" : "#1c232c", roughness: 0.95 }));
  ground.position.y = -3;
  g.world.add(ground);
  const grid = new THREE.GridHelper(span * 1.3, 30, "#2c3846", "#212a35");
  grid.position.y = 0.5;
  g.world.add(grid);
  const simActive = source.classList.contains("sim-active");
  boxes.forEach((el) => {
    const o = podOffset(el);
    const w = Math.max(4, num(el, "--w"));
    const d = Math.max(4, num(el, "--d"));
    const h = Math.max(4, num(el, "--h"));
    const x = o.x + num(el, "--x") + w / 2 - cx;
    const z = o.y + num(el, "--y") + d / 2 - cz;
    const cls = el.className;
    const hit = / sim-hit/.test(" " + cls);
    const dim = simActive && / sim-dim/.test(" " + cls);
    const planned = !!el.dataset.plan || /\bplanned\b|\bpad\b|\bshell\b/.test(cls);
    const mat = new THREE.MeshStandardMaterial({
      color: boxColor(el), roughness: 0.6, metalness: 0.15,
      transparent: planned || dim, opacity: planned ? 0.55 : (dim ? 0.35 : 1),
      emissive: hit ? FAIL.clone() : new THREE.Color("#000"), emissiveIntensity: hit ? 0.6 : 0,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, h / 2, z);
    mesh.userData = { el, label: el.getAttribute("aria-label") || "" };
    g.world.add(mesh);
    if (el.dataset.act && el.dataset.act !== "build-quiet") g.hits.push(mesh);
    if (hit || /\bis-pulse\b/.test(cls)) g.pulses.push({ mat, base: 0.6 });
    if (/\bbuilding\b/.test(cls) && !/\bshell\b/.test(cls)) {
      // Lit windows along the long sides: the hall is running.
      const band = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, Math.max(2, h * 0.12), d + 1),
        new THREE.MeshStandardMaterial({ color: "#111", emissive: new THREE.Color(hit ? "#ff6b6b" : "#ffd98a"), emissiveIntensity: 0.9 }));
      band.position.y = h * 0.15;
      mesh.add(band);
    }
    if (/cooler-yard|heat-yard/.test(cls)) {
      const fans = Math.max(1, Math.min(6, Math.round(w / 40)));
      for (let i = 0; i < fans; i += 1) {
        const fan = new THREE.Group();
        const r = Math.min(w / fans, d) * 0.35;
        for (let b = 0; b < 3; b += 1) {
          const blade = new THREE.Mesh(new THREE.BoxGeometry(r * 2, 1.5, r * 0.35), new THREE.MeshStandardMaterial({ color: "#c9d4e0", metalness: 0.5, roughness: 0.4 }));
          blade.rotation.y = (b * Math.PI) / 3;
          fan.add(blade);
        }
        fan.position.set(-w / 2 + (w / fans) * (i + 0.5), h / 2 + 2, 0);
        mesh.add(fan);
        g.fans.push(fan);
      }
    }
  });
  feeds.forEach((el) => {
    const x = num(el, "--x"), y = num(el, "--y"), len = num(el, "--len"), ang = (num(el, "--ang") * Math.PI) / 180;
    const pipe = el.classList.contains("pipe");
    const bad = el.classList.contains("failed");
    const ret = el.classList.contains("return");
    const color = bad ? FAIL : (pipe ? (ret ? RETURN : SUPPLY) : FEED);
    const line: Line = {
      ax: x - cx, az: y - cz,
      bx: x + Math.cos(ang) * len - cx, bz: y + Math.sin(ang) * len - cz,
      y: pipe ? (ret ? 10 : 6) : 3, color, speed: pipe ? 0.004 : 0.009, failed: bad,
    };
    g.lines.push(line);
    const thick = pipe ? 5 : 3;
    const tube = new THREE.Mesh(new THREE.BoxGeometry(Math.max(2, len), thick, thick),
      new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.45), emissive: color.clone(), emissiveIntensity: bad ? 0.9 : 0.25 }));
    tube.position.set((line.ax + line.bx) / 2, line.y, (line.az + line.bz) / 2);
    tube.rotation.y = -ang;
    g.world.add(tube);
    if (bad) return;
    const n = Math.max(1, Math.round(len / 60));
    for (let i = 0; i < n; i += 1) g.sparks.push({ line: g.lines.length - 1, t: i / n + Math.random() * (0.5 / n) });
  });
  const pos = new Float32Array(g.sparks.length * 3);
  const col = new Float32Array(g.sparks.length * 3);
  g.sparks.forEach((s, i) => { const c = g.lines[s.line].color; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 11, vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
  g.world.add(g.points);
  placeSparks(g);
  return span;
}

function placeSparks(g: WorldGl) {
  if (!g.points) return;
  const pos = g.points.geometry.getAttribute("position") as THREE.BufferAttribute;
  g.sparks.forEach((s, i) => {
    const l = g.lines[s.line];
    pos.setXYZ(i, l.ax + (l.bx - l.ax) * s.t, l.y + 3, l.az + (l.bz - l.az) * s.t);
  });
  pos.needsUpdate = true;
}

function animate(g: WorldGl) {
  if (calm()) return;
  const t = g.tick / 60;
  g.fans.forEach((fan) => { fan.rotation.y += 0.25; });
  g.pulses.forEach((p) => { p.mat.emissiveIntensity = p.base * (0.4 + Math.abs(Math.sin(t * 3))); });
  g.sparks.forEach((s) => {
    s.t += g.lines[s.line].speed;
    if (s.t > 1) s.t -= 1;
  });
  placeSparks(g);
}

function loop(g: WorldGl) {
  g.frame = requestAnimationFrame(() => loop(g));
  g.tick += 1;
  animate(g);
  g.controls.update();
  g.renderer.render(g.scene, g.camera);
}

function pick(g: WorldGl, event: MouseEvent, open: boolean) {
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
  // Click the hidden standard control, so drill-downs, timelines and the inspector all
  // behave exactly as in the standard scene.
  if (open && data && data.el && data.el.isConnected) data.el.click();
}

function stop() {
  if (!gw) return;
  cancelAnimationFrame(gw.frame);
  gw.frame = 0;
  if (gw.observer) gw.observer.disconnect();
  gw.observer = null;
  gw.renderer.domElement.remove();
  gw.host = null;
}

/* Called after every paint. Rebuilds when the hidden world changes. */
export function syncWorldGl() {
  const host = document.getElementById("world-gl-host");
  if (!host) return stop();
  const source = host.querySelector(".gl-source") as HTMLElement | null;
  if (!gw) gw = create();
  if (!gw || !source) {
    host.setAttribute("data-worldgl", "unsupported");
    const note = document.createElement("p");
    note.className = "floor3d-note";
    note.textContent = "This browser cannot draw the experimental 3D view (WebGL is off). Turn Experimental off to return to the standard view.";
    if (!host.querySelector(".floor3d-note")) host.appendChild(note);
    return;
  }
  const kind = host.dataset.kind || "site";
  const key = kind + "|" + source.innerHTML.length + "|" + source.className + "|" + hash(source.innerHTML);
  if (key !== gw.key) {
    const span = build(gw, source);
    if (kind !== gw.kind) {
      gw.camera.position.set(span * 0.55, span * 0.7, span * 0.9);
      gw.controls.target.set(0, 30, 0);
      gw.controls.update();
      gw.kind = kind;
    }
    gw.key = key;
  }
  gw.host = host;
  if (gw.renderer.domElement.parentElement !== host) {
    host.appendChild(gw.renderer.domElement);
    const tip = document.createElement("div");
    tip.className = "floor3d-tip";
    tip.hidden = true;
    host.appendChild(tip);
    gw.tip = tip;
  }
  const g = gw;
  const fit = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    g.renderer.setSize(w, h, false);
    g.camera.aspect = w / h;
    g.camera.updateProjectionMatrix();
  };
  fit();
  if (g.observer) g.observer.disconnect();
  g.observer = new ResizeObserver(fit);
  g.observer.observe(host);
  host.setAttribute("data-worldgl", "ready");
  host.setAttribute("data-boxes", String(g.hits.length));
  host.setAttribute("data-lines", String(g.lines.length));
  if (!g.frame) loop(g);
}

function hash(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return h;
}
