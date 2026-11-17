import { devices } from "../data/devices";
import { entityById } from "../data/pods";
import { localPowerFail } from "../domain/events";
import { runtime } from "../state";
import { esc } from "../ui/format";
import { render } from "../ui/schedule";

function watts(value) {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + " MW";
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + " kW";
  return Math.round(n) + " W";
}

function amps(value) {
  const n = Number(value) || 0;
  if (n >= 100) return Math.round(n) + " A";
  return n.toFixed(1) + " A";
}

function factors() {
  const out = {};
  devices.forEach((device) => {
    const entity = entityById(device.id);
    if (!entity || !entity.load) return;
    out[device.id] = (entity.load.power || 0) / 100;
  });
  return out;
}

function slot(id) {
  if (!runtime.powerPanels) runtime.powerPanels = {};
  return runtime.powerPanels[id];
}

export async function loadPower(id) {
  try {
    const response = await fetch("/api/v1/power/nodes/" + encodeURIComponent(id), { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    runtime.powerPanels[id] = response.ok
      ? { data: body, mode: "nameplate" }
      : { error: body.error || "No power path for that device." };
  } catch (err) {
    runtime.powerPanels[id] = { error: "The power chain is not reachable." };
  }
  render();
}

export async function failPower(id, nodeId) {
  const panel = slot(id) || {};
  const mode = panel.mode || "nameplate";
  let body: any = {};
  let response: Response | null = null;
  try {
    response = await fetch("/api/v1/power/fail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId, mode, factors: mode === "measured" ? factors() : {} }),
    });
    body = await response.json().catch(() => ({}));
  } catch (err) {
    response = null;
  }
  if (!response || !response.ok) {
    panel.failError = "";
    panel.fail = localPowerFail(nodeId, mode);
    panel.failed = nodeId;
    runtime.powerPanels[id] = panel;
    render();
    return;
  }
  panel.failError = "";
  panel.fail = body;
  panel.failed = nodeId;
  runtime.powerPanels[id] = panel;
  render();
}

export function setPowerMode(id, mode) {
  const panel = slot(id);
  if (!panel) return;
  panel.mode = mode;
  panel.fail = null;
  runtime.powerPanels[id] = panel;
  render();
}

function hopHtml(hop) {
  const node = hop.node;
  const edge = hop.edge;
  const cap = edge ? watts(edge.capacityW) + " · " + amps(edge.capacityA) : watts(node.capacityW);
  return "<li><b>" + esc(node.name) + "</b><span>" + esc(node.kind) + " · " + cap + "</span></li>";
}

function failHtml(panel, id) {
  const names = { "grid-1": "Feeder A", "grid-2": "Feeder B" };
  const buttons = ["grid-1", "grid-2"].map((nodeId) => '<button type="button" class="act" data-act="power-fail" data-power="' +
    esc(id) + '" data-node="' + nodeId + '">Fail ' + names[nodeId] + "</button>").join("");
  const modes = ["nameplate", "derated", "measured"].map((mode) => '<button type="button" class="act" data-act="power-mode" data-power="' +
    esc(id) + '" data-mode="' + mode + '"' + (panel.mode === mode ? ' aria-pressed="true"' : "") + ">" + mode + "</button>").join("");
  let result = "";
  if (panel.failError) result = '<p class="fine">' + esc(panel.failError) + "</p>";
  if (panel.fail) {
    const lost = panel.fail.lost || [];
    const over = panel.fail.over || [];
    const lostText = lost.length
      ? lost.length + " lose power" + (lost.length <= 6 ? ": " + lost.map((item) => item.name).join(", ") : ".")
      : "No device loses power. The other side still feeds it.";
    const overText = over.length
      ? over.slice(0, 6).map((item) => esc(item.name) + " " + watts(item.carriedW) + " of " + watts(item.capacityW) + " (" + item.percent + "%)").join("<br>")
      : "No node is over 80% of capacity.";
    const alarm = panel.fail.alarmId ? "<p>Alarm recorded for this failure.</p>" : "";
    result = "<p><b>" + esc(names[panel.failed] || panel.failed) + " fails.</b> " + esc(lostText) + "</p><p>" + overText + "</p>" + alarm;
  }
  return '<div class="power-fail">' + modes + buttons + result + "</div>";
}

export function powerHtml(id) {
  if (!id) return "";
  const panel = slot(id);
  if (!panel) {
    runtime.powerPanels[id] = { loading: true };
    loadPower(id);
    return '<section class="power-path"><h3>Power path</h3><p class="fine">Loading the chain…</p></section>';
  }
  if (panel.loading) return '<section class="power-path"><h3>Power path</h3><p class="fine">Loading the chain…</p></section>';
  if (panel.error) return '<section class="power-path"><h3>Power path</h3><p class="fine">' + esc(panel.error) + "</p></section>";
  const data = panel.data || {};
  const paths = (data.paths || []).map((path) => '<div><h4>Side ' + esc(path.side) + "</h4><ol>" +
    (path.hops || []).map(hopHtml).join("") + "</ol></div>").join("");
  const count = data.deviceCount
    ? '<p class="fine">' + data.deviceCount + " devices in this rack, each with an A cord and a B cord.</p>"
    : "";
  return '<section class="power-path"><h3>Power path</h3>' + count + paths + failHtml(panel, id) + "</section>";
}
