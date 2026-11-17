import { deviceById, devices } from "../data/devices";
import { outlets } from "../data/outlets";
import {
  PLANT,
  PODS,
  YARD,
  entityById,
  heatBand,
  infra,
  isFacility,
  podById,
  rackEntities,
} from "../data/pods";
import { runtime, setSimSeed, simRandom, state } from "../state";
import { clamp, esc } from "../ui/format";
import { render } from "../ui/schedule";
import { audit } from "./audit";
import { applyCapacitySeed, loseBmc, stepCapacity } from "./failover";
import { setLeak } from "./leak";
import { failRdpToKvm, restoreRdp } from "./sessions";

export const SIM_SPEEDS = [1, 10, 60] as const;

export type Sim = typeof runtime.sim;

export type BreakCascade = {
  afterMs: number;
  run: (targetId: string, sim: Sim) => void;
};

export type BreakEvent = {
  id: string;
  title: string;
  targetKind: string;
  apply: (targetId: string, sim: Sim) => void;
  revert: (targetId: string, sim: Sim) => void;
  cascade: BreakCascade[];
};

function undoKey(eventId: string, targetId: string) {
  return eventId + ":" + (targetId || "");
}

function stash(sim: Sim, eventId: string, targetId: string, value: any) {
  sim.undo[undoKey(eventId, targetId)] = value;
}

function take(sim: Sim, eventId: string, targetId: string) {
  const key = undoKey(eventId, targetId);
  const value = sim.undo[key];
  delete sim.undo[key];
  return value;
}

export function yardByKind(kind: string) {
  return YARD.filter((item) => item.kind === kind);
}

export function gridFeeders() {
  return yardByKind("Grid");
}

export function heatRejectors() {
  return yardByKind("Heat rejection");
}

export function hallCdus() {
  return infra.filter((item) => item.kind === "Cooling" && !item.yard);
}

export function cduForHall(hallId: string) {
  return hallCdus().find((item) => item.pod === hallId) || null;
}

export function hallForCdu(cduId: string) {
  const cdu = entityById(cduId);
  return cdu && cdu.pod ? String(cdu.pod) : "";
}

function hallRackLoads(hallId: string) {
  const pod = podById(hallId);
  if (!pod) return [] as any[];
  const fromRacks = pod.racks.flatMap((rack) => rackEntities(rack));
  const managed = devices.filter((d) => d.rack && pod.racks.some((rack) => rack.id === d.rack));
  const seen = new Set<string>();
  const out: any[] = [];
  fromRacks.concat(managed).forEach((entity) => {
    if (!entity || seen.has(entity.id)) return;
    seen.add(entity.id);
    out.push(entity);
  });
  return out;
}

function setFeederDown(sim: Sim, feederId: string, down: boolean) {
  if (!feederId) return;
  if (!!sim.feedersDown[feederId] === !!down) return;
  const entity = entityById(feederId);
  if (entity && entity.load) {
    if (down) {
      stash(sim, "feeder-load", feederId, { power: entity.load.power, drift: entity.load.drift, bmc: entity.bmc });
      entity.load.power = 4;
      entity.load.drift = 0;
      entity.bmc = "down";
    } else {
      const prev = take(sim, "feeder-load", feederId);
      if (prev) {
        entity.load.power = prev.power;
        entity.load.drift = prev.drift;
        entity.bmc = prev.bmc;
      } else {
        entity.bmc = "up";
        if (entity.seed) entity.load = Object.assign({}, entity.seed);
      }
    }
  }
  if (down) sim.feedersDown[feederId] = true;
  else delete sim.feedersDown[feederId];
}

function degradeCdu(sim: Sim, cduId: string) {
  const cdu = entityById(cduId);
  if (!cdu || !cdu.load) return;
  stash(sim, "cdu-failure", cduId, {
    power: cdu.load.power,
    temp: cdu.load.temp,
    drift: cdu.load.drift,
    racks: hallRackLoads(cdu.pod).map((entity) => ({
      id: entity.id,
      drift: entity.load ? entity.load.drift : 0,
    })),
  });
  cdu.load.power = Math.min(cdu.load.power, 18);
  cdu.load.drift = 0.45;
  cdu.load.temp = Math.max(cdu.load.temp, 48);
  hallRackLoads(cdu.pod).forEach((entity) => {
    if (!entity.load) return;
    entity.load.drift = Math.max(entity.load.drift || 0, 0.32);
  });
}

function restoreCdu(sim: Sim, cduId: string) {
  const prev = take(sim, "cdu-failure", cduId);
  const cdu = entityById(cduId);
  if (cdu && cdu.load && prev) {
    cdu.load.power = prev.power;
    cdu.load.temp = prev.temp;
    cdu.load.drift = prev.drift;
  }
  (prev && prev.racks ? prev.racks : []).forEach((row) => {
    const entity = entityById(row.id);
    if (entity && entity.load) entity.load.drift = row.drift;
  });
}

function resolveCduId(targetId: string) {
  const entity = entityById(targetId);
  if (entity && entity.kind === "Cooling") return entity.id;
  const fromHall = cduForHall(targetId);
  if (fromHall) return fromHall.id;
  const fallback = hallCdus()[0];
  return fallback ? fallback.id : targetId || "";
}

function pushThermal(cduId: string) {
  const id = resolveCduId(cduId);
  const hallId = hallForCdu(id);
  hallRackLoads(hallId).forEach((entity) => {
    if (!entity.load) return;
    if (heatBand(entity) === "critical" || heatBand(entity) === "failover") return;
    entity.load.drift = Math.max(entity.load.drift || 0, 0.4);
    entity.load.temp = Math.min(96, (entity.load.temp || 40) + 4);
  });
  const cdu = entityById(id);
  if (cdu && cdu.load) {
    cdu.load.power = Math.min(cdu.load.power, 14);
    cdu.load.temp = Math.min(80, cdu.load.temp + 3);
    cdu.load.drift = Math.max(cdu.load.drift || 0, 0.5);
  }
}

