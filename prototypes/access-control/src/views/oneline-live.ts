import { deviceById } from "../data/devices";
import { outlets } from "../data/outlets";
import { PLANT, PODS, YARD, entityById, heatBand } from "../data/pods";
import { breakEventsForEntity, breakThisHtml, impact } from "../domain/events";
import type { SimImpact } from "../domain/events";
import { runtime, state } from "../state";
import { activeAlarms } from "../ui/alarms";
import { esc } from "../ui/format";
import { outletState } from "./rack3d";

/* The one-line as a live control room: a scoreboard over the diagram, a fly-out on the
   right with the live details of whatever node you click, and values that tick in place
   every second (updateOnelineLive) without redrawing the diagram. */

type Info = {
  id: string;
  name: string;
  kind: string;
  capacityKw: number;
  entityId: string;
  floor: string;
  up: string[];
  down: string;
};

const NAMES: Record<string, string> = {
  "bus-a": "Hall 1 busway",
  "pdu-A14-a": "Rack PDU A (A14)",
  "pdu-A14-b": "Rack PDU B (A14)",
  "batt-1": "Battery A",
  "batt-2": "Battery B",
};

function hallIndex(id: string) {
  return PODS.findIndex((pod) => pod.id === id);
}

function modulesFor(index: number) {
  return index < 5 ? ["pwr-mod", "pwr-2"] : ["pwr-3", "pwr-4"];
}

function feederChain(module: string) {
  const sideA = module === "pwr-mod" || module === "pwr-3";
  return [module, sideA ? "xfmr-1" : "xfmr-2", sideA ? "grid-1" : "grid-2"];
}

function nameOf(id: string) {
  if (NAMES[id]) return NAMES[id];
  if (/^outlet-\d+$/.test(id)) return "Outlet " + id.slice(7);
  const pod = PODS.find((p) => p.id === id);
  if (pod) return pod.name;
  const item = YARD.find((y) => y.id === id) || entityById(id) || deviceById(id);
  return (item && item.name) || id;
}

/* Where a node sits in the chain, its rating, and what it feeds. Ratings follow the
   power graph seeded in server/power_seed.py. */
export function nodeInfo(id: string): Info | null {
  if (!id) return null;
  // An empty socket on the diagram shows its outlet.
  if (/^unbound-\d+$/.test(id)) id = "outlet-" + id.slice(8);
  const hall = hallIndex(id);
  if (hall >= 0) {
    const mods = modulesFor(hall);
    return { id, name: nameOf(id), kind: "Hall", capacityKw: PLANT.hallItMw * 1000, entityId: "bus-" + (hall === 0 ? "a" : String(hall + 1)), floor: "hall",
      up: ["bus-" + (hall === 0 ? "a" : String(hall + 1))].concat(feederChain(mods[0])), down: (PODS[hall].racks || []).length + " racks" };
  }
  if (id === "bus-a") return { id, name: nameOf(id), kind: "Busway", capacityKw: 16000, entityId: id, floor: "pod-a", up: feederChain("pwr-mod"), down: "20 racks and rack PDUs A and B on A14" };
  if (id === "pdu-A14-a" || id === "pdu-A14-b") {
    return { id, name: nameOf(id), kind: "Rack PDU", capacityKw: 120, entityId: "", floor: "", up: ["bus-a"].concat(feederChain(id.endsWith("a") ? "pwr-mod" : "pwr-2")), down: outlets.length + " outlets" };
  }
  const outlet = /^outlet-(\d+)$/.exec(id);
  if (outlet) {
    const o = outlets.find((row) => row.n === Number(outlet[1]));
    const d = o && o.deviceId ? deviceById(o.deviceId) : null;
    return { id, name: nameOf(id), kind: "Outlet", capacityKw: 6, entityId: d ? d.id : "", floor: "", up: ["pdu-A14-a", "pdu-A14-b", "bus-a"], down: d ? d.name : "Unbound" };
  }
  const d = deviceById(id);
  if (d) {
    return { id, name: d.name, kind: d.kind, capacityKw: d.kind === "GPU tray" ? 12 : (d.kind === "Switch" ? 0.4 : 3), entityId: id, floor: "server",
      up: ["outlet-" + d.outlet, "pdu-A14-a", "pdu-A14-b", "bus-a"], down: "PSU A and PSU B" };
  }
  const yard = YARD.find((y) => y.id === id) || entityById(id);
  if (!yard) return null;
  const caps: Record<string, number> = { "grid-1": 150000, "grid-2": 150000, "xfmr-1": 150000, "xfmr-2": 150000, "pwr-mod": 80000, "pwr-2": 80000, "pwr-3": 80000, "pwr-4": 80000, "batt-1": 20000, "batt-2": 20000 };
  const ups: Record<string, string[]> = {
    "xfmr-1": ["grid-1"], "xfmr-2": ["grid-2"], "pwr-mod": ["xfmr-1", "grid-1"], "pwr-3": ["xfmr-1", "grid-1"],
    "pwr-2": ["xfmr-2", "grid-2"], "pwr-4": ["xfmr-2", "grid-2"], "batt-1": ["pwr-mod"], "batt-2": ["pwr-2"],
  };
  const downs: Record<string, string> = {
    "grid-1": "Transformer A, power modules A and C", "grid-2": "Transformer B, power modules B and D",
    "xfmr-1": "Power modules A and C", "xfmr-2": "Power modules B and D",
    "pwr-mod": "Halls 1 to 5 (A side)", "pwr-2": "Halls 1 to 5 (B side)", "pwr-3": "Halls 6 to 10 (A side)", "pwr-4": "Halls 6 to 10 (B side)",
    "batt-1": "Ride-through for power module A", "batt-2": "Ride-through for power module B",
  };
  return { id, name: nameOf(id), kind: yard.kind || "Power", capacityKw: caps[id] || 0, entityId: id, floor: "server", up: ups[id] || [], down: downs[id] || "" };
}

