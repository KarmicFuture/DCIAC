/* Ask DCIAC panel: answers built from DCIAC's own state, proposals that wait for the
   user's confirm, and refusals that name the rule. See docs/nl-assistant-ux.md. */
import type { Alarm } from "../types";
import { deviceById, devices } from "../data/devices";
import { LEAK, outletByN } from "../data/outlets";
import { PLANT, PODS, entityById } from "../data/pods";
import { AskIntent, parseQuestion, rackPod, usingLocalParser } from "../domain/ask";
import { explain } from "../domain/analyzer";
import { userAudit } from "../domain/audit";
import { actOutlet, outletReason, showOutlet } from "../domain/outlet-policy";
import { onHashChange } from "../domain/route";
import { openSession } from "../domain/sessions";
import { state } from "../state";
import { fleetSummary, setFleetDrill } from "../views/fleet";
import { setRackPreset } from "../views/rack3d";
import { ACK_TARGET_MIN, activeAlarms, alarmClock, clearedAlarms, span } from "./alarms";
import { alarmInput, explainHtml } from "./explain";
import { esc } from "./format";
import { render } from "./schedule";

/* Bulk ack cap and the evidence age that counts as stale. */
export const ACK_CAP = 20;
export const STALE_MS = 5 * 60000;

interface Proposal {
  type: "ack" | "session";
  ids?: string[];
  device?: string;
  path?: string;
  status: "open" | "done" | "cancelled";
  result?: string;
}

interface Turn {
  n: number;
  q: string;
  kind: string;
  body: string;
  proposal?: Proposal;
}

const ask = { open: false, opener: "", seq: 0, turns: [] as Turn[], scroll: false };

export function askOpen() {
  return ask.open;
}

export function askTurns() {
  return ask.turns.map((turn) => ({ q: turn.q, kind: turn.kind, proposal: turn.proposal ? turn.proposal.status : "" }));
}

export function resetAsk() {
  ask.turns = [];
  ask.open = false;
}

function phone() {
  return typeof window !== "undefined" && window.matchMedia && window.matchMedia("(max-width: 767px)").matches;
}

/* Demos: open Ask and ask one question without moving keyboard focus. */
export function demoAsk(q: string) {
  ask.open = true;
  ask.turns = [];
  ask.opener = "ask-nav";
  sendAsk(q);
  state.focusField = "";
}

export function openAsk(opener?: string) {
  ask.open = true;
  ask.opener = opener || ask.opener || "ask-nav";
  state.menuOpen = false;
  state.focusField = "ask-input";
  render();
}

export function closeAsk() {
  if (!ask.open) return;
  ask.open = false;
  const back = document.getElementById(ask.opener) ? ask.opener : (document.getElementById("ask-tab") ? "ask-tab" : "content");
  state.focusField = back;
  render();
}

export function toggleAsk(opener: string) {
  if (ask.open) closeAsk();
  else openAsk(opener);
}

/* ---------- small builders ---------- */

