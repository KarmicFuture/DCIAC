import { deviceById } from "../data/devices";
import { demoAsk, resetAsk } from "../ui/ask";
import { USERS } from "../data/users";
import { runtime, state } from "../state";
import { esc } from "../ui/format";
import { render } from "../ui/schedule";
import { openRack, stopWalk } from "../views/floor";
import { setRackPreset } from "../views/rack3d";
import { setFleetDrill } from "../views/fleet";
import { audit, userAudit } from "./audit";
import { fireEvent, resetSimulation, revertEvent } from "./events";
import { toggleBmc } from "./failover";
import { setLeak } from "./leak";
import { actOutlet } from "./outlet-policy";
import { closeSession, openSession, setScreen } from "./sessions";
import { launchMp1000Kvm } from "./mp1000";
import { breakBoot, cancelFix, clearBoot, diagnoseBoot, finishFix, fixBoot, launchAlarmSerial, verifyBoot } from "./autofix";

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
  state.floorListOpen = false;
}

function closeDemoSessions() {
  (state.sessions || []).slice().forEach((session) => {
    if (session && session.id) closeSession(session.id);
  });
}

function tidyFullDemo() {
  resetAsk();
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
  state.onelineBuild = false;
  state.buildHall = "";
  setRackPreset("angle");
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
  /* Details elements to open after the beat paints, such as the alarm list. */
  open?: string;
  /* How long this beat stays up, as a multiple of the demo pause. */
  weight?: number;
  enter: () => void;
};

