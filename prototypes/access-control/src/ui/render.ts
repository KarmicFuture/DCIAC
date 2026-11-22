import { html, render as litRender } from "lit-html";
import { rackKey, rackSwallowsClick, setRackPreset } from "../views/rack3d";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import { assertWorld, deviceById } from "../data/devices";
import {
  bindSimAlarmReader,
  closeSimBar,
  copySimLink,
  fireEvent,
  openSimBar,
  pauseSim,
  resetSimulation,
  runSimSelection,
  saveSimScenario,
  scrubTo,
  setSimSpeed,
  stepSimCapacity,
} from "../domain/events";
import { applyCapacitySeed, stepCapacity, tick, toggleBmc } from "../domain/failover";
import { onHashChange, syncHash } from "../domain/route";
import { restoreWorld, saveWorld } from "../domain/storage";
import { toggleLeak } from "../domain/leak";
import { actAll, actOutlet, cancelOutlet, outletConfirmHtml, settleOutletHold, showOutlet, submitOutletConfirm, undoOutlet } from "../domain/outlet-policy";
import { closeSession, failRdpToKvm, fallback, openSession, refuseEndpoint, restoreRdp, sendSerial, sessionById, setScreen, toggleMedia } from "../domain/sessions";
import { copyTerm, downloadLog, focusTerm, mountTerminals, searchTerm, sendBreak } from "./terminal";
import { sessionBlocked, toggleRm } from "../domain/single-master";
import { runtime, state } from "../state";
import { ackAlarm, alarmBanner, activeAlarms, goAlarm, refreshSerialWatch } from "./alarms";
import { alarmInput, serialInput } from "./explain";
import { explain, gateAction } from "../domain/analyzer";
import { userAudit } from "../domain/audit";
import { bindRender, render } from "./schedule";
import { go, viewHtml } from "./shell";
import { rail, tabbar, topbar } from "./rail";
import { toastHtml } from "./toast";
import { applyCamera, closeFloorDetail, floorDetailOpen, floorSerial, focusFloorAlarm, goFloor, nudgePlan, onDragEnd, onDragOver, onDragStart, onDrop, onPointerDown, onPointerMove, onPointerUp, onWheel, openFeed, openFloorServer, openPart, openPlan, openPod, openRack, openRow, paintHeat, pickDrill, removePlan, startWalk, stepWalk, stopWalk, toggleWalk, zoomFloor } from "../views/floor";
import { openOnelineHall, openOnelineNode, openOnelineSite } from "../views/oneline";
import { drillOpenHall, setFleetDrill, toggleFleetRacks } from "../views/fleet";
import { advanceBriefing, briefingHtml, skipBriefing, startBriefing } from "../domain/briefing";
import { advanceDemo, demoCoachHtml, loadTheme, placeDemoHighlights, startDemo, startFixDemo, startFullDemo, startMp1000Demo, stopDemo, toggleTheme } from "../domain/demo";
import { diagnoseBoot, runBootFix } from "../domain/autofix";
import { launchMp1000Kvm } from "../domain/mp1000";
import { lab, postLabReadings, resetWorld, saveAsset, toggleMaint } from "../views/lab";
import { login, signIn, signOut } from "../views/login";
import { loadWorld } from "../data/repository";
import { ackAlarm, addScenarioChange, advanceWork, applyInventoryFilter, cancelCable, chooseCablePort, collectSample, compareScenario, createWorkOrder, decideDiscovery, dropCable, exportCables, findHome, importCables, loadAlarms, loadFuturePlan, loadTrend, openHall, openRackCapacity, openReport, planHome, promoteScenario, reportMissing, reservePort, sampleSweep, saveCable, scanAsset, scheduleReport, sendServiceNow, showCableRack, traceCable } from "../views/dcim";
import { dropNetworkCable, exportElevation, saveNetworkCable } from "../views/elevation";
import { failPower, setPowerMode } from "../views/power";
import { cloneModel, importModels, saveModel } from "../views/models";
import { selectDevice } from "../views/rack";

function hydrateFields() {
  const fields = {
    "wo-field": state.wo,
    "maint-name": state.maintName,
    "maint-wo": state.maintWo,
    "asset-tag": state.assetTagDraft,
    "outlet-wo": state.outletGate ? state.outletGate.wo : "",
    "outlet-short": state.outletGate ? state.outletGate.typed : "",
    "port-search": state.portQuery || "",
  };
  Object.keys(fields).forEach((id) => {
    const el = document.getElementById(id);
    if (!el || document.activeElement === el || el.value === fields[id]) return;
    el.value = fields[id];
  });
}

