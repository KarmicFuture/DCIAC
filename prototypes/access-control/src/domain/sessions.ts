import { ACS_PORTS, MEDIA, deviceById } from "../data/devices";
import { heatBand } from "../data/pods";
import { REFUSED } from "../data/users";
import { audit, userAudit } from "./audit";
import { acsWaiting } from "./failover";
import { mediaReason, rmBlockCopy, sessionBlocked } from "./single-master";
import { runtime, state } from "../state";
import { render } from "../ui/schedule";

export function sessionById(id) {
  return state.sessions.find((s) => s.id === id);
}

export function rmSerialUri(d) {
  return "/redfish/v1/Managers/RMC/SerialInterfaces/" + d.redfishId;
}

export function rmKvmUri(d) {
  return "/redfish/v1/Managers/RMC/GraphicalConsole/" + d.redfishId;
}

export function sessionTitle(s) {
  if (s.type === "desktop") return "In-band · RDP";
  if (s.path === "rm1048" && s.type === "serial") return "RM1048 · Redfish serial";
  if (s.path === "rm1048" && s.type === "kvm") return "RM1048 · KVM";
  if (s.type === "kvm" && s.rdpFailover) return "Path ACS · KVM failover";
  if (s.type === "kvm") return "Path ACS · MPU KVM";
  if (s.medium === "usb") return "Path ACS · USB console";
  return "Path ACS · serial";
}

export function sessionLocator(d, s) {
  if (s.type === "desktop") return d.host + " · RDP 3389";
  if (s.path === "rm1048" && s.type === "serial") return rmSerialUri(d);
  if (s.path === "rm1048" && s.type === "kvm") return rmKvmUri(d);
  if (s.type === "kvm") return "MPU port " + d.mpu;
  if (s.medium === "usb") return "USB-1";
  return d.tty + " · port " + d.port;
}

export function sessionDetail(d, path, type, medium) {
  if (type === "desktop") return d.host + " · RDP 3389 · in-band";
  if (path === "rm1048" && type === "serial") return rmSerialUri(d);
  if (path === "rm1048" && type === "kvm") return rmKvmUri(d);
  if (type === "kvm") return "MPU port " + d.mpu + " · HTML5 · path ACS";
  if (medium === "usb") return "USB-1 · path ACS";
  return d.tty + " · port " + d.port + " · path ACS";
}

export function sessionNote(d, s) {
  if (s.type === "desktop") {
    return d.rdp === "down"
      ? "In-band remote desktop is down. The failover is ACS KVM, not RM1048."
      : "In-band remote desktop. ACS KVM is the out-of-band graphical path if this drops.";
  }
  if (s.path === "acs" && s.type === "kvm") {
    if (s.rdpFailover || d.rdp === "down") return "RDP failed over to this MPU KVM. RM1048 does not take the desktop failover.";
    if (d.bmc === "down") return "Out-of-band video on MPU. The BMC failed over to ACS, not to RM1048.";
    return "Device chosen on the ACS port map. Video is MPU port " + d.mpu + ". Serial is a separate path.";
  }
  if (s.path === "acs" && s.type === "serial") {
    const kind = consoleKind(d);
    const face = kind === "ios" ? "Cisco IOS prompt" : (kind === "uefi" ? "BMC and UEFI shell" : "Linux login");
    if (d.serialOnly) return face + " on " + d.name + ". This port is that server's console.";
    if (d.bmc === "down") return face + " on ACS. The BMC failed over to this port, not to RM1048.";
    return face + " on " + d.name + ". Video stays on the MPU KVM path.";
  }
  if (d.bmc === "down") return "RM1048 is the in-band plane. It does not take the BMC failover.";
  return "This path is the RM1048 in-band plane.";
}

export function consoleKind(d) {
  if (!d) return "linux";
  if (d.kind === "GPU tray") return "uefi";
  if (d.kind === "Switch" || /sn2201/i.test(d.name || "") || /sn2201/i.test(d.short || "")) return "ios";
  return "linux";
}

export function serialPathLabel(d, s) {
  if (!d) return "ACS";
  if (s && s.path === "rm1048") return "RM1048";
  if (s && s.medium === "usb") return "ACS USB-1";
  return "ACS " + d.tty;
}

function signedInId() {
  return state.user ? state.user.id : "operator";
}

function iosHost(d) {
  if (/sn2201/i.test(d.name || "") || /sn2201/i.test(d.short || "")) return "SN2201";
  return String(d.short || "Switch").toUpperCase();
}