export const EVENTS: BreakEvent[] = [
  {
    id: "bmc-loss",
    title: "BMC path loss",
    targetKind: "device",
    apply(targetId, sim) {
      const mapped = deviceById(targetId);
      if (!mapped) return;
      stash(sim, "bmc-loss", targetId, { bmc: mapped.bmc, serialReadyAt: mapped.serialReadyAt });
      if (mapped.bmc !== "down") loseBmc(mapped, !runtime.sim.stay);
    },
    revert(targetId, sim) {
      const mapped = deviceById(targetId);
      const prev = take(sim, "bmc-loss", targetId);
      if (!mapped || !prev) return;
      mapped.bmc = prev.bmc || "up";
      mapped.serialReadyAt = prev.serialReadyAt || 0;
      mapped.serialAnnounced = true;
      if (mapped.load) mapped.load.failover = false;
      delete state.fails[targetId + ":serial"];
      delete state.fails[targetId + ":kvm"];
    },
    cascade: [],
  },
  {
    id: "rdp-loss",
    title: "RDP loss",
    targetKind: "device",
    apply(targetId, sim) {
      const mapped = deviceById(targetId);
      if (!mapped) return;
      stash(sim, "rdp-loss", targetId, mapped.rdp);
      if (mapped.rdp !== "down") failRdpToKvm(mapped.id);
    },
    revert(targetId, sim) {
      const prev = take(sim, "rdp-loss", targetId);
      if (prev === "up" || prev == null) restoreRdp(targetId);
    },
    cascade: [],
  },
  {
    id: "watch-deny",
    title: "Serial auto-login rejected",
    targetKind: "device",
    apply(targetId, sim) {
      const mapped = deviceById(targetId);
      if (!mapped) return;
      stash(sim, "watch-deny", targetId, !!mapped.watchDeny);
      mapped.watchDeny = true;
      mapped.watch = null;
    },
    revert(targetId, sim) {
      const mapped = deviceById(targetId);
      const prev = take(sim, "watch-deny", targetId);
      if (!mapped) return;
      mapped.watchDeny = !!prev;
    },
    cascade: [],
  },
  {
    id: "leak-trip",
    title: "Leak rope trip",
    targetKind: "site",
    apply(_targetId, sim) {
      stash(sim, "leak-trip", "", !!state.leak);
      if (!state.leak) setLeak(true, true);
    },
    revert(_targetId, sim) {
      const prev = take(sim, "leak-trip", "");
      if (!prev) setLeak(false, true);
    },
    cascade: [],
  },
  {
    id: "rm1048-dark",
    title: "RM1048 plane dark",
    targetKind: "plane",
    apply(_targetId, sim) {
      stash(sim, "rm1048-dark", "", state.rm1048);
      if (state.rm1048 === "healthy") {
        state.rm1048 = "dark";
        audit({
          user: "RM1048",
          role: "plane",
          action: "plane dark",
          detail: "ACS may cycle bound outlets.",
        });
      }
    },
    revert(_targetId, sim) {
      const prev = take(sim, "rm1048-dark", "");
      state.rm1048 = prev || "healthy";
      if (state.rm1048 === "healthy") state.fails = {};
    },
    cascade: [],
  },
  {
    id: "outlet-open",
    title: "Outlet open",
    targetKind: "outlet",
    apply(targetId, sim) {
      const outlet = outlets.find((row) => String(row.n) === String(targetId));
      if (!outlet) return;
      stash(sim, "outlet-open", targetId, outlet.power);
      outlet.power = "off";
    },
    revert(targetId, sim) {
      const outlet = outlets.find((row) => String(row.n) === String(targetId));
      const prev = take(sim, "outlet-open", targetId);
      if (outlet) outlet.power = prev || "on";
    },
    cascade: [],
  },
  {
    id: "rack-pdu-open",
    title: "Rack PDU open",
    targetKind: "rack",
    apply(targetId, sim) {
      const hits = outlets.filter((row) => {
        if (!row.deviceId) return false;
        const mapped = deviceById(row.deviceId);
        return !!(mapped && mapped.rack === targetId);
      });
      stash(sim, "rack-pdu-open", targetId, hits.map((row) => ({ n: row.n, power: row.power })));
      hits.forEach((row) => { row.power = "off"; });
    },
    revert(targetId, sim) {
      const prev = take(sim, "rack-pdu-open", targetId) || [];
      prev.forEach((row) => {
        const outlet = outlets.find((item) => item.n === row.n);
        if (outlet) outlet.power = row.power || "on";
      });
    },
    cascade: [],
  },
  {
    id: "feeder-a-loss",
    title: "Feeder A loss",
    targetKind: "feeder",
    apply(targetId, sim) {
      const feeders = gridFeeders();
      const match = feeders.find((item) => item.id === targetId);
      const id = (match && match.id) || (feeders[0] && feeders[0].id) || "";
      if (!id) return;
      setFeederDown(sim, id, true);
      audit({ user: "plant", role: "system", action: "feeder loss", asset: id, detail: "Side A open" });
    },
    revert(targetId, sim) {
      const feeders = gridFeeders();
      const match = feeders.find((item) => item.id === targetId);
      const id = (match && match.id) || (feeders[0] && feeders[0].id) || "";
      if (id) setFeederDown(sim, id, false);
    },
    cascade: [],
  },
  {
    id: "feeder-b-loss",
    title: "Feeder B loss",
    targetKind: "feeder",
    apply(targetId, sim) {
      const feeders = gridFeeders();
      const match = feeders.find((item) => item.id === targetId);
      const id = (match && match.id) || (feeders[1] && feeders[1].id) || "";
      if (!id) return;
      setFeederDown(sim, id, true);
      audit({ user: "plant", role: "system", action: "feeder loss", asset: id, detail: "Side B open" });
    },
    revert(targetId, sim) {
      const feeders = gridFeeders();
      const match = feeders.find((item) => item.id === targetId);
      const id = (match && match.id) || (feeders[1] && feeders[1].id) || "";
      if (id) setFeederDown(sim, id, false);
    },
    cascade: [],
  },
  {
    id: "feeders-both-loss",
    title: "Both feeders lost",
    targetKind: "site",
    apply(_targetId, sim) {
      const ids = gridFeeders().map((item) => item.id);
      stash(sim, "feeders-both-loss", "", ids.slice());
      ids.forEach((id) => setFeederDown(sim, id, true));
      audit({ user: "plant", role: "system", action: "feeder loss", detail: "Both utility feeders open" });
    },
    revert(_targetId, sim) {
      const ids = take(sim, "feeders-both-loss", "") || gridFeeders().map((item) => item.id);
      ids.forEach((id) => setFeederDown(sim, id, false));
    },
    cascade: [],
  },
  {
    id: "cdu-failure",
    title: "CDU failure",
    targetKind: "cdu",
    apply(targetId, sim) {
      const cduId = resolveCduId(targetId);
      if (!cduId || !entityById(cduId)) return;
      if (sim.active["cdu-failure:" + cduId]) return;
      degradeCdu(sim, cduId);
      sim.active["cdu-failure:" + cduId] = cduId;
      audit({
        user: "plant",
        role: "system",
        action: "CDU failure",
        asset: cduId,
        detail: "Hall racks are drifting hot",
      });
    },
    revert(targetId, sim) {
      const cduId = sim.undo[undoKey("cdu-failure", targetId)]
        ? targetId
        : resolveCduId(targetId);
      restoreCdu(sim, cduId);
      delete sim.active["cdu-failure:" + cduId];
    },
    cascade: [
      { afterMs: 4000, run: pushThermal },
      { afterMs: 10000, run: pushThermal },
      {
        afterMs: 18000,
        run(targetId) {
          const hallId = hallForCdu(resolveCduId(targetId)) || targetId;
          hallRackLoads(hallId).forEach((entity) => {
            if (!entity.load) return;
            entity.load.temp = Math.max(entity.load.temp, 92);
            entity.load.drift = Math.max(entity.load.drift || 0, 0.5);
          });
        },
      },
    ],
  },
  {
    id: "heat-rejection-trip",
    title: "Heat rejection trip",
    targetKind: "yard",
    apply(targetId, sim) {
      const units = heatRejectors();
      const focus = targetId ? units.filter((item) => item.id === targetId) : units;
      const ids = (focus.length ? focus : units).map((item) => item.id);
      stash(sim, "heat-rejection-trip", targetId || "", ids.map((id) => {
        const entity = entityById(id);
        return entity && entity.load
          ? { id, power: entity.load.power, temp: entity.load.temp, drift: entity.load.drift, bmc: entity.bmc }
          : { id };
      }));
      ids.forEach((id) => {
        const entity = entityById(id);
        if (!entity || !entity.load) return;
        entity.load.power = 8;
        entity.load.drift = 0.5;
        entity.load.temp = Math.max(entity.load.temp, 55);
        entity.bmc = "down";
      });
      audit({
        user: "plant",
        role: "system",
        action: "heat rejection trip",
        asset: ids.join(", "),
        detail: "Yard coolers open; hall CDUs will degrade",
      });
    },
    revert(targetId, sim) {
      const prev = take(sim, "heat-rejection-trip", targetId || "") || [];
      prev.forEach((row) => {
        const entity = entityById(row.id);
        if (!entity || !entity.load) return;
        if (row.power != null) {
          entity.load.power = row.power;
          entity.load.temp = row.temp;
          entity.load.drift = row.drift;
          entity.bmc = row.bmc || "up";
        }
      });
    },
    cascade: [
      {
        afterMs: 6000,
        run(_targetId, sim) {
          hallCdus().forEach((cdu) => {
            fireEvent("cdu-failure", cdu.id, { quiet: true });
          });
          if (state.user) render();
        },
      },
    ],
  },
];

