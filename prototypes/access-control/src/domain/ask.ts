/* Ask DCIAC: turns a typed question into a structured intent.

   The parser only reads what the user typed. It never reads device names, console
   text, or notes as instructions; those are looked up as data after parsing. The
   answers and every action are built in src/ui/ask.ts from DCIAC's own state and go
   through the same gates as the rest of the UI (roles, Control confirmation, the
   DI-1 interlock). A language model can replace the local parser with setAskParser():
   it returns the same AskIntent, and nothing downstream changes. */
import { devices } from "../data/devices";
import { PODS } from "../data/pods";

export type AskKind =
  | "empty" | "help" | "alarms" | "explain" | "navigate" | "fleet" | "fit"
  | "ack" | "power" | "session" | "handover" | "howto" | "ambiguous" | "unknown";

export interface AskIntent {
  kind: AskKind;
  text: string;
  hall?: string;        /* pod id */
  rack?: string;        /* rack id */
  device?: string;      /* device id on ACS-A14 */
  outlet?: number;
  pri?: number;
  escalated?: boolean;
  signal?: string;      /* alarm family for ack filters: inlet, recirc, serial, capacity, feed */
  op?: string;          /* power: on, off, cycle */
  bulk?: boolean;       /* power: more than one target */
  path?: string;        /* session: serial or kvm */
  view?: string;        /* navigate: a view id */
  face?: string;        /* navigate: rack face */
  sort?: string;        /* navigate: fleet rack sort */
  below?: number;       /* fleet: headroom percent threshold */
  count?: number;       /* fit: racks wanted */
  kw?: number;          /* fit: kW per rack */
  hours?: number;       /* handover window */
  missing?: string;     /* ambiguous: what to ask for (device, rack) */
}

export type AskParser = (text: string) => AskIntent;

const VIEWS: [RegExp, string][] = [
  [/\bfleet\b/, "fleet"],
  [/\bcontrol\b/, "control"],
  [/\bsessions?\b/, "sessions"],
  [/\bport ?map\b/, "map"],
  [/\bone[- ]?line\b/, "oneline"],
  [/\baudit\b/, "audit"],
  [/\bcampus\b|\bbuild plan\b/, "plan"],
  [/\bbuild schedule\b|\bhalls view\b/, "halls"],
  [/\bmodels?\b/, "models"],
  [/\bdcim\b/, "dcim"],
  [/\bsimulat(e|or|ion)\b/, "simulate"],
  [/\bfloor\b/, "floor"],
];

function findDevice(t: string) {
  const tray = t.match(/\btray[\s-]*0?([1-8])\b/);
  if (tray) return "tray-0" + tray[1];
  if (/\bsn ?2201\b|\bswitch\b/.test(t)) return "sn2201";
  if (/\bpower shelf\b|\bpshelf\b/.test(t)) return "pshelf";
  const named = devices.find((d) => t.indexOf(d.name.toLowerCase()) >= 0);
  return named ? named.id : "";
}

function findHall(t: string) {
  const m = t.match(/\bhall\s*(\d{1,2})\b/);
  if (!m) return "";
  const pod = PODS.find((p) => (p.name || "").toLowerCase() === "hall " + Number(m[1]));
  return pod ? pod.id : "";
}

export function rackPod(rackId: string) {
  const pod = PODS.find((p) => (p.racks || []).some((r) => r.id === rackId));
  return pod ? pod.id : "";
}

function findRack(t: string, raw: string) {
  const words = raw.match(/\b[A-Za-z]{1,2}\d{1,2}(-\d{2})?\b/g) || [];
  for (const w of words) {
    const want = w.toUpperCase();
    for (const p of PODS) {
      const hit = (p.racks || []).find((r) => String(r.id).toUpperCase() === want);
      if (hit) return hit.id;
    }
  }
  return "";
}

function num(m: RegExpMatchArray | null, fallback = 0) {
  return m ? Number(m[1]) : fallback;
}

