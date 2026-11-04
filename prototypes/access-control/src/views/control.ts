import { deviceById, devices } from "../data/devices";
import { LEAK, outlets } from "../data/outlets";
import { maintenanceOpen } from "../domain/audit";
import { leakCard } from "../domain/leak";
import { allOutletsReason, outletReason } from "../domain/outlet-policy";
import { state } from "../state";
import { esc } from "../ui/format";
import { pills } from "../ui/shell";

export function controlStatus() {
  if (state.user.role === "ReadOnly") {
    return { tone: "bad", text: "ReadOnly cannot cycle outlets." };
  }
  const failed = devices.filter((d) => d.bmc === "down").map((d) => d.name);
  if (maintenanceOpen()) {
    return {
      tone: "warn",
      text: "Maintenance window " + state.maintenance.name + " is open. Unbound outlets and whole-PDU control are available. Every act is audited.",
    };
  }
  if (state.rm1048 === "healthy" && failed.length) {
    return {
      tone: "hold",
      text: "BMC failover is on ACS for " + failed.join(", ") + ". Those bound outlets can be cycled from ACS. Devices whose BMC is up still yield Control to RM1048.",
    };
  }
  if (state.rm1048 === "healthy") {
    return {
      tone: "hold",
      text: "RM1048 owns Control while that plane is healthy and the BMC is up. ACS outlet actions are held. A named maintenance window lifts the hold. A dark BMC fails over to ACS.",
    };
  }
  return { tone: "ok", text: "RM1048 plane is dark. ACS can cycle outlets that are bound to a mapped asset." };
}

export function outletActions(o) {
  const reason = outletReason(o);
  const dis = reason ? " disabled" : "";
  const title = reason ? ' title="' + esc(reason) + '"' : "";
  return '<div class="row-actions">' +
    '<button type="button" class="act" data-act="outlet" data-outlet="' + o.n + '" data-op="on"' + dis + title + ">On</button>" +
    '<button type="button" class="act" data-act="outlet" data-outlet="' + o.n + '" data-op="off"' + dis + title + ">Off</button>" +
    '<button type="button" class="act primary" data-act="outlet" data-outlet="' + o.n + '" data-op="cycle"' + dis + title + ">Cycle</button>" +
    "</div>";
}

export function renderControl() {
  const status = controlStatus();
  const rows = outlets.map((o) => {
    const d = o.deviceId ? deviceById(o.deviceId) : null;
    const suggested = state.leak && LEAK.outlets.indexOf(o.n) !== -1;
    const highlight = state.highlightOutlet === o.n ? " highlight" : "";
    const unbound = !o.deviceId && state.user.role !== "ReadOnly"
      ? (maintenanceOpen()
        ? "Maintenance window is open. This unbound outlet can be cycled."
        : "Unbound outlet. Control stays disabled until a maintenance window is open.")
      : "";
    const failover = d && d.bmc === "down";
    const held = d && !failover && state.rm1048 === "healthy" && !maintenanceOpen() && state.user.role !== "ReadOnly";
    return '<tr class="' + (suggested ? "suggested" : "") + highlight + '"><td>Outlet ' + o.n +
      (suggested ? ' <span class="badge bad">Suggested</span>' : "") +
      (failover ? ' <span class="badge warn">ACS</span>' : "") + "</td><td>" +
      (d ? esc(d.name) + (failover ? '<div class="fine">Out-of-band failover. Bound outlet is on ACS.</div>' : "") +
        (held ? '<div class="fine">BMC is up. RM1048 owns this outlet.</div>' : "") : "Unbound") +
      (unbound ? '<div class="reason">' + esc(unbound) + "</div>" : "") +
      "</td><td>" + powerBadge(o.power) + "</td><td>" + outletActions(o) + "</td></tr>";
  }).join("");
  const allReason = allOutletsReason();
  const allDis = allReason ? " disabled" : "";
  const allTitle = allReason ? ' title="' + esc(allReason) + '"' : "";
  const allCopy = allReason
    ? allReason
    : "Maintenance window is open. This cycles every outlet on the rack PDU, including unbound.";
  const placeholder = state.maintenance ? state.maintenance.wo : "";
  return '<div class="page-head"><div class="top"><div><h1>Outlet control</h1>' +
    '<p class="sub">ACS cycles outlets that are bound to a mapped asset. The rack PDU is simulated gear.</p></div></div>' +
    pills() + "</div>" + leakCard() +
    '<div class="status ' + status.tone + '" role="status"><p>' + esc(status.text) + "</p></div>" +
    '<section class="panel"><h2>Rack PDU A14</h2><div class="table-wrap"><table><thead><tr><th>Outlet</th><th>Binding</th><th>Power</th><th>Actions</th></tr></thead><tbody>' +
    rows + '</tbody></table></div><div class="all-out"><div><strong>All outlets</strong><p class="fine">' +
    esc(allCopy) + '</p></div><button type="button" class="act danger" data-act="all-outlets"' + allDis + allTitle +
    '>Cycle all outlets</button></div></section>' +
    '<label class="field">Work order<input id="wo-field" data-focus-key="wo-field" placeholder="' +
    esc(placeholder) + '"></label>' +
    '<p class="fine">Outside a maintenance window, Cycle and Off ask for a work order number before the 10 second undo. A GPU tray also asks for its short name. On commits immediately.</p>';
}

export function powerBadge(power) {
  const cls = power === "off" ? "bad" : power === "cycling" ? "warn" : "ok";
  const label = power === "cycling" ? "Cycling" : power === "off" ? "Off" : "On";
  return '<span class="badge ' + cls + '">' + label + "</span>";
}
