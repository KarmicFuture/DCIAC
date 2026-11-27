import { deviceById, devices } from "../data/devices";
import { deviceViewHtml } from "./deviceview";
import { rackPointerDown, rackPointerMove, rackPointerUp, rackViewHtml } from "./rack3d";
import { LIBRARY, MODELS, applyModels, catalogById, findRack, freeU, placementById } from "../data/library";
import { elevationParts, elevationPointerDown, elevationPointerMove, elevationPointerUp, loadElevation } from "./elevation";
import { powerHtml } from "./power";
import { authHeaders } from "../data/repository";
import { outlets } from "../data/outlets";
import { PLANT, PODS, YARD, deviceRackId, entityById, entityScore, heatBand, infra, isFacility, podById, rackById, rackEntities, worstBand } from "../data/pods";
import {
  breakEventsForEntity,
  breakEventsForRack,
  breakThisHtml,
  impact,
  simBarHtml,
  simStripeHtml,
} from "../domain/events";
import type { SimImpact } from "../domain/events";
import { waiting } from "../domain/failover";
import { heatPathButton } from "../domain/heat-path";
import { openSession } from "../domain/sessions";
import { runtime, state } from "../state";
import { activeAlarms } from "../ui/alarms";
import { clamp, esc } from "../ui/format";
import { render } from "../ui/schedule";
import { pills, themeButton } from "../ui/shell";
import { futureYardHtml } from "./manage";
import { catalogById } from "../data/library";
import { deviceFaces, faceplate, thermalCard, thermalReading } from "./rack";

export function updateFloorMeters() {
  document.querySelectorAll("[data-load-for]").forEach((el) => {
    const entity = entityById(el.getAttribute("data-load-for"));
    if (!entity) return;
    const score = Math.round(entityScore(entity));
    el.querySelectorAll("[data-score]").forEach((node) => { node.textContent = score + "%"; });
    const led = el.querySelector(".led");
    if (led && !el.classList.contains("blade")) {
      const color = heatColor(entityHeat(entity));
      led.style.background = color;
    }
    el.querySelectorAll("[data-part]").forEach((bar) => {
      const key = bar.getAttribute("data-part");
      bar.style.width = Math.round(entity.load[key] || 0) + "%";
    });
  });
  paintHeat();
}

export function heatColor(score) {
  if (score >= 90) return "#c45c26";
  if (score >= 75) return "#8a6a12";
  return "#c8c4bc";
}

export function conditionTone(entity) {
  if (!entity) return { color: "#c8c4bc", pri: 0, word: "Nominal" };
  if (entity.bmc === "down") return { color: "#8a3030", pri: 1, word: "BMC" };
  if (entity.rdp === "down") return { color: "#c45c26", pri: 2, word: "RDP" };
  const score = isFacility(entity) ? (entity.load ? entity.load.power : 0) : entityScore(entity);
  if (score >= 90) return { color: "#c45c26", pri: 2, word: "Hot" };
  if (score >= 75) return { color: "#8a6a12", pri: 3, word: "Rise" };
  return { color: "#c8c4bc", pri: 0, word: "Nominal" };
}

export function listTone(list) {
  let worst = { color: "#c8c4bc", pri: 0, word: "Nominal" };
  (list || []).forEach((entity) => {
    const tone = conditionTone(entity);
    if (tone.pri && (worst.pri === 0 || tone.pri < worst.pri)) worst = tone;
  });
  return worst;
}

export function entityHeat(entity) {
  if (!entity || !entity.load) return 18;
  if (entity.bmc === "down") return 98;
  if (isFacility(entity)) return entity.load.power;
  return entityScore(entity);
}

export function rackHeat(list) {
  if (!list || !list.length) return 22;
  return Math.max.apply(null, list.map(entityHeat));
}

export function missionText() {
  const hot = devices.filter((entity) => heatBand(entity) !== "ok");
  const dark = hot.filter((entity) => entity.bmc === "down");
  if (dark.length) {
    return dark[0].name + " is white-hot. Open ACS serial for " + (dark.length > 1 ? "each dark BMC" : "the catch") + ".";
  }
  if (hot.length) {
    return hot.length + " server" + (hot.length === 1 ? "" : "s") + " climbing the thermal scale. Zoom the rack and catch them on ACS.";
  }
  return "Hall is cool. Drag a piece to move it. Drag empty floor to orbit.";
}

export function cameraTransform() {
  const floor = state.floor;
  return "translate(" + floor.panX + "px," + floor.panY + "px) rotateX(" + floor.pitch +
    "deg) rotateZ(" + floor.yaw + "deg) scale(" + floor.zoom + ")";
}

export const LOD_NEAR = 1.12;

export function floorLod() {
  return state.floor.zoom >= LOD_NEAR ? "near" : "far";
}

export function applyCamera() {
  const world = document.querySelector(".world");
  if (world) {
    const stage = world.closest(".stage");
    const width = 1280;
    const height = 960;
    let fit = 1;
    if (stage && stage.clientWidth > 0 && stage.clientHeight > 0) {
      fit = Math.min((stage.clientWidth - 8) / width, (stage.clientHeight - 8) / height);
      fit = Math.max(0.12, fit);
    }
    world.style.transform = "scale(" + fit.toFixed(4) + ") " + cameraTransform();
    world.style.setProperty("--pitch", state.floor.pitch + "deg");
    world.style.setProperty("--yaw", state.floor.yaw + "deg");
    if (world.hasAttribute("data-lod") || world.querySelector(".pod")) {
      world.setAttribute("data-lod", floorLod());
    }
  }
  watchStage();
  const chassis = document.querySelector(".chassis");
  if (chassis) {
    chassis.style.transform = "rotateX(" + state.floor.chassisPitch + "deg) rotateY(" +
      state.floor.chassisYaw + "deg) scale(" + state.floor.chassisZoom + ")";
  }
}

let stageObserver = null;
let observedStage = null;

function watchStage() {
  const stage = document.querySelector(".stage");
  if (!stage) {
    observedStage = null;
    return;
  }
  if (stage === observedStage) return;
  if (!stageObserver && typeof ResizeObserver !== "undefined") {
    stageObserver = new ResizeObserver(() => applyCamera());
  }
  if (!stageObserver) return;
  if (observedStage) stageObserver.unobserve(observedStage);
  observedStage = stage;
  stageObserver.observe(stage);
}

export function paintHeat() {
  document.querySelectorAll("[data-heat-rack]").forEach((el) => {
    const pod = podById(el.getAttribute("data-pod"));
    const rack = rackById(pod, el.getAttribute("data-heat-rack"));
    const list = rack ? rackEntities(rack) : [];
    const tone = listTone(list);
    el.style.setProperty("--heat", tone.color);
    const mark = el.querySelector(".face-pri");
    if (mark) mark.textContent = tone.pri ? String(tone.pri) : "";
    el.querySelectorAll(".led[data-heat-for]").forEach((led) => {
      const ledTone = conditionTone(entityById(led.getAttribute("data-heat-for")));
      led.style.background = ledTone.color;
      led.style.boxShadow = ledTone.pri ? "0 0 0 1px " + ledTone.color : "none";
    });
  });
  document.querySelectorAll("[data-heat-box]").forEach((el) => {
    el.style.setProperty("--heat", conditionTone(entityById(el.getAttribute("data-heat-box"))).color);
  });
  document.querySelectorAll(".blade[data-load-for]").forEach((el) => {
    const entity = entityById(el.getAttribute("data-load-for"));
    if (!entity) return;
    const tone = conditionTone(entity);
    el.style.background = tone.pri ? tone.color : "#e7e2da";
    el.style.color = "#1a1a1a";
    el.style.borderColor = tone.pri ? tone.color : "#d5cfc6";
    const meter = el.querySelector(".blade-meter i");
    if (meter) meter.style.background = tone.pri ? "#1a1a1a" : "#5c564e";
  });
  document.querySelectorAll("[data-load-for] .led").forEach((led) => {
    const host = led.closest("[data-load-for]");
    if (!host || host.classList.contains("blade")) return;
    const tone = conditionTone(entityById(host.getAttribute("data-load-for")));
    led.style.background = tone.color;
  });
}

export function drillEl(node) {
  if (!node || !node.closest) return null;
  const el = node.closest("[data-act]");
  if (!el) return null;
  const act = el.dataset.act;
  if (act !== "floor-pod" && act !== "floor-row" && act !== "floor-rack" && act !== "floor-server" && act !== "floor-feed" && act !== "floor-part" && act !== "floor-go" && act !== "floor-hall" && act !== "plan-select" && act !== "horizon-focus") return null;
  if (!el.closest(".world, .chassis, .cabinet")) return null;
  return el;
}

export function pickDrill(x, y) {
  const stack = document.elementsFromPoint(x, y);
  const top = stack[0];
  if (!top || (top.closest && top.closest(".hud, .sim-bar, .sim-dock, .sim-timeline, .sim-stripe, .legend, .inspector, .lib, .page-head, .alarm-banner, .watch-panel, .rail, .topbar, .tabbar, .menu-back, .elev-scene, .scene-popbar, .panel-bar, .briefing"))) return null;
  const hits = [];
  for (let i = 0; i < stack.length; i += 1) {
    const el = drillEl(stack[i]);
    if (el && hits.indexOf(el) < 0) hits.push(el);
  }
  const gear = hits.find((el) => el.classList.contains("rackbox"));
  if (gear) return gear;
  const direct = hits[0] || null;
  if (direct && direct.classList.contains("pod")) {
    const inner = hits.find((el) => el !== direct && direct.contains(el));
    if (inner) return inner;
  }
  return direct;
}

function floorRecord(el) {
  if (!el || el.closest(".chassis-scene")) return null;
  if (el.dataset.plan) {
    const item = placementById(el.dataset.plan);
    if (!item || (item.place !== "floor" && item.place !== "yard")) return null;
    return { item, space: "world", key: "plan", id: item.id, site: item.place === "yard" };
  }
  const pod = el.dataset.pod ? podById(el.dataset.pod) : null;
  if (pod && el.dataset.rack) {
    const rack = rackById(pod, el.dataset.rack);
    if (!rack) return null;
    return { item: rack, space: "pod", pod, key: "rack", id: rack.id, site: false };
  }
  if (pod && el.dataset.server) {
    const id = el.dataset.server;
    const box = (pod.boxes || []).find((entry) => entry.id === id)
      || (pod.fit && pod.fit.containment && pod.fit.containment.id === id && pod.fit.containment)
      || (pod.fit && pod.fit.busbar && pod.fit.busbar.id === id && pod.fit.busbar);
    if (!box) return null;
    return { item: box, space: "pod", pod, key: "server", id, site: false };
  }
  if (el.dataset.server) {
    const yard = YARD.find((entry) => entry.id === el.dataset.server);
    if (!yard) return null;
    return { item: yard, space: "world", key: "server", id: yard.id, site: true };
  }
  if (el.classList.contains("building")) {
    const hall = el.dataset.pod ? podById(el.dataset.pod) : null;
    if (!hall || !hall.site) return null;
    return { item: hall.site, space: "world", key: "hall", id: hall.id, site: true };
  }
  return null;
}

function carryElement(record) {
  if (record.key === "hall") return document.querySelector('.rackbox.building[data-pod="' + record.id + '"]');
  if (record.key === "plan") return document.querySelector('.rackbox[data-plan="' + record.id + '"]');
  if (record.key === "rack") return document.querySelector('.rackbox[data-rack="' + record.id + '"]');
  return document.querySelector('.rackbox[data-server="' + record.id + '"]');
}

function clampFloorItem(item, record) {
  const width = item.w || 40;
  const depth = item.d || 40;
  if (record.space === "pod" && record.pod) {
    item.x = clamp(item.x, 0, Math.max(0, record.pod.w - width));
    item.y = clamp(item.y, 0, Math.max(0, record.pod.h - depth));
    return;
  }
  if (record.site) {
    item.x = clamp(item.x, -640, 640 - width);
    item.y = clamp(item.y, -440, 440 - depth);
    return;
  }
  item.x = clamp(item.x, -520, 520 - width);
  item.y = clamp(item.y, -360, 360 - depth);
}

function stageMetrics() {
  const stage = document.querySelector(".stage");
  if (!stage) return null;
  const rect = stage.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return null;
  const fit = Math.max(0.12, Math.min((rect.width - 8) / 1280, (rect.height - 8) / 960));
  const perspective = parseFloat(getComputedStyle(stage).perspective) || 1400;
  return {
    fit,
    perspective,
    originX: rect.left + rect.width / 2,
    originY: rect.top + rect.height * 0.54,
  };
}

export function clientToFloor(clientX, clientY) {
  const metrics = stageMetrics();
  if (!metrics) return null;
  const yaw = state.floor.yaw * Math.PI / 180;
  const pitch = state.floor.pitch * Math.PI / 180;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const span = metrics.fit * (state.floor.zoom || 1);
  const depth = metrics.perspective;
  const screenX = clientX - metrics.originX;
  const screenY = clientY - metrics.originY;
  const denom = span * (cosPitch + (screenY * sinPitch) / depth);
  if (Math.abs(denom) < 0.0001) return null;
  const ry = (screenY - metrics.fit * state.floor.panY) / denom;
  const rx = (screenX - metrics.fit * state.floor.panX - screenX * (span / depth) * sinPitch * ry) / span;
  return {
    x: rx * cosYaw + ry * sinYaw,
    y: -rx * sinYaw + ry * cosYaw,
  };
}

function placeCarry(event) {
  const carry = runtime.carry;
  if (!carry || Math.abs(event.clientX - carry.originX) + Math.abs(event.clientY - carry.originY) < 6) return;
  carry.moved = true;
  const point = clientToFloor(event.clientX, event.clientY);
  if (!point) return;
  const record = carry.record;
  const local = record.space === "pod"
    ? { x: point.x - record.pod.x, y: point.y - record.pod.y }
    : point;
  const item = record.item;
  item.x = Math.round((local.x + carry.grabX) / 4) * 4;
  item.y = Math.round((local.y + carry.grabY) / 4) * 4;
  clampFloorItem(item, record);
  const el = carryElement(record);
  if (!el) return;
  el.classList.add("carry");
  el.style.setProperty("--x", item.x + "px");
  el.style.setProperty("--y", item.y + "px");
  if (record.key === "hall") syncSiteServices();
}

function floorBoxAt(event) {
  const direct = event.target.closest && event.target.closest(".rackbox");
  if (direct && direct.closest(".world")) return direct;
  const stack = document.elementsFromPoint(event.clientX, event.clientY);
  for (let i = 0; i < stack.length; i += 1) {
    const box = stack[i].closest && stack[i].closest(".rackbox");
    if (box && box.closest(".world")) return box;
  }
  return null;
}

export function onPointerDown(event) {
  if (rackPointerDown(event)) return;
  if (elevationPointerDown(event)) return;
  if (!state.user || event.button !== 0) return;
  if (state.view === "plan") {
    const scene = event.target.closest && event.target.closest(".build-scene");
    if (!scene || event.target.closest("button, a")) return;
    runtime.orbit = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, chassis: false };
    scene.setPointerCapture(event.pointerId);
    return;
  }
  if (state.view !== "floor") return;
  // The experimental three.js floor runs its own orbit controls.
  if (event.target.closest(".floor3d-host, .gl-host")) return;
  if (event.target.closest(".lib, .hud, .sim-bar, .sim-dock, .sim-timeline, .sim-stripe, .legend, .inspector, button, a, input, select")) return;
  const box = floorBoxAt(event);
  const record = box ? floorRecord(box) : null;
  if (record) {
    if (runtime.walk) stopWalk(false, false);
    const point = clientToFloor(event.clientX, event.clientY);
    if (point) {
      const local = record.space === "pod"
        ? { x: point.x - record.pod.x, y: point.y - record.pod.y }
        : point;
      runtime.carry = {
        id: event.pointerId,
        originX: event.clientX,
        originY: event.clientY,
        moved: false,
        record,
        grabX: record.item.x - local.x,
        grabY: record.item.y - local.y,
      };
      return;
    }
  }
  if (event.target.closest("[data-plan]")) return;
  const scene = event.target.closest(".scene");
  if (!scene || runtime.walk || drillEl(event.target) || (event.target.closest && event.target.closest(".scene-popbar"))) return;
  runtime.orbit = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    moved: false,
    chassis: scene.classList.contains("chassis-scene"),
  };
  scene.setPointerCapture(event.pointerId);
}

export function onPointerMove(event) {
  if (rackPointerMove(event)) return;
  if (elevationPointerMove(event)) return;
  if (runtime.carry && event.pointerId === runtime.carry.id) {
    placeCarry(event);
    return;
  }
  if (!runtime.orbit || event.pointerId !== runtime.orbit.id) return;
  const dx = event.clientX - runtime.orbit.x;
  const dy = event.clientY - runtime.orbit.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) runtime.orbit.moved = true;
  runtime.orbit.x = event.clientX;
  runtime.orbit.y = event.clientY;
  if (runtime.orbit.chassis) {
    state.floor.chassisYaw = clamp(state.floor.chassisYaw + dx * 0.45, -75, 75);
    state.floor.chassisPitch = clamp(state.floor.chassisPitch - dy * 0.3, -25, 48);
  } else {
    state.floor.yaw += dx * 0.45;
    state.floor.pitch = clamp(state.floor.pitch - dy * 0.28, 16, 84);
  }
  applyCamera();
}

export function onPointerUp(event) {
  if (rackPointerUp(event)) return;
  if (elevationPointerUp(event)) return;
  if (runtime.carry && event.pointerId === runtime.carry.id) {
    const moved = runtime.carry.moved;
    runtime.carry = null;
    if (moved) {
      state.floor.suppressClick = true;
      setTimeout(() => { state.floor.suppressClick = false; }, 0);
      render();
    }
    return;
  }
  if (!runtime.orbit || event.pointerId !== runtime.orbit.id) return;
  if (runtime.orbit.moved) {
    state.floor.suppressClick = true;
    setTimeout(() => { state.floor.suppressClick = false; }, 0);
  }
  runtime.orbit = null;
}

