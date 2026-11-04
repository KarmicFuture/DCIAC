import type { Alarm } from "../types";
import { deviceById } from "../data/devices";
import { LEAK } from "../data/outlets";
import { fmt } from "../domain/audit";
import { explain, gateAction } from "../domain/analyzer";
import type { ExplainInput, ExplainLine } from "../domain/analyzer";
import { acsWaiting } from "../domain/failover";
import { consoleKind } from "../domain/sessions";
import { sessionBlocked } from "../domain/single-master";
import { state } from "../state";
import { esc } from "./format";

const seenAt: Record<string, number> = {};

function stamp(id) {
  if (!seenAt[id]) seenAt[id] = Date.now();
  return seenAt[id];
}

function linesFor(id, asset, tty, text): ExplainLine[] {
  const needles = [asset, tty].filter(Boolean);
  const matched = state.audit.filter((row) => {
    const blob = (row.asset || "") + " " + (row.detail || "");
    return needles.some((needle) => blob.indexOf(needle) !== -1);
  }).slice(0, 6);
  const lines = matched.map((row) => ({ at: row.t, text: row.detail || row.action }));
  if (text && !lines.some((line) => line.text.indexOf(text) !== -1)) {
    lines.unshift({ at: stamp(id), text });
  }
  if (!lines.length) lines.push({ at: stamp(id), text: text || asset });
  return lines;
}

export function alarmSignal(alarm: Alarm) {
  if (alarm.id.indexOf("feed-") === 0) return "feed-open";
  if (alarm.id.indexOf("inlet-") === 0) return "inlet";
  if (alarm.id.indexOf("recirc-") === 0) return "recirc";
  if (alarm.id.indexOf("cap-") === 0) return "outside-critical";
  const text = alarm.text || "";
  if (text.indexOf("leak") !== -1) return "leak";
  if (text.indexOf("still coming up") !== -1) return "bmc-wait";
  if (text.indexOf("BMC path dark") !== -1) return "bmc-down";
  if (text.indexOf("denied") !== -1 || text.indexOf("rejected") !== -1) return "watch-deny";
  if (text.indexOf("RDP") !== -1) return "rdp-down";
  if (text.indexOf("critical") !== -1) return "thermal-critical";
  if (text.indexOf("nearing capacity") !== -1) return "thermal-near";
  if (text.indexOf("RM1048 plane is dark") !== -1) return "plane-dark";
  return "other";
}

export function alarmInput(alarm: Alarm): ExplainInput {
  const device = alarm.device ? deviceById(alarm.device) : null;
  let outlet = device && device.outlet ? device.outlet : 0;
  if (alarm.id.indexOf("feed-") === 0) outlet = Number(alarm.id.slice(5)) || outlet;
  if (state.leak && device && LEAK.outlets.indexOf(device.outlet) !== -1) outlet = device.outlet;
  return {
    kind: "alarm",
    id: alarm.id,
    signal: alarmSignal(alarm),
    asset: alarm.asset,
    deviceId: device ? device.id : (alarm.device || ""),
    outlet,
    tty: device ? device.tty : "",
    text: alarm.text,
    lines: linesFor(alarm.id, alarm.asset, device ? device.tty : "", alarm.text),
  };
}

export function serialInput(session): ExplainInput {
  const device = deviceById(session.deviceId);
  const kind = device ? consoleKind(device) : "linux";
  let signal = "linux";
  if (sessionBlocked(session)) signal = "blocked";
  else if (acsWaiting(session)) signal = "waiting";
  else if (device && device.watch && device.watch.login === "reject") signal = "deny";
  else if (kind === "uefi") signal = "uefi";
  else if (kind === "ios") signal = "ios";
  else if (device && device.bmc === "down") signal = "bmc-down";
  const opened = session.openedAt || stamp("session-" + session.id);
  const lines = (session.lines || []).filter((line) => String(line || "").trim()).map((text, index) => ({
    at: opened + index * 1000,
    text,
  }));
  if (!lines.length) {
    lines.push({
      at: opened,
      text: signal === "waiting"
        ? "BMC path lost. Out-of-band serial is coming up on ACS " + (device ? device.tty : "") + "."
        : (device ? device.name + " serial session" : "Serial session"),
    });
  }
  return {
    kind: "serial",
    id: session.id,
    signal,
    asset: device ? device.name : session.deviceId,
    deviceId: session.deviceId,
    outlet: device && device.outlet ? device.outlet : 0,
    tty: device ? device.tty : "",
    text: lines.map((line) => line.text).join("\n"),
    lines,
  };
}

export function explainHtml(input: ExplainInput) {
  const result = explain(input);
  const gate = gateAction(input, result);
  const rows = result.evidence.map((line) => '<li class="' + (line.hit ? "hit" : "") + '"><time>' +
    esc(fmt(line.at)) + "</time> " + esc(line.text) + "</li>").join("");
  const dis = gate.enabled ? "" : " disabled";
  const title = gate.reason ? ' title="' + esc(gate.reason) + '"' : "";
  const why = !gate.enabled && gate.reason ? '<p class="reason">' + esc(gate.reason) + "</p>" : "";
  return '<section class="explain" data-explain="' + esc(input.kind) + ":" + esc(input.id) + '">' +
    '<p class="explain-title">Explain</p>' +
    '<p><span class="explain-label">What happened</span> ' + esc(result.happened) + "</p>" +
    '<div class="explain-evidence"><span class="explain-label">Evidence</span><ol>' + rows + "</ol></div>" +
    '<p class="explain-cause"><span class="explain-label">Likely cause</span> ' + esc(result.cause) +
    " <b>" + result.confidence + "%</b></p>" +
    '<div class="explain-act"><button type="button" class="act primary" data-act="explain-run" data-explain-kind="' +
    esc(input.kind) + '" data-explain-id="' + esc(input.id) + '"' + dis + title + ">" + esc(gate.label) +
    "</button></div>" + why + "</section>";
}