function watchLine(d) {
  if (!d.watch) return "";
  if (d.watch.login === "reject") return "acs.watch was denied a shell on this port.";
  if (d.watch.login === "wait") return "acs.watch is still waiting for this port.";
  if (d.watch.pri) return d.watch.text;
  return "";
}

export function bootLines(d, s) {
  const who = signedInId();
  const lines = [];
  const note = watchLine(d);
  if (s.path === "rm1048") {
    lines.push("RM1048 Redfish serial");
    lines.push(rmSerialUri(d));
  } else if (s.medium === "usb") {
    lines.push("ACS 8000 USB console");
  } else {
    lines.push("ACS 8000 " + d.tty + "  port " + d.port);
  }
  if (note) lines.push(note);
  const kind = consoleKind(d);
  if (kind === "ios") {
    lines.push("");
    lines.push(iosHost(d) + " (Cisco IOS)");
    lines.push("");
    lines.push("User Access Verification");
    lines.push("");
    lines.push("Username: " + who);
    lines.push("Password:");
    lines.push("");
  } else if (kind === "uefi") {
    lines.push("");
    lines.push("[BMC] " + d.name + " serial redirect");
    if (d.bmc === "down") {
      lines.push("[BMC] Path dark. Out-of-band console is " + d.tty + ".");
      lines.push("[BMC] Failover stayed on ACS. RM1048 did not take it.");
    } else {
      lines.push("[BMC] Manager up. Firmware 1.8.4.");
    }
    lines.push("[UEFI] Boot mode UEFI");
    lines.push("[UEFI] Secure Boot off");
    lines.push("[UEFI] Mapping PCI devices");
    lines.push("[UEFI] net0  " + d.host);
    lines.push("[UEFI] Loading boot image");
    lines.push("[UEFI] StartImage returned to the shell");
    lines.push("UEFI Interactive Shell v2.2");
    lines.push("EDK II");
  } else {
    lines.push("");
    lines.push("Ubuntu 24.04.2 LTS " + d.host + " " + (d.tty || "ttyS0"));
    lines.push("");
    lines.push(d.host + " login: " + who);
    lines.push("Password:");
    lines.push("Last login: Wed Nov  4 02:40:12 UTC 2026 on " + (d.tty || "ttyS0"));
  }
  return lines;
}

export function hydrateSerial(s) {
  if (!s || s.type !== "serial" || s.lines) return;
  if (acsWaiting(s)) return;
  const mapped = deviceById(s.deviceId);
  if (!mapped) return;
  s.lines = bootLines(mapped, s);
  s.entry = s.entry || "";
  s.stage = "shell";
}

export function serialPrompt(d, s) {
  const kind = consoleKind(d);
  if (kind === "ios") return iosHost(d) + "#";
  if (kind === "uefi") return "Shell>";
  return signedInId() + "@" + (d.short || "host") + ":~$";
}

export function openSession(deviceId, path, type, medium) {
  const mapped = deviceById(deviceId);
  if (!mapped || mapped.rack !== "A14") {
    state.toast = "ACS-A14 launches only inside rack A14.";
    render();
    return;
  }
  if (path === "rdp") {
    if (mapped.kind !== "GPU tray") {
      state.toast = mapped.name + " has no in-band RDP desktop.";
      render();
      return;
    }
    const session = ensureSession(mapped, "rdp", "desktop");
    state.view = "sessions";
    state.focusSession = session.id;
    state.toast = mapped.rdp === "down" ? mapped.name + " RDP is down. Fail over to ACS KVM." : "";
    render();
    return;
  }
  const mediumNorm = medium || "";
  if (path === "rm1048" && (state.rm1048 !== "healthy" || mapped.bmc === "down")) {
    state.fails[deviceId + ":" + type] = true;
    state.selected = deviceId;
    state.view = "rack";
    state.toast = mapped.bmc === "down"
      ? mapped.name + " failed over to ACS. RM1048 is not the out-of-band path."
      : "RM1048 plane is dark. Open " + mapped.name + " on ACS.";
    userAudit("session refused", {
      asset: mapped.name,
      detail: mapped.bmc === "down"
        ? "BMC dark. Failover is ACS, not RM1048."
        : "RM1048 " + type + " unavailable. Plane is dark.",
      wo: "",
    });
    render();
    return;
  }
  const existing = state.sessions.find((s) =>
    s.deviceId === deviceId && s.path === path && s.type === type && (s.medium || "") === mediumNorm
  );
  if (existing) {
state.view = "sessions";
  state.focusSession = existing.id;
  state.focusTerm = existing.type === "serial" && !acsWaiting(existing) && !sessionBlocked(existing) ? existing.id : "";
  delete state.fails[deviceId + ":" + type];
  state.toast = path === "acs" && type === "serial" ? awardCatch(mapped) : "";
  render();
  return;
}
  const id = "s" + (++runtime.seq);
  const session = {
    id,
    deviceId,
    path,
    type,
    medium: mediumNorm,
    openedAt: Date.now(),
    lines: null,
    stage: type === "serial" ? "shell" : "login",
    media: null,
    mediaChoice: MEDIA[0],
    screen: mapped.bmc === "down" ? "bios" : "os",
    keys: "",
  };
  state.sessions.push(session);
  delete state.fails[deviceId + ":" + type];
  const waitingNote = path === "acs" && type === "serial" && acsWaiting(session) ? " · failover timer running" : "";
  userAudit("session open", {
    asset: mapped.name,
    detail: sessionDetail(mapped, path, type, mediumNorm) + waitingNote,
  });
  state.view = "sessions";
  state.focusSession = id;
  state.focusTerm = type === "serial" && !acsWaiting(session) ? id : "";
  state.toast = path === "acs" && type === "serial" ? awardCatch(mapped) : "";
  render();
}