const FULL_TOUR: TourBeat[] = [
  {
    pop: "100 MW campus — ten halls, dual feeders, yard sized for the IT load.",
    target: ".scene",
    enter() {
      tidyFullDemo();
      showFloor("site");
      calmChrome();
    },
  },
  {
    pop: "Hall 1: twenty AI racks. A14 is the ACS out-of-band domain.",
    target: ".scene",
    enter() {
      showFloor("hall");
      state.floor.podId = "pod-a";
    },
  },
  {
    pop: "Operate · Fleet — every hall's alarms, IT power, and headroom on one page. Hall 1's racks are listed with the alarmed ones first.",
    target: ".fleet-page",
    enter() {
      state.view = "fleet";
      setFleetDrill("pod-a", "alarms");
    },
  },
  {
    pop: "Operate · One-line — Feeders A/B through transformers onto the MV bus.",
    target: ".oneline-sheet, .ol-svg",
    enter() {
      state.view = "oneline";
      state.onelineBuild = false;
    },
  },
  {
    pop: "Operate · Rack — Rack A14 in 3D, from the rear: every device at its U, two rack PDUs with live outlet lights. Drag to turn it.",
    target: ".rack3d-panel .r3-stage, .rack3d-panel",
    enter() {
      state.view = "rack";
      state.selected = "tray-01";
      setRackPreset("rear");
    },
  },
  {
    pop: "Operate · Rack — BMC dark on Tray 06. The device view marks ACS serial as the best way in — not RM1048.",
    target: ".device-view, .view",
    weight: 1.25,
    enter() {
      ensureBmcUp("tray-06");
      setRackPreset("angle");
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
      return "Operate · Sessions — ACS serial on " + ((mapped && mapped.tty) || "ttyS8") + " — out-of-band while BMC is dark.";
    },
    target: ".view, .session, .term-path, .workspace",
    enter() {
      finishSerial("tray-06");
      openSession("tray-06", "acs", "serial", "rs232");
      state.view = "sessions";
    },
  },
  {
    pop: "Operate · Control — outlet power is gated by role, BMC plane, and maintenance.",
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
    pop: "Operate · Control — DI-1 leak. Outlets 1–2 lock. No plant-wide trip.",
    target: ".view, .alarm-banner, table",
    enter() {
      fireEvent("leak-trip", "", { quiet: true, stay: true });
      state.view = "control";
      state.highlightOutlet = 1;
    },
  },
  {
    pop: "Operate · Control — maintenance lifts the hold. Bound outlets cycle; every act is audited.",
    target: ".view, table",
    enter() {
      openMaintenance();
      state.highlightOutlet = 1;
    },
  },
  {
    pop: "Operate · One-line — Feeder A is open. No IT is lost. Side B still feeds every hall, and the hall taps are at risk.",
    target: ".oneline-sheet, .ol-svg",
    weight: 1.35,
    enter() {
      if (state.leak) setLeak(false, true);
      closeMaintenance();
      runtime.sim.barOpen = false;
      fireEvent("feeder-a-loss", "", { quiet: true, stay: true });
      state.view = "oneline";
      state.onelineBuild = false;
    },
  },
  {
    pop: "Plan · Campus — Nov 2026. Grass field. Survey stakes only; nothing energized.",
    target: ".build-scene, .stage-bar, .plan-day",
    enter() {
      showPlanDate("2026-11-16");
    },
  },
  {
    pop: "Plan · Campus — Feb 2027. Both utility feeders and transformers on the west yard.",
    target: ".build-scene, .stage-bar, .plan-day",
    enter() {
      showPlanDate("2027-02-15");
    },
  },
  {
    pop: "Plan · Campus — Apr 2027. Halls 1–5 dried in. Coolers start the heat yard.",
    target: ".build-scene, .stage-bar, .plan-day",
    enter() {
      showPlanDate("2027-04-01");
    },
  },
  {
    pop: "Operate · One-line — Jul 2027. The one-line on that date: four halls energized, Halls 5–8 built with no load.",
    target: ".oneline-sheet, .view",
    enter() {
      showPlanDate("2027-07-01");
      state.view = "oneline";
      state.onelineBuild = true;
    },
  },
  {
    pop: "Plan · Campus — inside Hall 5 in mid-July. Racks are set row by row while Halls 1–4 carry load.",
    target: ".hall-build, .view",
    enter() {
      showPlanDate("2027-07-15");
      state.buildHall = "hall-5";
    },
  },
  {
    pop: "Plan · Halls — every hall's build on one schedule, from pad to live. Click a bar to open that hall.",
    target: ".gantt, .view",
    enter() {
      showPlanDate("2027-08-01");
      state.view = "halls";
    },
  },
  {
    pop: "Plan · Campus — Oct 2027. 100 MW. All ten halls match the live campus.",
    target: ".build-scene, .stage-bar, .plan-day",
    enter() {
      showPlanDate("2027-10-01");
    },
  },
  {
    pop: "Plan · DCIM — capacity, cables, work orders, monitoring, reports.",
    target: ".view, .dcim",
    enter() {
      state.view = "dcim";
      runtime.dcim.tab = "capacity";
    },
  },
  {
    pop: "Audit — who, asset, console, outlet, work order.",
    target: ".view",
    enter() {
      state.view = "audit";
    },
  },
  {
    pop: "Ask — plain-English questions, answered from DCIAC's own data with the source shown. Actions wait for a confirm; power still goes through Control.",
    target: ".ask-panel",
    weight: 1.25,
    enter() {
      showFloor("hall");
      state.floor.podId = "pod-a";
      demoAsk("What's wrong in Hall 1?");
    },
  },
  {
    pop: "Done. Floor, Operate · Fleet, Operate · One-line, Operate · Rack, Operate · Control, Plan · Campus, Plan · DCIM, Audit, Ask — day to day.",
    target: ".scene",
    enter() {
      tidyFullDemo();
      showFloor("hall");
      state.floor.podId = "pod-a";
    },
  },
];

let fixSessionId = "";
const FIX_DEVICE = "tray-05";

function tidyFixDemo() {
  resetAsk();
  cancelFix();
  clearBoot(FIX_DEVICE);
  closeDemoSessions();
  fixSessionId = "";
  resetSimulation();
  runtime.sim.barOpen = false;
  calmChrome();
}