function statusOf(info: Info, report: SimImpact) {
  if (runtime.sim.feedersDown && runtime.sim.feedersDown[info.id]) return { word: "Open", tone: "bad" };
  if (report.active && report.failedFeeds.indexOf(info.id) >= 0) return { word: "Failed", tone: "bad" };
  const outlet = /^outlet-(\d+)$/.exec(info.id);
  if (outlet) {
    const o = outlets.find((row) => row.n === Number(outlet[1]));
    const s = o ? outletState(o) : "off";
    if (s === "locked") return { word: "Locked by DI-1", tone: "bad" };
    if (s === "off") return { word: "Off", tone: "idle" };
    if (s === "cycling") return { word: "Cycling", tone: "warn" };
  }
  if (report.active && report.affected[info.id]) return { word: "At risk", tone: "warn" };
  const entity = info.entityId ? entityById(info.entityId) : null;
  if (entity && entity.bmc === "down") return { word: "BMC down", tone: "bad" };
  if (entity && heatBand(entity) === "critical") return { word: "Hot", tone: "bad" };
  if (entity && heatBand(entity) === "near") return { word: "Warm", tone: "warn" };
  return { word: "Energized", tone: "ok" };
}

function alarmsFor(info: Info) {
  const d = deviceById(info.entityId || info.id);
  return activeAlarms().filter((a) => a.device === info.id || (d && a.device === d.id) || a.asset === info.name);
}

/* 0–100. Starts full and loses points for faults, heat, load and open alarms. */
function healthOf(info: Info, report: SimImpact) {
  const status = statusOf(info, report);
  const entity = info.entityId ? entityById(info.entityId) : null;
  let score = 100;
  if (status.tone === "bad") score -= 55;
  else if (status.tone === "warn") score -= 25;
  else if (status.tone === "idle") score -= 10;
  if (entity && entity.load) score -= Math.max(0, (entity.load.power || 0) - 80) * 1.5;
  score -= alarmsFor(info).reduce((n, a) => n + (a.pri === 1 ? 20 : a.pri === 2 ? 10 : 4), 0);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function gauge(label: string, key: string, pct: number, text: string) {
  const v = Math.max(0, Math.min(100, pct));
  const tone = v >= 90 ? "bad" : v >= 75 ? "warn" : "ok";
  return '<div class="olf-gauge ' + tone + '"><span>' + esc(label) + '</span><div class="olf-bar"><i data-olf="' + key + '" style="width:' + v.toFixed(1) + '%"></i></div><b data-olf-text="' + key + '">' + esc(text) + "</b></div>";
}

function ring(score: number, key: string) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const tone = score >= 85 ? "ok" : score >= 60 ? "warn" : "bad";
  return '<svg class="ol-ring ' + tone + '" viewBox="0 0 76 76" aria-hidden="true"><circle cx="38" cy="38" r="' + r + '" class="ol-ring-bg"/>' +
    '<circle cx="38" cy="38" r="' + r + '" class="ol-ring-fg" data-ring="' + key + '" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + (c * (1 - score / 100)).toFixed(1) +
    '" transform="rotate(-90 38 38)"/><text x="38" y="44" data-ring-text="' + key + '">' + score + "</text></svg>";
}

