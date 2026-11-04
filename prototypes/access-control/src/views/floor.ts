import { deviceById, devices } from "../data/devices";
import { LIBRARY, catalogById, findRack, freeU, placementById, spec } from "../data/library";
import { outlets } from "../data/outlets";
import { PODS, SHELL, YARD, deviceRackId, entityById, entityScore, heatBand, infra, isFacility, podById, rackById, rackEntities, worstBand } from "../data/pods";
import { waiting } from "../domain/failover";
import { openSession } from "../domain/sessions";
import { runtime, state } from "../state";
import { activeAlarms, watchTable } from "../ui/alarms";
import { alarmInput, explainHtml } from "../ui/explain";
import { clamp, esc } from "../ui/format";
import { render } from "../ui/schedule";
import { pills } from "../ui/shell";
import { futureHallHtml, futureOn, futureYardHtml } from "./manage";
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
  return "Hall is cool. Drag to orbit. Scroll to zoom in.";
}

export function cameraTransform() {
  const floor = state.floor;
  return "translate(" + floor.panX + "px," + floor.panY + "px) rotateX(" + floor.pitch +
    "deg) rotateZ(" + floor.yaw + "deg) scale(" + floor.zoom + ")";
}

export function applyCamera() {
  const world = document.querySelector(".world");
  if (world) {
    world.style.transform = cameraTransform();
    world.style.setProperty("--pitch", state.floor.pitch + "deg");
    world.style.setProperty("--yaw", state.floor.yaw + "deg");
  }
  const chassis = document.querySelector(".chassis");
  if (chassis) {
    chassis.style.transform = "rotateX(" + state.floor.chassisPitch + "deg) rotateY(" +
      state.floor.chassisYaw + "deg) scale(" + state.floor.chassisZoom + ")";
  }
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
  if (act !== "floor-pod" && act !== "floor-row" && act !== "floor-rack" && act !== "floor-server" && act !== "floor-feed" && act !== "floor-part" && act !== "floor-go" && act !== "plan-select" && act !== "horizon-focus") return null;
  if (!el.closest(".world, .chassis, .cabinet")) return null;
  return el;
}

export function pickDrill(x, y) {
  const stack = document.elementsFromPoint(x, y);
  const top = stack[0];
  if (!top || (top.closest && top.closest(".hud, .legend, .inspector, .lib, .page-head, .alarm-banner, .watch-panel, .rail, .topbar, .tabbar, .menu-back"))) return null;
  let direct = null;
  for (let i = 0; i < stack.length; i += 1) {
    const el = drillEl(stack[i]);
    if (!el) continue;
    direct = el;
    break;
  }
  if (direct && direct.classList.contains("pod")) {
    for (let i = 0; i < stack.length; i += 1) {
      const el = drillEl(stack[i]);
      if (el && el !== direct && direct.contains(el)) return el;
    }
  }
  return direct;
}

export function onPointerDown(event) {
  if (!state.user || state.view !== "floor" || event.button !== 0) return;
  if (event.target.closest(".lib, [data-plan]")) return;
  const scene = event.target.closest(".scene");
  if (!scene || event.target.closest(".hud, .legend, button, a, input, select") || drillEl(event.target)) return;
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
  if (!runtime.orbit || event.pointerId !== runtime.orbit.id) return;
  if (runtime.orbit.moved) {
    state.floor.suppressClick = true;
    setTimeout(() => { state.floor.suppressClick = false; }, 0);
  }
  runtime.orbit = null;
}

export function onWheel(event) {
  const scene = event.target.closest && event.target.closest(".scene");
  if (!scene || !state.user || state.view !== "floor") return;
  event.preventDefault();
  const factor = event.deltaY > 0 ? 0.92 : 1.08;
  if (scene.classList.contains("chassis-scene")) {
    state.floor.chassisZoom = clamp(state.floor.chassisZoom * factor, 0.65, 1.85);
  } else {
    state.floor.zoom = clamp(state.floor.zoom * factor, 0.42, 1.9);
  }
  applyCamera();
}

export function goFloor(level) {
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
    state.floor.level = state.floor.rackId ? "rack" : "pod";
    state.floor.serverId = "";
    state.floor.partId = "";
  }
  render();
}