export function fallback(deviceId, type) {
  state.sessions = state.sessions.filter((s) => !(s.deviceId === deviceId && s.path === "rm1048" && s.type === type));
  delete state.fails[deviceId + ":" + type];
  openSession(deviceId, "acs", type, type === "serial" ? "rs232" : "");
}

export function closeSession(id) {
  const session = sessionById(id);
  if (!session) return;
  const mapped = deviceById(session.deviceId);
  state.sessions = state.sessions.filter((s) => s.id !== id);
  if (state.focusSession === id) state.focusSession = "";
  userAudit("session close", {
    asset: mapped.name,
    detail: sessionDetail(mapped, session.path, session.type, session.medium),
    wo: "",
  });
  render();
}

export function refuseEndpoint(key) {
  const row = REFUSED.find((r) => r.key === key);
  if (!row) return;
  state.refuseNote = { key, text: row.reason };
  const port = /^port-(\d+)$/.exec(key);
  if (port) state.selectedPort = Number(port[1]);
  state.view = "map";
  state.toast = row.reason;
  userAudit("session refused", { asset: row.target, detail: row.reason, wo: "" });
  render();
}

export function sendSerial(id, raw) {
  const session = sessionById(id);
  if (!session || session.type !== "serial") return;
  if (sessionBlocked(session) || acsWaiting(session)) return;
  if (state.user && state.user.role === "ReadOnly") return;
  hydrateSerial(session);
  const mapped = deviceById(session.deviceId);
  const text = String(raw || "");
  session.stage = "shell";
  session.lines.push(serialPrompt(mapped, session) + (text ? " " + text : ""));
  shellReply(mapped, text).forEach((line) => session.lines.push(line));
  if (session.lines.length > 2000) session.lines.splice(0, session.lines.length - 2000);
  session.entry = "";
  state.focusTerm = id;
  render();
}

function linuxReply(d, text) {
  if (text === "help") return ["hostname", "whoami", "uptime"];
  if (text === "hostname") return [d.host];
  if (text === "whoami") return [signedInId()];
  if (text === "uptime") return ["serial console up on " + d.tty + ", port " + d.port + " of " + ACS_PORTS];
  return ["bash: " + text + ": command not found"];
}

function iosReply(d, text) {
  const host = iosHost(d);
  const lower = text.toLowerCase();
  if (lower === "help" || lower === "?") return ["show version", "show ip interface brief", "show users"];
  if (lower === "show version") return [host + " Cisco IOS Software", "Uptime is on the ACS serial line " + d.tty];
  if (lower === "show ip interface brief") return ["Interface  IP-Address  Status  Protocol", "Vlan1      10.14.0." + d.port + "  up      up"];
  if (lower === "show users") return ["Line  User  Host", "* 1 vty 0  " + signedInId() + "  idle"];
  return ["% Unknown command or computer name, or unable to find computer address"];
}

