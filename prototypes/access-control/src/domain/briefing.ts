import { runtime, state } from "../state";
import { esc } from "../ui/format";
import { render } from "../ui/schedule";
import { openRack, stopWalk } from "../views/floor";

const KEY = "dciac.briefing";

const STEPS = [
  {
    title: "The campus",
    copy: "Ten halls sit on one site, with twenty AI racks in each. Power and cooling are already sized for that load. This is the picture to start from.",
    show() {
      showFloor("site");
    },
  },
  {
    title: "One hall",
    copy: "Hall 1 is the hall you can operate. Rack A14 is the out-of-band domain. Halls 2 through 10 are the same shape, with the same power and cooling.",
    show() {
      showFloor("hall");
      state.floor.podId = "pod-a";
    },
  },
  {
    title: "The rack",
    copy: "The rack is drawn in 3D, every device at its U, with its rack PDUs on the rear rails. Drag to turn it. Pick a device to see its ports and the best way in, out of band and in band.",
    show() {
      openRack("pod-a", "A14");
    },
  },
  {
    title: "Power stays gated",
    copy: "An outlet change needs a reason. Outside a maintenance window it also needs a work order that is in progress. A read-only customer can look and cannot cycle an outlet.",
    show() {
      state.view = "control";
    },
  },
  {
    title: "Capacity and work",
    copy: "Capacity, cables, work orders, monitoring, and reports sit on one page. The PUE figure is facility power divided by IT power. Facility power is modeled as IT plus overhead, so a balanced reading is 1.05.",
    show() {
      state.view = "dcim";
      runtime.dcim.tab = "capacity";
    },
  },
  {
    title: "The record",
    copy: "Console opens and outlet changes are written down with the person, the asset, and the work order. That is the record to ask for. Ask, below Audit, answers plain-English questions from this same data and shows its source. It can't switch power or skip a confirm, and everything asked there is in the record, tagged via Ask.",
    show() {
      state.view = "audit";
    },
  },
];

function seen() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch (err) {
    return false;
  }
}

function remember() {
  try {
    localStorage.setItem(KEY, "1");
  } catch (err) {
    /* the button still hides for this session */
  }
}

function showFloor(level) {
  stopWalk(true, false);
  state.view = "floor";
  state.floor.level = level;
  state.floor.serverId = "";
  state.floor.rowId = "";
  state.floor.feedId = "";
  state.floor.partId = "";
  state.floor.pitch = 56;
  state.floor.yaw = -40;
  state.floor.zoom = level === "site" ? 0.72 : 0.9;
  state.floor.panX = 0;
  state.floor.panY = 0;
  state.horizon = "now";
  state.scenePop = false;
  state.sceneFull = false;
}

function calm() {
  state.menuOpen = false;
  state.labOpen = false;
  state.toast = "";
}

export function noteFirstLogin() {
  state.offerBriefing = !seen();
  state.briefingStep = -1;
}

export function retireBriefing() {
  if (!state.offerBriefing && state.briefingStep < 0) return;
  remember();
  state.offerBriefing = false;
  state.briefingStep = -1;
}

export function startBriefing() {
  if (!state.offerBriefing) return;
  state.briefingStep = 0;
  calm();
  STEPS[0].show();
  state.focusField = "briefing-next";
  render();
}

export function advanceBriefing() {
  if (state.briefingStep < 0) return;
  const next = state.briefingStep + 1;
  if (next >= STEPS.length) {
    retireBriefing();
    showFloor("site");
    render();
    return;
  }
  state.briefingStep = next;
  calm();
  STEPS[next].show();
  state.focusField = "briefing-next";
  render();
}

export function skipBriefing() {
  retireBriefing();
  showFloor("site");
  render();
}

export function briefingButton() {
  if (!state.offerBriefing || state.briefingStep >= 0) return "";
  return '<button type="button" class="briefing-launch" data-act="briefing-start">Briefing</button>';
}

export function briefingHtml() {
  if (state.briefingStep < 0 || state.briefingStep >= STEPS.length) return "";
  const step = STEPS[state.briefingStep];
  const last = state.briefingStep === STEPS.length - 1;
  const next = last
    ? '<button type="button" class="act primary" id="briefing-next" data-act="briefing-next">Finish</button>'
    : '<button type="button" class="act primary" id="briefing-next" data-act="briefing-next">Next</button>' +
      '<button type="button" class="act" data-act="briefing-skip">Skip</button>';
  return '<aside class="briefing" aria-labelledby="briefing-title"><p class="kicker">Executive briefing</p><h2 id="briefing-title">' +
    esc(step.title) + "</h2><p class=\"briefing-count\">" + (state.briefingStep + 1) + " of " + STEPS.length +
    "</p><p class=\"briefing-copy\">" + esc(step.copy) + '</p><div class="briefing-actions">' + next + "</div></aside>";
}
