import { outlets } from "../data/outlets";
import { PLANT, PODS } from "../data/pods";
import { runtime, state } from "../state";
import { activeAlarms } from "./alarms";
import { esc } from "./format";

/* Experimental: the views that are not drawings (Control, Sessions, Fleet, Ports, Audit,
   Manage, Models, DCIM, Simulate) read as a dashboard. A row of live tiles sits under the
   heading, and the view's panels become cards in a grid. Styling is in styles.css under
   .shell[data-experimental="on"]. */

export const DASHBOARD_VIEWS = ["control", "sessions", "fleet", "map", "portmap", "audit", "manage", "models", "dcim", "simulate"];

export function dashboardOn() {
  return !!runtime.gl && DASHBOARD_VIEWS.indexOf(state.view) >= 0;
}

function tile(label: string, value: string, sub: string, tone: string, view: string) {
  return '<button type="button" class="dash-tile ' + tone + '" data-act="nav" data-view="' + view + '"><span class="dash-label">' + esc(label) +
    '</span><b class="dash-value">' + esc(value) + '</b><span class="dash-sub">' + esc(sub) + "</span></button>";
}

export function dashStripHtml() {
  if (!dashboardOn()) return "";
  const alarms = activeAlarms();
  const p1 = alarms.filter((a) => a.pri === 1).length;
  const on = outlets.filter((o) => o.power !== "off").length;
  const sessions = (state.sessions || []).length;
  const tiles = [
    tile("Open alarms", String(alarms.length), p1 ? p1 + " at P1" : "None at P1", p1 ? "bad" : (alarms.length ? "warn" : "ok"), "fleet"),
    tile("IT load", PLANT.itMw + " MW", PODS.length + " halls", "ok", "fleet"),
    tile("Outlets on", on + " / " + outlets.length, "Rack PDU A14", on < outlets.length ? "warn" : "ok", "control"),
    tile("Live sessions", String(sessions), sessions ? "Console and KVM" : "None open", "ok", "sessions"),
    tile("DI-1 leak", state.leak ? "Alarm" : "Quiet", state.leak ? "Outlets 1 and 2 locked" : "Rack A14 rope", state.leak ? "bad" : "ok", "control"),
  ].join("");
  return '<section class="dash-strip" aria-label="Dashboard">' + tiles + "</section>";
}

const CARD = ".panel, .policy, section.alarm, .fleet-tile, .future-card, .thermal-card, .demo, .power-path, .device-view, .cal-month, .dash-tile";
let tilted: HTMLElement | null = null;

function untilt() {
  if (!tilted) return;
  tilted.style.removeProperty("--rx");
  tilted.style.removeProperty("--ry");
  tilted = null;
}

/* Cards lean a few degrees toward the pointer, so they read as objects you can pick up. */
export function tiltCard(event: PointerEvent) {
  if (!runtime.gl || event.pointerType === "touch") return untilt();
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return untilt();
  const target = event.target as Element | null;
  const card = target && target.closest ? (target.closest(CARD) as HTMLElement | null) : null;
  if (!card || !card.closest(".view") || card.querySelector("canvas, .r3-stage, .floor3d-host")) return untilt();
  if (card !== tilted) untilt();
  const r = card.getBoundingClientRect();
  // Only cards you could hold in a hand tilt; big tables and grids just lift.
  if (Math.max(r.width, r.height) > 560) return untilt();
  const x = (event.clientX - r.left) / Math.max(1, r.width) - 0.5;
  const y = (event.clientY - r.top) / Math.max(1, r.height) - 0.5;
  const reach = 4;
  card.style.setProperty("--rx", (-y * reach).toFixed(2) + "deg");
  card.style.setProperty("--ry", (x * reach).toFixed(2) + "deg");
  tilted = card;
}