export function settle() {
  if (state.focusField) {
    const field = document.getElementById(state.focusField);
    state.focusField = "";
    if (field) {
      field.focus({ preventScroll: true });
      const end = (field.value || "").length;
      if (field.setSelectionRange) field.setSelectionRange(end, end);
    }
  }
  if (!state.focusTerm) return;
  const id = state.focusTerm;
  state.focusTerm = "";
  focusTerm(id);
}

function panelTitle(panel) {
  if (panel.classList.contains("dcim")) return "DCIM";
  if (panel.classList.contains("inspector")) return "Details";
  if (panel.classList.contains("watch-panel")) return "Serial watch";
  const heading = panel.querySelector("h2");
  return heading && heading.textContent ? heading.textContent.trim() : "Panel";
}

function toggleButton(key, collapsed) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "act panel-toggle";
  button.dataset.act = "panel-toggle";
  button.dataset.panel = key;
  button.setAttribute("aria-expanded", collapsed ? "false" : "true");
  button.textContent = collapsed ? "Show" : "Hide";
  return button;
}

function dressChrome() {
  document.querySelectorAll(".scene-popbar").forEach((node) => node.remove());
  document.querySelectorAll("#content section.panel, #content aside.inspector:not(.drawer)").forEach((node) => {
    const panel = node as HTMLElement;
    const title = panelTitle(panel);
    const key = state.view + ":" + title;
    const collapsed = !!state.collapsed[key];
    panel.classList.toggle("is-collapsed", collapsed);
    panel.querySelectorAll(":scope > .panel-bar > .panel-toggle, :scope > .panel-head > .panel-toggle").forEach((button) => button.remove());
    const head = panel.querySelector(":scope > .panel-head") as HTMLElement | null;
    if (head) {
      head.classList.add("panel-bar");
      head.appendChild(toggleButton(key, collapsed));
      return;
    }
    let bar = panel.querySelector(":scope > .panel-bar") as HTMLElement | null;
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "panel-bar";
      const heading = panel.querySelector(":scope > h2");
      if (heading) bar.appendChild(heading);
      else {
        const made = document.createElement("h2");
        made.textContent = title;
        bar.appendChild(made);
      }
      panel.insertBefore(bar, panel.firstChild);
    }
    bar.appendChild(toggleButton(key, collapsed));
  });
  document.querySelectorAll("details.lib").forEach((node) => {
    const details = node as HTMLDetailsElement;
    const summary = details.querySelector("summary");
    if (!summary || summary.querySelector(".panel-toggle")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "act panel-toggle";
    button.dataset.act = "lib-toggle";
    button.textContent = details.open ? "Hide" : "Show";
    button.addEventListener("mousedown", (event) => event.preventDefault());
    summary.appendChild(button);
  });
  document.querySelectorAll("#content .scene").forEach((node) => {
    const scene = node as HTMLElement;
    scene.classList.toggle("is-popped", state.scenePop);
    scene.classList.toggle("is-full", state.scenePop && state.sceneFull);
    const bar = document.createElement("div");
    bar.className = "scene-popbar";
    const pop = document.createElement("button");
    pop.type = "button";
    pop.className = "act";
    pop.dataset.act = "scene-pop";
    pop.textContent = state.scenePop ? "Dock" : "Pop out";
    bar.appendChild(pop);
    if (state.scenePop) {
      const fill = document.createElement("button");
      fill.type = "button";
      fill.className = "act";
      fill.dataset.act = "scene-full";
      fill.textContent = state.sceneFull ? "Window" : "Fill screen";
      bar.appendChild(fill);
    }
    const hud = scene.querySelector(".hud");
    if (hud) hud.appendChild(bar);
    else scene.appendChild(bar);
  });
}

function clearBootNote(root) {
  Array.from(root.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE && node.textContent && node.textContent.indexOf("asset repository") >= 0) node.remove();
  });
}

function syncOutletInert() {
  const open = !!(state.outletGate && state.outletGate.phase === "confirm");
  const app = document.getElementById("app");
  if (!app) return;
  const targets = [];
  Array.from(app.children).forEach((child) => {
    if (child instanceof HTMLElement && !child.classList.contains("shell")) targets.push(child);
  });
  const shell = app.querySelector(".shell");
  if (shell) {
    Array.from(shell.children).forEach((child) => {
      if (child instanceof HTMLElement && child.dataset.slot !== "confirm") targets.push(child);
    });
  }
  const railNav = document.querySelector("header.rail nav");
  if (railNav instanceof HTMLElement) targets.push(railNav);
  targets.forEach((node) => {
    if (open) node.setAttribute("inert", "");
    else node.removeAttribute("inert");
  });
}

