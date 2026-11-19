import type { AppState } from "./types";

export const runtime = {
  serialFailoverMs: 30000,
  seq: 0,
  lastRenderedView: "",
  dragToken: "",
  orbit: null as any,
  carry: null as any,
  walk: null as any,
  elevDrag: null as any,
  powerPanels: {} as any,
  networkRack: null as any,
  futureChanges: [] as any[],
  pulse: null as { id: string; until: number } | null,
  pulseTimer: 0 as any,
  consolePass: false,
  demoPauseMs: 4000,
  demoTimer: 0 as any,
  dcim: { tab: "capacity", home: null as any, scenarioId: "", workId: "", note: "", rows: [] as any[] },
  sim: {
    seed: 1,
    rng: 1,
    speed: 1 as 1 | 10 | 60,
    now: 0,
    wallAt: 0,
    lastStep: 0,
    cascades: [] as { at: number; run: () => void }[],
    undo: {} as Record<string, any>,
    feedersDown: {} as Record<string, boolean>,
    active: {} as Record<string, string>,
    applied: [] as { eventId: string; targetId: string }[],
    scenario: [] as { at: number; eventId: string; targetId: string }[],
    log: [] as {
      at: number;
      kind: "event" | "alarm-raise" | "alarm-clear";
      id: string;
      eventId?: string;
      targetId?: string;
      title?: string;
      alarmId?: string;
      text?: string;
    }[],
    alarmIds: {} as Record<string, string>,
    scrubAt: null as number | null,
    eventId: "bmc-loss",
    targetId: "",
    barOpen: false,
    running: false,
    paused: false,
    stay: false,
    alarmReader: null as null | (() => { id: string; text: string; asset?: string }[]),
  },
};

/** Seeded mulberry32 step; same seed + events ⇒ identical runs. */
export function simRandom() {
  let a = (runtime.sim.rng + 0x6D2B79F5) | 0;
  runtime.sim.rng = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function setSimSeed(seed: number) {
  const next = (seed >>> 0) || 1;
  runtime.sim.seed = next;
  runtime.sim.rng = next;
}

export const state: AppState = {
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
    elevationFace: "front",
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
  selectedPort: 0,
  menuOpen: false,
  portQuery: "",
  portFilter: "all",
  portCompact: false,
  focusField: "",
  plan: { maker: "All", selected: "", preview: "", seq: 1, placements: [] },
  horizon: "now",
  buildDate: "2026-11-16",
  buildHall: "",
  onelineBuild: false,
  rackView: "angle",
  libraryOpen: false,
  inspectorOpen: false,
  manage: { layer: "bmc", device: "tray-01" },
  containment: "hac",
  theme: "paper",
  collapsed: {} as Record<string, boolean>,
  scenePop: false,
  sceneFull: false,
  demoId: "",
  demoStep: 0,
  offerBriefing: false,
  briefingStep: -1,
  demoDone: false,
  outletGate: null,
  modelEdit: "",
};
