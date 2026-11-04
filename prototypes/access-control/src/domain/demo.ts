import { deviceById } from "../data/devices";
import { USERS } from "../data/users";
import { audit, userAudit } from "./audit";
import { loseBmc, toggleBmc } from "./failover";
import { setLeak } from "./leak";
import { actOutlet } from "./outlet-policy";
import { openSession } from "./sessions";
import { state } from "../state";
import { esc } from "../ui/format";
import { render } from "../ui/schedule";

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
          const mapped = deviceById("tray-06");
          state.view = "rack";
          state.selected = "tray-06";
          loseBmc(mapped, false);
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
          if (mapped && mapped.bmc === "down") toggleBmc("tray-06");
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
          setLeak(true, true);
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
  state.demoId = "";
  state.demoStep = 0;
  state.demoDone = false;
}

export function startDemo(id) {
  const scenario = scenarioById(id);
  if (!scenario) return;
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

export function advanceDemo() {
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
  clearDemo();
  state.focusField = "";
  render();
}

export function demoPanel() {
  const picks = SCENARIOS.map((item) => '<button type="button" class="act' +
    (state.demoId === item.id ? " primary" : "") + '" data-act="demo-start" data-demo="' + item.id + '">' +
    esc(item.title) + "</button>").join("");
  if (!state.demoId) {
    return '<section class="demo" aria-labelledby="demo-title"><h3 id="demo-title">Guided demo</h3>' +
      '<p class="fine">Three scripted walks. Each step has a caption. Next runs that step.</p>' +
      '<div class="demo-picks">' + picks + "</div></section>";
  }
  const scenario = scenarioById(state.demoId);
  const caption = state.demoDone ? textOf(scenario.done) : textOf(scenario.steps[state.demoStep].caption);
  const progress = state.demoDone
    ? "Walk complete"
    : "Step " + (state.demoStep + 1) + " of " + scenario.steps.length;
  const advance = state.demoDone
    ? '<button type="button" class="act primary" id="demo-advance" data-act="demo-stop">Done</button>'
    : '<button type="button" class="act primary" id="demo-advance" data-act="demo-next">Next</button>' +
      '<button type="button" class="act" data-act="demo-stop">Stop</button>';
  return '<section class="demo" aria-labelledby="demo-title"><h3 id="demo-title">Guided demo</h3>' +
    '<p class="demo-kicker">' + esc(scenario.title) + "</p>" +
    '<p class="demo-step">' + progress + "</p>" +
    '<p class="demo-caption" id="demo-caption" aria-live="polite">' + esc(caption) + "</p>" +
    '<div class="demo-actions">' + advance + "</div>" +
    '<div class="demo-picks">' + picks + "</div></section>";
}
