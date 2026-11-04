import type { Alarm } from "../types";
import { deviceById, devices } from "../data/devices";
import { outlets } from "../data/outlets";
import { heatBand, neighbors } from "../data/pods";
import { audit, fmt } from "../domain/audit";
import { waiting } from "../domain/failover";
import { failRdpToKvm } from "../domain/sessions";
import { state } from "../state";
import { alarmInput, explainHtml } from "./explain";
import { esc } from "./format";
import { render } from "./schedule";
import { go } from "./shell";
import { floorSerial, openFloorServer, openPart } from "../views/floor";
import { login } from "../views/login";
import { thermalReading } from "../views/rack";

export function serialFinding(d) {
  if (d.watchDeny) {
    return { login: "reject", pri: 1, text: "Automatic login rejected on " + d.tty + ". acs.watch was denied a shell.", act: "floor-serial", response: "Open serial" };
  }
  if (d.bmc === "down" && waiting(d)) {
    return { login: "wait", pri: 1, text: "Automatic login held on " + d.tty + ". ACS serial is still coming up.", act: "floor-serial", response: "Open serial" };
  }
  if (d.bmc === "down") {
    return { login: "ok", pri: 1, text: "Automatic login on " + d.tty + " read: BMC path dark. Failover is ACS serial.", act: "floor-serial", response: "Open serial" };
  }
  if (state.leak && (d.id === "tray-01" || d.id === "tray-02")) {
    return { login: "ok", pri: 1, text: "Automatic login on " + d.tty + " read: DI-1 leak rope asserted.", go: "control", response: "Open control" };
  }
  if (d.rdp === "down") {
    return { login: "ok", pri: 2, text: "Automatic login on " + d.tty + " read: in-band RDP is down. Failover is ACS KVM.", act: "rdp-failover", response: "ACS KVM" };
  }
  if (heatBand(d) === "critical") {
    return { login: "ok", pri: 2, text: "Automatic login on " + d.tty + " read: thermal load critical.", act: "floor-server", response: "Open server" };
  }
  if (heatBand(d) === "near") {
    return { login: "ok", pri: 3, text: "Automatic login on " + d.tty + " read: load nearing capacity.", act: "floor-server", response: "Open server" };
  }
  if (state.rm1048 !== "healthy") {
    return { login: "ok", pri: 2, text: "Automatic login on " + d.tty + " read: RM1048 plane is dark. This ACS port is the path.", go: "rack", response: "Open rack" };
  }
  return { login: "ok", pri: 0, text: "Automatic login on " + d.tty + " read: nominal.", response: "" };
}

export function refreshSerialWatch() {
  const now = Date.now();
  devices.forEach((d) => {
    const finding = serialFinding(d);
    const prev = d.watch;
    if (prev && prev.login === finding.login && prev.pri === finding.pri && prev.text === finding.text) return;
    d.watch = {
      at: now,
      login: finding.login,
      pri: finding.pri,
      text: finding.text,
      act: finding.act || "",
      go: finding.go || "",
      response: finding.response || "",
    };
    if (!prev || prev.pri !== finding.pri) delete state.acked["watch-" + d.id];
    audit({
      user: "acs.watch",
      role: "automatic",
      action: finding.login === "ok" ? "serial auto-login" : finding.login === "wait" ? "serial auto-login held" : "serial auto-login rejected",
      asset: d.name,
      detail: d.tty + " · " + finding.text,
    });
  });
}

export function plantAlarms(): Alarm[] {
  const list = [];
  outlets.forEach((outlet) => {
    if (!outlet.deviceId || outlet.power !== "off") return;
    const mapped = deviceById(outlet.deviceId);
    if (!mapped) return;
    const shelf = outlet.deviceId === "pshelf";
    list.push({
      id: "feed-" + outlet.n,
      pri: shelf ? 1 : 2,
      asset: mapped.name,
      text: shelf
        ? "Outlet " + outlet.n + " is open. The 50 V shelf is de-energized, so the row behind it is dark."
        : "Outlet " + outlet.n + " is open. The DC whip to " + mapped.name + " is de-energized.",
      go: "control",
      device: mapped.id,
      response: "Open control",
    });
  });
  devices.forEach((mapped) => {
    if (!mapped.u || !mapped.load || mapped.serialOnly) return;
    const heat = thermalReading(mapped);
    if (heat.pri) {
      list.push({
        id: "inlet-" + mapped.id,
        pri: heat.pri,
        asset: mapped.name,
        text: "Rack inlet " + heat.inlet.toFixed(1) + " °C. " + heat.envelope + ".",
        act: "floor-part",
        device: mapped.id,
        part: "inlet",
        response: "Open inlet",
      });
    }
    if (heat.recirculation) {
      list.push({
        id: "recirc-" + mapped.id,
        pri: 3,
        asset: mapped.name,
        text: "Cold-aisle containment. Supply is recirculating at the top of the rack.",
        act: "floor-part",
        device: mapped.id,
        part: "inlet",
        response: "Open inlet",
      });
    }
  });
  neighbors.forEach((entity) => {
    if (heatBand(entity) !== "critical") return;
    list.push({
      id: "cap-" + entity.id,
      pri: 2,
      asset: entity.name,
      text: "Simulated load is critical. This rack is outside ACS-A14.",
      act: "floor-server",
      device: entity.id,
      response: "Open server",
    });
  });
  return list;
}