export function onWheel(event) {
  const scene = event.target.closest && event.target.closest(".scene");
  if (!scene || !state.user || state.view !== "floor" || event.target.closest(".floor3d-host")) return;
  event.preventDefault();
  if (runtime.walk) stopWalk(false, false);
  const factor = event.deltaY > 0 ? 0.92 : 1.08;
  if (scene.classList.contains("chassis-scene")) {
    state.floor.chassisZoom = clamp(state.floor.chassisZoom * factor, 0.65, 1.85);
  } else {
    state.floor.zoom = clamp(state.floor.zoom * factor, 0.42, 1.9);
  }
  applyCamera();
}

const WALK_MOVE = 1500;
const WALK_HOLD = 1100;

function southRack(rack) {
  return (rack.row || "").slice(-1) === "s" || rack.y > 150;
}

function standOf(rack) {
  const south = southRack(rack);
  return {
    rack,
    x: rack.x + Math.max(0, (rack.w - 22) / 2),
    y: south ? rack.y - 28 : rack.y + rack.d + 6,
    face: south ? "n" : "s",
  };
}

function walkStops(pod) {
  const north = pod.racks.filter((rack) => !southRack(rack)).sort((a, b) => a.x - b.x);
  const south = pod.racks.filter((rack) => southRack(rack)).sort((a, b) => b.x - a.x);
  return north.concat(south).map(standOf);
}

function aimPoint(px, py) {
  const zoom = 2.35;
  const yawDeg = -36;
  const pitchDeg = 42;
  const yaw = yawDeg * Math.PI / 180;
  const pitch = pitchDeg * Math.PI / 180;
  const sx = px * zoom;
  const sy = py * zoom;
  const x1 = sx * Math.cos(yaw) - sy * Math.sin(yaw);
  const y1 = sx * Math.sin(yaw) + sy * Math.cos(yaw);
  return { zoom, yaw: yawDeg, pitch: pitchDeg, panX: -x1, panY: -y1 * Math.cos(pitch) };
}

function aimWalk(pod, point) {
  const px = pod.x + point.x + 11;
  const py = pod.y + point.y + (point.face === "s" ? -18 : 18);
  Object.assign(state.floor, aimPoint(px, py));
}

function cameraOf(cam) {
  return "translate(" + cam.panX + "px," + cam.panY + "px) rotateX(" + cam.pitch +
    "deg) rotateZ(" + cam.yaw + "deg) scale(" + cam.zoom + ")";
}

function glideCamera(from) {
  const world = document.querySelector(".world") as HTMLElement | null;
  if (!world) {
    applyCamera();
    return;
  }
  const stage = world.closest(".stage") as HTMLElement | null;
  let fit = 1;
  if (stage && stage.clientWidth > 0 && stage.clientHeight > 0) {
    fit = Math.max(0.12, Math.min((stage.clientWidth - 8) / 1280, (stage.clientHeight - 8) / 960));
  }
  const next = "scale(" + fit.toFixed(4) + ") " + cameraOf(state.floor);
  const prev = "scale(" + fit.toFixed(4) + ") " + cameraOf(from);
  world.style.transition = "none";
  world.style.transform = prev;
  world.style.setProperty("--pitch", from.pitch + "deg");
  world.style.setProperty("--yaw", from.yaw + "deg");
  void world.offsetWidth;
  world.style.transition = "transform 700ms ease";
  world.style.transform = next;
  world.style.setProperty("--pitch", state.floor.pitch + "deg");
  world.style.setProperty("--yaw", state.floor.yaw + "deg");
  window.setTimeout(() => {
    if (!world.isConnected) return;
    world.style.transition = "";
    applyCamera();
  }, 760);
}

function pulsing(id) {
  return !!(runtime.pulse && runtime.pulse.id === id && Date.now() < runtime.pulse.until);
}

function armPulse(id) {
  if (runtime.pulseTimer) clearTimeout(runtime.pulseTimer);
  runtime.pulse = { id, until: Date.now() + 2000 };
  runtime.pulseTimer = setTimeout(() => {
    runtime.pulse = null;
    runtime.pulseTimer = null;
    document.querySelectorAll(".is-pulse").forEach((el) => el.classList.remove("is-pulse"));
  }, 2000);
}

function locateAlarm(alarm) {
  const id = alarm && alarm.device;
  if (!id) return null;
  const device = deviceById(id);
  if (device && device.rack) {
    const pod = podById("pod-a") || PODS[0];
    const rack = rackById(pod, device.rack);
    if (pod && rack) return { kind: "rack", pod, rack };
  }
  const entity = entityById(id);
  if (!entity) return null;
  const yard = YARD.find((item) => item.id === id);
  if (entity.yard || yard) {
    if (yard) return { kind: "yard", item: yard };
  }
  if (entity.pod && entity.rack) {
    const pod = podById(entity.pod);
    const rack = rackById(pod, entity.rack);
    if (pod && rack) return { kind: "rack", pod, rack };
  }
  return null;
}

export function floorAlarmRackId(alarm) {
  const place = locateAlarm(alarm);
  return place && place.kind === "rack" ? place.rack.id : "";
}

export function focusFloorAlarm(alarm, opts: { list?: boolean } = {}) {
  if (!alarm) return;
  if (state.view !== "floor" && !opts.list) return;
  const place = locateAlarm(alarm);
  if (!place) return;
  if (opts.list && place.kind !== "rack") return;
  if (state.view !== "floor") {
    state.view = "floor";
    state.toast = "";
    state.menuOpen = false;
  }
  if (runtime.walk) stopWalk(false, false);
  const from = {
    panX: state.floor.panX,
    panY: state.floor.panY,
    zoom: state.floor.zoom,
    yaw: state.floor.yaw,
    pitch: state.floor.pitch,
  };
  const same = place.kind === "rack"
    ? state.floor.level === "hall" && state.floor.podId === place.pod.id
    : state.floor.level === "site";
  state.inspectorOpen = false;
  if (opts.list) state.floorListOpen = true;
  state.floor.serverId = "";
  state.floor.feedId = "";
  state.floor.partId = "";
  if (place.kind === "rack") {
    state.floor.level = "hall";
    state.floor.podId = place.pod.id;
    state.floor.rackId = place.rack.id;
    state.floor.rowId = place.rack.row || "";
    Object.assign(state.floor, aimPoint(place.pod.x + place.rack.x + place.rack.w / 2, place.pod.y + place.rack.y + place.rack.d / 2));
    armPulse(place.rack.id);
  } else {
    state.floor.level = "site";
    state.floor.serverId = place.item.id;
    Object.assign(state.floor, aimPoint(place.item.x + (place.item.w || 0) / 2, place.item.y + (place.item.d || 0) / 2));
    armPulse(place.item.id);
  }
  if (!same || opts.list) render();
  glideCamera(from);
  const selector = place.kind === "rack"
    ? '.rackbox[data-rack="' + place.rack.id + '"]'
    : '.rackbox[data-server="' + place.item.id + '"]';
  const box = document.querySelector(selector);
  if (box) box.classList.add("is-pulse");
  if (opts.list && place.kind === "rack") {
    const drawer = document.getElementById("floor-detail");
    const row = drawer && drawer.querySelector('[data-act="floor-rack"][data-rack="' + place.rack.id + '"]');
    if (row && (row as HTMLElement).focus) {
      (row as HTMLElement).focus({ preventScroll: true });
      if (drawer) {
        const rowEl = row as HTMLElement;
        const top = rowEl.offsetTop;
        const visibleTop = drawer.scrollTop;
        const visibleBottom = visibleTop + drawer.clientHeight;
        if (top < visibleTop || top + rowEl.offsetHeight > visibleBottom) {
          drawer.scrollTop = top - drawer.clientHeight / 2;
        }
      }
    } else if (drawer && drawer.focus) {
      drawer.focus({ preventScroll: true });
    }
  }
}

function walkElapsed(now) {
  const walk = runtime.walk;
  if (!walk.playing) return walk.held;
  return now - walk.stepStart;
}

function walkerSpot(now) {
  const walk = runtime.walk;
  const elapsed = walkElapsed(now);
  const t = Math.min(1, elapsed / WALK_MOVE);
  const eased = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
  const from = walk.stops[walk.from];
  const to = walk.stops[walk.index];
  return {
    x: from.x + (to.x - from.x) * eased,
    y: from.y + (to.y - from.y) * eased,
    face: eased > 0.5 ? to.face : from.face,
    moving: walk.playing && elapsed < WALK_MOVE,
    to,
  };
}

function walkCaption() {
  const walk = runtime.walk;
  const pod = podById(walk.podId);
  const stop = walk.stops[walk.index];
  return (pod ? pod.name : "Hall") + " · " + stop.rack.name + " · " + (walk.index + 1) + " of " + walk.stops.length;
}

function markWalkRack() {
  const walk = runtime.walk;
  if (!walk) return;
  const id = walk.stops[walk.index].rack.id;
  document.querySelectorAll(".walk-here").forEach((el) => el.classList.remove("walk-here"));
  document.querySelectorAll('[data-rack="' + id + '"]').forEach((rack) => {
    if (rack.classList.contains("pov-rack") || rack.classList.contains("rackbox")) rack.classList.add("walk-here");
  });
  const read = document.querySelector("[data-walk-read]");
  const caption = walkCaption();
  if (read) read.textContent = caption;
  const mission = document.querySelector(".hud-mission");
  if (mission) mission.textContent = caption;
}

function frameWalk(now) {
  const walk = runtime.walk;
  if (!walk) return;
  if (!state.user || state.view !== "floor" || state.floor.level !== "hall" || state.floor.podId !== walk.podId) {
    stopWalk(false, false);
    return;
  }
  const pod = podById(walk.podId);
  if (!pod) {
    stopWalk(false, false);
    return;
  }
  if (walk.playing && walkElapsed(now) >= WALK_MOVE + WALK_HOLD) {
    walk.from = walk.index;
    walk.index = (walk.index + 1) % walk.stops.length;
    walk.stepStart = now;
    markWalkRack();
  }
  const from = walk.stops[walk.from];
  const to = walk.stops[walk.index];
  const elapsed = walkElapsed(now);
  const t = Math.min(1, elapsed / WALK_MOVE);
  const eased = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
  const turning = southRack(from.rack) !== southRack(to.rack);
  const eye = (from.rack.x + from.rack.w / 2) + ((to.rack.x + to.rack.w / 2) - (from.rack.x + from.rack.w / 2)) * eased;
  const line = !turning || eased < 0.5 ? (southRack(from.rack) ? "s" : "n") : (southRack(to.rack) ? "s" : "n");
  const yaw = turning ? Math.sin(t * Math.PI) * -62 : 0;
  const rig = document.querySelector(".pov-rig");
  if (rig) {
    rig.style.setProperty("--eye", eye.toFixed(1));
    rig.style.setProperty("--yaw", yaw.toFixed(1) + "deg");
    rig.dataset.line = line;
  }
  markWalkRack();
  walk.frame = requestAnimationFrame(frameWalk);
}

export function startWalk(podId) {
  const pod = podById(podId) || PODS[0];
  if (!pod || !pod.racks.length) return;
  if (runtime.walk && runtime.walk.podId === pod.id && state.floor.level === "hall") return;
  const saved = runtime.walk ? runtime.walk.saved : {
    pitch: state.floor.pitch,
    yaw: state.floor.yaw,
    zoom: state.floor.zoom,
    panX: state.floor.panX,
    panY: state.floor.panY,
  };
  if (runtime.walk && runtime.walk.frame) cancelAnimationFrame(runtime.walk.frame);
  const stops = walkStops(pod);
  runtime.walk = {
    podId: pod.id,
    stops,
    index: 0,
    from: 0,
    playing: true,
    stepStart: performance.now() - WALK_MOVE,
    held: WALK_MOVE,
    saved,
    frame: 0,
  };
  state.view = "floor";
  state.floor.podId = pod.id;
  state.floor.level = "hall";
  state.floor.serverId = "";
  state.floor.rowId = "";
  state.floor.feedId = "";
  state.floor.partId = "";
  render();
  runtime.walk.frame = requestAnimationFrame(frameWalk);
}

export function stopWalk(restore, paint) {
  const walk = runtime.walk;
  if (!walk) return;
  if (walk.frame) cancelAnimationFrame(walk.frame);
  runtime.walk = null;
  if (restore && walk.saved) {
    state.floor.pitch = walk.saved.pitch;
    state.floor.yaw = walk.saved.yaw;
    state.floor.zoom = walk.saved.zoom;
    state.floor.panX = walk.saved.panX;
    state.floor.panY = walk.saved.panY;
  }
  if (paint !== false) render();
}

export function toggleWalk() {
  const walk = runtime.walk;
  if (!walk) return;
  if (walk.playing) {
    walk.held = performance.now() - walk.stepStart;
    walk.playing = false;
  } else {
    walk.stepStart = performance.now() - walk.held;
    walk.playing = true;
  }
  const button = document.querySelector("[data-act='floor-walk-pause']");
  if (button) button.textContent = walk.playing ? "Pause" : "Play";
}

export function stepWalk(dir) {
  const walk = runtime.walk;
  if (!walk) return;
  walk.from = walk.index;
  walk.index = (walk.index + (dir < 0 ? -1 : 1) + walk.stops.length) % walk.stops.length;
  walk.stepStart = performance.now();
  walk.held = 0;
  walk.playing = true;
  markWalkRack();
  const button = document.querySelector("[data-act='floor-walk-pause']");
  if (button) button.textContent = "Pause";
}

function walkerHtml(pod) {
  if (!runtime.walk || runtime.walk.podId !== pod.id) return "";
  const spot = walkerSpot(performance.now());
  return '<div class="walker' + (spot.moving ? " moving" : "") + (spot.face === "s" ? " face-s" : "") +
    '" style="--x:' + spot.x.toFixed(1) + "px;--y:" + spot.y.toFixed(1) +
    'px;--w:22px;--d:16px;--h:118px" aria-hidden="true"><i class="ftop"></i><i class="ffront"><b></b></i><i class="fside"></i></div>';
}

function walkBar() {
  if (!runtime.walk || state.floor.level !== "hall") return "";
  return '<div class="walk-bar"><button type="button" class="act" data-act="floor-walk-step" data-dir="prev">Previous</button><p data-walk-read>' +
    esc(walkCaption()) + '</p><button type="button" class="act" data-act="floor-walk-pause">' +
    (runtime.walk.playing ? "Pause" : "Play") + '</button><button type="button" class="act" data-act="floor-walk-step" data-dir="next">Next</button><button type="button" class="act" data-act="floor-walk-stop">Stop</button></div>';
}

export function closeFloorDetail() {
  state.inspectorOpen = false;
  state.floorListOpen = false;
  state.plan.selected = "";
  state.plan.preview = "";
}

export function goFloor(level) {
  if (runtime.walk && (level === "site" || level === "hall")) stopWalk(true, false);
  if (level === "site" || level === "hall") state.inspectorOpen = false;
  else state.inspectorOpen = true;
  if (level === "site") {
    state.floor.level = "site";
    state.floor.serverId = "";
    state.floor.rowId = "";
    state.floor.feedId = "";
    state.floor.partId = "";
    state.floor.zoom = Math.min(state.floor.zoom, 0.84);
  } else if (level === "hall") {
    if (state.floor.level === "site") state.floor.zoom = Math.max(state.floor.zoom, 0.9);
    state.floor.level = "hall";
    state.floor.serverId = "";
    state.floor.rowId = "";
    state.floor.feedId = "";
    state.floor.partId = "";
  } else if (level === "pod") {
    state.floor.level = "pod";
    state.floor.serverId = "";
    state.floor.rowId = "";
    state.floor.feedId = "";
    state.floor.partId = "";
  } else if (level === "row") {
    state.floor.level = state.floor.rowId ? "row" : "pod";
    state.floor.serverId = "";
    state.floor.feedId = "";
    state.floor.partId = "";
  } else if (level === "rack") {
    const rack = rackById(podById(state.floor.podId), state.floor.rackId);
    if (rack) {
      openRack(state.floor.podId, state.floor.rackId);
      return;
    }
    state.floor.level = state.floor.rackId ? "rack" : "pod";
    state.floor.serverId = "";
    state.floor.partId = "";
  }
  render();
}

export function openRow(podId, rowId) {
  stopWalk(true, false);
  state.inspectorOpen = true;
  if (state.floor.level === "hall" || state.floor.level === "site") state.floor.zoom = Math.max(state.floor.zoom, 1.15);
  state.floor.podId = podId;
  state.floor.rowId = rowId;
  state.floor.level = "row";
  state.floor.serverId = "";
  state.floor.feedId = "";
  state.floor.partId = "";
  state.view = "floor";
  render();
}

export function openFeed(podId, feedId) {
  state.view = "floor";
  state.inspectorOpen = true;
  state.floor.feedId = feedId;
  state.floor.partId = "";
  state.floor.serverId = "";
  state.floor.level = "feed";
  state.floor.podId = podId || "";
  render();
}

export function placeServer(id) {
  const entity = entityById(id);
  if (!entity) return;
  if (deviceById(id) && !entity.serialOnly) {
    state.floor.podId = "pod-a";
    state.floor.rackId = deviceRackId(id);
  } else if (entity.pod && entity.pod !== "yard") {
    state.floor.podId = entity.pod;
    state.floor.rackId = entity.rack || "";
  }
  const pod = podById(state.floor.podId);
  const rack = rackById(pod, state.floor.rackId);
  if (rack && rack.row) state.floor.rowId = rack.row;
}