function fixTty() {
  const mapped = deviceById(FIX_DEVICE);
  return (mapped && mapped.tty) || "ttyS7";
}

const FIX_TOUR: TourBeat[] = [
  {
    pop: "Operate · Sessions — Serial watch: acs.watch logs in to every ACS serial port in rack A14, around the clock.",
    target: ".watch-panel, .view",
    enter() {
      tidyFixDemo();
      state.view = "sessions";
    },
  },
  {
    pop: "Operate · Rack — GPU Tray 05 reboots after a BIOS update and never comes back. The device view shows no OS for SSH or RDP; ACS serial is still the way in.",
    target: ".device-view, .view",
    weight: 1.25,
    enter() {
      finishFix();
      breakBoot(FIX_DEVICE);
      state.view = "rack";
      state.selected = FIX_DEVICE;
    },
  },
  {
    pop: () => "Operate · Rack — acs.watch reads " + fixTty() + ": a UEFI shell, not a login prompt. It raises a P1, and its 5-minute ack clock starts.",
    target: '.alarm-row:has(summary[data-alarm="watch-' + FIX_DEVICE + '"]), .alarm-banner',
    open: '.alarm-banner, details.alarm-fold:has(summary[data-alarm="watch-' + FIX_DEVICE + '"])',
    enter() {
      state.view = "rack";
      state.selected = FIX_DEVICE;
    },
  },
  {
    pop: "Ask — “Why is GPU Tray 05 down?” Ask reads the same evidence as Explain: a UEFI shell, no OS. The best way in is ACS serial.",
    target: ".ask-panel",
    enter() {
      state.view = "rack";
      state.selected = FIX_DEVICE;
      demoAsk("Why is GPU Tray 05 down?");
    },
  },
  {
    pop: () => "Operate · Sessions — the alarm launches an ACS serial session on " + fixTty() + ". Out-of-band, so it works with no OS.",
    target: ".session, .xterm-host",
    enter() {
      finishFix();
      fixSessionId = launchAlarmSerial(FIX_DEVICE);
      state.view = "sessions";
    },
  },
  {
    pop: "Operate · Sessions — the console shows why: network boot got no DHCP answer, HTTP boot failed, and the tray fell to the UEFI shell.",
    target: ".xterm-host, .session",
    enter() {
      finishFix();
      state.view = "sessions";
    },
  },
  {
    pop: "Operate · Sessions — AI reads the session, then runs one read-only check: bcfg boot dump.",
    target: ".xterm-host, .session",
    weight: 1.5,
    enter() {
      finishFix();
      state.view = "sessions";
      if (fixSessionId) diagnoseBoot(fixSessionId, true);
    },
  },
  {
    pop: "Operate · Sessions — diagnosis, 93%: the BIOS update reset the boot order. Ubuntu (Boot0003) is last.",
    target: ".session .explain, .session",
    enter() {
      finishFix();
      state.view = "sessions";
    },
  },
  {
    pop: "Operate · Sessions — automatic response: runbook RB-UEFI-01 moves Ubuntu first and resets the tray. Boot order only, no power change.",
    target: ".xterm-host, .session",
    weight: 2,
    enter() {
      finishFix();
      state.view = "sessions";
      if (fixSessionId) fixBoot(fixSessionId, true);
    },
  },
  {
    pop: "Operate · Sessions — verified: Ubuntu is up, acs.watch logs in, and the P1 clears.",
    target: ".session .explain, .session",
    enter() {
      finishFix();
      state.view = "sessions";
      if (fixSessionId) verifyBoot(fixSessionId, true);
    },
  },
  {
    pop: "Audit — alarm, session, AI check, diagnosis, runbook, and verification, each with who ran it.",
    target: ".view",
    enter() {
      finishFix();
      state.view = "audit";
    },
  },
  {
    pop: "Operate · Rack — done. Alarm, serial session, AI diagnosis, automatic fix, verified.",
    target: ".view",
    enter() {
      tidyFixDemo();
      state.view = "rack";
      state.selected = FIX_DEVICE;
    },
  },
];

