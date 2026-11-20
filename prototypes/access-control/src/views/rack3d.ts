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

export type Rack3dUnit = { id: string; label: string; u: number; units: number; klass: string; on?: boolean; dark?: boolean; led?: string; act: string; rear?: string; aria?: string };
export type Rack3dSocket = { n: number; state: string; title: string; mine?: boolean; act?: string };
export type Rack3dPdu = { id: string; label: string; side: string; sockets: Rack3dSocket[] };

function unitBox(unit: Rack3dUnit) {
  const h = unit.units * U_PX - 1;
  const top = (RACK_U - (unit.u + unit.units - 1)) * U_PX;
  const front = '<button type="button" class="r3-bezel" ' + unit.act + (unit.on ? ' aria-pressed="true"' : "") +
    ' aria-label="' + esc(unit.aria || unit.label + ", U" + unit.u) + '"><span>' + esc(unit.label) + "</span><i style=\"background:" +
    (unit.dark ? "#3a3632" : (unit.led || "#c8c4bc")) + '"></i></button>';
  const rear = '<span class="r3-rear-label">' + esc(unit.rear || unit.label) + "</span>";
  const klass = "r3-dev " + unit.klass + (unit.on ? " on" : "") + (unit.dark ? " dark" : "");
  return place(20, top, 0, box(DEV_W, h, DEV_D, klass, { front, rear }, ' data-dev="' + esc(unit.id) + '"'));
}

function pduBox(pdu: Rack3dPdu) {
  const dense = pdu.sockets.length > 14 ? " dense" : "";
  const sockets = pdu.sockets.map((socket) => '<button type="button" class="r3-socket ' + socket.state + (socket.mine ? " mine" : "") + '" ' +
    (socket.act || "disabled") + ' data-outlet="' + socket.n + '" title="' + esc(socket.title) + '" aria-label="' + esc(socket.title) +
    '"><b>' + socket.n + "</b><i></i></button>").join("");
  const face = '<div class="r3-pdu-face' + dense + '"><span class="r3-pdu-name">' + esc(pdu.label) + "</span>" + sockets + '<span class="r3-pdu-cord"></span></div>';
  const h = RACK_U * U_PX - 20;
  /* Vertical, on a rear rail, outlets facing the rear door. */
  const x = pdu.side === "left" ? 2 : CAB_W - 18;
  return place(x, 10, -CAB_D / 2 + 20, box(16, h, 16, "r3-pdu", { rear: face, side: "" }, ' data-pdu="' + esc(pdu.id) + '"'));
}

function deviceUnit(d): Rack3dUnit {
  const outlet = outlets.find((o) => o.n === d.outlet);
  return {
    id: d.id,
    label: d.short || d.name,
    u: d.u,
    units: unitsOf(d),
    klass: d.kind === "Switch" ? "net" : (d.kind === "Power shelf" ? "shelf" : "gpu"),
    on: state.selected === d.id,
    dark: !!(outlet && outletState(outlet) === "off"),
    led: conditionTone(d).color,
    act: 'data-act="select" data-device="' + esc(d.id) + '"',
    rear: (d.short || d.name) + " · O" + d.outlet,
    aria: d.name + ", U" + d.u + ", outlet " + d.outlet,
  };
}

/* The live outlets of rack PDU A14, as sockets. */
export function a14Sockets(selectedOutlet = 0): Rack3dSocket[] {
  return outlets.map((o) => {
    const s = outletState(o);
    const mapped = o.deviceId ? deviceById(o.deviceId) : null;
    const who = mapped ? mapped.name : "Unbound";
    return {
      n: o.n,
      state: s,
      title: "Outlet " + o.n + " · " + who + " · " + STATE_WORD[s],
      mine: selectedOutlet === o.n,
      act: 'data-act="pdu-outlet"',
    };
  });
}

function cabinet(name) {
  const h = RACK_U * U_PX;
  return place(0, 0, 0, box(CAB_W, h, CAB_D, "r3-cab", {
    top: '<span class="r3-cab-name">' + esc(name) + "</span>",
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

export const R3_LEGEND = '<div class="r3-legend"><span><span class="r3-dot on"></span>On</span><span><span class="r3-dot off"></span>Off</span>' +
  '<span><span class="r3-dot cycling"></span>Cycling</span><span><span class="r3-dot locked"></span>Locked</span>' +
  '<span><span class="r3-dot idle"></span>No live reading</span></div>';

/* Any rack in 3D: the view buttons and the stage. */
export function rackSceneHtml(name: string, units: Rack3dUnit[], pdus: Rack3dPdu[]) {
  const view = viewAngles();
  const views = RACK_VIEWS.map((row) => '<button type="button" class="act" data-act="rack-view" data-rack-view="' + row[0] + '"' +
    (row[0] === view.id ? ' aria-pressed="true"' : "") + ">" + row[1] + "</button>").join("");
  return '<div class="r3-tools" role="group" aria-label="Rack view">' + views + "</div>" +
    '<div class="r3-stage"><div class="r3-world" data-view="' + view.id + '" style="transform:rotateX(' + view.pitch + "deg) rotateY(" + view.yaw + 'deg)">' +
    cabinet(name) + uScale() + units.map(unitBox).join("") + pdus.map(pduBox).join("") + "</div></div>";
}

export function rack3dHtml() {
  const selected = deviceById(state.selected);
  const units = devices.filter((d) => d.u).map(deviceUnit);
  const pdu = { id: "pdu-a14", label: "PDU A14", side: "right", sockets: a14Sockets(selected ? selected.outlet : 0) };
  return '<div class="rack3d">' + rackSceneHtml("Rack A14", units, [pdu]) + R3_LEGEND + pduTable() + "</div>";
}