export function openPod(id) {
  stopWalk(true, false);
  state.inspectorOpen = true;
  if (state.floor.level === "hall") state.floor.zoom = Math.max(state.floor.zoom, 1.12);
  state.floor.podId = id;
  state.floor.level = "pod";
  state.floor.serverId = "";
  state.floor.rowId = "";
  state.floor.feedId = "";
  state.floor.partId = "";
  render();
}

export function openRack(podId, rackId) {
  stopWalk(true, false);
  state.inspectorOpen = true;
  state.view = "floor";
  state.floor.podId = podId;
  state.floor.rackId = rackId;
  state.floor.level = "rack";
  state.floor.serverId = "";
  state.floor.partId = "";
  const rack = rackById(podById(podId), rackId);
  if (rack && rack.row) state.floor.rowId = rack.row;
  runtime.elevation = null;
  render();
  loadElevation(rackId);
}

export function openFloorServer(id) {
  const entity = entityById(id);
  if (!entity) return;
  state.inspectorOpen = true;
  state.view = "floor";
  state.floor.serverId = id;
  state.floor.partId = "";
  state.floor.feedId = "";
  if (entity.yard) {
    state.floor.level = "site";
    render();
    return;
  }
  state.floor.level = "server";
  placeServer(id);
  render();
}

export function openPart(id, part) {
  const entity = entityById(id);
  if (!entity) return;
  state.inspectorOpen = true;
  state.view = "floor";
  state.floor.serverId = id;
  state.floor.partId = part || "inlet";
  state.floor.feedId = "";
  if (entity.yard) {
    state.floor.level = "site";
    render();
    return;
  }
  state.floor.level = "part";
  placeServer(id);
  render();
}

export function floorSerial(id) {
  if (!deviceById(id)) {
    state.toast = "ACS-A14 opens serial only inside rack A14.";
    render();
    return;
  }
  openSession(id, "acs", "serial", "rs232");
}

export function bandLabel(band) {
  if (band === "failover") return "ACS serial";
  if (band === "critical") return "Critical";
  if (band === "near") return "Nearing capacity";
  return "Nominal";
}

function boxLabel(extra, band) {
  let name = extra.label || "";
  if (!name && extra.rack) name = "Rack " + extra.rack;
  if (!name && extra.server) {
    const entity = entityById(extra.server);
    name = entity && entity.name ? entity.name : extra.server;
  }
  if (!name && extra.plan) {
    const placed = state.plan.placements.find((item) => item.id === extra.plan);
    name = placed && placed.name ? placed.name : "Planned device";
  }
  if (!name) name = extra.cap || "Equipment";
  return band && band !== "ok" ? name + ", " + bandLabel(band) : name;
}

function simHitClass(report: SimImpact | null, ids: string[]) {
  if (!report || !report.active) return "";
  const hit = ids.some((id) => id && report.affected[id]);
  return hit ? " sim-hit" : " sim-dim";
}

export function boxHtml(item, band, act, extra, report?: SimImpact | null) {
  const tone = extra.server ? conditionTone(entityById(extra.server)) : listTone(extra.leds || []);
  const leds = extra.face ? "" : (extra.leds || []).map((entity) => {
    const ledTone = conditionTone(entity);
    return '<em class="led" data-heat-for="' + entity.id + '" title="' + esc(ledTone.word) + '" style="background:' +
      ledTone.color + '"></em>';
  }).join("");
  const mark = tone.pri ? '<b class="face-pri pri-' + tone.pri + '">' + tone.pri + "</b>" : "";
  const heatAttr = extra.server
    ? '" data-heat-box="' + extra.server
    : '" data-heat-rack="' + (extra.rack || "");
  const face = extra.face || "";
  const cap = extra.cap ? '<span class="cap-label">' + esc(extra.cap) + "</span>" : "";
  const tag = extra.rack ? '<span class="rack-tag">' + esc(extra.rack) + "</span>" : "";
  const airTag = extra.air ? '<span class="thermal-tag ' + extra.air.mode + '">' + esc(extra.air.text) + "</span>" : "";
  const planAttr = extra.plan ? ' data-plan="' + extra.plan + '"' : "";
  const attrs = extra.attrs || "";
  const label = boxLabel(extra, band);
  const faceText = String(face || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const capShown = extra.cap ? String(extra.cap).toUpperCase() : "";
  const named = [label, capShown, faceText, tone.pri ? String(tone.pri) : ""].filter(Boolean).join(" ");
  const simClass = simHitClass(report || null, [
    extra.server || "",
    extra.rack || "",
    extra.pod || "",
    item && item.id ? item.id : "",
  ]);
  return '<div class="rackbox' + (extra.plan ? " planned" : "") + (extra.klass ? " " + extra.klass : "") + simClass + '" role="button" tabindex="0" aria-label="' + esc(named) + '" data-act="' + act + '" data-band="' + band + '" data-pri="' + (tone.pri || 0) + heatAttr +
    '" style="--x:' + item.x + "px;--y:" + item.y + "px;--w:" + item.w + "px;--d:" + item.d + "px;--h:" + item.h +
    "px;--heat:" + (extra.color || tone.color) + '" data-pod="' + (extra.pod || "") + '" data-rack="' + (extra.rack || "") +
    '" data-server="' + (extra.server || "") + '"' + planAttr + attrs + ">" + tag + airTag + '<i class="ftop" aria-hidden="true">' + cap + '</i><i class="ffront" aria-hidden="true">' + mark + leds + face +
    '</i><i class="fside" aria-hidden="true"></i></div>';
}

function hudPlace() {
  if (state.floor.level === "site") return "Outside";
  const hall = podById(state.floor.podId) || PODS[0];
  return hall ? hall.name : "Hall";
}

function hudLine() {
  if (runtime.walk && state.floor.level === "hall") return walkCaption();
  const n = activeAlarms().length;
  const name = hudPlace();
  return n ? name + " · " + n + " abnormal" : name;
}

export function legendPop(body) {
  return '<details class="legend-pop"><summary class="act" aria-label="Legend">?</summary><div class="legend">' + body + "</div></details>";
}

export function hudHtml(legend) {
  const outside = state.floor.level === "site";
  const walking = runtime.walk && state.floor.level === "hall";
  const walkBtn = outside || walking
    ? ""
    : '<button type="button" class="act walk-start" data-act="floor-walk">Walk through</button>';
  const listBtn = walking
    ? ""
    : '<button type="button" class="act" id="floor-list-toggle" data-act="floor-list" aria-expanded="' + (floorDetailOpen() ? "true" : "false") + '">List</button>';
  const addBtn = walking
    ? ""
    : '<button type="button" class="act" data-act="library-open" aria-pressed="' + (state.libraryOpen ? "true" : "false") + '">Add equipment</button>';
  return simStripeHtml() + '<div class="hud">' + pills() + '<p class="hud-mission">' + esc(hudLine()) +
    '</p><div class="hud-controls">' + themeButton() + '<div class="seg" role="group" aria-label="Horizon"><button type="button" data-act="horizon" data-horizon="now"' + (state.horizon === "future" ? "" : ' aria-pressed="true"') + '>Now</button><button type="button" data-act="horizon" data-horizon="future"' + (state.horizon === "future" ? ' aria-pressed="true"' : "") + '>Future</button></div><div class="seg" role="group" aria-label="Place"><button type="button" data-act="floor-go" data-level="site"' + (outside ? ' aria-pressed="true"' : "") + '>Outside</button><button type="button" data-act="floor-go" data-level="hall"' + (outside ? "" : ' aria-pressed="true"') + '>Hall</button></div>' +
    walkBtn + listBtn + addBtn +
    (outside || walking ? "" : '<button type="button" class="act" data-act="thermal-map" aria-pressed="' + (state.thermalMap ? "true" : "false") + '">Thermal</button>') +
    heatPathButton(false) +
    (outside || walking ? "" : '<button type="button" class="act floor3d-toggle" id="floor3d-toggle" data-act="floor-3d" aria-pressed="' + (runtime.floor3d ? "true" : "false") + '" title="Experimental 3D hall drawn with three.js">Experimental</button>') +
    '<button type="button" class="act" data-act="sim-open" aria-pressed="' + (runtime.sim.barOpen ? "true" : "false") + '">Simulate</button>' +
    (legend || "") + '<div class="zoom-cluster" role="group" aria-label="Pan"><button type="button" data-act="floor-pan" data-dir="left" aria-label="Pan left">←</button><button type="button" data-act="floor-pan" data-dir="right" aria-label="Pan right">→</button><button type="button" data-act="floor-pan" data-dir="up" aria-label="Pan up">↑</button><button type="button" data-act="floor-pan" data-dir="down" aria-label="Pan down">↓</button></div><div class="zoom-cluster" role="group" aria-label="Orbit"><button type="button" data-act="floor-orbit" data-dir="left" aria-label="Orbit left">↺</button><button type="button" data-act="floor-orbit" data-dir="right" aria-label="Orbit right">↻</button><button type="button" data-act="floor-orbit" data-dir="up" aria-label="Orbit up">⤒</button><button type="button" data-act="floor-orbit" data-dir="down" aria-label="Orbit down">⤓</button></div><div class="zoom-cluster" role="group" aria-label="Zoom"><button type="button" data-act="floor-zoom" data-dir="in" aria-label="Zoom in">+</button><button type="button" data-act="floor-zoom" data-dir="out" aria-label="Zoom out">−</button><button type="button" data-act="floor-zoom" data-dir="reset" aria-label="Reset view">Reset</button></div></div></div>' +
    (runtime.sim.barOpen ? simBarHtml() : "");
}

export function makerColor(maker) {
  if (maker === "HP") return "#0b6e5a";
  if (maker === "Dell") return "#0a4f86";
  if (maker === "IBM") return "#0f3f8a";
  return "#3a342e";
}

export function portPips(count, kind) {
  const shown = Math.min(count, 6);
  let marks = "";
  for (let i = 0; i < shown; i += 1) marks += '<i class="pip ' + kind + '"></i>';
  if (count > shown) marks += "<b>+" + (count - shown) + "</b>";
  if (!count) marks = '<i class="pip none"></i>';
  return '<span class="pips" role="img" aria-label="' + count + " " + kind + ' ports">' + marks + "</span>";
}

export function faceplateHtml(spec) {
  return '<span class="faceplate"><b>' + esc(spec.powerLabel) + "</b><b>" + esc(spec.ampLabel) + "</b>" +
    portPips(spec.powerPorts, "power") + "</span>";
}

export function mini3d(spec) {
  const height = spec.place === "floor" ? 46 : Math.max(22, Math.min(40, (spec.u || 1) * 16));
  return '<span class="mini-slot"><span class="mini-view"><span class="mini3d" style="--mc:' + makerColor(spec.maker) + ";--mh:" + height +
    'px"><i class="mtop"></i><i class="mfront">' + portPips(Math.min(spec.powerPorts, 4), "power") +
    '</i><i class="mside"></i></span></span></span>';
}

export function placeWord(place) {
  if (place === "yard") return "Outside";
  if (place === "floor") return "Floor";
  return "Rack";
}

function airTagFor(item) {
  if (!state.thermalMap || item.place !== "floor" || state.floor.level === "site") return null;
  const pod = podById(state.floor.podId) || PODS[0];
  const air = hallAir(pod);
  const spot = air && air.spots.find((entry) => entry.id === item.id);
  if (!spot) return null;
  if (spot.mode === "cool") return { mode: "cool", text: "Cooling" };
  return { mode: "heat", text: spot.center.toFixed(1) + " °C" + (spot.caught ? " · cooled" : "") };
}

export function planBoxes(place) {
  return state.plan.placements.filter((item) => item.place === place).map((item) => {
    const spec = catalogById(item.catalogId);
    return boxHtml(
      { x: item.x, y: item.y, w: spec.box.w, d: spec.box.d, h: spec.box.h },
      "ok",
      "plan-select",
      { plan: item.id, color: makerColor(spec.maker), face: faceplateHtml(spec), air: airTagFor(item) }
    );
  }).join("");
}

export function planBlade(item) {
  const spec = catalogById(item.catalogId);
  const selected = state.plan.selected === item.id ? " selected" : "";
  const units = spec.u || 1;
  return '<button type="button" class="ru' + selected + '" data-act="plan-select" data-plan="' + item.id +
    '" style="--u:' + units + ";--mc:" + makerColor(spec.maker) + '"><span class="ru-u">' + (spec.u ? spec.u + "U" : "0U") +
    '</span><span class="ru-body"><b>' + esc(item.name) + "</b><span>" + esc(spec.powerLabel) + " · " + esc(spec.ampLabel) +
    "</span></span><span class=\"ru-ports\">" + portPips(spec.powerPorts, "power") + portPips(spec.netPorts, "net") +
    "</span></button>";
}

export function planBlades(hostId) {
  return state.plan.placements.filter((item) => item.place === "rack" && item.host === hostId).map(planBlade).join("");
}

export function dims(spec) {
  return spec.mm[0] + " × " + spec.mm[1] + " × " + spec.mm[2] + " mm";
}

export function faceSheet(spec, title, extra) {
  return '<div class="face-sheet"><div class="face-sheet-top">' + mini3d(spec) + "<div><p class=\"kicker\">" + esc(spec.maker) +
    "</p><h2>" + esc(title) + '</h2><span class="place-badge ' + spec.place + '">' + placeWord(spec.place) +
    "</span></div></div><div class=\"stat-row\"><div class=\"stat\"><b>" + esc(spec.powerLabel) +
    "</b><span>Power</span></div><div class=\"stat\"><b>" + esc(spec.ampLabel) + "</b><span>Current</span></div><div class=\"stat\"><b>" +
    esc(spec.volts) + "</b><span>Voltage</span></div></div><p class=\"dim-bar\">Dimensions " + esc(dims(spec)) +
    "</p><div class=\"port-row\"><span>Power ports " + spec.powerPorts + "</span>" + portPips(spec.powerPorts, "power") +
    "</div><div class=\"port-row\"><span>Network ports " + spec.netPorts + "</span>" + portPips(spec.netPorts, "net") +
    "</div>" + (spec.uCapacity ? '<p class="fine">Rack space ' + spec.uCapacity + "U</p>" : "") +
    (spec.place === "rack" ? '<p class="fine">Height ' + (spec.u ? spec.u + "U" : "0U") + "</p>" : "") +
    '<p class="fine">' + esc(spec.note) + "</p>" + (extra || "") + "</div>";
}

export function libCard(specItem) {
  const on = state.plan.preview === specItem.id ? " on" : "";
  return '<div class="lib-card' + on + " " + specItem.place + '" draggable="true" data-catalog="' + specItem.id +
    '" data-act="plan-preview" tabindex="0" style="--mc:' + makerColor(specItem.maker) + '"><span class="grip" aria-hidden="true"></span>' +
    mini3d(specItem) + '<span class="lib-copy"><span class="place-badge ' + specItem.place + '">' +
    placeWord(specItem.place) + "</span><strong>" + esc(specItem.name) +
    "</strong><span class=\"lib-maker\">" + esc(specItem.maker) + " · used by " + (specItem.usedBy || 0) + "</span></span><span class=\"lib-stats\"><b>" +
    esc(specItem.powerLabel) + "</b><b>" + esc(specItem.ampLabel) + "</b><b>" + specItem.powerPorts + " P · " +
    specItem.netPorts + " N</b></span></div>";
}

export function renderLibrary() {
  const makers = ["All", "Unubtanium 2.0", "HP", "Dell", "IBM"];
  const filters = makers.map((maker) => {
    const dot = maker === "All" ? "" : '<i class="maker-dot" style="background:' + makerColor(maker) + '"></i>';
    return '<button type="button" data-act="plan-maker" data-maker="' + maker + '"' +
      (state.plan.maker === maker ? ' aria-pressed="true"' : "") + ">" + dot + maker + "</button>";
  }).join("");
  const list = LIBRARY.filter((specItem) => state.plan.maker === "All" || specItem.maker === state.plan.maker);
  const groups = ([
    ["Outside the building", list.filter((specItem) => specItem.place === "yard")],
    ["On the floor", list.filter((specItem) => specItem.place === "floor")],
    ["In a rack", list.filter((specItem) => specItem.place === "rack")],
  ] as [string, any[]][]).map((group) => {
    if (!group[1].length) return "";
    return '<h3>' + group[0] + "</h3>" + group[1].map(libCard).join("");
  }).join("");
  let watts = 0;
  let amps = 0;
  state.plan.placements.forEach((item) => {
    const specItem = catalogById(item.catalogId);
    watts += specItem.watts;
    amps += specItem.amps;
  });
  const power = watts >= 1000 ? (watts / 1000).toFixed(1) + " kW" : watts + " W";
  return '<aside class="lib drawer" aria-label="Device library"><h2>Device library</h2><div class="lib-body"><p class="fine">Drag a tile onto the view. Outside gear lands in the yard, floor gear on the hall, and rack gear in an enclosure. Pieces already in the view can be dragged to a new spot. A click still opens them.</p><div class="lib-filters">' +
    filters + "</div>" + groups + '<p class="lib-total"><b>' + state.plan.placements.length + '</b><span>placed</span><b>' +
    power + "</b><b>" + amps.toFixed(1) + " A</b></p></div></aside>";
}

export function renderPlanChassis(item) {
  const blades = planBlades(item.id);
  const free = freeU(item.id);
  return '<div class="scene chassis-scene thermal">' + hudHtml() + '<div class="chassis-wrap"><div class="rack-frame" data-plan-host="' +
    item.id + '" style="transform:rotateX(' + state.floor.chassisPitch + "deg) rotateY(" + state.floor.chassisYaw +
    "deg) scale(" + state.floor.chassisZoom + ')"><div class="rack-rail"><span>' + esc(item.name) + "</span><b>" + free +
    'U free</b></div><div class="rack-bay">' + (blades || "") + "</div></div></div></div>";
}

export function itemPoint(item) {
  const depth = item.d || item.h || 20;
  return { x: item.x + item.w / 2, y: item.y + depth / 2 };
}

export function outletForDevice(id) {
  return outlets.find((outlet) => outlet.deviceId === id);
}

export function whipMode(id) {
  const outlet = outletForDevice(id);
  if (!outlet) return "live";
  if (outlet.power === "off") return "open";
  if (outlet.power === "cycling") return "partial";
  return "live";
}

export function shelfLive(pod) {
  if (!pod) return "live";
  if (pod.id === "pod-a") return whipMode("pshelf");
  return "live";
}

export function rackEnergized(pod, rack) {
  const shelf = shelfLive(pod);
  if (!rack) return shelf;
  if (rack.kind === "Power") return shelf;
  if (shelf === "open") return "open";
  const bound = (rack.servers || []).filter((id) => outletForDevice(id));
  if (!bound.length) return shelf;
  const modes = bound.map(whipMode);
  if (modes.every((mode) => mode === "open")) return "open";
  if (modes.some((mode) => mode !== "live") || shelf === "partial") return "partial";
  return "live";
}

export function feedMode(id) {
  if (!id) return "live";
  if (id.indexOf("whip-") === 0) {
    const rackId = id.slice(5);
    const pod = PODS.find((item) => item.racks.some((rack) => rack.id === rackId));
    const rack = pod && pod.racks.find((item) => item.id === rackId);
    return rackEnergized(pod, rack);
  }
  if (id.indexOf("bus-") === 0) return shelfLive(podById(id.slice(4)));
  return "live";
}

export function feedHtml(from, to, mode, id, podId, extraClass?: string, report?: SimImpact | null) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.max(12, Math.hypot(dx, dy));
  const ang = Math.atan2(dy, dx) * 180 / Math.PI;
  const on = state.floor.feedId === id ? " on" : "";
  const failed = !!(report && report.active && report.failedFeeds.indexOf(id) >= 0);
  const feedMode = failed ? "failed" : mode;
  return '<div class="feed ' + feedMode + on + (extraClass ? " " + extraClass : "") + '" data-act="floor-feed" data-feed="' + id + '" data-pod="' +
    (podId || "") + '" style="--x:' + from.x.toFixed(1) + "px;--y:" + from.y.toFixed(1) + "px;--len:" + len.toFixed(1) +
    "px;--ang:" + ang.toFixed(1) + 'deg" aria-hidden="true"></div>';
}

