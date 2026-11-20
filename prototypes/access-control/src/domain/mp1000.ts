import { devices } from "../data/devices";
import { state } from "../state";
import { esc } from "../ui/format";
import { userAudit } from "./audit";
import { mp1000Launches, openSession } from "./sessions";

/* The MP1000 management platform sits above every RM1048 rack manager. It keeps
   one list of the servers behind them and brokers KVM sessions: the operator
   picks a device, MP1000 checks the role, and the session runs through that
   rack's RM1048 to the server's BMC graphical console. */

export function mp1000Targets() {
  return devices.filter((d) => d.rack === "A14" && d.redfishId && d.kind !== "Power shelf");
}

export function mp1000Status(d) {
  if (d.bmc === "down") return { ok: false, text: "BMC dark. Use MPU2 KVM." };
  if (state.rm1048 !== "healthy") return { ok: false, text: "RM1048 plane dark. Use MPU2 KVM." };
  return { ok: true, text: "Ready" };
}

export function launchMp1000Kvm(deviceId) {
  const d = devices.find((item) => item.id === deviceId);
  if (!d) return;
  userAudit("MP1000 KVM request", {
    asset: d.name,
    detail: "MP1000 → RM1048 A14 → BMC graphical console",
    wo: "",
  });
  mp1000Launches.add(deviceId + ":rm1048:kvm");
  openSession(deviceId, "rm1048", "kvm", "");
}

export function mp1000Panel() {
  const rows = mp1000Targets().map((d) => {
    const status = mp1000Status(d);
    const button = '<button type="button" class="act' + (status.ok ? " primary" : "") + '" data-act="mp1000-kvm" data-device="' +
      esc(d.id) + '"' + (status.ok ? "" : ' disabled title="' + esc(status.text) + '"') + ">Launch KVM</button>";
    return '<tr data-device="' + esc(d.id) + '"><td>' + esc(d.name) + '</td><td class="mono">' + esc(d.host) +
      "</td><td>RM1048 · A14</td><td" + (status.ok ? "" : ' class="reason"') + ">" + esc(status.text) + "</td><td>" + button + "</td></tr>";
  }).join("");
  return '<section class="panel mp1000-panel"><h2>MP1000 devices</h2>' +
    '<p class="fine">The MP1000 management platform lists every server behind every RM1048 rack manager. Launch KVM opens an HTML5 session through the rack\'s RM1048 to the server\'s BMC. If the BMC is dark, the out-of-band path is MPU2 KVM.</p>' +
    '<div class="table-wrap"><table><thead><tr><th>Device</th><th>Host</th><th>Rack manager</th><th>KVM</th><th></th></tr></thead><tbody>' +
    rows + "</tbody></table></div></section>";
}
