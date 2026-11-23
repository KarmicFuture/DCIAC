import { runtime, state } from "../state";
import { esc } from "../ui/format";
import { render } from "../ui/schedule";
import { stopWalk } from "../views/floor";

const DWELL_MS = 6000;

type HeatStep = { label: string; text: string; level?: string; view?: string };

const STEPS: HeatStep[] = [
  {
    label: "Yard",
    level: "site",
    text: "Warm return reaches the dry coolers outside. They reject the heat, and cool supply goes back along the east wall.",
  },
  {
    label: "Hall",
    level: "hall",
    text: "Inside the hall, rack exhaust collects in the hot aisle. The CDU sends that heat toward the yard return.",
  },
  {
    label: "Rack",
    view: "rack",
    text: "Each server pulls about 20.5 °C at the front inlet and exhausts hotter air at the rear.",
  },
  {
    label: "One-line",
    view: "oneline",
    text: "The one-line is the power that becomes this heat. Feeder megawatts arrive as IT load in the racks.",
  },
  {
    label: "Fleet",
    view: "fleet",
    text: "Fleet rolls the halls up. A hall stays hot when the CDU or the yard cannot clear what the racks exhaust.",
  },
  {
    label: "Control",
    view: "control",
    text: "An open outlet stops the load, and the heat from that whip stops with it.",
  },
  {
    label: "Port map",
    view: "map",
    text: "Ports do not carry heat. The servers behind them are what turn power into exhaust.",
  },
  {
    label: "Sessions",
    view: "sessions",
    text: "A session does not move heat. It is how you read a server that is already hot.",
  },
];

function clearTimer() {
  window.clearTimeout(runtime.heat.timer);
  runtime.heat.timer = 0;
}

function arm() {
  clearTimer();
  if (runtime.heat.step < 0 || runtime.heat.step >= STEPS.length - 1) return;
  runtime.heat.timer = window.setTimeout(() => {
    runtime.heat.timer = 0;
    if (runtime.heat.step < 0) return;
    advanceHeat(false);
  }, DWELL_MS);
}

function place(step) {
  state.menuOpen = false;
  state.toast = "";
  stopWalk(true, false);
  if (step.level) {
    state.view = "floor";
    state.floor.level = step.level;
    state.floor.podId = state.floor.podId || "pod-a";
    state.floor.serverId = "";
    state.floor.rowId = "";
    state.floor.feedId = "";
    state.floor.partId = "";
    state.floor.pitch = 56;
    state.floor.yaw = -40;
    state.floor.panX = 0;
    state.floor.panY = 0;
    state.floor.zoom = step.level === "site" ? 0.72 : 0.9;
    return;
  }
  if (!step.view) return;
  state.view = step.view;
  if (step.view === "rack" && !state.selected) state.selected = "tray-01";
}

export function heatPathOn() {
  return runtime.heat.step >= 0;
}

export function toggleHeat() {
  if (heatPathOn()) stopHeat(true);
  else startHeat();
}

export function startHeat() {
  runtime.heat.step = 0;
  place(STEPS[0]);
  state.focusField = "heat-path-next";
  render();
  arm();
}

export function advanceHeat(fromUser) {
  if (!heatPathOn()) return;
  const next = runtime.heat.step + 1;
  if (next >= STEPS.length) {
    stopHeat(!!fromUser);
    return;
  }
  runtime.heat.step = next;
  place(STEPS[next]);
  if (fromUser) state.focusField = "heat-path-next";
  render();
  arm();
}

export function backHeat() {
  if (runtime.heat.step <= 0) return;
  runtime.heat.step -= 1;
  place(STEPS[runtime.heat.step]);
  state.focusField = "heat-path-back";
  render();
  arm();
}

export function stopHeat(fromUser) {
  if (!heatPathOn() && !runtime.heat.timer) return;
  clearTimer();
  runtime.heat.step = -1;
  if (fromUser) state.focusField = "heat-path-toggle";
  render();
}

export function heatPathButton(withId?: boolean) {
  if (!state.user) return "";
  const on = heatPathOn();
  return '<button type="button" class="act heat-path-toggle"' + (withId === false ? "" : ' id="heat-path-toggle"') +
    ' data-act="heat-path" aria-pressed="' + (on ? "true" : "false") + '"' +
    (on ? ' aria-describedby="heat-path-status"' : "") + ">Heat path</button>";
}

export function heatPathHtml() {
  if (!state.user || !heatPathOn()) return "";
  const step = STEPS[runtime.heat.step];
  if (!step) return '<p class="empty">Heat path has no stops.</p>';
  const last = runtime.heat.step === STEPS.length - 1;
  const items = STEPS.map((item, index) => {
    const current = index === runtime.heat.step ? ' aria-current="step"' : "";
    return "<li" + current + ">" + esc(item.label) + "</li>";
  }).join("");
  const next = last
    ? '<button type="button" class="act primary" id="heat-path-next" data-act="heat-stop">Done</button>'
    : '<button type="button" class="act primary" id="heat-path-next" data-act="heat-next">Next</button>';
  return '<section class="heat-path" aria-label="Heat path"><p class="kicker">Heat moving</p>' +
    '<p class="heat-path-count">' + (runtime.heat.step + 1) + " of " + STEPS.length + "</p>" +
    '<ol class="heat-path-steps">' + items + "</ol>" +
    '<p id="heat-path-status" aria-live="polite">' + esc(step.text) + "</p>" +
    '<div class="heat-path-actions"><button type="button" class="act" id="heat-path-back" data-act="heat-back"' +
    (runtime.heat.step === 0 ? " disabled" : "") + ">Back</button>" + next +
    '<button type="button" class="act" data-act="heat-stop">Stop</button></div></section>';
}