export function pipeHtml(from, to, kind, marker, report?: SimImpact | null) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.max(12, Math.hypot(dx, dy));
  const ang = Math.atan2(dy, dx) * 180 / Math.PI;
  const id = kind === "return" ? "pipe-ret" : "pipe-sup";
  const key = marker || kind;
  const failed = !!(report && report.active && report.failedPipes.indexOf(key) >= 0);
  return '<div class="pipe ' + kind + (failed ? " failed" : "") + '" data-act="floor-server" data-server="' + id + '" data-pipe="' + key +
    '" style="--x:' + from.x.toFixed(1) + "px;--y:" + from.y.toFixed(1) + "px;--len:" + len.toFixed(1) +
    "px;--ang:" + ang.toFixed(1) + 'deg" aria-hidden="true"></div>';
}

function hallMidY(hall) {
  const site = hall.site;
  return site.y + (site.d || site.h || 0) / 2;
}

function serviceSpan(extra, halls?) {
  const list = halls || PODS;
  const ys = list.filter((hall) => hall.site).map(hallMidY).concat(extra || []);
  if (!ys.length) return { min: 0, max: 0 };
  return { min: Math.min.apply(null, ys), max: Math.max.apply(null, ys) };
}

function faceToward(site, towardX) {
  const midY = site.y + (site.d || site.h || 0) / 2;
  if (towardX <= site.x + site.w / 2) return { x: site.x - 8, y: midY };
  return { x: site.x + site.w + 8, y: midY };
}

function paintSegment(el, from, to) {
  if (!el) return;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.max(12, Math.hypot(dx, dy));
  const ang = Math.atan2(dy, dx) * 180 / Math.PI;
  el.style.setProperty("--x", from.x.toFixed(1) + "px");
  el.style.setProperty("--y", from.y.toFixed(1) + "px");
  el.style.setProperty("--len", len.toFixed(1) + "px");
  el.style.setProperty("--ang", ang.toFixed(1) + "deg");
}

function syncSiteServices() {
  const busX = -370;
  const trunkS = 470;
  const trunkR = 486;
  const busY = itemPoint(yardById("pwr-mod")).y;
  const gearYs = ["heat-1", "heat-2", "heat-3", "heat-4", "heat-5", "heat-6", "hydro-1", "hydro-2"].map((id) => itemPoint(yardById(id)).y);
  const powerSpan = serviceSpan([busY]);
  const coolSpan = serviceSpan(gearYs);
  paintSegment(document.querySelector('[data-feed="mod-riser"]'), { x: busX, y: powerSpan.min }, { x: busX, y: powerSpan.max });
  paintSegment(document.querySelector('[data-pipe="supply-spine"]'), { x: trunkS, y: coolSpan.min }, { x: trunkS, y: coolSpan.max });
  paintSegment(document.querySelector('[data-pipe="return-spine"]'), { x: trunkR, y: coolSpan.min }, { x: trunkR, y: coolSpan.max });
  PODS.forEach((hall) => {
    if (!hall.site) return;
    const powerEnd = faceToward(hall.site, busX);
    paintSegment(document.querySelector('[data-feed="feed-hall-' + hall.id + '"]'), { x: busX, y: powerEnd.y }, powerEnd);
    const cool = faceToward(hall.site, trunkS);
    paintSegment(document.querySelector('[data-pipe="supply-' + hall.id + '"]'), cool, { x: trunkS, y: cool.y });
    const ret = { x: cool.x, y: cool.y + 12 };
    paintSegment(document.querySelector('[data-pipe="return-' + hall.id + '"]'), ret, { x: trunkR, y: ret.y });
  });
}

export function podShelf(pod) {
  return pod.racks.find((rack) => rack.kind === "Power") || (pod.boxes || []).find((box) => {
    const entity = entityById(box.id);
    return entity && entity.kind === "Powershelf";
  });
}

export function podFeeds(pod, report?: SimImpact | null) {
  const shelf = podShelf(pod);
  const bus = pod.fit && pod.fit.busbar;
  if (!shelf || !bus) return "";
  const shelfPt = itemPoint(shelf);
  let html = feedHtml(itemPoint(bus), shelfPt, shelfLive(pod), "bus-" + pod.id, pod.id, "", report);
  pod.racks.forEach((rack) => {
    if (rack.id === shelf.id) return;
    html += feedHtml(shelfPt, itemPoint(rack), rackEnergized(pod, rack), "whip-" + rack.id, pod.id, "", report);
  });
  (pod.boxes || []).forEach((box) => {
    if (box.id === shelf.id) return;
    const entity = entityById(box.id);
    if (!entity || entity.kind !== "Powershelf") return;
    html += feedHtml(itemPoint(bus), itemPoint(box), "live", "bus-" + pod.id, pod.id, "", report);
  });
  return html;
}

export function yardById(id) {
  const gear = {};
  YARD.forEach((item) => { gear[item.id] = item; });
  return gear[id];
}

export function siteFeedHtml(halls?, report?: SimImpact | null) {
  const list = halls || PODS;
  const pairs = [
    ["grid-1", "xfmr-1", "grid-xfmr-a"],
    ["xfmr-1", "pwr-mod", "xfmr-mod-a"],
    ["grid-2", "xfmr-2", "grid-xfmr-b"],
    ["xfmr-2", "pwr-2", "xfmr-mod-b"],
    ["pwr-mod", "pwr-3", "mod-c"],
    ["pwr-2", "pwr-4", "mod-d"],
    ["batt-1", "pwr-mod", "batt-a"],
    ["batt-2", "pwr-2", "batt-b"],
  ];
  let html = pairs.map((pair) => feedHtml(itemPoint(yardById(pair[0])), itemPoint(yardById(pair[1])), "live", pair[2], "", "cable", report)).join("");
  const bus = { x: -370, y: itemPoint(yardById("pwr-mod")).y };
  html += feedHtml(itemPoint(yardById("pwr-mod")), bus, "live", "mod-bus", "", "cable", report);
  html += feedHtml(itemPoint(yardById("pwr-2")), bus, "live", "mod-bus-b", "", "cable", report);
  const span = serviceSpan([bus.y], list);
  html += feedHtml({ x: bus.x, y: span.min }, { x: bus.x, y: span.max }, "live", "mod-riser", "", "cable", report);
  list.forEach((hall) => {
    if (!hall.site) return;
    const end = faceToward(hall.site, bus.x);
    html += feedHtml({ x: bus.x, y: end.y }, end, "live", "feed-hall-" + hall.id, hall.id, "cable", report);
  });
  return html;
}

export function sitePipesHtml(halls?, plantIds?, report?: SimImpact | null) {
  const list = halls || PODS;
  const ids = plantIds || ["heat-1", "heat-2", "heat-3", "heat-4", "heat-5", "heat-6", "hydro-1", "hydro-2"];
  const trunkS = 470;
  const trunkR = 486;
  const gearYs = ids.map((id) => itemPoint(yardById(id)).y);
  const span = serviceSpan(gearYs, list);
  let html = pipeHtml({ x: trunkS, y: span.min }, { x: trunkS, y: span.max }, "supply", "supply-spine", report) +
    pipeHtml({ x: trunkR, y: span.min }, { x: trunkR, y: span.max }, "return", "return-spine", report);
  list.forEach((hall) => {
    if (!hall.site) return;
    const cool = faceToward(hall.site, trunkS);
    const ret = { x: cool.x, y: cool.y + 12 };
    html += pipeHtml(cool, { x: trunkS, y: cool.y }, "supply", "supply-" + hall.id, report);
    html += pipeHtml(ret, { x: trunkR, y: ret.y }, "return", "return-" + hall.id, report);
  });
  ids.forEach((id) => {
    const gear = itemPoint(yardById(id));
    html += pipeHtml({ x: trunkS, y: gear.y }, { x: gear.x - 4, y: gear.y }, "supply", kindMarker(id, "supply"), report);
    html += pipeHtml({ x: trunkR, y: gear.y + 8 }, { x: gear.x - 4, y: gear.y + 8 }, "return", kindMarker(id, "return"), report);
  });
  return html;
}

function kindMarker(id, kind) {
  return kind + "-" + id;
}

export function rowRecord(pod, rowId) {
  if (!pod || !pod.fit || !pod.fit.rows) return null;
  return pod.fit.rows.find((row) => row.id === rowId) || null;
}

/* Supply, the 21–24 °C inlet band, 27 °C above it, and the contained return near 37 °C. */
const AIR_STOPS = [
  { c: 20.5, rgb: [47, 111, 138] },
  { c: 24, rgb: [127, 154, 98] },
  { c: 27, rgb: [196, 161, 90] },
  { c: 35, rgb: [196, 106, 50] },
  { c: 40, rgb: [138, 48, 48] },
];

function airColor(celsius: number) {
  const stops = AIR_STOPS;
  if (celsius <= stops[0].c) return rgb(stops[0].rgb);
  const last = stops[stops.length - 1];
  if (celsius >= last.c) return rgb(last.rgb);
  for (let i = 1; i < stops.length; i += 1) {
    if (celsius <= stops[i].c) {
      const lo = stops[i - 1];
      const hi = stops[i];
      const t = (celsius - lo.c) / (hi.c - lo.c);
      return rgb(lo.rgb.map((channel, index) => Math.round(channel + (hi.rgb[index] - channel) * t)));
    }
  }
  return rgb(last.rgb);
}

function rgb(channels: number[]) {
  return "rgb(" + channels.join(",") + ")";
}

function rackAir(rack) {
  const entities = rackEntities(rack).filter((entity) => entity && entity.load && !isFacility(entity));
  if (!entities.length) return null;
  let inlet = -Infinity;
  let exhaust = -Infinity;
  let ret = -Infinity;
  entities.forEach((entity) => {
    const reading = thermalReading(entity);
    if (reading.inlet > inlet) inlet = reading.inlet;
    if (reading.exhaust > exhaust) exhaust = reading.exhaust;
    if (reading.ret > ret) ret = reading.ret;
  });
  return { x: rack.x + rack.w / 2, inlet, exhaust, ret };
}

function isCooler(spec) {
  const kind = spec.kind || "";
  if (kind === "Cooling" || kind === "CRAC") return true;
  const note = String(spec.note || "").toLowerCase();
  return note.indexOf("cooling capacity") >= 0 || note.indexOf("coolant distribution") >= 0 || note.indexOf("crac") >= 0 || note.indexOf("crah") >= 0;
}

function statedCoolingKw(spec) {
  const match = String(spec.note || "").match(/(\d+(?:\.\d+)?)\s*kW cooling capacity/i);
  return match ? Number(match[1]) : 0;
}

function placedHeatKw(spec) {
  if (!spec || isCooler(spec)) return 0;
  const kind = spec.kind || "";
  if (["Power", "UPS", "Facility", "Security", "Busway", "Environmental", "Containment", "Enclosure"].indexOf(kind) >= 0) return 0;
  if (kind === "Compute" || kind === "Storage" || (spec.watts || 0) >= 1000) return (spec.watts || 0) / 1000;
  return 0;
}

/* Floor and rack placements in this hall, in the same coordinates as the thermal map. */
function placedSpots(pod) {
  const spots = [];
  state.plan.placements.forEach((item) => {
    const spec = catalogById(item.catalogId);
    if (!spec) return;
    let x = 0;
    let y = 0;
    let rack = null;
    if (item.place === "floor") {
      x = item.x - pod.x + (spec.box.w || 0) / 2;
      y = item.y - pod.y + (spec.box.d || 0) / 2;
      if (x < -80 || y < -80 || x > pod.w + 80 || y > pod.h + 80) return;
    } else if (item.place === "rack") {
      rack = (pod.racks || []).find((entry) => entry.id === item.host);
      if (!rack) return;
      x = rack.x + rack.w / 2;
      y = rack.y + rack.d / 2;
    } else return;
    const heatKw = placedHeatKw(spec);
    const coolKw = isCooler(spec) ? statedCoolingKw(spec) : 0;
    if (!heatKw && !isCooler(spec)) return;
    const reach = Math.max(spec.box.w || 48, spec.box.d || 48) * (isCooler(spec) ? 3 : 2.2);
    const rackBox = item.place === "rack";
    spots.push({
      id: item.id,
      name: item.name || spec.name,
      x: x,
      y: y,
      boxW: rackBox ? rack.w : (spec.box.w || 48),
      boxD: rackBox ? rack.d : (spec.box.d || 48),
      boxH: rackBox ? (rack.h || 112) : (spec.box.h || 48),
      heatKw: heatKw,
      coolKw: coolKw,
      holdSupply: isCooler(spec) && !coolKw,
      reach: reach,
    });
  });
  return spots;
}

function falloff(dist: number, reach: number) {
  if (reach <= 0 || dist >= reach) return 0;
  return 1 - dist / reach;
}

function spotRise(spot, spots, rackKw: number, rackRise: number) {
  if (!spot.heatKw || rackKw <= 0) return 0;
  let captured = 0;
  spots.forEach((other) => {
    if (other === spot || (!other.coolKw && !other.holdSupply)) return;
    const near = falloff(Math.hypot(other.x - spot.x, other.y - spot.y), other.reach);
    if (!near) return;
    const share = other.holdSupply ? 1 : Math.min(1, other.coolKw / spot.heatKw);
    captured += near * share;
  });
  const open = Math.max(0, 1 - captured);
  return rackRise * (spot.heatKw / rackKw) * open;
}

function aisleSamples(pod, aisle, hac: boolean) {
  const hot = aisle.tone === "hot";
  const rows = ((pod.fit && pod.fit.rows) || []).filter((row) => (hot ? row.hot : row.cold) === aisle.id);
  const rowIds = {};
  rows.forEach((row) => { rowIds[row.id] = true; });
  const byX = {};
  pod.racks.forEach((rack) => {
    if (!rowIds[rack.row]) return;
    const air = rackAir(rack);
    if (!air) return;
    const value = hot ? (hac ? air.ret : air.exhaust) : air.inlet;
    const key = String(Math.round(air.x));
    if (!byX[key] || value > byX[key].c) byX[key] = { x: air.x, c: value };
  });
  return Object.keys(byX).map((key) => byX[key]).sort((a, b) => a.x - b.x);
}

function gradientStops(aisle, samples) {
  const width = aisle.w || 1;
  const raw = samples.map((sample) => ({
    off: clamp((sample.x - aisle.x) / width, 0, 1),
    c: sample.c,
  })).sort((a, b) => a.off - b.off);
  if (!raw.length) return [{ off: 0, c: 20.5 }, { off: 1, c: 20.5 }];
  const stops = raw.slice();
  if (stops[0].off > 0) stops.unshift({ off: 0, c: stops[0].c });
  if (stops[stops.length - 1].off < 1) stops.push({ off: 1, c: stops[stops.length - 1].c });
  if (stops.length < 2) stops.push({ off: 1, c: stops[0].c });
  return stops;
}

/* Supply stays near the floor. The contained return stands above the racks. */
function airColumnPx(celsius: number) {
  const t = clamp((celsius - 20.5) / 19.5, 0, 1);
  return Math.round(22 + t * 140);
}

function meanC(samples) {
  if (!samples.length) return 20.5;
  return samples.reduce((sum, sample) => sum + sample.c, 0) / samples.length;
}