export function eventById(id: string) {
  return EVENTS.find((item) => item.id === id) || null;
}

export function syncSimClock() {
  const sim = runtime.sim;
  const wall = Date.now();
  if (!sim.wallAt) {
    sim.wallAt = wall;
    return sim.now;
  }
  if (sim.paused) {
    sim.wallAt = wall;
    return sim.now;
  }
  const delta = Math.max(0, wall - sim.wallAt);
  sim.wallAt = wall;
  sim.now += delta * sim.speed;
  return sim.now;
}

export function simNow() {
  return syncSimClock();
}

export function setSimSpeed(speed: number) {
  syncSimClock();
  if (SIM_SPEEDS.indexOf(speed as any) < 0) return;
  runtime.sim.speed = speed as 1 | 10 | 60;
}

export function afterSim(afterMs: number, run: () => void) {
  const sim = runtime.sim;
  syncSimClock();
  sim.cascades.push({ at: sim.now + Math.max(0, afterMs), run });
}

export function flushSimCascades() {
  const sim = runtime.sim;
  syncSimClock();
  let guard = 0;
  while (guard < 64) {
    guard += 1;
    let next = -1;
    let best = Infinity;
    for (let i = 0; i < sim.cascades.length; i += 1) {
      if (sim.cascades[i].at <= sim.now && sim.cascades[i].at < best) {
        best = sim.cascades[i].at;
        next = i;
      }
    }
    if (next < 0) break;
    const job = sim.cascades.splice(next, 1)[0];
    job.run();
  }
}

