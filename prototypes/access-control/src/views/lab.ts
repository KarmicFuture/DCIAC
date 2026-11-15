import { devices } from "../data/devices";
import { authHeaders } from "../data/repository";
import { outlets } from "../data/outlets";
import { audit, userAudit } from "../domain/audit";
import { clearDemo, demoPanel } from "../domain/demo";
import { applyCapacitySeed } from "../domain/failover";
import { state } from "../state";
import { esc } from "../ui/format";
import { render } from "../ui/schedule";

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
  applyCapacitySeed();
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
  if (state.leak) samples.push({ deviceId: "di-1", name: "leak", value: 1, unit: "state" });
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

export function lab() {
  const gear = devices.map((d) => '<div class="lab-row"><div><strong>' + esc(d.name) + '</strong><div class="fine">' +
    (d.bmc === "up" ? "BMC up" : "BMC dark · on ACS") + '</div></div><button type="button" class="act" data-act="bmc-toggle" data-device="' +
    d.id + '">' + (d.bmc === "up" ? "Drop BMC" : "Restore BMC") + "</button></div>").join("");
  return '<button type="button" class="backdrop" data-act="lab-close" aria-label="Close lab"></button><aside class="lab" aria-label="Lab" tabindex="0">' +
    demoPanel() +
    '<div class="lab-head"><div><p class="kicker">Simulated world</p><h2>Lab</h2></div>' +
    '<button type="button" class="act" data-act="lab-close">Close</button></div>' +
    '<p class="fine">External gear only. This drawer is not an Access screen. Drop a BMC to fail that device over to ACS. Drop RDP to move the desktop onto ACS KVM. RM1048 does not take either failover.</p>' +
    '<button type="button" class="act" data-act="lab-post">Post readings</button>' +
    '<div class="lab-row"><div><strong>RM1048 plane</strong><div class="fine">' +
    (state.rm1048 === "healthy" ? "Healthy" : "Dark") + '</div></div><button type="button" class="act" data-act="rm-toggle">' +
    (state.rm1048 === "healthy" ? "Mark dark" : "Mark healthy") + "</button></div>" +
    '<div class="lab-row"><div><strong>DI-1 leak rope</strong><div class="fine">' +
    (state.leak ? "Asserted" : "Quiet") + '</div></div><button type="button" class="act" data-act="leak-toggle">' +
    (state.leak ? "Clear DI-1" : "Trip DI-1") + "</button></div>" +
    '<div class="lab-block"><label class="field">Window name<input id="maint-name" data-focus-key="maint-name"></label><label class="field">Window work order<input id="maint-wo" data-focus-key="maint-wo"></label><button type="button" class="act primary" data-act="maint-toggle">' +
    (state.maintenance ? "Close maintenance window" : "Open maintenance window") + "</button>" +
    (state.maintenance ? '<p class="fine">Open now: ' + esc(state.maintenance.name) + "</p>" : "") +
    "</div><h3>BMC paths</h3>" + gear +
    "<h3>RDP desktops</h3>" + devices.filter((d) => d.kind === "GPU tray").map((d) => '<div class="lab-row"><div><strong>' +
      esc(d.name) + '</strong><div class="fine">' + (d.rdp === "up" ? "RDP up" : "RDP down · KVM") +
      '</div></div><button type="button" class="act" data-act="rdp-toggle" data-device="' + d.id + '">' +
      (d.rdp === "up" ? "Drop RDP" : "Restore RDP") + "</button></div>").join("") +
    "<h3>Serial auto-login</h3>" + devices.map((d) => '<div class="lab-row"><div><strong>' +
      esc(d.name) + '</strong><div class="fine mono">' + esc(d.tty) + " · " + (d.watchDeny ? "acs.watch denied" : "acs.watch allowed") +
      '</div></div><button type="button" class="act" data-act="watch-toggle" data-device="' + d.id + '">' +
      (d.watchDeny ? "Allow auto-login" : "Reject auto-login") + "</button></div>").join("") +
    '<button type="button" class="act danger" data-act="reset-world">Reset world</button></aside>';
}