function airColumn(opts) {
  const gear = opts.gear
    ? ' data-gear="' + esc(opts.gear) + '" data-mode="' + esc(opts.mode) + '"'
    : "";
  const aisle = opts.aisle ? ' data-aisle="' + esc(opts.aisle) + '"' : "";
  const name = opts.name ? '<span class="air-name">' + esc(opts.name) + "</span>" : "";
  return '<div class="aircol' + (opts.plume ? " plume" : "") + '" data-tone="' + esc(opts.tone) + '"' + aisle + gear +
    ' data-c="' + opts.c.toFixed(1) + '" style="--x:' + opts.x.toFixed(1) + "px;--y:" + opts.y.toFixed(1) +
    "px;--w:" + opts.w.toFixed(1) + "px;--d:" + opts.d.toFixed(1) + "px;--h:" + opts.h + "px;--base:" + (opts.base || 0) +
    "px;--air:" + opts.color + '"><i class="atop"></i><i class="afront"></i><i class="aside"></i>' + name + "</div>";
}

function thermalVolumes(pod, fit, spots) {
  const aisles = (fit.aisles || []).map((aisle) => {
    const samples = aisleSamples(pod, aisle, state.containment !== "cac");
    const c = meanC(samples);
    const hot = aisle.tone === "hot";
    return airColumn({
      tone: hot ? "hot" : "cold",
      aisle: aisle.id,
      name: (hot ? "Hot" : "Cold") + " · " + c.toFixed(1) + " °C",
      x: aisle.x,
      y: aisle.y,
      w: aisle.w,
      d: aisle.h,
      h: airColumnPx(c),
      c: c,
      color: airColor(c),
    });
  }).join("");
  const plumes = spots.map((spot) => {
    const heat = spot.mode === "heat";
    const span = heat ? Math.max(spot.boxW, spot.boxD) : Math.min(spot.reach, 150);
    const w = heat ? spot.boxW : span;
    const d = heat ? spot.boxD : span;
    return airColumn({
      plume: true,
      tone: heat ? "heat" : "cool",
      mode: spot.mode,
      gear: spot.id,
      x: spot.x - w / 2,
      y: spot.y - d / 2,
      w: w,
      d: d,
      h: heat ? airColumnPx(spot.center) : 18,
      base: heat ? spot.boxH : 0,
      c: spot.center,
      color: airColor(spot.center),
    });
  }).join("");
  return '<div class="thermal-air" aria-hidden="true">' + aisles + plumes + "</div>";
}

function tempSpan(lo: number, hi: number) {
  if (!isFinite(lo) || !isFinite(hi)) return "";
  if (Math.abs(lo - hi) < 0.05) return lo.toFixed(1) + " °C";
  return lo.toFixed(1) + "–" + hi.toFixed(1) + " °C";
}

function applyPlacedAir(samples, aisle, spots, rackKw: number, rackRise: number) {
  const midY = aisle.y + (aisle.h || 0) / 2;
  return samples.map((sample) => {
    let next = sample.c;
    spots.forEach((spot) => {
      if (!spot.heatKw) return;
      const weight = falloff(Math.hypot(spot.x - sample.x, spot.y - midY), spot.reach);
      if (weight) next += spotRise(spot, spots, rackKw, rackRise) * weight;
    });
    spots.forEach((spot) => {
      if (spot.heatKw) return;
      const weight = falloff(Math.hypot(spot.x - sample.x, spot.y - midY), spot.reach);
      if (!weight) return;
      const pull = spot.holdSupply ? 1 : (rackKw > 0 ? Math.min(1, spot.coolKw / rackKw) : 0);
      next -= (next - 20.5) * pull * weight;
    });
    return { x: sample.x, c: next };
  });
}

function hallAir(pod) {
  const fit = pod && pod.fit;
  if (!fit || !(fit.aisles || []).length) return null;
  const hac = state.containment !== "cac";
  const spots = placedSpots(pod);
  const hotBase = (fit.aisles || []).filter((aisle) => aisle.tone === "hot")
    .reduce((list, aisle) => list.concat(aisleSamples(pod, aisle, hac)), []);
  const rackRise = hotBase.length
    ? Math.max(8, hotBase.reduce((sum, sample) => sum + sample.c, 0) / hotBase.length - 20.5)
    : 15.5;
  const rackKw = PLANT.racksPerHall ? (PLANT.hallItMw * 1000) / PLANT.racksPerHall : 120;
  const roomBase = hac ? 20.5 : (hotBase.length ? Math.max.apply(null, hotBase.map((sample) => sample.c)) : 24);
  const decorated = spots.map((spot) => {
    const base = airAt(fit, spot.x, spot.y, hac, roomBase);
    const full = spot.heatKw && rackKw > 0 ? rackRise * (spot.heatKw / rackKw) : 0;
    const rise = spotRise(spot, spots, rackKw, rackRise);
    let center = base;
    if (spot.heatKw) center = base + rise;
    else if (spot.holdSupply) center = 20.5;
    else if (spot.coolKw && rackKw > 0) center = base - (base - 20.5) * Math.min(1, spot.coolKw / rackKw);
    const aisle = (fit.aisles || []).find((band) => spot.x >= band.x && spot.x <= band.x + band.w && spot.y >= band.y && spot.y <= band.y + band.h);
    const where = aisle ? (aisle.tone === "hot" ? "hot aisle" : "cold aisle") : "";
    return Object.assign({}, spot, {
      center: center,
      mode: spot.heatKw ? "heat" : "cool",
      where: where,
      caught: !!(spot.heatKw && full - rise > 0.05),
    });
  });
  return { hac, spots: decorated, rackKw, rackRise, roomBase };
}

export function gearAirSentence(item) {
  if (!state.thermalMap || !item) return "";
  const pod = podById(state.floor.podId) || PODS[0];
  const air = hallAir(pod);
  const spot = air && air.spots.find((entry) => entry.id === item.id);
  if (!spot) return "";
  if (spot.mode === "cool") return " It pulls nearby air toward the 20.5 °C supply.";
  const place = spot.where ? " in the " + spot.where : "";
  const cooled = spot.caught ? " Cooling next to it is taking that heat." : "";
  return " Air here is " + spot.center.toFixed(1) + " °C" + place + "." + cooled;
}

export function thermalOverlay(pod) {
  const fit = pod && pod.fit;
  const model = hallAir(pod);
  if (!state.thermalMap || !model) return { svg: "", scale: "", volumes: "" };
  const hac = model.hac;
  const spots = model.spots;
  const rackRise = model.rackRise;
  const rackKw = model.rackKw;
  let minIn = Infinity;
  let maxIn = -Infinity;
  let minHot = Infinity;
  let maxHot = -Infinity;
  const grads = [];
  const rects = [];
  fit.aisles.forEach((aisle) => {
    const samples = applyPlacedAir(aisleSamples(pod, aisle, hac), aisle, spots, rackKw, rackRise);
    const hot = aisle.tone === "hot";
    samples.forEach((sample) => {
      if (hot) {
        if (sample.c < minHot) minHot = sample.c;
        if (sample.c > maxHot) maxHot = sample.c;
      } else {
        if (sample.c < minIn) minIn = sample.c;
        if (sample.c > maxIn) maxIn = sample.c;
      }
    });
    const id = "therm-" + aisle.id;
    const stops = gradientStops(aisle, samples);
    grads.push('<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="' + aisle.x + '" y1="0" x2="' + (aisle.x + aisle.w) + '" y2="0">' +
      stops.map((stop) => '<stop offset="' + (stop.off * 100).toFixed(2) + '%" stop-color="' + airColor(stop.c) + '"/>').join("") +
      "</linearGradient>");
    const readings = samples.map((sample) => sample.c);
    const title = esc(aisle.label || "Aisle") + " " + tempSpan(
      Math.min.apply(null, readings.concat([Infinity])),
      Math.max.apply(null, readings.concat([-Infinity])),
    );
    rects.push('<rect data-aisle="' + esc(aisle.id) + '" data-tone="' + esc(aisle.tone || "") + '" x="' + aisle.x + '" y="' + aisle.y + '" width="' + aisle.w + '" height="' + aisle.h + '" fill="url(#' + id + ')"><title>' + title + "</title></rect>");
  });
  const room = hac ? 20.5 : (isFinite(maxHot) ? maxHot : model.roomBase);
  const cold = tempSpan(minIn, maxIn);
  const warm = tempSpan(minHot, maxHot);
  const blooms = spots.map((spot) => {
    const id = "therm-spot-" + spot.id;
    grads.push('<radialGradient id="' + id + '" gradientUnits="userSpaceOnUse" cx="' + spot.x.toFixed(1) + '" cy="' + spot.y.toFixed(1) + '" r="' + spot.reach.toFixed(1) + '">' +
      '<stop offset="0%" stop-color="' + airColor(spot.center) + '" stop-opacity="0.92"/>' +
      '<stop offset="100%" stop-color="' + airColor(spot.center) + '" stop-opacity="0"/>' +
      "</radialGradient>");
    return '<circle class="thermal-spot" data-mode="' + spot.mode + '" data-gear="' + esc(spot.id) + '" data-c="' + spot.center.toFixed(1) + '" cx="' + spot.x.toFixed(1) + '" cy="' + spot.y.toFixed(1) + '" r="' + spot.reach.toFixed(1) + '" fill="url(#' + id + ')"><title>' + esc(spot.name) + " " + spot.center.toFixed(1) + " °C</title></circle>";
  }).join("");
  const hottest = spots.filter((spot) => spot.mode === "heat").sort((a, b) => b.center - a.center)[0];
  const gearLine = hottest
    ? hottest.name + " · " + hottest.center.toFixed(1) + " °C" + (hottest.where ? " · " + hottest.where : "") + (hottest.caught ? " · cooled" : "")
    : (spots.length ? "Cooling on the floor" : "");
  const summary = "Supply 20.5 °C · cold aisles " + (cold || "inlet") + " · hot aisle " + (warm || "return") + (hac ? " return" : " exhaust");
  const label = "Thermal map. Heat stands in the hot aisle. Cold aisles stay low. " + (gearLine ? gearLine + ". " : "") + "Supply 20.5 °C. Cold aisles " + (cold || "at the inlet") +
    ". Hot aisle " + (warm || "at the return") + (hac ? " return." : " exhaust.");
  const scale = '<div class="thermal-scale"><i aria-hidden="true"></i><span>' +
    (gearLine ? "<b>" + esc(gearLine) + "</b>" : "") + esc(summary) + "</span></div>";
  const svg = '<svg class="thermal-map" role="img" aria-label="' + esc(label) + '" viewBox="0 0 ' + pod.w + " " + pod.h + '" preserveAspectRatio="none">' +
    "<defs>" + grads.join("") + "</defs>" +
    '<rect class="thermal-room" data-tone="room" width="' + pod.w + '" height="' + pod.h + '" fill="' + airColor(room) + '" opacity="0.16"/>' +
    rects.join("") + blooms + "</svg>";
  return { svg, scale, volumes: thermalVolumes(pod, fit, spots) };
}

/* ---------- Heat map: clouds of heat and cold spots ----------
   Every number comes from the same readings the racks and CDUs show, so a
   Simulate scenario (CDU failure, heat-rejection trip, feeder loss) moves the
   clouds as it plays: exhaust grows the hot clouds, hot inlets push them over
   the racks into the cold aisle, and a failing CDU loses its cold spot. */

export type HeatCloud = {
  id: string;
  kind: "hot" | "cold";
  name: string;
  x: number;
  y: number;
  r: number;
  c: number;
  strength: number;
  spill: number;
  failed?: boolean;
};

function cloudHash(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 9973;
  return h;
}

function coolerStrength(entity) {
  if (!entity || !entity.load) return 0;
  const flow = clamp((entity.load.power || 0) / 60, 0, 1);
  const chill = clamp((48 - (entity.load.temp || 34)) / 14, 0, 1);
  return flow * chill;
}

export function heatCloudModel(pod): HeatCloud[] {
  const fit = pod && pod.fit;
  if (!fit) return [];
  const rows = {};
  (fit.rows || []).forEach((row) => { rows[row.id] = row; });
  const aisles = {};
  (fit.aisles || []).forEach((aisle) => { aisles[aisle.id] = aisle; });
  const clouds: HeatCloud[] = [];
  (pod.racks || []).forEach((rack) => {
    if (rack.kind === "Power") return;
    const air = rackAir(rack);
    if (!air) return;
    const row = rows[rack.row];
    const hot = row && aisles[row.hot];
    const cold = row && aisles[row.cold];
    const cx = rack.x + rack.w / 2;
    const cy = rack.y + rack.d / 2;
    const hotY = hot ? hot.y + hot.h / 2 : cy;
    const coldY = cold ? cold.y + cold.h / 2 : cy;
    const heat = clamp((air.exhaust - 30) / 15, 0, 1);
    // Inlet above 24 °C means exhaust is spilling back over the rack into the cold aisle.
    const spill = clamp((air.inlet - 24) / 3, 0, 1);
    const hotAt = hotY + (coldY - hotY) * spill * 0.7;
    clouds.push({
      id: "hot-" + rack.id,
      kind: "hot",
      name: "Rack " + rack.id + " exhaust",
      x: cx,
      y: cy + (hotAt - cy) * (0.55 + 0.35 * heat),
      r: rack.w * (0.9 + 1.7 * heat + 0.6 * spill),
      c: air.exhaust,
      strength: heat,
      spill: spill,
    });
    const chill = clamp((26 - air.inlet) / 5.5, 0, 1);
    if (chill > 0.04) {
      clouds.push({
        id: "cold-" + rack.id,
        kind: "cold",
        name: "Rack " + rack.id + " inlet",
        x: cx,
        y: cy + (coldY - cy) * 0.7,
        r: rack.w * (0.5 + 1.0 * chill),
        c: air.inlet,
        strength: chill,
        spill: 0,
      });
    }
  });
  (pod.boxes || []).forEach((box) => {
    const entity = entityById(box.id);
    if (!entity || entity.kind !== "Cooling" || !entity.load) return;
    const cool = coolerStrength(entity);
    const x = box.x + (box.w || 48) / 2;
    const y = box.y + (box.d || 48) / 2;
    const size = Math.max(box.w || 48, box.d || 48);
    if (cool > 0.04) {
      clouds.push({ id: "cold-" + box.id, kind: "cold", name: entity.name + " supply", x, y, r: size * (0.8 + 1.4 * cool), c: 20.5, strength: cool, spill: 0 });
    } else {
      // A CDU that has stopped cooling becomes a warm patch: hall return air, no supply.
      const c = Math.min(40, Math.max(30, (entity.load.temp || 48) - 10));
      clouds.push({ id: "hot-" + box.id, kind: "hot", name: entity.name + " (not cooling)", x, y, r: size * 1.2, c, strength: clamp((c - 30) / 10, 0.3, 1), spill: 0, failed: true } as HeatCloud);
    }
  });
  return clouds;
}

export function heatCloudsHtml(pod) {
  const clouds = heatCloudModel(pod);
  if (!clouds.length) return { svg: "", scale: "" };
  const hot = clouds.filter((cloud) => cloud.kind === "hot").sort((a, b) => b.c - a.c);
  const cold = clouds.filter((cloud) => cloud.kind === "cold").sort((a, b) => b.strength - a.strength);
  const failedCdu = hot.filter((cloud) => cloud.failed);
  const spill = hot.filter((cloud) => cloud.spill > 0.2).length;
  const parts = clouds.map((cloud) => {
    const h = cloudHash(cloud.id);
    const amp = 3 + 9 * cloud.strength;
    const dx = ((h % 7) - 3) / 3 * amp;
    const dy = (cloud.kind === "hot" ? -1 : 1) * (1 + (h % 3)) / 3 * amp;
    const opacity = (cloud.kind === "hot" ? 0.2 + 0.42 * cloud.strength : 0.18 + 0.4 * cloud.strength).toFixed(2);
    const color = cloud.kind === "hot" ? airColor(Math.max(cloud.c, 30)) : airColor(Math.min(cloud.c, 22));
    const puff = cloud.r * 0.42;
    return '<g class="cloud" data-kind="' + cloud.kind + '" data-id="' + esc(cloud.id) + '" data-c="' + cloud.c.toFixed(1) +
      '" data-strength="' + cloud.strength.toFixed(2) + '" data-x="' + cloud.x.toFixed(1) + '" data-y="' + cloud.y.toFixed(1) +
      '" data-r="' + cloud.r.toFixed(1) + '" style="--dx:' + dx.toFixed(1) + "px;--dy:" + dy.toFixed(1) + "px;--t:" + (6 + (h % 5)) +
      "s;--d:-" + (h % 6) + 's" fill="' + color + '" opacity="' + opacity + '"><title>' + esc(cloud.name) + " " + cloud.c.toFixed(1) + " °C</title>" +
      '<circle cx="' + cloud.x.toFixed(1) + '" cy="' + cloud.y.toFixed(1) + '" r="' + cloud.r.toFixed(1) + '"/>' +
      '<circle cx="' + (cloud.x - puff).toFixed(1) + '" cy="' + (cloud.y + puff * 0.3).toFixed(1) + '" r="' + (cloud.r * 0.7).toFixed(1) + '"/>' +
      '<circle cx="' + (cloud.x + puff).toFixed(1) + '" cy="' + (cloud.y - puff * 0.25).toFixed(1) + '" r="' + (cloud.r * 0.62).toFixed(1) + '"/>' +
      '<circle cx="' + (cloud.x + puff * 0.2).toFixed(1) + '" cy="' + (cloud.y + puff * 0.9).toFixed(1) + '" r="' + (cloud.r * 0.48).toFixed(1) + '"/></g>';
  }).join("");
  const hottest = hot[0];
  const coolest = cold[0];
  const summary = (hottest ? "Hottest: " + hottest.name + " " + hottest.c.toFixed(1) + " °C. " : "") +
    (failedCdu.length ? failedCdu.map((cloud) => cloud.name).join(", ") + ". " : "") +
    (spill ? spill + " hot cloud" + (spill === 1 ? "" : "s") + " spreading toward the cold aisle. " : "") +
    (coolest ? "Coldest spot: " + coolest.name + "." : "No cold spots: cooling is not reaching the racks.");
  const svg = '<svg class="heat-clouds" role="img" aria-label="' + esc("Heat map. " + summary) + '" viewBox="0 0 ' + pod.w + " " + pod.h +
    '" preserveAspectRatio="none"><defs><filter id="heat-cloud-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="' +
    Math.max(10, Math.round(pod.w / 48)) + '"/></filter></defs><g filter="url(#heat-cloud-blur)">' + parts + "</g></svg>";
  const scale = '<div class="thermal-scale heat-scale" id="heat-map-status" aria-live="polite"><i aria-hidden="true"></i><span>' +
    (hottest ? "<b>" + esc(hottest.name + " · " + hottest.c.toFixed(1) + " °C") + "</b>" : "") +
    esc("Heat map · " + hot.length + " hot, " + cold.length + " cold" + (failedCdu.length ? " · " + failedCdu.map((cloud) => cloud.name).join(", ") : "")) +
    "</span></div>";
  return { svg, scale };
}