export function activeAlarms(): Alarm[] {
  const list = [];
  devices.forEach((d) => {
    const watch = d.watch;
    if (!watch || !watch.pri) return;
    list.push({
      id: "watch-" + d.id,
      pri: watch.pri,
      asset: d.name,
      text: watch.text,
      act: watch.act,
      go: watch.go,
      device: d.id,
      response: watch.response,
    });
  });
  plantAlarms().forEach((alarm) => list.push(alarm));
  return list.sort((a, b) => a.pri - b.pri || a.asset.localeCompare(b.asset));
}

export function alarmBanner() {
  const alarms = activeAlarms();
  if (!alarms.length) {
    return '<div class="alarm-banner quiet"><span class="pri-mark pri-0" aria-hidden="true">—</span><p>No abnormal conditions. The last automatic serial login on every ACS port read nominal.</p></div>';
  }
  const shown = alarms.slice(0, 3).map((alarm) => {
    const unacked = !state.acked[alarm.id];
    return '<div class="alarm-stack"><div class="alarm-row pri-' + alarm.pri + (unacked ? " unacked" : "") + '"><span class="pri-mark pri-' + alarm.pri +
      '" aria-hidden="true">' + alarm.pri + '</span><p><b>' + esc(alarm.asset) + "</b> " + esc(alarm.text) +
      (unacked ? " Unacknowledged." : " Acknowledged.") + '</p><button type="button" class="act" data-act="alarm-ack" data-alarm="' +
      alarm.id + '"' + (unacked ? "" : " disabled") + '>Ack</button><button type="button" class="act primary" data-act="alarm-go" data-alarm="' +
      alarm.id + '">' + esc(alarm.response) + "</button></div>" + explainHtml(alarmInput(alarm)) + "</div>";
  }).join("");
  const more = alarms.length > 3 ? '<p class="fine alarm-more">' + (alarms.length - 3) + " more on the overview.</p>" : "";
  return '<div class="alarm-banner" aria-label="Abnormal conditions">' + shown + more + "</div>";
}

export function ackAlarm(id) {
  state.acked[id] = true;
  render();
}

export function goAlarm(id) {
  const alarm = activeAlarms().find((item) => item.id === id);
  if (!alarm) return;
  state.acked[id] = true;
  if (alarm.go) go(alarm.go);
  else if (alarm.act === "floor-serial") floorSerial(alarm.device);
  else if (alarm.act === "rdp-failover") failRdpToKvm(alarm.device);
  else if (alarm.act === "floor-part") openPart(alarm.device, alarm.part);
  else if (alarm.act === "floor-server") openFloorServer(alarm.device);
}

export function watchResult(login) {
  if (login === "reject") return "Rejected";
  if (login === "wait") return "Held";
  return "Logged in";
}

export function watchTable() {
  const rows = devices.map((d) => {
    const watch = d.watch;
    if (!watch) return "";
    return "<tr><td class=\"mono\">" + fmt(watch.at) + "</td><td class=\"mono\">" + esc(d.tty) + "</td><td>" + esc(d.name) +
      '</td><td><span class="watch-result ' + esc(watch.login) + '">' + watchResult(watch.login) + "</span></td><td>" +
      (watch.pri ? "P" + watch.pri : "Clear") + "</td><td>" + esc(watch.text) + "</td></tr>";
  }).join("");
  return '<section class="panel watch-panel"><div class="panel-head"><h2>Serial watch</h2><p class="fine">Identity acs.watch. One automatic login per ACS port. The banner above is this table, kept to conditions that need a response.</p></div>' +
    '<p class="fine">Inlet temperature and an open outlet raise their own alarms. Those are determined from the reading, alongside this table.</p><div class="table-wrap"><table><thead><tr><th>Last login</th><th>Port</th><th>Device</th><th>Result</th><th>Alarm</th><th>What the console read</th></tr></thead><tbody>' +
    rows + "</tbody></table></div></section>";
}
