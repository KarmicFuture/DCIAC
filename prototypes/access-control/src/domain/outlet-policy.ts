import { deviceById } from "../data/devices";
import { outletByN, outlets } from "../data/outlets";
import { currentWo, maintenanceOpen, userAudit } from "./audit";
import { bmcText } from "./failover";
import { sessionLocator, sessionTitle } from "./sessions";
import { state } from "../state";
import { esc } from "../ui/format";
import { render } from "../ui/schedule";

const HOLD_MS = 10000;

export function outletReason(outlet) {
  if (!state.user) return "Sign in required.";
  if (state.user.role === "ReadOnly") return "ReadOnly cannot cycle outlets.";
  if (!outlet.deviceId && !maintenanceOpen()) {
    return "Unbound outlet. Control stays disabled until a maintenance window is open.";
  }
  if (outlet.deviceId && state.rm1048 === "healthy" && !maintenanceOpen()) {
    const mapped = deviceById(outlet.deviceId);
    if (mapped.bmc === "down") return "";
    return "RM1048 owns Control for " + mapped.name + " while its BMC is up. A dark BMC fails over to ACS, including this outlet.";
  }
  return "";
}

export function allOutletsReason() {
  if (!state.user) return "Sign in required.";
  if (state.user.role === "ReadOnly") return "ReadOnly cannot cycle outlets.";
  if (!maintenanceOpen()) {
    return "Whole-PDU control stays disabled until a named maintenance window is open. Plant-wide trip is not the policy.";
  }
  return "";
}

export function showOutlet(n) {
  state.view = "control";
  state.highlightOutlet = Number(n);
  state.toast = "";
  render();
}

function assetName(outlet) {
  return outlet && outlet.deviceId ? deviceById(outlet.deviceId).name : "Unbound";
}

function liveSessions(deviceId) {
  if (!deviceId) return [];
  return state.sessions.filter((session) => session.deviceId === deviceId);
}

function sessionLabel(session) {
  const mapped = deviceById(session.deviceId);
  return sessionTitle(session) + " · " + sessionLocator(mapped, session);
}

function dropSessions(deviceId, wo) {
  const doomed = liveSessions(deviceId);
  if (!doomed.length) return "none";
  const labels = doomed.map(sessionLabel);
  state.sessions = state.sessions.filter((session) => session.deviceId !== deviceId);
  if (doomed.some((session) => session.id === state.focusSession)) state.focusSession = "";
  doomed.forEach((session) => {
    const mapped = deviceById(session.deviceId);
    userAudit("session close", {
      asset: mapped ? mapped.name : deviceId,
      detail: sessionLabel(session) + " dropped because the outlet changed",
      wo,
    });
  });
  return labels.join("; ");
}

function powerDetail(before, after, extra) {
  return "power before " + before + ", after " + after + (extra ? ". " + extra : "");
}

function deviceSentence(device) {
  if (!device) return "No bound device. BMC none.";
  return "Device " + device.name + ". BMC " + bmcText(device) + ".";
}

function pulse(outlet) {
  outlet.power = "cycling";
  setTimeout(() => {
    if (outlet.power === "cycling") {
      outlet.power = "on";
      if (state.user) render();
    }
  }, 800);
}

function holdBusy() {
  return state.outletGate && state.outletGate.phase === "undo";
}

export function actOutlet(n, op, source) {
  const outlet = outletByN(n);
  if (!outlet) return;
  const reason = outletReason(outlet);
  if (reason) {
    state.toast = reason;
    render();
    return;
  }
  if (op === "on") {
    const before = outlet.power;
    const mapped = outlet.deviceId ? deviceById(outlet.deviceId) : null;
    outlet.power = "on";
    userAudit("outlet on", {
      asset: assetName(outlet),
      outlet: "Outlet " + n,
      detail: powerDetail(before, "on", deviceSentence(mapped)),
    });
    state.toast = "On Outlet " + n + " · " + assetName(outlet);
    state.view = "control";
    render();
    return;
  }
  if (holdBusy()) {
    state.toast = "An outlet change is waiting to commit. Undo it or let it finish.";
    render();
    return;
  }
  state.outletGate = {
    phase: "confirm",
    n: Number(n),
    op: op === "off" ? "off" : "cycle",
    source: source || "",
    before: outlet.power,
    until: 0,
    error: "",
    wo: state.wo || "",
    typed: "",
  };
  state.view = "control";
  state.toast = "";
  render();
}