function airAt(fit, x: number, y: number, hac: boolean, room: number) {
  const aisle = (fit.aisles || []).find((band) => x >= band.x && x <= band.x + band.w && y >= band.y && y <= band.y + band.h);
  if (!aisle) return room;
  if (aisle.tone === "cold") return 22;
  return hac ? 36 : room;
}

export function fitHtml(pod, report?: SimImpact | null) {
  const fit = pod.fit;
  if (!fit) return "";
  const aisles = (fit.aisles || []).map((band) => '<div class="aisle ' + band.tone + '" data-act="floor-server" data-server="' +
    band.id + '" style="--x:' + band.x + "px;--y:" + band.y + "px;--w:" + band.w + "px;--h:" + band.h + 'px"><span>' +
    esc(band.label) + "</span></div>").join("");
  const containment = fit.containment ? boxHtml(fit.containment, heatBand(entityById(fit.containment.id)), "floor-server", {
    pod: pod.id, server: fit.containment.id, klass: "containment", cap: "Containment", leds: [],
  }, report) : "";
  const bus = fit.busbar ? boxHtml(fit.busbar, heatBand(entityById(fit.busbar.id)), "floor-server", {
    pod: pod.id, server: fit.busbar.id, klass: "busbar", cap: "Bus bar", leds: [],
  }, report) : "";
  const rows = (fit.rows || []).map((row) => '<button type="button" class="row-tag" data-act="floor-row" data-pod="' +
    pod.id + '" data-row="' + row.id + '" style="--y:' + row.y + 'px">' + esc(row.name) + "</button>").join("");
  return aisles + containment + bus + rows;
}

function gearLed(entity) {
  const tone = conditionTone(entity);
  return '<em class="led" data-heat-for="' + entity.id + '" title="' + esc(tone.word) + '" style="background:' +
    tone.color + '"></em>';
}

function gearFace(rack) {
  if (rack.kind === "Power") return "";
  const entities = rackEntities(rack);
  const gpus = entities.filter((entity) => entity.kind === "GPU tray");
  const bars = [];
  for (let slot = 0; slot < 8; slot += 1) {
    const entity = gpus.length ? gpus[slot % gpus.length] : null;
    const color = entity ? conditionTone(entity).color : "#1f6f68";
    const led = entity && slot < gpus.length ? gearLed(entity) : '<em class="led" style="background:' + color + '"></em>';
    bars.push('<b class="gear gpu" style="--gear:' + color + '">' + led + "</b>");
  }
  const network = entities.find((entity) => entity.kind === "Switch");
  const shelf = entities.find((entity) => entity.kind === "Power shelf");
  bars.push('<b class="gear net">' + (network ? gearLed(network) : "") + "</b>");
  bars.push('<b class="gear shelf">' + (shelf ? gearLed(shelf) : "") + "</b>");
  return '<span class="gear-stack" aria-hidden="true">' + bars.join("") + "</span>";
}

function rowBuses(pod) {
  const groups = {};
  pod.racks.forEach((rack) => {
    if (rack.kind === "Power") return;
    const key = rack.row || "row";
    if (!groups[key]) groups[key] = [];
    groups[key].push(rack);
  });
  return Object.keys(groups).map((key) => {
    const racks = groups[key];
    const x0 = Math.min.apply(null, racks.map((rack) => rack.x));
    const x1 = Math.max.apply(null, racks.map((rack) => rack.x + rack.w));
    const sample = racks[0];
    const south = String(sample.row || "").slice(-1) === "s";
    const y = south ? sample.y - 8 : sample.y + sample.d - 4;
    return '<div class="row-bus" aria-hidden="true" style="--x:' + x0 + "px;--y:" + y + "px;--w:" + (x1 - x0) + 'px"></div>';
  }).join("");
}

function povLine(racks, line, podId) {
  const centers = racks.map((rack) => rack.x + rack.w / 2);
  const x0 = Math.min.apply(null, centers);
  const x1 = Math.max.apply(null, centers);
  const current = runtime.walk && runtime.walk.stops[runtime.walk.index].rack.id;
  const faces = racks.map((rack) => '<button type="button" class="pov-rack' + (rack.id === current ? " walk-here" : "") + '" data-act="floor-rack" data-pod="' + podId +
    '" data-rack="' + esc(rack.id) + '" style="--x:' + (rack.x + rack.w / 2) + '"><span class="pov-name">' +
    esc(rack.name) + '</span><span class="pov-face">' + gearFace(rack) + "</span></button>").join("");
  return '<div class="pov-line" data-line="' + line + '"><div class="pov-bus" style="--x0:' + x0 + ";--x1:" + x1 +
    '"></div>' + faces + "</div>";
}

function renderPov(pod) {
  const walk = runtime.walk;
  const stop = walk.stops[walk.index];
  const eye = stop.rack.x + stop.rack.w / 2;
  const line = southRack(stop.rack) ? "s" : "n";
  const north = pod.racks.filter((rack) => !southRack(rack));
  const south = pod.racks.filter(southRack);
  return '<div class="scene thermal walking pov-scene">' + hudHtml() +
    '<div class="pov" aria-label="Eye-level aisle"><div class="pov-ceiling"></div><div class="pov-floor"></div>' +
    '<div class="pov-rig" data-line="' + line + '" style="--eye:' + eye.toFixed(1) + ';--yaw:0deg">' +
    povLine(north, "n", pod.id) + povLine(south, "s", pod.id) +
    "</div></div>" + walkBar() + "</div>";
}

export function renderHall() {
  const open = podById(state.floor.podId) || PODS[0];
  if (runtime.walk && runtime.walk.podId === open.id) return renderPov(open);
  const report = impact(runtime.sim);
  // The heat map takes the place of the thermal overlay while it is on.
  const clouds = state.heatMap ? heatCloudsHtml(open) : { svg: "", scale: "" };
  const overlay = state.heatMap ? { svg: "", scale: clouds.scale, volumes: "" } : thermalOverlay(open);
  const pods = [open].map((pod) => {
    const racks = pod.racks.map((rack) => {
      const facing = (rack.row || "").slice(-1) === "s" ? "face-south" : "face-north";
      const power = rack.kind === "Power";
      const here = runtime.walk && runtime.walk.podId === pod.id && runtime.walk.stops[runtime.walk.index].rack.id === rack.id;
      const planned = state.horizon === "future" && (runtime.futureChanges || []).some((change) => change.rackId === rack.id);
      return boxHtml(rack, worstBand(rackEntities(rack)), "floor-rack", {
        pod: pod.id, rack: rack.id, leds: rackEntities(rack),
        klass: (power ? "powershelf " : "loaded ") + facing + (here ? " walk-here" : "") + (pulsing(rack.id) ? " is-pulse" : ""),
        cap: power ? "50 VDC" : (planned ? "Planned" : "Front"),
        plan: planned ? "future" : "",
        face: power ? "" : gearFace(rack),
      }, report);
    }).join("");
    const boxes = (pod.boxes || []).map((box) => {
      const entity = entityById(box.id);
      const shelf = entity && entity.kind === "Powershelf";
      return boxHtml(box, heatBand(entity), "floor-server", {
        pod: pod.id, server: box.id, leds: [],
        klass: shelf ? "powershelf" : "",
        cap: box.name || (shelf ? "DC shelf" : PLANT.cduMw + " MW CDU"),
      }, report);
    }).join("");
    const current = state.floor.level === "pod" && state.floor.podId === pod.id ? " current" : "";
    return '<div class="pod' + current + (overlay.svg ? " thermal-on" : "") + '" data-act="floor-pod" data-pod="' + pod.id + '" style="--x:' + pod.x +
      "px;--y:" + pod.y + "px;--w:" + pod.w + "px;--h:" + pod.h + 'px"><i class="pod-plate"></i><span class="pod-letter">' +
      esc(pod.letter) + "</span>" + fitHtml(pod, report) + overlay.svg + (overlay.volumes || "") + rowBuses(pod) + racks + boxes + clouds.svg + walkerHtml(pod) + podFeeds(pod, report) + "</div>";
  }).join("");
  const legend = legendPop('<span class="pri-mark pri-0">—</span><span>Nominal</span><span class="pri-mark pri-3">3</span><span>Rise</span><span class="pri-mark pri-2">2</span><span>Hot / RDP</span><span class="pri-mark pri-1">1</span><span>BMC / leak</span>');
  if (runtime.floor3d) return renderHall3d(open, legend, overlay.scale);
  return '<div class="scene thermal' + (runtime.walk ? " walking" : "") + '">' + hudHtml(legend) + '<div class="stage"><div class="world' +
    (report.active ? " sim-active" : "") + '" data-lod="' + floorLod() + '" style="transform:' + cameraTransform() +
    ";--pitch:" + state.floor.pitch + "deg;--yaw:" + state.floor.yaw + 'deg"><div class="slab"></div>' + pods + planBoxes("floor") +
    "</div></div>" + overlay.scale + walkBar() + "</div>";
}

/* Experimental: views/floor3d.ts draws the hall into this host with three.js after paint. */
function renderHall3d(pod, legend, scale) {
  const hot = heatCloudModel(pod).filter((cloud) => cloud.kind === "hot").length;
  const label = "Experimental 3D view of " + pod.name + ". " + pod.racks.length + " racks, " + hot +
    " heat sources. Drag to orbit, scroll to zoom, click a rack to open it. Use List for the same racks by keyboard.";
  return '<div class="scene thermal floor3d-scene">' + hudHtml(legend) + '<div class="stage floor3d-stage"><div id="floor3d-host" class="floor3d-host" role="img" aria-label="' +
    esc(label) + '" data-floor3d="loading"><span class="floor3d-badge">Experimental · three.js</span></div></div>' + scale + "</div>";
}

export function toggleFloor3d() {
  runtime.floor3d = !runtime.floor3d;
  if (runtime.floor3d) stopWalk(true, false);
  state.focusField = "floor3d-toggle";
  render();
}

export function renderSite() {
  const report = impact(runtime.sim);
  const shell = PODS.map((hall) => boxHtml(hall.site, "ok", "floor-hall", {
    klass: "building", color: hall.managed ? "#d9d2c8" : "#e4ddd4", cap: hall.name,
    pod: hall.id, attrs: ' data-level="hall"', leds: [],
  }, report)).join("");
  const gear = YARD.map((item) => boxHtml(item, heatBand(entityById(item.id)), "floor-server", {
    server: item.id, klass: (item.klass || "") + (pulsing(item.id) ? " is-pulse" : ""), cap: item.name, color: item.klass === "heat-yard" ? "#2f4a3c" : (item.klass === "core-block" ? "#1c1c1c" : "#3a342e"), leds: [],
  }, report)).join("");
  const legend = legendPop('<span class="feed-key cable"></span><span>Grid feeder</span><span class="pipe-key supply"></span><span>Supply pipe</span><span class="pipe-key return"></span><span>Return pipe</span>');
  return '<div class="scene thermal site-scene">' + hudHtml(legend) + '<div class="stage"><div class="world' +
    (report.active ? " sim-active" : "") + '" style="transform:' + cameraTransform() +
    ";--pitch:" + state.floor.pitch + "deg;--yaw:" + state.floor.yaw + 'deg"><div class="slab yard-slab"></div>' + shell + gear + futureYardHtml() + planBoxes("yard") +
    siteFeedHtml(undefined, report) + sitePipesHtml(undefined, undefined, report) + "</div></div></div>";
}

function unitKind(item) {
  const cat = String(item.category || item.kind || "").toLowerCase();
  const name = String((item.model || "") + " " + (item.assetTag || "") + " " + (item.name || "")).toLowerCase();
  if (cat.indexOf("switch") >= 0 || name.indexOf("sn2201") >= 0) return "net";
  if (cat === "pdu" || cat.indexOf("shelf") >= 0 || name.indexOf("shelf") >= 0) return "shelf";
  if (cat.indexOf("gpu") >= 0 || name.indexOf("gpu") >= 0 || name.indexOf("tray") >= 0) return "gpu";
  return "server";
}

function frontMounts(mounts) {
  return mounts.filter((item) => item.uHeight && item.uPosition && (item.face || "front") !== "rear");
}

function mountButton(item) {
  const label = item.model || item.assetTag || "Device";
  const where = item.uPosition ? '<span class="rack-u">U' + item.uPosition + "</span>" : "";
  return '<button type="button" class="rack-unit ' + unitKind(item) + '" data-act="elev-device" data-tag="' +
    esc(item.assetTag) + '" style="--u:' + item.uPosition + ";--h:" + item.uHeight + '"><span class="rack-vents"></span><b>' +
    esc(label) + "</b>" + where + "</button>";
}

function stackUnits(rack) {
  const entities = rackEntities(rack);
  const gpus = entities.filter((entity) => entity.kind === "GPU tray");
  const network = entities.find((entity) => entity.kind === "Switch");
  const shelf = entities.find((entity) => entity.kind === "Power shelf" || entity.kind === "Powershelf");
  const bars = [];
  for (let slot = 0; slot < 8; slot += 1) {
    const entity = gpus[slot] || null;
    const act = entity ? ' data-act="floor-server" data-server="' + esc(entity.id) + '"' : "";
    bars.push('<button type="button" class="rack-unit gpu"' + act + '><span class="rack-vents"></span><b>' +
      esc(entity ? entity.name : "GPU") + "</b></button>");
  }
  bars.push('<button type="button" class="rack-unit net"' + (network ? ' data-act="floor-server" data-server="' + esc(network.id) + '"' : "") +
    '><span class="rack-vents"></span><b>' + esc(network ? network.name : "Switch") + "</b></button>");
  bars.push('<button type="button" class="rack-unit shelf"' + (shelf ? ' data-act="floor-server" data-server="' + esc(shelf.id) + '"' : "") +
    '><span class="rack-vents"></span><b>' + esc(shelf ? shelf.name : "DC shelf") + "</b></button>");
  return bars.join("");
}

function zeroUnits(mounts) {
  return mounts.filter((item) => !item.uHeight).map((item) => '<button type="button" class="rack-zero" data-act="elev-device" data-tag="' +
    esc(item.assetTag) + '">' + esc(item.model || item.assetTag) + "</button>").join("");
}

function cabinetBay(rack) {
  const data = runtime.elevation;
  const mounts = data && data.rackId === rack.id && Array.isArray(data.mounts) ? data.mounts : null;
  const front = mounts ? frontMounts(mounts) : [];
  if (front.length) {
    const used = front.reduce((sum, item) => sum + item.uHeight, 0);
    const buttons = front.slice().sort((a, b) => b.uPosition - a.uPosition).map(mountButton).join("");
    const bay = used >= 16 ? "placed" : "sparse";
    const voidSpace = bay === "sparse" ? '<div class="rack-void"></div>' : "";
    return '<div class="rack-post">' + zeroUnits(mounts) + '</div><div class="rack-bay ' + bay + '">' + voidSpace + buttons + "</div>";
  }
  return '<div class="rack-post"></div><div class="rack-bay stack">' + stackUnits(rack) + "</div>";
}

/* The floor drill-down uses the same 3D rack as Operate › Rack. Details for the rack
   or the server picked in it open in the inspector on the right. */
export function renderRackScene(rack, pod) {
  return '<div class="scene rack-scene elevation" data-rack-host="' + esc(rack.id) + '" aria-label="' + esc(pod.name + " " + rack.name) + '">' +
    rackViewHtml(rack.id, "floor") + "</div>";
}

export function renderChassis(rack, pod) {
  return '<div class="scene chassis-scene thermal elevation" data-rack-host="' + esc(rack.id) + '">' + hudHtml() +
    '<div class="rack-view" aria-label="' + esc(pod.name) + " " + esc(rack.name) + '"><div class="rack-cab">' +
    cabinetBay(rack) + '<div class="rack-post bus" aria-hidden="true"></div></div></div></div>';
}

export function gaugeRow(entity, key, label) {
  const value = Math.round(entity.load[key] || 0);
  return '<div class="gauge"><span>' + label + '</span><div class="meter"><span data-part="' + key + '" style="width:' +
    value + '%"></span></div><b>' + value + "%</b></div>";
}

export function yardArt(entity) {
  const placed = YARD.find((gear) => gear.id === entity.id);
  const klass = placed ? placed.klass : (entity.id === "pipe-ret" ? "pipe-return" : "pipe-supply");
  const caption = {
    "grid-yard": "Gantry with three bushings. The lines arrive from the utility grid.",
    "xfmr-yard": "Tank, radiator fins, and the high-voltage bushings.",
    "module-yard": "Louvered cabinet. The feeder from the transformer lands here.",
    "battery-yard": "Cell racks on a skid, cabled to the power module.",
    "cooler-yard": "Fan deck. This is where the hall heat leaves the site.",
    "hydro-yard": "Two pumps and a manifold, sitting on the yard pipes.",
    "pipe-supply": "Cool supply. It runs along the outside of the east wall.",
    "pipe-return": "Warm return. It runs beside the supply and stays outside the hall.",
  };
  return '<div class="yard-sheet ' + klass + '"><div class="yard-art" aria-hidden="true"></div><p class="fine">' +
    esc(caption[klass] || "") + "</p></div>";
}