function kw(n: number) {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 1 : 2) + " MW";
  return n.toFixed(n >= 100 ? 0 : 1) + " kW";
}

function liveRows(info: Info) {
  const entity = info.entityId ? entityById(info.entityId) : null;
  if (!entity || !entity.load) {
    return '<p class="fine">No live reading for this node. It follows the state of what feeds it.</p>';
  }
  const p = entity.load.power || 0;
  let html = gauge("Load", "power", p, Math.round(p) + "% · " + kw(info.capacityKw * p / 100));
  if (entity.load.temp) html += gauge("Temperature", "temp", entity.load.temp, entity.load.temp.toFixed(1) + " °C");
  if (deviceById(entity.id)) {
    html += gauge("GPU", "gpu", entity.load.gpu || 0, Math.round(entity.load.gpu || 0) + "%");
    html += gauge("Memory", "mem", entity.load.mem || 0, Math.round(entity.load.mem || 0) + "%");
  }
  return html;
}

function crumb(id: string) {
  return '<button type="button" class="linkish" data-act="ol-pick" data-server="' + esc(id) + '">' + esc(nameOf(id)) + "</button>";
}

export function olFlyoutHtml(report: SimImpact) {
  const info = nodeInfo(runtime.olPick);
  if (!info) return "";
  const status = statusOf(info, report);
  const alarms = alarmsFor(info);
  const health = healthOf(info, report);
  const hall = hallIndex(info.id) >= 0;
  const open = hall
    ? '<button type="button" class="act" data-act="oneline-hall" data-pod="' + esc(info.id) + '">Open on the floor</button>'
    : (info.floor === "pod-a" ? '<button type="button" class="act" data-act="oneline-hall" data-pod="pod-a">Open Hall 1 on the floor</button>'
      : (info.floor === "server" ? '<button type="button" class="act" data-act="oneline-open" data-server="' + esc(info.id) + '">Open on the floor</button>' : ""));
  const control = /^outlet-|^pdu-A14/.test(info.id) ? '<button type="button" class="act" data-act="nav" data-view="control">Open Control</button>' : "";
  const entity = entityById(info.id);
  const breakIt = entity && !hall ? breakThisHtml(info.id, breakEventsForEntity(entity)) : "";
  return '<aside class="ol-fly" id="ol-fly" role="dialog" aria-modal="false" aria-labelledby="ol-fly-title" data-pick="' + esc(info.id) + '">' +
    '<div class="olf-head"><div><p class="olf-kind">' + esc(info.kind) + '</p><h3 id="ol-fly-title">' + esc(info.name) + "</h3>" +
    '<span class="olf-status ' + status.tone + '" data-olf-status>' + esc(status.word) + "</span></div>" +
    '<button type="button" class="act olf-close" id="ol-fly-close" data-act="ol-close" aria-label="Close details">×</button></div>' +
    '<div class="olf-score">' + ring(health, "node") + '<div><b>Health</b><p class="fine">' +
    (health >= 85 ? "Running clean." : health >= 60 ? "Needs a look." : "Act now.") + "</p>" +
    (info.capacityKw ? '<p class="fine">Rated ' + esc(kw(info.capacityKw)) + "</p>" : "") + "</div></div>" +
    '<section class="olf-sec"><h4>Live</h4>' + liveRows(info) + "</section>" +
    '<section class="olf-sec"><h4>Fed from</h4>' + (info.up.length ? '<p class="olf-path">' + info.up.map(crumb).join('<span aria-hidden="true">←</span>') + "</p>" : '<p class="fine">The utility.</p>') + "</section>" +
    (info.down ? '<section class="olf-sec"><h4>Feeds</h4><p>' + esc(info.down) + "</p></section>" : "") +
    '<section class="olf-sec"><h4>Alarms</h4>' + (alarms.length ? "<ul class=\"olf-alarms\">" + alarms.map((a) => '<li class="olf-pri-' + a.pri + '"><b>P' + a.pri + "</b> " + esc(a.text) + "</li>").join("") + "</ul>" : '<p class="fine">None open.</p>') + "</section>" +
    (report.active && report.affected[info.id] ? '<p class="olf-risk">At risk in the running scenario. ' + esc(report.summary || "") + "</p>" : "") +
    '<div class="olf-actions">' + open + control + "</div>" + breakIt + "</aside>";
}

