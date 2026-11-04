import { MEDIA, deviceById } from "../data/devices";
import { acsWaiting, countdownBlock } from "../domain/failover";
import { hydrateSerial, serialPathLabel, sessionLocator, sessionNote, sessionTitle } from "../domain/sessions";
import { mediaReason, rmBlockCopy, sessionBlocked } from "../domain/single-master";
import { state } from "../state";
import { explainHtml, serialInput } from "../ui/explain";
import { esc } from "../ui/format";
import { pills } from "../ui/shell";
import { launcher } from "./rack";

export function mediaControls(s) {
  const reason = mediaReason();
  const pathName = s.path === "rm1048" ? "RM1048 virtual media" : "MPU virtual media";
  const options = MEDIA.map((name) => '<option' + (name === s.mediaChoice ? " selected" : "") + ">" + esc(name) + "</option>").join("");
  const dis = reason ? " disabled" : "";
  const title = reason ? ' title="' + esc(reason) + '"' : "";
  return '<div class="media"><span class="kicker">' + esc(pathName) + '</span><div class="media-row"><select data-media-for="' +
    s.id + '" data-focus-key="media-' + s.id + '" id="media-' + s.id + '"' + dis + ">" + options +
    '</select><button type="button" class="act primary" data-act="mount" data-session="' + s.id + '"' + dis + title + ">" +
    (s.media ? "Eject" : "Mount") + "</button></div><p class=\"fine\">" +
    (s.media ? "Mounted " + esc(s.media) : "No image mounted.") + "</p>" +
    (reason ? '<p class="reason">' + esc(reason) + "</p>" : "") + "</div>";
}

export function rdpLauncher(d) {
  if (d.kind !== "GPU tray") return "";
  if (d.rdp === "down") {
    return '<button type="button" class="act launch primary" data-act="rdp-failover" data-device="' + d.id +
      '"><strong>KVM failover</strong><small>RDP lost · MPU port ' + d.mpu + "</small></button>";
  }
  return launcher(d, "rdp", "desktop", "RDP", d.host + " · in-band", "");
}

export function rdpDesk(d, dead) {
  const load = d.load || { gpu: 0, mem: 0, power: 0 };
  const bars = [
    ["GPU", load.gpu],
    ["Memory", load.mem],
    ["Power", load.power],
  ].map((pair) => '<div class="rdp-meter"><span>' + pair[0] + '</span><i style="width:' + Math.round(pair[1]) + '%"></i></div>').join("");
  return '<div class="rdp' + (dead ? " dead" : "") + '"><div class="rdp-bar"><span>Remote desktop</span><span class="mono">' +
    esc(d.host) + " · 3389</span></div><div class=\"rdp-stage\">" +
    (dead
      ? '<p class="rdp-title">Remote desktop disconnected</p><p>The in-band RDP path to ' + esc(d.name) +
        ' is gone. This is not the out-of-band console.</p><button type="button" class="act primary" data-act="rdp-failover" data-device="' +
        d.id + '">Fail over to ACS KVM</button>'
      : '<div class="rdp-window"><div class="rdp-titlebar">' + esc(d.name) + ' · Ubuntu 24.04</div><p>In-band graphical session. ACS KVM stays available if this desktop drops.</p>' +
        bars + '<button type="button" class="act" data-act="rdp-drop" data-device="' + d.id + '">Drop RDP</button></div>') +
    "</div></div>";
}

export function kvmBody(d, s) {
  if (s.rdpFailover && s.screen !== "bios") {
    return '<div class="toggle"><button type="button" class="act" data-act="screen" data-session="' + s.id +
      '" data-screen="bios" aria-pressed="false">BIOS</button>' +
      '<button type="button" class="act" data-act="screen" data-session="' + s.id +
      '" data-screen="os" aria-pressed="true">OS</button></div>' +
      '<div class="rdp kvm-take" data-kvm="' + s.id + '" tabindex="0" id="kvm-' + s.id + '" data-focus-key="kvm-' + s.id +
      '"><div class="rdp-bar"><span>MPU KVM · HTML5</span><span class="mono">port ' + d.mpu +
      '</span></div><div class="rdp-stage"><p class="kicker">RDP failover</p><p class="rdp-title">' + esc(d.name) +
      '</p><p>In-band remote desktop disconnected. Graphical console moved to this ACS KVM path. RM1048 did not take the failover.</p>' +
      '<div class="keys">Typed <span data-keys>' + esc(s.keys || "") + "</span></div></div></div>" +
      '<p class="fine">Click the console, then type. HTML5 viewer. Java and JNLP are unsupported.</p>' +
      mediaControls(s);
  }
  const lines = s.screen === "bios"
    ? [
      "GB200 tray console",
      d.name,
      d.bmc === "down" ? "BMC path dark — out-of-band console on ACS" : "BMC path up",
      "",
      "Boot mode          UEFI",
      "Virtual media      " + (s.media || "empty"),
      "HTML5 keyboard attached",
    ]
    : [
      d.short + " graphical console",
      "Ubuntu 24.04 LTS",
      "",
      "Virtual media      " + (s.media || "empty"),
      "HTML5 keyboard attached",
    ];
  return '<div class="toggle"><button type="button" class="act" data-act="screen" data-session="' + s.id +
    '" data-screen="bios" aria-pressed="' + (s.screen === "bios") + '">BIOS</button>' +
    '<button type="button" class="act" data-act="screen" data-session="' + s.id +
    '" data-screen="os" aria-pressed="' + (s.screen === "os") + '">OS</button></div>' +
    '<div class="bios" data-kvm="' + s.id + '" tabindex="0" id="kvm-' + s.id + '" data-focus-key="kvm-' + s.id + '">' +
    lines.map((line) => "<div>" + esc(line) + "</div>").join("") +
    '<div class="keys">Typed <span data-keys>' + esc(s.keys || "") + "</span></div></div>" +
    '<p class="fine">Click the console, then type. HTML5 viewer. Java and JNLP are unsupported.</p>' +
    mediaControls(s);
}

