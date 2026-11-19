import { ACS_PORTS, devices } from "../data/devices";
import { maintenanceOpen } from "../domain/audit";
import { state } from "../state";
import { esc } from "./format";
import { render } from "./schedule";
import { renderAudit } from "../views/audit";
import { renderDcim } from "../views/dcim";
import { renderModels } from "../views/models";
import { renderControl } from "../views/control";
import { renderFloor } from "../views/floor";
import { renderPlan } from "../views/plan";
import { renderManage } from "../views/manage";
import { renderMap } from "../views/portmap";
import { renderRack } from "../views/rack";
import { renderSessions } from "../views/sessions";
import { renderOneline } from "../views/oneline";
import { renderFleet } from "../views/fleet";
import { renderSimulate } from "../views/lab";
import { OPERATE_VIEWS, PLAN_VIEWS, operateHead, planHead } from "./rail";

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
  return '<div class="wordmark"><div class="v-name">Unubtanium 2.0</div><div class="v-rule"></div></div>';
}

export function pills() {
  const bits = [];
  if (state.rm1048 !== "healthy") bits.push('<span class="pill warn">RM1048 <b>dark</b></span>');
  if (state.leak) bits.push('<span class="pill bad">DI-1 <b>alarm</b></span>');
  if (maintenanceOpen()) bits.push('<span class="pill warn">Maintenance <b>open</b></span>');
  if (devices.some((d) => d.bmc === "down")) bits.push('<span class="pill warn">Failover <b>ACS</b></span>');
  if (devices.some((d) => d.rdp === "down")) bits.push('<span class="pill warn">RDP <b>KVM</b></span>');
  if (!bits.length) return "";
  return '<div class="pills">' + bits.join("") + "</div>";
}

export function fruSummary(editable) {
  const tag = editable && state.user.role === "Administrator"
    ? '<dd class="tag"><input id="asset-tag" data-focus-key="asset-tag" maxlength="32"><button type="button" class="act" data-act="asset">Save</button></dd>'
    : "<dd>" + esc(state.assetTag) + "</dd>";
  return '<dl class="fru"><dt>Manufacturer</dt><dd>Unubtanium</dd><dt>Model</dt><dd>Unubtanium 2.0</dd>' +
    '<dt>Serial</dt><dd class="mono">ACS8K-A14-00481</dd><dt>Asset tag</dt>' + tag +
    "<dt>Domain</dt><dd>Rack A14 · Unubtanium 2.0</dd>" +
    "<dt>Serial ports</dt><dd>" + ACS_PORTS + " · each opens a logged-in server console</dd></dl>";
}

export function viewHtml() {
  if (state.view === "manage") return renderManage();
  if (state.view === "floor") return renderFloor();
  if (state.view === "simulate") return renderSimulate();
  if (state.view === "audit") return renderAudit();
  if (OPERATE_VIEWS.indexOf(state.view) >= 0) {
    const body = state.view === "map" ? renderMap()
      : state.view === "control" ? renderControl()
        : state.view === "sessions" ? renderSessions()
          : state.view === "oneline" ? renderOneline()
            : state.view === "fleet" ? renderFleet()
            : renderRack();
    return operateHead() + body;
  }
  if (PLAN_VIEWS.indexOf(state.view) >= 0) {
    const body = state.view === "models" ? renderModels()
      : state.view === "dcim" ? renderDcim()
        : renderPlan();
    return planHead() + body;
  }
  return renderRack();
}