export function cancelOutlet() {
  if (!state.outletGate || state.outletGate.phase !== "confirm") return;
  state.outletGate = null;
  render();
}

export function submitOutletConfirm() {
  const gate = state.outletGate;
  if (!gate || gate.phase !== "confirm") return;
  const woEl = document.getElementById("outlet-wo");
  const shortEl = document.getElementById("outlet-short");
  const wo = (woEl ? woEl.value : gate.wo).trim();
  const typed = (shortEl ? shortEl.value : gate.typed).trim();
  const outlet = outletByN(gate.n);
  const mapped = outlet && outlet.deviceId ? deviceById(outlet.deviceId) : null;
  if (!maintenanceOpen() && !wo) {
    gate.error = "A work order number is required outside a maintenance window.";
    gate.wo = wo;
    gate.typed = typed;
    render();
    return;
  }
  if (mapped && mapped.kind === "GPU tray" && typed !== mapped.short) {
    gate.error = "Type the device short name " + mapped.short + " to confirm.";
    gate.wo = wo;
    gate.typed = typed;
    render();
    return;
  }
  const reason = outlet ? outletReason(outlet) : "That outlet is not on this PDU.";
  if (!outlet || reason) {
    gate.error = reason || "That outlet is not on this PDU.";
    render();
    return;
  }
  state.wo = wo || state.wo;
  gate.wo = wo || currentWo();
  gate.typed = typed;
  gate.error = "";
  gate.phase = "undo";
  gate.until = Date.now() + HOLD_MS;
  state.toast = "";
  render();
}

export function undoOutlet() {
  const gate = state.outletGate;
  if (!gate || gate.phase !== "undo") return;
  const outlet = gate.op === "all" ? null : outletByN(gate.n);
  const asset = gate.op === "all" ? "Rack PDU A14" : assetName(outlet);
  const where = gate.op === "all" ? "All outlets" : "Outlet " + gate.n;
  userAudit("outlet undo", {
    asset,
    outlet: where,
    detail: powerDetail(gate.before || "unchanged", gate.before || "unchanged", "Undo before commit."),
    wo: gate.wo,
  });
  state.outletGate = null;
  state.toast = "Outlet change undone. Power was not changed.";
  render();
}

function commitOne(outlet, op, source, wo) {
  const before = outlet.power;
  const mapped = outlet.deviceId ? deviceById(outlet.deviceId) : null;
  const dropped = op === "on" ? "none" : dropSessions(outlet.deviceId, wo);
  const after = op === "off" ? "off" : "on";
  if (op === "cycle" || op === "all") pulse(outlet);
  else outlet.power = after;
  const extra = [
    op === "cycle" || op === "all" ? "Cycled." : "",
    deviceSentence(mapped),
    "Sessions dropped: " + dropped + ".",
    source ? "Suggested by " + source + " leak policy." : "",
  ].filter(Boolean).join(" ");
  userAudit("outlet " + (op === "all" ? "cycle" : op), {
    asset: assetName(outlet),
    outlet: "Outlet " + outlet.n,
    detail: powerDetail(before, after, extra),
    wo,
  });
}

function commitHold(gate) {
  state.outletGate = null;
  if (gate.op === "all") {
    const name = state.maintenance ? state.maintenance.name : "";
    outlets.forEach((outlet) => {
      commitOne(outlet, "all", "", gate.wo);
      const last = state.audit[0];
      if (last && last.outlet === "Outlet " + outlet.n) {
        last.detail += " Whole-PDU cycle under maintenance window " + name + ".";
      }
    });
    state.toast = "Cycling every outlet under the maintenance window.";
    render();
    return;
  }
  const outlet = outletByN(gate.n);
  if (!outlet) return;
  const reason = outletReason(outlet);
  if (reason) {
    userAudit("outlet " + gate.op + " refused", {
      asset: assetName(outlet),
      outlet: "Outlet " + gate.n,
      detail: powerDetail(outlet.power, outlet.power, reason),
      wo: gate.wo,
    });
    state.toast = reason;
    render();
    return;
  }
  commitOne(outlet, gate.op, gate.source, gate.wo);
  const verb = gate.op === "off" ? "Off" : "Cycle";
  state.toast = verb + " Outlet " + gate.n + " · " + assetName(outlet);
  state.view = "control";
  render();
}

