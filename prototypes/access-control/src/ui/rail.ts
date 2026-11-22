import { briefingButton } from "../domain/briefing";
import { state } from "../state";
import { esc } from "./format";
import { themeButton, wordmark } from "./shell";

export const OPERATE_VIEWS = ["rack", "map", "control", "sessions", "oneline", "fleet"];
export const PLAN_VIEWS = ["plan", "halls", "models", "dcim"];

const OPERATE_TABS = [
  ["rack", "Rack"],
  ["map", "Port map"],
  ["control", "Control"],
  ["sessions", "Sessions"],
  ["oneline", "One-line"],
  ["fleet", "Fleet"],
];

const PLAN_TABS = [
  ["plan", "Campus"],
  ["halls", "Halls"],
  ["models", "Models"],
  ["dcim", "DCIM"],
];

export const FLOOR_VIEWS = ["floor", "manage"];

const TAB_VIEWS = [
  ["floor", "Floor"],
  ["rack", "Operate"],
  ["plan", "Plan"],
  ["audit", "Audit"],
];

const VIEW_TITLE = {
  floor: "Floor",
  manage: "Manage",
  audit: "Audit",
  simulate: "Simulate",
};

function tabLabel(tabs, view) {
  const pair = tabs.find(([id]) => id === view);
  return pair ? pair[1] : "";
}

function groupHeading(group, tabs) {
  const label = tabLabel(tabs, state.view);
  return label ? group + " · " + label : group;
}

function topbarTitle() {
  if (OPERATE_VIEWS.indexOf(state.view) >= 0) return groupHeading("Operate", OPERATE_TABS);
  if (PLAN_VIEWS.indexOf(state.view) >= 0) return groupHeading("Plan", PLAN_TABS);
  return VIEW_TITLE[state.view] || "Access";
}

function groupCurrent(views) {
  return views.indexOf(state.view) >= 0 ? ' aria-current="page"' : "";
}

export function navButton(id, label, views) {
  const group = views && views.length ? views : [id];
  return '<button type="button" data-act="nav" data-view="' + id + '"' + groupCurrent(group) + ">" +
    esc(label) + "</button>";
}

function viewTabs(tabs, group) {
  const navLabel = group + " views";
  return '<div class="view-tabs" role="navigation" aria-label="' + esc(navLabel) + '">' + tabs.map((pair) => {
    const current = state.view === pair[0] ? ' aria-current="page"' : "";
    const count = pair[0] === "sessions" && state.sessions.length ? " · " + state.sessions.length : "";
    return '<button type="button" data-act="nav" data-view="' + pair[0] + '"' + current + ">" +
      esc(pair[1]) + count + "</button>";
  }).join("") + "</div>";
}

export function operateHead() {
  const heading = esc(groupHeading("Operate", OPERATE_TABS));
  return '<div class="page-head"><div class="top"><div><h1>' + heading + "</h1>" + viewTabs(OPERATE_TABS, "Operate") +
    "</div>" + themeButton() + "</div></div>";
}

export function planHead() {
  const heading = esc(groupHeading("Plan", PLAN_TABS));
  return '<div class="page-head"><div class="top"><div><h1>' + heading + "</h1>" + viewTabs(PLAN_TABS, "Plan") +
    "</div>" + themeButton() + "</div></div>";
}

export function topbar() {
  const title = topbarTitle();
  const open = state.menuOpen ? "true" : "false";
  return '<div class="topbar">' + briefingButton() + '<button type="button" class="menu-btn" data-act="menu" aria-expanded="' + open +
    '" aria-label="Menu"><span class="menu-glyph" aria-hidden="true"></span></button><strong>Access</strong><span class="topbar-view">' +
    esc(title) + "</span>" + themeButton() + "</div>" +
    '<button type="button" class="menu-back" data-act="menu-close" aria-label="Close menu"></button>';
}

export function tabbar() {
  const tabs = TAB_VIEWS.map((pair) => {
    const views = pair[0] === "rack" ? OPERATE_VIEWS : (pair[0] === "plan" ? PLAN_VIEWS : (pair[0] === "floor" ? FLOOR_VIEWS : [pair[0]]));
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
    navButton("floor", "Floor", FLOOR_VIEWS) +
    navButton("rack", "Operate", OPERATE_VIEWS) +
    navButton("plan", "Plan", PLAN_VIEWS) +
    navButton("audit", "Audit") +
    "</nav>" +
    '<div class="rail-foot">' + leak +
    themeButton() +
    '<button type="button" class="lab-open" data-act="simulate"' + (state.view === "simulate" ? ' aria-current="page"' : "") + ">Simulate</button>" +
    '<div class="who"><strong>' + esc(state.user.id) + "</strong><span>" + esc(state.user.role) +
    "</span>" + (state.user.expiresAt ? '<small>until ' + esc(String(state.user.expiresAt).slice(11, 16)) + " UTC</small>" : "") +
    '<button type="button" class="act" data-act="signout">Sign out</button></div></div></header>';
}