export function serverInspector(entity) {
  const band = heatBand(entity);
  const managed = !!deviceById(entity.id);
  const score = Math.round(entityScore(entity));
  const parts = isFacility(entity)
    ? gaugeRow(entity, "power", "Load") + gaugeRow(entity, "temp", "Temperature")
    : gaugeRow(entity, "gpu", "GPU") + gaugeRow(entity, "mem", "Memory") + gaugeRow(entity, "power", "Power") + gaugeRow(entity, "temp", "Temperature");
  let action = "";
  if (managed && entity.bmc === "down") {
    const where = waiting(entity) ? "ACS serial is coming up on " + entity.tty + "." : "ACS serial is up on " + entity.tty + ".";
    action = "<p>" + esc(where) + " This is the out-of-band path. RM1048 does not take the failover.</p>" +
      '<button type="button" class="act primary" data-act="floor-serial" data-device="' + entity.id + '">Open ACS serial</button>';
  } else if (managed && entity.kind === "GPU tray" && entity.rdp === "down") {
    action = "<p>In-band RDP is down. The device view below offers the MPU2 KVM failover.</p>";
  } else if (managed) {
    action = "";
  } else if (entity.kind === "Grid") {
    const side = entity.id === "grid-2" ? "b" : "a";
    action = yardArt(entity) + "<p>The utility grid lands on a gantry outside the shell. One feeder is closed through the transformer and the power module, and it stops at the hall wall.</p>" +
      '<button type="button" class="act" data-act="floor-feed" data-feed="grid-xfmr-' + side + '">Open Feeder ' + side.toUpperCase() + "</button>";
  } else if (entity.kind === "Pipe") {
    const supply = entity.id === "pipe-sup";
    action = yardArt(entity) + "<p>" + (supply
      ? "Supply piping carries cool fluid from the heat rejection and hydro skid to the outside of the shell."
      : "Return piping carries warm fluid from the shell wall back to the heat rejection. It never crosses the compute floor.") + "</p>";
  } else if (entity.kind === "Heat rejection") {
    action = yardArt(entity) + "<p class=\"fine\">Dry cooler outside the hall. Fan decks reject the heat the pipes bring out of the shell.</p>";
  } else if (entity.kind === "Cooling" && entity.yard) {
    action = yardArt(entity) + "<p class=\"fine\">Hydro skid. Pumps sit on the yard manifold, on the supply and return pipes.</p>";
  } else if (entity.kind === "Power module" && entity.yard) {
    action = yardArt(entity) + "<p class=\"fine\">This stays outside the building. The feeder from the grid is the conductor you can follow to the hall wall.</p>" +
      '<button type="button" class="act" data-act="floor-go" data-level="hall">Enter the hall</button>';
  } else if (entity.kind === "Core") {
    action = "<p class=\"fine\">The OneCore block holds shared interconnect, utility distribution, and controls. Compute halls scale around it.</p>" +
      '<button type="button" class="act" data-act="floor-go" data-level="hall">Enter the hall</button>';
  } else if (entity.yard) {
    action = "<p class=\"fine\">This stays outside the building. The hall is entered separately. ACS-A14 does not open a session here.</p>" +
      '<button type="button" class="act" data-act="floor-go" data-level="hall">Enter the hall</button>';
  } else if (entity.kind === "Busway") {
    const home = PODS.find((item) => item.fit && item.fit.busbar && item.fit.busbar.id === entity.id);
    action = "<p class=\"fine\">Overhead bus bar along the hot aisle. The trace to the DC shelf is energized while that shelf feed is closed.</p>" +
      (home ? '<button type="button" class="act" data-act="floor-feed" data-pod="' + home.id + '" data-feed="bus-' + home.id + '">Open the feed</button>' : "");
  } else if (entity.kind === "Containment") {
    action = "<p class=\"fine\">Hot aisle containment. The hood closes the exhaust aisle. A rack row stands on each side, between this aisle and the cold aisles.</p>";
  } else if (entity.kind === "Aisle") {
    const home = podById(entity.pod);
    const beside = home && home.fit && home.fit.rows ? home.fit.rows.filter((row) => row.cold === entity.id || row.hot === entity.id) : [];
    const hotAisle = entity.name.indexOf("Hot") === 0;
    action = "<p class=\"fine\">" + (hotAisle ? "Exhaust aisle. A rack row stands on each side, so this aisle never touches a cold aisle." : "Supply aisle. The row beside it faces this air.") + "</p>" +
      beside.map((row) => '<button type="button" class="floor-row" data-act="floor-row" data-pod="' + home.id + '" data-row="' + row.id + '"><span>' +
        esc(row.name) + "</span><b>Row</b></button>").join("");
  } else if (entity.kind === "Powershelf") {
    const home = podById(entity.pod);
    action = "<p class=\"fine\">50 V DC power shelf in the row. Fed from the overhead bus bar.</p>" +
      (home ? '<button type="button" class="act" data-act="floor-feed" data-pod="' + home.id + '" data-feed="bus-' + home.id + '">Open the feed</button>' : "");
  } else if (isFacility(entity)) {
    action = "<p class=\"fine\">Facility equipment. Simulated load, not an ACS serial target.</p>";
  } else {
    action = "<p class=\"fine\">Outside rack A14. ACS-A14 does not open a serial session here.</p>";
  }
  const heatNote = !isFacility(entity) && entity.load ? thermalCard(entity) : "";
  const faces = !isFacility(entity) && entity.load ? deviceFaces(entity) : "";
  const inside = faces ? "" : (!isFacility(entity) && entity.load ? deviceParts(entity) : "");
  const breaks = breakThisHtml(entity.id, breakEventsForEntity(entity));
  const ports = !isFacility(entity) && entity.load ? deviceViewHtml(entity) : "";
  return '<div data-load-for="' + entity.id + '"><p class="band-label ' + band + '">' + esc(bandLabel(band)) + " · " + score +
    '%</p><h2>' + esc(entity.name) + "</h2><p class=\"fine\">" + esc(entity.kind) + (managed ? " · simulated BMC" : " · simulated load") + "</p>" + action + ports + faces + heatNote + parts + inside + breaks + powerHtml(entity.id) + "</div>";
}

export function deviceParts(entity) {
  const parts = [["inlet", "Inlet"], ["exhaust", "Exhaust"], ["bmc", "BMC"], ["feed", "DC feed"]];
  return '<h3>Inside</h3><div class="part-row">' + parts.map((part) => '<button type="button" class="act" data-act="floor-part" data-server="' +
    entity.id + '" data-part="' + part[0] + '">' + part[1] + "</button>").join("") + "</div>";
}

export function energWord(mode) {
  if (mode === "open") return "De-energized";
  if (mode === "partial") return "Partly energized";
  return "Energized";
}

export function partPanel(entity) {
  const part = state.floor.partId || "inlet";
  const heat = thermalReading(entity);
  const outlet = outletForDevice(entity.id);
  const mode = outlet ? whipMode(entity.id) : "live";
  const faces = !isFacility(entity) && entity.load ? deviceFaces(entity) : "";
  let body = "";
  if (part === "exhaust") {
    body = "<h2>Rear exhaust</h2><p>Exhaust leaves at <b>" + heat.exhaust.toFixed(1) + " °C</b> into the " +
      (heat.hac ? "contained hot aisle." : "open hall.") + "</p><p class=\"fine\">The rear of this device faces the hot aisle. The row in front of it faces the cold aisle.</p>";
  } else if (part === "bmc") {
    const down = entity.bmc === "down";
    const local = deviceById(entity.id) && !entity.serialOnly;
    body = "<h2>BMC</h2><p>" + (down ? "This path is dark. Failover is ACS serial, out of band." : "The manager is up. ACS serial stays the out-of-band wire.") + "</p>" +
      (local ? '<button type="button" class="act primary" data-act="' + (down ? "floor-serial" : "launch") + '" data-device="' + entity.id +
        '" data-path="' + (down ? "" : "rm") + '" data-type="' + (down ? "" : "kvm") + '">' + (down ? "Open ACS serial" : "Open BMC console") + "</button>" : '<p class="fine">Outside ACS-A14. The reading is simulated.</p>');
  } else if (part === "feed") {
    const where = outlet ? " Outlet " + outlet.n + " is " + outlet.power + "." : " This device follows the row shelf.";
    body = "<h2>DC feed</h2><p><b>" + energWord(mode) + ".</b>" + esc(where) + " The trace on the floor uses this same reading.</p>" +
      (outlet ? '<button type="button" class="act" data-act="nav" data-view="control">Open control</button>' : "");
  } else {
    const mark = heat.pri ? '<b class="pri-mark pri-' + heat.pri + '">' + heat.pri + "</b> " : "";
    body = "<h2>Rack inlet</h2><p>" + mark + "<b>" + heat.inlet.toFixed(1) + " °C</b>. " + esc(heat.envelope) + ".</p>" +
      (heat.recirculation ? "<p>This U is high in the rack. Cold-aisle containment is recirculating supply air here.</p>" : "") +
      '<p class="fine">Supply is 20.5 °C at the cold-aisle face. An inlet past the study band raises an alarm on its own.</p>';
  }
  return faces + body;
}

export function feedPanel() {
  const id = state.floor.feedId;
  const mode = feedMode(id);
  let copy = "This segment is " + energWord(mode).toLowerCase() + ". The state is read from the gear on the path.";
  let next = "";
  if (id.indexOf("whip-") === 0) {
    const rackId = id.slice(5);
    const pod = PODS.find((item) => item.racks.some((rack) => rack.id === rackId));
    const rack = pod && pod.racks.find((item) => item.id === rackId);
    copy = (rack ? rack.name : "This rack") + " is fed from the DC shelf. " + copy;
    if (pod && rack) {
      next = '<button type="button" class="act" data-act="floor-rack" data-pod="' + pod.id + '" data-rack="' + rack.id + '">Open ' + esc(rack.name) + "</button>";
    }
  } else if (id.indexOf("bus-") === 0) {
    copy = "Bus bar to the DC shelf. " + copy + (mode === "open" ? " The shelf outlet is open, so the row behind it is dark." : " The shelf outlet is closed.");
  } else if (id === "grid-xfmr") {
    copy = "Utility feeder from the grid gantry to the MV transformer. Energized. The conductor stays in the yard.";
    next = '<button type="button" class="act" data-act="floor-server" data-server="grid-1">Open the grid</button>';
  } else if (id === "grid-xfmr-a" || id === "grid-xfmr-b") {
    const side = id === "grid-xfmr-a" ? "A" : "B";
    copy = "Feeder " + side + ". Utility feeder from the grid gantry to MV transformer " + side + ". " + copy + " The conductor stays in the yard.";
    next = '<button type="button" class="act" data-act="floor-server" data-server="' + (side === "A" ? "grid-1" : "grid-2") + '">Open the grid</button>';
  } else if (id === "grid-future") {
    copy = "Second feeder to the planned power module. It is drawn with the future state, beside the feeder that is closed today.";
  } else if (id === "xfmr-mod") {
    copy = "Medium-voltage transformer to the power module. Energized.";
  } else if (id === "batt-mod") {
    copy = "Battery skid onto the power module. Energized for ride-through.";
  } else if (id.indexOf("feed-hall-") === 0) {
    const hall = podById(id.slice(10));
    copy = "Power to " + (hall ? hall.name : "this hall") + ". The feeder follows the hall when it moves. Each hall draws " + PLANT.hallItMw + " MW.";
  } else if (id.indexOf("feed-") === 0) {
    copy = "Power module bus to a hall wall. Energized. Each hall draws " + PLANT.hallItMw + " MW.";
  }
  return "<h2>" + energWord(mode) + "</h2><p>" + esc(copy) + "</p>" + next;
}

export function rowPanel(pod, row) {
  const cold = entityById(row.cold);
  const hot = entityById(row.hot);
  const racks = pod.racks.filter((rack) => rack.row === row.id);
  return "<h2>" + esc(row.name) + "</h2><p class=\"fine\">This row stands between " + esc(cold ? cold.name : "the cold aisle") +
    " and " + esc(hot ? hot.name : "the hot aisle") + ". Fronts face the cold aisle. Backs exhaust into the hot aisle.</p><h3>Racks</h3>" +
    racks.map((rack) => '<button type="button" class="floor-row" data-act="floor-rack" data-pod="' + pod.id + '" data-rack="' + rack.id + '">' +
      ledDot(rackEntities(rack)) + "<span>" + esc(rack.name) + "</span><b>" + energWord(rackEnergized(pod, rack)) + "</b></button>").join("") +
    '<h3>Aisles</h3><button type="button" class="floor-row" data-act="floor-server" data-server="' + row.cold + '"><span>Cold aisle</span><b>Supply</b></button>' +
    '<button type="button" class="floor-row" data-act="floor-server" data-server="' + row.hot + '"><span>Hot aisle</span><b>Exhaust</b></button>';
}

export function ledDot(entityOrList) {
  const tone = Array.isArray(entityOrList) ? listTone(entityOrList) : conditionTone(entityOrList);
  return '<i class="led" role="img" aria-label="' + esc(tone.word) + '" title="' + esc(tone.word) + '" style="background:' + tone.color + '"></i>';
}

export function rowButton(entity) {
  return '<button type="button" class="floor-row" data-act="floor-server" data-server="' + entity.id + '" data-load-for="' +
    entity.id + '">' + ledDot(entity) + '<span>' + esc(entity.name) + '</span><b data-score>' +
    Math.round(entityScore(entity)) + "%</b></button>";
}

export function renderInspector() {
  const level = state.floor.level;
  const pod = podById(state.floor.podId);
  const rack = rackById(pod, state.floor.rackId);
  const row = rowRecord(pod, state.floor.rowId);
  const crumbs = ['<button type="button" data-act="floor-go" data-level="site">Outside</button>'];
  if (level !== "site" && !(level === "feed" && !pod)) crumbs.push('<button type="button" data-act="floor-go" data-level="hall">Hall</button>');
  if (pod && ["pod", "row", "rack", "server", "part", "feed"].indexOf(level) >= 0) {
    crumbs.push('<button type="button" data-act="floor-go" data-level="pod">' + esc(pod.name) + "</button>");
  }
  if (row && ["row", "rack", "server", "part"].indexOf(level) >= 0) {
    crumbs.push('<button type="button" data-act="floor-go" data-level="row">' + esc(row.name) + "</button>");
  }
  if (rack && ["rack", "server", "part"].indexOf(level) >= 0) {
    crumbs.push('<button type="button" data-act="floor-go" data-level="rack">' + esc(rack.id) + "</button>");
  }
  if ((level === "server" || level === "part") && state.floor.serverId && entityById(state.floor.serverId)) {
    const current = entityById(state.floor.serverId);
    crumbs.push('<button type="button" data-act="floor-server" data-server="' + current.id + '">' + esc(current.name) + "</button>");
  }
  if (level === "part") crumbs.push("<span>" + esc(state.floor.partId || "inlet") + "</span>");
  if (level === "feed") crumbs.push("<span>Feed</span>");
  const planOpen = placementById(state.floor.rackId);
  if ((level === "rack" || level === "server") && planOpen && !rack) {
    crumbs.push('<button type="button" data-act="plan-open" data-plan="' + planOpen.id + '">' + esc(planOpen.name) + "</button>");
  }
  let body = "";
  const sheet = planSheet();
  const planOnly = !!(state.plan.selected || state.plan.preview) && level !== "rack" && level !== "server" && level !== "part";
  if (planOnly) {
    body = "";
  } else if (level === "site" && state.floor.serverId && entityById(state.floor.serverId)) {
    body = serverInspector(entityById(state.floor.serverId));
  } else if (level === "site") {
    body = "<h2>Ten halls</h2><p class=\"fine\">" + PLANT.halls + " halls × " + PLANT.racksPerHall + " AI racks × " + PLANT.kwPerRack + " kW = " + PLANT.itMw + " MW of IT. Two " + PLANT.feederMw + " MW feeders (either one can carry the site) and " + PLANT.coolMw + " MW of heat rejection sit outside. Each hall has a " + PLANT.cduMw + " MW CDU for " + PLANT.hallItMw + " MW of racks.</p><h3>Halls</h3>" +
      PODS.map((hall) => '<button type="button" class="floor-row" data-act="floor-hall" data-pod="' + hall.id + '"><span>' + esc(hall.name) + "</span><b>" + PLANT.racksPerHall + " racks</b></button>").join("") +
      '<h3>Yard</h3>' +
      infra.filter((item) => item.yard).map(rowButton).join("") +
      '<h3>Feeders</h3>' +
      '<button type="button" class="floor-row" data-act="floor-feed" data-feed="grid-xfmr-a">Feeder A</button>' +
      '<button type="button" class="floor-row" data-act="floor-feed" data-feed="grid-xfmr-b">Feeder B</button>';
  } else if (level === "part") {
    const entity = entityById(state.floor.serverId);
    body = entity ? partPanel(entity) : '<p class="fine">Select a device.</p>';
  } else if (level === "feed") {
    body = feedPanel();
  } else if (level === "row" && pod && row) {
    body = rowPanel(pod, row);
  } else if (level === "server") {
    const entity = entityById(state.floor.serverId);
    body = entity ? serverInspector(entity) : '<p class="fine">Select a server.</p>';
  } else if (level === "rack" && rack) {
    body = "<h2>" + esc(rack.name) + "</h2><p class=\"fine\">" + esc(pod.name) +
      ". The same 3D rack as Operate › Rack. Pick a device in the rack for its details here.</p>" +
      powerHtml(rack.id) +
      breakThisHtml(rack.id, breakEventsForRack(rack.id)) +
      '<p class="elev-actions"><button type="button" class="act" data-act="rack-positions">Edit U positions</button></p>';
  } else if (level === "rack" && planOpen && !rack) {
    const gear = state.plan.placements.filter((item) => item.host === planOpen.id);
    body = "<h2>" + esc(planOpen.name) + "</h2><p class=\"fine\">" + freeU(planOpen.id) + "U free. Drop servers, switches, and PDUs into the enclosure.</p>" +
      (gear.map((item) => {
        const specItem = catalogById(item.catalogId);
        return '<button type="button" class="floor-row" data-act="plan-select" data-plan="' + item.id + '"><span>' +
          esc(item.name) + "</span><b>" + esc(specItem.powerLabel) + "</b></button>";
      }).join("") || '<p class="fine">Nothing in this enclosure yet.</p>');
  } else if (level === "pod" && pod) {
    const servers = pod.racks.reduce((all, item) => all.concat(rackEntities(item)), []);
    body = "<h2>" + esc(pod.name) + "</h2><p class=\"fine\">" + (pod.managed ? "ACS-A14 serves rack A14. The other racks in this hall are simulated." : "Simulated hall, same power and cooling as Hall 1.") +
      " " + PLANT.racksPerHall + " AI racks, " + PLANT.hallItMw + " MW IT, " + PLANT.cduMw + " MW CDU.</p><h3>Rows</h3>" +
      (pod.fit.rows || []).map((item) => '<button type="button" class="floor-row" data-act="floor-row" data-pod="' + pod.id + '" data-row="' + item.id + '"><span>' +
        esc(item.name) + "</span><b>Between aisles</b></button>").join("") +
      "<h3>Racks</h3>" + pod.racks.map((item) => '<button type="button" class="floor-row" data-act="floor-rack" data-pod="' +
      pod.id + '" data-rack="' + item.id + '">' + ledDot(rackEntities(item)) + '<span>' + esc(item.name) +
      '</span><b>' + rackEntities(item).length + '<span class="sr-only"> devices</span></b></button>').join("") +
      "<h3>Infrastructure</h3>" + infra.filter((item) => item.pod === pod.id).map(rowButton).join("") +
      "<h3>Nearing capacity</h3>" + (servers.filter((entity) => heatBand(entity) === "near" || heatBand(entity) === "critical").map(rowButton).join("") || '<p class="fine">None right now.</p>');
  } else {
    const hall = podById(state.floor.podId) || PODS[0];
    const managed = devices.filter((entity) => heatBand(entity) === "near" || heatBand(entity) === "critical" || heatBand(entity) === "failover");
    body = "<h2>" + esc(hall.name) + "</h2><p class=\"fine\">" + PLANT.racksPerHall + " AI racks in two rows of ten. " + PLANT.hallItMw + " MW of IT against a " + PLANT.cduMw + " MW CDU. " +
      (hall.managed ? "Rack A14 fails over to ACS serial." : "This hall is simulated. ACS-A14 stays in Hall 1.") + "</p>" +
      '<button type="button" class="act" data-act="floor-overview" data-pod="' + esc(hall.id) + '">Open ' + esc(hall.name) + ' overview</button><h3>Racks</h3>' +
      hall.racks.map((item) => '<button type="button" class="floor-row" data-act="floor-rack" data-pod="' + hall.id + '" data-rack="' + item.id + '">' +
        ledDot(rackEntities(item)) + '<span>' + esc(item.name) + '</span><b>' + rackEntities(item).length + '<span class="sr-only"> devices</span></b></button>').join("") +
      "<h3>Power and cooling</h3>" + infra.filter((item) => item.pod === hall.id && item.kind !== "Aisle").map(rowButton).join("") +
      "<h3>Watch list</h3>" + (managed.map(rowButton).join("") || '<p class="fine">All rack A14 servers are nominal.</p>');
  }
  return '<aside class="inspector drawer" id="floor-detail" tabindex="-1" aria-label="Floor details"><div class="crumbs">' + crumbs.join("<span>/</span>") + "</div>" + sheet + body + "</aside>";
}

