import { deviceById } from "../data/devices";
import { USERS } from "../data/users";
import { runtime, state } from "../state";
import { esc } from "../ui/format";
import { render } from "../ui/schedule";
import { openRack, stopWalk } from "../views/floor";
import { audit, userAudit } from "./audit";
import { fireEvent, resetSimulation, revertEvent } from "./events";
import { toggleBmc } from "./failover";
import { setLeak } from "./leak";
import { actOutlet } from "./outlet-policy";
import { closeSession, openSession } from "./sessions";

const THEME_KEY = "dciac.theme";

function scenarioById(id) {
  return SCENARIOS.find((item) => item.id === id) || null;
}

function closeMaintenance() {
  if (!state.maintenance) return;
  const name = state.maintenance.name;
  state.maintenance = null;
  userAudit("maintenance close", { detail: name, wo: "" });
}

function openMaintenance() {
  if (state.maintenance) return;
  const name = (state.maintName || "").trim() || "Rack A14 outlet maintenance";
  const wo = (state.maintWo || "").trim();
  state.maintenance = { name, wo };
  userAudit("maintenance open", { detail: name, wo });
  state.view = "control";
  state.toast = "Maintenance window " + name + " is open.";
}

function ensureBmcUp(id) {
  const mapped = deviceById(id);
  if (!mapped || mapped.bmc === "up") return;
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
}

function finishSerial(id) {
  const mapped = deviceById(id);
  if (!mapped || mapped.bmc !== "down") return;
  mapped.serialReadyAt = Date.now() - 5;
  if (mapped.serialAnnounced) return;
  mapped.serialAnnounced = true;
  const elapsed = Math.max(1, Math.round((Date.now() - (mapped.bmcLostAt || Date.now())) / 1000));
  audit({
    user: "ACS-A14",
    role: "appliance",
    action: "serial ready",
    asset: mapped.name,
    detail: mapped.tty + " ready " + elapsed + "s after BMC path loss on ACS",
  });
  state.toast = mapped.name + " serial is up on ACS.";
}

function become(id) {
  const user = USERS.find((item) => item.id === id);
  if (!user) return;
  if (state.user && state.user.id !== user.id) userAudit("sign out", { wo: "" });
  state.user = user;
  userAudit("sign in", { detail: "Guided demo", wo: "" });
  state.view = "control";
  state.labOpen = true;
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
  state.inspectorOpen = false;
  if (level === "hall" || level === "pod") state.floor.podId = state.floor.podId || "pod-a";
}

function calmChrome() {
  state.menuOpen = false;
  state.toast = "";
  state.libraryOpen = false;
}

function closeDemoSessions() {
  (state.sessions || []).slice().forEach((session) => {
    if (session && session.id) closeSession(session.id);
  });
}

function tidyFullDemo() {
  closeDemoSessions();
  closeMaintenance();
  if (state.leak) setLeak(false, true);
  ensureBmcUp("tray-06");
  const mapped = deviceById("tray-06");
  if (mapped && mapped.bmc === "down") {
    revertEvent("bmc-loss", "tray-06");
    if (mapped.bmc === "down") toggleBmc("tray-06");
  }
  resetSimulation();
  runtime.sim.barOpen = false;
  calmChrome();
}

