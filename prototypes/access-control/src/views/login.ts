import { USERS } from "../data/users";
import { userAudit } from "../domain/audit";
import { clearDemo } from "../domain/demo";
import { applyRoute, hasRoute } from "../domain/route";
import { state } from "../state";
import { esc } from "../ui/format";
import { render } from "../ui/schedule";
import { themeButton, wordmark } from "../ui/shell";

export function signIn(id) {
  const user = USERS.find((u) => u.id === id);
  if (!user) return;
  state.user = user;
  state.labOpen = false;
  state.toast = "";
  if (hasRoute()) applyRoute(location.hash);
  else {
    state.view = "floor";
    state.floor.level = "site";
    state.floor.zoom = 0.72;
    state.floor.panX = 0;
    state.floor.panY = 0;
    state.floor.pitch = 56;
    state.floor.yaw = -40;
    state.floor.serverId = "";
    state.floor.rowId = "";
    state.floor.feedId = "";
    state.floor.partId = "";
    state.selected = state.selected || "tray-01";
  }
  userAudit("sign in", { detail: "DSVS identity", wo: "" });
  render();
}

export function signOut() {
  if (state.user) userAudit("sign out", { wo: "" });
  state.user = null;
  state.labOpen = false;
  state.toast = "";
  state.menuOpen = false;
  state.outletGate = null;
  clearDemo();
  state.fails = {};
  state.focusTerm = "";
  render();
}

export function login() {
  const choices = [
    { id: "dsvs.operator", title: "Operator", hint: "Open consoles and power outlets", start: true },
    { id: "dsvs.admin", title: "Administrator", hint: "Also edit the asset tag and virtual media", start: false },
    { id: "colo.readonly", title: "Read only", hint: "Look around. Power stays locked.", start: false },
  ];
  const roles = choices.map((choice) => '<button type="button" class="role' + (choice.start ? " primary" : "") +
    '" data-act="login" data-user="' + esc(choice.id) + '"><span class="role-copy">' +
    (choice.start ? '<span class="role-kicker">Start here</span>' : "") +
    '<span class="role-title">' + esc(choice.title) + '</span><span class="role-hint">' +
    esc(choice.hint) + '</span></span><span class="role-go">Sign in</span></button>').join("");
  return '<a class="skip" href="#content">Skip to content</a><div class="login-wrap" id="content" data-screen="login" tabindex="-1"><div class="login-card"><div class="login-head">' + wordmark() +
    '<div class="product-name">Access</div><p class="rack-id">Rack A14</p></div>' +
    '<div class="login-body"><h1>Sign in</h1><p class="sub">No password on this demo. Choose a role.</p>' +
    themeButton() +
    '<div class="role-list">' + roles + "</div></div></div></div>";
}
