import { devices } from "../data/devices";
import { authHeaders } from "../data/repository";
import { outlets } from "../data/outlets";
import { audit, userAudit } from "../domain/audit";
import { clearDemo, demoPanel } from "../domain/demo";
import { resetSimulation, simBarHtml } from "../domain/events";
import { state } from "../state";
import { esc } from "../ui/format";
import { render } from "../ui/schedule";
import { glButton } from "../ui/shell";
import { powerHtml } from "./power";

export function toggleMaint() {
  if (state.maintenance) {
    const name = state.maintenance.name;
    state.maintenance = null;
    userAudit("maintenance close", { detail: name, wo: "" });
    state.toast = "Maintenance window closed.";
  } else {
    const name = (state.maintName || "").trim();
    if (!name) {
      state.toast = "Name the maintenance window.";
      render();
      return;
    }
    state.maintenance = { name, wo: (state.maintWo || "").trim() };
    userAudit("maintenance open", { detail: name, wo: state.maintenance.wo });
    state.toast = "Maintenance window " + name + " is open.";
  }
  render();
}

export function saveAsset() {
  if (!state.user || state.user.role !== "Administrator") {
    state.toast = "Administrator role writes the ACS asset tag.";
    render();
    return;
  }
  const next = (state.assetTagDraft || "").trim();
  if (!next) {
    state.toast = "Enter an asset tag.";
    render();
    return;
  }
  if (next === state.assetTag) {
    state.toast = "Asset tag is unchanged.";
    render();
    return;
  }
  const prev = state.assetTag;
  state.assetTag = next;
  state.assetTagDraft = next;
  userAudit("asset tag", { asset: "ACS-A14", detail: prev + " → " + next, wo: "" });
  state.toast = "Asset tag is " + next + ".";
  render();
}

export function resetWorld() {
  resetSimulation();
  outlets.forEach((o) => { o.power = "on"; });
  state.floor.level = "site";
  state.floor.podId = "pod-a";
  state.floor.rackId = "A14";
  state.floor.serverId = "";
  state.floor.rowId = "";
  state.floor.feedId = "";
  state.floor.partId = "";
  state.floor.pitch = 56;
  state.floor.yaw = -40;
  state.floor.zoom = 0.72;
  state.floor.panX = 0;
  state.floor.panY = 0;
  state.floor.chassisPitch = 12;
  state.floor.chassisYaw = -18;
  state.floor.chassisZoom = 1;
  state.game.score = 0;
  state.game.streak = 0;
  state.game.best = 0;
  state.game.catches = 0;
  state.game.awarded = {};
  state.acked = {};
  state.alarmSince = {};
  state.rm1048 = "healthy";
  state.leak = false;
  state.outletGate = null;
  clearDemo();
  state.maintenance = null;
  state.sessions = [];
  state.fails = {};
  state.refuseNote = null;
  state.assetTag = "ACS-A14";
  state.assetTagDraft = "ACS-A14";
  state.wo = "";
  state.plan.placements = [];
  state.plan.selected = "";
  state.plan.preview = "";
  state.plan.seq = 1;
  state.horizon = "now";
  state.buildDate = "2026-11-16";
  state.libraryOpen = false;
  state.inspectorOpen = false;
  state.manage = { layer: "bmc", device: "tray-01" };
  state.containment = "hac";
  state.toast = "Simulated world reset. BMC paths are up and RM1048 is healthy.";
  audit({
    user: "lab",
    role: "simulator",
    action: "world reset",
    detail: "BMC up, RM1048 healthy, DI-1 quiet, outlets on",
  });
  render();
}

export async function postLabReadings() {
  const samples = [];
  devices.forEach((d) => {
    if (d.bmc === "up") samples.push({ deviceId: d.id, name: "inlet", value: 24, unit: "C" });
    samples.push({ deviceId: d.id, name: "serial", value: d.watchDeny ? 0 : 1, unit: "up" });
    samples.push({ deviceId: d.id, name: "power", value: d.bmc === "up" ? 40 : 0, unit: "%" });
  });
  // DI-1 always reports, so a quiet reading clears the server-side leak interlock.
  samples.push({ deviceId: "di-1", name: "leak", value: state.leak ? 1 : 0, unit: "state" });
  if (state.rm1048 !== "healthy") samples.push({ deviceId: "rm1048", name: "power", value: 0, unit: "%" });
  try {
    const response = await fetch("/api/v1/collect", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ source: "lab", samples }),
    });
    const body = await response.json().catch(() => ({}));
    state.toast = response.ok
      ? "Lab posted " + samples.length + " readings. Assets stay unchanged."
      : (body.error || "The lab collector was refused.");
  } catch (err) {
    state.toast = "The lab collector did not run.";
  }
  render();
}

function simBody() {
  return demoPanel() +
    '<p class="fine">Inject faults with the bar below. Feeder loss runs the capacity redundancy check. Break events stay on the floor model; RM1048 does not take BMC or RDP failover.</p>' +
    '<section class="panel"><h2>Fault bar</h2>' + simBarHtml() + "</section>" +
    '<section class="panel"><h2>Power redundancy</h2>' + powerHtml("A14") + "</section>" +
    '<section class="panel"><h2>Planes and sensors</h2><button type="button" class="act" data-act="lab-post">Post readings</button>' +
    '<div class="lab-block"><label class="field">Window name<input id="maint-name" data-focus-key="maint-name"></label><label class="field">Window work order<input id="maint-wo" data-focus-key="maint-wo"></label><button type="button" class="act primary" data-act="maint-toggle">' +
    (state.maintenance ? "Close maintenance window" : "Open maintenance window") + "</button>" +
    (state.maintenance ? '<p class="fine">Open now: ' + esc(state.maintenance.name) + "</p>" : "") +
    "</div></section>" +
    '<button type="button" class="act danger" data-act="reset-world">Reset world</button>';
}

export function renderSimulate() {
  const noc = state.theme === "noc";
  return '<div class="page-head"><div class="top"><div><h1>Simulate</h1>' +
    '<p class="sub">Capacity and redundancy faults against the live campus model.</p></div>' +
    '<div class="head-buttons">' + glButton("head-gl-toggle") + '<button type="button" class="act theme-toggle" data-act="theme" aria-pressed="' + (noc ? "true" : "false") +
    '">NOC theme</button></div></div></div>' + simBody();
}

export function lab() {
  return '<button type="button" class="backdrop" data-act="lab-close" aria-label="Close lab"></button><aside class="lab" aria-label="Lab" tabindex="0">' +
    '<div class="lab-head"><div><p class="kicker">Simulated world</p><h2>Lab</h2></div>' +
    '<button type="button" class="act" data-act="lab-close">Close</button></div>' + simBody() + "</aside>";
}