function clock(at = Date.now()) {
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function source(text: string, at = Date.now()) {
  return '<p class="ask-src">From ' + esc(text) + " · read " + esc(clock(at)) + "</p>";
}

function link(label: string, route: string, extra = "") {
  return '<button type="button" class="ask-link" data-act="ask-link" data-route="' + esc(route) + '"' + extra + ">" + esc(label) + "</button>";
}

function lead(text: string) {
  return '<p class="ask-lead">' + text + "</p>";
}

function card(kind: string, body: string) {
  return '<div class="ask-card ask-' + kind + '">' + body + "</div>";
}

function refusal(title: string, why: string, extra = "") {
  return card("refusal", lead("<b>" + esc(title) + "</b>") + "<p>" + esc(why) + "</p>" + extra);
}

function hallName(podId: string) {
  const pod = PODS.find((p) => p.id === podId);
  return pod ? pod.name || pod.id : podId;
}

function managedHall() {
  const pod = PODS.find((p) => p.managed);
  return pod ? pod.id : "";
}

function alarmHall(alarm: Alarm) {
  const entity = alarm.device ? entityById(alarm.device) : null;
  return entity && entity.pod ? entity.pod : managedHall();
}

function alarmRack(alarm: Alarm) {
  const entity = alarm.device ? entityById(alarm.device) : null;
  if (entity && entity.rack) return entity.rack;
  return alarm.device && deviceById(alarm.device) ? "A14" : "";
}

function alarmRoute(alarm: Alarm) {
  if (alarm.device && deviceById(alarm.device)) return "#/rack/A14/" + encodeURIComponent(alarm.device);
  const entity = alarm.device ? entityById(alarm.device) : null;
  if (entity && entity.pod && entity.rack) {
    return "#/floor/" + encodeURIComponent(entity.pod) + "/" + encodeURIComponent(entity.rack) + "/" + encodeURIComponent(entity.id);
  }
  return "#/fleet";
}

function alarmFamily(alarm: Alarm) {
  if (alarm.id.indexOf("inlet-") === 0) return "inlet";
  if (alarm.id.indexOf("recirc-") === 0) return "recirc";
  if (alarm.id.indexOf("cap-") === 0) return "capacity";
  if (alarm.id.indexOf("feed-") === 0) return "feed";
  return "serial";
}

function matching(intent: AskIntent) {
  return activeAlarms().filter((alarm) => {
    if (intent.pri && alarm.pri !== intent.pri) return false;
    if (intent.hall && alarmHall(alarm) !== intent.hall) return false;
    if (intent.rack && alarmRack(alarm) !== intent.rack) return false;
    if (intent.device && alarm.device !== intent.device) return false;
    if (intent.signal && alarmFamily(alarm) !== intent.signal) return false;
    if (intent.escalated && !alarmClock(alarm).escalated) return false;
    return true;
  });
}

function scope(intent: AskIntent) {
  const bits: string[] = [];
  if (intent.escalated) bits.push("escalated");
  if (intent.pri) bits.push("P" + intent.pri);
  if (intent.signal) bits.push(intent.signal);
  let where = "";
  if (intent.device) where = " on " + deviceById(intent.device).name;
  else if (intent.rack) where = " in rack " + intent.rack;
  else if (intent.hall) where = " in " + hallName(intent.hall);
  return { what: (bits.length ? bits.join(" ") + " " : "") + "alarms", where };
}

/* ---------- answers ---------- */

function alarmsAnswer(intent: AskIntent) {
  const list = matching(intent);
  const { what, where } = scope(intent);
  if (!list.length) {
    return card("answer", lead("No open " + esc(what) + esc(where) + ".") + source("the alarm list"));
  }
  const p1 = list.filter((a) => a.pri === 1).length;
  const head = list.length + " open " + what + where + (p1 ? ", " + p1 + " of them P1" : "") + ". Worst first.";
  const rows = list.slice(0, 8).map((alarm) => {
    const c = alarmClock(alarm);
    return '<li><span class="pri-mark pri-' + alarm.pri + '" aria-hidden="true">' + alarm.pri + '</span><span class="sr-only">P' + alarm.pri + " </span>" +
      link(alarm.asset, alarmRoute(alarm)) + '<span class="ask-clock' + (c.escalated ? " is-escalated" : "") + '">' + esc(c.text) + "</span>" +
      '<span class="ask-what">' + esc(alarm.text) + "</span></li>";
  }).join("");
  const more = list.length > 8 ? '<p class="ask-more">' + (list.length - 8) + " more. " + link("Show all in Fleet", "#/fleet") + "</p>" : "";
  return card("answer", lead(esc(head)) + '<ul class="ask-alarms">' + rows + "</ul>" +
    more + source("the alarm list (" + activeAlarms().length + " open)"));
}

function deviceAlarm(id: string) {
  return activeAlarms().find((alarm) => alarm.device === id) || null;
}

function explainAnswer(intent: AskIntent) {
  const d = deviceById(intent.device);
  const alarm = deviceAlarm(intent.device);
  const open = link("Open " + d.name, "#/rack/A14/" + encodeURIComponent(d.id));
  if (!alarm) {
    const status = "BMC " + (d.bmc === "down" ? "dark" : "up") + ", in-band RDP " + (d.rdp === "down" ? "down" : "up") + ".";
    return card("answer", lead(esc(d.name) + " has no open alarm.") + "<p>" + esc(status) + " " + open + "</p>" + source(d.name + " · serial watch on " + d.tty));
  }
  const input = alarmInput(alarm);
  const result = explain(input);
  const newest = Math.max(...result.evidence.map((line) => line.at || 0));
  const age = Date.now() - newest;
  const stale = newest && age > STALE_MS ? ' <span class="ask-stale">Newest reading ' + esc(span(age)) + " old</span>" : "";
  const best = "<p>" + open + "</p>";
  return card("answer", lead("<b>P" + alarm.pri + " on " + esc(d.name) + ".</b> " + esc(result.cause) + " (" + result.confidence + "% likely)" + stale) +
    explainHtml(input) + best + source("alarm " + alarm.id + " · " + d.tty, newest || Date.now()));
}

function fleetAnswer(intent: AskIntent) {
  const halls = fleetSummary().map((h) => ({ ...h, head: h.capKw - h.itKw, pct: h.capKw ? Math.round(((h.capKw - h.itKw) / h.capKw) * 100) : 0 }));
  const pick = intent.below ? halls.filter((h) => h.pct < intent.below) : halls;
  const low = halls.slice().sort((a, b) => a.pct - b.pct)[0];
  const headline = intent.below
    ? (pick.length
      ? pick.length + (pick.length === 1 ? " hall has" : " halls have") + " less than " + intent.below + "% power headroom."
      : "No hall has less than " + intent.below + "% power headroom. Lowest is " + low.name + " at " + low.pct + "%.")
    : halls.length + " halls. Lowest headroom is " + low.name + " at " + low.pct + "%.";
  const rows = pick.sort((a, b) => a.pct - b.pct).map((h) => "<tr><td>" + link(h.name, "#/floor/" + encodeURIComponent(h.id)) + "</td><td>" +
    (h.itKw / 1000).toFixed(2) + "</td><td>" + (h.head / 1000).toFixed(2) + " · " + h.pct + "%</td><td>" +
    (h.alarms ? h.alarms + " · P" + h.worst : "Clear") + "</td></tr>").join("");
  const table = rows
    ? '<div class="ask-table"><table><thead><tr><th>Hall</th><th>IT power (MW)</th><th>Headroom (MW · %)</th><th>Alarms</th></tr></thead><tbody>' + rows + "</tbody></table></div>"
    : "";
  return card("answer", lead(esc(headline)) + table + "<p>" + link("Show in Fleet", "#/fleet") + "</p>" + source("Operate · Fleet"));
}

function fitAnswer(intent: AskIntent) {
  const kw = intent.kw || PLANT.kwPerRack;
  const want = intent.count || 1;
  const halls = fleetSummary().map((h) => ({ ...h, head: h.capKw - h.itKw })).map((h) => ({ ...h, fits: Math.floor(h.head / kw) }))
    .sort((a, b) => b.head - a.head);
  const ok = halls.filter((h) => h.fits >= want && h.feed === "normal");
  const best = ok[0];
  const headline = best
    ? best.name + " has the most power headroom: " + (best.head / 1000).toFixed(2) + " MW, enough for " + best.fits + " racks at " + kw + " kW."
    : "No hall has power headroom for " + want + " more " + kw + " kW racks.";
  const rows = halls.slice(0, 5).map((h) => "<tr><td>" + link(h.name, "#/plan/" + encodeURIComponent(h.id)) + "</td><td>" + (h.head / 1000).toFixed(2) +
    "</td><td>" + h.fits + "</td><td>" + (h.feed === "normal" ? "Normal" : h.feed === "lost" ? "Power lost" : "At risk") + "</td></tr>").join("");
  return card("answer", lead(esc(headline)) +
    '<div class="ask-table"><table><thead><tr><th>Hall</th><th>Headroom (MW)</th><th>Racks at ' + kw + " kW</th><th>Feed</th></tr></thead><tbody>" + rows + "</tbody></table></div>" +
    '<p class="ask-note">Checked against IT power headroom and feed state only. Rack positions, cooling, and floor space are in Plan · Halls.</p>' +
    source("Operate · Fleet (" + PLANT.kwPerRack + " kW rack budget)"));
}

function handoverAnswer(intent: AskIntent) {
  const hours = intent.hours || 12;
  const from = Date.now() - hours * 3600000;
  const cleared = clearedAlarms.filter((row) => row.at >= from);
  const open = activeAlarms();
  const acts = state.audit.filter((row) => row.t >= from && row.role !== "automatic" && row.role !== "appliance");
  const resolved = cleared.length
    ? "<ul>" + cleared.slice(0, 8).map((row) => "<li>P" + row.pri + " " + esc(row.asset) + ": " + esc(row.text) + " <span class=\"ask-muted\">cleared " +
      esc(clock(row.at)) + ", open " + esc(span(row.at - row.since)) + "</span></li>").join("") + "</ul>"
    : '<p class="ask-muted">Nothing cleared in this window.</p>';
  const still = open.length
    ? "<ul>" + open.slice(0, 8).map((alarm) => { const c = alarmClock(alarm); return "<li>" + link("P" + alarm.pri + " " + alarm.asset, alarmRoute(alarm)) + " " +
      esc(alarm.text) + ' <span class="ask-muted' + (c.escalated ? " is-escalated" : "") + '">' + esc(c.text) + "</span></li>"; }).join("") +
      (open.length > 8 ? "<li>" + (open.length - 8) + " more in the alarm list</li>" : "") + "</ul>"
    : '<p class="ask-muted">No open alarms.</p>';
  const done = acts.length
    ? "<ul>" + acts.slice(0, 8).map((row) => "<li>" + esc(clock(row.t)) + " " + esc(row.user) + ": " + esc(row.action) + (row.asset ? " · " + esc(row.asset) : "") + "</li>").join("") + "</ul>"
    : '<p class="ask-muted">No actions by people in this window.</p>';
  const escalated = open.filter((alarm) => alarmClock(alarm).escalated).length;
  const headline = "Last " + hours + " h: " + cleared.length + " cleared, " + open.length + " still open" + (escalated ? " (" + escalated + " escalated)" : "") +
    ", " + acts.length + " actions by people.";
  return card("answer", lead(esc(headline)) +
    '<p class="ask-window"><span class="pill">Last ' + hours + " h</span> Ask “last 4 hours” to change the window.</p>" +
    "<h3>Resolved</h3>" + resolved + "<h3>Still open</h3>" + still + "<h3>Actions taken</h3>" + done +
    "<p>" + link("Open in Audit", "#/audit", ' data-audit-filter="all"') + "</p>" + source("the alarm list and the audit log"));
}

function howtoAnswer(intent: AskIntent) {
  const d = deviceById(intent.device);
  const outlet = outletByN(d.outlet);
  const locked = state.leak && LEAK.outlets.indexOf(d.outlet) >= 0;
  const reason = outlet ? outletReason(outlet) : "";
  const steps = [
    esc(d.name) + " is in rack A14 at U" + d.u + ", on outlet " + d.outlet + ", with its serial console on " + esc(d.tty) + ".",
    "Open its console and shut the OS down cleanly. " + link("Open " + d.name, "#/rack/A14/" + encodeURIComponent(d.id)),
    "Power-cycle outlet " + d.outlet + " from Control. Control asks for a work order and the short name " + esc(d.short) + ". " +
      '<button type="button" class="act" data-act="ask-control" data-outlet="' + d.outlet + '" data-op="cycle">Open in Control</button>',
    "Watch the serial console come back, then check the alarm list.",
  ];
  const notes = [
    locked ? '<p class="ask-warn">Outlet ' + d.outlet + " is locked by the DI-1 leak interlock. Don't re-energize it until DI-1 clears.</p>" : "",
    reason && !locked ? '<p class="ask-warn">Control right now: ' + esc(reason) + "</p>" : "",
  ].join("");
  return card("answer", lead("Steps to power-cycle " + esc(d.name) + ".") + "<ol>" + steps.map((s) => "<li>" + s + "</li>").join("") + "</ol>" + notes +
    source(d.name + " · rack A14 elevation and outlet map"));
}

function navigateAnswer(intent: AskIntent) {
  let route = "";
  let said = "";
  if (intent.view === "fleet" && intent.hall) {
    setFleetDrill(intent.hall, intent.sort || "power");
    route = "#/fleet";
    said = "Opened Fleet with " + hallName(intent.hall) + "'s racks by " + (intent.sort || "power") + ".";
  } else if (intent.rack) {
    const pod = intent.hall || rackPod(intent.rack);
    route = "#/floor/" + encodeURIComponent(pod) + "/" + encodeURIComponent(intent.rack);
    if (intent.face) setRackPreset(intent.face);
    said = "Opened rack " + intent.rack + " in " + hallName(pod) + (intent.face ? ", " + intent.face : "") + ".";
  } else if (intent.device) {
    route = "#/rack/A14/" + encodeURIComponent(intent.device);
    said = "Opened " + deviceById(intent.device).name + " in rack A14.";
  } else if (intent.view) {
    route = "#/" + intent.view;
    said = "Opened " + intent.view.replace("map", "port map").replace("oneline", "one-line") + ".";
  } else if (intent.hall) {
    route = "#/floor/" + encodeURIComponent(intent.hall);
    said = "Opened " + hallName(intent.hall) + " on the floor.";
  }
  go(route);
  return card("answer", lead(esc(said)) + '<p class="ask-muted">Back in the browser returns to where you were.</p>');
}

function ambiguousAnswer(intent: AskIntent) {
  if (intent.missing === "rack") {
    const racks = ["A14", "A07", "H3-07"].filter((id) => rackPod(id));
    return card("ambiguous", lead("Which rack?") + '<div class="ask-options">' + racks.map((id) =>
      '<button type="button" class="act" data-act="ask-option" data-q="' + esc("Open rack " + id) + '">' + esc(id + " · " + hallName(rackPod(id))) + "</button>").join("") + "</div>");
  }
  const alarmed = devices.filter((d) => deviceAlarm(d.id));
  const list = (alarmed.length ? alarmed : devices).slice(0, 6);
  const verb = /\bwhy|explain|wrong/i.test(intent.text) ? "Why is " : (/\bhow\b/i.test(intent.text) ? "How do I power-cycle " : (intent.path ? "Open a " + intent.path + " session on " : "Open "));
  const tail = verb === "Why is " ? " alarming?" : "";
  return card("ambiguous", lead("Which device?") + '<div class="ask-options">' + list.map((d) =>
    '<button type="button" class="act" data-act="ask-option" data-q="' + esc(verb + d.name + tail) + '">' + esc(d.name) + "</button>").join("") + "</div>");
}

function powerAnswer(intent: AskIntent) {
  const role = state.user.role;
  if (intent.bulk) {
    return refusal("Ask doesn't switch power for more than one outlet.", "Use Control to switch power. Whole-PDU control needs a named maintenance window there.",
      "<p>" + link("Open Control", "#/control") + "</p>");
  }
  const n = intent.outlet || (intent.device ? deviceById(intent.device).outlet : 0);
  const outlet = n ? outletByN(n) : null;
  if (!outlet) return card("unknown", lead("Which outlet?") + "<p>Name an outlet number or a device, for example “turn off outlet 9”.</p>");
  if (role === "ReadOnly") {
    return refusal("Your role can't switch outlets.", "ReadOnly can open consoles but not cycle outlets. An Operator or Administrator can.");
  }
  const asset = outlet.deviceId ? deviceById(outlet.deviceId).name : "Unbound";
  if (state.leak && LEAK.outlets.indexOf(n) >= 0 && intent.op !== "off") {
    return refusal("Outlet " + n + " is locked by the DI-1 leak interlock.",
      "DI-1 is asserted at " + LEAK.location + ". " + asset + " stays off until the leak clears. Ask can explain the interlock but can't override it.",
      "<p>" + link("Open Control", "#/control?outlet=" + n) + "</p>");
  }
  const verb = intent.op === "off" ? "Turn off" : intent.op === "cycle" ? "Power-cycle" : "Turn on";
  const reason = outletReason(outlet);
  const how = intent.op === "on"
    ? "Control shows outlet " + n + " with its On button."
    : "Control asks you to confirm" + (outlet.deviceId && deviceById(outlet.deviceId).kind === "GPU tray" ? " with a work order and the short name " + deviceById(outlet.deviceId).short : "") + ".";
  return card("handoff", lead("<b>" + esc(verb) + " outlet " + n + " · " + esc(asset) + "</b>") +
    "<p>Power changes go through Control. Ask never switches power itself. " + esc(how) + "</p>" +
    (reason ? '<p class="ask-warn">Control will refuse right now: ' + esc(reason) + "</p>" : "") +
    '<p><button type="button" class="act primary" data-act="ask-control" data-outlet="' + n + '" data-op="' + esc(intent.op || "cycle") + '">Open in Control</button></p>');
}

function proposalBody(p: Proposal) {
  if (p.type === "ack") {
    const alarms = activeAlarms();
    const names = (p.ids || []).map((id) => { const a = alarms.find((x) => x.id === id); return a ? "P" + a.pri + " " + a.asset : id; });
    const shown = names.slice(0, 8).map((x) => "<li>" + esc(x) + "</li>").join("") + (names.length > 8 ? "<li>and " + (names.length - 8) + " more</li>" : "");
    return lead("<b>Ack " + names.length + (names.length === 1 ? " alarm" : " alarms") + "?</b>") + "<ul>" + shown + "</ul>";
  }
  const d = deviceById(p.device);
  return lead("<b>Open " + (p.path === "kvm" ? "MPU2 KVM" : "ACS serial") + " on " + esc(d.name) + "?</b>") +
    "<p>" + (p.path === "kvm" ? "MPU2 port " + d.mpu : esc(d.tty) + " on ACS-A14") + ". The session opens in Operate · Sessions.</p>";
}

function proposalHtml(turn: Turn) {
  const p = turn.proposal;
  const foot = p.status === "open"
    ? '<div class="ask-confirm"><button type="button" class="act primary" data-act="ask-confirm" data-turn="' + turn.n + '">Confirm</button>' +
      '<button type="button" class="act" data-act="ask-cancel" data-turn="' + turn.n + '">Cancel</button></div>'
    : '<p class="ask-result" role="status">' + esc(p.result || "") + "</p>";
  return card("proposal" + (p.status === "open" ? "" : " is-" + p.status), proposalBody(p) + foot);
}

function ackProposal(intent: AskIntent, turn: Turn) {
  const list = matching(intent).filter((alarm) => !state.acked[alarm.id]);
  const { what, where } = scope(intent);
  if (!list.length) return card("answer", lead("No unacked " + esc(what) + esc(where) + ".") + source("the alarm list"));
  if (list.length > ACK_CAP) {
    return refusal("That's " + list.length + " alarms.", "Ask acks up to " + ACK_CAP + " at once. Narrow it by hall, priority, or kind, for example “ack P3 inlet alarms in Hall 1”.");
  }
  turn.proposal = { type: "ack", ids: list.map((alarm) => alarm.id), status: "open" };
  return "";
}

function sessionProposal(intent: AskIntent, turn: Turn) {
  turn.proposal = { type: "session", device: intent.device, path: intent.path || "serial", status: "open" };
  return "";
}

function helpAnswer() {
  return card("answer", lead("Ask about alarms, racks, devices, power, and capacity.") + "<ul>" +
    ["What's wrong in Hall 1?", "Why is GPU Tray 06 alarming?", "Which halls have less than 50% headroom?", "Open rack A14 from the rear",
      "Ack all P3 inlet alarms in Hall 1", "What happened last shift?"].map((q) =>
      '<li><button type="button" class="ask-link" data-act="ask-option" data-q="' + esc(q) + '">' + esc(q) + "</button></li>").join("") + "</ul>");
}

function unknownAnswer() {
  return card("unknown", lead("DCIAC doesn't have that.") +
    "<p>Ask covers alarms, racks and devices, power and capacity, sessions, and the audit log. It needs a hall, rack, or device name to look up, for example “why is GPU Tray 06 alarming?”.</p>");
}

/* ---------- conversation ---------- */

function go(route: string) {
  if (!route) return;
  if (location.hash === route) onHashChange();
  else location.hash = route;
}

function assetOf(intent: AskIntent) {
  if (intent.device) return deviceById(intent.device).name;
  if (intent.outlet) return "Outlet " + intent.outlet;
  if (intent.rack) return "Rack " + intent.rack;
  if (intent.hall) return hallName(intent.hall);
  return "";
}

export function sendAsk(text: string) {
  const intent = parseQuestion(text);
  if (intent.kind === "empty") return;
  const turn: Turn = { n: ++ask.seq, q: intent.text, kind: intent.kind, body: "" };
  let body = "";
  switch (intent.kind) {
    case "help": body = helpAnswer(); break;
    case "alarms": body = alarmsAnswer(intent); break;
    case "explain": body = explainAnswer(intent); break;
    case "fleet": body = fleetAnswer(intent); break;
    case "fit": body = fitAnswer(intent); break;
    case "handover": body = handoverAnswer(intent); break;
    case "howto": body = howtoAnswer(intent); break;
    case "navigate": body = navigateAnswer(intent); break;
    case "ambiguous": body = ambiguousAnswer(intent); break;
    case "power": body = powerAnswer(intent); break;
    case "ack": body = ackProposal(intent, turn); break;
    case "session": body = sessionProposal(intent, turn); break;
    default: body = unknownAnswer();
  }
  turn.body = body;
  ask.turns.push(turn);
  if (ask.turns.length > 30) ask.turns.shift();
  userAudit("ask", {
    asset: assetOf(intent),
    detail: "“" + intent.text + "” → " + intent.kind + (turn.proposal ? " (proposal, waiting for confirm)" : "") +
      (body.indexOf("ask-refusal") >= 0 ? " (refused)" : ""),
    via: "ask",
  });
  ask.scroll = true;
  state.focusField = intent.kind === "navigate" && phone() ? "" : "ask-a-" + turn.n;
  if (intent.kind === "navigate" && phone()) ask.open = false;
  render();
}

export function confirmAsk(n: number) {
  const turn = ask.turns.find((t) => t.n === n);
  if (!turn || !turn.proposal || turn.proposal.status !== "open") return;
  const p = turn.proposal;
  if (p.type === "ack") {
    const live = activeAlarms().filter((alarm) => (p.ids || []).indexOf(alarm.id) >= 0 && !state.acked[alarm.id]);
    live.forEach((alarm) => { state.acked[alarm.id] = true; });
    p.result = "Acked " + live.length + (live.length === 1 ? " alarm." : " alarms.") + (live.length < (p.ids || []).length ? " The rest had cleared or were already acked." : "");
    userAudit("ask ack", { asset: live.map((a) => a.asset).join(", ").slice(0, 200), detail: p.result + " Confirmed by the user.", via: "ask" });
    p.status = "done";
    state.focusField = "ask-a-" + n;
    render();
    return;
  }
  p.status = "done";
  const d = deviceById(p.device);
  p.result = "Requested " + (p.path === "kvm" ? "MPU2 KVM" : "ACS serial") + " on " + d.name + ". The usual console check still applies; Sessions shows the result.";
  userAudit("ask confirm", { asset: d.name, detail: p.result, via: "ask" });
  if (p.path === "kvm") openSession(p.device, "acs", "kvm", "");
  else openSession(p.device, "acs", "serial", "rs232");
}

export function cancelAsk(n: number) {
  const turn = ask.turns.find((t) => t.n === n);
  if (!turn || !turn.proposal || turn.proposal.status !== "open") return;
  turn.proposal.status = "cancelled";
  turn.proposal.result = "Cancelled. Nothing changed.";
  userAudit("ask cancel", { detail: "“" + turn.q + "” cancelled. Nothing changed.", via: "ask" });
  state.focusField = "ask-a-" + n;
  render();
}

export function askControl(n: number, op: string) {
  userAudit("ask handoff", { outlet: "Outlet " + n, detail: "Handed " + op + " on outlet " + n + " to Control for confirmation.", via: "ask" });
  if (phone()) ask.open = false;
  const outlet = outletByN(n);
  if (op === "on" || !outlet || outletReason(outlet)) showOutlet(n);
  else actOutlet(n, op === "off" ? "off" : "cycle", "ask");
}

export function askLink(route: string, auditFilter?: string) {
  if (auditFilter) setAuditFilter(auditFilter === "all" ? "all" : auditFilter);
  if (phone()) ask.open = false;
  go(route);
}

/* ---------- Audit filter (All · Manual · via Ask) ---------- */

let auditFilter = "all";

export function setAuditFilter(next: string) {
  auditFilter = next === "ask" || next === "manual" ? next : "all";
}

export function getAuditFilter() {
  return auditFilter;
}

/* ---------- panel ---------- */

function contextLine() {
  const v = state.view;
  const f = state.floor;
  const titles = { rack: "Operate · Rack", map: "Operate · Port map", control: "Operate · Control", sessions: "Operate · Sessions",
    oneline: "Operate · One-line", fleet: "Operate · Fleet", plan: "Plan · Campus", halls: "Plan · Halls", models: "Plan · Models",
    dcim: "Plan · DCIM", audit: "Audit", simulate: "Simulate", manage: "Manage", floor: "Floor" };
  const bits = [titles[v] || "Access"];
  if (v === "floor" && f.podId && f.level !== "site" && f.level !== "hall") bits.push(hallName(f.podId));
  if (v === "floor" && f.rackId && ["rack", "elevation", "server", "part"].indexOf(f.level) >= 0) bits.push("Rack " + f.rackId);
  if (v === "rack") { bits.push("A14"); const d = deviceById(state.selected); if (d) bits.push(d.name); }
  return bits.join(" · ");
}

function suggestions() {
  const v = state.view;
  if (v === "rack" || v === "sessions" || v === "map") return ["Why is GPU Tray 06 alarming?", "Open a serial session on GPU Tray 05", "How do I power-cycle GPU Tray 03?"];
  if (v === "control") return ["Turn off outlet 9", "Why is GPU Tray 06 alarming?", "What happened last shift?"];
  if (v === "fleet" || v === "plan" || v === "halls") return ["Where can I fit 2 more 120 kW racks?", "Show Hall 3's racks by power", "Which halls have less than 50% headroom?"];
  if (v === "audit") return ["What happened last shift?", "Show escalated alarms", "Ack all P3 inlet alarms in Hall 1"];
  return ["What's wrong in Hall 1?", "Which halls have less than 50% headroom?", "Open rack A14 from the rear"];
}

export function askHeadHtml() {
  const demo = usingLocalParser()
    ? '<span class="pill ask-demo" title="Answers come from DCIAC data through built-in rules. No language model is connected.">Demo answers</span>'
    : "";
  return '<div class="ask-head"><h2 id="ask-title">Ask DCIAC</h2>' + demo +
    '<button type="button" class="act ask-close" data-act="ask-close" aria-label="Close Ask">Close</button></div>' +
    '<p class="ask-context"><span class="ask-label">Looking at:</span> ' + esc(contextLine()) + "</p>";
}

export function askLogHtml() {
  const turns = ask.turns.map((turn) => '<article class="ask-turn" data-kind="' + esc(turn.kind) + '">' +
    '<p class="ask-q"><span class="sr-only">You asked: </span>' + esc(turn.q) + "</p>" +
    '<div class="ask-a" id="ask-a-' + turn.n + '" tabindex="-1">' + turn.body + (turn.proposal ? proposalHtml(turn) : "") + "</div></article>").join("");
  const empty = ask.turns.length ? "" : '<div class="ask-empty"><p>Ask about alarms, racks, power, and capacity.</p><div class="ask-options">' +
    suggestions().map((q) => '<button type="button" class="act ask-suggest" data-act="ask-option" data-q="' + esc(q) + '">' + esc(q) + "</button>").join("") + "</div></div>";
  return '<div class="ask-log" role="log" aria-live="polite" aria-label="Ask conversation">' + empty + turns + "</div>";
}

export function askFormHtml() {
  return '<form class="ask-form" data-act="ask-send"><label class="sr-only" for="ask-input">Ask about DCIAC</label>' +
    '<textarea id="ask-input" name="q" rows="1" maxlength="500" autocomplete="off" placeholder="Ask about alarms, racks, power…"></textarea>' +
    '<button type="submit" class="act primary">Ask</button></form>';
}

/* After paint: keep the newest answer in view and size the input to its text. */
export function askAfterPaint() {
  if (!ask.open) return;
  if (ask.scroll) {
    ask.scroll = false;
    const log = document.querySelector(".ask-log");
    const last = log ? log.lastElementChild : null;
    if (last && last instanceof HTMLElement && log instanceof HTMLElement) log.scrollTop = last.offsetTop - 8;
  }
}

export function askInputKey(event: KeyboardEvent) {
  const el = event.target as HTMLTextAreaElement;
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    const text = el.value;
    el.value = "";
    el.rows = 1;
    sendAsk(text);
    return true;
  }
  return false;
}

export function askInputGrow(el: HTMLTextAreaElement) {
  el.rows = Math.min(4, Math.max(1, el.value.split("\n").length));
}

/* "/" opens Ask, except while typing or inside a console. */
export function askShortcut(event: KeyboardEvent) {
  if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || !state.user) return false;
  const t = event.target as HTMLElement;
  if (t && t.closest && t.closest("input, textarea, select, [contenteditable], [data-kvm], .xterm, .xterm-host, .term")) return false;
  if (state.outletGate && state.outletGate.phase === "confirm") return false;
  event.preventDefault();
  openAsk(ask.opener || "ask-nav");
  return true;
}