const KVM_DEVICE = "tray-02";

function tidyMp1000Demo() {
  closeDemoSessions();
  closeMaintenance();
  resetSimulation();
  runtime.sim.barOpen = false;
  calmChrome();
}

function mp1000Session() {
  return (state.sessions || []).find((s) => s.deviceId === KVM_DEVICE && s.via === "mp1000") || null;
}

const MP1000_TOUR: TourBeat[] = [
  {
    pop: "Hall 1. Every rack has an RM1048 rack manager. One MP1000 management platform runs them all.",
    target: ".scene",
    enter() {
      tidyMp1000Demo();
      showFloor("hall");
      state.floor.podId = "pod-a";
    },
  },
  {
    pop: "Operate · Sessions — the MP1000 device list: every server behind every RM1048, with its KVM status. No hunting for IPs.",
    target: ".mp1000-panel",
    enter() {
      state.view = "sessions";
    },
  },
  {
    pop: "Operate · Sessions — consoles open only inside a maintenance window or an in-progress work order. The operator opens a window for rack A14.",
    target: ".mp1000-panel, .view",
    enter() {
      const name = state.maintName;
      state.maintName = "Rack A14 KVM access";
      openMaintenance();
      state.maintName = name;
      state.toast = "";
      state.view = "sessions";
    },
  },
  {
    pop: "Operate · Sessions — the operator picks GPU Tray 02 and clicks Launch KVM.",
    target: '.mp1000-panel tr[data-device="' + KVM_DEVICE + '"], .mp1000-panel',
    enter() {
      state.view = "sessions";
    },
  },
  {
    pop: "Operate · Sessions — MP1000 checks the operator's role and window, then brokers the session through rack A14's RM1048 to the tray's BMC.",
    target: ".session.kvm, .mp1000-panel",
    weight: 1.5,
    enter() {
      if (!mp1000Session()) launchMp1000Kvm(KVM_DEVICE);
      state.view = "sessions";
    },
  },
  {
    pop: "Operate · Sessions — the HTML5 viewer shows the tray's screen, with keyboard and mouse. No Java, no VPN into the rack.",
    target: ".session.kvm .bios, .session.kvm",
    enter() {
      state.view = "sessions";
      const s = mp1000Session();
      if (s) s.screen = "os";
    },
  },
  {
    pop: "Operate · Sessions — the same session reaches BIOS setup, before any OS loads. SSH and RDP can't do that.",
    target: ".session.kvm .bios, .session.kvm",
    enter() {
      state.view = "sessions";
      const s = mp1000Session();
      if (s) setScreen(s.id, "bios");
    },
  },
  {
    pop: "Audit — the MP1000 launch and the KVM session, each with who opened it and the path it took.",
    target: ".view",
    enter() {
      state.view = "audit";
    },
  },
  {
    pop: "Operate · Sessions — done. Device list, launch KVM, brokered through RM1048, HTML5 viewer, audited.",
    target: ".mp1000-panel, .view",
    enter() {
      tidyMp1000Demo();
      state.view = "sessions";
    },
  },
];

type Tour = { title: string; beats: TourBeat[]; tidy: () => void };

const TOURS: Record<string, Tour> = {
  full: { title: "Full demo", beats: FULL_TOUR, tidy: tidyFullDemo },
  fix: { title: "AI fix demo", beats: FIX_TOUR, tidy: tidyFixDemo },
  mp1000: { title: "MP1000 KVM demo", beats: MP1000_TOUR, tidy: tidyMp1000Demo },
};

function currentTour(): Tour | null {
  return TOURS[state.demoId] || null;
}

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
  return ms > 0 ? ms : 4000;
}