export function bindSimAlarmReader(fn: () => { id: string; text: string; asset?: string }[]) {
  runtime.sim.alarmReader = fn;
}

export function syncSimAlarmLog(alarms?: { id: string; text: string; asset?: string }[]) {
  const sim = runtime.sim;
  const list = alarms || (sim.alarmReader ? sim.alarmReader() : []);
  const next: Record<string, string> = {};
  list.forEach((alarm) => {
    next[alarm.id] = alarm.text || alarm.asset || alarm.id;
  });
  Object.keys(next).forEach((id) => {
    if (sim.alarmIds[id] != null) return;
    sim.log.push({
      at: sim.now,
      kind: "alarm-raise",
      id: "log-" + sim.log.length,
      alarmId: id,
      text: next[id],
      title: next[id],
    });
  });
  Object.keys(sim.alarmIds).forEach((id) => {
    if (next[id] != null) return;
    sim.log.push({
      at: sim.now,
      kind: "alarm-clear",
      id: "log-" + sim.log.length,
      alarmId: id,
      text: sim.alarmIds[id],
      title: "Cleared · " + (sim.alarmIds[id] || id),
    });
  });
  sim.alarmIds = next;
}

export function stepSimCapacity(step: () => void, stepMs = 1000) {
  const sim = runtime.sim;
  syncSimClock();
  if (sim.paused) return;
  const beforeCascades = sim.cascades.length;
  flushSimCascades();
  let guard = 0;
  let stepped = false;
  while (sim.now - sim.lastStep >= stepMs && guard < 120) {
    sim.lastStep += stepMs;
    step();
    flushSimCascades();
    stepped = true;
    guard += 1;
  }
  if (stepped || sim.cascades.length !== beforeCascades) syncSimAlarmLog();
}

export function resetSim(seed?: number) {
  const sim = runtime.sim;
  sim.cascades = [];
  sim.undo = {};
  sim.feedersDown = {};
  sim.active = {};
  sim.applied = [];
  sim.scenario = [];
  sim.log = [];
  sim.alarmIds = {};
  sim.scrubAt = null;
  sim.running = false;
  sim.paused = false;
  sim.now = 0;
  sim.lastStep = 0;
  sim.wallAt = Date.now();
  setSimSeed(seed != null ? seed : sim.seed);
}

function adoptSimAlarms(alarms?: { id: string; text: string; asset?: string }[]) {
  const sim = runtime.sim;
  const list = alarms || (sim.alarmReader ? sim.alarmReader() : []);
  const next: Record<string, string> = {};
  list.forEach((alarm) => {
    next[alarm.id] = alarm.text || alarm.asset || alarm.id;
  });
  sim.alarmIds = next;
}

export function fireEvent(eventId: string, targetId = "", opts?: { quiet?: boolean; stay?: boolean; replay?: boolean }) {
  const event = eventById(eventId);
  if (!event) return false;
  const sim = runtime.sim;
  const stay = !!(opts && opts.stay);
  const replay = !!(opts && opts.replay);
  const prevView = state.view;
  syncSimClock();
  runtime.sim.stay = stay;
  try {
    if (!replay) {
      sim.scenario.push({ at: sim.now, eventId, targetId: targetId || "" });
      sim.scrubAt = null;
    }
    sim.log.push({
      at: sim.now,
      kind: "event",
      id: "log-" + sim.log.length,
      eventId,
      targetId: targetId || "",
      title: event.title,
    });
    event.apply(targetId || "", sim);
    event.cascade.forEach((step) => {
      afterSim(step.afterMs, () => step.run(targetId || "", sim));
    });
    sim.applied.push({ eventId, targetId: targetId || "" });
    if (stay) state.view = prevView;
  } finally {
    runtime.sim.stay = false;
  }
  syncSimAlarmLog();
  if (!opts || !opts.quiet) {
    if (state.user) render();
  }
  return true;
}

export function revertEvent(eventId: string, targetId = "") {
  const event = eventById(eventId);
  if (!event) return false;
  const sim = runtime.sim;
  syncSimClock();
  event.revert(targetId || "", sim);
  sim.applied = sim.applied.filter((row) => !(row.eventId === eventId && row.targetId === (targetId || "")));
  if (state.user) render();
  return true;
}

export function resetSimulation() {
  const sim = runtime.sim;
  syncSimClock();
  sim.cascades = [];
  sim.applied.slice().reverse().forEach((row) => {
    const event = eventById(row.eventId);
    if (event) event.revert(row.targetId, sim);
  });
  sim.applied = [];
  sim.scenario = [];
  sim.log = [];
  sim.alarmIds = {};
  sim.scrubAt = null;
  sim.undo = {};
  sim.feedersDown = {};
  sim.active = {};
  applyCapacitySeed();
  sim.running = false;
  sim.paused = false;
  sim.now = 0;
  sim.lastStep = 0;
  sim.wallAt = Date.now();
  setSimSeed(sim.seed);
  adoptSimAlarms([]);
  if (state.user) render();
}

/** Advance the deterministic sim clock and capacity steps up to targetAt (inclusive). */
export function advanceSimTo(targetAt: number, stepMs = 1000) {
  const sim = runtime.sim;
  const goal = Math.max(0, targetAt);
  const wasPaused = sim.paused;
  sim.paused = true;
  while (sim.lastStep + stepMs <= goal) {
    sim.lastStep += stepMs;
    sim.now = sim.lastStep;
    stepCapacity();
    flushSimCascades();
  }
  sim.now = goal;
  flushSimCascades();
  sim.wallAt = Date.now();
  sim.paused = wasPaused;
}