function confirmFocusables() {
  const card = document.querySelector(".confirm-card");
  if (!card) return [];
  return Array.from(card.querySelectorAll('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])'))
    .filter((el) => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.getAttribute("aria-disabled") === "true") return false;
      if (el.hasAttribute("disabled")) return false;
      return el.tabIndex !== -1;
    });
}

function outletConfirmKeys(event) {
  const gate = state.outletGate;
  if (!gate || gate.phase !== "confirm") return false;
  if (event.key === "Escape") {
    event.preventDefault();
    cancelOutlet();
    return true;
  }
  if (event.key !== "Tab") return false;
  const items = confirmFocusables();
  if (!items.length) return false;
  const active = document.activeElement;
  const idx = items.indexOf(active);
  const last = items.length - 1;
  if (!event.shiftKey && idx === last) {
    event.preventDefault();
    items[0].focus({ preventScroll: true });
    return true;
  }
  if (event.shiftKey && idx === 0) {
    event.preventDefault();
    items[last].focus({ preventScroll: true });
    return true;
  }
  return false;
}

let floorDrawerFocusRestore = "";

const floorDrawerAttrKeys = ["pod", "rack", "row", "server", "level", "feed", "part", "plan"];

function recordFloorDrawerFocus() {
  floorDrawerFocusRestore = "";
  if (state.view !== "floor") return;
  const drawer = document.getElementById("floor-detail");
  if (!drawer) return;
  const active = document.activeElement;
  if (!active || active === document.body || (active !== drawer && !drawer.contains(active))) return;
  if (active === drawer) {
    floorDrawerFocusRestore = "#floor-detail";
    return;
  }
  const el = active.closest("[data-act]");
  if (!el || !drawer.contains(el)) {
    floorDrawerFocusRestore = "#floor-detail";
    return;
  }
  let sel = '[data-act="' + el.getAttribute("data-act") + '"]';
  floorDrawerAttrKeys.forEach((key) => {
    const val = el.getAttribute("data-" + key);
    if (val) sel += '[data-' + key + '="' + val + '"]';
  });
  floorDrawerFocusRestore = sel;
}

function restoreFloorDrawerFocus() {
  const sel = floorDrawerFocusRestore;
  floorDrawerFocusRestore = "";
  if (!sel) return;
  const active = document.activeElement;
  if (active && active !== document.body) return;
  const drawer = document.getElementById("floor-detail");
  if (!drawer) return;
  if (sel === "#floor-detail") {
    drawer.focus({ preventScroll: true });
    return;
  }
  const target = drawer.querySelector(sel);
  if (target && target.focus) target.focus({ preventScroll: true });
  else drawer.focus({ preventScroll: true });
}

function paint() {
  const root = document.getElementById("app");
  if (!root) return;
  clearBootNote(root);
  if (state.user) refreshSerialWatch();
  if (!state.user) {
    runtime.lastRenderedView = "login";
    litRender(html`${unsafeHTML(login())}`, root);
    return;
  }
  const viewKey = state.view;
  const viewChanged = viewKey !== runtime.lastRenderedView;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  runtime.lastRenderedView = viewKey;
  recordFloorDrawerFocus();
  litRender(html`${unsafeHTML('<a class="skip" href="#content">Skip to content</a>')}<div class="shell" data-screen="app" data-view=${state.view} data-demo=${state.demoId || ""} data-menu=${state.menuOpen ? "open" : "closed"}>${unsafeHTML(rail())}<main id="content" tabindex="-1">${unsafeHTML(topbar())}<div data-slot="alarm" aria-live="polite" aria-atomic="false">${unsafeHTML(alarmBanner())}</div><div data-slot="toast" aria-live="polite" aria-atomic="true">${unsafeHTML(toastHtml())}</div><div class="view">${unsafeHTML(viewHtml())}</div>${unsafeHTML(tabbar())}</main>${unsafeHTML(state.labOpen ? lab() : "")}${unsafeHTML(demoCoachHtml())}${unsafeHTML(briefingHtml())}<div data-slot="confirm">${unsafeHTML(outletConfirmHtml())}</div></div>`, root);
  if (viewChanged) window.scrollTo(0, 0);
  else window.scrollTo(scrollX, scrollY);
  hydrateFields();
  dressChrome();
  mountTerminals();
  markScrollers();
  syncOutletInert();
  settle();
  restoreFloorDrawerFocus();
  applyCamera();
  paintHeat();
  placeDemoHighlights();
  syncHash();
  saveWorld();
}

