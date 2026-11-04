import { PODS } from "../data/pods";
import { state } from "../state";
import { render } from "../ui/schedule";

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
  state.floor.podId = decodeURIComponent(rest[0]);
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
  state.floor.rackId = decodeURIComponent(rest[1]);
  state.floor.rowId = rowFor(state.floor.podId, state.floor.rackId);
  if (!rest[2]) {
    state.floor.level = "rack";
    return;
  }
  state.floor.serverId = decodeURIComponent(rest[2]);
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
    return;
  }
  if (head === "rack") {
    state.view = "rack";
    const rack = parts[1] || "";
    const device = parts[2] || (rack && rack !== "A14" ? rack : "");
    if (device) state.selected = decodeURIComponent(device);
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
    state.focusSession = parts[1] ? decodeURIComponent(parts[1]) : "";
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
  if (head === "audit") {
    state.view = "audit";
  }
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
    else if (floor.level === "rack") path = "#/floor/" + encodeURIComponent(floor.podId || "pod-a") + "/" + encodeURIComponent(floor.rackId || "A14");
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
  if (state.view === "audit") return "#/audit";
  return "#/floor";
}

export function syncHash() {
  if (!state.user) return;
  const next = routeFromState();
  if ((location.hash || "") === next) return;
  const bare = !location.hash || location.hash === "#" || location.hash === "#/";
  const url = location.pathname + location.search + next;
  if (bare) history.replaceState(null, "", url);
  else location.hash = next;
}

export function onHashChange() {
  if (!state.user) return;
  if ((location.hash || "") === routeFromState()) return;
  applyRoute(location.hash);
  const next = routeFromState();
  if ((location.hash || "") !== next) {
    history.replaceState(null, "", location.pathname + location.search + next);
  }
  render();
}
