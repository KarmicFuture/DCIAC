import { SERIAL_FAILOVER_MS, deviceById, devices } from "../data/devices";
import { LOAD_SEED, entityScore, heatBand, infra, neighbors, nudge } from "../data/pods";
import { audit } from "./audit";
import { rmBlockCopy } from "./single-master";
import { runtime, state } from "../state";
import { esc } from "../ui/format";
import { render } from "../ui/schedule";
import { updateFloorMeters } from "../views/floor";

export function waiting(d) {
  return !!(d && d.bmc === "down" && d.serialReadyAt && Date.now() < d.serialReadyAt);
}

export function acsWaiting(s) {
  if (!s || s.path !== "acs" || s.type !== "serial") return false;
  return waiting(deviceById(s.deviceId));
}

export function bmcText(d) {
  if (d.bmc === "up") return "Up";
  if (waiting(d)) return "Dark · failing over to ACS";
  return "Dark · on ACS";
}

export function loseBmc(mapped, navigate) {
  if (!mapped || mapped.bmc === "down") return;
  mapped.bmc = "down";
  mapped.bmcLostAt = Date.now();
  mapped.serialReadyAt = Date.now() + runtime.serialFailoverMs;
  mapped.serialFailoverTotal = runtime.serialFailoverMs;
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

export function toggleBmc(id) {
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

export function failBox(deviceId, type) {
  const mapped = deviceById(deviceId);
  if (!mapped || mapped.bmc === "down" || !state.fails[deviceId + ":" + type]) return "";
  return '<div class="fail" role="status"><p>' + esc(rmBlockCopy(mapped, type)) +
    '</p><button type="button" class="act primary" data-act="fallback" data-device="' +
    mapped.id + '" data-type="' + type + '">Open on ACS</button></div>';
}

export function failoverBanner(d) {
  if (d.bmc !== "down") return "";
  const lead = waiting(d)
    ? "BMC path lost. Out-of-band serial is coming up on ACS."
    : "BMC path is dark. Out-of-band management is on ACS.";
  return '<div class="status hold" role="status"><p>' + esc(lead) + " RM1048 does not take this failover.</p>" +
    '<div class="actions"><button type="button" class="act primary" data-act="fallback" data-device="' + d.id +
    '" data-type="serial">Open serial on ACS</button><button type="button" class="act primary" data-act="fallback" data-device="' +
    d.id + '" data-type="kvm">Open KVM on ACS</button></div></div>';
}

export function countdownBlock(d, lead) {
  const total = d.serialFailoverTotal || runtime.serialFailoverMs;
  const leftMs = Math.max(0, d.serialReadyAt - Date.now());
  const pct = Math.min(100, ((total - leftMs) / total) * 100);
  return '<div class="wait" data-countdown-for="' + d.id + '"><p>' + esc(lead) + '</p><p class="wait-num"><span data-countdown-num>' +
    Math.ceil(leftMs / 1000) + '</span>s</p><div class="meter" aria-hidden="true"><span data-countdown-bar style="width:' +
    pct.toFixed(1) + '%"></span></div><p class="fine">Target is within ' + Math.round(total / 1000) +
    " seconds of path loss.</p></div>";
}

export function applyCapacitySeed() {
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

export function stepCapacity() {
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

export function updateCountdowns() {
  document.querySelectorAll("[data-countdown-for]").forEach((el) => {
    const d = deviceById(el.getAttribute("data-countdown-for"));
    if (!d || !d.serialReadyAt) return;
    const total = d.serialFailoverTotal || runtime.serialFailoverMs;
    const leftMs = Math.max(0, d.serialReadyAt - Date.now());
    const left = Math.ceil(leftMs / 1000);
    el.querySelectorAll("[data-countdown-num]").forEach((n) => { n.textContent = String(left); });
    const pct = Math.min(100, ((total - leftMs) / total) * 100);
    el.querySelectorAll("[data-countdown-bar]").forEach((bar) => { bar.style.width = pct.toFixed(1) + "%"; });
  });
}

export function tick() {
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
