import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PODS, podById, rackEntities } from "../data/pods";
import { state } from "../state";
import { heatCloudModel, listTone, openRack } from "./floor";

/* Experimental: the hall floor drawn with three.js. It reads the same racks, aisles,
   CDUs, and heat clouds as the CSS floor (views/floor.ts) and adds motion: heat rising
   off the hot aisle, cold air pooling at the inlets, and alarmed racks pulsing.
   Loaded on demand, so the main floor never pays for three.js. */

type Scene3d = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  world: THREE.Group;
  racks: { mesh: THREE.Mesh; strip: THREE.MeshStandardMaterial; podId: string; rackId: string; servers: string[] }[];
  points: THREE.Points | null;
  seeds: { x: number; y: number; r: number; top: number; hot: boolean; speed: number }[];
  podId: string;
  frame: number;
  tick: number;
  observer: ResizeObserver | null;
  tip: HTMLElement | null;
};

let s3: Scene3d | null = null;
let failed = false;

const HOT = new THREE.Color("#ff7a3d");
const COLD = new THREE.Color("#4fb3ff");
const NOMINAL = new THREE.Color("#3ddc97");

function calm() {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function create(): Scene3d | null {
  if (failed) return null;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
  } catch (err) {
    failed = true;
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.className = "floor3d-canvas";
  renderer.domElement.setAttribute("data-floor3d", "canvas");
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0d1117");
  scene.fog = new THREE.Fog("#0d1117", 1800, 4200);
  const camera = new THREE.PerspectiveCamera(42, 1, 5, 8000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 200;
  controls.maxDistance = 3200;
  controls.autoRotate = !calm();
  controls.autoRotateSpeed = 0.35;
  scene.add(new THREE.HemisphereLight("#9fb8ff", "#1a1206", 0.9));
  const sun = new THREE.DirectionalLight("#ffffff", 1.1);
  sun.position.set(600, 1200, 400);
  scene.add(sun);
  const world = new THREE.Group();
  scene.add(world);
  const made: Scene3d = { renderer, scene, camera, controls, world, racks: [], points: null, seeds: [], podId: "", frame: 0, tick: 0, observer: null, tip: null };
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

function build(s: Scene3d, pod) {
  clear(s.world);
  s.racks = [];
  s.points = null;
  s.podId = pod.id;
  const cx = pod.w / 2;
  const cz = pod.h / 2;
  // Floor coordinates: x right, y (floor plan) becomes z, height is y.
  const at = (x: number, y: number) => new THREE.Vector3(x - cx, 0, y - cz);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(pod.w, 8, pod.h), new THREE.MeshStandardMaterial({ color: "#1c232c", roughness: 0.9 }));
  slab.position.y = -4;
  s.world.add(slab);
  const grid = new THREE.GridHelper(Math.max(pod.w, pod.h), 24, "#2c3846", "#212a35");
  grid.position.y = 0.5;
  s.world.add(grid);
  const fit = pod.fit || {};
  (fit.aisles || []).forEach((aisle) => {
    const tone = aisle.tone === "cold" ? COLD : HOT;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(aisle.w, aisle.h),
      new THREE.MeshBasicMaterial({ color: tone, transparent: true, opacity: 0.16, depthWrite: false }));
    plane.rotation.x = -Math.PI / 2;
    plane.position.copy(at(aisle.x + aisle.w / 2, aisle.y + aisle.h / 2)).setY(1);
    s.world.add(plane);
  });
  if (fit.containment) {
    const c = fit.containment;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(c.w, c.h || 160, c.d),
      new THREE.MeshStandardMaterial({ color: "#ffb08a", transparent: true, opacity: 0.07, depthWrite: false }));
    glass.position.copy(at(c.x + c.w / 2, c.y + c.d / 2)).setY((c.h || 160) / 2);
    s.world.add(glass);
  }
  (pod.racks || []).forEach((rack) => {
    const h = rack.h || 120;
    const body = new THREE.Mesh(new THREE.BoxGeometry(rack.w, h, rack.d), new THREE.MeshStandardMaterial({ color: "#2a2f36", roughness: 0.55, metalness: 0.35 }));
    body.position.copy(at(rack.x + rack.w / 2, rack.y + rack.d / 2)).setY(h / 2);
    const strip = new THREE.MeshStandardMaterial({ color: "#111", emissive: NOMINAL.clone(), emissiveIntensity: 0.8 });
    const face = new THREE.Mesh(new THREE.BoxGeometry(rack.w * 0.8, h * 0.82, 1.5), strip);
    const south = (rack.row || "").slice(-1) === "s";
    face.position.set(0, 0, (south ? 1 : -1) * (rack.d / 2 + 0.8));
    body.add(face);
    body.userData = { podId: pod.id, rackId: rack.id };
    s.world.add(body);
    s.racks.push({ mesh: body, strip, podId: pod.id, rackId: rack.id, servers: rack.servers || [] });
  });
  (pod.boxes || []).forEach((box) => {
    const h = box.h || 90;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(box.w || 48, h, box.d || 48), new THREE.MeshStandardMaterial({ color: "#2d4a5e", roughness: 0.6 }));
    mesh.position.copy(at(box.x + (box.w || 48) / 2, box.y + (box.d || 48) / 2)).setY(h / 2);
    s.world.add(mesh);
  });
  seedAir(s, pod);
  const span = Math.max(pod.w, pod.h);
  s.camera.position.set(span * 0.55, span * 0.6, span * 0.75);
  s.controls.target.set(0, 40, 0);
  s.controls.update();
}