const SCENARIOS = [
  {
    id: "bmc",
    title: "BMC dies on Tray 06",
    intro() {
      ensureBmcUp("tray-06");
      state.selected = "tray-06";
      state.view = "rack";
    },
    steps: [
      {
        caption: () => "GPU Tray 06 is on its BMC. Next drops that path. Failover is ACS serial, not RM1048.",
        run() {
          state.view = "rack";
          state.selected = "tray-06";
          fireEvent("bmc-loss", "tray-06", { quiet: true });
          state.view = "rack";
          state.selected = "tray-06";
        },
      },
      {
        caption: () => {
          const mapped = deviceById("tray-06");
          return "The BMC on " + mapped.name + " is dark. ACS serial on " + mapped.tty +
            " is coming up. Next finishes the failover and opens that console.";
        },
        run() {
          finishSerial("tray-06");
          openSession("tray-06", "acs", "serial", "rs232");
        },
      },
      {
        caption: () => "ACS serial is the out-of-band console. RM1048 did not take the path. Next restores the BMC.",
        run() {
          const mapped = deviceById("tray-06");
          if (mapped && mapped.bmc === "down") {
            revertEvent("bmc-loss", "tray-06");
            if (mapped.bmc === "down") toggleBmc("tray-06");
          }
        },
      },
    ],
    done: "GPU Tray 06 is back on the in-band plane. This walk is done.",
  },
  {
    id: "leak",
    title: "DI-1 leak",
    intro() {
      closeMaintenance();
      if (state.leak) setLeak(false, true);
      state.view = "control";
    },
    steps: [
      {
        caption: () => "DI-1 is quiet. Next trips the leak rope. Suggested control is Outlet 1 and Outlet 2.",
        run() {
          fireEvent("leak-trip", "", { quiet: true });
          state.view = "control";
        },
      },
      {
        caption: () => "Outlets 1 and 2 are locked. RM1048 owns them while the BMC is up and no maintenance window is open. Next opens a maintenance window.",
        run() {
          openMaintenance();
          state.highlightOutlet = 1;
        },
      },
    ],
    done: () => "Maintenance window " + (state.maintenance ? state.maintenance.name : "Rack A14 outlet maintenance") +
      " is open. Outlets 1 and 2 can be cycled. Plant-wide trip is not the policy.",
  },
  {
    id: "readonly",
    title: "Read-only colo user",
    intro() {
      state.view = "control";
      state.highlightOutlet = 9;
    },
    steps: [
      {
        caption: () => "Next signs in as colo.readonly, the colo read-only user, and opens outlet control.",
        run() {
          become("colo.readonly");
          state.highlightOutlet = 9;
        },
      },
      {
        caption: () => "Read only can look. Next tries to cycle Outlet 9 on GPU Tray 06.",
        run() {
          state.view = "control";
          state.highlightOutlet = 9;
          actOutlet(9, "cycle", "guided demo");
          state.view = "control";
          state.highlightOutlet = 9;
        },
      },
    ],
    done: "The cycle was refused. ReadOnly cannot cycle outlets. Power was not changed.",
  },
];

type TourBeat = {
  pop: string | (() => string);
  target?: string;
  enter: () => void;
};