export function openRow(podId, rowId) {
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
  state.floor.podId = podId;
  state.floor.rackId = rackId;
  state.floor.level = "rack";
  state.floor.serverId = "";
  state.floor.partId = "";
  const rack = rackById(podById(podId), rackId);
  if (rack && rack.row) state.floor.rowId = rack.row;
  render();
}

export function openFloorServer(id) {
  const entity = entityById(id);
  if (!entity) return;
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

export function boxHtml(item, band, act, extra) {
  const tone = extra.server ? conditionTone(entityById(extra.server)) : listTone(extra.leds || []);
  const leds = (extra.leds || []).map((entity) => {
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
  const planAttr = extra.plan ? ' data-plan="' + extra.plan + '" draggable="true"' : "";
  const attrs = extra.attrs || "";
  const label = boxLabel(extra, band);
  const faceText = String(face || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const capShown = extra.cap ? String(extra.cap).toUpperCase() : "";
  const named = [label, capShown, faceText, tone.pri ? String(tone.pri) : ""].filter(Boolean).join(" ");
  return '<div class="rackbox' + (extra.plan ? " planned" : "") + (extra.klass ? " " + extra.klass : "") + '" role="button" tabindex="0" aria-label="' + esc(named) + '" data-act="' + act + '" data-band="' + band + heatAttr +
    '" style="--x:' + item.x + "px;--y:" + item.y + "px;--w:" + item.w + "px;--d:" + item.d + "px;--h:" + item.h +
    "px;--heat:" + (extra.color || tone.color) +     '" data-pod="' + (extra.pod || "") + '" data-rack="' + (extra.rack || "") +
    '" data-server="' + (extra.server || "") + '"' + planAttr + attrs + '><i class="ftop" aria-hidden="true">' + cap + '</i><i class="ffront" aria-hidden="true">' + mark + leds + face +
    '</i><i class="fside" aria-hidden="true"></i></div>';
}

export function hudHtml() {
  const alarms = activeAlarms();
  const levelName = {
    site: "Outside the building",
    hall: "Level 1 · Hall",
    pod: "Level 2 · Pod",
    row: "Level 2 · Row",
    rack: "Level 3 · Rack",
    server: "Level 3 · Device",
    part: "Level 4 · Inside the device",
    feed: "Power feed",
  };
  const level = levelName[state.floor.level] || "Hall";
  return '<div class="hud"><div class="hud-score"><b data-abnormal>' + alarms.length +
    '</b><span>Abnormal</span></div><p class="hud-mission">' + esc(level) +
    '. Color is reserved for conditions that need a response. Gray is nominal.</p><div class="hud-zoom"><button type="button" data-act="horizon" data-horizon="now"' + (state.horizon === "future" ? "" : ' aria-pressed="true"') + '>Now</button><button type="button" data-act="horizon" data-horizon="future"' + (state.horizon === "future" ? ' aria-pressed="true"' : "") + '>Future</button><button type="button" data-act="floor-go" data-level="site">Outside</button><button type="button" data-act="floor-go" data-level="hall">Hall</button><button type="button" data-act="floor-zoom" data-dir="out" aria-label="Zoom out">−</button><button type="button" data-act="floor-zoom" data-dir="in" aria-label="Zoom in">+</button><button type="button" data-act="floor-zoom" data-dir="reset">Reset view</button></div></div>';
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

export function planBoxes(place) {
  return state.plan.placements.filter((item) => item.place === place).map((item) => {
    const spec = catalogById(item.catalogId);
    return boxHtml(
      { x: item.x, y: item.y, w: spec.box.w, d: spec.box.d, h: spec.box.h },
      "ok",
      "plan-select",
      { plan: item.id, color: makerColor(spec.maker), face: faceplateHtml(spec) }
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
    "</strong><span class=\"lib-maker\">" + esc(specItem.maker) + "</span></span><span class=\"lib-stats\"><b>" +
    esc(specItem.powerLabel) + "</b><b>" + esc(specItem.ampLabel) + "</b><b>" + specItem.powerPorts + " P · " +
    specItem.netPorts + " N</b></span></div>";
}

export function renderLibrary() {
  const makers = ["All", "Vertiv", "HP", "Dell", "IBM"];
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
  return '<aside class="lib"><h2>Device library</h2><p class="fine">Drag a tile. Outside gear lands in the yard. Floor gear lands in the hall. Rack gear mounts in an enclosure.</p><div class="lib-filters">' +
    filters + "</div>" + groups + '<p class="lib-total"><b>' + state.plan.placements.length + '</b><span>placed</span><b>' +
    power + "</b><b>" + amps.toFixed(1) + " A</b></p></aside>";
}

export function renderPlanChassis(item) {
  const blades = planBlades(item.id);
  const free = freeU(item.id);
  return '<div class="scene chassis-scene thermal">' + hudHtml() + '<div class="chassis-wrap"><div class="rack-frame" data-plan-host="' +
    item.id + '" style="transform:rotateX(' + state.floor.chassisPitch + "deg) rotateY(" + state.floor.chassisYaw +
    "deg) scale(" + state.floor.chassisZoom + ')"><div class="rack-rail"><span>' + esc(item.name) + "</span><b>" + free +
    'U free</b></div><div class="rack-bay">' + (blades || "") + "</div></div></div><p class=\"legend chassis-hint\">The open bay is the drop target. Drag the frame to turn it.</p></div>";
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

export function feedHtml(from, to, mode, id, podId, extraClass?: string) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.max(12, Math.hypot(dx, dy));
  const ang = Math.atan2(dy, dx) * 180 / Math.PI;
  const on = state.floor.feedId === id ? " on" : "";
  return '<div class="feed ' + mode + on + (extraClass ? " " + extraClass : "") + '" data-act="floor-feed" data-feed="' + id + '" data-pod="' +
    (podId || "") + '" style="--x:' + from.x.toFixed(1) + "px;--y:" + from.y.toFixed(1) + "px;--len:" + len.toFixed(1) +
    "px;--ang:" + ang.toFixed(1) + 'deg" aria-hidden="true"></div>';
}

export function pipeHtml(from, to, kind) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.max(12, Math.hypot(dx, dy));
  const ang = Math.atan2(dy, dx) * 180 / Math.PI;
  const id = kind === "return" ? "pipe-ret" : "pipe-sup";
  return '<div class="pipe ' + kind + '" data-act="floor-server" data-server="' + id +
    '" style="--x:' + from.x.toFixed(1) + "px;--y:" + from.y.toFixed(1) + "px;--len:" + len.toFixed(1) +
    "px;--ang:" + ang.toFixed(1) + 'deg" aria-hidden="true"></div>';
}

export function podShelf(pod) {
  return pod.racks.find((rack) => rack.kind === "Power") || (pod.boxes || []).find((box) => {
    const entity = entityById(box.id);
    return entity && entity.kind === "Powershelf";
  });
}

export function podFeeds(pod) {
  const shelf = podShelf(pod);
  const bus = pod.fit && pod.fit.busbar;
  if (!shelf || !bus) return "";
  const shelfPt = itemPoint(shelf);
  let html = feedHtml(itemPoint(bus), shelfPt, shelfLive(pod), "bus-" + pod.id, pod.id);
  pod.racks.forEach((rack) => {
    if (rack.id === shelf.id) return;
    html += feedHtml(shelfPt, itemPoint(rack), rackEnergized(pod, rack), "whip-" + rack.id, pod.id);
  });
  (pod.boxes || []).forEach((box) => {
    if (box.id === shelf.id) return;
    const entity = entityById(box.id);
    if (!entity || entity.kind !== "Powershelf") return;
    html += feedHtml(itemPoint(bus), itemPoint(box), "live", "bus-" + pod.id, pod.id);
  });
  return html;
}

export function yardById(id) {
  const gear = {};
  YARD.forEach((item) => { gear[item.id] = item; });
  return gear[id];
}

export function siteFeedHtml() {
  const grid = itemPoint(yardById("grid-1"));
  const xfmr = itemPoint(yardById("xfmr-1"));
  const modulePt = itemPoint(yardById("pwr-mod"));
  const battery = itemPoint(yardById("batt-1"));
  const wall = { x: SHELL.x - 2, y: SHELL.y + 96 };
  let html = feedHtml(grid, xfmr, "live", "grid-xfmr", "", "cable") +
    feedHtml(xfmr, modulePt, "live", "xfmr-mod", "", "cable") +
    feedHtml(battery, modulePt, "live", "batt-mod", "", "cable") +
    feedHtml(modulePt, wall, "live", "mod-hall", "", "cable");
  if (futureOn()) html += feedHtml(grid, { x: -420, y: 200 }, "live", "grid-future", "", "cable");
  return html;
}

export function sitePipesHtml() {
  const trunkS = SHELL.x + SHELL.w + 26;
  const trunkR = trunkS + 18;
  const y0 = SHELL.y + 16;
  const y1 = SHELL.y + SHELL.d - 10;
  let html = pipeHtml({ x: trunkS, y: y0 }, { x: trunkS, y: y1 }, "supply") +
    pipeHtml({ x: trunkR, y: y0 }, { x: trunkR, y: y1 }, "return");
  ["heat-1", "heat-2", "hydro-1"].forEach((id) => {
    const gear = itemPoint(yardById(id));
    html += pipeHtml({ x: trunkS, y: gear.y }, { x: gear.x - 4, y: gear.y }, "supply");
    html += pipeHtml({ x: trunkR, y: gear.y + 12 }, { x: gear.x - 4, y: gear.y + 12 }, "return");
  });
  return html;
}

export function rowRecord(pod, rowId) {
  if (!pod || !pod.fit || !pod.fit.rows) return null;
  return pod.fit.rows.find((row) => row.id === rowId) || null;
}

export function fitHtml(pod) {
  const fit = pod.fit;
  if (!fit) return "";
  const aisles = (fit.aisles || []).map((band) => '<div class="aisle ' + band.tone + '" data-act="floor-server" data-server="' +
    band.id + '" style="--x:' + band.x + "px;--y:" + band.y + "px;--w:" + band.w + "px;--h:" + band.h + 'px"><span>' +
    esc(band.label) + "</span></div>").join("");
  const containment = fit.containment ? boxHtml(fit.containment, heatBand(entityById(fit.containment.id)), "floor-server", {
    pod: pod.id, server: fit.containment.id, klass: "containment", cap: "Containment", leds: [],
  }) : "";
  const bus = fit.busbar ? boxHtml(fit.busbar, heatBand(entityById(fit.busbar.id)), "floor-server", {
    pod: pod.id, server: fit.busbar.id, klass: "busbar", cap: "Bus bar", leds: [],
  }) : "";
  const rows = (fit.rows || []).map((row) => '<button type="button" class="row-tag" data-act="floor-row" data-pod="' +
    pod.id + '" data-row="' + row.id + '" style="--y:' + row.y + 'px">' + esc(row.name) + "</button>").join("");
  return aisles + containment + bus + rows;
}

export function renderHall() {
  const pods = PODS.map((pod) => {
    const racks = pod.racks.map((rack) => {
      const facing = (rack.row || "").slice(-1) === "s" ? "face-south" : "face-north";
      const power = rack.kind === "Power";
      return boxHtml(rack, worstBand(rackEntities(rack)), "floor-rack", {
        pod: pod.id, rack: rack.id, leds: rackEntities(rack),
        klass: (power ? "powershelf " : "") + facing,
        cap: power ? "50 VDC" : "Front",
      });
    }).join("");
    const boxes = (pod.boxes || []).map((box) => {
      const entity = entityById(box.id);
      const shelf = entity && entity.kind === "Powershelf";
      return boxHtml(box, heatBand(entity), "floor-server", {
        pod: pod.id, server: box.id, leds: [],
        klass: shelf ? "powershelf" : "",
        cap: shelf ? "50 VDC" : "",
      });
    }).join("");
    const current = state.floor.level === "pod" && state.floor.podId === pod.id ? " current" : "";
    return '<div class="pod' + current + '" data-act="floor-pod" data-pod="' + pod.id + '" style="--x:' + pod.x +
      "px;--y:" + pod.y + "px;--w:" + pod.w + "px;--h:" + pod.h + 'px"><i class="pod-plate"></i><span class="pod-letter">' +
      esc(pod.letter) + "</span>" + fitHtml(pod) + racks + boxes + podFeeds(pod) + "</div>";
  }).join("");
  return '<div class="scene thermal">' + hudHtml() + '<div class="stage"><div class="world" style="transform:' + cameraTransform() +
    ";--pitch:" + state.floor.pitch + "deg;--yaw:" + state.floor.yaw + 'deg"><div class="slab"></div>' + pods + futureHallHtml() + planBoxes("floor") +
    '</div></div><div class="legend"><span class="pri-mark pri-0">—</span><span>Nominal</span><span class="pri-mark pri-3">3</span><span>Rise</span><span class="pri-mark pri-2">2</span><span>Hot / RDP</span><span class="pri-mark pri-1">1</span><span>BMC / leak</span><span class="legend-hint">' +
    (state.horizon === "future" ? "Future state. Click Hall 2, a row, a rack, or a server to open it." : "Click a pod, aisle, row, rack, or feed to open it.") +
    "</span></div></div>";
}

export function renderSite() {
  const shell = boxHtml(SHELL, "ok", "floor-go", {
    klass: "building", color: "#d9d2c8", cap: "Compute hall", attrs: ' data-level="hall"', leds: [],
  });
  const gear = YARD.map((item) => boxHtml(item, heatBand(entityById(item.id)), "floor-server", {
    server: item.id, klass: item.klass, cap: item.name, color: item.klass === "heat-yard" ? "#2f4a3c" : (item.klass === "core-block" ? "#1c1c1c" : "#3a342e"), leds: [],
  })).join("");
  return '<div class="scene thermal site-scene">' + hudHtml() + '<div class="stage"><div class="world" style="transform:' + cameraTransform() +
    ";--pitch:" + state.floor.pitch + "deg;--yaw:" + state.floor.yaw + 'deg"><div class="slab yard-slab"></div>' + shell + gear + futureYardHtml() + planBoxes("yard") +
    siteFeedHtml() + sitePipesHtml() + '</div></div><div class="legend"><span class="feed-key cable"></span><span>Grid feeder</span><span class="pipe-key supply"></span><span>Supply pipe</span><span class="pipe-key return"></span><span>Return pipe</span><span class="legend-hint">Click the grid, a feeder, a pipe, or the hall</span></div></div>';
}

export function renderChassis(rack, pod) {
  const blades = rackEntities(rack).map((entity) => faceplate(entity, state.floor.serverId === entity.id, "floor-server")).join("") + planBlades(rack.id);
  const sample = rackEntities(rack)[0];
  const note = sample ? thermalCard(sample) : "";
  return '<div class="scene chassis-scene thermal">' + hudHtml() + '<div class="chassis-wrap"><div class="chassis cabinet-chassis" data-rack-host="' +
    rack.id + '" style="transform:rotateX(' +
    state.floor.chassisPitch + "deg) rotateY(" + state.floor.chassisYaw + "deg) scale(" + state.floor.chassisZoom +
    ')"><div class="chassis-top">' +
    esc(pod.name) + " · " + esc(rack.name) + " · cold aisle front · " + freeU(rack.id) + 'U free</div><div class="cabinet in-scene"><div class="cab-rail"></div><div class="cab-bay">' +
    blades + '</div><div class="cab-rail"></div></div></div></div><div class="legend chassis-hint">Intake on this face. Exhaust is the hot aisle behind the row.' +
    (state.containment === "cac" ? " Cold aisle is enclosed." : " Hot aisle is enclosed.") + "</div>" +
    (note ? '<div class="chassis-thermal">' + note + "</div>" : "") + "</div>";
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
    action = "<p>In-band RDP is down. The graphical failover is ACS KVM on MPU port " + entity.mpu + ".</p>" +
      '<button type="button" class="act primary" data-act="rdp-failover" data-device="' + entity.id + '">Open KVM failover</button>';
  } else if (managed && entity.kind === "GPU tray") {
    action = "<p class=\"fine\">RDP is the in-band desktop. ACS KVM takes the session if that path drops.</p>" +
      '<button type="button" class="act" data-act="rdp-open" data-device="' + entity.id + '">Open RDP</button>';
  } else if (managed) {
    action = "<p class=\"fine\">BMC is still up. ACS serial is the out-of-band wire if this BMC drops.</p>" +
      '<button type="button" class="act" data-act="floor-serial" data-device="' + entity.id + '">Open ACS serial</button>';
  } else if (entity.kind === "Grid") {
    action = yardArt(entity) + "<p>The utility grid lands on a gantry outside the shell. One feeder is closed through the transformer and the power module, and it stops at the hall wall.</p>" +
      '<button type="button" class="act" data-act="floor-feed" data-feed="grid-xfmr">Open the feeder</button>';
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
  return '<div data-load-for="' + entity.id + '"><p class="band-label ' + band + '">' + esc(bandLabel(band)) + " · " + score +
    '%</p><h2>' + esc(entity.name) + "</h2><p class=\"fine\">" + esc(entity.kind) + (managed ? " · simulated BMC" : " · simulated load") + "</p>" + faces + heatNote + parts + inside + action + "</div>";
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
  } else if (id === "grid-future") {
    copy = "Second feeder to the planned power module. It is drawn with the future state, beside the feeder that is closed today.";
  } else if (id === "xfmr-mod") {
    copy = "Medium-voltage transformer to the power module. Energized.";
  } else if (id === "batt-mod") {
    copy = "Battery skid onto the power module. Energized for ride-through.";
  } else if (id === "mod-hall") {
    copy = "Power module to the outside of the compute hall. Energized. The feeder ends at the shell.";
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
  return '<i class="led" title="' + esc(tone.word) + '" style="background:' + tone.color + '"></i>';
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
    crumbs.push('<button type="button" data-act="floor-go" data-level="rack">' + esc(rack.name) + "</button>");
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
  if (level === "site" && state.floor.serverId && entityById(state.floor.serverId)) {
    body = serverInspector(entityById(state.floor.serverId));
  } else if (level === "site") {
    body = "<h2>Outside the building</h2><p class=\"fine\">The grid feeder, transformer, and power module stay west of the shell. Supply and return pipes stay east of it. Neither run enters the compute hall.</p>" +
      '<button type="button" class="act primary" data-act="floor-go" data-level="hall">Enter the compute hall</button><h3>Yard</h3>' +
      infra.filter((item) => item.yard).map(rowButton).join("");
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
    body = "<h2>" + esc(rack.name) + "</h2><p class=\"fine\">" + esc(pod.name) + " · " + esc(rack.kind) +
      "</p>" + rackEntities(rack).map(rowButton).join("");
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
    body = "<h2>" + esc(pod.name) + "</h2><p class=\"fine\">" + (pod.managed ? "ACS-A14 serves rack A14 in the north row." : "Neighbor pod. Capacity is simulated.") +
      " A rack row stands between every cold aisle and hot aisle.</p><h3>Rows</h3>" +
      (pod.fit.rows || []).map((item) => '<button type="button" class="floor-row" data-act="floor-row" data-pod="' + pod.id + '" data-row="' + item.id + '"><span>' +
        esc(item.name) + "</span><b>Between aisles</b></button>").join("") +
      "<h3>Racks</h3>" + pod.racks.map((item) => '<button type="button" class="floor-row" data-act="floor-rack" data-pod="' +
      pod.id + '" data-rack="' + item.id + '">' + ledDot(rackEntities(item)) + '<span>' + esc(item.name) +
      "</span><b>" + rackEntities(item).length + "</b></button>").join("") +
      "<h3>Infrastructure</h3>" + infra.filter((item) => item.pod === pod.id).map(rowButton).join("") +
      "<h3>Nearing capacity</h3>" + (servers.filter((entity) => heatBand(entity) === "near" || heatBand(entity) === "critical").map(rowButton).join("") || '<p class="fine">None right now.</p>');
  } else {
    const managed = devices.filter((entity) => heatBand(entity) === "near" || heatBand(entity) === "critical" || heatBand(entity) === "failover");
    body = "<h2>AI Hall 1</h2><p class=\"fine\">Each pod is cold aisle, rack row, hot aisle, rack row, cold aisle. Green traces are energized feeds. Rack A14 fails over to ACS serial.</p>" +
      PODS.map((item) => {
        const servers = item.racks.reduce((all, rack) => all.concat(rackEntities(rack)), []);
        return '<button type="button" class="floor-row" data-act="floor-pod" data-pod="' + item.id + '">' +
          ledDot(servers) + '<span>' + esc(item.name) + "</span><b>" + servers.length + " servers</b></button>";
      }).join("") +
      "<h3>Infrastructure</h3>" + infra.filter((item) => !item.yard && item.kind !== "Aisle").map(rowButton).join("") +
      "<h3>Watch list</h3>" + (managed.map(rowButton).join("") || '<p class="fine">All rack A14 servers are nominal.</p>');
  }
  return '<aside class="inspector"><div class="crumbs">' + crumbs.join("<span>/</span>") + "</div>" + sheet + body + "</aside>";
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

export function explainRest() {
  const rest = activeAlarms().slice(3);
  if (!rest.length) return "";
  const cards = rest.map((alarm) => '<article class="explain-alarm"><h3>' + esc(alarm.asset) + "</h3><p>" +
    esc(alarm.text) + "</p>" + explainHtml(alarmInput(alarm)) + "</article>").join("");
  return '<section class="panel explain-rest"><div class="panel-head"><h2>Other alarms</h2><p class="fine">Each alarm has an Explain panel. The banner keeps the first three. The rest are here.</p></div>' +
    cards + "</section>";
}

export function renderFloor() {
  const planOpen = placementById(state.floor.rackId);
  const deep = state.floor.level === "rack" || state.floor.level === "server" || state.floor.level === "part";
  const openedPlan = deep && planOpen && catalogById(planOpen.catalogId).uCapacity;
  const chassis = !openedPlan && deep && state.floor.rackId;
  const pod = podById(state.floor.podId);
  const rack = rackById(pod, state.floor.rackId);
  const onSite = state.floor.level === "site" || (state.floor.level === "feed" && !pod);
  const scene = onSite ? renderSite() : (openedPlan ? renderPlanChassis(planOpen) : (chassis && rack ? renderChassis(rack, pod) : renderHall()));
  const outside = state.floor.level === "site";
  const future = state.horizon === "future";
  const title = future ? (outside ? "Future · outside the building" : "Future · compute halls") : (outside ? "Outside the building" : "Level 1 · AI Hall");
  const sub = future
    ? "Future state of the whole system. Live control is unchanged. Hall 2, the second feeder, and restored BMC paths are shown as planned."
    : (outside ? "Click the grid, the feeder, a pipe, or the compute hall to open that part." : "Click a pod, a row, a rack, or a server. The next click opens the inlet, exhaust, BMC, or DC feed.");
  return '<div class="page-head"><div class="top"><div><h1>' + title + '</h1><p class="sub">' + sub + "</p></div></div>" +
    pills() + '</div><div class="plan-layout">' + renderLibrary() + '<div class="floor-layout" data-floor-level="' + esc(state.floor.level) + '">' + scene + renderInspector() + "</div></div>" + watchTable() + explainRest();
}

export function zoomFloor(dir) {
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

export function placeCatalog(specItem, host, point) {
  if (specItem.place === "rack") {
    const need = specItem.u || 0;
    if (freeU(host) < need) {
      state.toast = specItem.name + " needs " + need + "U. " + Math.max(0, freeU(host)) + "U is free there.";
      render();
      return;
    }
  }
  const count = state.plan.placements.filter((item) => item.catalogId === specItem.id).length + 1;
  const item = {
    id: "plan-" + state.plan.seq,
    catalogId: specItem.id,
    name: specItem.name + " " + count,
    place: specItem.place,
    x: point ? point.x : 0,
    y: point ? point.y : 0,
    host: host || "",
  };
  state.plan.seq += 1;
  state.plan.placements.push(item);
  state.plan.selected = item.id;
  state.plan.preview = "";
  state.toast = item.name + " placed. " + specItem.powerLabel + " · " + specItem.ampLabel + ".";
  if (specItem.place === "rack") {
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
      state.toast = item.name + " moved.";
      render();
    }
    return;
  }
  const specItem = catalogById(token.slice(4));
  if (!specItem) return;
  if (specItem.place === "floor") placeCatalog(specItem, "", scenePoint(event));
  else placeCatalog(specItem, host.host, null);
}