function clearSimWorld(seed: number) {
  const sim = runtime.sim;
  sim.cascades = [];
  sim.applied.slice().reverse().forEach((row) => {
    const event = eventById(row.eventId);
    if (event) event.revert(row.targetId, sim);
  });
  sim.applied = [];
  sim.undo = {};
  sim.feedersDown = {};
  sim.active = {};
  sim.log = [];
  sim.alarmIds = {};
  applyCapacitySeed();
  sim.now = 0;
  sim.lastStep = 0;
  sim.wallAt = Date.now();
  sim.scrubAt = null;
  setSimSeed(seed);
  adoptSimAlarms([]);
}

/** Re-run from seed through scenario events up to `at` (deterministic scrub). */
export function scrubTo(at: number) {
  const sim = runtime.sim;
  const seed = sim.seed;
  const speed = sim.speed;
  const plan = sim.scenario.slice().sort((a, b) => a.at - b.at || a.eventId.localeCompare(b.eventId));
  const goal = Math.max(0, at);
  clearSimWorld(seed);
  sim.speed = speed;
  sim.scenario = plan.slice();
  sim.running = true;
  sim.paused = true;
  runtime.sim.stay = true;
  try {
    adoptSimAlarms();
    plan.filter((row) => row.at <= goal).forEach((row) => {
      advanceSimTo(row.at);
      fireEvent(row.eventId, row.targetId || "", { quiet: true, stay: true, replay: true });
    });
    advanceSimTo(goal);
    syncSimAlarmLog();
    sim.scrubAt = goal;
  } finally {
    runtime.sim.stay = false;
  }
  sim.paused = false;
  if (state.user) render();
}

export type SimScenario = {
  seed: number;
  speed: number;
  events: { at: number; eventId: string; targetId: string }[];
};

export function scenarioPayload(): SimScenario {
  const sim = runtime.sim;
  return {
    seed: sim.seed,
    speed: sim.speed,
    events: sim.scenario.map((row) => ({
      at: row.at,
      eventId: row.eventId,
      targetId: row.targetId || "",
    })),
  };
}

export function encodeSimPayload(data: SimScenario) {
  const json = JSON.stringify(data);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeSimPayload(raw: string): SimScenario | null {
  if (!raw) return null;
  try {
    let b64 = String(raw).replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const json = decodeURIComponent(escape(atob(b64)));
    const data = JSON.parse(json);
    if (!data || !Array.isArray(data.events)) return null;
    return {
      seed: (Number(data.seed) >>> 0) || 1,
      speed: SIM_SPEEDS.indexOf(data.speed) >= 0 ? data.speed : 1,
      events: data.events.map((row) => ({
        at: Math.max(0, Number(row.at) || 0),
        eventId: String(row.eventId || ""),
        targetId: String(row.targetId || ""),
      })).filter((row) => eventById(row.eventId)),
    };
  } catch (err) {
    return null;
  }
}

export function loadScenario(data: SimScenario) {
  const sim = runtime.sim;
  const speed = SIM_SPEEDS.indexOf(data.speed as any) >= 0 ? data.speed : 1;
  const seed = (Number(data.seed) >>> 0) || 1;
  const events = (data.events || []).slice().sort((a, b) => a.at - b.at);
  clearSimWorld(seed);
  sim.speed = speed as 1 | 10 | 60;
  sim.scenario = events.map((row) => ({
    at: row.at,
    eventId: row.eventId,
    targetId: row.targetId || "",
  }));
  sim.barOpen = true;
  sim.running = true;
  sim.paused = false;
  state.view = "floor";
  state.floor.level = "hall";
  state.floor.serverId = "";
  state.floor.partId = "";
  state.floor.feedId = "";
  state.floor.rowId = "";
  const end = events.length ? events[events.length - 1].at : 0;
  scrubTo(end);
  state.view = "floor";
  state.floor.level = "hall";
  sim.paused = false;
  sim.running = true;
}

export function simShareHash(data?: SimScenario) {
  const payload = encodeSimPayload(data || scenarioPayload());
  return "#/floor/hall?sim=" + payload;
}

export function copySimLink() {
  const hash = simShareHash();
  const url = location.origin + location.pathname + location.search + hash;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      state.toast = "Scenario link copied.";
      render();
    }).catch(() => {
      state.toast = url;
      render();
    });
  } else {
    state.toast = url;
    render();
  }
}

export function saveSimScenario() {
  const data = scenarioPayload();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "access-sim-scenario.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  state.toast = "Scenario saved.";
  render();
}

export function simTimelineHtml() {
  const sim = runtime.sim;
  const entries = sim.log.slice();
  if (!entries.length) {
    return '<div class="sim-timeline" role="list" aria-label="Simulation timeline">' +
      '<span class="sim-timeline-empty">No events yet</span></div>';
  }
  const maxAt = Math.max(sim.now, entries[entries.length - 1].at, 1);
  const ticks = entries.map((entry, index) => {
    const pct = Math.min(100, (entry.at / maxAt) * 100);
    const kind = entry.kind === "event" ? "event" : (entry.kind === "alarm-raise" ? "raise" : "clear");
    const label = entry.title || entry.text || entry.eventId || entry.alarmId || "tick";
    const current = sim.scrubAt != null && Math.abs(sim.scrubAt - entry.at) < 1 ? " aria-current=\"true\"" : "";
    return '<button type="button" class="sim-tick ' + kind + '" role="listitem" data-act="sim-scrub" data-at="' +
      entry.at + '" data-index="' + index + '" title="' + esc(label) + " @ " + Math.round(entry.at) + 'ms" style="left:' +
      pct.toFixed(2) + '%"' + current + ' aria-label="' + esc(label) + '"></button>';
  }).join("");
  return '<div class="sim-timeline" role="list" aria-label="Simulation timeline">' + ticks + "</div>";
}