export function syncFields() {
  const wo = document.getElementById("wo-field");
  if (wo) state.wo = wo.value;
  const name = document.getElementById("maint-name");
  if (name) state.maintName = name.value;
  const tag = document.getElementById("asset-tag");
  if (tag) state.assetTagDraft = tag.value;
  const mwo = document.getElementById("maint-wo");
  if (mwo) state.maintWo = mwo.value;
}

export function onClick(event) {
  if (rackSwallowsClick()) return;
  let el = event.target.closest("[data-act]");
  if (state.user && state.view === "floor" && !event.target.closest(".hud, .sim-bar, .sim-dock, .sim-timeline, .sim-stripe, .legend, .inspector, .lib, .page-head, .alarm-banner, .watch-panel, .rail, .topbar, .tabbar, .menu-back, .walk-bar, .elev-scene, .lab, .scene-popbar, .panel-bar, .briefing, .demo-tour")) {
    const picked = pickDrill(event.clientX, event.clientY);
    if (picked) el = picked;
  }
  if (!el && state.user && state.view === "plan" && event.target.closest && event.target.closest(".build-scene")) {
    /* The build scene captures the pointer to orbit, so the click lands on the scene.
       Find the hall under the pointer instead. */
    const under = document.elementFromPoint(event.clientX, event.clientY);
    const hall = under && under.closest ? under.closest('[data-act="build-open"]') : null;
    if (hall) el = hall;
  }
  const floorBlank = !el && state.user && state.view === "floor";
  if ((!el || el.disabled) && !floorBlank) return;
  if (el && el.dataset.port) state.selectedPort = Number(el.dataset.port) || 0;
  if (el) syncFields();
  const act = el ? el.dataset.act : "";
  if (act === "login") {
    signIn(el.dataset.user);
    return;
  }
  if (act === "theme") {
    toggleTheme();
    return;
  }
  if (act === "demo-full" || act === "demo-fix" || act === "demo-mp1000") {
    const start = act === "demo-fix" ? startFixDemo : (act === "demo-mp1000" ? startMp1000Demo : startFullDemo);
    if (state.user) {
      start();
      return;
    }
    signIn("dsvs.operator").then(() => {
      state.offerBriefing = false;
      state.briefingStep = -1;
      start();
    });
    return;
  }
  if (!state.user) return;
  if (state.floor.suppressClick) {
    state.floor.suppressClick = false;
    return;
  }
  if (!el) {
    const scene = event.target.closest && event.target.closest(".scene");
    const chrome = event.target.closest && event.target.closest(".hud, .sim-bar, .sim-dock, .sim-timeline, .sim-stripe, .legend, .lib, .inspector, .walk-bar, .scene-popbar");
    if (scene && !chrome && (state.inspectorOpen || state.plan.selected || state.plan.preview)) {
      closeFloorDetail();
      render();
    }
    return;
  }
  if (act === "signout") signOut();
  else if (act === "menu") { state.menuOpen = !state.menuOpen; render(); }
  else if (act === "menu-close") { state.menuOpen = false; render(); }
  else if (act === "nav") go(el.dataset.view);
  else if (act === "port-filter") { state.portFilter = el.dataset.filter || "all"; render(); }
  else if (act === "port-density") { state.portCompact = !state.portCompact; render(); }
  else if (act === "horizon") { state.horizon = el.dataset.horizon === "future" ? "future" : "now"; render(); if (state.horizon === "future") loadFuturePlan(); }
  else if (act === "build-day" || act === "build-stage") { state.buildDate = el.dataset.date || state.buildDate; render(); }
  else if (act === "build-open") {
    if (el.dataset.pod) {
      state.buildHall = el.dataset.pod;
      state.toast = "";
      render();
    }
  }
  else if (act === "build-hall-close") { state.buildHall = ""; render(); }
  else if (act === "rack-view") { setRackPreset(el.dataset.rackView || "angle"); render(); }
  else if (act === "pdu-outlet") {
    state.view = "control";
    state.highlightOutlet = Number(el.dataset.outlet) || 0;
    state.toast = "";
    render();
  }
  else if (act === "gantt-open" && el.dataset.pod) {
    state.view = "plan";
    state.buildHall = el.dataset.pod;
    state.buildDate = el.dataset.date || state.buildDate;
    state.toast = "";
    render();
  }
  else if (act === "oneline-build") { state.onelineBuild = !state.onelineBuild; render(); }
  else if (act === "oneline-build-hall" && el.dataset.pod) {
    state.view = "plan";
    state.buildHall = el.dataset.pod;
    state.toast = "";
    render();
  }
  else if (act === "build-live" && el.dataset.pod) { openOnelineHall(el.dataset.pod); render(); }
  else if (act === "contain") { state.containment = el.dataset.mode === "cac" ? "cac" : "hac"; render(); }
  else if (act === "horizon-focus") { state.horizon = "future"; state.view = "manage"; render(); loadFuturePlan(); }
  else if (act === "manage-layer") { state.manage.layer = el.dataset.layer || "bmc"; render(); }
  else if (act === "manage-device") { state.manage.device = el.dataset.device; state.selected = el.dataset.device; render(); }
  else if (act === "select") selectDevice(el.dataset.device);
  else if (act === "launch") {
    const medium = el.dataset.medium || (el.dataset.type === "serial" && el.dataset.path === "acs" ? "rs232" : "");
    openSession(el.dataset.device, el.dataset.path, el.dataset.type, medium);
  } else if (act === "fallback") fallback(el.dataset.device, el.dataset.type);
  else if (act === "refuse") refuseEndpoint(el.dataset.key);
  else if (act === "outlet") actOutlet(Number(el.dataset.outlet), el.dataset.op, el.dataset.source || "");
  else if (act === "outlet-confirm") submitOutletConfirm();
  else if (act === "outlet-cancel") cancelOutlet();
  else if (act === "outlet-undo") undoOutlet();
  else if (act === "all-outlets") actAll();
  else if (act === "mount") toggleMedia(el.dataset.session);
  else if (act === "screen") setScreen(el.dataset.session, el.dataset.screen);
  else if (act === "close-session") closeSession(el.dataset.session);
  else if (act === "demo-start") startDemo(el.dataset.demo);
  else if (act === "demo-next") advanceDemo();
  else if (act === "demo-stop") stopDemo();
  else if (act === "briefing-start") startBriefing();
  else if (act === "briefing-next") advanceBriefing();
  else if (act === "briefing-skip") skipBriefing();
  else if (act === "lab-open" || act === "simulate") {
    state.labOpen = false;
    state.menuOpen = false;
    state.view = "simulate";
    state.toast = "";
    render();
  }
  else if (act === "sim-open") openSimBar();
  else if (act === "sim-close") closeSimBar();
  else if (act === "sim-run") runSimSelection();
  else if (act === "sim-pause") pauseSim();
  else if (act === "sim-speed") { setSimSpeed(Number(el.dataset.speed) || 1); render(); }
  else if (act === "sim-reset") resetSimulation();
  else if (act === "sim-scrub") scrubTo(Number(el.dataset.at) || 0);
  else if (act === "sim-copy") copySimLink();
  else if (act === "sim-save") saveSimScenario();
  else if (act === "sim-break") {
    runtime.sim.barOpen = true;
    runtime.sim.running = true;
    runtime.sim.paused = false;
    fireEvent(el.dataset.event || "", el.dataset.target || "", { stay: true });
  }
  else if (act === "oneline-open") openOnelineNode(el.dataset.server || "");
  else if (act === "oneline-hall") openOnelineHall(el.dataset.pod || "");
  else if (act === "fleet-racks") { toggleFleetRacks(el.dataset.pod || ""); render(); }
  else if (act === "fleet-sort") { setFleetDrill(drillOpenHall(), el.dataset.sort || ""); render(); }
  else if (act === "oneline-site") { openOnelineSite(); render(); }
  else if (act === "lab-close") { state.labOpen = false; render(); }
  else if (act === "bmc-toggle") toggleBmc(el.dataset.device);
  else if (act === "floor-pod") {
    const inside = state.floor.level === "hall" || state.floor.level === "pod" || state.floor.level === "row";
    if (inside && el.dataset.pod === state.floor.podId) startWalk(el.dataset.pod);
    else openPod(el.dataset.pod);
  }
  else if (act === "floor-walk") startWalk(state.floor.podId);
  else if (act === "floor-walk-stop") stopWalk(true);
  else if (act === "floor-walk-pause") toggleWalk();
  else if (act === "floor-walk-step") stepWalk(el.dataset.dir === "prev" ? -1 : 1);
  else if (act === "model-new") { state.modelEdit = "new"; render(); }
  else if (act === "model-cancel") { state.modelEdit = ""; render(); }
  else if (act === "model-edit") { state.modelEdit = el.dataset.id || ""; render(); }
  else if (act === "model-clone") cloneModel(el.dataset.id || "");
  else if (act === "floor-row") openRow(el.dataset.pod, el.dataset.row);
  else if (act === "floor-feed") openFeed(el.dataset.pod, el.dataset.feed);
  else if (act === "floor-part") openPart(el.dataset.server, el.dataset.part);
  else if (act === "floor-rack") openRack(el.dataset.pod, el.dataset.rack);
  else if (act === "elev-3d") { state.floor.elevation3d = el.dataset.mode !== "2d"; render(); }
  else if (act === "elev-face") { state.floor.elevationFace = el.dataset.face === "rear" ? "rear" : "front"; render(); }
  else if (act === "elev-net-save") saveNetworkCable();
  else if (act === "elev-net-drop") dropNetworkCable(el.dataset.id || "");
  else if (act === "elev-png") exportElevation("png");
  else if (act === "elev-pdf") exportElevation("pdf");
  else if (act === "elev-chassis") { state.floor.level = "rack"; render(); }
  else if (act === "rack-positions") { state.floor.level = "elevation"; render(); }
  else if (act === "power-fail") failPower(el.dataset.power || "", el.dataset.node || "");
  else if (act === "power-mode") setPowerMode(el.dataset.power || "", el.dataset.mode || "nameplate");
  else if (act === "dcim-tab") {
    runtime.dcim.tab = el.dataset.tab || "capacity";
    if (runtime.dcim.tab === "monitor") loadAlarms();
    else render();
  }
  else if (act === "dcim-home") findHome();
  else if (act === "dcim-plan") planHome(el.dataset.rack || "");
  else if (act === "dcim-promote") promoteScenario();
  else if (act === "dcim-advance") advanceWork(el.dataset.id || "", el.dataset.to || "");
  else if (act === "dcim-cable-show") showCableRack();
  else if (act === "dcim-cable-near") chooseCablePort(el.dataset.port || "");
  else if (act === "dcim-cable-save") saveCable();
  else if (act === "dcim-cable-cancel") cancelCable();
  else if (act === "dcim-cable-drop") dropCable(el.dataset.id || "");
  else if (act === "dcim-cable-reserve") reservePort(el.dataset.port || "", "reserved");
  else if (act === "dcim-cable-free") reservePort(el.dataset.port || "", "free");
  else if (act === "dcim-trace") traceCable(el.dataset.port || "");
  else if (act === "dcim-cables") exportCables();
  else if (act === "dcim-report") openReport(el.dataset.kind || "capacity", "");
  else if (act === "dcim-csv") openReport(runtime.dcim.reportKind || "capacity", "csv");
  else if (act === "dcim-pdf") openReport(runtime.dcim.reportKind || "capacity", "pdf");
  else if (act === "dcim-ack") ackAlarm(el.dataset.id || "");
  else if (act === "dcim-decide") decideDiscovery(el.dataset.id || "", el.dataset.accept !== "0");
  else if (act === "dcim-scan") scanAsset();
  else if (act === "dcim-hall") openHall(el.dataset.id || "");
  else if (act === "dcim-rack") openRackCapacity(el.dataset.id || "");
  else if (act === "dcim-diff") compareScenario();
  else if (act === "dcim-change") addScenarioChange();
  else if (act === "dcim-wo-new") createWorkOrder();
  else if (act === "dcim-collect") collectSample(el.dataset.source || "lab");
  else if (act === "dcim-trend") loadTrend();
  else if (act === "dcim-schedule") scheduleReport();
  else if (act === "dcim-snow") sendServiceNow(el.dataset.id || "");
  else if (act === "dcim-filter") applyInventoryFilter();
  else if (act === "dcim-sweep") sampleSweep();
  else if (act === "dcim-missing") reportMissing();
  else if (act === "dcim-console") openSession(el.dataset.device || "", "acs", "serial", "rs232");
  else if (act === "elev-device") {
    const device = deviceById(el.dataset.tag || "");
    if (device && !device.serialOnly) openFloorServer(device.id);
  }
  else if (act === "floor-server") {
    if (el.dataset.part && state.floor.level === "server" && state.floor.serverId === el.dataset.server) openPart(el.dataset.server, el.dataset.part);
    else openFloorServer(el.dataset.server);
  }
  else if (act === "floor-hall") {
    state.view = "floor";
    state.inspectorOpen = false;
    state.floor.podId = el.dataset.pod || "pod-a";
    state.floor.level = "hall";
    state.floor.serverId = "";
    state.floor.rowId = "";
    state.floor.feedId = "";
    state.floor.partId = "";
    state.floor.zoom = Math.max(state.floor.zoom, 0.9);
    render();
  }
  else if (act === "floor-go") goFloor(el.dataset.level);
  else if (act === "floor-serial") floorSerial(el.dataset.device);
  else if (act === "rdp-open") openSession(el.dataset.device, "rdp", "desktop", "");
  else if (act === "copy-ssh") {
    const text = el.dataset.text || "";
    try { navigator.clipboard.writeText(text); } catch (err) { /* the toast still shows the command */ }
    state.toast = "Copied: " + text;
    render();
  }
  else if (act === "rdp-drop" || act === "rdp-failover") failRdpToKvm(el.dataset.device);
  else if (act === "mp1000-kvm") launchMp1000Kvm(el.dataset.device);
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
  else if (act === "alarm-focus") {
    if (state.view === "floor") {
      const alarm = activeAlarms().find((item) => item.id === el.dataset.alarm);
      if (alarm) focusFloorAlarm(alarm);
    }
  }
  else if (act === "alarm-go") {
    event.preventDefault();
    event.stopPropagation();
    goAlarm(el.dataset.alarm);
  }
  else if (act === "explain-run") runExplain(el.dataset.explainKind, el.dataset.explainId);
  else if (act === "plan-maker") { state.plan.maker = el.dataset.maker; render(); }
  else if (act === "library-open") { state.libraryOpen = !state.libraryOpen; render(); }
  else if (act === "floor-list") {
    if (floorDetailOpen()) { closeFloorDetail(); state.focusField = "floor-list-toggle"; }
    else { state.floorListOpen = true; state.focusField = "floor-detail"; }
    render();
  }
  else if (act === "plan-preview") {
    state.plan.preview = el.dataset.catalog;
    state.plan.selected = "";
    state.inspectorOpen = true;
    render();
  }
  else if (act === "plan-select") {
    state.plan.selected = el.dataset.plan;
    state.plan.preview = "";
    state.inspectorOpen = true;
    render();
  }
  else if (act === "plan-open") openPlan(el.dataset.plan);
  else if (act === "plan-remove") removePlan(el.dataset.plan);
  else if (act === "plan-nudge") nudgePlan(el.dataset.plan, el.dataset.dir);
  else if (act === "rm-toggle") toggleRm();
  else if (act === "leak-toggle") toggleLeak();
  else if (act === "maint-toggle") toggleMaint();
  else if (act === "reset-world") resetWorld();
  else if (act === "lab-post") postLabReadings();
  else if (act === "panel-toggle") {
    const key = el.dataset.panel || "";
    state.collapsed[key] = !state.collapsed[key];
    render();
  }
  else if (act === "lib-toggle") {
    const details = el.closest("details");
    if (details) details.open = !details.open;
    render();
  }
  else if (act === "scene-pop") {
    state.scenePop = !state.scenePop;
    if (!state.scenePop) {
      state.sceneFull = false;
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => undefined);
    }
    render();
  }
  else if (act === "scene-full") {
    state.sceneFull = !state.sceneFull;
    render();
    const scene = document.querySelector(".scene.is-popped");
    if (state.sceneFull && scene && scene.requestFullscreen) scene.requestFullscreen().catch(() => undefined);
    else if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => undefined);
  }
  else if (act === "asset") saveAsset();
  else if (act === "term-copy") copyTerm(el.dataset.session);
  else if (act === "term-search") {
    const wrap = el.closest(".term-wrap");
    const query = wrap ? wrap.querySelector("[data-term-query]") : null;
    searchTerm(el.dataset.session, query ? query.value : "");
  }
  else if (act === "term-break") sendBreak(el.dataset.session);
  else if (act === "term-download") downloadLog(el.dataset.session);
  else if (act === "dismiss-toast") { state.toast = ""; render(); }
  else if (act === "show-outlet") showOutlet(el.dataset.outlet);
}