export function localParser(raw: string): AskIntent {
  const text = String(raw || "").trim().slice(0, 500);
  const t = text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ");
  const base: AskIntent = { kind: "unknown", text };
  if (!t) return { ...base, kind: "empty" };
  base.device = findDevice(t);
  base.hall = findHall(t);
  base.rack = findRack(t, text);
  if (base.rack && !base.hall) base.hall = rackPod(base.rack);
  const outlet = t.match(/\boutlet\s*#?(\d{1,2})\b/);
  if (outlet) base.outlet = Number(outlet[1]);
  const pri = t.match(/\bp([123])\b|\bpriority\s*([123])\b/);
  if (pri) base.pri = Number(pri[1] || pri[2]);
  base.escalated = /\bescalat/.test(t);
  const trayWithoutNumber = /\btray\b/.test(t) && !base.device;

  if (/^(help|\?)$|what can (you|i) (do|ask)/.test(t)) return { ...base, kind: "help" };

  /* Power, before anything else, so "turn off outlet 7" never reads as navigation. */
  const off = /\b(turn|switch|power|shut)\b[^.]*\boff\b|\bshut ?down\b|\bde-?energi[sz]e|\b(cut|kill) (the )?power\b/.test(t);
  const on = /\b(turn|switch)\b[^.]*\bon\b|\bpower(ed)? (it |them )?on\b|\bre-?energi[sz]e|\bpower (it |them )?(back )?up\b|\brestore power\b/.test(t);
  const cycle = /\b(power[- ]?)?cycle\b|\breboot\b|\bhard reset\b|\bbounce\b/.test(t);
  const howto = /\bhow (do|can|should|would) (i|we|you)\b|\bsteps\b|\bprocedure\b|\brunbook\b/.test(t);
  if ((off || on || cycle) && !howto) {
    const outlets = t.match(/\boutlets?\s*\d+/g) || [];
    const many = /\b(all|every|each|whole|entire)\b|\boutlets\b|\band\b.*\boutlet\b/.test(t) || outlets.length > 1 ||
      (!!base.rack && !base.outlet && !base.device) || (!!base.hall && !base.outlet && !base.device);
    return { ...base, kind: "power", op: off ? "off" : (cycle ? "cycle" : "on"), bulk: many };
  }

  if (/\b(ack|acknowledge|acknowledged?)\b/.test(t) && !/\bwhy\b/.test(t)) {
    let signal = "";
    if (/\binlet\b|\btemperature\b/.test(t)) signal = "inlet";
    else if (/\brecirc/.test(t)) signal = "recirc";
    else if (/\b(serial|login|console|watch)\b/.test(t)) signal = "serial";
    else if (/\b(capacity|load|simulated)\b/.test(t)) signal = "capacity";
    else if (/\b(outlet|feed|whip)\b/.test(t)) signal = "feed";
    return { ...base, kind: "ack", signal };
  }

  if (/\b(open|start|launch|connect)\b.*\b(serial|console|kvm|session)\b/.test(t)) {
    if (!base.device) return { ...base, kind: "ambiguous", missing: "device", path: /\bkvm\b/.test(t) ? "kvm" : "serial" };
    return { ...base, kind: "session", path: /\bkvm\b/.test(t) ? "kvm" : "serial" };
  }

  if (/\b(last|previous|past) shift\b|\bhand ?over\b|\bwhat (has )?happened\b|\bshift (summary|report)\b/.test(t)) {
    const hours = t.match(/\b(\d{1,2})\s*(h|hrs?|hours?)\b/);
    return { ...base, kind: "handover", hours: Math.min(72, Math.max(1, num(hours, 12))) };
  }

  if (howto) {
    if (!base.device) return { ...base, kind: "ambiguous", missing: "device" };
    return { ...base, kind: "howto", op: /\breseat\b|\bcycle\b|\breboot\b/.test(t) ? "cycle" : "cycle" };
  }

  if (/\bwhy\b|\bexplain\b|\bcause\b|\bwhat('s| is) (wrong|up|going on) with\b|\bwhat happened (to|with)\b/.test(t)) {
    if (base.device) return { ...base, kind: "explain" };
    if (trayWithoutNumber) return { ...base, kind: "ambiguous", missing: "device" };
  }

  const fit = t.match(/\b(fit|place|put|add|room for|space for)\b/);
  if (fit && /\bracks?\b/.test(t)) {
    const count = t.match(/\b(\d{1,3})\s*(more\s*)?(new\s*)?(\d+\s*kw\s*)?racks?\b/);
    const kw = t.match(/\b(\d{2,4})\s*kw\b/);
    return { ...base, kind: "fit", count: num(count, 1) || 1, kw: num(kw, 0) };
  }
  const below = t.match(/\b(less|under|below|lower) than (\d{1,3})\s*%|\b(\d{1,3})\s*% headroom\b|\bheadroom (under|below) (\d{1,3})\s*%/);
  if (below || /\bheadroom\b|\bcapacity\b|\bhow much power\b|\butili[sz]ation\b/.test(t)) {
    const n = below ? Number(below[2] || below[3] || below[5]) : 0;
    return { ...base, kind: "fleet", below: n };
  }

  const nav = /\b(open|show|go to|goto|take me to|navigate to|bring up|jump to|view)\b/.test(t);
  if (nav && !/\b(alarms?|alerts?|issues?|problems?|wrong)\b/.test(t)) {
    const face = (t.match(/\b(front|rear|back|side|angle)\b/) || [])[1];
    const sort = /\bby (alarms?|priority)\b/.test(t) ? "alarms" : (/\bby (power|load|kw)\b/.test(t) ? "power" : "");
    const view = (VIEWS.find(([re]) => re.test(t)) || [])[1] || "";
    if (base.hall && /\bracks\b/.test(t)) return { ...base, kind: "navigate", view: "fleet", sort: sort || "power" };
    if (base.rack) return { ...base, kind: "navigate", face: face === "back" ? "rear" : (face || "") };
    if (base.device) return { ...base, kind: "navigate" };
    if (view) return { ...base, kind: "navigate", view };
    if (base.hall) return { ...base, kind: "navigate" };
    if (/\brack\b/.test(t)) return { ...base, kind: "ambiguous", missing: "rack" };
    if (trayWithoutNumber) return { ...base, kind: "ambiguous", missing: "device" };
  }

  if (/\b(alarms?|alerts?|wrong|problems?|issues?|attention|escalat\w*|broken|failing|open items)\b/.test(t) || base.pri) {
    return { ...base, kind: "alarms" };
  }
  if (/\b(fleet|halls|overview|summary|status)\b/.test(t)) return { ...base, kind: "fleet", below: 0 };
  if (base.device && /\b(status|state|how is|health)\b/.test(t)) return { ...base, kind: "explain" };
  return base;
}

let parser: AskParser = localParser;

export function setAskParser(next: AskParser | null) {
  parser = typeof next === "function" ? next : localParser;
}

export function parseQuestion(text: string): AskIntent {
  try {
    const intent = parser(text);
    return intent && intent.kind ? intent : localParser(text);
  } catch (err) {
    return localParser(text);
  }
}

export function usingLocalParser() {
  return parser === localParser;
}
