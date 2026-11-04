import { html, render as litRender } from "lit-html";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import { assertWorld, deviceById } from "../data/devices";
import { applyCapacitySeed, stepCapacity, tick, toggleBmc } from "../domain/failover";
import { onHashChange, syncHash } from "../domain/route";
import { restoreWorld, saveWorld } from "../domain/storage";
import { toggleLeak } from "../domain/leak";
import { actAll, actOutlet, cancelOutlet, settleOutletHold, showOutlet, submitOutletConfirm, undoOutlet } from "../domain/outlet-policy";
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
import { applyCamera, floorSerial, goFloor, nudgePlan, onDragEnd, onDragOver, onDragStart, onDrop, onPointerDown, onPointerMove, onPointerUp, onWheel, openFeed, openFloorServer, openPart, openPlan, openPod, openRack, openRow, paintHeat, pickDrill, removePlan, zoomFloor } from "../views/floor";
import { advanceDemo, loadTheme, startDemo, stopDemo, toggleTheme } from "../domain/demo";
import { lab, resetWorld, saveAsset, toggleMaint } from "../views/lab";
import { login, signIn, signOut } from "../views/login";
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
      const end = field.value.length;
      if (field.setSelectionRange) field.setSelectionRange(end, end);
    }
  }
  if (!state.focusTerm) return;
  const id = state.focusTerm;
  state.focusTerm = "";
  focusTerm(id);
}

function paint() {
  const root = document.getElementById("app");
  if (!root) return;
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
  litRender(html`${unsafeHTML('<a class="skip" href="#content">Skip to content</a>')}<div class="shell" data-screen="app" data-view=${state.view} data-menu=${state.menuOpen ? "open" : "closed"}>${unsafeHTML(rail())}<main id="content" tabindex="-1">${unsafeHTML(topbar())}<div data-slot="alarm" aria-live="polite" aria-atomic="false">${unsafeHTML(alarmBanner())}</div><div data-slot="toast" aria-live="polite" aria-atomic="true">${unsafeHTML(toastHtml())}</div><div class="view">${unsafeHTML(viewHtml())}</div>${unsafeHTML(tabbar())}</main>${unsafeHTML(state.labOpen ? lab() : "")}</div>`, root);
  if (viewChanged) window.scrollTo(0, 0);
  else window.scrollTo(scrollX, scrollY);
  hydrateFields();
  mountTerminals();
  markScrollers();
  settle();
  applyCamera();
  paintHeat();
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
  let el = event.target.closest("[data-act]");
  if (state.user && state.view === "floor" && !event.target.closest(".hud, .legend, .inspector, .lib, .page-head, .alarm-banner, .watch-panel, .rail, .topbar, .tabbar, .menu-back")) {
    const picked = pickDrill(event.clientX, event.clientY);
    if (picked) el = picked;
  }
  if (!el || el.disabled) return;
  if (el.dataset.port) state.selectedPort = Number(el.dataset.port) || 0;
  syncFields();
  const act = el.dataset.act;
  if (act === "login") {
    signIn(el.dataset.user);
    return;
  }
  if (act === "theme") {
    toggleTheme();
    return;
  }
  if (!state.user) return;
  if (state.floor.suppressClick) {
    state.floor.suppressClick = false;
    return;
  }
  if (act === "signout") signOut();
  else if (act === "menu") { state.menuOpen = !state.menuOpen; render(); }
  else if (act === "menu-close") { state.menuOpen = false; render(); }
  else if (act === "nav") go(el.dataset.view);
  else if (act === "port-filter") { state.portFilter = el.dataset.filter || "all"; render(); }
  else if (act === "port-density") { state.portCompact = !state.portCompact; render(); }
  else if (act === "horizon") { state.horizon = el.dataset.horizon === "future" ? "future" : "now"; render(); }
  else if (act === "contain") { state.containment = el.dataset.mode === "cac" ? "cac" : "hac"; render(); }
  else if (act === "horizon-focus") { state.horizon = "future"; state.view = "manage"; render(); }
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
  else if (act === "lab-open") { state.labOpen = true; state.menuOpen = false; render(); }
  else if (act === "lab-close") { state.labOpen = false; render(); }
  else if (act === "bmc-toggle") toggleBmc(el.dataset.device);
  else if (act === "floor-pod") openPod(el.dataset.pod);
  else if (act === "floor-row") openRow(el.dataset.pod, el.dataset.row);
  else if (act === "floor-feed") openFeed(el.dataset.pod, el.dataset.feed);
  else if (act === "floor-part") openPart(el.dataset.server, el.dataset.part);
  else if (act === "floor-rack") openRack(el.dataset.pod, el.dataset.rack);
  else if (act === "floor-server") {
    if (el.dataset.part && state.floor.level === "server" && state.floor.serverId === el.dataset.server) openPart(el.dataset.server, el.dataset.part);
    else openFloorServer(el.dataset.server);
  }
  else if (act === "floor-go") goFloor(el.dataset.level);
  else if (act === "floor-serial") floorSerial(el.dataset.device);
  else if (act === "rdp-open") openSession(el.dataset.device, "rdp", "desktop", "");
  else if (act === "rdp-drop" || act === "rdp-failover") failRdpToKvm(el.dataset.device);
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
  else if (act === "alarm-go") goAlarm(el.dataset.alarm);
  else if (act === "explain-run") runExplain(el.dataset.explainKind, el.dataset.explainId);
  else if (act === "plan-maker") { state.plan.maker = el.dataset.maker; render(); }
  else if (act === "plan-preview") {
    state.plan.preview = el.dataset.catalog;
    state.plan.selected = "";
    render();
  }
  else if (act === "plan-select") {
    state.plan.selected = el.dataset.plan;
    state.plan.preview = "";
    render();
  }
  else if (act === "plan-open") openPlan(el.dataset.plan);
  else if (act === "plan-remove") removePlan(el.dataset.plan);
  else if (act === "plan-nudge") nudgePlan(el.dataset.plan, el.dataset.dir);
  else if (act === "rm-toggle") toggleRm();
  else if (act === "leak-toggle") toggleLeak();
  else if (act === "maint-toggle") toggleMaint();
  else if (act === "reset-world") resetWorld();
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
  else if (gate.suggestion === "open-server") openFloorServer(input.deviceId);
  else if (gate.suggestion === "open-inlet") openPart(input.deviceId, "inlet");
  else go("control");
}

export function onSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.dataset.act !== "serial-line") return;
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
}

export function onChange(event) {
  const target = event.target;
  if (!target.dataset || !target.dataset.mediaFor) return;
  const session = sessionById(target.dataset.mediaFor);
  if (session) session.mediaChoice = target.value;
}

export function onKeyDown(event) {
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

export function boot() {
  loadTheme();
  const root = document.getElementById("app");
  if (root) root.replaceChildren();
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
  setInterval(stepCapacity, 1000);
  render();
}

bindRender(paint);