export function targetsForEvent(eventId: string) {
  const event = eventById(eventId);
  if (!event) return [] as { id: string; label: string }[];
  if (event.targetKind === "device") {
    return devices.map((d) => ({ id: d.id, label: d.name }));
  }
  if (event.targetKind === "outlet") {
    return outlets.map((row) => ({ id: String(row.n), label: "Outlet " + row.n }));
  }
  if (event.targetKind === "rack") {
    return PODS.flatMap((pod) => pod.racks.map((rack) => ({
      id: rack.id,
      label: pod.name + " · " + rack.id,
    })));
  }
  if (event.targetKind === "feeder") {
    return gridFeeders().map((item) => ({ id: item.id, label: item.name || item.id }));
  }
  if (event.targetKind === "cdu") {
    return hallCdus().map((item) => ({ id: item.id, label: item.name || item.id }));
  }
  if (event.targetKind === "yard") {
    return heatRejectors().map((item) => ({ id: item.id, label: item.name || item.id }));
  }
  return [{ id: "", label: "Site" }];
}

export function breakEventsForEntity(entity) {
  if (!entity) return [] as BreakEvent[];
  if (entity.kind === "Grid") {
    const feeders = gridFeeders();
    if (feeders[0] && feeders[0].id === entity.id) return [eventById("feeder-a-loss")].filter(Boolean) as BreakEvent[];
    if (feeders[1] && feeders[1].id === entity.id) return [eventById("feeder-b-loss")].filter(Boolean) as BreakEvent[];
    return [eventById("feeders-both-loss")].filter(Boolean) as BreakEvent[];
  }
  if (entity.kind === "Heat rejection") {
    return [eventById("heat-rejection-trip")].filter(Boolean) as BreakEvent[];
  }
  if (entity.kind === "Cooling" && !entity.yard) {
    return [eventById("cdu-failure")].filter(Boolean) as BreakEvent[];
  }
  return [];
}

export function breakEventsForRack(rackId: string) {
  if (!rackId) return [] as BreakEvent[];
  return [eventById("rack-pdu-open")].filter(Boolean) as BreakEvent[];
}

export function breakThisHtml(targetId: string, events: BreakEvent[]) {
  if (!events.length) return "";
  return '<div class="break-this"><p class="fine">Break this…</p><div class="break-actions">' +
    events.map((event) => '<button type="button" class="act" data-act="sim-break" data-event="' +
      esc(event.id) + '" data-target="' + esc(targetId) + '">' + esc(event.title) + "</button>").join("") +
    "</div></div>";
}

export function simStripeHtml() {
  if (!runtime.sim.running && !runtime.sim.applied.length) return "";
  return '<div class="sim-stripe" role="status">SIMULATION</div>';
}

export type SimImpact = {
  active: boolean;
  affected: Record<string, true>;
  failedFeeds: string[];
  failedPipes: string[];
  racksAffected: number;
  kwAtRisk: number;
  secondsToCritical: number | null;
  redundancyGone: boolean;
  loadLost: boolean;
  summary: string;
};

/** Project entity load forward without jitter; returns sim-seconds until score ≥ 90. */
export function secondsUntilCritical(entity): number | null {
  if (!entity || !entity.load || entity.bmc === "down") return null;
  const drift = Number(entity.load.drift) || 0;
  if (drift <= 0) return null;
  if (heatBand(entity) === "critical") return 0;
  if (isFacility(entity)) {
    let power = entity.load.power;
    for (let sec = 1; sec <= 7200; sec += 1) {
      power = clamp(power + drift, 8, 98);
      if (power >= 90) return sec;
    }
    return null;
  }
  let gpu = entity.load.gpu;
  let mem = entity.load.mem;
  let power = entity.load.power;
  let temp = entity.load.temp;
  for (let sec = 1; sec <= 7200; sec += 1) {
    gpu = clamp(gpu + drift, 4, 98);
    mem = clamp(mem + drift * 0.55, 4, 98);
    power = clamp(power + drift * 0.7, 4, 98);
    temp = clamp(temp + drift * 0.12, 40, 96);
    const score = gpu * 0.5 + mem * 0.2 + power * 0.2 + temp * 0.1;
    if (score >= 90) return sec;
  }
  return null;
}

export function formatImpactDuration(seconds: number) {
  if (seconds < 60) return Math.max(1, Math.round(seconds)) + "s";
  if (seconds < 3600) {
    const min = seconds / 60;
    return (min >= 10 ? Math.round(min) : min.toFixed(1).replace(/\.0$/, "")) + " min";
  }
  const hours = seconds / 3600;
  return (hours >= 10 ? Math.round(hours) : hours.toFixed(1).replace(/\.0$/, "")) + " h";
}

function mark(affected: Record<string, true>, id: string) {
  if (id) affected[id] = true;
}

function markHall(affected: Record<string, true>, hallId: string) {
  const pod = podById(hallId);
  if (!pod) return;
  mark(affected, pod.id);
  pod.racks.forEach((rack) => {
    mark(affected, rack.id);
    rackEntities(rack).forEach((entity) => mark(affected, entity.id));
  });
  infra.filter((item) => item.pod === hallId).forEach((item) => mark(affected, item.id));
  (pod.boxes || []).forEach((box) => mark(affected, box.id));
}

