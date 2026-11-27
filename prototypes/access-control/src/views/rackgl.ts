import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { entityById, entityScore } from "../data/pods";
import { CAB_D, CAB_W, DEV_D, DEV_W, RACK_U, U_PX, rackAngles, rackModel } from "./rack3d";

/* Experimental: the rack view drawn with three.js. It reads the same model as the CSS
   rack (rackModel in rack3d.ts), so Operate › Rack and the rack opened from the floor
   stay one view. Devices sit at their U with status LEDs, the rack PDU shows each
   socket's state, and air moves front to rear through every powered device. Clicking a
   device or a lit socket does exactly what the same control does in the CSS rack. */

type Glow = { mat: THREE.MeshStandardMaterial; mode: string };
type Flow = { x: number; y: number; z: number; speed: number; hot: number };

type RackGl = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  world: THREE.Group;
  hits: THREE.Object3D[];
  glows: Glow[];
  flows: Flow[];
  points: THREE.Points | null;
  key: string;
  preset: string;
  frame: number;
  tick: number;
  observer: ResizeObserver | null;
  tip: HTMLElement | null;
  host: HTMLElement | null;
};

let gl: RackGl | null = null;
let failed = false;

const H = RACK_U * U_PX;
const COLD = new THREE.Color("#4fb3ff");
const HOT = new THREE.Color("#ff7a3d");
const SOCKET = { on: "#3ddc97", off: "#5a5f66", cycling: "#f2b233", locked: "#ff4d4d", idle: "#2c3138" };
const UNIT_BODY = { gpu: "#3a424f", net: "#2c4a66", shelf: "#54493a", srv: "#3d4450" };