/* ── Scoreboard ─────────────────────────────────────────────────────────────────── */

function siteScore(report: SimImpact) {
  const feeders = ["grid-1", "grid-2"].filter((id) => !(runtime.sim.feedersDown && runtime.sim.feedersDown[id])).length;
  const alarms = activeAlarms();
  let score = 100 - (2 - feeders) * 25 - alarms.filter((a) => a.pri === 1).length * 6 - alarms.filter((a) => a.pri === 2).length * 3;
  if (report.active && report.loadLost) score -= 30;
  else if (report.active && report.redundancyGone) score -= 15;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function itMw() {
  // Each hall's busway load, as a share of its 10 MW IT.
  return PODS.reduce((sum, pod, i) => {
    const bus = entityById("bus-" + (i === 0 ? "a" : String(i + 1)));
    return sum + PLANT.hallItMw * ((bus && bus.load ? bus.load.power : 60) / 100);
  }, 0);
}

function grade(score: number) {
  return score >= 95 ? "S" : score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D";
}

function badges(report: SimImpact) {
  const alarms = activeAlarms();
  const hot = YARD.concat(PODS.map((p) => ({ id: "bus-" + (PODS.indexOf(p) === 0 ? "a" : String(PODS.indexOf(p) + 1)) }))).some((g) => {
    const e = entityById(g.id);
    return e && heatBand(e) === "critical";
  });
  return [
    { id: "dual", name: "Dual feed", got: !(runtime.sim.feedersDown && (runtime.sim.feedersDown["grid-1"] || runtime.sim.feedersDown["grid-2"])), how: "Both utility feeders closed" },
    { id: "nop1", name: "No P1", got: !alarms.some((a) => a.pri === 1), how: "Clear every P1 alarm" },
    { id: "cool", name: "Cool head", got: !hot, how: "No power gear running hot" },
    { id: "outlets", name: "Full rack", got: outlets.every((o) => o.power !== "off"), how: "Every A14 outlet on" },
    { id: "dry", name: "Dry floor", got: !state.leak, how: "DI-1 quiet" },
    { id: "survivor", name: "Survivor", got: !report.active && runtime.sim.log.some((e) => e.kind === "event"), how: "Ride out a Simulate scenario and reset" },
  ];
}

function streakText() {
  const s = Math.max(0, Math.floor((Date.now() - (runtime.olCalmSince || Date.now())) / 1000));
  const m = Math.floor(s / 60);
  return (m ? m + "m " : "") + String(s % 60).padStart(m ? 2 : 1, "0") + "s";
}

export function olHudHtml(report: SimImpact) {
  if (!runtime.olCalmSince || report.active) runtime.olCalmSince = Date.now();
  const score = siteScore(report);
  const feeders = ["grid-1", "grid-2"].filter((id) => !(runtime.sim.feedersDown && runtime.sim.feedersDown[id])).length;
  const redundancy = report.active && report.loadLost ? "Lost" : (feeders < 2 || (report.active && report.redundancyGone) ? "N" : "2N");
  const on = outlets.filter((o) => o.power !== "off").length;
  const list = badges(report);
  const got = list.filter((b) => b.got).length;
  const chips = list.map((b) => '<li class="ol-badge' + (b.got ? " got" : "") + '" title="' + esc(b.how) + '"><span aria-hidden="true">' + (b.got ? "★" : "☆") + "</span>" + esc(b.name) +
    '<span class="sr-only">' + (b.got ? " unlocked" : " locked: " + esc(b.how)) + "</span></li>").join("");
  return '<section class="ol-hud" aria-label="Power scoreboard">' +
    '<div class="ol-hud-score">' + ring(score, "site") + '<div><span class="ol-hud-label">Grid health</span><b class="ol-grade" data-ol-grade>Grade ' + grade(score) + "</b></div></div>" +
    '<div class="ol-stat"><span class="ol-hud-label">IT load</span><b data-ol-live="it">' + itMw().toFixed(1) + ' MW</b><span class="fine">of ' + PLANT.itMw + " MW</span></div>" +
    '<div class="ol-stat ' + (redundancy === "2N" ? "ok" : redundancy === "N" ? "warn" : "bad") + '"><span class="ol-hud-label">Redundancy</span><b>' + redundancy + '</b><span class="fine">' + feeders + " of 2 feeders</span></div>" +
    '<div class="ol-stat"><span class="ol-hud-label">A14 outlets</span><b>' + on + " / " + outlets.length + '</b><span class="fine">on</span></div>' +
    '<div class="ol-stat"><span class="ol-hud-label">Fault-free</span><b data-ol-streak>' + streakText() + '</b><span class="fine">' + (report.active ? "scenario running" : "this session") + "</span></div>" +
    '<div class="ol-xp"><span class="ol-hud-label">Achievements ' + got + " / " + list.length + '</span><div class="ol-xp-bar"><i style="width:' + (got / list.length * 100).toFixed(0) + '%"></i></div><ul>' + chips + "</ul></div>" +
    "</section>";
}

/* Called every second while the one-line is open: values tick without a redraw. */
export function updateOnelineLive() {
  const root = document.querySelector(".oneline-page");
  if (!root) return;
  const report = impact(runtime.sim);
  const it = root.querySelector('[data-ol-live="it"]');
  if (it) it.textContent = itMw().toFixed(1) + " MW";
  const streak = root.querySelector("[data-ol-streak]");
  if (streak) streak.textContent = streakText();
  root.querySelectorAll<SVGRectElement>("rect.ol-load[data-load-for]").forEach((bar) => {
    const id = bar.getAttribute("data-load-for") || "";
    const entity = entityById(id);
    const box = bar.previousElementSibling as SVGRectElement | null;
    if (!entity || !entity.load || !box) return;
    const full = (parseFloat(box.getAttribute("width") || "0") || 0) - 8;
    bar.setAttribute("width", (full * Math.max(0, Math.min(100, entity.load.power || 0)) / 100).toFixed(1));
  });
  const fly = document.getElementById("ol-fly");
  const info = fly ? nodeInfo(fly.getAttribute("data-pick") || "") : null;
  if (!fly || !info) return;
  const entity = info.entityId ? entityById(info.entityId) : null;
  if (entity && entity.load) {
    ["power", "temp", "gpu", "mem"].forEach((key) => {
      const bar = fly.querySelector<HTMLElement>('[data-olf="' + key + '"]');
      const text = fly.querySelector('[data-olf-text="' + key + '"]');
      const v = entity.load[key] || 0;
      if (bar) bar.style.width = Math.max(0, Math.min(100, v)).toFixed(1) + "%";
      if (!text) return;
      text.textContent = key === "temp" ? v.toFixed(1) + " °C" : key === "power" ? Math.round(v) + "% · " + kw(info.capacityKw * v / 100) : Math.round(v) + "%";
    });
  }
  const score = healthOf(info, report);
  const ringEl = fly.querySelector('[data-ring="node"]');
  const ringText = fly.querySelector('[data-ring-text="node"]');
  if (ringEl) ringEl.setAttribute("stroke-dashoffset", (2 * Math.PI * 30 * (1 - score / 100)).toFixed(1));
  if (ringText) ringText.textContent = String(score);
}

export function closeOlFlyout() {
  runtime.olPick = "";
  state.focusField = "";
}

