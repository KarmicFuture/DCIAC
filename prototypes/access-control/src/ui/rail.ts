import { state } from "../state";
import { esc } from "./format";
import { themeButton, wordmark } from "./shell";

export function navButton(id, label, sub) {
  const current = state.view === id ? ' aria-current="page"' : "";
  return '<button type="button" data-act="nav" data-view="' + id + '"' + current + ">" +
    esc(label) + "<small>" + esc(sub) + "</small></button>";
}

const TAB_VIEWS = [
  ["rack", "Rack"],
  ["map", "Port map"],
  ["sessions", "Sessions"],
  ["audit", "Audit"],
];

const VIEW_TITLE = {
  floor: "Overview",
  manage: "Manage",
  rack: "Rack",
  map: "Port map",
  control: "Control",
  sessions: "Sessions",
  audit: "Audit",
};

export function topbar() {
  const title = VIEW_TITLE[state.view] || "Access";
  const open = state.menuOpen ? "true" : "false";
  return '<div class="topbar"><button type="button" class="menu-btn" data-act="menu" aria-expanded="' + open +
    '" aria-label="Menu"><span class="menu-glyph" aria-hidden="true"></span></button><strong>Access</strong><span class="topbar-view">' +
    esc(title) + "</span>" + themeButton() + "</div>" +
    '<button type="button" class="menu-back" data-act="menu-close" aria-label="Close menu"></button>';
}

export function tabbar() {
  const tabs = TAB_VIEWS.map((pair) => {
    const current = state.view === pair[0] ? ' aria-current="page"' : "";
    const count = pair[0] === "sessions" && state.sessions.length ? '<b>' + state.sessions.length + "</b>" : "";
    return '<button type="button" data-act="nav" data-view="' + pair[0] + '"' + current + ">" +
      esc(pair[1]) + count + "</button>";
  }).join("");
  return '<div class="tabbar" role="navigation" aria-label="Primary">' + tabs + "</div>";
}

export function rail() {
  const sessionSub = state.sessions.length ? state.sessions.length + " open" : "Open consoles";
  const leak = state.leak ? '<p class="alarm-note">DI-1 leak alarm</p>' : "";
  return '<header class="rail" tabindex="0">' +
    wordmark() +
    '<div class="product-name">Access</div>' +
    '<p class="rack-id">DSVS · ACS 8000 · MPU<br>Rack A14 only</p>' +
    "<nav>" +
    navButton("floor", "Overview", "Outside and hall") +
    navButton("manage", "Manage", "Grid to chip") +
    navButton("rack", "Rack", "Level 2 · devices") +
    navButton("map", "Port map", "48 serial ports") +
    navButton("control", "Control", "Level 3 · outlets") +
    navButton("sessions", "Sessions", "Level 3 · " + sessionSub) +
    navButton("audit", "Audit", "Level 4 · log") +
    "</nav>" +
    '<div class="rail-foot">' + leak +
    themeButton() +
    '<button type="button" class="lab-open" data-act="lab-open">Lab<small>Simulated world</small></button>' +
    '<div class="who"><strong>' + esc(state.user.id) + "</strong><span>" + esc(state.user.role) +
    '</span><button type="button" class="act" data-act="signout">Sign out</button></div></div></header>';
}