export function planSheet() {
  const placed = placementById(state.plan.selected);
  if (placed) {
    const specItem = catalogById(placed.catalogId);
    const host = placed.host ? (placementById(placed.host) || findRack(placed.host)) : null;
    const where = placed.place === "yard" ? "Outside the building." : (placed.place === "floor" ? "On the hall floor." : "Inside " + (host && host.name ? host.name : placed.host) + ".");
    let actions = '<div class="plan-actions"><button type="button" class="act" data-act="plan-remove" data-plan="' + placed.id + '">Remove</button>';
    if (specItem.uCapacity) {
      actions += '<button type="button" class="act primary" data-act="plan-open" data-plan="' + placed.id + '">Open enclosure</button>';
    }
    if (placed.place === "floor" || placed.place === "yard") {
      actions += '<button type="button" class="act" data-act="plan-nudge" data-plan="' + placed.id + '" data-dir="left">Left</button>' +
        '<button type="button" class="act" data-act="plan-nudge" data-plan="' + placed.id + '" data-dir="right">Right</button>' +
        '<button type="button" class="act" data-act="plan-nudge" data-plan="' + placed.id + '" data-dir="up">Up</button>' +
        '<button type="button" class="act" data-act="plan-nudge" data-plan="' + placed.id + '" data-dir="down">Down</button>';
    }
    actions += "</div>";
    const space = specItem.uCapacity ? '<p class="fine">' + freeU(placed.id) + "U free of " + specItem.uCapacity + "U.</p>" : "";
    return faceSheet(specItem, placed.name, "<p class=\"fine\">" + esc(where) + "</p>" + space + actions);
  }
  if (state.plan.preview) {
    const specItem = catalogById(state.plan.preview);
    if (!specItem) return "";
    const hint = specItem.place === "yard" ? "Drag this card onto the yard, outside the building." : (specItem.place === "floor" ? "Drag this card onto the hall." : "Drag this card onto a rack, or open an enclosure and drop it there.");
    return faceSheet(specItem, specItem.name, '<p class="fine">' + hint + "</p>");
  }
  return "";
}

export function floorDetailOpen() {
  if (!state.inspectorOpen && !state.floorListOpen && !state.plan.selected && !state.plan.preview) return false;
  if (state.plan.selected || state.plan.preview) return true;
  const level = state.floor.level;
  if (level === "site") return !!state.floor.serverId || state.floorListOpen;
  if (level === "hall" || level === "elevation") return state.floorListOpen;
  return level === "pod" || level === "row" || level === "rack" || level === "server" || level === "part" || level === "feed";
}

function mountScene(html) {
  const drawers = (state.libraryOpen ? renderLibrary() : "") + (floorDetailOpen() ? renderInspector() : "");
  const cut = html.lastIndexOf("</div>");
  if (cut < 0) return html + drawers;
  return html.slice(0, cut) + drawers + html.slice(cut);
}

export function renderFloor() {
  if (state.floor.level === "elevation") {
    const elev = elevationParts();
    return '<div class="floor-page"><div class="page-head"><div class="top">' + themeButton() + "</div>" + pills() +
      '</div><div class="plan-layout"><div class="floor-layout">' + elev.scene + elev.detail + "</div></div></div>";
  }
  const planOpen = placementById(state.floor.rackId);
  const deep = state.floor.level === "rack" || state.floor.level === "server" || state.floor.level === "part";
  const openedPlan = deep && planOpen && catalogById(planOpen.catalogId).uCapacity;
  const chassis = !openedPlan && deep && state.floor.rackId;
  const pod = podById(state.floor.podId);
  const rack = rackById(pod, state.floor.rackId);
  const onSite = state.floor.level === "site" || (state.floor.level === "feed" && !pod);
  const scene = onSite ? renderSite() : (openedPlan ? renderPlanChassis(planOpen) : (chassis && rack ? renderRackScene(rack, pod) : renderHall()));
  return '<div class="floor-page"><div class="plan-layout"><div class="floor-layout floor-fill" data-floor-level="' + esc(state.floor.level) + '">' + mountScene(scene) + "</div></div></div>";
}

export function zoomFloor(dir) {
  if (runtime.walk) stopWalk(false, false);
  if (dir === "reset") {
    state.floor.pitch = 56;
    state.floor.yaw = -40;
    state.floor.zoom = 0.78;
    state.floor.panX = 0;
    state.floor.panY = 0;
    state.floor.chassisPitch = 12;
    state.floor.chassisYaw = -18;
    state.floor.chassisZoom = 1;
  } else if (dir === "in") {
    state.floor.zoom = clamp(state.floor.zoom * 1.16, 0.42, 1.9);
    state.floor.chassisZoom = clamp(state.floor.chassisZoom * 1.12, 0.65, 1.85);
  } else {
    state.floor.zoom = clamp(state.floor.zoom / 1.16, 0.42, 1.9);
    state.floor.chassisZoom = clamp(state.floor.chassisZoom / 1.12, 0.65, 1.85);
  }
  applyCamera();
}

export function panFloor(dir) {
  if (runtime.walk) stopWalk(false, false);
  const step = 48;
  if (dir === "left") state.floor.panX -= step;
  else if (dir === "right") state.floor.panX += step;
  else if (dir === "up") state.floor.panY -= step;
  else if (dir === "down") state.floor.panY += step;
  state.floor.panX = clamp(state.floor.panX, -480, 480);
  state.floor.panY = clamp(state.floor.panY, -320, 320);
  applyCamera();
}

export function orbitFloor(dir) {
  if (runtime.walk) stopWalk(false, false);
  if (dir === "left") state.floor.yaw -= 8;
  else if (dir === "right") state.floor.yaw += 8;
  else if (dir === "up") state.floor.pitch += 4;
  else if (dir === "down") state.floor.pitch -= 4;
  state.floor.pitch = clamp(state.floor.pitch, 16, 84);
  applyCamera();
}

export function scenePoint(event) {
  const scene = event.target.closest(".scene");
  const rect = scene.getBoundingClientRect();
  const nx = (event.clientX - rect.left) / rect.width - 0.5;
  const ny = (event.clientY - rect.top) / rect.height - 0.5;
  return {
    x: clamp(Math.round((nx * 860) / 24) * 24, -480, 460),
    y: clamp(Math.round((ny * 520) / 24) * 24, -300, 280),
  };
}

export function dropTarget(node) {
  const token = runtime.dragToken;
  const specItem = token.indexOf("new:") === 0 ? catalogById(token.slice(4)) : null;
  const moving = token.indexOf("move:") === 0 ? placementById(token.slice(5)) : null;
  const place = specItem ? specItem.place : (moving ? moving.place : "");
  const scene = node.closest(".scene");
  const planHost = node.closest("[data-plan-host]");
  const rackHost = node.closest("[data-rack-host]");
  const rackBox = node.closest(".rackbox");
  if (place === "yard") {
    if (!scene || !scene.classList.contains("site-scene")) return { ok: false, el: scene };
    return { ok: true, el: scene, kind: "floor" };
  }
  if (place === "floor") {
    if (!scene || scene.classList.contains("chassis-scene") || scene.classList.contains("site-scene")) return { ok: false, el: scene };
    return { ok: true, el: scene, kind: "floor" };
  }
  if (place !== "rack") return { ok: false, el: scene };
  if (planHost) return { ok: true, el: planHost, kind: "rack", host: planHost.getAttribute("data-plan-host") };
  if (rackHost) return { ok: true, el: rackHost, kind: "rack", host: rackHost.getAttribute("data-rack-host") };
  if (rackBox && rackBox.dataset.plan) {
    const placed = placementById(rackBox.dataset.plan);
    if (placed && catalogById(placed.catalogId).uCapacity) return { ok: true, el: rackBox, kind: "rack", host: placed.id };
  }
  if (rackBox && rackBox.dataset.rack) return { ok: true, el: rackBox, kind: "rack", host: rackBox.dataset.rack };
  return { ok: false, el: scene };
}

export async function placeCatalog(specItem, host, point) {
  if (!state.user || state.user.role !== "Administrator") {
    state.toast = "Only an Administrator can place a model. That creates an asset.";
    render();
    return;
  }
  const locationId = specItem.place === "yard" ? "yard" : (specItem.place === "floor" ? state.floor.podId : host);
  let body: any = {};
  let response: Response;
  try {
    response = await fetch("/api/v1/placements", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        modelId: specItem.id,
        locationId: locationId,
        hallId: state.floor.podId,
        x: point ? point.x : 0,
        y: point ? point.y : 0,
      }),
    });
    body = await response.json();
  } catch (err) {
    state.toast = "The asset repository did not accept the placement.";
    render();
    return;
  }
  if (!response.ok) {
    state.toast = body.error || "That model does not fit.";
    render();
    return;
  }
  const count = state.plan.placements.filter((item) => item.catalogId === specItem.id).length + 1;
  const item = {
    id: body.asset.id,
    catalogId: specItem.id,
    name: specItem.name + " " + count,
    place: specItem.place,
    x: point ? point.x : 0,
    y: point ? point.y : 0,
    host: host || "",
    uPosition: body.uPosition,
  };
  state.plan.seq += 1;
  state.plan.placements.push(item);
  state.plan.selected = item.id;
  state.plan.preview = "";
  state.toast = item.name + " placed" + (body.uPosition ? " at U" + body.uPosition : "") + ". " + specItem.powerLabel + " · " + specItem.ampLabel + "." + gearAirSentence(item);
  if (body.model) {
    applyModels(MODELS.map((model) => model.id === body.model.id ? body.model : model));
  }
  if (specItem.place === "rack" && host && host.indexOf("plan-") !== 0) {
    const podId = podForRack(host);
    state.view = "floor";
    state.floor.level = "rack";
    state.floor.rackId = host;
    state.floor.serverId = "";
    if (podId) state.floor.podId = podId;
  }
  render();
}

export function podForRack(rackId) {
  let found = "";
  PODS.forEach((pod) => {
    if (pod.racks.some((rack) => rack.id === rackId)) found = pod.id;
  });
  return found;
}

export function openPlan(id) {
  const item = placementById(id);
  if (!item) return;
  state.inspectorOpen = true;
  state.view = "floor";
  state.floor.level = "rack";
  state.floor.rackId = id;
  state.floor.serverId = "";
  state.plan.selected = id;
  render();
}

export function removePlan(id) {
  state.plan.placements = state.plan.placements.filter((item) => item.id !== id && item.host !== id);
  if (state.floor.rackId === id) {
    state.floor.level = "hall";
    state.floor.rackId = "A14";
  }
  if (state.plan.selected === id) state.plan.selected = "";
  state.toast = "Removed from the plan.";
  render();
}

export function nudgePlan(id, dir) {
  const item = placementById(id);
  if (!item || (item.place !== "floor" && item.place !== "yard")) return;
  if (dir === "left") item.x -= 24;
  if (dir === "right") item.x += 24;
  if (dir === "up") item.y -= 24;
  if (dir === "down") item.y += 24;
  item.x = clamp(item.x, -480, 460);
  item.y = clamp(item.y, -300, 280);
  render();
}

export function onDragStart(event) {
  const card = event.target.closest("[data-catalog], .planned");
  if (!card) return;
  runtime.dragToken = card.dataset.catalog ? "new:" + card.dataset.catalog : "move:" + card.dataset.plan;
  event.dataTransfer.setData("text/plain", runtime.dragToken);
  event.dataTransfer.effectAllowed = "copy";
}

export function onDragOver(event) {
  if (!runtime.dragToken) return;
  const scene = event.target.closest(".scene");
  if (!scene) return;
  event.preventDefault();
  const host = dropTarget(event.target);
  document.querySelectorAll(".drop-ready, .drop-no").forEach((el) => el.classList.remove("drop-ready", "drop-no"));
  const specItem = runtime.dragToken.indexOf("new:") === 0 ? catalogById(runtime.dragToken.slice(4)) : null;
  const moving = runtime.dragToken.indexOf("move:") === 0 ? placementById(runtime.dragToken.slice(5)) : null;
  const place = specItem ? specItem.place : (moving ? moving.place : "");
  const mark = host.ok ? (host.el || scene) : scene;
  mark.classList.add(host.ok ? "drop-ready" : "drop-no");
  scene.dataset.drop = host.ok
    ? (place === "yard" ? "Release to place outside the building" : (place === "floor" ? "Release to place on the floor" : "Release to mount in the rack"))
    : (place === "yard" ? "This piece sits outside the building" : (place === "rack" ? "Rack gear mounts inside a rack" : "This piece sits on the hall floor"));
}

export function onDragEnd() {
  runtime.dragToken = "";
  document.querySelectorAll(".drop-ready, .drop-no, [data-drop]").forEach((el) => {
    el.classList.remove("drop-ready", "drop-no");
    delete el.dataset.drop;
  });
}

export function onDrop(event) {
  const token = runtime.dragToken;
  if (!token) return;
  event.preventDefault();
  const host = dropTarget(event.target);
  onDragEnd();
  if (!host.ok) {
    const specItem = token.indexOf("new:") === 0 ? catalogById(token.slice(4)) : null;
    state.toast = specItem && specItem.place === "rack"
      ? "Drop that onto a rack, or open an enclosure first."
      : (specItem && specItem.place === "yard" ? "Drop that outside the building." : "Drop floor gear on the hall.");
    render();
    return;
  }
  if (token.indexOf("move:") === 0) {
    const item = placementById(token.slice(5));
    if (item && (item.place === "floor" || item.place === "yard")) {
      const point = scenePoint(event);
      item.x = point.x;
      item.y = point.y;
      state.plan.selected = item.id;
      state.toast = item.name + " moved." + gearAirSentence(item);
      render();
    }
    return;
  }
  const specItem = catalogById(token.slice(4));
  if (!specItem) return;
  if (specItem.place === "floor") placeCatalog(specItem, "", scenePoint(event));
  else placeCatalog(specItem, host.host, null);
}