const FULL_TOUR: TourBeat[] = [
  {
    pop: "Outside view of the 100 MW campus — ten halls, dual utility feeders, and yard plant sized for the IT load.",
    target: ".scene",
    enter() {
      tidyFullDemo();
      showFloor("site");
      calmChrome();
    },
  },
  {
    pop: "Hall 1 is the operable hall. Twenty AI racks sit here; rack A14 is the out-of-band ACS domain.",
    target: ".scene",
    enter() {
      showFloor("hall");
      state.floor.podId = "pod-a";
    },
  },
  {
    pop: "Facility power one-line: Feeder A and B through transformers and modules onto the MV bus that feeds every hall.",
    target: ".oneline-sheet, .ol-svg",
    enter() {
      state.view = "oneline";
    },
  },
  {
    pop: "Operate is the rack surface — consoles, port map, and sessions for devices in A14.",
    target: ".view, .rack-wrap, .workspace",
    enter() {
      state.view = "rack";
      state.selected = "tray-01";
    },
  },
  {
    pop: "BMC path on GPU Tray 06 is dark. Failover is ACS serial out of band — not RM1048.",
    target: ".view, .device-card, .rack-wrap",
    enter() {
      ensureBmcUp("tray-06");
      state.view = "rack";
      state.selected = "tray-06";
      fireEvent("bmc-loss", "tray-06", { quiet: true, stay: true });
      state.view = "rack";
      state.selected = "tray-06";
    },
  },
  {
    pop: () => {
      const mapped = deviceById("tray-06");
      return "ACS serial on " + ((mapped && mapped.tty) || "ttyS8") +
        " is up. This session is the operator’s out-of-band console while the BMC is dark.";
    },
    target: ".view, .session, .term-path, .workspace",
    enter() {
      finishSerial("tray-06");
      openSession("tray-06", "acs", "serial", "rs232");
      state.view = "sessions";
    },
  },
  {
    pop: "Control gates outlet power. Changes need policy: role, BMC plane, and often a maintenance window.",
    target: ".view, .control, table",
    enter() {
      const mapped = deviceById("tray-06");
      if (mapped && mapped.bmc === "down") {
        revertEvent("bmc-loss", "tray-06");
        if (mapped.bmc === "down") toggleBmc("tray-06");
      }
      closeDemoSessions();
      closeMaintenance();
      if (state.leak) setLeak(false, true);
      state.view = "control";
      state.highlightOutlet = 1;
    },
  },
  {
    pop: "DI-1 leak is asserted. Outlets 1 and 2 lock while RM1048 still owns them — no plant-wide trip.",
    target: ".view, .alarm-banner, table",
    enter() {
      fireEvent("leak-trip", "", { quiet: true, stay: true });
      state.view = "control";
      state.highlightOutlet = 1;
    },
  },
  {
    pop: "A named maintenance window lifts the hold. Bound outlets can be cycled, and every act is audited.",
    target: ".view, table",
    enter() {
      openMaintenance();
      state.highlightOutlet = 1;
    },
  },
  {
    pop: "Feeder A is open on the live campus. Redundancy is gone; the other side still carries load. Failed feeds are painted on Outside.",
    target: ".scene, .sim-bar, .sim-dock",
    enter() {
      if (state.leak) setLeak(false, true);
      closeMaintenance();
      showFloor("site");
      runtime.sim.barOpen = true;
      fireEvent("feeder-a-loss", "", { quiet: true, stay: true });
      state.view = "floor";
      state.floor.level = "site";
    },
  },
  {
    pop: "Plan is the year-long build — grass pads to live halls — so capacity arrives with the schedule.",
    target: ".view, .build-scene, .plan-layout",
    enter() {
      resetSimulation();
      runtime.sim.barOpen = false;
      state.view = "plan";
    },
  },
  {
    pop: "DCIM holds capacity, cables, work orders, monitoring, and reports on one working page.",
    target: ".view, .dcim",
    enter() {
      state.view = "dcim";
      runtime.dcim.tab = "capacity";
    },
  },
  {
    pop: "Audit is the record after an incident: person, asset, console open, outlet act, and work order.",
    target: ".view",
    enter() {
      state.view = "audit";
    },
  },
  {
    pop: "Demo complete. Floor, one-line, Operate, Control, Simulate, Plan, DCIM, and Audit are the surfaces an operator uses day to day.",
    target: ".scene",
    enter() {
      tidyFullDemo();
      showFloor("hall");
      state.floor.podId = "pod-a";
    },
  },
];

function textOf(value) {
  return typeof value === "function" ? value() : value;
}

export function loadTheme() {
  try {
    state.theme = localStorage.getItem(THEME_KEY) === "noc" ? "noc" : "paper";
  } catch (err) {
    state.theme = "paper";
  }
  applyTheme();
}

export function applyTheme() {
  document.documentElement.dataset.theme = state.theme === "noc" ? "noc" : "paper";
}

export function toggleTheme() {
  state.theme = state.theme === "noc" ? "paper" : "noc";
  try {
    localStorage.setItem(THEME_KEY, state.theme);
  } catch (err) {
    /* theme still applies for this view */
  }
  applyTheme();
  render();
}

export function clearDemo() {
  clearDemoTimer();
  state.demoId = "";
  state.demoStep = 0;
  state.demoDone = false;
}

function clearDemoTimer() {
  if (runtime.demoTimer) {
    clearTimeout(runtime.demoTimer);
    runtime.demoTimer = 0;
  }
}

function demoPauseMs() {
  const ms = Number(runtime.demoPauseMs);
  return ms > 0 ? ms : 10000;
}