function feederFeedIds(feederId: string) {
  const feeders = gridFeeders();
  const index = feeders.findIndex((item) => item.id === feederId);
  if (index === 0) return ["grid-xfmr-a", "xfmr-mod-a", "mod-bus"];
  if (index === 1) return ["grid-xfmr-b", "xfmr-mod-b", "mod-bus-b"];
  return [] as string[];
}

function hallPipeIds(hallId: string) {
  return ["supply-" + hallId, "return-" + hallId];
}

function emptyImpact(): SimImpact {
  return {
    active: false,
    affected: {},
    failedFeeds: [],
    failedPipes: [],
    racksAffected: 0,
    kwAtRisk: 0,
    secondsToCritical: null,
    redundancyGone: false,
    loadLost: false,
    summary: "",
  };
}

/**
 * Pure impact report for the current break state.
 * Reads the loaded world (PODS / YARD / infra / devices) and sim flags; does not mutate.
 */
export function impact(sim: Sim): SimImpact {
  const out = emptyImpact();
  if (!sim || (!(sim.applied && sim.applied.length) && !Object.keys(sim.feedersDown || {}).length)) {
    return out;
  }
  out.active = true;
  const feeders = gridFeeders();
  const downFeeders = feeders.filter((item) => sim.feedersDown && sim.feedersDown[item.id]);
  const allFeedersDown = feeders.length > 0 && downFeeders.length >= feeders.length;
  const someFeedersDown = downFeeders.length > 0;

  downFeeders.forEach((feeder) => {
    mark(out.affected, feeder.id);
    feederFeedIds(feeder.id).forEach((id) => {
      if (out.failedFeeds.indexOf(id) < 0) out.failedFeeds.push(id);
    });
  });

  if (allFeedersDown) {
    out.loadLost = true;
    PODS.forEach((hall) => markHall(out.affected, hall.id));
    YARD.forEach((item) => mark(out.affected, item.id));
    feeders.forEach((feeder) => {
      feederFeedIds(feeder.id).forEach((id) => {
        if (out.failedFeeds.indexOf(id) < 0) out.failedFeeds.push(id);
      });
    });
    ["mod-riser"].concat(PODS.map((hall) => "feed-hall-" + hall.id)).forEach((id) => {
      if (out.failedFeeds.indexOf(id) < 0) out.failedFeeds.push(id);
    });
  } else if (someFeedersDown) {
    out.redundancyGone = true;
    out.loadLost = false;
  }

  (sim.applied || []).forEach((row) => {
    const eventId = row.eventId;
    const targetId = row.targetId || "";
    if (eventId === "cdu-failure") {
      const cdu = entityById(targetId) || cduForHall(targetId) || hallCdus()[0] || null;
      const hallId = cdu && cdu.pod ? String(cdu.pod) : hallForCdu(targetId) || targetId;
      if (cdu) mark(out.affected, cdu.id);
      if (hallId) {
        markHall(out.affected, hallId);
        hallPipeIds(hallId).forEach((id) => {
          if (out.failedPipes.indexOf(id) < 0) out.failedPipes.push(id);
        });
      }
    } else if (eventId === "heat-rejection-trip") {
      const units = targetId
        ? heatRejectors().filter((item) => item.id === targetId)
        : heatRejectors();
      (units.length ? units : heatRejectors()).forEach((item) => mark(out.affected, item.id));
      out.failedPipes.push("supply-spine", "return-spine");
      PODS.forEach((hall) => {
        markHall(out.affected, hall.id);
        hallPipeIds(hall.id).forEach((id) => {
          if (out.failedPipes.indexOf(id) < 0) out.failedPipes.push(id);
        });
      });
      hallCdus().forEach((cdu) => mark(out.affected, cdu.id));
    } else if (eventId === "rack-pdu-open") {
      mark(out.affected, targetId);
      const feedId = "whip-" + targetId;
      if (out.failedFeeds.indexOf(feedId) < 0) out.failedFeeds.push(feedId);
      const pod = PODS.find((hall) => hall.racks.some((rack) => rack.id === targetId));
      const rack = pod && pod.racks.find((item) => item.id === targetId);
      if (rack) rackEntities(rack).forEach((entity) => mark(out.affected, entity.id));
    } else if (eventId === "outlet-open") {
      const outlet = outlets.find((item) => String(item.n) === String(targetId));
      if (outlet && outlet.deviceId) {
        mark(out.affected, outlet.deviceId);
        const mapped = deviceById(outlet.deviceId);
        if (mapped && mapped.rack) {
          mark(out.affected, mapped.rack);
          if (out.failedFeeds.indexOf("whip-" + mapped.rack) < 0) {
            out.failedFeeds.push("whip-" + mapped.rack);
          }
        }
      }
    } else if (eventId === "bmc-loss" || eventId === "rdp-loss" || eventId === "watch-deny") {
      mark(out.affected, targetId);
      const mapped = deviceById(targetId);
      if (mapped && mapped.rack) mark(out.affected, mapped.rack);
    } else if (eventId === "leak-trip") {
      mark(out.affected, "A14");
      devices.filter((d) => d.rack === "A14").forEach((d) => mark(out.affected, d.id));
    } else if (eventId === "feeder-a-loss" || eventId === "feeder-b-loss" || eventId === "feeders-both-loss") {
      /* feeders handled via feedersDown */
    }
  });

  const rackIds = Object.keys(out.affected).filter((id) =>
    PODS.some((hall) => hall.racks.some((rack) => rack.id === id)));
  out.racksAffected = rackIds.length;
  out.kwAtRisk = out.loadLost || out.racksAffected
    ? out.racksAffected * (Number(PLANT.kwPerRack) || 0)
    : 0;

  let soonest: number | null = null;
  Object.keys(out.affected).forEach((id) => {
    const entity = entityById(id);
    if (!entity || !entity.load) return;
    if (isFacility(entity) && entity.kind === "Cooling") return;
    const sec = secondsUntilCritical(entity);
    if (sec == null) return;
    if (soonest == null || sec < soonest) soonest = sec;
  });
  out.secondsToCritical = soonest;

  if (out.redundancyGone && !out.loadLost) {
    out.summary = "No load lost · redundancy gone";
  } else {
    const rackWord = out.racksAffected === 1 ? "rack" : "racks";
    const kwWord = Math.round(out.kwAtRisk).toLocaleString("en-US") + " kW at risk";
    const timeWord = out.secondsToCritical == null
      ? "no thermal climb"
      : out.secondsToCritical <= 0
        ? "thermal critical now"
        : "critical in " + formatImpactDuration(out.secondsToCritical);
    out.summary = out.racksAffected + " " + rackWord + " · " + kwWord + " · " + timeWord;
  }
  return out;
}

