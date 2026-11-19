import { deviceById, devices } from "../data/devices";
import { LEAK, outlets } from "../data/outlets";
import { state } from "../state";
import { esc } from "../ui/format";
import { conditionTone } from "./floor";

/* Rack A14 in 3D: the cabinet, each device at its U, and the vertical rack PDU on
   the rear rail. The PDU here only shows state. Switching an outlet still happens on
   Control, with its role, interlock, and confirmation checks. */

const U_PX = 11;
const RACK_U = 42;
const CAB_W = 200;
const CAB_D = 280;
const DEV_W = 160;
const DEV_D = 236;

export const RACK_VIEWS = [
  ["front", "Front", -24, -8],
  ["angle", "Angle", -42, -14],
  ["side", "Side", -90, -6],
  ["rear", "Rear", -200, -8],
];

function viewAngles() {
  const view = RACK_VIEWS.find((row) => row[0] === state.rackView) || RACK_VIEWS[1];
  return { id: view[0] as string, yaw: view[2] as number, pitch: view[3] as number };
}

function unitsOf(d) {
  if (d.kind === "Switch") return 1;
  return 2;
}

/* A box from six faces. The box sits on its own origin: x right, y down, z toward
   the viewer. */
function box(w, h, d, klass, faces: { front?: string; rear?: string; side?: string; top?: string } = {}, attrs = "") {
  const face = (name, fw, fh, transform, inner = "") =>
    '<div class="r3-face r3-' + name + '" style="width:' + fw + "px;height:" + fh + "px;transform:" + transform + '">' + inner + "</div>";
  return '<div class="r3-box ' + klass + '" style="width:' + w + "px;height:" + h + 'px"' + attrs + ">" +
    face("front", w, h, "translateZ(" + d / 2 + "px)", faces.front) +
    face("rear", w, h, "rotateY(180deg) translateZ(" + d / 2 + "px)", faces.rear) +
    face("left", d, h, "translateX(" + (w - d) / 2 + "px) rotateY(-90deg) translateZ(" + w / 2 + "px)", faces.side) +
    face("right", d, h, "translateX(" + (w - d) / 2 + "px) rotateY(90deg) translateZ(" + w / 2 + "px)", faces.side) +
    face("top", w, d, "translateY(" + (h - d) / 2 + "px) rotateX(90deg) translateZ(" + h / 2 + "px)", faces.top) +
    face("bottom", w, d, "translateY(" + (h - d) / 2 + "px) rotateX(-90deg) translateZ(" + h / 2 + "px)") +
    "</div>";
}

function place(x, y, z, html) {
  return '<div class="r3-place" style="transform:translate3d(' + x + "px," + y + "px," + z + 'px)">' + html + "</div>";
}

export function outletState(o) {
  if (state.leak && LEAK.outlets.indexOf(o.n) >= 0) return "locked";
  return o.power === "off" ? "off" : (o.power === "cycling" ? "cycling" : "on");
}

const STATE_WORD = { on: "On", off: "Off", cycling: "Cycling", locked: "Locked by DI-1 leak" };

function deviceBox(d) {
  const units = unitsOf(d);
  const h = units * U_PX - 1;
  const top = (RACK_U - (d.u + units - 1)) * U_PX;
  const tone = conditionTone(d);
  const on = state.selected === d.id;
  const outlet = outlets.find((o) => o.n === d.outlet);
  const dark = outlet && outletState(outlet) === "off";
  const front = '<button type="button" class="r3-bezel" data-act="select" data-device="' + esc(d.id) + '"' + (on ? ' aria-pressed="true"' : "") +
    ' aria-label="' + esc(d.name + ", U" + d.u + ", outlet " + d.outlet) + '"><span>' + esc(d.short || d.name) + "</span><i style=\"background:" +
    (dark ? "#3a3632" : tone.color) + '"></i></button>';
  const rear = '<span class="r3-rear-label">' + esc(d.short || d.name) + " · O" + d.outlet + "</span>";
  const klass = "r3-dev " + (d.kind === "Switch" ? "net" : (d.kind === "Power shelf" ? "shelf" : "gpu")) + (on ? " on" : "") + (dark ? " dark" : "");
  return place(20, top, 0, box(DEV_W, h, DEV_D, klass, { front, rear }, ' data-dev="' + esc(d.id) + '"'));
}