function runExplain(kind, id) {
  let input = null;
  if (kind === "serial") {
    const session = sessionById(id);
    if (session) input = serialInput(session);
  } else {
    const alarm = activeAlarms().find((item) => item.id === id);
    if (alarm) input = alarmInput(alarm);
  }
  if (!input || !state.user) return;
  const result = explain(input);
  const gate = gateAction(input, result);
  if (!gate.enabled) {
    state.toast = gate.reason || gate.label;
    render();
    return;
  }
  userAudit("suggested by analyzer, executed by " + state.user.id, {
    asset: input.asset,
    outlet: gate.suggestion === "cycle-outlet" || gate.suggestion === "shed-outlet" ? "Outlet " + input.outlet : "",
    detail: gate.label + ". " + result.cause,
  });
  if (gate.suggestion === "open-acs-serial") openSession(input.deviceId, "acs", "serial", "rs232");
  else if (gate.suggestion === "open-acs-kvm") openSession(input.deviceId, "acs", "kvm", "");
  else if (gate.suggestion === "cycle-outlet") actOutlet(input.outlet, "cycle", "");
  else if (gate.suggestion === "shed-outlet") actOutlet(input.outlet, "off", "");
  else if (gate.suggestion === "open-rack") {
    state.selected = input.deviceId || state.selected;
    go("rack");
  }
  else if (gate.suggestion === "diagnose-boot") diagnoseBoot(input.id, false);
  else if (gate.suggestion === "fix-boot-order") runBootFix(input.id, false);
  else if (gate.suggestion === "open-server") openFloorServer(input.deviceId);
  else if (gate.suggestion === "open-inlet") openPart(input.deviceId, "inlet");
  else go("control");
}

