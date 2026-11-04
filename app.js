/* Access prototype — P0 flows plus the AI hall floor.
   Sign-in, rack map, ACS and RM1048 serial/KVM, bound outlets, leak, single-master.
   A dark BMC fails over to ACS serial (out of band), not to RM1048.
   Alarms come from automatic ACS serial logins by acs.watch.
   The Lab drawer is simulated gear, not a product screen. */

const SERIAL_FAILOVER_MS = 30000;
const MEDIA = ["ubuntu-24.04-live.iso", "tray-firmware.iso"];
const LEAK = {
  id: "DI-1",
  location: "Rack A14 · cold-plate rope · rear of U38–U40",
  outlets: [1, 2],
};
const USERS = [
  {
    id: "dsvs.admin",
    role: "Administrator",
    note: "Access, Control, virtual media, and the ACS asset tag.",
  },
  {
    id: "dsvs.operator",
    role: "Operator",
    note: "Open consoles and cycle bound outlets. Usual remote-hands identity.",
  },
  {
    id: "colo.readonly",
    role: "ReadOnly",
    note: "Colo read-only. Consoles open. Outlet cycle and virtual media stay closed.",
  },
];
const REFUSED = [
  {
    key: "port-15",
    endpoint: "ttyS15 · port 15",
    kind: "Serial",
    target: "Unbound",
    rack: "—",
    reason: "Port 15 is not bound to a target. Access refused.",
  },
  {
    key: "port-16",
    endpoint: "ttyS16 · port 16",
    kind: "Serial",
    target: "Power shelf",
    rack: "B07",
    reason: "Target is in rack B07. ACS-A14 launches only inside rack A14.",
  },
];

const devices = [
  device("tray-01", "GPU Tray 01", "GPU tray", 40, "tray-01", 1, 1, "Tray-01"),
  device("tray-02", "GPU Tray 02", "GPU tray", 38, "tray-02", 2, 2, "Tray-02"),
  device("tray-03", "GPU Tray 03", "GPU tray", 36, "tray-03", 3, 3, "Tray-03", "USB-1"),
  device("tray-04", "GPU Tray 04", "GPU tray", 34, "tray-04", 6, 7, "Tray-04"),
  device("tray-05", "GPU Tray 05", "GPU tray", 32, "tray-05", 7, 8, "Tray-05"),
  device("tray-06", "GPU Tray 06", "GPU tray", 30, "tray-06", 8, 9, "Tray-06"),
  device("tray-07", "GPU Tray 07", "GPU tray", 28, "tray-07", 9, 10, "Tray-07"),
  device("tray-08", "GPU Tray 08", "GPU tray", 26, "tray-08", 10, 11, "Tray-08"),
  device("sn2201", "SN2201", "Switch", 22, "sn2201", 4, 4, "SN2201"),
  device("pshelf", "DC power shelf", "Power shelf", 6, "pshelf", 5, 5, "PowerShelf"),
];

const ACS_PORTS = 48;
const serialOnly = [];
for (let port = 1; port <= ACS_PORTS; port += 1) {
  if (devices.some((d) => d.port === port)) continue;
  if (REFUSED.some((row) => row.key === "port-" + port)) continue;
  const label = String(port).padStart(2, "0");
  serialOnly.push({
    id: "port-" + port,
    name: "Server " + label,
    kind: "Server",
    u: 0,
    short: "srv-" + label,
    host: "srv-" + label + ".oob.a14.local",
    rack: "A14",
    port: port,
    tty: "ttyS" + port,
    mpu: 0,
    outlet: 0,
    redfishId: "",
    usb: "",
    bmc: "up",
    rdp: "up",
    serialOnly: true,
    bmcLostAt: 0,
    serialReadyAt: 0,
    serialFailoverTotal: SERIAL_FAILOVER_MS,
    serialAnnounced: true,
  });
}

const outlets = [
  { n: 1, deviceId: "tray-01", power: "on" },
  { n: 2, deviceId: "tray-02", power: "on" },
  { n: 3, deviceId: "tray-03", power: "on" },
  { n: 4, deviceId: "sn2201", power: "on" },
  { n: 5, deviceId: "pshelf", power: "on" },
  { n: 6, deviceId: null, power: "on" },
  { n: 7, deviceId: "tray-04", power: "on" },
  { n: 8, deviceId: "tray-05", power: "on" },
  { n: 9, deviceId: "tray-06", power: "on" },
  { n: 10, deviceId: "tray-07", power: "on" },
  { n: 11, deviceId: "tray-08", power: "on" },
];

let serialFailoverMs = SERIAL_FAILOVER_MS;
let seq = 0;
let lastRenderedView = "";

const state = {
  user: null,
  view: "floor",
  selected: "tray-01",
  floor: {
    level: "hall",
    podId: "pod-a",
    rackId: "A14",
    serverId: "",
    rowId: "",
    feedId: "",
    partId: "",
    pitch: 56,
    yaw: -40,
    zoom: 0.78,
    panX: 0,
    panY: 0,
    chassisPitch: 12,
    chassisYaw: -18,
    chassisZoom: 1,
    suppressClick: false,
  },
  game: { score: 0, streak: 0, best: 0, catches: 0, awarded: {} },
  acked: {},
  rm1048: "healthy",
  leak: false,
  maintenance: null,
  maintName: "Rack A14 outlet maintenance",
  maintWo: "WO-10482",
  wo: "",
  assetTag: "ACS-A14",
  assetTagDraft: "ACS-A14",
  sessions: [],
  audit: [],
  fails: {},
  refuseNote: null,
  toast: "",
  labOpen: false,
  focusSession: "",
  focusTerm: "",
  highlightOutlet: 0,
  plan: { maker: "All", selected: "", preview: "", seq: 1, placements: [] },
  horizon: "now",
  manage: { layer: "bmc", device: "tray-01" },
  containment: "hac",
};

function device(id, name, kind, u, shortName, port, outlet, redfishId, usb) {
  return {
    id,
    name,
    kind,
    u,
    short: shortName,
    host: shortName + ".oob.a14.local",
    rack: "A14",
    port,
    tty: "ttyS" + port,
    mpu: port,
    outlet,
    redfishId,
    usb: usb || "",
    bmc: "up",
    rdp: "up",
    bmcLostAt: 0,
    serialReadyAt: 0,
    serialFailoverTotal: SERIAL_FAILOVER_MS,
    serialAnnounced: true,
  };
}

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function deviceById(id) {
  return devices.find((d) => d.id === id) || serialOnly.find((d) => d.id === id);
}

function targetOnPort(port) {
  return devices.find((d) => d.port === port) || serialOnly.find((d) => d.port === port);
}

function outletByN(n) {
  return outlets.find((o) => o.n === Number(n));
}

function sessionById(id) {
  return state.sessions.find((s) => s.id === id);
}

function onLeak(id) {
  return LEAK.outlets.some((n) => outletByN(n).deviceId === id);
}

function uLabel(n) {
  return "U" + String(n).padStart(2, "0");
}