function uefiReply(d, text) {
  const lower = text.toLowerCase();
  if (lower === "help" || lower === "?") return ["ver", "map", "pci", "help"];
  if (lower === "ver") return ["UEFI Interactive Shell v2.2", "EDK II", "Firmware 1.8.4"];
  if (lower === "map") return ["FS0:", "BLK0:", "net0  " + d.host];
  if (lower === "pci") return ["Seg  Bus  Dev  Func", "00   00   00   00  Host bridge", "00   01   00   00  VGA-compatible controller"];
  return ["'" + text + "' is not recognized as an internal or external command."];
}

export function shellReply(d, text) {
  const line = String(text || "").trim();
  if (!line) return [];
  const kind = consoleKind(d);
  if (kind === "ios") return iosReply(d, line);
  if (kind === "uefi") return uefiReply(d, line);
  return linuxReply(d, line);
}

export function setScreen(id, screen) {
  const session = sessionById(id);
  if (!session) return;
  session.screen = screen === "os" ? "os" : "bios";
  render();
}

export function toggleMedia(id) {
  const session = sessionById(id);
  if (!session) return;
  const reason = mediaReason();
  if (reason) {
    state.toast = reason;
    render();
    return;
  }
  if (sessionBlocked(session)) {
    state.toast = rmBlockCopy(deviceById(session.deviceId), session.type);
    render();
    return;
  }
  const mapped = deviceById(session.deviceId);
  if (session.media) {
    const prev = session.media;
    session.media = null;
    userAudit("virtual media eject", {
      asset: mapped.name,
      detail: prev + " · " + sessionDetail(mapped, session.path, session.type, session.medium),
    });
    state.toast = "Ejected " + prev;
  } else {
    session.media = session.mediaChoice || MEDIA[0];
    userAudit("virtual media mount", {
      asset: mapped.name,
      detail: session.media + " · " + sessionDetail(mapped, session.path, session.type, session.medium),
    });
    state.toast = "Mounted " + session.media;
  }
  render();
}

export function ensureSession(mapped, path, type, extra?: any) {
  let session = state.sessions.find((s) => s.deviceId === mapped.id && s.path === path && s.type === type);
  if (!session) {
    session = {
      id: "s" + (++runtime.seq),
      deviceId: mapped.id,
      path,
      type,
      medium: "",
      openedAt: Date.now(),
      lines: null,
      stage: "login",
      media: null,
      mediaChoice: MEDIA[0],
      screen: "os",
      keys: "",
      rdpFailover: false,
    };
    state.sessions.push(session);
    userAudit("session open", {
      asset: mapped.name,
      detail: sessionDetail(mapped, path, type, ""),
    });
  }
  if (extra) Object.assign(session, extra);
  return session;
}

export function failRdpToKvm(id) {
  const mapped = deviceById(id);
  if (!mapped || mapped.kind !== "GPU tray") return;
  const fresh = mapped.rdp !== "down";
  mapped.rdp = "down";
  ensureSession(mapped, "rdp", "desktop");
  const kvm = ensureSession(mapped, "acs", "kvm", { rdpFailover: true, screen: "os" });
  if (fresh) {
    audit({
      user: "ACS-A14",
      role: "appliance",
      action: "RDP path lost",
      asset: mapped.name,
      detail: "in-band RDP failed over to MPU KVM port " + mapped.mpu,
    });
  }
  state.view = "sessions";
  state.focusSession = kvm.id;
  state.labOpen = false;
  state.toast = mapped.name + " RDP lost. Failover is ACS KVM, not RM1048.";
  render();
}

export function restoreRdp(id) {
  const mapped = deviceById(id);
  if (!mapped) return;
  mapped.rdp = "up";
  state.sessions.forEach((session) => {
    if (session.deviceId === id && session.type === "kvm") session.rdpFailover = false;
  });
  audit({
    user: "ACS-A14",
    role: "appliance",
    action: "RDP path restored",
    asset: mapped.name,
    detail: "in-band remote desktop returned",
  });
  state.toast = mapped.name + " RDP path restored.";
  render();
}

export function awardCatch(mapped) {
  if (!mapped || !state.game) return "";
  const band = heatBand(mapped);
  if (band === "ok" || state.game.awarded[mapped.id]) return "";
  const points = band === "failover" ? 250 : band === "critical" ? 150 : 80;
  state.game.awarded[mapped.id] = true;
  state.game.streak += 1;
  state.game.catches += 1;
  const bonus = Math.max(0, state.game.streak - 1) * 25;
  state.game.score += points + bonus;
  state.game.best = Math.max(state.game.best, state.game.streak);
  return "+" + (points + bonus) + " thermal catch · streak " + state.game.streak;
}
