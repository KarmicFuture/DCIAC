import { deviceById } from "../data/devices";
import { PODS, entityById } from "../data/pods";
import { state } from "../state";
import { render } from "../ui/schedule";
import { loadElevation } from "../views/elevation";
import { decodeSimPayload, loadScenario } from "./events";

function rowFor(podId, rackId) {
  const pod = PODS.find((item) => item.id === podId);
  if (!pod) return "";
  const rack = (pod.racks || []).find((item) => item.id === rackId);
  return (rack && rack.row) || "";
}

function parseHash(raw) {
  const text = String(raw || "").replace(/^#/, "");
  const cut = text.indexOf("?");
  const path = (cut >= 0 ? text.slice(0, cut) : text).replace(/\/+$/, "");
  const params = new URLSearchParams(cut >= 0 ? text.slice(cut + 1) : "");
  const parts = path.split("/").filter(Boolean);
  return { parts, params };
}

function missing(message) {
  state.toast = message;
}

function applyFloor(rest) {
  state.view = "floor";
  state.floor.serverId = "";
  state.floor.partId = "";
  state.floor.feedId = "";
  state.floor.rowId = "";
  if (!rest.length || rest[0] === "site") {
    state.floor.level = "site";
    state.floor.zoom = 0.72;
    state.floor.panX = 0;
    state.floor.panY = 0;
    state.floor.pitch = 56;
    state.floor.yaw = -40;
    if (rest[1]) state.floor.serverId = decodeURIComponent(rest[1]);
    return;
  }
  if (rest[0] === "hall") {
    state.floor.level = "hall";
    return;
  }
  if (rest[0] === "feed") {
    state.floor.level = "feed";
    state.floor.feedId = decodeURIComponent(rest[1] || "");
    state.floor.podId = "";
    return;
  }
  const podId = decodeURIComponent(rest[0]);
  const pod = PODS.find((item) => item.id === podId);
  if (!pod) {
    state.floor.level = "hall";
    missing("There is no hall called " + podId + ". Showing the hall view.");
    return;
  }
  state.floor.podId = podId;
  if (rest[1] === "row") {
    state.floor.level = "row";
    state.floor.rowId = decodeURIComponent(rest[2] || "");
    return;
  }
  if (rest[1] === "feed") {
    state.floor.level = "feed";
    state.floor.feedId = decodeURIComponent(rest[2] || "");
    return;
  }
  if (!rest[1]) {
    state.floor.level = "pod";
    return;
  }
  const rackId = decodeURIComponent(rest[1]);
  if (!(pod.racks || []).some((item) => item.id === rackId)) {
    state.floor.level = "pod";
    missing("Rack " + rackId + " is not in " + (pod.name || podId) + ". Showing the hall.");
    return;
  }
  state.floor.rackId = rackId;
  state.floor.rowId = rowFor(state.floor.podId, state.floor.rackId);
  if (!rest[2]) {
    state.floor.level = "elevation";
    loadElevation(state.floor.rackId);
    return;
  }
  const serverId = decodeURIComponent(rest[2]);
  if (!entityById(serverId)) {
    state.floor.level = "elevation";
    loadElevation(state.floor.rackId);
    missing("There is no device " + serverId + " in rack " + rackId + ". Showing the rack.");
    return;
  }
  state.floor.serverId = serverId;
  if (!rest[3]) {
    state.floor.level = "server";
    return;
  }
  state.floor.level = "part";
  state.floor.partId = decodeURIComponent(rest[3]);
}

export function hasRoute() {
  const { parts } = parseHash(location.hash);
  return parts.length > 0;
}

export function applyRoute(raw) {
  const { parts, params } = parseHash(raw);
  const head = parts[0] || "floor";
  if (head === "floor") {
    applyFloor(parts.slice(1));
    const simParam = params.get("sim");
    if (simParam) {
      const data = decodeSimPayload(simParam);
      if (data) loadScenario(data);
    }
    return;
  }
  if (head === "rack") {
    state.view = "rack";
    const rack = parts[1] || "";
    const device = parts[2] || (rack && rack !== "A14" ? rack : "");
    if (!device) return;
    const deviceId = decodeURIComponent(device);
    if (deviceById(deviceId)) state.selected = deviceId;
    else missing("There is no device " + deviceId + " in rack A14. Showing " + (deviceById(state.selected) ? deviceById(state.selected).name : "the rack") + ".");
    return;
  }
  if (head === "portmap" || head === "map") {
    state.view = "map";
    const port = Number(params.get("port"));
    state.selectedPort = port > 0 ? port : 0;
    return;
  }
  if (head === "sessions") {
    state.view = "sessions";
    const sessionId = parts[1] ? decodeURIComponent(parts[1]) : "";
    const open = sessionId && state.sessions.some((item) => item.id === sessionId);
    state.focusSession = open ? sessionId : "";
    if (sessionId && !open) missing("That session is closed. Showing open sessions.");
    return;
  }
  if (head === "manage") {
    state.view = "manage";
    if (parts[1]) state.manage.layer = decodeURIComponent(parts[1]);
    if (parts[2]) state.manage.device = decodeURIComponent(parts[2]);
    state.horizon = params.get("horizon") === "future" ? "future" : "now";
    state.containment = params.get("containment") === "cac" ? "cac" : "hac";
    if (state.manage.device) state.selected = state.manage.device;
    return;
  }
  if (head === "control") {
    state.view = "control";
    const outlet = Number(params.get("outlet"));
    state.highlightOutlet = outlet > 0 ? outlet : 0;
    return;
  }
  if (head === "oneline" || head === "one-line") {
    state.view = "oneline";
    return;
  }
  if (head === "fleet") {
    state.view = "fleet";
    return;
  }
  if (head === "audit") {
    state.view = "audit";
    return;
  }
  if (head === "simulate") {
    state.view = "simulate";
    return;
  }
  if (head === "models") {
    state.view = "models";
    return;
  }
  if (head === "dcim") {
    state.view = "dcim";
    return;
  }
  if (head === "plan") {
    state.view = "plan";
    return;
  }
  applyFloor([]);
  missing("There is no page at #/" + parts.join("/") + ". Showing the floor.");
}

export function routeFromState() {
  const floor = state.floor;
  let path = "#/floor";
  if (state.view === "floor") {
    if (floor.level === "hall") path = "#/floor/hall";
    else if (floor.level === "site") path = floor.serverId ? "#/floor/site/" + encodeURIComponent(floor.serverId) : "#/floor";
    else if (floor.level === "feed") {
      path = floor.podId
        ? "#/floor/" + encodeURIComponent(floor.podId) + "/feed/" + encodeURIComponent(floor.feedId || "")
        : "#/floor/feed/" + encodeURIComponent(floor.feedId || "");
    } else if (floor.level === "pod") path = "#/floor/" + encodeURIComponent(floor.podId || "pod-a");
    else if (floor.level === "row") path = "#/floor/" + encodeURIComponent(floor.podId || "pod-a") + "/row/" + encodeURIComponent(floor.rowId || "");
    else if (floor.level === "rack" || floor.level === "elevation") path = "#/floor/" + encodeURIComponent(floor.podId || "pod-a") + "/" + encodeURIComponent(floor.rackId || "A14");
    else if (floor.level === "server" || floor.level === "part") {
      path = "#/floor/" + encodeURIComponent(floor.podId || "pod-a") + "/" + encodeURIComponent(floor.rackId || "A14") + "/" + encodeURIComponent(floor.serverId || "");
      if (floor.level === "part" && floor.partId) path += "/" + encodeURIComponent(floor.partId);
    }
    return path;
  }
  if (state.view === "rack") return "#/rack/A14/" + encodeURIComponent(state.selected || "tray-01");
  if (state.view === "map") return state.selectedPort ? "#/portmap?port=" + state.selectedPort : "#/portmap";
  if (state.view === "sessions") return state.focusSession ? "#/sessions/" + encodeURIComponent(state.focusSession) : "#/sessions";
  if (state.view === "manage") {
    path = "#/manage/" + encodeURIComponent(state.manage.layer || "bmc") + "/" + encodeURIComponent(state.manage.device || "tray-01");
    const query = [];
    if (state.horizon === "future") query.push("horizon=future");
    if (state.containment === "cac") query.push("containment=cac");
    return query.length ? path + "?" + query.join("&") : path;
  }
  if (state.view === "control") return state.highlightOutlet ? "#/control?outlet=" + state.highlightOutlet : "#/control";
  if (state.view === "oneline") return "#/oneline";
  if (state.view === "fleet") return "#/fleet";
  if (state.view === "audit") return "#/audit";
  if (state.view === "simulate") return "#/simulate";
  if (state.view === "models") return "#/models";
  if (state.view === "dcim") return "#/dcim";
  if (state.view === "plan") return "#/plan";
  return "#/floor";
}

/* The hash this module last wrote or applied. If location.hash differs, someone
   else (a link, the address bar, Back) changed it and a hashchange event is on its
   way, so syncHash must not overwrite it with the page being left. */
let knownHash = "";

export function syncHash() {
  if (!state.user) return;
  const current = location.hash || "";
  if (knownHash && current !== knownHash) return;
  const next = routeFromState();
  if (current === next) {
    knownHash = next;
    return;
  }
  const bare = !location.hash || location.hash === "#" || location.hash === "#/";
  const url = location.pathname + location.search + next;
  knownHash = next;
  if (bare) history.replaceState(null, "", url);
  else location.hash = next;
}

export function onHashChange() {
  knownHash = location.hash || "";
  if (!state.user) return;
  if (knownHash === routeFromState()) return;
  state.toast = "";
  applyRoute(location.hash);
  const next = routeFromState();
  if (knownHash !== next) {
    history.replaceState(null, "", location.pathname + location.search + next);
  }
  knownHash = next;
  render();
}
