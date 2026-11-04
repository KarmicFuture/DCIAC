import { ACS_PORTS, devices } from "../data/devices";
import { maintenanceOpen } from "../domain/audit";
import { state } from "../state";
import { esc } from "./format";
import { render } from "./schedule";
import { renderAudit } from "../views/audit";
import { renderControl } from "../views/control";
import { renderFloor } from "../views/floor";
import { renderManage } from "../views/manage";
import { renderMap } from "../views/portmap";
import { renderRack } from "../views/rack";
import { renderSessions } from "../views/sessions";

export function go(view) {
  state.view = view;
  state.toast = "";
  state.menuOpen = false;
  render();
}

export function themeButton() {
  const on = state.theme === "noc";
  return '<button type="button" class="act theme-toggle" data-act="theme" aria-pressed="' + (on ? "true" : "false") +
    '">NOC theme</button>';
}

export function wordmark() {
  return '<div class="wordmark"><div class="v-name">VERTIV</div><div class="v-rule"></div><div class="v-sub">Avocent</div></div>';
}

export function pills() {
  const rmClass = state.rm1048 === "healthy" ? "ok" : "warn";
  const rmLabel = state.rm1048 === "healthy" ? "healthy" : "dark";
  const oob = devices.some((d) => d.bmc === "down")
    ? '<span class="pill warn">Failover <b>ACS</b></span>'
    : "";
  const rdpLost = devices.some((d) => d.rdp === "down")
    ? '<span class="pill warn">RDP <b>KVM</b></span>'
    : "";
  const leakClass = state.leak ? "bad" : "ok";
  const leakLabel = state.leak ? "alarm" : "quiet";
  const maintClass = maintenanceOpen() ? "warn" : "";
  const maintLabel = maintenanceOpen() ? "open" : "closed";
  return '<div class="pills">' +
    '<span class="pill ' + rmClass + '">RM1048 <b>' + rmLabel + "</b></span>" +
    '<span class="pill ' + leakClass + '">DI-1 <b>' + leakLabel + "</b></span>" +
    '<span class="pill ' + maintClass + '">Maintenance <b>' + maintLabel + "</b></span>" +
    '<span class="pill">Domain <b>rack A14</b></span>' + oob + rdpLost + "</div>";
}

export function fruSummary(editable) {
  const tag = editable && state.user.role === "Administrator"
    ? '<dd class="tag"><input id="asset-tag" data-focus-key="asset-tag" maxlength="32"><button type="button" class="act" data-act="asset">Save</button></dd>'
    : "<dd>" + esc(state.assetTag) + "</dd>";
  return '<dl class="fru"><dt>Manufacturer</dt><dd>Vertiv</dd><dt>Model</dt><dd>Avocent ACS 8000</dd>' +
    '<dt>Serial</dt><dd class="mono">ACS8K-A14-00481</dd><dt>Asset tag</dt>' + tag +
    "<dt>Domain</dt><dd>Rack A14 · one ACS</dd>" +
    "<dt>Serial ports</dt><dd>" + ACS_PORTS + " · each opens a logged-in server console</dd></dl>";
}

export function viewHtml() {
  if (state.view === "manage") return renderManage();
  if (state.view === "floor") return renderFloor();
  if (state.view === "map") return renderMap();
  if (state.view === "control") return renderControl();
  if (state.view === "sessions") return renderSessions();
  if (state.view === "audit") return renderAudit();
  return renderRack();
}