function seedAir(s: Scene3d, pod) {
  if (s.points) {
    s.world.remove(s.points);
    s.points.geometry.dispose();
    (s.points.material as THREE.Material).dispose();
  }
  const clouds = heatCloudModel(pod);
  s.seeds = [];
  clouds.forEach((cloud) => {
    const n = Math.round(8 + 40 * cloud.strength);
    for (let i = 0; i < n; i += 1) {
      s.seeds.push({ x: cloud.x - pod.w / 2, y: cloud.y - pod.h / 2, r: cloud.r, top: cloud.kind === "hot" ? 160 + 140 * cloud.strength : 70, hot: cloud.kind === "hot", speed: 0.4 + Math.random() * (0.6 + cloud.strength) });
    }
  });
  const pos = new Float32Array(s.seeds.length * 3);
  const col = new Float32Array(s.seeds.length * 3);
  s.seeds.forEach((seed, i) => {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * seed.r * 0.6;
    pos[i * 3] = seed.x + Math.cos(a) * d;
    pos[i * 3 + 1] = Math.random() * seed.top;
    pos[i * 3 + 2] = seed.y + Math.sin(a) * d;
    const c = seed.hot ? HOT : COLD;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 9, vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  s.points = new THREE.Points(geo, mat);
  s.world.add(s.points);
}

function paintRacks(s: Scene3d, t: number) {
  s.racks.forEach((item) => {
    const tone = listTone(rackEntities({ servers: item.servers }));
    const color = tone.pri ? new THREE.Color(tone.color) : NOMINAL;
    item.strip.emissive.copy(color);
    // Alarmed racks breathe; priority 1 breathes fastest.
    item.strip.emissiveIntensity = tone.pri && !calm() ? 0.7 + 0.6 * Math.abs(Math.sin(t * (tone.pri === 1 ? 4 : 2))) : 0.8;
    item.mesh.userData.word = tone.word;
  });
}

function drift(s: Scene3d) {
  if (!s.points || calm()) return;
  const pos = s.points.geometry.getAttribute("position") as THREE.BufferAttribute;
  const arr = pos.array as Float32Array;
  s.seeds.forEach((seed, i) => {
    const k = i * 3;
    if (seed.hot) {
      arr[k + 1] += seed.speed;
      arr[k] += (Math.random() - 0.5) * 0.6;
      if (arr[k + 1] > seed.top) arr[k + 1] = 4;
    } else {
      arr[k + 1] -= seed.speed * 0.5;
      if (arr[k + 1] < 2) arr[k + 1] = seed.top;
    }
  });
  pos.needsUpdate = true;
}

function loop(s: Scene3d) {
  s.frame = requestAnimationFrame(() => loop(s));
  s.tick += 1;
  const pod = podById(s.podId);
  // Telemetry and Simulate change the readings; refresh the air every two seconds.
  if (pod && s.tick % 120 === 0) seedAir(s, pod);
  paintRacks(s, s.tick / 60);
  drift(s);
  s.controls.update();
  s.renderer.render(s.scene, s.camera);
}

function pick(s: Scene3d, event: MouseEvent, open: boolean) {
  const rect = s.renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(mouse, s.camera);
  const hit = ray.intersectObjects(s.racks.map((item) => item.mesh), false)[0];
  const data = hit ? hit.object.userData : null;
  s.renderer.domElement.style.cursor = data ? "pointer" : "grab";
  if (s.tip) {
    s.tip.hidden = !data;
    if (data) {
      s.tip.textContent = "Rack " + data.rackId + " · " + (data.word || "Nominal");
      s.tip.style.left = event.clientX - rect.left + 12 + "px";
      s.tip.style.top = event.clientY - rect.top + 12 + "px";
    }
  }
  if (open && data) openRack(data.podId, data.rackId);
}

function stop() {
  if (!s3) return;
  cancelAnimationFrame(s3.frame);
  s3.frame = 0;
  if (s3.observer) s3.observer.disconnect();
  s3.observer = null;
  s3.renderer.domElement.remove();
}

/* Called after every paint. Moves the one canvas into the current host, or parks it. */
export function syncFloor3d() {
  const host = document.getElementById("floor3d-host");
  if (!host) return stop();
  if (!s3) s3 = create();
  if (!s3) {
    host.setAttribute("data-floor3d", "unsupported");
    host.innerHTML = '<p class="floor3d-note">This browser cannot draw the experimental 3D view (WebGL is off). Turn Experimental off to return to the floor.</p>';
    return;
  }
  const pod = podById(state.floor.podId) || PODS[0];
  if (!pod) return;
  if (s3.podId !== pod.id) build(s3, pod);
  if (s3.renderer.domElement.parentElement !== host) {
    host.appendChild(s3.renderer.domElement);
    let tip = host.querySelector(".floor3d-tip") as HTMLElement | null;
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "floor3d-tip";
      tip.hidden = true;
      host.appendChild(tip);
    }
    s3.tip = tip;
  }
  const fit = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    s3.renderer.setSize(w, h, false);
    s3.camera.aspect = w / h;
    s3.camera.updateProjectionMatrix();
  };
  fit();
  if (s3.observer) s3.observer.disconnect();
  s3.observer = new ResizeObserver(fit);
  s3.observer.observe(host);
  host.setAttribute("data-floor3d", "ready");
  host.setAttribute("data-racks", String(s3.racks.length));
  if (!s3.frame) loop(s3);
}