function fmt(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function maintenanceOpen() {
  return !!(state.maintenance && state.maintenance.name);
}

function currentWo() {
  const typed = (state.wo || "").trim();
  if (typed) return typed;
  if (state.maintenance && state.maintenance.wo) return state.maintenance.wo;
  return "";
}

function audit(entry) {
  state.audit.unshift({
    t: Date.now(),
    user: entry.user || "",
    role: entry.role || "",
    action: entry.action || "",
    asset: entry.asset || "",
    outlet: entry.outlet || "",
    wo: entry.wo || "",
    detail: entry.detail || "",
  });
  if (state.audit.length > 300) state.audit.length = 300;
}

function userAudit(action, extra) {
  audit(Object.assign({
    user: state.user.id,
    role: state.user.role,
    action,
    wo: currentWo(),
  }, extra || {}));
}

function waiting(d) {
  return !!(d && d.bmc === "down" && d.serialReadyAt && Date.now() < d.serialReadyAt);
}

function acsWaiting(s) {
  if (!s || s.path !== "acs" || s.type !== "serial") return false;
  return waiting(deviceById(s.deviceId));
}

function sessionBlocked(s) {
  if (!s || s.path !== "rm1048") return false;
  const mapped = deviceById(s.deviceId);
  return state.rm1048 !== "healthy" || !!(mapped && mapped.bmc === "down");
}

function rmBlockCopy(d, type) {
  const label = type === "kvm" ? "KVM" : "Redfish serial";
  if (d.bmc === "down") {
    return "BMC path is dark on " + d.name + ". " + label + " stays on the RM1048 in-band plane. The failover is out-of-band, on ACS.";
  }
  return "RM1048 plane is dark. " + label + " for " + d.name + " is unavailable on that path.";
}

function outletReason(outlet) {
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

function allOutletsReason() {
  if (!state.user) return "Sign in required.";
  if (state.user.role === "ReadOnly") return "ReadOnly cannot cycle outlets.";
  if (!maintenanceOpen()) {
    return "Whole-PDU control stays disabled until a named maintenance window is open. Plant-wide trip is not the policy.";
  }
  return "";
}

function mediaReason() {
  if (state.user && state.user.role === "ReadOnly") {
    return "ReadOnly cannot open write-capable KVM virtual media.";
  }
  return "";
}

function rmSerialUri(d) {
  return "/redfish/v1/Managers/RMC/SerialInterfaces/" + d.redfishId;
}

function rmKvmUri(d) {
  return "/redfish/v1/Managers/RMC/GraphicalConsole/" + d.redfishId;
}

function sessionTitle(s) {
  if (s.type === "desktop") return "In-band · RDP";
  if (s.path === "rm1048" && s.type === "serial") return "RM1048 · Redfish serial";
  if (s.path === "rm1048" && s.type === "kvm") return "RM1048 · KVM";
  if (s.type === "kvm" && s.rdpFailover) return "Path ACS · KVM failover";
  if (s.type === "kvm") return "Path ACS · MPU KVM";
  if (s.medium === "usb") return "Path ACS · USB console";
  return "Path ACS · serial";
}

function sessionLocator(d, s) {
  if (s.type === "desktop") return d.host + " · RDP 3389";
  if (s.path === "rm1048" && s.type === "serial") return rmSerialUri(d);
  if (s.path === "rm1048" && s.type === "kvm") return rmKvmUri(d);
  if (s.type === "kvm") return "MPU port " + d.mpu;
  if (s.medium === "usb") return "USB-1";
  return d.tty + " · port " + d.port;
}

function sessionDetail(d, path, type, medium) {
  if (type === "desktop") return d.host + " · RDP 3389 · in-band";
  if (path === "rm1048" && type === "serial") return rmSerialUri(d);
  if (path === "rm1048" && type === "kvm") return rmKvmUri(d);
  if (type === "kvm") return "MPU port " + d.mpu + " · HTML5 · path ACS";
  if (medium === "usb") return "USB-1 · path ACS";
  return d.tty + " · port " + d.port + " · path ACS";
}

function sessionNote(d, s) {
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
    if (d.serialOnly) return "Already logged in on " + d.name + ". This port is that server's console.";
    if (d.bmc === "down") return "Already logged in. Out-of-band serial on ACS. The BMC failed over to this port, not to RM1048.";
    return "Already logged in on " + d.name + ". Video stays on the MPU KVM path.";
  }
  if (d.bmc === "down") return "RM1048 is the in-band plane. It does not take the BMC failover.";
  return "This path is the RM1048 in-band plane.";
}

function chromeLines(d, s) {
  const lines = [];
  if (s.path === "rm1048") {
    lines.push("RM1048 · Redfish serial");
    lines.push("URI " + rmSerialUri(d));
    lines.push("Device " + d.name);
    lines.push("Plane healthy.");
    lines.push("Last login: " + (state.user ? state.user.id : "operator") + " on this Redfish serial interface.");
    lines.push("");
    return lines;
  }
  if (s.medium === "usb") {
    lines.push("ACS 8000 · USB console · USB-1");
    lines.push("Path ACS · USB · OOB wire");
  } else {
    lines.push("ACS 8000 · " + d.tty + " · port " + d.port);
    lines.push("Path ACS · RS-232 · OOB wire");
  }
  lines.push("Host " + d.host);
  lines.push("Device " + d.name);
  if (d.serialOnly) {
    lines.push("Serial port " + d.port + " of " + ACS_PORTS + ".");
  } else {
    lines.push("Serial stays on ACS. Video stays on MPU.");
  }
  if (d.watch && d.watch.login === "reject") {
    lines.push("acs.watch was denied a shell on this port.");
  } else if (d.watch && d.watch.login === "wait") {
    lines.push("acs.watch is still waiting for this port.");
  } else if (d.watch && d.watch.pri) {
    lines.push(d.watch.text);
  }
  if (!d.serialOnly && d.bmc === "down") {
    lines.push("Out-of-band failover on ACS.");
    lines.push("BMC path is dark. Management moved to this ACS port, not to RM1048.");
    lines.push("Serial failover met the 30 second target.");
  } else if (!d.serialOnly) {
    lines.push("BMC path is up. This ACS session is the out-of-band wire.");
    if (state.rm1048 === "healthy") lines.push("RM1048 is the in-band plane while the BMC is up.");
  }
  lines.push("Last login: " + (state.user ? state.user.id : "operator") + " on " + d.tty + ".");
  lines.push("");
  return lines;
}

function hydrateSerial(s) {
  if (!s || s.type !== "serial" || s.lines) return;
  if (sessionBlocked(s) || acsWaiting(s)) return;
  s.lines = chromeLines(deviceById(s.deviceId), s);
  s.stage = "shell";
}

function serialPrompt(d, s) {
  if (s.stage === "shell") return d.short + ":~$";
  return d.short + " login:";
}

function bmcText(d) {
  if (d.bmc === "up") return "Up";
  if (waiting(d)) return "Dark · failing over to ACS";
  return "Dark · on ACS";
}

function assertWorld() {
  devices.forEach((d) => {
    const outlet = outlets.find((o) => o.n === d.outlet);
    if (!outlet || outlet.deviceId !== d.id) throw new Error("Outlet map does not match " + d.id);
    if (d.rack !== "A14") throw new Error("ACS domain must be rack A14");
  });
  if (outlets.filter((o) => !o.deviceId).length !== 1) throw new Error("Expected one unbound outlet");
}

function signIn(id) {
  const user = USERS.find((u) => u.id === id);
  if (!user) return;
  state.user = user;
    state.view = "floor";
  state.floor.level = "site";
  state.floor.zoom = 0.72;
  state.floor.panX = 0;
  state.floor.panY = 0;
  state.floor.pitch = 56;
  state.floor.yaw = -40;
  state.floor.serverId = "";
  state.floor.rowId = "";
  state.floor.feedId = "";
  state.floor.partId = "";
  state.selected = state.selected || "tray-01";
  userAudit("sign in", { detail: "DSVS identity", wo: "" });
  render();
}

function signOut() {
  if (state.user) userAudit("sign out", { wo: "" });
  state.user = null;
  state.sessions = [];
  state.view = "rack";
  state.labOpen = false;
  state.toast = "";
  state.fails = {};
  state.focusSession = "";
  state.focusTerm = "";
  render();
}

function go(view) {
  state.view = view;
  state.toast = "";
  render();
}

function selectDevice(id) {
  state.selected = id;
  state.view = "rack";
  render();
}

function showOutlet(n) {
  state.view = "control";
  state.highlightOutlet = Number(n);
  state.toast = "";
  render();
}

function openSession(deviceId, path, type, medium) {
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
  const id = "s" + (++seq);
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

function fallback(deviceId, type) {
  state.sessions = state.sessions.filter((s) => !(s.deviceId === deviceId && s.path === "rm1048" && s.type === type));
  delete state.fails[deviceId + ":" + type];
  openSession(deviceId, "acs", type, type === "serial" ? "rs232" : "");
}

function closeSession(id) {
  const session = sessionById(id);
  if (!session) return;
  const mapped = deviceById(session.deviceId);
  state.sessions = state.sessions.filter((s) => s.id !== id);
  userAudit("session close", {
    asset: mapped.name,
    detail: sessionDetail(mapped, session.path, session.type, session.medium),
    wo: "",
  });
  render();
}

function refuseEndpoint(key) {
  const row = REFUSED.find((r) => r.key === key);
  if (!row) return;
  state.refuseNote = { key, text: row.reason };
  state.view = "map";
  state.toast = row.reason;
  userAudit("session refused", { asset: row.target, detail: row.reason, wo: "" });
  render();
}

function sendSerial(id, raw) {
  const session = sessionById(id);
  if (!session || session.type !== "serial") return;
  if (sessionBlocked(session) || acsWaiting(session)) return;
  hydrateSerial(session);
  const mapped = deviceById(session.deviceId);
  const text = String(raw || "");
  session.stage = "shell";
  session.lines.push(serialPrompt(mapped, session) + (text ? " " + text : ""));
  shellReply(mapped, text).forEach((line) => session.lines.push(line));
  if (session.lines.length > 80) session.lines.splice(0, session.lines.length - 80);
  state.focusTerm = id;
  render();
}

function shellReply(d, text) {
  if (!text) return [];
  if (text === "help") return ["hostname", "whoami", "uptime"];
  if (text === "hostname") return [d.host];
  if (text === "whoami") return [state.user ? state.user.id : "operator"];
  if (text === "uptime") return ["serial console up on " + d.tty + ", port " + d.port + " of " + ACS_PORTS];
  return [text + ": command not found"];
}

function setScreen(id, screen) {
  const session = sessionById(id);
  if (!session) return;
  session.screen = screen === "os" ? "os" : "bios";
  render();
}

function toggleMedia(id) {
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

function actOutlet(n, op, source) {
  const outlet = outletByN(n);
  if (!outlet) return;
  const reason = outletReason(outlet);
  if (reason) {
    state.toast = reason;
    render();
    return;
  }
  const asset = outlet.deviceId ? deviceById(outlet.deviceId).name : "Unbound";
  if (op === "cycle") {
    outlet.power = "cycling";
    setTimeout(() => {
      if (outlet.power === "cycling") {
        outlet.power = "on";
        if (state.user) render();
      }
    }, 800);
  } else {
    outlet.power = op === "on" ? "on" : "off";
  }
  userAudit("outlet " + op, {
    asset,
    outlet: "Outlet " + n,
    detail: source ? "Suggested by " + source + " leak policy" : "",
  });
  const verb = op === "on" ? "On" : op === "off" ? "Off" : "Cycle";
  state.toast = verb + " Outlet " + n + " · " + asset;
  state.view = "control";
  render();
}

function actAll() {
  const reason = allOutletsReason();
  if (reason) {
    state.toast = reason;
    render();
    return;
  }
  const name = state.maintenance.name;
  if (!window.confirm("Cycle every outlet on rack PDU A14, including unbound outlets? Window: " + name)) return;
  outlets.forEach((outlet) => {
    outlet.power = "cycling";
    const asset = outlet.deviceId ? deviceById(outlet.deviceId).name : "Unbound";
    userAudit("outlet cycle", {
      asset,
      outlet: "Outlet " + outlet.n,
      detail: "Whole-PDU cycle under maintenance window " + name,
    });
  });
  state.toast = "Cycling every outlet under the maintenance window.";
  render();
  setTimeout(() => {
    let changed = false;
    outlets.forEach((outlet) => {
      if (outlet.power === "cycling") {
        outlet.power = "on";
        changed = true;
      }
    });
    if (changed && state.user) render();
  }, 800);
}

function loseBmc(mapped, navigate) {
  if (!mapped || mapped.bmc === "down") return;
  mapped.bmc = "down";
  mapped.bmcLostAt = Date.now();
  mapped.serialReadyAt = Date.now() + serialFailoverMs;
  mapped.serialFailoverTotal = serialFailoverMs;
  mapped.serialAnnounced = false;
  state.sessions.forEach((s) => {
    if (s.deviceId !== mapped.id) return;
    if (s.path === "acs" && s.type === "serial") {
      s.lines = null;
      s.stage = "login";
    }
    if (s.path === "acs" && s.type === "kvm") s.screen = "bios";
  });
  if (navigate) {
    state.selected = mapped.id;
    state.view = "rack";
    state.labOpen = false;
  } else if (state.view === "floor") {
    state.floor.level = "server";
    state.floor.podId = "pod-a";
    state.floor.rackId = "A14";
    state.floor.serverId = mapped.id;
  }
  audit({
    user: "ACS-A14",
    role: "appliance",
    action: "BMC path lost",
    asset: mapped.name,
    detail: mapped.tty + " out-of-band failover to ACS started",
  });
  state.toast = mapped.name + " BMC path lost. Failover is ACS serial, not RM1048.";
  if (state.user) render();
}

function toggleBmc(id) {
  const mapped = deviceById(id);
  if (!mapped) return;
  if (mapped.bmc === "up") {
    loseBmc(mapped, true);
    return;
  }
  mapped.bmc = "up";
  mapped.serialReadyAt = 0;
  mapped.serialAnnounced = true;
delete state.fails[id + ":serial"];
    delete state.fails[id + ":kvm"];
    if (state.game) delete state.game.awarded[id];
    if (mapped.load) mapped.load.failover = false;
  audit({
    user: "ACS-A14",
    role: "appliance",
    action: "BMC path restored",
    asset: mapped.name,
    detail: mapped.tty + " returned to the in-band plane",
  });
  state.toast = mapped.name + " BMC path restored.";
  render();
}

function toggleRm() {
  state.rm1048 = state.rm1048 === "healthy" ? "dark" : "healthy";
  if (state.rm1048 === "healthy") state.fails = {};
  audit({
    user: "RM1048",
    role: "plane",
    action: state.rm1048 === "healthy" ? "plane healthy" : "plane dark",
    detail: state.rm1048 === "healthy" ? "ACS yields outlet Control." : "ACS may cycle bound outlets.",
  });
  state.toast = state.rm1048 === "healthy"
    ? "RM1048 plane is healthy. ACS yields outlet Control."
    : "RM1048 plane is dark. ACS can cycle bound outlets.";
  render();
}

function toggleLeak() {
  state.leak = !state.leak;
  if (state.leak) {
    audit({
      user: "ACS-A14",
      role: "appliance",
      action: "DI-1 alarm",
      asset: LEAK.location,
      outlet: "Outlet 1, Outlet 2",
      detail: "Bound control only. Plant-wide trip is not the policy.",
    });
    state.view = "control";
    state.labOpen = false;
    state.toast = "DI-1 alarm. Suggested control is Outlet 1 and Outlet 2.";
  } else {
    audit({
      user: "ACS-A14",
      role: "appliance",
      action: "DI-1 clear",
      asset: LEAK.location,
    });
    state.toast = "DI-1 is quiet.";
  }
  render();
}

function toggleMaint() {
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

function saveAsset() {
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

function resetWorld() {
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

function wordmark() {
  return '<div class="wordmark"><div class="v-name">VERTIV</div><div class="v-rule"></div><div class="v-sub">Avocent</div></div>';
}

function pills() {
  const rmClass = state.rm1048 === "healthy" ? "ok" : "warn";
  const rmLabel = state.rm1048 === "healthy" ? "healthy" : "dark";
  const oob = devices.some((d) => d.bmc === "down")
    ? '<span class="pill warn">Failover <b>ACS</b></span>'
    : "";
  const rdpLost = devices.some((d) => d.rdp === "down")
    ? '<span class="pill warn">RDP <b>KVM</b></span>'
    : "";
  const leakClass = state.leak ? "bad" : "ok";
  const leakLabel = state.leak ? "alarm" : "quiet";
  const maintClass = maintenanceOpen() ? "warn" : "";
  const maintLabel = maintenanceOpen() ? "open" : "closed";
  return '<div class="pills">' +
    '<span class="pill ' + rmClass + '">RM1048 <b>' + rmLabel + "</b></span>" +
    '<span class="pill ' + leakClass + '">DI-1 <b>' + leakLabel + "</b></span>" +
    '<span class="pill ' + maintClass + '">Maintenance <b>' + maintLabel + "</b></span>" +
    '<span class="pill">Domain <b>rack A14</b></span>' + oob + rdpLost + "</div>";
}

function toastHtml() {
  if (!state.toast) return "";
  return '<div class="toast" role="status"><span>' + esc(state.toast) + '</span><button type="button" data-act="dismiss-toast">Dismiss</button></div>';
}

function navButton(id, label, sub) {
  const current = state.view === id ? ' aria-current="page"' : "";
  return '<button type="button" data-act="nav" data-view="' + id + '"' + current + ">" +
    esc(label) + "<small>" + esc(sub) + "</small></button>";
}

function rail() {
  const sessionSub = state.sessions.length ? state.sessions.length + " open" : "Open consoles";
  const leak = state.leak ? '<p class="alarm-note">DI-1 leak alarm</p>' : "";
  return '<header class="rail">' +
    wordmark() +
    '<div class="product-name">Access</div>' +
    '<p class="rack-id">DSVS · ACS 8000 · MPU<br>Rack A14 only</p>' +
    "<nav>" +
    navButton("floor", "Overview", "Outside and hall") +
    navButton("manage", "Manage", "Grid to chip") +
    navButton("rack", "Rack", "Level 2 · devices") +
    navButton("map", "Port map", "48 serial ports") +
    navButton("control", "Control", "Level 3 · outlets") +
    navButton("sessions", "Sessions", "Level 3 · " + sessionSub) +
    navButton("audit", "Audit", "Level 4 · log") +
    "</nav>" +
    '<div class="rail-foot">' + leak +
    '<button type="button" class="lab-open" data-act="lab-open">Lab<small>Simulated world</small></button>' +
    '<div class="who"><strong>' + esc(state.user.id) + "</strong><span>" + esc(state.user.role) +
    '</span><button type="button" class="act" data-act="signout">Sign out</button></div></div></header>';
}

function fruSummary(editable) {
  const tag = editable && state.user.role === "Administrator"
    ? '<dd class="tag"><input id="asset-tag" data-focus-key="asset-tag" maxlength="32" value="' + esc(state.assetTagDraft) +
      '"><button type="button" class="act" data-act="asset">Save</button></dd>'
    : "<dd>" + esc(state.assetTag) + "</dd>";
  return '<dl class="fru"><dt>Manufacturer</dt><dd>Vertiv</dd><dt>Model</dt><dd>Avocent ACS 8000</dd>' +
    '<dt>Serial</dt><dd class="mono">ACS8K-A14-00481</dd><dt>Asset tag</dt>' + tag +
    "<dt>Domain</dt><dd>Rack A14 · one ACS</dd>" +
    "<dt>Serial ports</dt><dd>" + ACS_PORTS + " · each opens a logged-in server console</dd></dl>";
}

function failBox(deviceId, type) {
  const mapped = deviceById(deviceId);
  if (!mapped || mapped.bmc === "down" || !state.fails[deviceId + ":" + type]) return "";
  return '<div class="fail" role="status"><p>' + esc(rmBlockCopy(mapped, type)) +
    '</p><button type="button" class="act primary" data-act="fallback" data-device="' +
    mapped.id + '" data-type="' + type + '">Open on ACS</button></div>';
}

function failoverBanner(d) {
  if (d.bmc !== "down") return "";
  const lead = waiting(d)
    ? "BMC path lost. Out-of-band serial is coming up on ACS."
    : "BMC path is dark. Out-of-band management is on ACS.";
  return '<div class="status hold" role="status"><p>' + esc(lead) + " RM1048 does not take this failover.</p>" +
    '<div class="actions"><button type="button" class="act primary" data-act="fallback" data-device="' + d.id +
    '" data-type="serial">Open serial on ACS</button><button type="button" class="act primary" data-act="fallback" data-device="' +
    d.id + '" data-type="kvm">Open KVM on ACS</button></div></div>';
}

function countdownBlock(d, lead) {
  const total = d.serialFailoverTotal || serialFailoverMs;
  const leftMs = Math.max(0, d.serialReadyAt - Date.now());
  const pct = Math.min(100, ((total - leftMs) / total) * 100);
  return '<div class="wait" data-countdown-for="' + d.id + '"><p>' + esc(lead) + '</p><p class="wait-num"><span data-countdown-num>' +
    Math.ceil(leftMs / 1000) + '</span>s</p><div class="meter" aria-hidden="true"><span data-countdown-bar style="width:' +
    pct.toFixed(1) + '%"></span></div><p class="fine">Target is within ' + Math.round(total / 1000) +
    " seconds of path loss.</p></div>";
}

function launcher(d, path, type, label, caption, medium, extraClass) {
  return '<button type="button" class="act launch' + (extraClass ? " " + extraClass : "") + '" data-act="launch" data-device="' + d.id + '" data-path="' + path +
    '" data-type="' + type + '" data-medium="' + (medium || "") + '"><strong>' + esc(label) + "</strong><small>" +
    esc(caption) + "</small></button>";
}

function thermalReading(entity) {
  const load = (entity && entity.load) || { temp: 48, power: 40 };
  const hac = state.containment !== "cac";
  const u = entity && entity.u ? entity.u : 20;
  const top = u >= 36 ? (hac ? 1.1 : 2.6) : (u >= 28 ? 0.5 : 0.2);
  const loadRise = Math.max(0, (load.temp || 48) - 52) * (hac ? 0.08 : 0.18);
  const inlet = 20.5 + top + loadRise;
  const exhaust = inlet + 11 + (load.power || 40) * 0.06;
  const ret = hac ? Math.min(39, Math.max(35, 34 + (load.power || 40) * 0.04)) : (24 + (exhaust - inlet) * 0.35);
  let envelope = "In the 21–24 °C inlet band";
  let pri = 0;
  if (inlet > 27) {
    envelope = "Above the ASHRAE recommended inlet range";
    pri = 2;
  } else if (inlet > 24) {
    envelope = "Above the study inlet band, still under 27 °C";
    pri = 3;
  }
  return {
    supply: 20.5,
    inlet: inlet,
    exhaust: exhaust,
    ret: ret,
    hac: hac,
    envelope: envelope,
    pri: pri,
    recirculation: !hac && u >= 36,
  };
}

function containSwitch() {
  const hac = state.containment !== "cac";
  return '<div class="horizon" role="group" aria-label="Containment"><button type="button" data-act="contain" data-mode="hac"' +
    (hac ? ' aria-pressed="true"' : "") + '>Hot aisle containment</button><button type="button" data-act="contain" data-mode="cac"' +
    (hac ? "" : ' aria-pressed="true"') + ">Cold aisle containment</button></div>";
}

function thermalCard(entity) {
  const t = thermalReading(entity);
  const mark = t.pri ? '<b class="pri-mark pri-' + t.pri + '">' + t.pri + "</b> " : "";
  const mode = t.hac
    ? "Hot aisle containment. Exhaust is captured and returned near " + t.ret.toFixed(0) + " °C. The room outside the hood stays the cold aisle."
    : "Cold aisle containment. Supply is enclosed at the intake. Exhaust spills into the hall, and the top U can recirculate.";
  return '<div class="thermal-card"><div class="thermal-read">' +
    '<div><b>' + t.supply.toFixed(1) + ' °C</b><span>Supply</span></div>' +
    '<div><b>' + t.inlet.toFixed(1) + ' °C</b><span>Rack inlet</span></div>' +
    '<div><b>' + t.exhaust.toFixed(1) + ' °C</b><span>Rear exhaust</span></div>' +
    '<div><b>' + t.ret.toFixed(1) + ' °C</b><span>' + (t.hac ? "Return" : "Room") + "</span></div></div>" +
    "<p>" + mark + esc(t.envelope) + "</p><p class=\"fine\">" + mode +
    (t.recirculation ? " This U is high in the rack, where cold-aisle containment showed recirculation." : "") +
    ' Targets follow the <a href="https://www.linkedin.com/pulse/optimizing-thermal-performance-data-centers-analysis-hot-bhushan-vwrqf">HAC and CAC comparison</a>: supply 20.5 °C, HAC return about 37 °C, CAC inlets 21–24 °C.</p></div>';
}

function faceplate(entity, pressed, act) {
  const tone = conditionTone(entity);
  const kind = entity.kind === "Switch" ? "net" : (entity.kind === "Power shelf" || entity.kind === "Powershelf" ? "shelf" : "gpu");
  const bmc = entity.bmc === "down" ? " dark" : "";
  const action = act || "select";
  return '<button type="button" class="face ' + kind + bmc + (pressed ? " on" : "") + '" data-act="' + action + '" data-device="' +
    entity.id + '" data-server="' + entity.id + '"' + (pressed ? ' aria-pressed="true"' : "") + '><i class="u-tick">' + (entity.u ? entity.u : "") +
    '</i><span class="perf" aria-hidden="true"></span><span class="face-name">' + esc(entity.short || entity.name) +
    '</span><i class="bay-led" style="background:' + tone.color + '"></i></button>';
}

function cabinetHtml(list) {
  const rows = list.slice().sort((a, b) => (b.u || 0) - (a.u || 0));
  return '<div class="cabinet" aria-label="Rack A14 front, cold aisle"><div class="cab-rail" aria-hidden="true"></div><div class="cab-bay">' +
    rows.map((entity) => faceplate(entity, state.selected === entity.id)).join("") +
    '</div><div class="cab-rail" aria-hidden="true"></div></div>';
}

function deviceFaces(d) {
  const t = thermalReading(d);
  return '<div class="device-faces"><figure class="server-face"><figcaption>Front · cold aisle intake</figcaption><div class="bezel front"><span class="perf tall"></span><span class="bezel-meta"><b>' +
    esc(d.short || d.name) + '</b><span>Intake</span></span><i class="bay-led" style="background:' +
    (d.bmc === "down" ? "#8a3030" : "#1f6b45") + '"></i></div><p class="fine">Servers pull ' + t.supply.toFixed(1) +
    " °C supply. Inlet here is " + t.inlet.toFixed(1) + ' °C.</p></figure><figure class="server-face"><figcaption>Rear · hot aisle exhaust</figcaption><div class="bezel rear"><span class="psu"></span><span class="psu"></span><span class="nic"></span><span class="exhaust"></span></div><p class="fine">Exhaust leaves at ' +
    t.exhaust.toFixed(0) + " °C" + (t.hac ? " into the contained hot aisle." : " into the open hall.") + "</p></figure></div>";
}

function deviceDetail(d) {
  const outlet = outletByN(d.outlet);
  const leak = onLeak(d.id) ? "On the DI-1 rope" : "Not on the DI-1 rope";
  const failover = d.bmc === "down";
  const rmSerialCap = failover ? "BMC dark · use ACS" : (state.rm1048 === "healthy" ? "SerialInterfaces/" + d.redfishId : "Plane dark");
  const rmKvmCap = failover ? "BMC dark · use ACS" : (state.rm1048 === "healthy" ? "Graphical console" : "Plane dark");
  const acsClass = failover ? "primary" : "";
  const rmClass = failover || state.rm1048 !== "healthy" ? "held" : "";
  const usb = d.usb
    ? launcher(d, "acs", "serial", "USB console", d.usb + " · OOB", "usb", acsClass)
    : "";
  const wait = waiting(d)
    ? countdownBlock(d, "BMC path lost. Out-of-band serial is coming up on ACS " + d.tty + ".")
    : (failover ? '<p class="fine">Out-of-band serial is up on ACS ' + esc(d.tty) + ".</p>" : "");
  const facts = "<dl><dt>Kind</dt><dd>" + esc(d.kind) + "</dd><dt>Location</dt><dd>" + uLabel(d.u) +
    " · rack A14</dd><dt>BMC</dt><dd>" + esc(bmcText(d)) + "</dd><dt>Serial</dt><dd class=\"mono\">" +
    esc(d.tty) + " · port " + d.port + "</dd>" +
    (d.usb ? '<dt>USB console</dt><dd class="mono">' + esc(d.usb) + "</dd>" : "") +
    '<dt>KVM</dt><dd class="mono">MPU port ' + d.mpu + "</dd><dt>Outlet</dt><dd>Outlet " + d.outlet +
    " · " + esc(outlet.power) + "</dd><dt>Leak</dt><dd>" + esc(leak) + "</dd></dl>";
  return deviceFaces(d) + thermalCard(d) + "<h3>" + esc(d.name) + "</h3><p class=\"fine\">" + esc(d.kind) + " · " + uLabel(d.u) +
    "</p>" + failoverBanner(d) + '<div class="launch-grid">' +
    launcher(d, "acs", "serial", "ACS serial", d.tty + " · port " + d.port + " · out of band", "rs232", acsClass) +
    launcher(d, "acs", "kvm", "ACS KVM", "MPU port " + d.mpu + " · HTML5", "", acsClass) +
    launcher(d, "rm1048", "serial", "RM1048 serial", rmSerialCap, "", rmClass) +
    launcher(d, "rm1048", "kvm", "RM1048 KVM", rmKvmCap, "", rmClass) +
    "</div>" + usb + rdpLauncher(d) + failBox(d.id, "serial") + failBox(d.id, "kvm") + facts + wait +
    '<p class="fine">Unbound and cross-rack launches are refused on the port map.</p>' +
    '<button type="button" class="act" data-act="nav" data-view="map">Open the port map</button>';
}

function elevation() {
  return cabinetHtml(devices.filter((item) => item.u));
}

function renderRack() {
  const d = deviceById(state.selected);
  return '<div class="page-head"><div class="top"><div><h1>Rack A14</h1>' +
    "<p class=\"sub\">Front faces the cold aisle. Rear exhausts into the hot aisle. Inlet temperature is the reading that has to stay in band.</p></div></div>" +
    pills() + "</div>" + containSwitch() +
    '<div class="rack-wrap"><section class="panel"><h2>Cold aisle front</h2><div class="elevation">' + elevation() +
    '</div></section><section class="panel"><h2>Device</h2><div class="detail">' +
    (d ? deviceDetail(d) : '<p class="empty">Select a device.</p>') +
    '</div></section></div><section class="panel"><h2>ACS FRU</h2>' + fruSummary(false) + "</section>";
}

function mapButton(button) {
  if (button.type === "refuse") {
    return '<button type="button" class="act" data-act="refuse" data-key="' + esc(button.key) + '">Launch</button>';
  }
  if (button.type === "nav") {
    return '<button type="button" class="act" data-act="nav" data-view="' + button.view + '">' + esc(button.label) + "</button>";
  }
  if (button.type === "show-outlet") {
    return '<button type="button" class="act" data-act="show-outlet" data-outlet="' + button.outlet + '">' + esc(button.label) + "</button>";
  }
  return '<button type="button" class="act" data-act="launch" data-device="' + button.device + '" data-path="' +
    button.path + '" data-type="' + button.sessionType + '" data-medium="' + (button.medium || "") + '">' +
    esc(button.label) + "</button>";
}

function mapRows() {
  const rows = [];
  devices.forEach((d) => {
    rows.push({
      key: "tty-" + d.id,
      endpoint: d.tty + " · port " + d.port,
      kind: "Serial",
      target: d.name,
      rack: "A14",
      bind: "Bound",
      button: { type: "launch", device: d.id, path: "acs", sessionType: "serial", medium: "rs232", label: "ACS serial" },
    });
    if (d.usb) {
      rows.push({
        key: "usb-" + d.id,
        endpoint: d.usb,
        kind: "USB console",
        target: d.name,
        rack: "A14",
        bind: "Bound",
        button: { type: "launch", device: d.id, path: "acs", sessionType: "serial", medium: "usb", label: "USB console" },
      });
    }
    rows.push({
      key: "mpu-" + d.id,
      endpoint: "MPU " + d.mpu,
      kind: "KVM",
      target: d.name,
      rack: "A14",
      bind: "Bound",
      button: { type: "launch", device: d.id, path: "acs", sessionType: "kvm", medium: "", label: "ACS KVM" },
    });
  });
  rows.push({
    key: "di-1",
    endpoint: "DI-1",
    kind: "Digital input",
    target: LEAK.location,
    rack: "A14",
    bind: "Outlets 1 and 2",
    button: { type: "nav", view: "control", label: "Leak policy" },
  });
  outlets.forEach((o) => {
    const d = o.deviceId ? deviceById(o.deviceId) : null;
    const leak = LEAK.outlets.indexOf(o.n) !== -1;
    rows.push({
      key: "out-" + o.n,
      endpoint: "Outlet " + o.n,
      kind: "Outlet",
      target: d ? d.name : "Unbound",
      rack: d ? "A14" : "—",
      bind: d ? (leak ? "Bound · DI-1 policy" : "Bound") : "Unbound",
      button: { type: "show-outlet", outlet: o.n, label: "Control" },
    });
  });
  REFUSED.forEach((r) => {
    rows.push({
      key: r.key,
      endpoint: r.endpoint,
      kind: r.kind,
      target: r.target,
      rack: r.rack,
      bind: "Refused",
      refused: true,
      button: { type: "refuse", key: r.key, label: "Launch" },
    });
  });
  return rows;
}

function mapTable() {
  const body = mapRows().map((row) => {
    const note = state.refuseNote && state.refuseNote.key === row.key
      ? '<tr class="refuse-note"><td colspan="6">' + esc(state.refuseNote.text) + "</td></tr>"
      : "";
    const bindClass = row.refused ? "bind-refused" : "";
    return '<tr class="' + (row.refused ? "refused" : "") + '"><td class="mono">' + esc(row.endpoint) +
      "</td><td>" + esc(row.kind) + "</td><td>" + esc(row.target) + "</td><td>" + esc(row.rack) +
      '</td><td class="' + bindClass + '">' + esc(row.bind) + "</td><td>" + mapButton(row.button) +
      "</td></tr>" + note;
  }).join("");
  return "<table><thead><tr><th>Endpoint</th><th>Kind</th><th>Target</th><th>Rack</th><th>Binding</th><th></th></tr></thead><tbody>" +
    body + "</tbody></table>";
}

function portCell(port) {
  const refused = REFUSED.find((row) => row.key === "port-" + port);
  if (refused) {
    const why = port === 15 ? "Unbound" : "Other rack";
    return '<button type="button" class="port-cell refused" data-act="refuse" data-key="' + esc(refused.key) +
      '"><span class="port-num">Port ' + port + '</span><span class="port-name">' + esc(refused.target) +
      '</span><span class="port-meta">' + why + "</span></button>";
  }
  const target = targetOnPort(port);
  const meta = target.serialOnly ? "Serial server" : "In the rack";
  return '<button type="button" class="port-cell' + (target.serialOnly ? "" : " managed") +
    '" data-act="launch" data-device="' + esc(target.id) +
    '" data-path="acs" data-type="serial" data-medium="rs232"><span class="port-num">Port ' + port +
    '</span><span class="port-name">' + esc(target.name) + '</span><span class="port-meta">' + meta + "</span></button>";
}

function portGrid() {
  let html = "";
  for (let port = 1; port <= ACS_PORTS; port += 1) html += portCell(port);
  return '<div class="port-grid">' + html + "</div>";
}

function renderMap() {
  const ready = ACS_PORTS - REFUSED.length;
  return '<div class="page-head"><div class="top"><div><h1>Port map</h1>' +
    "<p class=\"sub\">ACS 8000 has " + ACS_PORTS + " serial ports. " + ready +
    " of them reach a server in rack A14. Open a port and the console is already logged in.</p></div></div>" +
    pills() + '</div><section class="panel"><h2>48 serial ports</h2><p class="fine port-lead">One server per port. A cell marked “In the rack” is one of the named trays, the switch, or the power shelf. The rest are serial servers on the same ACS. Port 15 is unbound. Port 16 is in rack B07, so ACS-A14 will not open it.</p>' +
    portGrid() + '</section><section class="panel"><h2>FRU</h2>' + fruSummary(true) +
    '</section><section class="panel"><h2>Bindings</h2><div class="table-wrap">' + mapTable() + "</div></section>";
}

function controlStatus() {
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

function outletActions(o) {
  const reason = outletReason(o);
  const dis = reason ? " disabled" : "";
  const title = reason ? ' title="' + esc(reason) + '"' : "";
  return '<div class="row-actions">' +
    '<button type="button" class="act" data-act="outlet" data-outlet="' + o.n + '" data-op="on"' + dis + title + ">On</button>" +
    '<button type="button" class="act" data-act="outlet" data-outlet="' + o.n + '" data-op="off"' + dis + title + ">Off</button>" +
    '<button type="button" class="act primary" data-act="outlet" data-outlet="' + o.n + '" data-op="cycle"' + dis + title + ">Cycle</button>" +
    "</div>";
}

function leakNames() {
  return LEAK.outlets.map((n) => "Outlet " + n + " (" + deviceById(outletByN(n).deviceId).name + ")").join(" and ");
}

function leakCard() {
  const names = leakNames();
  if (!state.leak) {
    return '<section class="policy"><h2>DI-1 leak policy</h2><p>Location: ' + esc(LEAK.location) +
      ".</p><p>Bound Control: " + esc(names) + ". Plant-wide trip is not the policy.</p>" +
      '<p class="fine">DI-1 is quiet. Trip it from the Lab to raise the alarm.</p></section>';
  }
  const sample = outletReason(outletByN(LEAK.outlets[0]));
  const shed = LEAK.outlets.map((n) => {
    const reason = outletReason(outletByN(n));
    const dis = reason ? " disabled" : "";
    const title = reason ? ' title="' + esc(reason) + '"' : "";
    return '<button type="button" class="act danger" data-act="outlet" data-outlet="' + n +
      '" data-op="off" data-source="DI-1"' + dis + title + ">Shed Outlet " + n + "</button>";
  }).join("");
  return '<section class="alarm" role="status"><h2>DI-1 leak alarm</h2><p>Location: ' + esc(LEAK.location) +
    ".</p><p>Suggested Control: " + esc(names) + ' only.</p><div class="actions">' + shed + "</div>" +
    (sample ? '<p class="reason">' + esc(sample) + "</p>" : "") + "</section>";
}

function renderControl() {
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
    '<label class="field">Work order on the next act (optional)<input id="wo-field" data-focus-key="wo-field" value="' +
    esc(state.wo) + '" placeholder="' + esc(placeholder) + '"></label>' +
    '<p class="fine">Leave blank to use the maintenance work order while a window is open.</p>';
}

function powerBadge(power) {
  const cls = power === "off" ? "bad" : power === "cycling" ? "warn" : "ok";
  const label = power === "cycling" ? "Cycling" : power === "off" ? "Off" : "On";
  return '<span class="badge ' + cls + '">' + label + "</span>";
}

function mediaControls(s) {
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

function rdpLauncher(d) {
  if (d.kind !== "GPU tray") return "";
  if (d.rdp === "down") {
    return '<button type="button" class="act launch primary" data-act="rdp-failover" data-device="' + d.id +
      '"><strong>KVM failover</strong><small>RDP lost · MPU port ' + d.mpu + "</small></button>";
  }
  return launcher(d, "rdp", "desktop", "RDP", d.host + " · in-band", "");
}

function ensureSession(mapped, path, type, extra) {
  let session = state.sessions.find((s) => s.deviceId === mapped.id && s.path === path && s.type === type);
  if (!session) {
    session = {
      id: "s" + (++seq),
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

function failRdpToKvm(id) {
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

function restoreRdp(id) {
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

function rdpDesk(d, dead) {
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

function kvmBody(d, s) {
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

function serialBody(d, s) {
  hydrateSerial(s);
  const lines = s.lines || [];
  return '<div class="term">' + lines.map((line) => "<div>" + esc(line) + "</div>").join("") +
    '<form data-act="serial-line" data-session="' + s.id + '"><span class="prompt">' + esc(serialPrompt(d, s)) +
    '</span><input class="term-in" name="line" data-session-input="' + s.id + '" data-focus-key="term-' + s.id +
    '" id="term-' + s.id + '" autocomplete="off" spellcheck="false" aria-label="Console input for ' + esc(d.name) +
    '"></form></div>';
}

function sessionCard(s) {
  const d = deviceById(s.deviceId);
  const blocked = sessionBlocked(s);
  const hold = !blocked && acsWaiting(s);
  let body;
  if (blocked) {
    body = '<div class="fail" role="status"><p>' + esc(rmBlockCopy(d, s.type)) +
      '</p><button type="button" class="act primary" data-act="fallback" data-device="' +
      d.id + '" data-type="' + s.type + '">Open on ACS</button></div>';
  } else if (hold) {
    const where = s.medium === "usb" ? "USB-1" : d.tty + " · port " + d.port;
    body = countdownBlock(d, "BMC path lost. Out-of-band serial is coming up on ACS " + where + ".");
  } else if (s.type === "desktop") {
    body = rdpDesk(d, d.rdp === "down");
  } else if (s.type === "serial") {
    body = serialBody(d, s);
  } else {
    body = kvmBody(d, s);
  }
  const kind = s.type === "desktop" ? "rdp" : (s.type === "kvm" ? "kvm" : "serial");
  const badge = s.type === "desktop" ? "warn" : (s.path === "rm1048" ? "nvidia" : "vertiv");
  return '<article class="session ' + (s.path === "rm1048" ? "rm" : "acs") + " " + kind +
    (blocked ? " blocked" : "") + '" data-session-pane="' + s.id + '"><header class="session-head"><div><span class="badge ' +
    badge + '">' + esc(sessionTitle(s)) + "</span><h3>" + esc(sessionTitle(s)) + "</h3><p>" + esc(d.name) +
    '</p><p class="uri">' + esc(sessionLocator(d, s)) + '</p><p class="fine">' + esc(sessionNote(d, s)) +
    '</p></div><button type="button" class="act" data-act="close-session" data-session="' + s.id +
    '">Close</button></header>' + body + "</article>";
}

function renderSessions() {
  const cards = state.sessions.map(sessionCard).join("");
  const body = state.sessions.length
    ? '<p class="fine">A dark BMC fails over to ACS serial and ACS KVM. A lost RDP desktop fails over to ACS KVM. RM1048 stays the in-band plane.</p><div class="workspace">' + cards + "</div>"
    : '<p class="empty">No sessions open. On the port map, choose any of the 48 ACS serial ports. The console opens already logged in.</p>';
  return '<div class="page-head"><div class="top"><div><h1>Sessions</h1>' +
    '<p class="sub">Each pane names the path, the device, and the port or URI.</p></div></div>' +
    pills() + "</div>" + body;
}

function renderAudit() {
  const rows = state.audit.map((a) => "<tr><td>" + esc(fmt(a.t)) + "</td><td>" + esc(a.user) + "</td><td>" +
    esc(a.role) + "</td><td>" + esc(a.action) + "</td><td>" + esc(a.asset) + "</td><td>" + esc(a.outlet) +
    "</td><td>" + esc(a.wo) + "</td><td>" + esc(a.detail) + "</td></tr>").join("");
  const table = state.audit.length
    ? '<div class="table-wrap"><table><thead><tr><th>Time</th><th>User</th><th>Role</th><th>Action</th><th>Asset</th><th>Outlet</th><th>WO</th><th>Detail</th></tr></thead><tbody>' +
      rows + "</tbody></table></div>"
    : '<p class="empty">No acts yet.</p>';
  return '<div class="page-head"><div class="top"><div><h1>Audit</h1>' +
    '<p class="sub">Every console session and every outlet or DI act is logged with the identity on the act.</p></div></div>' +
    pills() + '</div><section class="panel"><h2>Log</h2>' + table + "</section>";
}

function lab() {
  const gear = devices.map((d) => '<div class="lab-row"><div><strong>' + esc(d.name) + '</strong><div class="fine">' +
    (d.bmc === "up" ? "BMC up" : "BMC dark · on ACS") + '</div></div><button type="button" class="act" data-act="bmc-toggle" data-device="' +
    d.id + '">' + (d.bmc === "up" ? "Drop BMC" : "Restore BMC") + "</button></div>").join("");
  return '<button type="button" class="backdrop" data-act="lab-close" aria-label="Close lab"></button><aside class="lab" aria-label="Lab">' +
    '<div class="lab-head"><div><p class="kicker">Simulated world</p><h2>Lab</h2></div>' +
    '<button type="button" class="act" data-act="lab-close">Close</button></div>' +
    '<p class="fine">External gear only. This drawer is not an Access screen. Drop a BMC to fail that device over to ACS. Drop RDP to move the desktop onto ACS KVM. RM1048 does not take either failover.</p>' +
    '<div class="lab-row"><div><strong>RM1048 plane</strong><div class="fine">' +
    (state.rm1048 === "healthy" ? "Healthy" : "Dark") + '</div></div><button type="button" class="act" data-act="rm-toggle">' +
    (state.rm1048 === "healthy" ? "Mark dark" : "Mark healthy") + "</button></div>" +
    '<div class="lab-row"><div><strong>DI-1 leak rope</strong><div class="fine">' +
    (state.leak ? "Asserted" : "Quiet") + '</div></div><button type="button" class="act" data-act="leak-toggle">' +
    (state.leak ? "Clear DI-1" : "Trip DI-1") + "</button></div>" +
    '<div class="lab-block"><label class="field">Window name<input id="maint-name" data-focus-key="maint-name" value="' +
    esc(state.maintName) + '"></label><label class="field">Window work order<input id="maint-wo" data-focus-key="maint-wo" value="' +
    esc(state.maintWo) + '"></label><button type="button" class="act primary" data-act="maint-toggle">' +
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
    '<button type="button" class="act danger" data-act="reset-world">Reset simulated world</button></aside>';
}

function login() {
  const choices = [
    { id: "dsvs.operator", title: "Operator", hint: "Open consoles and power outlets", start: true },
    { id: "dsvs.admin", title: "Administrator", hint: "Also edit the asset tag and virtual media", start: false },
    { id: "colo.readonly", title: "Read only", hint: "Look around. Power stays locked.", start: false },
  ];
  const roles = choices.map((choice) => '<button type="button" class="role' + (choice.start ? " primary" : "") +
    '" data-act="login" data-user="' + esc(choice.id) + '"><span class="role-copy">' +
    (choice.start ? '<span class="role-kicker">Start here</span>' : "") +
    '<span class="role-title">' + esc(choice.title) + '</span><span class="role-hint">' +
    esc(choice.hint) + '</span></span><span class="role-go">Sign in</span></button>').join("");
  return '<div class="login-wrap" data-screen="login"><div class="login-card"><div class="login-head">' + wordmark() +
    '<div class="product-name">Access</div><p class="rack-id">Rack A14</p></div>' +
    '<div class="login-body"><h1>Sign in</h1><p class="sub">No password on this demo. Choose a role.</p>' +
    '<div class="role-list">' + roles + "</div></div></div></div>";
}

const LOAD_SEED = {
  "tray-01": { gpu: 84, mem: 79, power: 81, temp: 74, drift: 0.28, failover: true },
  "tray-02": { gpu: 77, mem: 73, power: 75, temp: 70, drift: 0.05, failover: false },
  "tray-03": { gpu: 40, mem: 46, power: 38, temp: 57, drift: 0.02, failover: false, rdpDown: true },
  "tray-04": { gpu: 89, mem: 86, power: 88, temp: 80, drift: 0.2, failover: true },
  "tray-05": { gpu: 58, mem: 55, power: 52, temp: 62, drift: 0.03, failover: false },
  "tray-06": { gpu: 97, mem: 94, power: 96, temp: 90, drift: 0, failover: true, down: true },
  "tray-07": { gpu: 48, mem: 50, power: 44, temp: 59, drift: -0.02, failover: false, watchDeny: true },
  "tray-08": { gpu: 72, mem: 69, power: 70, temp: 66, drift: 0.11, failover: false },
  sn2201: { gpu: 20, mem: 38, power: 33, temp: 51, drift: 0.01, failover: false },
  pshelf: { gpu: 12, mem: 18, power: 61, temp: 48, drift: 0.03, failover: false },
};

const neighbors = [];
const infra = [];
const PODS = [
  {
    id: "pod-a", name: "AI Pod A", letter: "A", x: -470, y: -310, w: 400, h: 214, managed: true,
    racks: [
      { id: "A13", name: "Rack A13", kind: "GPU", row: "row-a-n", x: 16, y: 34, w: 52, d: 44, h: 116, servers: [] },
      { id: "A14", name: "Rack A14", kind: "GPU", row: "row-a-n", x: 78, y: 34, w: 56, d: 44, h: 124, servers: ["tray-01", "tray-02", "tray-03", "tray-04", "tray-05", "tray-06", "tray-07", "tray-08"] },
      { id: "A15", name: "Rack A15", kind: "GPU", row: "row-a-s", x: 16, y: 128, w: 52, d: 44, h: 116, servers: [] },
      { id: "A14-net", name: "Network", kind: "Network", row: "row-a-s", x: 78, y: 130, w: 48, d: 40, h: 80, servers: ["sn2201"] },
      { id: "A14-pwr", name: "DC power shelf", kind: "Power", row: "row-a-s", x: 136, y: 132, w: 72, d: 36, h: 46, servers: ["pshelf"] },
    ],
    boxes: [
      { id: "cdu-a", x: 318, y: 86, w: 68, d: 36, h: 28 },
    ],
    fit: {
      aisles: [
        { id: "cold-a1", tone: "cold", label: "Cold aisle", x: 12, y: 6, w: 290, h: 22 },
        { id: "hot-a", tone: "hot", label: "Hot aisle", x: 12, y: 84, w: 280, h: 32 },
        { id: "cold-a2", tone: "cold", label: "Cold aisle", x: 12, y: 180, w: 290, h: 22 },
      ],
      rows: [
        { id: "row-a-n", name: "North row", y: 34, cold: "cold-a1", hot: "hot-a" },
        { id: "row-a-s", name: "South row", y: 128, cold: "cold-a2", hot: "hot-a" },
      ],
      containment: { id: "hac-a", x: 20, y: 86, w: 250, d: 28, h: 28 },
      busbar: { id: "bus-a", x: 16, y: 94, w: 260, d: 12, h: 8 },
    },
  },
  {
    id: "pod-b", name: "AI Pod B", letter: "B", x: 30, y: -310, w: 380, h: 214, managed: false,
    racks: [
      { id: "B02", name: "Rack B02", kind: "GPU", row: "row-b-n", x: 16, y: 34, w: 52, d: 44, h: 116, servers: [] },
      { id: "B03", name: "Rack B03", kind: "GPU", row: "row-b-n", x: 78, y: 34, w: 52, d: 44, h: 116, servers: [] },
      { id: "B04", name: "Rack B04", kind: "GPU", row: "row-b-s", x: 16, y: 128, w: 52, d: 44, h: 116, servers: [] },
      { id: "B05", name: "Rack B05", kind: "GPU", row: "row-b-s", x: 78, y: 128, w: 52, d: 44, h: 116, servers: [] },
    ],
    boxes: [
      { id: "shelf-b", x: 146, y: 132, w: 68, d: 36, h: 44 },
      { id: "cdu-b", x: 300, y: 86, w: 64, d: 34, h: 28 },
    ],
    fit: {
      aisles: [
        { id: "cold-b1", tone: "cold", label: "Cold aisle", x: 12, y: 6, w: 270, h: 22 },
        { id: "hot-b", tone: "hot", label: "Hot aisle", x: 12, y: 84, w: 260, h: 32 },
        { id: "cold-b2", tone: "cold", label: "Cold aisle", x: 12, y: 180, w: 270, h: 22 },
      ],
      rows: [
        { id: "row-b-n", name: "North row", y: 34, cold: "cold-b1", hot: "hot-b" },
        { id: "row-b-s", name: "South row", y: 128, cold: "cold-b2", hot: "hot-b" },
      ],
      containment: { id: "hac-b", x: 18, y: 86, w: 230, d: 28, h: 28 },
      busbar: { id: "bus-b", x: 16, y: 94, w: 240, d: 12, h: 8 },
    },
  },
  {
    id: "pod-c", name: "AI Pod C", letter: "C", x: -170, y: 10, w: 380, h: 214, managed: false,
    racks: [
      { id: "C05", name: "Rack C05", kind: "GPU", row: "row-c-n", x: 16, y: 34, w: 52, d: 44, h: 116, servers: [] },
      { id: "C06", name: "Rack C06", kind: "GPU", row: "row-c-n", x: 78, y: 34, w: 52, d: 44, h: 116, servers: [] },
      { id: "C07", name: "Rack C07", kind: "GPU", row: "row-c-s", x: 16, y: 128, w: 52, d: 44, h: 116, servers: [] },
      { id: "C08", name: "Rack C08", kind: "GPU", row: "row-c-s", x: 78, y: 128, w: 52, d: 44, h: 116, servers: [] },
    ],
    boxes: [
      { id: "shelf-c", x: 146, y: 132, w: 68, d: 36, h: 44 },
      { id: "cdu-c", x: 300, y: 86, w: 64, d: 34, h: 28 },
    ],
    fit: {
      aisles: [
        { id: "cold-c1", tone: "cold", label: "Cold aisle", x: 12, y: 6, w: 270, h: 22 },
        { id: "hot-c", tone: "hot", label: "Hot aisle", x: 12, y: 84, w: 260, h: 32 },
        { id: "cold-c2", tone: "cold", label: "Cold aisle", x: 12, y: 180, w: 270, h: 22 },
      ],
      rows: [
        { id: "row-c-n", name: "North row", y: 34, cold: "cold-c1", hot: "hot-c" },
        { id: "row-c-s", name: "South row", y: 128, cold: "cold-c2", hot: "hot-c" },
      ],
      containment: { id: "hac-c", x: 18, y: 86, w: 230, d: 28, h: 28 },
      busbar: { id: "bus-c", x: 16, y: 94, w: 240, d: 12, h: 8 },
    },
  },
];

const YARD = [
  { id: "grid-1", name: "Utility grid", kind: "Grid", x: -530, y: -90, w: 110, d: 78, h: 64, power: 80, temp: 28, klass: "grid-yard" },
  { id: "xfmr-1", name: "MV transformer", kind: "Power module", x: -500, y: -20, w: 84, d: 58, h: 50, power: 62, temp: 40, klass: "xfmr-yard" },
  { id: "pwr-mod", name: "Power module", kind: "Power module", x: -490, y: 70, w: 112, d: 76, h: 60, power: 74, temp: 44, klass: "module-yard" },
  { id: "batt-1", name: "Battery skid", kind: "Power module", x: -360, y: 86, w: 96, d: 52, h: 42, power: 46, temp: 32, klass: "battery-yard" },
  { id: "heat-1", name: "Heat rejection", kind: "Heat rejection", x: 390, y: -120, w: 170, d: 72, h: 46, power: 68, temp: 38, klass: "cooler-yard" },
  { id: "heat-2", name: "Trim cooler", kind: "Heat rejection", x: 410, y: 10, w: 150, d: 60, h: 38, power: 42, temp: 33, klass: "cooler-yard" },
  { id: "hydro-1", name: "Hydro skid", kind: "Cooling", x: 400, y: 130, w: 140, d: 58, h: 36, power: 54, temp: 30, klass: "hydro-yard" },
  { id: "core-1", name: "OneCore", kind: "Core", x: -80, y: -188, w: 160, d: 72, h: 50, power: 36, temp: 28, klass: "core-block" },
];

const SHELL = { x: -210, y: -48, w: 420, d: 230, h: 76 };

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function fillPod(podId, rackId, gpus) {
  const pod = PODS.find((p) => p.id === podId);
  const rack = pod.racks.find((r) => r.id === rackId);
  rack.servers = gpus.map((gpu, index) => {
    const id = podId + "-" + rackId + "-" + (index + 1);
    const entity = {
      id,
      name: rackId + " · GPU " + (index + 1),
      pod: podId,
      rack: rackId,
      kind: "GPU tray",
      managed: false,
      bmc: "up",
      load: {
        gpu,
        mem: Math.max(16, gpu - 6),
        power: Math.max(16, gpu - 8),
        temp: 52 + gpu * 0.2,
        drift: gpu >= 86 ? 0.12 : gpu >= 75 ? 0.05 : 0.02,
        failover: false,
      },
    };
    entity.seed = Object.assign({}, entity.load);
    neighbors.push(entity);
    return id;
  });
}

function addInfra(id, name, kind, pod, power, temp, drift, yard) {
  const entity = {
    id, name, kind, pod, yard: !!yard, managed: false, bmc: "up",
    load: { gpu: 0, mem: 0, power, temp, drift, failover: false },
  };
  entity.seed = Object.assign({}, entity.load);
  infra.push(entity);
}

function isFacility(entity) {
  if (!entity) return false;
  return ["Cooling", "Busway", "Containment", "Aisle", "Powershelf", "Power module", "Heat rejection", "Core", "Grid", "Pipe"].indexOf(entity.kind) >= 0;
}

fillPod("pod-a", "A13", [62, 58, 71, 44, 66, 53]);
fillPod("pod-a", "A15", [48, 77, 55, 63, 41, 59]);
fillPod("pod-b", "B02", [88, 83, 61, 44, 71, 57]);
fillPod("pod-b", "B03", [49, 76, 66, 52, 91, 47]);
fillPod("pod-b", "B04", [54, 63, 47, 72, 58, 41]);
fillPod("pod-b", "B05", [67, 52, 74, 45, 60, 81]);
fillPod("pod-c", "C05", [73, 69, 55, 48, 80, 63]);
fillPod("pod-c", "C06", [42, 58, 64, 51, 46, 70]);
fillPod("pod-c", "C07", [59, 66, 43, 71, 54, 48]);
fillPod("pod-c", "C08", [77, 50, 62, 68, 45, 57]);
addInfra("cdu-a", "CDU A", "Cooling", "pod-a", 64, 33, 0.04);
addInfra("bus-a", "Bus bar A", "Busway", "pod-a", 58, 36, 0.03);
addInfra("hac-a", "Hot aisle containment A", "Containment", "pod-a", 40, 38, 0.02);
addInfra("cold-a1", "Cold aisle A", "Aisle", "pod-a", 22, 24, 0.01);
addInfra("hot-a", "Hot aisle A", "Aisle", "pod-a", 72, 48, 0.04);
addInfra("cold-a2", "Cold aisle A return", "Aisle", "pod-a", 26, 25, 0.01);
addInfra("cdu-b", "CDU B", "Cooling", "pod-b", 84, 41, 0.06);
addInfra("bus-b", "Bus bar B", "Busway", "pod-b", 61, 34, 0.03);
addInfra("hac-b", "Hot aisle containment B", "Containment", "pod-b", 48, 40, 0.03);
addInfra("cold-b1", "Cold aisle B", "Aisle", "pod-b", 24, 26, 0.01);
addInfra("hot-b", "Hot aisle B", "Aisle", "pod-b", 70, 46, 0.04);
addInfra("cold-b2", "Cold aisle B return", "Aisle", "pod-b", 28, 27, 0.01);
addInfra("shelf-b", "DC power shelf B", "Powershelf", "pod-b", 66, 42, 0.03);
addInfra("cdu-c", "CDU C", "Cooling", "pod-c", 54, 31, 0.02);
addInfra("bus-c", "Bus bar C", "Busway", "pod-c", 49, 32, 0.02);
addInfra("hac-c", "Hot aisle containment C", "Containment", "pod-c", 38, 36, 0.02);
addInfra("cold-c1", "Cold aisle C", "Aisle", "pod-c", 20, 24, 0.01);
addInfra("hot-c", "Hot aisle C", "Aisle", "pod-c", 64, 44, 0.03);
addInfra("cold-c2", "Cold aisle C return", "Aisle", "pod-c", 24, 25, 0.01);
addInfra("shelf-c", "DC power shelf C", "Powershelf", "pod-c", 58, 40, 0.02);
YARD.forEach((item) => addInfra(item.id, item.name, item.kind, "yard", item.power, item.temp, 0.02, true));
addInfra("pipe-sup", "Supply piping", "Pipe", "yard", 22, 18, 0.01, true);
addInfra("pipe-ret", "Return piping", "Pipe", "yard", 36, 34, 0.01, true);

const LIBRARY = [
  spec("vertiv-rack", "Vertiv", "VR Rack 42U", "Enclosure", "floor", 42, 0, 0, "415 V", 2, 0, [600, 1200, 1998], [56, 48, 124], "Two power feeds into an empty 42U enclosure."),
  spec("vertiv-busbar", "Vertiv", "PowerBar busway", "Busway", "floor", 0, 0, 400, "415 V", 0, 0, [2400, 180, 220], [220, 14, 96], "Overhead track busway. Runs above the hot aisle."),
  spec("vertiv-hac", "Vertiv", "Hot aisle containment", "Containment", "floor", 0, 0, 0, "—", 0, 0, [2400, 1200, 2200], [220, 40, 72], "Hood over the hot aisle. Cold aisles stay open."),
  spec("vertiv-powermod", "Vertiv", "Power module", "Power module", "yard", 0, 1500000, 1800, "MV", 4, 2, [3000, 2200, 3200], [120, 78, 64], "Sits outside the building, with the transformer and battery skid."),
  spec("vertiv-heat", "Vertiv", "Heat rejection", "Heat rejection", "yard", 0, 40000, 80, "480 V", 2, 1, [6000, 2400, 2800], [180, 70, 48], "Chiller or dry cooler in the yard. Rejects the hall heat outside the shell."),
  spec("vertiv-shelf", "Vertiv", "DC power shelf", "Powershelf", "rack", 2, 80000, 1600, "50 VDC", 4, 2, [530, 750, 88], [68, 36, 44], "50 V DC shelf for the rack. ORv3-style, fed from the overhead bus bar."),
  spec("vertiv-ups", "Vertiv", "Liebert EXL UPS", "UPS", "floor", 0, 500000, 696, "415 V", 4, 2, [1400, 900, 2000], [88, 64, 118], "Floor UPS. Four output breakers and a network card."),
  spec("vertiv-crac", "Vertiv", "Liebert DSE CRAC", "Cooling", "floor", 0, 18000, 22, "480 V", 1, 1, [1800, 900, 2000], [96, 58, 110], "150 kW cooling capacity. Faceplate power is the fan and control load."),
  spec("vertiv-pdu", "Vertiv", "Geist rPDU", "PDU", "rack", 0, 0, 32, "230 V", 24, 2, [56, 80, 1730], [18, 14, 90], "Zero-U monitored PDU. 24 power outlets, 2 network ports. Rated current is the faceplate value."),
  spec("hp-dl380", "HP", "ProLiant DL380", "Server", "rack", 2, 800, 3.5, "230 V", 2, 4, [448, 750, 87], [48, 28, 16], "2U rack server. Two power supplies and four network ports."),
  spec("hp-dl360", "HP", "ProLiant DL360", "Server", "rack", 1, 500, 2.2, "230 V", 2, 4, [434, 750, 43], [48, 26, 10], "1U rack server."),
  spec("hp-cx8325", "HP", "Aruba CX 8325", "Switch", "rack", 1, 400, 1.8, "230 V", 2, 48, [442, 510, 44], [48, 22, 10], "1U switch. Two power supplies and 48 network ports."),
  spec("dell-r760", "Dell", "PowerEdge R760", "Server", "rack", 2, 900, 3.9, "230 V", 2, 4, [482, 800, 87], [50, 30, 16], "2U rack server."),
  spec("dell-r660", "Dell", "PowerEdge R660", "Server", "rack", 1, 700, 3.1, "230 V", 2, 4, [482, 780, 43], [50, 28, 10], "1U rack server."),
  spec("dell-s5248", "Dell", "PowerSwitch S5248", "Switch", "rack", 1, 350, 1.5, "230 V", 2, 48, [434, 460, 44], [48, 20, 10], "1U switch."),
  spec("ibm-s1022", "IBM", "Power S1022", "Server", "rack", 2, 1400, 6.1, "230 V", 2, 4, [482, 770, 87], [50, 30, 18], "2U Power server."),
  spec("ibm-fs5300", "IBM", "FlashSystem 5300", "Storage", "rack", 1, 800, 3.5, "230 V", 2, 8, [483, 850, 44], [50, 32, 10], "1U storage. Two power supplies and eight network ports."),
  spec("ibm-rack", "IBM", "Enterprise Rack 42U", "Enclosure", "floor", 42, 0, 0, "415 V", 2, 0, [605, 1092, 2015], [56, 46, 124], "Empty 42U enclosure with two power feeds."),
];

function spec(id, maker, name, kind, place, u, watts, amps, volts, powerPorts, netPorts, mm, box, note) {
  return {
    id: id,
    maker: maker,
    name: name,
    kind: kind,
    place: place,
    u: u,
    uCapacity: place === "floor" && u ? u : 0,
    watts: watts,
    amps: amps,
    volts: volts,
    powerPorts: powerPorts,
    netPorts: netPorts,
    mm: mm,
    box: { w: box[0], d: box[1], h: box[2] },
    note: note,
    powerLabel: watts >= 1000 ? (watts / 1000).toFixed(watts >= 10000 ? 0 : 1) + " kW" : watts + " W",
    ampLabel: amps + " A",
  };
}

function catalogById(id) {
  return LIBRARY.find((item) => item.id === id);
}

function placementById(id) {
  return state.plan.placements.find((item) => item.id === id);
}

function findRack(id) {
  let found = null;
  PODS.forEach((pod) => {
    pod.racks.forEach((rack) => {
      if (rack.id === id) found = rack;
    });
  });
  return found;
}

function hostCapacity(hostId) {
  const placed = placementById(hostId);
  if (placed) return catalogById(placed.catalogId).uCapacity || 0;
  return findRack(hostId) ? 42 : 0;
}

function usedU(hostId) {
  const rack = findRack(hostId);
  let used = 0;
  if (rack) {
    rackEntities(rack).forEach((entity) => {
      if (entity.kind === "Switch") used += 1;
      else if (entity.kind === "Power shelf") used += 4;
      else if (entity.kind !== "Cooling" && entity.kind !== "Busway") used += 2;
    });
  }
  state.plan.placements.forEach((item) => {
    if (item.place === "rack" && item.host === hostId) used += catalogById(item.catalogId).u || 0;
  });
  return used;
}

function freeU(hostId) {
  return hostCapacity(hostId) - usedU(hostId);
}

let dragToken = "";

function entityById(id) {
  return deviceById(id) || neighbors.find((n) => n.id === id) || infra.find((item) => item.id === id);
}

function entityScore(entity) {
  if (!entity || !entity.load) return 0;
  if (isFacility(entity)) return entity.load.power;
  const load = entity.load;
  return load.gpu * 0.5 + load.mem * 0.2 + load.power * 0.2 + load.temp * 0.1;
}

function heatBand(entity) {
  if (!entity) return "ok";
  if (entity.bmc === "down") return "failover";
  const score = entityScore(entity);
  if (score >= 90) return "critical";
  if (score >= 75) return "near";
  return "ok";
}

function worstBand(list) {
  const order = ["ok", "near", "critical", "failover"];
  let best = 0;
  list.forEach((entity) => {
    const index = order.indexOf(heatBand(entity));
    if (index > best) best = index;
  });
  return order[best];
}

function nudge(entity) {
  const load = entity.load;
  if (!load || entity.bmc === "down") return;
  const drift = load.drift || 0;
  const jitter = (Math.random() - 0.5) * 0.45;
  if (isFacility(entity)) {
    load.power = clamp(load.power + drift + jitter, 8, 98);
    load.temp = clamp(load.temp + drift * 0.08, 20, 80);
    return;
  }
  load.gpu = clamp(load.gpu + drift + jitter, 4, 98);
  load.mem = clamp(load.mem + drift * 0.55 + jitter * 0.3, 4, 98);
  load.power = clamp(load.power + drift * 0.7 + jitter * 0.25, 4, 98);
  load.temp = clamp(load.temp + drift * 0.12, 40, 96);
}

function applyCapacitySeed() {
  devices.forEach((mapped) => {
    const seed = LOAD_SEED[mapped.id];
    mapped.load = Object.assign({}, seed);
    if (seed.down) {
      mapped.bmc = "down";
      mapped.bmcLostAt = Date.now() - SERIAL_FAILOVER_MS;
      mapped.serialReadyAt = Date.now() - 1000;
      mapped.serialAnnounced = true;
      mapped.serialFailoverTotal = SERIAL_FAILOVER_MS;
    } else {
      mapped.bmc = "up";
      mapped.serialReadyAt = 0;
      mapped.serialAnnounced = true;
      mapped.bmcLostAt = 0;
    }
    mapped.rdp = seed.rdpDown ? "down" : "up";
    mapped.watchDeny = !!seed.watchDeny;
    mapped.watch = null;
  });
  neighbors.forEach((entity) => {
    entity.load = Object.assign({}, entity.seed);
    entity.bmc = "up";
  });
  infra.forEach((entity) => {
    entity.load = Object.assign({}, entity.seed);
  });
}

function stepCapacity() {
  let dirty = false;
  function consider(entity) {
    if (!entity || !entity.load || entity.bmc === "down") return;
    const before = heatBand(entity);
    nudge(entity);
    if (deviceById(entity.id) && entity.load.failover && entityScore(entity) >= 93) {
      loseBmc(deviceById(entity.id), false);
      dirty = true;
      return;
    }
    if (heatBand(entity) !== before) dirty = true;
  }
  devices.forEach(consider);
  neighbors.forEach(consider);
  infra.forEach(consider);
  if (state.user && state.view === "floor") {
    if (dirty) render();
    else updateFloorMeters();
  }
}

function updateFloorMeters() {
  document.querySelectorAll("[data-load-for]").forEach((el) => {
    const entity = entityById(el.getAttribute("data-load-for"));
    if (!entity) return;
    const score = Math.round(entityScore(entity));
    el.querySelectorAll("[data-score]").forEach((node) => { node.textContent = score + "%"; });
    const led = el.querySelector(".led");
    if (led && !el.classList.contains("blade")) {
      const color = heatColor(entityHeat(entity));
      led.style.background = color;
    }
    el.querySelectorAll("[data-part]").forEach((bar) => {
      const key = bar.getAttribute("data-part");
      bar.style.width = Math.round(entity.load[key] || 0) + "%";
    });
  });
  paintHeat();
}

function heatColor(score) {
  if (score >= 90) return "#c45c26";
  if (score >= 75) return "#8a6a12";
  return "#c8c4bc";
}

function conditionTone(entity) {
  if (!entity) return { color: "#c8c4bc", pri: 0, word: "Nominal" };
  if (entity.bmc === "down") return { color: "#8a3030", pri: 1, word: "BMC" };
  if (entity.rdp === "down") return { color: "#c45c26", pri: 2, word: "RDP" };
  const score = isFacility(entity) ? (entity.load ? entity.load.power : 0) : entityScore(entity);
  if (score >= 90) return { color: "#c45c26", pri: 2, word: "Hot" };
  if (score >= 75) return { color: "#8a6a12", pri: 3, word: "Rise" };
  return { color: "#c8c4bc", pri: 0, word: "Nominal" };
}

function listTone(list) {
  let worst = { color: "#c8c4bc", pri: 0, word: "Nominal" };
  (list || []).forEach((entity) => {
    const tone = conditionTone(entity);
    if (tone.pri && (worst.pri === 0 || tone.pri < worst.pri)) worst = tone;
  });
  return worst;
}

function serialFinding(d) {
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

function refreshSerialWatch() {
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

function plantAlarms() {
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

function activeAlarms() {
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

function alarmBanner() {
  const alarms = activeAlarms();
  if (!alarms.length) {
    return '<div class="alarm-banner quiet" role="status"><span class="pri-mark pri-0" aria-hidden="true">—</span><p>No abnormal conditions. The last automatic serial login on every ACS port read nominal.</p></div>';
  }
  const shown = alarms.slice(0, 3).map((alarm) => {
    const unacked = !state.acked[alarm.id];
    return '<div class="alarm-row pri-' + alarm.pri + (unacked ? " unacked" : "") + '"><span class="pri-mark pri-' + alarm.pri +
      '" aria-hidden="true">' + alarm.pri + '</span><p><b>' + esc(alarm.asset) + "</b> " + esc(alarm.text) +
      (unacked ? " Unacknowledged." : " Acknowledged.") + '</p><button type="button" class="act" data-act="alarm-ack" data-alarm="' +
      alarm.id + '"' + (unacked ? "" : " disabled") + '>Ack</button><button type="button" class="act primary" data-act="alarm-go" data-alarm="' +
      alarm.id + '">' + esc(alarm.response) + "</button></div>";
  }).join("");
  const more = alarms.length > 3 ? '<p class="fine alarm-more">' + (alarms.length - 3) + " more on the overview.</p>" : "";
  return '<div class="alarm-banner" role="status" aria-label="Abnormal conditions">' + shown + more + "</div>";
}

function ackAlarm(id) {
  state.acked[id] = true;
  render();
}

function goAlarm(id) {
  const alarm = activeAlarms().find((item) => item.id === id);
  if (!alarm) return;
  state.acked[id] = true;
  if (alarm.go) go(alarm.go);
  else if (alarm.act === "floor-serial") floorSerial(alarm.device);
  else if (alarm.act === "rdp-failover") failRdpToKvm(alarm.device);
  else if (alarm.act === "floor-part") openPart(alarm.device, alarm.part);
  else if (alarm.act === "floor-server") openFloorServer(alarm.device);
}

function entityHeat(entity) {
  if (!entity || !entity.load) return 18;
  if (entity.bmc === "down") return 98;
  if (isFacility(entity)) return entity.load.power;
  return entityScore(entity);
}

function rackHeat(list) {
  if (!list || !list.length) return 22;
  return Math.max.apply(null, list.map(entityHeat));
}

function awardCatch(mapped) {
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

function missionText() {
  const hot = devices.filter((entity) => heatBand(entity) !== "ok");
  const dark = hot.filter((entity) => entity.bmc === "down");
  if (dark.length) {
    return dark[0].name + " is white-hot. Open ACS serial for " + (dark.length > 1 ? "each dark BMC" : "the catch") + ".";
  }
  if (hot.length) {
    return hot.length + " server" + (hot.length === 1 ? "" : "s") + " climbing the thermal scale. Zoom the rack and catch them on ACS.";
  }
  return "Hall is cool. Drag to orbit. Scroll to zoom in.";
}

function cameraTransform() {
  const floor = state.floor;
  return "translate(" + floor.panX + "px," + floor.panY + "px) rotateX(" + floor.pitch +
    "deg) rotateZ(" + floor.yaw + "deg) scale(" + floor.zoom + ")";
}

function applyCamera() {
  const world = document.querySelector(".world");
  if (world) {
    world.style.transform = cameraTransform();
    world.style.setProperty("--pitch", state.floor.pitch + "deg");
    world.style.setProperty("--yaw", state.floor.yaw + "deg");
  }
  const chassis = document.querySelector(".chassis");
  if (chassis) {
    chassis.style.transform = "rotateX(" + state.floor.chassisPitch + "deg) rotateY(" +
      state.floor.chassisYaw + "deg) scale(" + state.floor.chassisZoom + ")";
  }
}

function paintHeat() {
  document.querySelectorAll("[data-heat-rack]").forEach((el) => {
    const pod = podById(el.getAttribute("data-pod"));
    const rack = rackById(pod, el.getAttribute("data-heat-rack"));
    const list = rack ? rackEntities(rack) : [];
    const tone = listTone(list);
    el.style.setProperty("--heat", tone.color);
    const mark = el.querySelector(".face-pri");
    if (mark) mark.textContent = tone.pri ? String(tone.pri) : "";
    el.querySelectorAll(".led[data-heat-for]").forEach((led) => {
      const ledTone = conditionTone(entityById(led.getAttribute("data-heat-for")));
      led.style.background = ledTone.color;
      led.style.boxShadow = ledTone.pri ? "0 0 0 1px " + ledTone.color : "none";
    });
  });
  document.querySelectorAll("[data-heat-box]").forEach((el) => {
    el.style.setProperty("--heat", conditionTone(entityById(el.getAttribute("data-heat-box"))).color);
  });
  document.querySelectorAll(".blade[data-load-for]").forEach((el) => {
    const entity = entityById(el.getAttribute("data-load-for"));
    if (!entity) return;
    const tone = conditionTone(entity);
    el.style.background = tone.pri ? tone.color : "#e7e2da";
    el.style.color = "#1a1a1a";
    el.style.borderColor = tone.pri ? tone.color : "#d5cfc6";
    const meter = el.querySelector(".blade-meter i");
    if (meter) meter.style.background = tone.pri ? "#1a1a1a" : "#5c564e";
  });
  document.querySelectorAll("[data-load-for] .led").forEach((led) => {
    const host = led.closest("[data-load-for]");
    if (!host || host.classList.contains("blade")) return;
    const tone = conditionTone(entityById(host.getAttribute("data-load-for")));
    led.style.background = tone.color;
  });
}

let orbit = null;

function onPointerDown(event) {
  if (!state.user || state.view !== "floor" || event.button !== 0) return;
  if (event.target.closest(".lib, [data-plan]")) return;
  const scene = event.target.closest(".scene");
  if (!scene || event.target.closest(".hud, .legend, button, a, input, select")) return;
  orbit = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    moved: false,
    chassis: scene.classList.contains("chassis-scene"),
  };
  scene.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  if (!orbit || event.pointerId !== orbit.id) return;
  const dx = event.clientX - orbit.x;
  const dy = event.clientY - orbit.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) orbit.moved = true;
  orbit.x = event.clientX;
  orbit.y = event.clientY;
  if (orbit.chassis) {
    state.floor.chassisYaw = clamp(state.floor.chassisYaw + dx * 0.45, -75, 75);
    state.floor.chassisPitch = clamp(state.floor.chassisPitch - dy * 0.3, -25, 48);
  } else {
    state.floor.yaw += dx * 0.45;
    state.floor.pitch = clamp(state.floor.pitch - dy * 0.28, 16, 84);
  }
  applyCamera();
}

function onPointerUp(event) {
  if (!orbit || event.pointerId !== orbit.id) return;
  if (orbit.moved) {
    state.floor.suppressClick = true;
    setTimeout(() => { state.floor.suppressClick = false; }, 0);
  }
  orbit = null;
}

function onWheel(event) {
  const scene = event.target.closest && event.target.closest(".scene");
  if (!scene || !state.user || state.view !== "floor") return;
  event.preventDefault();
  const factor = event.deltaY > 0 ? 0.92 : 1.08;
  if (scene.classList.contains("chassis-scene")) {
    state.floor.chassisZoom = clamp(state.floor.chassisZoom * factor, 0.65, 1.85);
  } else {
    state.floor.zoom = clamp(state.floor.zoom * factor, 0.42, 1.9);
  }
  applyCamera();
}

function podById(id) {
  return PODS.find((pod) => pod.id === id);
}

function rackById(pod, rackId) {
  return pod && pod.racks.find((rack) => rack.id === rackId);
}

function rackEntities(rack) {
  return (rack.servers || []).map(entityById).filter(Boolean);
}

function deviceRackId(id) {
  if (id === "sn2201") return "A14-net";
  if (id === "pshelf") return "A14-pwr";
  return "A14";
}

function goFloor(level) {
  if (level === "site") {
    state.floor.level = "site";
    state.floor.serverId = "";
    state.floor.rowId = "";
    state.floor.feedId = "";
    state.floor.partId = "";
    state.floor.zoom = Math.min(state.floor.zoom, 0.84);
  } else if (level === "hall") {
    if (state.floor.level === "site") state.floor.zoom = Math.max(state.floor.zoom, 0.9);
    state.floor.level = "hall";
    state.floor.serverId = "";
    state.floor.rowId = "";
    state.floor.feedId = "";
    state.floor.partId = "";
  } else if (level === "pod") {
    state.floor.level = "pod";
    state.floor.serverId = "";
    state.floor.rowId = "";
    state.floor.feedId = "";
    state.floor.partId = "";
  } else if (level === "row") {
    state.floor.level = state.floor.rowId ? "row" : "pod";
    state.floor.serverId = "";
    state.floor.feedId = "";
    state.floor.partId = "";
  } else if (level === "rack") {
    state.floor.level = state.floor.rackId ? "rack" : "pod";
    state.floor.serverId = "";
    state.floor.partId = "";
  }
  render();
}

function openRow(podId, rowId) {
  if (state.floor.level === "hall" || state.floor.level === "site") state.floor.zoom = Math.max(state.floor.zoom, 1.15);
  state.floor.podId = podId;
  state.floor.rowId = rowId;
  state.floor.level = "row";
  state.floor.serverId = "";
  state.floor.feedId = "";
  state.floor.partId = "";
  state.view = "floor";
  render();
}

function openFeed(podId, feedId) {
  state.view = "floor";
  state.floor.feedId = feedId;
  state.floor.partId = "";
  state.floor.serverId = "";
  state.floor.level = "feed";
  state.floor.podId = podId || "";
  render();
}

function placeServer(id) {
  const entity = entityById(id);
  if (!entity) return;
  if (deviceById(id) && !entity.serialOnly) {
    state.floor.podId = "pod-a";
    state.floor.rackId = deviceRackId(id);
  } else if (entity.pod && entity.pod !== "yard") {
    state.floor.podId = entity.pod;
    state.floor.rackId = entity.rack || "";
  }
  const pod = podById(state.floor.podId);
  const rack = rackById(pod, state.floor.rackId);
  if (rack && rack.row) state.floor.rowId = rack.row;
}

function openPod(id) {
  if (state.floor.level === "hall") state.floor.zoom = Math.max(state.floor.zoom, 1.12);
  state.floor.podId = id;
  state.floor.level = "pod";
  state.floor.serverId = "";
  state.floor.rowId = "";
  state.floor.feedId = "";
  state.floor.partId = "";
  render();
}

function openRack(podId, rackId) {
  state.floor.podId = podId;
  state.floor.rackId = rackId;
  state.floor.level = "rack";
  state.floor.serverId = "";
  state.floor.partId = "";
  const rack = rackById(podById(podId), rackId);
  if (rack && rack.row) state.floor.rowId = rack.row;
  render();
}

function openFloorServer(id) {
  const entity = entityById(id);
  if (!entity) return;
  state.view = "floor";
  state.floor.serverId = id;
  state.floor.partId = "";
  state.floor.feedId = "";
  if (entity.yard) {
    state.floor.level = "site";
    render();
    return;
  }
  state.floor.level = "server";
  placeServer(id);
  render();
}

function openPart(id, part) {
  const entity = entityById(id);
  if (!entity) return;
  state.view = "floor";
  state.floor.serverId = id;
  state.floor.partId = part || "inlet";
  state.floor.feedId = "";
  if (entity.yard) {
    state.floor.level = "site";
    render();
    return;
  }
  state.floor.level = "part";
  placeServer(id);
  render();
}

function floorSerial(id) {
  if (!deviceById(id)) {
    state.toast = "ACS-A14 opens serial only inside rack A14.";
    render();
    return;
  }
  openSession(id, "acs", "serial", "rs232");
}

function bandLabel(band) {
  if (band === "failover") return "ACS serial";
  if (band === "critical") return "Critical";
  if (band === "near") return "Nearing capacity";
  return "Nominal";
}

function boxHtml(item, band, act, extra) {
  const tone = extra.server ? conditionTone(entityById(extra.server)) : listTone(extra.leds || []);
  const leds = (extra.leds || []).map((entity) => {
    const ledTone = conditionTone(entity);
    return '<em class="led" data-heat-for="' + entity.id + '" title="' + esc(ledTone.word) + '" style="background:' +
      ledTone.color + '"></em>';
  }).join("");
  const mark = tone.pri ? '<b class="face-pri pri-' + tone.pri + '">' + tone.pri + "</b>" : "";
  const heatAttr = extra.server
    ? '" data-heat-box="' + extra.server
    : '" data-heat-rack="' + (extra.rack || "");
  const face = extra.face || "";
  const cap = extra.cap ? '<span class="cap-label">' + esc(extra.cap) + "</span>" : "";
  const planAttr = extra.plan ? ' data-plan="' + extra.plan + '" draggable="true"' : "";
  const attrs = extra.attrs || "";
  return '<div class="rackbox' + (extra.plan ? " planned" : "") + (extra.klass ? " " + extra.klass : "") + '" role="button" tabindex="0" data-act="' + act + '" data-band="' + band + heatAttr +
    '" style="--x:' + item.x + "px;--y:" + item.y + "px;--w:" + item.w + "px;--d:" + item.d + "px;--h:" + item.h +
    "px;--heat:" + (extra.color || tone.color) + '" data-pod="' + (extra.pod || "") + '" data-rack="' + (extra.rack || "") +
    '" data-server="' + (extra.server || "") + '"' + planAttr + attrs + '><i class="ftop">' + cap + '</i><i class="ffront">' + mark + leds + face +
    '</i><i class="fside"></i></div>';
}

function hudHtml() {
  const alarms = activeAlarms();
  const levelName = {
    site: "Outside the building",
    hall: "Level 1 · Hall",
    pod: "Level 2 · Pod",
    row: "Level 2 · Row",
    rack: "Level 3 · Rack",
    server: "Level 3 · Device",
    part: "Level 4 · Inside the device",
    feed: "Power feed",
  };
  const level = levelName[state.floor.level] || "Hall";
  return '<div class="hud"><div class="hud-score"><b data-abnormal>' + alarms.length +
    '</b><span>Abnormal</span></div><p class="hud-mission">' + esc(level) +
    '. Color is reserved for conditions that need a response. Gray is nominal.</p><div class="hud-zoom"><button type="button" data-act="horizon" data-horizon="now"' + (state.horizon === "future" ? "" : ' aria-pressed="true"') + '>Now</button><button type="button" data-act="horizon" data-horizon="future"' + (state.horizon === "future" ? ' aria-pressed="true"' : "") + '>Future</button><button type="button" data-act="floor-go" data-level="site">Outside</button><button type="button" data-act="floor-go" data-level="hall">Hall</button><button type="button" data-act="floor-zoom" data-dir="out" aria-label="Zoom out">−</button><button type="button" data-act="floor-zoom" data-dir="in" aria-label="Zoom in">+</button><button type="button" data-act="floor-zoom" data-dir="reset">Reset view</button></div></div>';
}

function makerColor(maker) {
  if (maker === "HP") return "#0b6e5a";
  if (maker === "Dell") return "#0a4f86";
  if (maker === "IBM") return "#0f3f8a";
  return "#3a342e";
}

function portPips(count, kind) {
  const shown = Math.min(count, 6);
  let marks = "";
  for (let i = 0; i < shown; i += 1) marks += '<i class="pip ' + kind + '"></i>';
  if (count > shown) marks += "<b>+" + (count - shown) + "</b>";
  if (!count) marks = '<i class="pip none"></i>';
  return '<span class="pips" aria-label="' + count + " " + kind + ' ports">' + marks + "</span>";
}

function faceplateHtml(spec) {
  return '<span class="faceplate"><b>' + esc(spec.powerLabel) + "</b><b>" + esc(spec.ampLabel) + "</b>" +
    portPips(spec.powerPorts, "power") + "</span>";
}

function mini3d(spec) {
  const height = spec.place === "floor" ? 46 : Math.max(22, Math.min(40, (spec.u || 1) * 16));
  return '<span class="mini-slot"><span class="mini-view"><span class="mini3d" style="--mc:' + makerColor(spec.maker) + ";--mh:" + height +
    'px"><i class="mtop"></i><i class="mfront">' + portPips(Math.min(spec.powerPorts, 4), "power") +
    '</i><i class="mside"></i></span></span></span>';
}

function placeWord(place) {
  if (place === "yard") return "Outside";
  if (place === "floor") return "Floor";
  return "Rack";
}

function planBoxes(place) {
  return state.plan.placements.filter((item) => item.place === place).map((item) => {
    const spec = catalogById(item.catalogId);
    return boxHtml(
      { x: item.x, y: item.y, w: spec.box.w, d: spec.box.d, h: spec.box.h },
      "ok",
      "plan-select",
      { plan: item.id, color: makerColor(spec.maker), face: faceplateHtml(spec) }
    );
  }).join("");
}

function planBlade(item) {
  const spec = catalogById(item.catalogId);
  const selected = state.plan.selected === item.id ? " selected" : "";
  const units = spec.u || 1;
  return '<button type="button" class="ru' + selected + '" data-act="plan-select" data-plan="' + item.id +
    '" style="--u:' + units + ";--mc:" + makerColor(spec.maker) + '"><span class="ru-u">' + (spec.u ? spec.u + "U" : "0U") +
    '</span><span class="ru-body"><b>' + esc(item.name) + "</b><span>" + esc(spec.powerLabel) + " · " + esc(spec.ampLabel) +
    "</span></span><span class=\"ru-ports\">" + portPips(spec.powerPorts, "power") + portPips(spec.netPorts, "net") +
    "</span></button>";
}

function planBlades(hostId) {
  return state.plan.placements.filter((item) => item.place === "rack" && item.host === hostId).map(planBlade).join("");
}

function dims(spec) {
  return spec.mm[0] + " × " + spec.mm[1] + " × " + spec.mm[2] + " mm";
}

function faceSheet(spec, title, extra) {
  return '<div class="face-sheet"><div class="face-sheet-top">' + mini3d(spec) + "<div><p class=\"kicker\">" + esc(spec.maker) +
    "</p><h2>" + esc(title) + '</h2><span class="place-badge ' + spec.place + '">' + placeWord(spec.place) +
    "</span></div></div><div class=\"stat-row\"><div class=\"stat\"><b>" + esc(spec.powerLabel) +
    "</b><span>Power</span></div><div class=\"stat\"><b>" + esc(spec.ampLabel) + "</b><span>Current</span></div><div class=\"stat\"><b>" +
    esc(spec.volts) + "</b><span>Voltage</span></div></div><p class=\"dim-bar\">Dimensions " + esc(dims(spec)) +
    "</p><div class=\"port-row\"><span>Power ports " + spec.powerPorts + "</span>" + portPips(spec.powerPorts, "power") +
    "</div><div class=\"port-row\"><span>Network ports " + spec.netPorts + "</span>" + portPips(spec.netPorts, "net") +
    "</div>" + (spec.uCapacity ? '<p class="fine">Rack space ' + spec.uCapacity + "U</p>" : "") +
    (spec.place === "rack" ? '<p class="fine">Height ' + (spec.u ? spec.u + "U" : "0U") + "</p>" : "") +
    '<p class="fine">' + esc(spec.note) + "</p>" + (extra || "") + "</div>";
}

function libCard(specItem) {
  const on = state.plan.preview === specItem.id ? " on" : "";
  return '<div class="lib-card' + on + " " + specItem.place + '" draggable="true" data-catalog="' + specItem.id +
    '" data-act="plan-preview" tabindex="0" style="--mc:' + makerColor(specItem.maker) + '"><span class="grip" aria-hidden="true"></span>' +
    mini3d(specItem) + '<span class="lib-copy"><span class="place-badge ' + specItem.place + '">' +
    placeWord(specItem.place) + "</span><strong>" + esc(specItem.name) +
    "</strong><span class=\"lib-maker\">" + esc(specItem.maker) + "</span></span><span class=\"lib-stats\"><b>" +
    esc(specItem.powerLabel) + "</b><b>" + esc(specItem.ampLabel) + "</b><b>" + specItem.powerPorts + " P · " +
    specItem.netPorts + " N</b></span></div>";
}

function renderLibrary() {
  const makers = ["All", "Vertiv", "HP", "Dell", "IBM"];
  const filters = makers.map((maker) => {
    const dot = maker === "All" ? "" : '<i class="maker-dot" style="background:' + makerColor(maker) + '"></i>';
    return '<button type="button" data-act="plan-maker" data-maker="' + maker + '"' +
      (state.plan.maker === maker ? ' aria-pressed="true"' : "") + ">" + dot + maker + "</button>";
  }).join("");
  const list = LIBRARY.filter((specItem) => state.plan.maker === "All" || specItem.maker === state.plan.maker);
  const groups = [
    ["Outside the building", list.filter((specItem) => specItem.place === "yard")],
    ["On the floor", list.filter((specItem) => specItem.place === "floor")],
    ["In a rack", list.filter((specItem) => specItem.place === "rack")],
  ].map((group) => {
    if (!group[1].length) return "";
    return '<h3>' + group[0] + "</h3>" + group[1].map(libCard).join("");
  }).join("");
  let watts = 0;
  let amps = 0;
  state.plan.placements.forEach((item) => {
    const specItem = catalogById(item.catalogId);
    watts += specItem.watts;
    amps += specItem.amps;
  });
  const power = watts >= 1000 ? (watts / 1000).toFixed(1) + " kW" : watts + " W";
  return '<aside class="lib"><h2>Device library</h2><p class="fine">Drag a tile. Outside gear lands in the yard. Floor gear lands in the hall. Rack gear mounts in an enclosure.</p><div class="lib-filters">' +
    filters + "</div>" + groups + '<p class="lib-total"><b>' + state.plan.placements.length + '</b><span>placed</span><b>' +
    power + "</b><b>" + amps.toFixed(1) + " A</b></p></aside>";
}

function renderPlanChassis(item) {
  const blades = planBlades(item.id);
  const free = freeU(item.id);
  return '<div class="scene chassis-scene thermal">' + hudHtml() + '<div class="chassis-wrap"><div class="rack-frame" data-plan-host="' +
    item.id + '" style="transform:rotateX(' + state.floor.chassisPitch + "deg) rotateY(" + state.floor.chassisYaw +
    "deg) scale(" + state.floor.chassisZoom + ')"><div class="rack-rail"><span>' + esc(item.name) + "</span><b>" + free +
    'U free</b></div><div class="rack-bay">' + (blades || "") + "</div></div></div><p class=\"legend chassis-hint\">The open bay is the drop target. Drag the frame to turn it.</p></div>";
}

function itemPoint(item) {
  const depth = item.d || item.h || 20;
  return { x: item.x + item.w / 2, y: item.y + depth / 2 };
}

function outletForDevice(id) {
  return outlets.find((outlet) => outlet.deviceId === id);
}

function whipMode(id) {
  const outlet = outletForDevice(id);
  if (!outlet) return "live";
  if (outlet.power === "off") return "open";
  if (outlet.power === "cycling") return "partial";
  return "live";
}

function shelfLive(pod) {
  if (!pod) return "live";
  if (pod.id === "pod-a") return whipMode("pshelf");
  return "live";
}

function rackEnergized(pod, rack) {
  const shelf = shelfLive(pod);
  if (!rack) return shelf;
  if (rack.kind === "Power") return shelf;
  if (shelf === "open") return "open";
  const bound = (rack.servers || []).filter((id) => outletForDevice(id));
  if (!bound.length) return shelf;
  const modes = bound.map(whipMode);
  if (modes.every((mode) => mode === "open")) return "open";
  if (modes.some((mode) => mode !== "live") || shelf === "partial") return "partial";
  return "live";
}

function feedMode(id) {
  if (!id) return "live";
  if (id.indexOf("whip-") === 0) {
    const rackId = id.slice(5);
    const pod = PODS.find((item) => item.racks.some((rack) => rack.id === rackId));
    const rack = pod && pod.racks.find((item) => item.id === rackId);
    return rackEnergized(pod, rack);
  }
  if (id.indexOf("bus-") === 0) return shelfLive(podById(id.slice(4)));
  return "live";
}

function feedHtml(from, to, mode, id, podId, extraClass) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.max(12, Math.hypot(dx, dy));
  const ang = Math.atan2(dy, dx) * 180 / Math.PI;
  const on = state.floor.feedId === id ? " on" : "";
  const word = mode === "open" ? "De-energized" : (mode === "partial" ? "Partly energized" : "Energized");
  return '<button type="button" class="feed ' + mode + on + (extraClass ? " " + extraClass : "") + '" data-act="floor-feed" data-feed="' + id + '" data-pod="' +
    (podId || "") + '" style="--x:' + from.x.toFixed(1) + "px;--y:" + from.y.toFixed(1) + "px;--len:" + len.toFixed(1) +
    "px;--ang:" + ang.toFixed(1) + 'deg" aria-label="' + word + " feed\"></button>";
}

function pipeHtml(from, to, kind) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.max(12, Math.hypot(dx, dy));
  const ang = Math.atan2(dy, dx) * 180 / Math.PI;
  const id = kind === "return" ? "pipe-ret" : "pipe-sup";
  const word = kind === "return" ? "Return pipe" : "Supply pipe";
  return '<button type="button" class="pipe ' + kind + '" data-act="floor-server" data-server="' + id +
    '" style="--x:' + from.x.toFixed(1) + "px;--y:" + from.y.toFixed(1) + "px;--len:" + len.toFixed(1) +
    "px;--ang:" + ang.toFixed(1) + 'deg" aria-label="' + word + '"></button>';
}

function podShelf(pod) {
  return pod.racks.find((rack) => rack.kind === "Power") || (pod.boxes || []).find((box) => {
    const entity = entityById(box.id);
    return entity && entity.kind === "Powershelf";
  });
}

function podFeeds(pod) {
  const shelf = podShelf(pod);
  const bus = pod.fit && pod.fit.busbar;
  if (!shelf || !bus) return "";
  const shelfPt = itemPoint(shelf);
  let html = feedHtml(itemPoint(bus), shelfPt, shelfLive(pod), "bus-" + pod.id, pod.id);
  pod.racks.forEach((rack) => {
    if (rack.id === shelf.id) return;
    html += feedHtml(shelfPt, itemPoint(rack), rackEnergized(pod, rack), "whip-" + rack.id, pod.id);
  });
  (pod.boxes || []).forEach((box) => {
    if (box.id === shelf.id) return;
    const entity = entityById(box.id);
    if (!entity || entity.kind !== "Powershelf") return;
    html += feedHtml(itemPoint(bus), itemPoint(box), "live", "bus-" + pod.id, pod.id);
  });
  return html;
}

function yardById(id) {
  const gear = {};
  YARD.forEach((item) => { gear[item.id] = item; });
  return gear[id];
}

function siteFeedHtml() {
  const grid = itemPoint(yardById("grid-1"));
  const xfmr = itemPoint(yardById("xfmr-1"));
  const modulePt = itemPoint(yardById("pwr-mod"));
  const battery = itemPoint(yardById("batt-1"));
  const wall = { x: SHELL.x - 2, y: SHELL.y + 96 };
  let html = feedHtml(grid, xfmr, "live", "grid-xfmr", "", "cable") +
    feedHtml(xfmr, modulePt, "live", "xfmr-mod", "", "cable") +
    feedHtml(battery, modulePt, "live", "batt-mod", "", "cable") +
    feedHtml(modulePt, wall, "live", "mod-hall", "", "cable");
  if (futureOn()) html += feedHtml(grid, { x: -420, y: 200 }, "live", "grid-future", "", "cable");
  return html;
}

function sitePipesHtml() {
  const trunkS = SHELL.x + SHELL.w + 26;
  const trunkR = trunkS + 18;
  const y0 = SHELL.y + 16;
  const y1 = SHELL.y + SHELL.d - 10;
  let html = pipeHtml({ x: trunkS, y: y0 }, { x: trunkS, y: y1 }, "supply") +
    pipeHtml({ x: trunkR, y: y0 }, { x: trunkR, y: y1 }, "return");
  ["heat-1", "heat-2", "hydro-1"].forEach((id) => {
    const gear = itemPoint(yardById(id));
    html += pipeHtml({ x: trunkS, y: gear.y }, { x: gear.x - 4, y: gear.y }, "supply");
    html += pipeHtml({ x: trunkR, y: gear.y + 12 }, { x: gear.x - 4, y: gear.y + 12 }, "return");
  });
  return html;
}

function rowRecord(pod, rowId) {
  if (!pod || !pod.fit || !pod.fit.rows) return null;
  return pod.fit.rows.find((row) => row.id === rowId) || null;
}

function fitHtml(pod) {
  const fit = pod.fit;
  if (!fit) return "";
  const aisles = (fit.aisles || []).map((band) => '<div class="aisle ' + band.tone + '" data-act="floor-server" data-server="' +
    band.id + '" style="--x:' + band.x + "px;--y:" + band.y + "px;--w:" + band.w + "px;--h:" + band.h + 'px"><span>' +
    esc(band.label) + "</span></div>").join("");
  const containment = fit.containment ? boxHtml(fit.containment, heatBand(entityById(fit.containment.id)), "floor-server", {
    pod: pod.id, server: fit.containment.id, klass: "containment", cap: "Containment", leds: [],
  }) : "";
  const bus = fit.busbar ? boxHtml(fit.busbar, heatBand(entityById(fit.busbar.id)), "floor-server", {
    pod: pod.id, server: fit.busbar.id, klass: "busbar", cap: "Bus bar", leds: [],
  }) : "";
  const rows = (fit.rows || []).map((row) => '<button type="button" class="row-tag" data-act="floor-row" data-pod="' +
    pod.id + '" data-row="' + row.id + '" style="--y:' + row.y + 'px">' + esc(row.name) + "</button>").join("");
  return aisles + containment + bus + rows;
}

function renderHall() {
  const pods = PODS.map((pod) => {
    const racks = pod.racks.map((rack) => {
      const facing = (rack.row || "").slice(-1) === "s" ? "face-south" : "face-north";
      const power = rack.kind === "Power";
      return boxHtml(rack, worstBand(rackEntities(rack)), "floor-rack", {
        pod: pod.id, rack: rack.id, leds: rackEntities(rack),
        klass: (power ? "powershelf " : "") + facing,
        cap: power ? "50 VDC" : "Front",
      });
    }).join("");
    const boxes = (pod.boxes || []).map((box) => {
      const entity = entityById(box.id);
      const shelf = entity && entity.kind === "Powershelf";
      return boxHtml(box, heatBand(entity), "floor-server", {
        pod: pod.id, server: box.id, leds: [],
        klass: shelf ? "powershelf" : "",
        cap: shelf ? "50 VDC" : "",
      });
    }).join("");
    const current = state.floor.level === "pod" && state.floor.podId === pod.id ? " current" : "";
    return '<div class="pod' + current + '" data-act="floor-pod" data-pod="' + pod.id + '" style="--x:' + pod.x +
      "px;--y:" + pod.y + "px;--w:" + pod.w + "px;--h:" + pod.h + 'px"><i class="pod-plate"></i><span class="pod-letter">' +
      esc(pod.letter) + "</span>" + fitHtml(pod) + racks + boxes + podFeeds(pod) + "</div>";
  }).join("");
  return '<div class="scene thermal">' + hudHtml() + '<div class="stage"><div class="world" style="transform:' + cameraTransform() +
    ";--pitch:" + state.floor.pitch + "deg;--yaw:" + state.floor.yaw + 'deg"><div class="slab"></div>' + pods + futureHallHtml() + planBoxes("floor") +
    '</div></div><div class="legend"><span class="pri-mark pri-0">—</span><span>Nominal</span><span class="pri-mark pri-3">3</span><span>Rise</span><span class="pri-mark pri-2">2</span><span>Hot / RDP</span><span class="pri-mark pri-1">1</span><span>BMC / leak</span><span class="legend-hint">' +
    (state.horizon === "future" ? "Future state. Hall 2 is planned and drawn with the live hall." : "A rack row stands between every cold aisle and hot aisle. Green traces are energized.") +
    "</span></div></div>";
}

function renderSite() {
  const shell = boxHtml(SHELL, "ok", "floor-go", {
    klass: "building", color: "#d9d2c8", cap: "Compute hall", attrs: ' data-level="hall"', leds: [],
  });
  const gear = YARD.map((item) => boxHtml(item, heatBand(entityById(item.id)), "floor-server", {
    server: item.id, klass: item.klass, cap: item.name, color: item.klass === "heat-yard" ? "#2f4a3c" : (item.klass === "core-block" ? "#1c1c1c" : "#3a342e"), leds: [],
  })).join("");
  return '<div class="scene thermal site-scene">' + hudHtml() + '<div class="stage"><div class="world" style="transform:' + cameraTransform() +
    ";--pitch:" + state.floor.pitch + "deg;--yaw:" + state.floor.yaw + 'deg"><div class="slab yard-slab"></div>' + shell + gear + futureYardHtml() + planBoxes("yard") +
    siteFeedHtml() + sitePipesHtml() + '</div></div><div class="legend"><span class="feed-key cable"></span><span>Grid feeder</span><span class="pipe-key supply"></span><span>Supply pipe</span><span class="pipe-key return"></span><span>Return pipe</span><span class="legend-hint">Feeder and piping stay outside the hall</span></div></div>';
}

function renderChassis(rack, pod) {
  const blades = rackEntities(rack).map((entity) => faceplate(entity, state.floor.serverId === entity.id, "floor-server")).join("") + planBlades(rack.id);
  const sample = rackEntities(rack)[0];
  const note = sample ? thermalCard(sample) : "";
  return '<div class="scene chassis-scene thermal">' + hudHtml() + '<div class="chassis-wrap"><div class="chassis cabinet-chassis" data-rack-host="' +
    rack.id + '" style="transform:rotateX(' +
    state.floor.chassisPitch + "deg) rotateY(" + state.floor.chassisYaw + "deg) scale(" + state.floor.chassisZoom +
    ')"><div class="chassis-top">' +
    esc(pod.name) + " · " + esc(rack.name) + " · cold aisle front · " + freeU(rack.id) + 'U free</div><div class="cabinet in-scene"><div class="cab-rail"></div><div class="cab-bay">' +
    blades + '</div><div class="cab-rail"></div></div></div></div><div class="legend chassis-hint">Intake on this face. Exhaust is the hot aisle behind the row.' +
    (state.containment === "cac" ? " Cold aisle is enclosed." : " Hot aisle is enclosed.") + "</div>" +
    (note ? '<div class="chassis-thermal">' + note + "</div>" : "") + "</div>";
}

function gaugeRow(entity, key, label) {
  const value = Math.round(entity.load[key] || 0);
  return '<div class="gauge"><span>' + label + '</span><div class="meter"><span data-part="' + key + '" style="width:' +
    value + '%"></span></div><b>' + value + "%</b></div>";
}

function yardArt(entity) {
  const placed = YARD.find((gear) => gear.id === entity.id);
  const klass = placed ? placed.klass : (entity.id === "pipe-ret" ? "pipe-return" : "pipe-supply");
  const caption = {
    "grid-yard": "Gantry with three bushings. The lines arrive from the utility grid.",
    "xfmr-yard": "Tank, radiator fins, and the high-voltage bushings.",
    "module-yard": "Louvered cabinet. The feeder from the transformer lands here.",
    "battery-yard": "Cell racks on a skid, cabled to the power module.",
    "cooler-yard": "Fan deck. This is where the hall heat leaves the site.",
    "hydro-yard": "Two pumps and a manifold, sitting on the yard pipes.",
    "pipe-supply": "Cool supply. It runs along the outside of the east wall.",
    "pipe-return": "Warm return. It runs beside the supply and stays outside the hall.",
  };
  return '<div class="yard-sheet ' + klass + '"><div class="yard-art" aria-hidden="true"></div><p class="fine">' +
    esc(caption[klass] || "") + "</p></div>";
}

function serverInspector(entity) {
  const band = heatBand(entity);
  const managed = !!deviceById(entity.id);
  const score = Math.round(entityScore(entity));
  const parts = isFacility(entity)
    ? gaugeRow(entity, "power", "Load") + gaugeRow(entity, "temp", "Temperature")
    : gaugeRow(entity, "gpu", "GPU") + gaugeRow(entity, "mem", "Memory") + gaugeRow(entity, "power", "Power") + gaugeRow(entity, "temp", "Temperature");
  let action = "";
  if (managed && entity.bmc === "down") {
    const where = waiting(entity) ? "ACS serial is coming up on " + entity.tty + "." : "ACS serial is up on " + entity.tty + ".";
    action = "<p>" + esc(where) + " This is the out-of-band path. RM1048 does not take the failover.</p>" +
      '<button type="button" class="act primary" data-act="floor-serial" data-device="' + entity.id + '">Open ACS serial</button>';
  } else if (managed && entity.kind === "GPU tray" && entity.rdp === "down") {
    action = "<p>In-band RDP is down. The graphical failover is ACS KVM on MPU port " + entity.mpu + ".</p>" +
      '<button type="button" class="act primary" data-act="rdp-failover" data-device="' + entity.id + '">Open KVM failover</button>';
  } else if (managed && entity.kind === "GPU tray") {
    action = "<p class=\"fine\">RDP is the in-band desktop. ACS KVM takes the session if that path drops.</p>" +
      '<button type="button" class="act" data-act="rdp-open" data-device="' + entity.id + '">Open RDP</button>';
  } else if (managed) {
    action = "<p class=\"fine\">BMC is still up. ACS serial is the out-of-band wire if this BMC drops.</p>" +
      '<button type="button" class="act" data-act="floor-serial" data-device="' + entity.id + '">Open ACS serial</button>';
  } else if (entity.kind === "Grid") {
    action = yardArt(entity) + "<p>The utility grid lands on a gantry outside the shell. One feeder is closed through the transformer and the power module, and it stops at the hall wall.</p>" +
      '<button type="button" class="act" data-act="floor-feed" data-feed="grid-xfmr">Open the feeder</button>';
  } else if (entity.kind === "Pipe") {
    const supply = entity.id === "pipe-sup";
    action = yardArt(entity) + "<p>" + (supply
      ? "Supply piping carries cool fluid from the heat rejection and hydro skid to the outside of the shell."
      : "Return piping carries warm fluid from the shell wall back to the heat rejection. It never crosses the compute floor.") + "</p>";
  } else if (entity.kind === "Heat rejection") {
    action = yardArt(entity) + "<p class=\"fine\">Dry cooler outside the hall. Fan decks reject the heat the pipes bring out of the shell.</p>";
  } else if (entity.kind === "Cooling" && entity.yard) {
    action = yardArt(entity) + "<p class=\"fine\">Hydro skid. Pumps sit on the yard manifold, on the supply and return pipes.</p>";
  } else if (entity.kind === "Power module" && entity.yard) {
    action = yardArt(entity) + "<p class=\"fine\">This stays outside the building. The feeder from the grid is the conductor you can follow to the hall wall.</p>" +
      '<button type="button" class="act" data-act="floor-go" data-level="hall">Enter the hall</button>';
  } else if (entity.kind === "Core") {
    action = "<p class=\"fine\">The OneCore block holds shared interconnect, utility distribution, and controls. Compute halls scale around it.</p>" +
      '<button type="button" class="act" data-act="floor-go" data-level="hall">Enter the hall</button>';
  } else if (entity.yard) {
    action = "<p class=\"fine\">This stays outside the building. The hall is entered separately. ACS-A14 does not open a session here.</p>" +
      '<button type="button" class="act" data-act="floor-go" data-level="hall">Enter the hall</button>';
  } else if (entity.kind === "Busway") {
    const home = PODS.find((item) => item.fit && item.fit.busbar && item.fit.busbar.id === entity.id);
    action = "<p class=\"fine\">Overhead bus bar along the hot aisle. The trace to the DC shelf is energized while that shelf feed is closed.</p>" +
      (home ? '<button type="button" class="act" data-act="floor-feed" data-pod="' + home.id + '" data-feed="bus-' + home.id + '">Open the feed</button>' : "");
  } else if (entity.kind === "Containment") {
    action = "<p class=\"fine\">Hot aisle containment. The hood closes the exhaust aisle. A rack row stands on each side, between this aisle and the cold aisles.</p>";
  } else if (entity.kind === "Aisle") {
    const home = podById(entity.pod);
    const beside = home && home.fit && home.fit.rows ? home.fit.rows.filter((row) => row.cold === entity.id || row.hot === entity.id) : [];
    const hotAisle = entity.name.indexOf("Hot") === 0;
    action = "<p class=\"fine\">" + (hotAisle ? "Exhaust aisle. A rack row stands on each side, so this aisle never touches a cold aisle." : "Supply aisle. The row beside it faces this air.") + "</p>" +
      beside.map((row) => '<button type="button" class="floor-row" data-act="floor-row" data-pod="' + home.id + '" data-row="' + row.id + '"><span>' +
        esc(row.name) + "</span><b>Row</b></button>").join("");
  } else if (entity.kind === "Powershelf") {
    const home = podById(entity.pod);
    action = "<p class=\"fine\">50 V DC power shelf in the row. Fed from the overhead bus bar.</p>" +
      (home ? '<button type="button" class="act" data-act="floor-feed" data-pod="' + home.id + '" data-feed="bus-' + home.id + '">Open the feed</button>' : "");
  } else if (isFacility(entity)) {
    action = "<p class=\"fine\">Facility equipment. Simulated load, not an ACS serial target.</p>";
  } else {
    action = "<p class=\"fine\">Outside rack A14. ACS-A14 does not open a serial session here.</p>";
  }
  const heatNote = !isFacility(entity) && entity.load ? thermalCard(entity) : "";
  const inside = !isFacility(entity) && entity.load ? deviceParts(entity) : "";
  return '<div data-load-for="' + entity.id + '"><p class="band-label ' + band + '">' + esc(bandLabel(band)) + " · " + score +
    '%</p><h2>' + esc(entity.name) + "</h2><p class=\"fine\">" + esc(entity.kind) + (managed ? " · simulated BMC" : " · simulated load") + "</p>" + heatNote + parts + inside + action + "</div>";
}

function deviceParts(entity) {
  const parts = [["inlet", "Inlet"], ["exhaust", "Exhaust"], ["bmc", "BMC"], ["feed", "DC feed"]];
  return '<h3>Inside</h3><div class="part-row">' + parts.map((part) => '<button type="button" class="act" data-act="floor-part" data-server="' +
    entity.id + '" data-part="' + part[0] + '">' + part[1] + "</button>").join("") + "</div>";
}

function energWord(mode) {
  if (mode === "open") return "De-energized";
  if (mode === "partial") return "Partly energized";
  return "Energized";
}

function partPanel(entity) {
  const part = state.floor.partId || "inlet";
  const heat = thermalReading(entity);
  const outlet = outletForDevice(entity.id);
  const mode = outlet ? whipMode(entity.id) : "live";
  if (part === "exhaust") {
    return "<h2>Rear exhaust</h2><p>Exhaust leaves at <b>" + heat.exhaust.toFixed(1) + " °C</b> into the " +
      (heat.hac ? "contained hot aisle." : "open hall.") + "</p><p class=\"fine\">The rear of this device faces the hot aisle. The row in front of it faces the cold aisle.</p>";
  }
  if (part === "bmc") {
    const down = entity.bmc === "down";
    const local = deviceById(entity.id) && !entity.serialOnly;
    return "<h2>BMC</h2><p>" + (down ? "This path is dark. Failover is ACS serial, out of band." : "The manager is up. ACS serial stays the out-of-band wire.") + "</p>" +
      (local ? '<button type="button" class="act primary" data-act="' + (down ? "floor-serial" : "launch") + '" data-device="' + entity.id +
        '" data-path="' + (down ? "" : "rm") + '" data-type="' + (down ? "" : "kvm") + '">' + (down ? "Open ACS serial" : "Open BMC console") + "</button>" : '<p class="fine">Outside ACS-A14. The reading is simulated.</p>');
  }
  if (part === "feed") {
    const where = outlet ? " Outlet " + outlet.n + " is " + outlet.power + "." : " This device follows the row shelf.";
    return "<h2>DC feed</h2><p><b>" + energWord(mode) + ".</b>" + esc(where) + " The trace on the floor uses this same reading.</p>" +
      (outlet ? '<button type="button" class="act" data-act="nav" data-view="control">Open control</button>' : "");
  }
  const mark = heat.pri ? '<b class="pri-mark pri-' + heat.pri + '">' + heat.pri + "</b> " : "";
  return "<h2>Rack inlet</h2><p>" + mark + "<b>" + heat.inlet.toFixed(1) + " °C</b>. " + esc(heat.envelope) + ".</p>" +
    (heat.recirculation ? "<p>This U is high in the rack. Cold-aisle containment is recirculating supply air here.</p>" : "") +
    '<p class="fine">Supply is 20.5 °C at the cold-aisle face. An inlet past the study band raises an alarm on its own.</p>';
}

function feedPanel() {
  const id = state.floor.feedId;
  const mode = feedMode(id);
  let copy = "This segment is " + energWord(mode).toLowerCase() + ". The state is read from the gear on the path.";
  let next = "";
  if (id.indexOf("whip-") === 0) {
    const rackId = id.slice(5);
    const pod = PODS.find((item) => item.racks.some((rack) => rack.id === rackId));
    const rack = pod && pod.racks.find((item) => item.id === rackId);
    copy = (rack ? rack.name : "This rack") + " is fed from the DC shelf. " + copy;
    if (pod && rack) {
      next = '<button type="button" class="act" data-act="floor-rack" data-pod="' + pod.id + '" data-rack="' + rack.id + '">Open ' + esc(rack.name) + "</button>";
    }
  } else if (id.indexOf("bus-") === 0) {
    copy = "Bus bar to the DC shelf. " + copy + (mode === "open" ? " The shelf outlet is open, so the row behind it is dark." : " The shelf outlet is closed.");
  } else if (id === "grid-xfmr") {
    copy = "Utility feeder from the grid gantry to the MV transformer. Energized. The conductor stays in the yard.";
    next = '<button type="button" class="act" data-act="floor-server" data-server="grid-1">Open the grid</button>';
  } else if (id === "grid-future") {
    copy = "Second feeder to the planned power module. It is drawn with the future state, beside the feeder that is closed today.";
  } else if (id === "xfmr-mod") {
    copy = "Medium-voltage transformer to the power module. Energized.";
  } else if (id === "batt-mod") {
    copy = "Battery skid onto the power module. Energized for ride-through.";
  } else if (id === "mod-hall") {
    copy = "Power module to the outside of the compute hall. Energized. The feeder ends at the shell.";
  }
  return "<h2>" + energWord(mode) + "</h2><p>" + esc(copy) + "</p>" + next;
}

function rowPanel(pod, row) {
  const cold = entityById(row.cold);
  const hot = entityById(row.hot);
  const racks = pod.racks.filter((rack) => rack.row === row.id);
  return "<h2>" + esc(row.name) + "</h2><p class=\"fine\">This row stands between " + esc(cold ? cold.name : "the cold aisle") +
    " and " + esc(hot ? hot.name : "the hot aisle") + ". Fronts face the cold aisle. Backs exhaust into the hot aisle.</p><h3>Racks</h3>" +
    racks.map((rack) => '<button type="button" class="floor-row" data-act="floor-rack" data-pod="' + pod.id + '" data-rack="' + rack.id + '">' +
      ledDot(rackEntities(rack)) + "<span>" + esc(rack.name) + "</span><b>" + energWord(rackEnergized(pod, rack)) + "</b></button>").join("") +
    '<h3>Aisles</h3><button type="button" class="floor-row" data-act="floor-server" data-server="' + row.cold + '"><span>Cold aisle</span><b>Supply</b></button>' +
    '<button type="button" class="floor-row" data-act="floor-server" data-server="' + row.hot + '"><span>Hot aisle</span><b>Exhaust</b></button>';
}

function ledDot(entityOrList) {
  const tone = Array.isArray(entityOrList) ? listTone(entityOrList) : conditionTone(entityOrList);
  return '<i class="led" title="' + esc(tone.word) + '" style="background:' + tone.color + '"></i>';
}

function rowButton(entity) {
  return '<button type="button" class="floor-row" data-act="floor-server" data-server="' + entity.id + '" data-load-for="' +
    entity.id + '">' + ledDot(entity) + '<span>' + esc(entity.name) + '</span><b data-score>' +
    Math.round(entityScore(entity)) + "%</b></button>";
}

function renderInspector() {
  const level = state.floor.level;
  const pod = podById(state.floor.podId);
  const rack = rackById(pod, state.floor.rackId);
  const row = rowRecord(pod, state.floor.rowId);
  const crumbs = ['<button type="button" data-act="floor-go" data-level="site">Outside</button>'];
  if (level !== "site" && !(level === "feed" && !pod)) crumbs.push('<button type="button" data-act="floor-go" data-level="hall">Hall</button>');
  if (pod && ["pod", "row", "rack", "server", "part", "feed"].indexOf(level) >= 0) {
    crumbs.push('<button type="button" data-act="floor-go" data-level="pod">' + esc(pod.name) + "</button>");
  }
  if (row && ["row", "rack", "server", "part"].indexOf(level) >= 0) {
    crumbs.push('<button type="button" data-act="floor-go" data-level="row">' + esc(row.name) + "</button>");
  }
  if (rack && ["rack", "server", "part"].indexOf(level) >= 0) {
    crumbs.push('<button type="button" data-act="floor-go" data-level="rack">' + esc(rack.name) + "</button>");
  }
  if ((level === "server" || level === "part") && state.floor.serverId && entityById(state.floor.serverId)) {
    const current = entityById(state.floor.serverId);
    crumbs.push('<button type="button" data-act="floor-server" data-server="' + current.id + '">' + esc(current.name) + "</button>");
  }
  if (level === "part") crumbs.push("<span>" + esc(state.floor.partId || "inlet") + "</span>");
  if (level === "feed") crumbs.push("<span>Feed</span>");
  const planOpen = placementById(state.floor.rackId);
  if ((level === "rack" || level === "server") && planOpen && !rack) {
    crumbs.push('<button type="button" data-act="plan-open" data-plan="' + planOpen.id + '">' + esc(planOpen.name) + "</button>");
  }
  let body = "";
  const sheet = planSheet();
  if (level === "site" && state.floor.serverId && entityById(state.floor.serverId)) {
    body = serverInspector(entityById(state.floor.serverId));
  } else if (level === "site") {
    body = "<h2>Outside the building</h2><p class=\"fine\">The grid feeder, transformer, and power module stay west of the shell. Supply and return pipes stay east of it. Neither run enters the compute hall.</p>" +
      '<button type="button" class="act primary" data-act="floor-go" data-level="hall">Enter the compute hall</button><h3>Yard</h3>' +
      infra.filter((item) => item.yard).map(rowButton).join("");
  } else if (level === "part") {
    const entity = entityById(state.floor.serverId);
    body = entity ? partPanel(entity) : '<p class="fine">Select a device.</p>';
  } else if (level === "feed") {
    body = feedPanel();
  } else if (level === "row" && pod && row) {
    body = rowPanel(pod, row);
  } else if (level === "server") {
    const entity = entityById(state.floor.serverId);
    body = entity ? serverInspector(entity) : '<p class="fine">Select a server.</p>';
  } else if (level === "rack" && rack) {
    body = "<h2>" + esc(rack.name) + "</h2><p class=\"fine\">" + esc(pod.name) + " · " + esc(rack.kind) +
      "</p>" + rackEntities(rack).map(rowButton).join("");
  } else if (level === "rack" && planOpen && !rack) {
    const gear = state.plan.placements.filter((item) => item.host === planOpen.id);
    body = "<h2>" + esc(planOpen.name) + "</h2><p class=\"fine\">" + freeU(planOpen.id) + "U free. Drop servers, switches, and PDUs into the enclosure.</p>" +
      (gear.map((item) => {
        const specItem = catalogById(item.catalogId);
        return '<button type="button" class="floor-row" data-act="plan-select" data-plan="' + item.id + '"><span>' +
          esc(item.name) + "</span><b>" + esc(specItem.powerLabel) + "</b></button>";
      }).join("") || '<p class="fine">Nothing in this enclosure yet.</p>');
  } else if (level === "pod" && pod) {
    const servers = pod.racks.reduce((all, item) => all.concat(rackEntities(item)), []);
    body = "<h2>" + esc(pod.name) + "</h2><p class=\"fine\">" + (pod.managed ? "ACS-A14 serves rack A14 in the north row." : "Neighbor pod. Capacity is simulated.") +
      " A rack row stands between every cold aisle and hot aisle.</p><h3>Rows</h3>" +
      (pod.fit.rows || []).map((item) => '<button type="button" class="floor-row" data-act="floor-row" data-pod="' + pod.id + '" data-row="' + item.id + '"><span>' +
        esc(item.name) + "</span><b>Between aisles</b></button>").join("") +
      "<h3>Racks</h3>" + pod.racks.map((item) => '<button type="button" class="floor-row" data-act="floor-rack" data-pod="' +
      pod.id + '" data-rack="' + item.id + '">' + ledDot(rackEntities(item)) + '<span>' + esc(item.name) +
      "</span><b>" + rackEntities(item).length + "</b></button>").join("") +
      "<h3>Infrastructure</h3>" + infra.filter((item) => item.pod === pod.id).map(rowButton).join("") +
      "<h3>Nearing capacity</h3>" + (servers.filter((entity) => heatBand(entity) === "near" || heatBand(entity) === "critical").map(rowButton).join("") || '<p class="fine">None right now.</p>');
  } else {
    const managed = devices.filter((entity) => heatBand(entity) === "near" || heatBand(entity) === "critical" || heatBand(entity) === "failover");
    body = "<h2>AI Hall 1</h2><p class=\"fine\">Each pod is cold aisle, rack row, hot aisle, rack row, cold aisle. Green traces are energized feeds. Rack A14 fails over to ACS serial.</p>" +
      PODS.map((item) => {
        const servers = item.racks.reduce((all, rack) => all.concat(rackEntities(rack)), []);
        return '<button type="button" class="floor-row" data-act="floor-pod" data-pod="' + item.id + '">' +
          ledDot(servers) + '<span>' + esc(item.name) + "</span><b>" + servers.length + " servers</b></button>";
      }).join("") +
      "<h3>Infrastructure</h3>" + infra.filter((item) => !item.yard && item.kind !== "Aisle").map(rowButton).join("") +
      "<h3>Watch list</h3>" + (managed.map(rowButton).join("") || '<p class="fine">All rack A14 servers are nominal.</p>');
  }
  return '<aside class="inspector"><div class="crumbs">' + crumbs.join("<span>/</span>") + "</div>" + sheet + body + "</aside>";
}

function planSheet() {
  const placed = placementById(state.plan.selected);
  if (placed) {
    const specItem = catalogById(placed.catalogId);
    const host = placed.host ? (placementById(placed.host) || findRack(placed.host)) : null;
    const where = placed.place === "yard" ? "Outside the building." : (placed.place === "floor" ? "On the hall floor." : "Inside " + (host && host.name ? host.name : placed.host) + ".");
    let actions = '<div class="plan-actions"><button type="button" class="act" data-act="plan-remove" data-plan="' + placed.id + '">Remove</button>';
    if (specItem.uCapacity) {
      actions += '<button type="button" class="act primary" data-act="plan-open" data-plan="' + placed.id + '">Open enclosure</button>';
    }
    if (placed.place === "floor" || placed.place === "yard") {
      actions += '<button type="button" class="act" data-act="plan-nudge" data-plan="' + placed.id + '" data-dir="left">Left</button>' +
        '<button type="button" class="act" data-act="plan-nudge" data-plan="' + placed.id + '" data-dir="right">Right</button>' +
        '<button type="button" class="act" data-act="plan-nudge" data-plan="' + placed.id + '" data-dir="up">Up</button>' +
        '<button type="button" class="act" data-act="plan-nudge" data-plan="' + placed.id + '" data-dir="down">Down</button>';
    }
    actions += "</div>";
    const space = specItem.uCapacity ? '<p class="fine">' + freeU(placed.id) + "U free of " + specItem.uCapacity + "U.</p>" : "";
    return faceSheet(specItem, placed.name, "<p class=\"fine\">" + esc(where) + "</p>" + space + actions);
  }
  if (state.plan.preview) {
    const specItem = catalogById(state.plan.preview);
    if (!specItem) return "";
    const hint = specItem.place === "yard" ? "Drag this card onto the yard, outside the building." : (specItem.place === "floor" ? "Drag this card onto the hall." : "Drag this card onto a rack, or open an enclosure and drop it there.");
    return faceSheet(specItem, specItem.name, '<p class="fine">' + hint + "</p>");
  }
  return "";
}

function renderFloor() {
  const planOpen = placementById(state.floor.rackId);
  const deep = state.floor.level === "rack" || state.floor.level === "server" || state.floor.level === "part";
  const openedPlan = deep && planOpen && catalogById(planOpen.catalogId).uCapacity;
  const chassis = !openedPlan && deep && state.floor.rackId;
  const pod = podById(state.floor.podId);
  const rack = rackById(pod, state.floor.rackId);
  const onSite = state.floor.level === "site" || (state.floor.level === "feed" && !pod);
  const scene = onSite ? renderSite() : (openedPlan ? renderPlanChassis(planOpen) : (chassis && rack ? renderChassis(rack, pod) : renderHall()));
  const outside = state.floor.level === "site";
  const future = state.horizon === "future";
  const title = future ? (outside ? "Future · outside the building" : "Future · compute halls") : (outside ? "Outside the building" : "Level 1 · AI Hall");
  const sub = future
    ? "Future state of the whole system. Live control is unchanged. Hall 2, the second feeder, and restored BMC paths are shown as planned."
    : (outside ? "Follow the feeder from the grid to the hall wall. Follow the pipes from the coolers back to the shell. Enter the hall for the rows." : "Drag from the device library. Floor gear lands on the hall. Servers, switches, and PDUs land in a rack or enclosure.");
  return '<div class="page-head"><div class="top"><div><h1>' + title + '</h1><p class="sub">' + sub + "</p></div></div>" +
    pills() + '</div><div class="plan-layout">' + renderLibrary() + '<div class="floor-layout" data-floor-level="' + esc(state.floor.level) + '">' + scene + renderInspector() + "</div></div>" + watchTable();
}

function watchResult(login) {
  if (login === "reject") return "Rejected";
  if (login === "wait") return "Held";
  return "Logged in";
}

function watchTable() {
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

function futureOn() {
  return state.horizon === "future";
}

function managedDevices() {
  return devices.filter((d) => !d.serialOnly);
}

function shownBmc(d) {
  if (!d) return "up";
  if (futureOn() && d.bmc === "down") return "up";
  return d.bmc || "up";
}

function shownLoad(d) {
  const load = (d && d.load) || { gpu: 0, mem: 0, power: 0, temp: 46 };
  if (!futureOn()) return load;
  return {
    gpu: Math.min(62, load.gpu || 40),
    mem: Math.min(60, load.mem || 40),
    power: Math.min(64, load.power || 40),
    temp: Math.min(58, Math.max(42, (load.temp || 50) - 6)),
  };
}

function manageDevice() {
  return deviceById(state.manage.device) || managedDevices()[0];
}

function futureHallHtml() {
  if (!futureOn()) return "";
  return '<div class="pod future" data-act="horizon-focus" style="--x:250px;--y:78px;--w:250px;--h:180px"><i class="pod-plate"></i><span class="pod-letter">2</span>' +
    '<div class="aisle cold" style="--x:12px;--y:8px;--w:220px;--h:18px"><span>Cold aisle</span></div>' +
    '<span class="row-slot" style="--y:32px">North row</span>' +
    '<div class="aisle hot" style="--x:12px;--y:72px;--w:220px;--h:22px"><span>Hot aisle</span></div>' +
    '<span class="row-slot" style="--y:104px">South row</span>' +
    '<div class="aisle cold" style="--x:12px;--y:148px;--w:220px;--h:18px"><span>Cold aisle</span></div>' +
    '<span class="future-tag">Hall 2 · planned</span></div>';
}

function futureYardHtml() {
  if (!futureOn()) return "";
  const pieces = [
    { x: -360, y: 180, w: 100, d: 64, h: 52, cap: "Power module 2" },
    { x: 400, y: 210, w: 150, d: 56, h: 38, cap: "Heat rejection 2" },
  ];
  return pieces.map((item) => boxHtml(item, "ok", "horizon-focus", {
    klass: "future-gear", cap: item.cap, leds: [], color: "#8a9a84",
  })).join("");
}

function stackNodes() {
  const d = manageDevice();
  const load = shownLoad(d);
  const bmc = shownBmc(d);
  const hot = load.temp >= 75 || load.gpu >= 90;
  return [
    { id: "grid", name: "Grid", detail: futureOn() ? "2 feeders · 4.8 MW" : "1 feeder · 2.4 MW" },
    { id: "mv", name: "Substation", detail: "Medium voltage" },
    { id: "xfmr", name: "Transformer", detail: "MV transformer" },
    { id: "module", name: "Power module", detail: futureOn() ? "Live module + planned skid" : "Power module" },
    { id: "battery", name: "Battery", detail: "Ride-through skid" },
    { id: "bus", name: "Bus bar", detail: "Overhead PowerBar" },
    { id: "shelf", name: "DC shelf", detail: "50 VDC" },
    { id: "rack", name: "Rack", detail: "A14" },
    { id: "tray", name: "Tray", detail: d.name },
    { id: "bmc", name: "BMC", detail: bmc === "down" ? "Path dark" : "Manager up", pri: bmc === "down" ? 1 : 0 },
    { id: "chip", name: "Chip", detail: hot ? "GPU high" : "GPU", pri: hot ? 2 : 0 },
  ];
}

function chainHtml() {
  return '<div class="chain">' + stackNodes().map((node, index) => {
    const on = state.manage.layer === node.id ? " on" : "";
    const mark = node.pri ? '<b class="pri-mark pri-' + node.pri + '">' + node.pri + "</b>" : "";
    const arrow = index ? '<i aria-hidden="true">→</i>' : "";
    return arrow + '<button type="button" class="chain-node' + on + '" data-act="manage-layer" data-layer="' + node.id + '">' +
      mark + "<strong>" + esc(node.name) + "</strong><small>" + esc(node.detail) + "</small></button>";
  }).join("") + "</div>";
}

function horizonHtml() {
  return '<div class="horizon" role="group" aria-label="System horizon"><button type="button" data-act="horizon" data-horizon="now"' +
    (futureOn() ? "" : ' aria-pressed="true"') + '>Now</button><button type="button" data-act="horizon" data-horizon="future"' +
    (futureOn() ? ' aria-pressed="true"' : "") + ">Future</button></div>";
}

function sensorCell(label, value) {
  return '<div class="sensor"><b>' + esc(value) + "</b><span>" + esc(label) + "</span></div>";
}

function bmcPanel(d) {
  const live = d.bmc;
  const shown = shownBmc(d);
  const load = shownLoad(d);
  const outlet = outletByN(d.outlet);
  const locked = state.user.role === "ReadOnly";
  const power = outlet && outlet.power === "off" ? "Off" : "On";
  const firmware = futureOn() ? "2.4.1" : "1.8.4";
  const note = futureOn()
    ? "<p class=\"fine\">Future reading. Live control still uses the BMC that is installed now." +
      (live === "down" ? " Today this path is dark and ACS serial is the out-of-band manager." : "") + "</p>"
    : (live === "down"
      ? "<p>BMC path is dark. Out-of-band management is ACS serial. RM1048 does not take this failover.</p>"
      : "<p class=\"fine\">BMC is up. RM1048 is the in-band manager. ACS serial stays the out-of-band wire.</p>");
  const openLive = live === "down"
    ? '<button type="button" class="act primary" data-act="floor-serial" data-device="' + d.id + '">Open ACS serial</button>'
    : '<button type="button" class="act primary" data-act="launch" data-device="' + d.id + '" data-path="rm" data-type="kvm">Open BMC console</button>' +
      '<button type="button" class="act" data-act="launch" data-device="' + d.id + '" data-path="acs" data-type="serial" data-medium="rs232">Open ACS serial</button>';
  const cycle = d.outlet
    ? '<button type="button" class="act" data-act="outlet" data-outlet="' + d.outlet + '" data-op="cycle" data-source="manage"' +
      (locked ? " disabled" : "") + ">Cycle outlet " + d.outlet + "</button>"
    : "";
  return note + '<div class="sensor-row">' +
    sensorCell("Manager", shown === "down" ? "Dark" : "Up") +
    sensorCell("Firmware", firmware) +
    sensorCell("Power", power) +
    sensorCell("Inlet", Math.round(load.temp - 8) + " °C") +
    sensorCell("GPU", Math.round(load.temp) + " °C") +
    sensorCell("Tray power", Math.round(load.power) + "%") +
    sensorCell("Fans", Math.round(40 + load.power * 0.4) + "%") +
    sensorCell("Redfish", d.redfishId || "—") +
    "</div><div class=\"actions\">" + openLive + cycle + "</div>";
}

function chipPanel(d) {
  const load = shownLoad(d);
  if (d.kind !== "GPU tray") {
    return "<p class=\"fine\">" + esc(d.name) + " has no GPU package. The chip layer is the accelerator on a GPU tray.</p>";
  }
  const dies = [0, 1, 2, 3, 4, 5, 6, 7].map((index) => {
    const temp = Math.round(load.temp + ((index % 3) - 1) * 2);
    const watts = Math.round(90 + load.power * 1.4 + index);
    return '<div class="die"><b>GPU ' + (index + 1) + "</b><span>" + temp + " °C</span><span>" + watts + " W</span></div>";
  }).join("");
  return "<p class=\"fine\">Eight GPUs on " + esc(d.name) + ". Package power follows the tray BMC sensors.</p><div class=\"die-row\">" + dies + "</div>";
}

function layerCopy(id, d) {
  const future = futureOn();
  if (id === "grid") return "<p>Utility feed into the OneCore yard.</p><p class=\"fine\">" + (future ? "A second feeder is reserved. Nameplate rises from 2.4 MW to 4.8 MW." : "One feeder is in service at 2.4 MW.") + "</p>";
  if (id === "mv") return "<p>Medium-voltage substation between the grid and the transformer.</p><p class=\"fine\">Protection and metering sit here, before the power module.</p>";
  if (id === "xfmr") return "<p>MV transformer in the yard, ahead of the power module.</p>" + '<button type="button" class="act" data-act="floor-server" data-server="xfmr-1">Show it outside</button>';
  if (id === "module") return "<p>Power module rectifies and holds the hall.</p><p class=\"fine\">" + (future ? "A second module is planned beside the live skid." : "One module is installed.") + "</p>" + '<button type="button" class="act" data-act="floor-server" data-server="pwr-mod">Show it outside</button>';
  if (id === "battery") return "<p>Battery skid rides through a utility dip. It does not replace the BMC path.</p>" + '<button type="button" class="act" data-act="floor-server" data-server="batt-1">Show it outside</button>';
  if (id === "bus") return "<p>Overhead bus bar along the hot aisle. It feeds the 50 V DC shelves.</p>" + '<button type="button" class="act" data-act="floor-server" data-server="bus-a">Show bus bar A</button>';
  if (id === "shelf") return "<p>DC power shelf in rack A14. 50 V to the trays.</p>" + '<button type="button" class="act" data-act="select" data-device="pshelf">Open the shelf</button>';
  if (id === "rack") return "<p>Rack A14 is the ACS domain. One ACS, 48 serial ports.</p>" + '<button type="button" class="act" data-act="floor-rack" data-pod="pod-a" data-rack="A14">Open the rack</button>';
  if (id === "tray") return "<p>" + esc(d.name) + " · " + esc(d.kind) + " · U" + d.u + " · " + esc(d.tty) + ".</p>" + '<button type="button" class="act" data-act="select" data-device="' + d.id + '">Open on the rack</button>';
  if (id === "bmc") return bmcPanel(d);
  if (id === "chip") return chipPanel(d);
  return "";
}

function futureBrief() {
  const list = managedDevices();
  const dark = list.filter((d) => d.bmc === "down").length;
  const placed = state.plan.placements.length;
  const rows = [
    ["Grid", "2.4 MW · 1 feeder", "4.8 MW · 2 feeders"],
    ["Halls", "1 compute hall", "2 halls"],
    ["BMC paths", dark ? dark + " dark" : "All up", "All up"],
    ["Library plan", placed + " placed", placed ? placed + " built" : "None waiting"],
  ];
  const changes = ["Hall 2 is added, with a cold aisle, a contained hot aisle, and a bus bar."];
  if (dark) changes.push("Dark BMC paths are restored. ACS serial remains the out-of-band wire.");
  changes.push("A second feeder, power module, and heat-rejection skid land in the yard.");
  if (placed) changes.push(placed + " library " + (placed === 1 ? "piece is" : "pieces are") + " treated as built.");
  return '<aside class="future-card"><h2>' + (futureOn() ? "Future state" : "Now") + '</h2><p class="fine">The whole system, grid to chip. Switching horizon does not change live power or sessions.</p><table><tbody>' +
    rows.map((row) => "<tr><th>" + esc(row[0]) + "</th><td>" + esc(row[1]) + "</td><td>" + esc(row[2]) + "</td></tr>").join("") +
    "</tbody></table><h3>What the future adds</h3><ul>" + changes.map((line) => "<li>" + esc(line) + "</li>").join("") + "</ul>" +
    '<button type="button" class="act" data-act="nav" data-view="floor">Show this on the floor</button></aside>';
}

function renderManage() {
  const d = manageDevice();
  const picker = managedDevices().map((item) => '<button type="button" data-act="manage-device" data-device="' + item.id + '"' +
    (item.id === d.id ? ' aria-pressed="true"' : "") + ">" + esc(item.name) + "</button>").join("");
  const layer = stackNodes().find((node) => node.id === state.manage.layer) || stackNodes()[0];
  return '<div class="page-head"><div class="top"><div><h1>Data center management</h1><p class="sub">Grid to chip, including the BMC. Now is the live system. Future is the planned state of the whole site.</p></div></div>' +
    pills() + "</div>" + horizonHtml() + chainHtml() + '<div class="manage-grid"><section class="panel"><div class="panel-head"><h2>' +
    esc(layer.name) + "</h2><p class=\"fine\">" + esc(layer.detail) + "</p></div>" +
    (state.manage.layer === "bmc" || state.manage.layer === "chip" || state.manage.layer === "tray" ? '<div class="device-pick">' + picker + "</div>" : "") +
    layerCopy(state.manage.layer, d) + "</section>" + futureBrief() + "</div>";
}

function viewHtml() {
  if (state.view === "manage") return renderManage();
  if (state.view === "floor") return renderFloor();
  if (state.view === "map") return renderMap();
  if (state.view === "control") return renderControl();
  if (state.view === "sessions") return renderSessions();
  if (state.view === "audit") return renderAudit();
  return renderRack();
}

function shell() {
  return '<div class="shell" data-screen="app" data-view="' + state.view + '">' + rail() + "<main>" + alarmBanner() + toastHtml() +
    '<div class="view">' + viewHtml() + "</div></main>" + (state.labOpen ? lab() : "") + "</div>";
}

function captureFocus() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  return {
    id: el.id || "",
    key: el.dataset ? el.dataset.focusKey || "" : "",
    start: typeof el.selectionStart === "number" ? el.selectionStart : null,
    end: typeof el.selectionEnd === "number" ? el.selectionEnd : null,
  };
}

function restoreFocus(focus) {
  if (!focus) return;
  let next = focus.id ? document.getElementById(focus.id) : null;
  if (!next && focus.key) next = document.querySelector('[data-focus-key="' + focus.key + '"]');
  if (!next) return;
  next.focus();
  if (typeof focus.start === "number" && next.setSelectionRange) {
    try { next.setSelectionRange(focus.start, focus.end); } catch (err) { /* input type may reject */ }
  }
}

function settle() {
  state.focusSession = "";
  if (!state.focusTerm) return;
  const id = state.focusTerm;
  state.focusTerm = "";
  const el = document.querySelector('[data-session-input="' + id + '"]');
  if (!el) return;
  el.focus({ preventScroll: true });
  const term = el.closest(".term");
  if (term) term.scrollTop = term.scrollHeight;
}

function zoomFloor(dir) {
  if (dir === "reset") {
    state.floor.pitch = 56;
    state.floor.yaw = -40;
    state.floor.zoom = 0.78;
    state.floor.panX = 0;
    state.floor.panY = 0;
    state.floor.chassisPitch = 12;
    state.floor.chassisYaw = -18;
    state.floor.chassisZoom = 1;
  } else if (dir === "in") {
    state.floor.zoom = clamp(state.floor.zoom * 1.16, 0.42, 1.9);
    state.floor.chassisZoom = clamp(state.floor.chassisZoom * 1.12, 0.65, 1.85);
  } else {
    state.floor.zoom = clamp(state.floor.zoom / 1.16, 0.42, 1.9);
    state.floor.chassisZoom = clamp(state.floor.chassisZoom / 1.12, 0.65, 1.85);
  }
  applyCamera();
}

function render() {
  if (state.user) refreshSerialWatch();
  const focus = captureFocus();
  const viewKey = state.user ? state.view : "login";
  const viewChanged = viewKey !== lastRenderedView;
  lastRenderedView = viewKey;
  document.getElementById("app").innerHTML = state.user ? shell() : login();
  restoreFocus(focus);
  if (viewChanged) window.scrollTo(0, 0);
  settle();
  applyCamera();
  paintHeat();
}

function syncFields() {
  const wo = document.getElementById("wo-field");
  if (wo) state.wo = wo.value;
  const name = document.getElementById("maint-name");
  if (name) state.maintName = name.value;
  const tag = document.getElementById("asset-tag");
  if (tag) state.assetTagDraft = tag.value;
  const mwo = document.getElementById("maint-wo");
  if (mwo) state.maintWo = mwo.value;
}

function onClick(event) {
  const el = event.target.closest("[data-act]");
  if (!el || el.disabled) return;
  syncFields();
  const act = el.dataset.act;
  if (act === "login") {
    signIn(el.dataset.user);
    return;
  }
  if (!state.user) return;
  if (state.floor.suppressClick) {
    state.floor.suppressClick = false;
    return;
  }
  if (act === "signout") signOut();
  else if (act === "nav") go(el.dataset.view);
  else if (act === "horizon") { state.horizon = el.dataset.horizon === "future" ? "future" : "now"; render(); }
  else if (act === "contain") { state.containment = el.dataset.mode === "cac" ? "cac" : "hac"; render(); }
  else if (act === "horizon-focus") { state.horizon = "future"; state.view = "manage"; render(); }
  else if (act === "manage-layer") { state.manage.layer = el.dataset.layer || "bmc"; render(); }
  else if (act === "manage-device") { state.manage.device = el.dataset.device; state.selected = el.dataset.device; render(); }
  else if (act === "select") selectDevice(el.dataset.device);
  else if (act === "launch") {
    const medium = el.dataset.medium || (el.dataset.type === "serial" && el.dataset.path === "acs" ? "rs232" : "");
    openSession(el.dataset.device, el.dataset.path, el.dataset.type, medium);
  } else if (act === "fallback") fallback(el.dataset.device, el.dataset.type);
  else if (act === "refuse") refuseEndpoint(el.dataset.key);
  else if (act === "outlet") actOutlet(Number(el.dataset.outlet), el.dataset.op, el.dataset.source || "");
  else if (act === "all-outlets") actAll();
  else if (act === "mount") toggleMedia(el.dataset.session);
  else if (act === "screen") setScreen(el.dataset.session, el.dataset.screen);
  else if (act === "close-session") closeSession(el.dataset.session);
  else if (act === "lab-open") { state.labOpen = true; render(); }
  else if (act === "lab-close") { state.labOpen = false; render(); }
  else if (act === "bmc-toggle") toggleBmc(el.dataset.device);
  else if (act === "floor-pod") openPod(el.dataset.pod);
  else if (act === "floor-row") openRow(el.dataset.pod, el.dataset.row);
  else if (act === "floor-feed") openFeed(el.dataset.pod, el.dataset.feed);
  else if (act === "floor-part") openPart(el.dataset.server, el.dataset.part);
  else if (act === "floor-rack") openRack(el.dataset.pod, el.dataset.rack);
  else if (act === "floor-server") openFloorServer(el.dataset.server);
  else if (act === "floor-go") goFloor(el.dataset.level);
  else if (act === "floor-serial") floorSerial(el.dataset.device);
  else if (act === "rdp-open") openSession(el.dataset.device, "rdp", "desktop", "");
  else if (act === "rdp-drop" || act === "rdp-failover") failRdpToKvm(el.dataset.device);
  else if (act === "rdp-toggle") {
    const mapped = deviceById(el.dataset.device);
    if (mapped && mapped.rdp === "up") failRdpToKvm(mapped.id);
    else restoreRdp(el.dataset.device);
  }
  else if (act === "watch-toggle") {
    const mapped = deviceById(el.dataset.device);
    if (mapped) mapped.watchDeny = !mapped.watchDeny;
    render();
  }
  else if (act === "floor-zoom") zoomFloor(el.dataset.dir);
  else if (act === "alarm-ack") ackAlarm(el.dataset.alarm);
  else if (act === "alarm-go") goAlarm(el.dataset.alarm);
  else if (act === "plan-maker") { state.plan.maker = el.dataset.maker; render(); }
  else if (act === "plan-preview") {
    state.plan.preview = el.dataset.catalog;
    state.plan.selected = "";
    render();
  }
  else if (act === "plan-select") {
    state.plan.selected = el.dataset.plan;
    state.plan.preview = "";
    render();
  }
  else if (act === "plan-open") openPlan(el.dataset.plan);
  else if (act === "plan-remove") removePlan(el.dataset.plan);
  else if (act === "plan-nudge") nudgePlan(el.dataset.plan, el.dataset.dir);
  else if (act === "rm-toggle") toggleRm();
  else if (act === "leak-toggle") toggleLeak();
  else if (act === "maint-toggle") toggleMaint();
  else if (act === "reset-world") resetWorld();
  else if (act === "asset") saveAsset();
  else if (act === "dismiss-toast") { state.toast = ""; render(); }
  else if (act === "show-outlet") showOutlet(el.dataset.outlet);
}

function onSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.dataset.act !== "serial-line") return;
  event.preventDefault();
  sendSerial(form.dataset.session, new FormData(form).get("line"));
}

function onInput(event) {
  const target = event.target;
  if (target.id === "wo-field") state.wo = target.value;
  if (target.id === "maint-name") state.maintName = target.value;
  if (target.id === "maint-wo") state.maintWo = target.value;
  if (target.id === "asset-tag") state.assetTagDraft = target.value;
}

function onChange(event) {
  const target = event.target;
  if (!target.dataset || !target.dataset.mediaFor) return;
  const session = sessionById(target.dataset.mediaFor);
  if (session) session.mediaChoice = target.value;
}

function onKeyDown(event) {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches && event.target.matches("[role='button'][data-act]")) {
    event.preventDefault();
    event.target.click();
    return;
  }
  const zone = event.target.closest ? event.target.closest("[data-kvm]") : null;
  if (!zone) return;
  if (event.target.matches && event.target.matches("input, select, textarea, button")) return;
  const session = sessionById(zone.dataset.kvm);
  if (!session || sessionBlocked(session)) return;
  if (event.metaKey || event.ctrlKey || event.altKey || event.key === "Tab") return;
  const ch = event.key.length === 1 ? event.key : (event.key === "Enter" ? "↵" : "");
  if (!ch) return;
  event.preventDefault();
  session.keys = (session.keys + ch).slice(-32);
  const out = zone.querySelector("[data-keys]");
  if (out) out.textContent = session.keys;
}

function updateCountdowns() {
  document.querySelectorAll("[data-countdown-for]").forEach((el) => {
    const d = deviceById(el.getAttribute("data-countdown-for"));
    if (!d || !d.serialReadyAt) return;
    const total = d.serialFailoverTotal || serialFailoverMs;
    const leftMs = Math.max(0, d.serialReadyAt - Date.now());
    const left = Math.ceil(leftMs / 1000);
    el.querySelectorAll("[data-countdown-num]").forEach((n) => { n.textContent = String(left); });
    const pct = Math.min(100, ((total - leftMs) / total) * 100);
    el.querySelectorAll("[data-countdown-bar]").forEach((bar) => { bar.style.width = pct.toFixed(1) + "%"; });
  });
}

function tick() {
  const readyNames = [];
  devices.forEach((d) => {
    if (d.bmc === "down" && d.serialReadyAt && !d.serialAnnounced && Date.now() >= d.serialReadyAt) {
      d.serialAnnounced = true;
      const elapsed = Math.max(1, Math.round((Date.now() - d.bmcLostAt) / 1000));
      audit({
        user: "ACS-A14",
        role: "appliance",
        action: "serial ready",
        asset: d.name,
        detail: d.tty + " ready " + elapsed + "s after BMC path loss on ACS",
      });
      readyNames.push(d.name);
    }
  });
  if (readyNames.length && state.user) {
    state.toast = readyNames.join(", ") + " serial is up on ACS.";
    render();
  } else {
    updateCountdowns();
  }
}

window.AccessDemo = {
  state,
  devices,
  outlets,
  setFailoverMs(ms) { serialFailoverMs = ms; },
  finishFailover(id) {
    const d = deviceById(id);
    if (d && d.serialReadyAt) d.serialReadyAt = Date.now() - 5;
  },
  pushLoad(id, patch) {
    const entity = entityById(id);
    if (!entity || !entity.load) return;
    Object.assign(entity.load, patch);
    stepCapacity();
  },
};

function scenePoint(event) {
  const scene = event.target.closest(".scene");
  const rect = scene.getBoundingClientRect();
  const nx = (event.clientX - rect.left) / rect.width - 0.5;
  const ny = (event.clientY - rect.top) / rect.height - 0.5;
  return {
    x: clamp(Math.round((nx * 860) / 24) * 24, -480, 460),
    y: clamp(Math.round((ny * 520) / 24) * 24, -300, 280),
  };
}

function dropTarget(node) {
  const token = dragToken;
  const specItem = token.indexOf("new:") === 0 ? catalogById(token.slice(4)) : null;
  const moving = token.indexOf("move:") === 0 ? placementById(token.slice(5)) : null;
  const place = specItem ? specItem.place : (moving ? moving.place : "");
  const scene = node.closest(".scene");
  const planHost = node.closest("[data-plan-host]");
  const rackHost = node.closest("[data-rack-host]");
  const rackBox = node.closest(".rackbox");
  if (place === "yard") {
    if (!scene || !scene.classList.contains("site-scene")) return { ok: false, el: scene };
    return { ok: true, el: scene, kind: "floor" };
  }
  if (place === "floor") {
    if (!scene || scene.classList.contains("chassis-scene") || scene.classList.contains("site-scene")) return { ok: false, el: scene };
    return { ok: true, el: scene, kind: "floor" };
  }
  if (place !== "rack") return { ok: false, el: scene };
  if (planHost) return { ok: true, el: planHost, kind: "rack", host: planHost.getAttribute("data-plan-host") };
  if (rackHost) return { ok: true, el: rackHost, kind: "rack", host: rackHost.getAttribute("data-rack-host") };
  if (rackBox && rackBox.dataset.plan) {
    const placed = placementById(rackBox.dataset.plan);
    if (placed && catalogById(placed.catalogId).uCapacity) return { ok: true, el: rackBox, kind: "rack", host: placed.id };
  }
  if (rackBox && rackBox.dataset.rack) return { ok: true, el: rackBox, kind: "rack", host: rackBox.dataset.rack };
  return { ok: false, el: scene };
}

function placeCatalog(specItem, host, point) {
  if (specItem.place === "rack") {
    const need = specItem.u || 0;
    if (freeU(host) < need) {
      state.toast = specItem.name + " needs " + need + "U. " + Math.max(0, freeU(host)) + "U is free there.";
      render();
      return;
    }
  }
  const count = state.plan.placements.filter((item) => item.catalogId === specItem.id).length + 1;
  const item = {
    id: "plan-" + state.plan.seq,
    catalogId: specItem.id,
    name: specItem.name + " " + count,
    place: specItem.place,
    x: point ? point.x : 0,
    y: point ? point.y : 0,
    host: host || "",
  };
  state.plan.seq += 1;
  state.plan.placements.push(item);
  state.plan.selected = item.id;
  state.plan.preview = "";
  state.toast = item.name + " placed. " + specItem.powerLabel + " · " + specItem.ampLabel + ".";
  if (specItem.place === "rack") {
    const podId = podForRack(host);
    state.view = "floor";
    state.floor.level = "rack";
    state.floor.rackId = host;
    state.floor.serverId = "";
    if (podId) state.floor.podId = podId;
  }
  render();
}

function podForRack(rackId) {
  let found = "";
  PODS.forEach((pod) => {
    if (pod.racks.some((rack) => rack.id === rackId)) found = pod.id;
  });
  return found;
}

function openPlan(id) {
  const item = placementById(id);
  if (!item) return;
  state.view = "floor";
  state.floor.level = "rack";
  state.floor.rackId = id;
  state.floor.serverId = "";
  state.plan.selected = id;
  render();
}

function removePlan(id) {
  state.plan.placements = state.plan.placements.filter((item) => item.id !== id && item.host !== id);
  if (state.floor.rackId === id) {
    state.floor.level = "hall";
    state.floor.rackId = "A14";
  }
  if (state.plan.selected === id) state.plan.selected = "";
  state.toast = "Removed from the plan.";
  render();
}

function nudgePlan(id, dir) {
  const item = placementById(id);
  if (!item || (item.place !== "floor" && item.place !== "yard")) return;
  if (dir === "left") item.x -= 24;
  if (dir === "right") item.x += 24;
  if (dir === "up") item.y -= 24;
  if (dir === "down") item.y += 24;
  item.x = clamp(item.x, -480, 460);
  item.y = clamp(item.y, -300, 280);
  render();
}

function onDragStart(event) {
  const card = event.target.closest("[data-catalog], .planned");
  if (!card) return;
  dragToken = card.dataset.catalog ? "new:" + card.dataset.catalog : "move:" + card.dataset.plan;
  event.dataTransfer.setData("text/plain", dragToken);
  event.dataTransfer.effectAllowed = "copy";
}

function onDragOver(event) {
  if (!dragToken) return;
  const scene = event.target.closest(".scene");
  if (!scene) return;
  event.preventDefault();
  const host = dropTarget(event.target);
  document.querySelectorAll(".drop-ready, .drop-no").forEach((el) => el.classList.remove("drop-ready", "drop-no"));
  const specItem = dragToken.indexOf("new:") === 0 ? catalogById(dragToken.slice(4)) : null;
  const moving = dragToken.indexOf("move:") === 0 ? placementById(dragToken.slice(5)) : null;
  const place = specItem ? specItem.place : (moving ? moving.place : "");
  const mark = host.ok ? (host.el || scene) : scene;
  mark.classList.add(host.ok ? "drop-ready" : "drop-no");
  scene.dataset.drop = host.ok
    ? (place === "yard" ? "Release to place outside the building" : (place === "floor" ? "Release to place on the floor" : "Release to mount in the rack"))
    : (place === "yard" ? "This piece sits outside the building" : (place === "rack" ? "Rack gear mounts inside a rack" : "This piece sits on the hall floor"));
}

function onDragEnd() {
  dragToken = "";
  document.querySelectorAll(".drop-ready, .drop-no, [data-drop]").forEach((el) => {
    el.classList.remove("drop-ready", "drop-no");
    delete el.dataset.drop;
  });
}

function onDrop(event) {
  const token = dragToken;
  if (!token) return;
  event.preventDefault();
  const host = dropTarget(event.target);
  onDragEnd();
  if (!host.ok) {
    const specItem = token.indexOf("new:") === 0 ? catalogById(token.slice(4)) : null;
    state.toast = specItem && specItem.place === "rack"
      ? "Drop that onto a rack, or open an enclosure first."
      : (specItem && specItem.place === "yard" ? "Drop that outside the building." : "Drop floor gear on the hall.");
    render();
    return;
  }
  if (token.indexOf("move:") === 0) {
    const item = placementById(token.slice(5));
    if (item && (item.place === "floor" || item.place === "yard")) {
      const point = scenePoint(event);
      item.x = point.x;
      item.y = point.y;
      state.plan.selected = item.id;
      state.toast = item.name + " moved.";
      render();
    }
    return;
  }
  const specItem = catalogById(token.slice(4));
  if (!specItem) return;
  if (specItem.place === "floor") placeCatalog(specItem, "", scenePoint(event));
  else placeCatalog(specItem, host.host, null);
}

function boot() {
  applyCapacitySeed();
  assertWorld();
  document.body.addEventListener("click", onClick);
  document.body.addEventListener("submit", onSubmit);
  document.body.addEventListener("input", onInput);
  document.body.addEventListener("change", onChange);
  document.body.addEventListener("keydown", onKeyDown);
  document.body.addEventListener("pointerdown", onPointerDown);
  document.body.addEventListener("pointermove", onPointerMove);
  document.body.addEventListener("pointerup", onPointerUp);
  document.body.addEventListener("pointercancel", onPointerUp);
  document.body.addEventListener("wheel", onWheel, { passive: false });
  document.body.addEventListener("dragstart", onDragStart);
  document.body.addEventListener("dragover", onDragOver);
  document.body.addEventListener("drop", onDrop);
  document.body.addEventListener("dragend", onDragEnd);
  setInterval(tick, 250);
  setInterval(stepCapacity, 1000);
  render();
}

try {
  boot();
} catch (error) {
  document.getElementById("app").textContent = "Access could not start. " + (error && error.message ? error.message : "Reload the page.");
}