export function onSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.dataset.act === "model-save") {
    event.preventDefault();
    saveModel(form);
    return;
  }
  if (form.dataset.act !== "serial-line") return;
  event.preventDefault();
  sendSerial(form.dataset.session, new FormData(form).get("line"));
}

export function onInput(event) {
  const target = event.target;
  if (target.id === "wo-field") state.wo = target.value;
  if (target.id === "maint-name") state.maintName = target.value;
  if (target.id === "maint-wo") state.maintWo = target.value;
  if (target.id === "asset-tag") state.assetTagDraft = target.value;
  if (state.outletGate && target.id === "outlet-wo") state.outletGate.wo = target.value;
  if (state.outletGate && target.id === "outlet-short") state.outletGate.typed = target.value;
  if (target.id === "port-search") {
    state.portQuery = target.value;
    state.focusField = "port-search";
    render();
  }
  if (target.id === "sim-event") {
    runtime.sim.eventId = target.value;
    runtime.sim.targetId = "";
    render();
  }
  if (target.id === "sim-target") {
    runtime.sim.targetId = target.value;
  }
}

export function onChange(event) {
  const target = event.target;
  if (target.dataset && target.dataset.csvModels && target.files && target.files[0]) {
    importModels(target.files[0]);
    target.value = "";
    return;
  }
  if (target.dataset && target.dataset.csvCables && target.files && target.files[0]) {
    importCables(target.files[0]);
    target.value = "";
    return;
  }
  if (target.id === "dcim-cable-hall") {
    runtime.dcim.cableHall = target.value;
    runtime.dcim.cableRack = target.value === "1" ? "A14" : "H" + target.value + "-01";
    render();
    return;
  }
  if (target.id === "dcim-cable-device") {
    runtime.dcim.cableDevice = target.value;
    runtime.dcim.nearPort = "";
    render();
    return;
  }
  if (!target.dataset || !target.dataset.mediaFor) return;
  const session = sessionById(target.dataset.mediaFor);
  if (session) session.mediaChoice = target.value;
}