function fullBeat() {
  if (state.demoId !== "full") return null;
  if (state.demoStep < 0 || state.demoStep >= FULL_TOUR.length) return null;
  return FULL_TOUR[state.demoStep];
}

function scheduleFullAdvance() {
  clearDemoTimer();
  if (state.demoId !== "full") return;
  runtime.demoTimer = setTimeout(() => {
    runtime.demoTimer = 0;
    advanceFullTour();
  }, demoPauseMs());
}

function enterFullBeat(index: number) {
  const beat = FULL_TOUR[index];
  if (!beat) return;
  state.demoStep = index;
  state.demoDone = false;
  state.labOpen = false;
  calmChrome();
  beat.enter();
}

export function advanceFullTour() {
  if (state.demoId !== "full") return;
  const next = state.demoStep + 1;
  if (next >= FULL_TOUR.length) {
    stopDemo();
    return;
  }
  enterFullBeat(next);
  render();
  scheduleFullAdvance();
}

export function startDemo(id) {
  if (id === "full") {
    startFullDemo();
    return;
  }
  const scenario = scenarioById(id);
  if (!scenario) return;
  clearDemoTimer();
  state.demoId = id;
  state.demoStep = 0;
  state.demoDone = false;
  state.labOpen = true;
  scenario.intro();
  state.labOpen = true;
  state.toast = "";
  state.focusField = "demo-advance";
  render();
}

export function startFullDemo() {
  if (!state.user || state.user.role !== "Operator") return;
  state.offerBriefing = false;
  state.briefingStep = -1;
  clearDemoTimer();
  state.demoId = "full";
  state.demoDone = false;
  state.labOpen = false;
  state.toast = "";
  state.focusField = "";
  enterFullBeat(0);
  render();
  scheduleFullAdvance();
}

export function advanceDemo() {
  if (state.demoId === "full") {
    advanceFullTour();
    return;
  }
  const scenario = scenarioById(state.demoId);
  if (!scenario || state.demoDone) {
    clearDemo();
    render();
    return;
  }
  const step = scenario.steps[state.demoStep];
  if (step) step.run();
  state.demoStep += 1;
  state.demoDone = state.demoStep >= scenario.steps.length;
  state.labOpen = true;
  state.focusField = "demo-advance";
  render();
}

export function stopDemo() {
  const wasFull = state.demoId === "full";
  clearDemoTimer();
  if (wasFull) tidyFullDemo();
  clearDemo();
  state.focusField = "";
  render();
}

function demoChrome(compact) {
  const scenario = scenarioById(state.demoId);
  if (!scenario) return "";
  const caption = state.demoDone ? textOf(scenario.done) : textOf(scenario.steps[state.demoStep].caption);
  const progress = state.demoDone
    ? "Walk complete"
    : "Step " + (state.demoStep + 1) + " of " + scenario.steps.length;
  const advance = state.demoDone
    ? '<button type="button" class="act primary" id="demo-advance" data-act="demo-stop">Done</button>'
    : '<button type="button" class="act primary" id="demo-advance" data-act="demo-next">Next</button>' +
      '<button type="button" class="act" data-act="demo-stop">Stop</button>';
  if (compact) {
    return '<div class="demo-coach" role="region" aria-label="Product demo">' +
      '<div class="demo-coach-copy"><p class="demo-kicker">' + esc(scenario.title) + " · " + esc(progress) + "</p>" +
      '<p class="demo-caption" id="demo-caption" aria-live="polite">' + esc(caption) + "</p></div>" +
      '<div class="demo-actions">' + advance + "</div></div>";
  }
  return '<p class="demo-kicker">' + esc(scenario.title) + "</p>" +
    '<p class="demo-step">' + progress + "</p>" +
    '<p class="demo-caption" id="demo-caption" aria-live="polite">' + esc(caption) + "</p>" +
    '<div class="demo-actions">' + advance + "</div>";
}