export function settleOutletHold() {
  const gate = state.outletGate;
  if (!gate || gate.phase !== "undo" || !state.user) return;
  const left = Math.ceil((gate.until - Date.now()) / 1000);
  if (left <= 0) {
    commitHold(gate);
    return;
  }
  const node = document.querySelector("[data-undo-left]");
  if (node) node.textContent = String(left);
}

export function finishOutletHold() {
  const gate = state.outletGate;
  if (!gate || gate.phase !== "undo") return;
  gate.until = Date.now() - 1;
  settleOutletHold();
}

export function actAll() {
  const reason = allOutletsReason();
  if (reason) {
    state.toast = reason;
    render();
    return;
  }
  const name = state.maintenance.name;
  if (!window.confirm("Cycle every outlet on rack PDU A14, including unbound outlets? Window: " + name)) return;
  if (holdBusy()) {
    state.toast = "An outlet change is waiting to commit. Undo it or let it finish.";
    render();
    return;
  }
  state.outletGate = {
    phase: "undo",
    n: 0,
    op: "all",
    source: "",
    before: "unchanged",
    until: Date.now() + HOLD_MS,
    error: "",
    wo: currentWo(),
    typed: "",
  };
  state.toast = "";
  render();
}

function undoCopy(gate) {
  const left = Math.max(1, Math.ceil((gate.until - Date.now()) / 1000));
  if (gate.op === "all") {
    return "Cycle all outlets. Undo within <b data-undo-left>" + left + "</b> seconds. Power is still unchanged.";
  }
  const outlet = outletByN(gate.n);
  const verb = gate.op === "off" ? "Off" : "Cycle";
  return verb + " Outlet " + gate.n + " · " + esc(assetName(outlet)) + ". Undo within <b data-undo-left>" + left +
    "</b> seconds. Power is still " + esc(gate.before) + ".";
}

export function outletHoldHtml() {
  const gate = state.outletGate;
  if (!gate) return "";
  if (gate.phase === "undo") {
    return '<div class="toast"><span>' + undoCopy(gate) +
      '</span><button type="button" data-act="outlet-undo">Undo</button></div>';
  }
  const outlet = outletByN(gate.n);
  if (!outlet) return "";
  const mapped = outlet.deviceId ? deviceById(outlet.deviceId) : null;
  const sessions = liveSessions(outlet.deviceId);
  const sessionHtml = sessions.length
    ? "<ul>" + sessions.map((session) => "<li>" + esc(sessionLabel(session)) + "</li>").join("") + "</ul>"
    : "<p>No live sessions.</p>";
  const title = (gate.op === "off" ? "Turn off" : "Cycle") + " Outlet " + gate.n;
  const needsWo = !maintenanceOpen();
  const needsShort = mapped && mapped.kind === "GPU tray";
  return '<div class="confirm-back"><section class="confirm-card" role="dialog" aria-modal="true" aria-labelledby="outlet-confirm-title">' +
    '<h2 id="outlet-confirm-title">' + esc(title) + "</h2>" +
    "<p><strong>Bound device.</strong> " + esc(mapped ? mapped.name : "None. This outlet is unbound.") + "</p>" +
    "<p><strong>BMC.</strong> " + esc(mapped ? bmcText(mapped) : "none") + "</p>" +
    "<p><strong>Live sessions that will drop.</strong></p>" + sessionHtml +
    (needsWo
      ? '<label>Work order number<input id="outlet-wo" autocomplete="off" spellcheck="false" aria-label="Work order number"></label>'
      : "<p class=\"fine\">Maintenance window " + esc(state.maintenance.name) + " is open. A separate work order number is not required.</p>") +
    (needsShort
      ? '<label>Type ' + esc(mapped.short) + ' to confirm<input id="outlet-short" autocomplete="off" spellcheck="false" aria-label="Device short name"></label>'
      : "") +
    (gate.error ? '<p class="reason" role="alert">' + esc(gate.error) + "</p>" : "") +
    '<div class="confirm-actions"><button type="button" class="act" data-act="outlet-cancel">Cancel</button>' +
    '<button type="button" class="act primary" data-act="outlet-confirm">Confirm</button></div></section></div>';
}
