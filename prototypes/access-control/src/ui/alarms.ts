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
import { floorAlarmRackId, floorSerial, openFloorServer, openPart } from "../views/floor";
import { launchAlarmSerial } from "../domain/autofix";
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
  if (d.bootStuck) {
    return { login: "ok", pri: 1, text: "Automatic login on " + d.tty + " read: stopped at the UEFI shell after a reboot. No operating system loaded.", act: "alarm-serial", response: "Open serial" };
  }
  if (state.leak && (d.id === "tray-01" || d.id === "tray-02")) {
    return { login: "ok", pri: 1, text: "Automatic login on " + d.tty + " read: DI-1 leak rope asserted.", go: "control", response: "Open control" };
  }
  if (d.rdp === "down") {
    return { login: "ok", pri: 2, text: "Automatic login on " + d.tty + " read: in-band RDP is down. Failover is MPU2 KVM.", act: "rdp-failover", response: "MPU2 KVM" };
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
  trackAlarmClocks(list);
  return list.sort((a, b) => a.pri - b.pri || a.asset.localeCompare(b.asset));
}

/* Minutes an alarm may stay unacknowledged before it escalates, by priority. */
export const ACK_TARGET_MIN = { 1: 5, 2: 15, 3: 60 };

function clockKey(alarm) {
  return alarm.id + "@" + alarm.pri;
}

/* Start a clock when an alarm first appears; drop clocks for alarms that cleared. */
/* Alarms that cleared this session, newest first, for the Ask shift handover. */
export const clearedAlarms: { id: string; pri: number; asset: string; text: string; since: number; at: number }[] = [];
const lastSeen: Record<string, { id: string; pri: number; asset: string; text: string }> = {};

export function trackAlarmClocks(list) {
  const now = Date.now();
  const live = {};
  list.forEach((alarm) => {
    const key = clockKey(alarm);
    live[key] = true;
    lastSeen[key] = { id: alarm.id, pri: alarm.pri, asset: alarm.asset, text: alarm.text };
    if (!state.alarmSince[key]) state.alarmSince[key] = now;
  });
  Object.keys(state.alarmSince).forEach((key) => {
    if (live[key]) return;
    const seen = lastSeen[key];
    if (seen) clearedAlarms.unshift({ ...seen, since: state.alarmSince[key], at: now });
    if (clearedAlarms.length > 200) clearedAlarms.length = 200;
    delete lastSeen[key];
    delete state.alarmSince[key];
  });
}

export function span(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  return Math.floor(m / 60) + "h " + String(m % 60).padStart(2, "0") + "m";
}

export function alarmClock(alarm, now = Date.now()) {
  const since = state.alarmSince[clockKey(alarm)] || now;
  const target = (ACK_TARGET_MIN[alarm.pri] || 60) * 60000;
  const open = now - since;
  const acked = !!state.acked[alarm.id];
  const escalated = !acked && open >= target;
  const text = acked
    ? "Acked · open " + span(open)
    : escalated
      ? "Escalated · " + span(open - target) + " past " + ACK_TARGET_MIN[alarm.pri] + "m"
      : "Open " + span(open) + " · escalates in " + span(target - open);
  return { open, escalated, acked, text, due: since + target };
}

/* Fill the open and escalation clocks after each paint and between renders. The banner
   HTML itself stays the same while the alarms do, so an open alarm list is not rebuilt. */
export function updateAlarmClocks() {
  const els = document.querySelectorAll("[data-alarm-clock]");
  if (!els.length) return;
  const byId = {};
  const alarms = activeAlarms();
  alarms.forEach((alarm) => { byId[alarm.id] = alarm; });
  const count = document.querySelector("[data-alarm-count]");
  if (count && alarms.length) count.textContent = chipText(alarms);
  els.forEach((el) => {
    const alarm = byId[el.getAttribute("data-alarm-clock")];
    if (!alarm) return;
    const clock = alarmClock(alarm);
    if (el.textContent !== clock.text) el.textContent = clock.text;
    el.classList.toggle("is-escalated", clock.escalated);
    el.closest(".alarm-row")?.classList.toggle("escalated", clock.escalated);
  });
}

function chipText(alarms) {
  const late = alarms.filter((alarm) => alarmClock(alarm).escalated).length;
  return "P" + alarms[0].pri + " · " + alarms.length + (late ? " · " + late + " escalated" : "");
}

export function alarmBanner() {
  const alarms = activeAlarms();
  if (!alarms.length) return "";
  const top = alarms[0];
  const rows = alarms.map((alarm) => {
    const unacked = !state.acked[alarm.id];
    const clock = alarmClock(alarm);
    const go = alarm.response
      ? '<button type="button" class="act primary" data-act="alarm-go" data-alarm="' + alarm.id +
        '" aria-label="' + esc(alarm.response) + " · " + esc(alarm.asset) + '">' + esc(alarm.response) + "</button>"
      : "";
    return '<div class="alarm-row pri-' + alarm.pri + (unacked ? " unacked" : "") + '" role="listitem">' +
      '<details class="alarm-fold"><summary data-act="alarm-focus" data-alarm="' + alarm.id + '">' +
      '<span class="pri-mark pri-' + alarm.pri + '" aria-hidden="true">' + alarm.pri + '</span>' +
      '<span class="sr-only">Priority ' + alarm.pri + ". </span><b>" + esc(alarm.asset) + '</b>' +
      '<span class="alarm-line">' + esc(alarm.text) + '</span><span class="alarm-clock" data-alarm-clock="' + alarm.id + '"></span></summary><div class="alarm-extra">' +
      '<button type="button" class="act" data-act="alarm-ack" data-alarm="' + alarm.id + '"' +
      (unacked ? "" : " disabled") + ">Ack</button>" +
      '<span class="fine alarm-target">P' + alarm.pri + " ack target " + ACK_TARGET_MIN[alarm.pri] + " min" +
      (unacked ? ", due " + fmt(clock.due) : "") + ".</span>" +
      (floorAlarmRackId(alarm)
        ? '<button type="button" class="act" data-act="alarm-floor" data-alarm="' + alarm.id +
          '" aria-label="Show on floor · ' + esc(alarm.asset) + '">Show on floor</button>'
        : "") +
      '<details class="explain-fold"><summary>Explain</summary>' +
      explainHtml(alarmInput(alarm)) + "</details></div></details>" + go + "</div>";
  }).join("");
  return '<details class="alarm-banner"><summary class="alarm-chip"><span class="sr-only">Abnormal conditions: </span><span class="pri-mark pri-' +
    top.pri + '" aria-hidden="true">' + top.pri + "</span><span data-alarm-count>P" + top.pri + " · " + alarms.length +
    "</span></summary><div class=\"alarm-list\" role=\"list\">" + rows + "</div></details>";
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
  else if (alarm.act === "alarm-serial") launchAlarmSerial(alarm.device);
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