function calm() {
  return !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function create(): RackGl | null {
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
  renderer.domElement.setAttribute("data-rackgl", "canvas");
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0d1117");
  const camera = new THREE.PerspectiveCamera(38, 1, 5, 6000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 260;
  controls.maxDistance = 1600;
  controls.target.set(0, H / 2, 0);
  scene.add(new THREE.HemisphereLight("#b8c8ff", "#1a1206", 1.0));
  const key = new THREE.DirectionalLight("#ffffff", 1.2);
  key.position.set(400, 700, 600);
  scene.add(key);
  const world = new THREE.Group();
  scene.add(world);
  const made: RackGl = { renderer, scene, camera, controls, world, hits: [], glows: [], flows: [], points: null, key: "", preset: "", frame: 0, tick: 0, observer: null, tip: null, host: null };
  renderer.domElement.addEventListener("click", (event) => pick(made, event, true));
  renderer.domElement.addEventListener("pointermove", (event) => pick(made, event, false));
  return made;
}

function clear(group: THREE.Group) {
  group.traverse((obj: any) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
  });
  group.clear();
}

// CSS rack coordinates (y down from the top of the cabinet) to three.js (y up, centered).
function yOf(topPx: number, heightPx: number) {
  return H - topPx - heightPx / 2;
}

function build(g: RackGl, model) {
  clear(g.world);
  g.hits = [];
  g.glows = [];
  g.flows = [];
  g.points = null;
  const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(CAB_W, H, CAB_D)), new THREE.LineBasicMaterial({ color: "#8a96a8" }));
  frame.position.y = H / 2;
  g.world.add(frame);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(CAB_W, H, CAB_D),
    new THREE.MeshStandardMaterial({ color: "#5d6b80", transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }));
  glass.position.y = H / 2;
  g.world.add(glass);
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(CAB_W + 40, 6, CAB_D + 40), new THREE.MeshStandardMaterial({ color: "#1c232c" }));
  plinth.position.y = -3;
  g.world.add(plinth);
  model.units.forEach((unit) => {
    const h = unit.units * U_PX - 1;
    const top = (RACK_U - (unit.u + unit.units - 1)) * U_PX;
    const body = new THREE.Mesh(new THREE.BoxGeometry(DEV_W, h, DEV_D), new THREE.MeshStandardMaterial({
      color: UNIT_BODY[unit.klass] || UNIT_BODY.srv, roughness: 0.5, metalness: 0.4,
      emissive: unit.on ? new THREE.Color("#3b82f6") : new THREE.Color("#000"), emissiveIntensity: unit.on ? 0.35 : 0,
    }));
    body.position.set(0, yOf(top, h), 0);
    body.userData = { act: unit.act, label: unit.aria || unit.label };
    g.world.add(body);
    if (unit.act && unit.act !== "disabled") g.hits.push(body);
    const led = new THREE.MeshStandardMaterial({ color: "#111", emissive: new THREE.Color(unit.dark ? "#000" : (unit.led || "#3ddc97")), emissiveIntensity: unit.dark ? 0 : 1.4 });
    const dot = new THREE.Mesh(new THREE.BoxGeometry(14, Math.min(6, h - 2), 1.5), led);
    dot.position.set(DEV_W / 2 - 12, 0, DEV_D / 2 + 0.6);
    body.add(dot);
    const nominal = !unit.led || /c8c4bc/i.test(unit.led);
    g.glows.push({ mat: led, mode: unit.dark ? "off" : (nominal ? "steady" : "alarm") });
    if (!unit.dark) {
      const entity = entityById(unit.id);
      const heat = entity ? Math.max(0, Math.min(1, (entityScore(entity) - 30) / 65)) : 0.3;
      const n = (6 + Math.round(heat * 14)) * unit.units;
      for (let i = 0; i < n; i += 1) {
        g.flows.push({ x: (Math.random() - 0.5) * DEV_W * 0.85, y: yOf(top, h) + (Math.random() - 0.5) * h * 0.7, z: -DEV_D / 2 - 90 + Math.random() * (DEV_D + 160), speed: 0.8 + heat * 2.2, hot: heat });
      }
    }
  });
  model.pdus.forEach((pdu) => {
    const ph = H - 20;
    const x = pdu.side === "left" ? -CAB_W / 2 + 10 : CAB_W / 2 - 10;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(16, ph, 16), new THREE.MeshStandardMaterial({ color: "#151a21", roughness: 0.7 }));
    strip.position.set(x, H / 2, -CAB_D / 2 + 20);
    g.world.add(strip);
    const pitch = (ph - 30) / Math.max(1, pdu.sockets.length);
    pdu.sockets.forEach((socket, i) => {
      const mat = new THREE.MeshStandardMaterial({ color: "#111", emissive: new THREE.Color(SOCKET[socket.state] || SOCKET.idle), emissiveIntensity: socket.state === "idle" ? 0.3 : 1.2 });
      const plug = new THREE.Mesh(new THREE.BoxGeometry(10, Math.max(4, pitch * 0.6), 2), mat);
      plug.position.set(0, ph / 2 - 20 - i * pitch, -9);
      plug.userData = { act: socket.act ? socket.act + ' data-outlet="' + socket.n + '"' : "", label: socket.title };
      strip.add(plug);
      if (socket.act) g.hits.push(plug);
      if (socket.state === "cycling" || socket.state === "locked") g.glows.push({ mat, mode: socket.state });
    });
  });
  const pos = new Float32Array(g.flows.length * 3);
  const col = new Float32Array(g.flows.length * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 7, vertexColors: true, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
  g.world.add(g.points);
  writeFlows(g);
}

function writeFlows(g: RackGl) {
  if (!g.points) return;
  const pos = g.points.geometry.getAttribute("position") as THREE.BufferAttribute;
  const col = g.points.geometry.getAttribute("color") as THREE.BufferAttribute;
  const c = new THREE.Color();
  g.flows.forEach((f, i) => {
    pos.setXYZ(i, f.x, f.y, f.z);
    // Cold at the front door, warming as it passes through to the rear.
    const t = Math.max(0, Math.min(1, (DEV_D / 2 - f.z) / DEV_D)) * (0.35 + 0.65 * f.hot);
    c.copy(COLD).lerp(HOT, t);
    col.setXYZ(i, c.r, c.g, c.b);
  });
  pos.needsUpdate = true;
  col.needsUpdate = true;
}