function showPlanDate(iso: string) {
  resetSimulation();
  runtime.sim.barOpen = false;
  state.view = "plan";
  state.buildHall = "";
  state.onelineBuild = false;
  state.buildDate = iso;
  state.menuOpen = false;
  state.labOpen = false;
  state.toast = "";
}

function tourBeat() {
  const tour = currentTour();
  if (!tour) return null;
  if (state.demoStep < 0 || state.demoStep >= tour.beats.length) return null;
  return tour.beats[state.demoStep];
}

function beatMs(beat) {
  return Math.round(demoPauseMs() * ((beat && beat.weight) || 1));
}

function scheduleTourAdvance() {
  clearDemoTimer();
  if (!currentTour()) return;
  runtime.demoTimer = setTimeout(() => {
    runtime.demoTimer = 0;
    advanceTour();
  }, beatMs(tourBeat()));
}

function enterTourBeat(index: number) {
  const tour = currentTour();
  const beat = tour ? tour.beats[index] : null;
  if (!beat) return;
  state.demoStep = index;
  state.demoDone = false;
  state.labOpen = false;
  calmChrome();
  resetAsk();
  beat.enter();
}

/* For tests and the demo audit: what the current tour beat points at. */
export function tourBeatInfo() {
  const tour = currentTour();
  const beat = tourBeat();
  if (!tour || !beat) return null;
  return { tour: state.demoId, step: state.demoStep, of: tour.beats.length, caption: textOf(beat.pop), target: beat.target || ".view", view: state.view };
}

export function advanceTour() {
  const tour = currentTour();
  if (!tour) return;
  const next = state.demoStep + 1;
  if (next >= tour.beats.length) {
    stopDemo();
    return;
  }
  enterTourBeat(next);
  render();
  scheduleTourAdvance();
}

/* Kept for callers that predate the second tour. */
export const advanceFullTour = advanceTour;

function startTour(id: string) {
  if (!state.user || state.user.role !== "Operator") return;
  const tour = TOURS[id];
  if (!tour) return;
  if (currentTour()) currentTour()!.tidy();
  state.offerBriefing = false;
  state.briefingStep = -1;
  clearDemoTimer();
  state.demoId = id;
  state.demoDone = false;
  state.labOpen = false;
  state.menuOpen = false;
  state.toast = "";
  state.focusField = "";
  enterTourBeat(0);
  render();
  scheduleTourAdvance();
}