function pduHtml() {
  const selected = deviceById(state.selected);
  const sockets = outlets.map((o) => {
    const s = outletState(o);
    const mapped = o.deviceId ? deviceById(o.deviceId) : null;
    const who = mapped ? mapped.name : "Unbound";
    const mine = selected && selected.outlet === o.n ? " mine" : "";
    return '<button type="button" class="r3-socket ' + s + mine + '" data-act="pdu-outlet" data-outlet="' + o.n + '" title="' +
      esc("Outlet " + o.n + " · " + who + " · " + STATE_WORD[s]) + '" aria-label="' + esc("Outlet " + o.n + ", " + who + ", " + STATE_WORD[s]) +
      '"><b>' + o.n + "</b><i></i></button>";
  }).join("");
  const face = '<div class="r3-pdu-face"><span class="r3-pdu-name">PDU A14</span>' + sockets + '<span class="r3-pdu-cord"></span></div>';
  const h = RACK_U * U_PX - 20;
  /* Mounted vertically on the rear-right rail, outlets facing the rear door. */
  return place(CAB_W - 18, 10, -CAB_D / 2 + 20, box(16, h, 16, "r3-pdu", { rear: face, side: "" }));
}

function cabinet() {
  const h = RACK_U * U_PX;
  return place(0, 0, 0, box(CAB_W, h, CAB_D, "r3-cab", {
    top: '<span class="r3-cab-name">Rack A14</span>',
  }));
}

function uScale() {
  const marks = [];
  for (let u = RACK_U; u >= 1; u -= 1) {
    if (u % 2 === 0) marks.push('<span style="top:' + (RACK_U - u) * U_PX + 'px">' + u + "</span>");
  }
  return place(-30, 0, CAB_D / 2, '<div class="r3-uscale">' + marks.join("") + "</div>");
}

function pduTable() {
  const rows = outlets.map((o) => {
    const s = outletState(o);
    const mapped = o.deviceId ? deviceById(o.deviceId) : null;
    const mine = state.selected && mapped && mapped.id === state.selected;
    return '<tr data-outlet="' + o.n + '"' + (mine ? ' class="mine"' : "") + '><td><button type="button" class="linkish" data-act="pdu-outlet" data-outlet="' + o.n + '">Outlet ' + o.n + "</button></td><td>" +
      (mapped ? '<button type="button" class="linkish" data-act="select" data-device="' + esc(mapped.id) + '">' + esc(mapped.name) + "</button>" : '<span class="fine">Unbound</span>') +
      '</td><td><span class="r3-dot ' + s + '"></span>' + esc(STATE_WORD[s]) + "</td></tr>";
  }).join("");
  return '<div class="r3-pdu-table"><h3>Rack PDU A14</h3><p class="fine">Read only here. Switch outlets on Control, where role, leak interlock, and confirmation checks apply.</p>' +
    '<div class="table-wrap"><table><thead><tr><th>Outlet</th><th>Device</th><th>State</th></tr></thead><tbody>' + rows +
    '</tbody></table></div><button type="button" class="act" data-act="nav" data-view="control">Open Control</button></div>';
}

export function rack3dHtml() {
  const view = viewAngles();
  const views = RACK_VIEWS.map((row) => '<button type="button" class="act" data-act="rack-view" data-rack-view="' + row[0] + '"' +
    (row[0] === view.id ? ' aria-pressed="true"' : "") + ">" + row[1] + "</button>").join("");
  const list = devices.filter((d) => d.u);
  const scene = '<div class="r3-stage"><div class="r3-world" data-view="' + view.id + '" style="transform:rotateX(' + view.pitch + "deg) rotateY(" + view.yaw + 'deg)">' +
    cabinet() + uScale() + list.map(deviceBox).join("") + pduHtml() + "</div></div>";
  return '<div class="rack3d"><div class="r3-tools" role="group" aria-label="Rack view">' + views + "</div>" + scene +
    '<div class="r3-legend"><span><span class="r3-dot on"></span>On</span><span><span class="r3-dot off"></span>Off</span>' +
    '<span><span class="r3-dot cycling"></span>Cycling</span><span><span class="r3-dot locked"></span>Locked</span></div>' +
    pduTable() + "</div>";
}