function gateCopy(d, s) {
  const readonly = !!(state.user && state.user.role === "ReadOnly");
  const blocked = sessionBlocked(s);
  const bits = [];
  if (readonly) {
    bits.push('<div class="term-banner" role="status">Read only. ' + esc(state.user.id) +
      " · " + esc(state.user.role) + " can watch this console. Input is closed.</div>");
  }
  if (blocked) {
    bits.push('<div class="term-banner block" role="status"><p>' + esc(rmBlockCopy(d, s.type)) +
      '</p><p>Single-master has this path. Input is closed.</p><button type="button" class="act primary" data-act="fallback" data-device="' +
      d.id + '" data-type="' + s.type + '">Open on ACS</button></div>');
  }
  return { readonly, blocked, html: bits.join("") };
}

export function serialBody(d, s) {
  if (!sessionBlocked(s) && acsWaiting(s)) {
    const where = s.medium === "usb" ? "USB-1" : d.tty + " · port " + d.port;
    return countdownBlock(d, "BMC path lost. Out-of-band serial is coming up on ACS " + where + ".");
  }
  hydrateSerial(s);
  const gate = gateCopy(d, s);
  const closed = gate.readonly || gate.blocked;
  const who = state.user ? esc(state.user.id) + " · " + esc(state.user.role) : "";
  const detail = s.path === "rm1048" ? sessionLocator(d, s) : (s.medium === "usb" ? "USB-1 · " + d.host : "port " + d.port + " · " + d.host);
  const hold = closed ? " disabled" : "";
  const holdTitle = closed ? ' title="Input is closed on this console."' : "";
  return '<div class="term-wrap"><header class="term-meta"><div><strong class="term-path">' + esc(serialPathLabel(d, s)) +
    '</strong><span class="fine">' + esc(detail) + '</span></div><span class="term-who">' + who +
    '</span></header>' + gate.html +
    '<div class="term-tools"><button type="button" class="act" data-act="term-copy" data-session="' + s.id +
    '">Copy</button><label class="term-find">Search <input data-term-query data-session="' + s.id +
    '" aria-label="Search scrollback" autocomplete="off" spellcheck="false"></label><button type="button" class="act" data-act="term-search" data-session="' +
    s.id + '">Find</button><button type="button" class="act" data-act="term-break" data-session="' + s.id + '"' + hold + holdTitle +
    '>Send BREAK</button><button type="button" class="act" data-act="term-download" data-session="' + s.id +
    '">Download session log</button></div><div class="xterm-host" data-xterm="' + s.id +
    '" role="region" aria-label="Console for ' + esc(d.name) + '"></div></div>';
}

export function sessionCard(s) {
  const d = deviceById(s.deviceId);
  const blocked = sessionBlocked(s);
  let body;
  if (s.type === "serial") {
    body = serialBody(d, s) + explainHtml(serialInput(s));
  } else if (blocked) {
    body = '<div class="fail" role="status"><p>' + esc(rmBlockCopy(d, s.type)) +
      '</p><button type="button" class="act primary" data-act="fallback" data-device="' +
      d.id + '" data-type="' + s.type + '">Open on ACS</button></div>';
  } else if (s.type === "desktop") {
    body = rdpDesk(d, d.rdp === "down");
  } else {
    body = kvmBody(d, s);
  }
  const kind = s.type === "desktop" ? "rdp" : (s.type === "kvm" ? "kvm" : "serial");
  const badge = s.type === "desktop" ? "warn" : (s.path === "rm1048" ? "nvidia" : "vertiv");
  return '<article class="session ' + (s.path === "rm1048" ? "rm" : "acs") + " " + kind +
    (blocked ? " blocked" : "") + (state.focusSession === s.id ? " selected" : "") + '" data-session-pane="' + s.id + '"><header class="session-head"><div><span class="badge ' +
    badge + '">' + esc(sessionTitle(s)) + "</span><h3>" + esc(sessionTitle(s)) + "</h3><p>" + esc(d.name) +
    '</p><p class="uri">' + esc(sessionLocator(d, s)) + '</p><p class="fine">' + esc(sessionNote(d, s)) +
    '</p></div><button type="button" class="act" data-act="close-session" data-session="' + s.id +
    '">Close</button></header>' + body + "</article>";
}

export function renderSessions() {
  const cards = state.sessions.map(sessionCard).join("");
  const body = state.sessions.length
    ? '<p class="fine">A dark BMC fails over to ACS serial and ACS KVM. A lost RDP desktop fails over to ACS KVM. RM1048 stays the in-band plane.</p><div class="workspace">' + cards + "</div>"
    : '<p class="empty">No sessions open. On the port map, choose any of the 48 ACS serial ports.</p>';
  return '<div class="page-head"><div class="top"><div><h1>Sessions</h1>' +
    '<p class="sub">Each pane names the path, the device, and the port or URI.</p></div></div>' +
    pills() + "</div>" + body;
}