export function startDemo(id) {
  if (TOURS[id]) {
    startTour(id);
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
  startTour("full");
}

export function startFixDemo() {
  startTour("fix");
}

export function startMp1000Demo() {
  startTour("mp1000");
}

export function advanceDemo() {
  if (currentTour()) {
    advanceTour();
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
  const tour = currentTour();
  clearDemoTimer();
  if (tour) tour.tidy();
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
  const tour = currentTour();
  if (tour) {
    const beat = tourBeat();
    if (!beat) return "";
    const progress = (state.demoStep + 1) + " of " + tour.beats.length;
    const ms = beatMs(beat);
    return '<div class="demo-tour" role="region" aria-label="Product demo">' +
      '<div class="demo-veil" aria-hidden="true"></div>' +
      '<div class="demo-spot" aria-hidden="true"></div>' +
      '<div class="demo-pop">' +
      '<p class="demo-kicker">' + esc(tour.title) + " · " + esc(progress) + "</p>" +
      '<p class="demo-caption" id="demo-caption" aria-live="polite">' + esc(textOf(beat.pop)) + "</p>" +
      '<div class="demo-pop-meter" style="--demo-ms:' + ms + 'ms" aria-hidden="true"><i></i></div>' +
      '<div class="demo-actions"><button type="button" class="act" data-act="demo-stop">Stop</button></div>' +
      "</div></div>";
  }
  if (!state.demoId || state.labOpen) return "";
  return demoChrome(true);
}

export function placeDemoHighlights() {
  if (!currentTour()) return;
  const beat = tourBeat();
  if (beat && beat.open) {
    document.querySelectorAll(beat.open).forEach((node) => {
      if (node instanceof HTMLDetailsElement) node.open = true;
    });
  }
  const spot = document.querySelector(".demo-spot") as HTMLElement | null;
  const pop = document.querySelector(".demo-pop") as HTMLElement | null;
  if (!spot || !pop) return;
  const selectors = String((beat && beat.target) || ".view").split(",").map((part) => part.trim()).filter(Boolean);
  let el: Element | null = null;
  for (let i = 0; i < selectors.length; i += 1) {
    el = document.querySelector(selectors[i]);
    if (el) break;
  }
  if (!el) el = document.querySelector(".view") || document.querySelector("main") || document.querySelector(".scene");
  if (!el) {
    spot.style.display = "none";
    return;
  }
  const phone = window.innerWidth < 768;
  let rect = el.getBoundingClientRect();
  const fits = rect.height < window.innerHeight * 0.8;
  if (fits && (rect.top < (phone ? 52 : 0) || rect.bottom > window.innerHeight - (phone ? 160 : 0))) {
    el.scrollIntoView({ block: phone ? "start" : "center" });
    rect = el.getBoundingClientRect();
  }
  const pad = phone ? 6 : 10;
  const safeBottom = phone ? 12 : 8;
  const left = Math.max(8, rect.left - pad);
  const top = Math.max(phone ? 52 : 8, rect.top - pad);
  const width = Math.min(window.innerWidth - left - 8, rect.width + pad * 2);
  const height = Math.min(window.innerHeight - top - (phone ? 150 : 8), rect.height + pad * 2);
  spot.style.display = "block";
  spot.style.left = left + "px";
  spot.style.top = top + "px";
  spot.style.width = Math.max(48, width) + "px";
  spot.style.height = Math.max(phone ? 120 : 48, height) + "px";

  if (phone) {
    pop.classList.add("is-docked");
    pop.style.width = "";
    pop.style.left = "";
    pop.style.top = "";
    pop.style.bottom = "";
    return;
  }
  pop.classList.remove("is-docked");
  const popW = Math.min(340, window.innerWidth - 24);
  pop.style.width = popW + "px";
  let popLeft = left + Math.max(0, (width - popW) / 2);
  popLeft = Math.min(Math.max(12, popLeft), window.innerWidth - popW - 12);
  let popTop = top + height + 14;
  const popHeight = pop.offsetHeight || 140;
  if (popTop + popHeight > window.innerHeight - safeBottom) {
    popTop = Math.max(12, top - popHeight - 14);
  }
  pop.style.left = popLeft + "px";
  pop.style.top = popTop + "px";
  pop.style.bottom = "";
}

export function demoPanel() {
  const picks = SCENARIOS.map((item) => '<button type="button" class="act' +
    (state.demoId === item.id ? " primary" : "") + '" data-act="demo-start" data-demo="' + item.id + '">' +
    esc(item.title) + "</button>").join("");
  if (!state.demoId || currentTour()) {
    return '<section class="demo" aria-labelledby="demo-title"><h3 id="demo-title">Guided demo</h3>' +
      '<p class="fine">Scripted walks through Access. Each step has a caption. Next runs that step. Full demo starts from the sign-in screen.</p>' +
      '<div class="demo-picks">' + picks +
      '<button type="button" class="act" data-act="demo-fix">AI fix demo</button>' +
      '<button type="button" class="act" data-act="demo-mp1000">MP1000 KVM demo</button></div></section>';
  }
  return '<section class="demo" aria-labelledby="demo-title"><h3 id="demo-title">Guided demo</h3>' +
    demoChrome(false) +
    '<div class="demo-picks">' + picks + "</div></section>";
}