export function onKeyDown(event) {
  if (outletConfirmKeys(event)) return;
  if (rackKey(event)) return;
  if (event.key === "Escape") {
    const typing = event.target.closest && event.target.closest("input, textarea, select");
    if (typing) return;
    if (state.view === "floor" && (state.libraryOpen || state.inspectorOpen || state.floorListOpen || state.plan.selected || state.plan.preview)) {
      state.libraryOpen = false;
      closeFloorDetail();
      state.focusField = document.getElementById("floor-list-toggle") ? "floor-list-toggle" : "content";
      render();
    }
    return;
  }
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

function markScrollers() {
  document.querySelectorAll(".table-wrap, .elevation, .rail, .lab").forEach((node) => {
    const el = node as HTMLElement;
    const scrolls = el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2;
    if (scrolls && el.tabIndex < 0) el.tabIndex = 0;
  });
}

export async function boot() {
  loadTheme();
  bindSimAlarmReader(() => activeAlarms().map((alarm) => ({
    id: alarm.id,
    text: alarm.text,
    asset: alarm.asset,
  })));
  const root = document.getElementById("app");
  if (root) root.textContent = "Loading the asset repository…";
  try {
    await loadWorld();
  } catch (err) {
    if (root) root.textContent = "The asset repository is not reachable. Start serve.py and open this page again.";
    return;
  }
  applyCapacitySeed();
  assertWorld();
  restoreWorld();
  window.addEventListener("hashchange", onHashChange);
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
  setInterval(() => { tick(); settleOutletHold(); }, 250);
  setInterval(() => stepSimCapacity(stepCapacity, 1000), 100);
  render();
}

bindRender(paint);