export function simBarHtml() {
  const sim = runtime.sim;
  if (!eventById(sim.eventId)) sim.eventId = EVENTS[0] ? EVENTS[0].id : "";
  const targets = targetsForEvent(sim.eventId);
  if (targets.length && !targets.some((row) => row.id === sim.targetId)) {
    sim.targetId = targets[0].id;
  }
  const eventOpts = EVENTS.map((event) => '<option value="' + esc(event.id) + '"' +
    (event.id === sim.eventId ? " selected" : "") + ">" + esc(event.title) + "</option>").join("");
  const targetOpts = targets.map((row) => '<option value="' + esc(row.id) + '"' +
    (row.id === sim.targetId ? " selected" : "") + ">" + esc(row.label) + "</option>").join("");
  const speeds = SIM_SPEEDS.map((speed) => '<button type="button" class="act" data-act="sim-speed" data-speed="' +
    speed + '"' + (sim.speed === speed ? ' aria-pressed="true"' : "") + ">" + speed + "x</button>").join("");
  const report = impact(sim);
  const summary = report.active && report.summary
    ? '<p class="sim-summary" role="status">' + esc(report.summary) + "</p>"
    : "";
  return '<div class="sim-dock">' +
    simTimelineHtml() +
    '<div class="sim-bar" role="region" aria-label="Simulate">' +
    '<label class="sim-field">Event<select id="sim-event">' + eventOpts + "</select></label>" +
    '<label class="sim-field">Target<select id="sim-target">' + targetOpts + "</select></label>" +
    '<button type="button" class="act primary" data-act="sim-run">Run</button>' +
    '<button type="button" class="act" data-act="sim-pause"' + (sim.paused ? ' aria-pressed="true"' : "") + ">Pause</button>" +
    '<div class="seg sim-speeds" role="group" aria-label="Speed">' + speeds + "</div>" +
    '<button type="button" class="act" data-act="sim-reset">Reset</button>' +
    '<button type="button" class="act" data-act="sim-copy">Copy link</button>' +
    '<button type="button" class="act" data-act="sim-save">Save scenario</button>' +
    '<button type="button" class="act" data-act="sim-close" aria-label="Close simulate bar">Close</button>' +
    summary +
    "</div></div>";
}

export function openSimBar() {
  runtime.sim.barOpen = true;
  state.view = "floor";
  state.labOpen = false;
  state.menuOpen = false;
  render();
}

export function closeSimBar() {
  runtime.sim.barOpen = false;
  render();
}

export function runSimSelection() {
  const sim = runtime.sim;
  const eventId = sim.eventId || (EVENTS[0] && EVENTS[0].id) || "";
  if (!eventId) return;
  const targets = targetsForEvent(eventId);
  if (targets.length && !targets.some((row) => row.id === sim.targetId)) {
    sim.targetId = targets[0].id;
  }
  sim.running = true;
  sim.paused = false;
  fireEvent(eventId, sim.targetId || "", { stay: state.view === "floor" });
}

export function pauseSim() {
  syncSimClock();
  runtime.sim.paused = !runtime.sim.paused;
  if (!runtime.sim.paused) runtime.sim.running = true;
  render();
}

/** Client-side power fail report when POST /api/v1/power/fail is unavailable. */
export function localPowerFail(nodeId: string, mode: string) {
  const sim = runtime.sim;
  const feeders = gridFeeders();
  const match = feeders.find((item) => item.id === nodeId);
  if (match) {
    if (feeders[0] && match.id === feeders[0].id) fireEvent("feeder-a-loss", match.id, { quiet: true });
    else if (feeders[1] && match.id === feeders[1].id) fireEvent("feeder-b-loss", match.id, { quiet: true });
    else setFeederDown(sim, match.id, true);
  } else if (nodeId) {
    setFeederDown(sim, nodeId, true);
  }
  const downCount = feeders.filter((item) => sim.feedersDown[item.id]).length;
  const allDown = feeders.length > 0 && downCount >= feeders.length;
  const lost = allDown
    ? devices.map((d) => ({ id: d.id, name: d.name, deviceId: d.id, rackId: d.rack || "" }))
    : [];
  const alarmId = "alm-local-" + (nodeId || "feeder") + "-" + Math.floor(simNow());
  audit({
    user: "plant",
    role: "system",
    action: "power alarm",
    asset: nodeId,
    detail: allDown ? "All feeders open" : "Feeder open; redundant path carries load",
  });
  return {
    mode: mode || "nameplate",
    failed: nodeId,
    lost,
    over: [],
    alarmId,
    carried: {},
  };
}

export { simRandom, setSimSeed };
