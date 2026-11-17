import { briefingButton } from "../domain/briefing";
import { state } from "../state";
import { esc } from "./format";
import { themeButton, wordmark } from "./shell";

export const OPERATE_VIEWS = ["rack", "map", "control", "sessions", "oneline"];
export const PLAN_VIEWS = ["plan", "models", "dcim"];

const OPERATE_TABS = [
  ["rack", "Rack"],
  ["map", "Port map"],
  ["control", "Control"],
  ["sessions", "Sessions"],
  ["oneline", "One-line"],
];

const PLAN_TABS = [
  ["plan", "Campus"],
  ["models", "Models"],
  ["dcim", "DCIM"],
];

const TAB_VIEWS = [
  ["floor", "Floor"],
  ["rack", "Operate"],
  ["plan", "Plan"],
  ["audit", "Audit"],
];

const VIEW_TITLE = {
  floor: "Floor",
  plan: "Plan",
  manage: "Manage",
  rack: "Operate",
  map: "Operate",
  control: "Operate",
  sessions: "Operate",
  oneline: "Operate",
  audit: "Audit",
  models: "Plan",
  dcim: "Plan",
  simulate: "Simulate",
};

function groupCurrent(views) {
  return views.indexOf(state.view) >= 0 ? ' aria-current="page"' : "";
}

export function navButton(id, label, views) {
  const group = views && views.length ? views : [id];
  return '<button type="button" data-act="nav" data-view="' + id + '"' + groupCurrent(group) + ">" +
    esc(label) + "</button>";
}

function viewTabs(tabs) {
  return '<div class="view-tabs" role="tablist">' + tabs.map((pair) => {
    const on = state.view === pair[0] ? ' aria-selected="true"' : ' aria-selected="false"';
    const count = pair[0] === "sessions" && state.sessions.length ? " · " + state.sessions.length : "";
    return '<button type="button" role="tab" data-act="nav" data-view="' + pair[0] + '"' + on + ">" +
      esc(pair[1]) + count + "</button>";
  }).join("") + "</div>";
}

export function operateHead() {
  return '<div class="page-head"><div class="top"><div><h1>Operate</h1>' + viewTabs(OPERATE_TABS) +
    "</div>" + themeButton() + "</div></div>";
}

export function planHead() {
  return '<div class="page-head"><div class="top"><div><h1>Plan</h1>' + viewTabs(PLAN_TABS) +
    "</div>" + themeButton() + "</div></div>";
}

export function topbar() {
  const title = VIEW_TITLE[state.view] || "Access";
  const open = state.menuOpen ? "true" : "false";
  return '<div class="topbar">' + briefingButton() + '<button type="button" class="menu-btn" data-act="menu" aria-expanded="' + open +
    '" aria-label="Menu"><span class="menu-glyph" aria-hidden="true"></span></button><strong>Access</strong><span class="topbar-view">' +
    esc(title) + "</span>" + themeButton() + "</div>" +
    '<button type="button" class="menu-back" data-act="menu-close" aria-label="Close menu"></button>';
}

export function tabbar() {
  const tabs = TAB_VIEWS.map((pair) => {
    const views = pair[0] === "rack" ? OPERATE_VIEWS : (pair[0] === "plan" ? PLAN_VIEWS : [pair[0]]);
    const current = groupCurrent(views);
    return '<button type="button" data-act="nav" data-view="' + pair[0] + '"' + current + ">" +
      esc(pair[1]) + "</button>";
  }).join("");
  return '<div class="tabbar" role="navigation" aria-label="Primary">' + tabs + "</div>";
}

export function rail() {
  const leak = state.leak ? '<p class="alarm-note">DI-1 leak alarm</p>' : "";
  return '<header class="rail" tabindex="0">' +
    briefingButton() +
    wordmark() +
    '<div class="product-name">Access</div>' +
    "<nav>" +
    navButton("floor", "Floor") +
    navButton("rack", "Operate", OPERATE_VIEWS) +
    navButton("plan", "Plan", PLAN_VIEWS) +
    navButton("audit", "Audit") +
    "</nav>" +
    '<div class="rail-foot">' + leak +
    themeButton() +
    '<button type="button" class="lab-open" data-act="simulate">Simulate</button>' +
    '<div class="who"><strong>' + esc(state.user.id) + "</strong><span>" + esc(state.user.role) +
    "</span>" + (state.user.expiresAt ? '<small>until ' + esc(String(state.user.expiresAt).slice(11, 16)) + " UTC</small>" : "") +
    '<button type="button" class="act" data-act="signout">Sign out</button></div></div></header>';
}