export function demoCoachHtml() {
  if (state.demoId === "full") {
    const beat = fullBeat();
    if (!beat) return "";
    const progress = (state.demoStep + 1) + " of " + FULL_TOUR.length;
    const ms = demoPauseMs();
    return '<div class="demo-tour" role="region" aria-label="Product demo">' +
      '<div class="demo-veil" aria-hidden="true"></div>' +
      '<div class="demo-spot" aria-hidden="true"></div>' +
      '<div class="demo-pop">' +
      '<p class="demo-kicker">Full demo · ' + esc(progress) + "</p>" +
      '<p class="demo-caption" id="demo-caption" aria-live="polite">' + esc(textOf(beat.pop)) + "</p>" +
      '<div class="demo-pop-meter" style="--demo-ms:' + ms + 'ms" aria-hidden="true"><i></i></div>' +
      '<div class="demo-actions"><button type="button" class="act" data-act="demo-stop">Stop</button></div>' +
      "</div></div>";
  }
  if (!state.demoId || state.labOpen) return "";
  return demoChrome(true);
}

export function placeDemoHighlights() {
  if (state.demoId !== "full") return;
  const beat = fullBeat();
  const spot = document.querySelector(".demo-spot") as HTMLElement | null;
  const pop = document.querySelector(".demo-pop") as HTMLElement | null;
  if (!spot || !pop) return;
  const selectors = String((beat && beat.target) || ".view").split(",").map((part) => part.trim()).filter(Boolean);
  let el: Element | null = null;
  for (let i = 0; i < selectors.length; i += 1) {
    el = document.querySelector(selectors[i]);
    if (el) break;
  }
  if (!el) el = document.querySelector(".view") || document.querySelector("main");
  if (!el) {
    spot.style.display = "none";
    return;
  }
  const rect = el.getBoundingClientRect();
  const pad = 10;
  const left = Math.max(8, rect.left - pad);
  const top = Math.max(8, rect.top - pad);
  const width = Math.min(window.innerWidth - left - 8, rect.width + pad * 2);
  const height = Math.min(window.innerHeight - top - 8, rect.height + pad * 2);
  spot.style.display = "block";
  spot.style.left = left + "px";
  spot.style.top = top + "px";
  spot.style.width = Math.max(48, width) + "px";
  spot.style.height = Math.max(48, height) + "px";

  const popW = Math.min(340, window.innerWidth - 24);
  pop.style.width = popW + "px";
  let popLeft = left + Math.max(0, (width - popW) / 2);
  popLeft = Math.min(Math.max(12, popLeft), window.innerWidth - popW - 12);
  let popTop = top + height + 14;
  const popHeight = pop.offsetHeight || 140;
  if (popTop + popHeight > window.innerHeight - 12) {
    popTop = Math.max(12, top - popHeight - 14);
  }
  pop.style.left = popLeft + "px";
  pop.style.top = popTop + "px";
}

export function demoPanel() {
  const picks = SCENARIOS.map((item) => '<button type="button" class="act' +
    (state.demoId === item.id ? " primary" : "") + '" data-act="demo-start" data-demo="' + item.id + '">' +
    esc(item.title) + "</button>").join("");
  if (!state.demoId || state.demoId === "full") {
    return '<section class="demo" aria-labelledby="demo-title"><h3 id="demo-title">Guided demo</h3>' +
      '<p class="fine">Scripted walks through Access. Each step has a caption. Next runs that step. Operators can also run Full demo from the rail for an auto tour.</p>' +
      '<div class="demo-picks">' + picks + "</div></section>";
  }
  return '<section class="demo" aria-labelledby="demo-title"><h3 id="demo-title">Guided demo</h3>' +
    demoChrome(false) +
    '<div class="demo-picks">' + picks + "</div></section>";
}

export function operatorDemoButton() {
  if (!state.user || state.user.role !== "Operator") return "";
  const on = state.demoId === "full";
  return '<button type="button" class="act primary demo-full-btn" data-act="demo-full"' +
    (on ? ' aria-pressed="true"' : "") + ">Full demo</button>";
}