function animate(g: RackGl) {
  const still = calm();
  const t = g.tick / 60;
  g.glows.forEach((glow) => {
    if (still || glow.mode === "steady" || glow.mode === "off") return;
    const rate = glow.mode === "locked" ? 5 : (glow.mode === "cycling" ? 8 : 3);
    glow.mat.emissiveIntensity = 0.4 + 1.2 * Math.abs(Math.sin(t * rate));
  });
  if (still) return;
  g.flows.forEach((f) => {
    f.z -= f.speed;
    // In at the front door, out the rear: the air shows on both sides of each device.
    if (f.z < -DEV_D / 2 - 90) f.z = DEV_D / 2 + 70;
  });
  writeFlows(g);
}

function aim(g: RackGl) {
  const { yaw, pitch } = rackAngles();
  const r = 900;
  const az = (-yaw * Math.PI) / 180;
  const el = (-pitch * Math.PI) / 180;
  g.camera.position.set(r * Math.sin(az) * Math.cos(el), H / 2 + r * Math.sin(el), r * Math.cos(az) * Math.cos(el));
  g.controls.target.set(0, H / 2, 0);
  g.controls.update();
}

function loop(g: RackGl) {
  g.frame = requestAnimationFrame(() => loop(g));
  g.tick += 1;
  animate(g);
  g.controls.update();
  g.renderer.render(g.scene, g.camera);
}

function pick(g: RackGl, event: MouseEvent, open: boolean) {
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
  if (open && data && data.act) activate(g, data.act);
}

/* Hand the click to the app's own delegated handler, through a control with the same
   data-act attributes the CSS rack uses. Outlet changes still go to Control, with its
   role, interlock, and confirmation checks. */
export function activate(g: RackGl | null, act: string) {
  const host = (g && g.host) || document.getElementById("rack3d-host");
  if (!host) return;
  const holder = document.createElement("div");
  holder.innerHTML = "<button type=\"button\" " + act + "></button>";
  const button = holder.firstElementChild as HTMLButtonElement;
  button.hidden = true;
  host.appendChild(button);
  button.click();
  button.remove();
}

function stop() {
  if (!gl) return;
  cancelAnimationFrame(gl.frame);
  gl.frame = 0;
  if (gl.observer) gl.observer.disconnect();
  gl.observer = null;
  gl.renderer.domElement.remove();
  gl.host = null;
}

/* Called after every paint. Moves the one canvas into the current host, or parks it. */
export function syncRackGl() {
  const host = document.getElementById("rack3d-host");
  if (!host) return stop();
  if (!gl) gl = create();
  if (!gl) {
    host.setAttribute("data-rackgl", "unsupported");
    host.innerHTML = '<p class="floor3d-note">This browser cannot draw the experimental 3D rack (WebGL is off). Turn Experimental off to return to the rack.</p>';
    return;
  }
  const model = rackModel(host.dataset.rack || "A14", host.dataset.ctx || "floor");
  const key = JSON.stringify(model);
  if (key !== gl.key) {
    build(gl, model);
    gl.key = key;
  }
  const preset = rackAngles();
  const presetKey = preset.id + ":" + preset.yaw + ":" + preset.pitch;
  if (presetKey !== gl.preset) {
    aim(gl);
    gl.preset = presetKey;
  }
  gl.host = host;
  if (gl.renderer.domElement.parentElement !== host) {
    host.appendChild(gl.renderer.domElement);
    const tip = document.createElement("div");
    tip.className = "floor3d-tip";
    tip.hidden = true;
    host.appendChild(tip);
    gl.tip = tip;
  }
  const fit = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    gl.renderer.setSize(w, h, false);
    gl.camera.aspect = w / h;
    gl.camera.updateProjectionMatrix();
  };
  fit();
  if (gl.observer) gl.observer.disconnect();
  gl.observer = new ResizeObserver(fit);
  gl.observer.observe(host);
  host.setAttribute("data-rackgl", "ready");
  host.setAttribute("data-units", String(model.units.length));
  host.setAttribute("data-sockets", String(model.pdus.reduce((n, pdu) => n + pdu.sockets.length, 0)));
  if (!gl.frame) loop(gl);
}
