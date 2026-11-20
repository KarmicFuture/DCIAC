import { deviceById, devices } from "../data/devices";
import { LEAK, outlets } from "../data/outlets";
import { runtime, state } from "../state";
import { esc } from "../ui/format";
import { PODS, entityById, rackById, rackEntities } from "../data/pods";
import { render } from "../ui/schedule";
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

function pduTable(ctx = "operate") {
  const rows = outlets.map((o) => {
    const s = outletState(o);
    const mapped = o.deviceId ? deviceById(o.deviceId) : null;
    const picked = ctx === "operate" ? state.selected : state.floor.serverId;
    const mine = picked && mapped && mapped.id === picked;
    return '<tr data-outlet="' + o.n + '"' + (mine ? ' class="mine"' : "") + '><td><button type="button" class="linkish" data-act="pdu-outlet" data-outlet="' + o.n + '">Outlet ' + o.n + "</button></td><td>" +
      (mapped ? '<button type="button" class="linkish" ' + (ctx === "operate" ? 'data-act="select" data-device="' : 'data-act="floor-server" data-server="') + esc(mapped.id) + '">' + esc(mapped.name) + "</button>" : '<span class="fine">Unbound</span>') +
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

/* One rack view everywhere: Operate › Rack and the floor drill-down both build the
   rack from the same model and draw it with the same scene. Only what a click does
   differs: Operate selects the device, the floor opens it on the floor. */

const mountCache: Record<string, any[]> = {};
const loading: Record<string, boolean> = {};

function fetchMounts(rackId) {
  if (loading[rackId] || mountCache[rackId]) return;
  loading[rackId] = true;
  fetch("/api/v1/racks/" + encodeURIComponent(rackId) + "/elevation", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((body) => {
      mountCache[rackId] = body && Array.isArray(body.mounts) ? body.mounts : [];
      render();
    })
    .catch(() => { mountCache[rackId] = []; })
    .finally(() => { loading[rackId] = false; });
}

function mountsFor(rackId) {
  const live = runtime.elevation;
  if (live && live.rackId === rackId && Array.isArray(live.mounts)) return live.mounts;
  if (!mountCache[rackId]) fetchMounts(rackId);
  return mountCache[rackId] || null;
}

/* Model names from the repository can carry vendor branding. The rack shows the
   product line only. */
export function unbranded(text) {
  return String(text || "").replace(/\b(vertiv|avocent|geist|liebert)\b/gi, "").replace(/\s+/g, " ").trim();
}

function unitKlass(category) {
  const c = String(category || "").toLowerCase();
  if (c.indexOf("switch") >= 0) return "net";
  if (c.indexOf("shelf") >= 0 || c.indexOf("power") >= 0) return "shelf";
  if (c.indexOf("gpu") >= 0) return "gpu";
  return "srv";
}

function unitAct(id, ctx) {
  if (ctx === "operate") return deviceById(id) ? 'data-act="select" data-device="' + esc(id) + '"' : "disabled";
  return entityById(id) ? 'data-act="floor-server" data-server="' + esc(id) + '"' : "disabled";
}

function isOn(id, ctx) {
  return ctx === "operate" ? state.selected === id : state.floor.serverId === id;
}

function darkFor(id) {
  const d = deviceById(id);
  const o = d ? outlets.find((item) => item.n === d.outlet) : null;
  return !!(o && outletState(o) === "off");
}

function selectedOutlet(ctx) {
  const d = deviceById(ctx === "operate" ? state.selected : state.floor.serverId);
  return d && d.rack === "A14" ? d.outlet : 0;
}

function fromMounts(rackId, mounts, ctx) {
  const units: Rack3dUnit[] = mounts.filter((item) => item.uHeight && item.uPosition).map((item) => {
    const d = deviceById(item.assetTag);
    const id = d ? d.id : item.assetTag;
    const entity = entityById(id);
    const model = unbranded(item.model);
    return {
      id,
      label: item.assetTag,
      u: Number(item.uPosition),
      units: Math.max(1, Number(item.uHeight) || 1),
      klass: unitKlass(item.category),
      on: isOn(id, ctx),
      dark: darkFor(id),
      led: entity ? conditionTone(entity).color : undefined,
      act: unitAct(id, ctx),
      rear: item.assetTag + (model ? " · " + model : "") + (d && d.outlet ? " · O" + d.outlet : ""),
      aria: (d ? d.name : item.assetTag) + (model ? ", " + model : "") + ", U" + item.uPosition + (d && d.outlet ? ", outlet " + d.outlet : ""),
    };
  });
  let live = rackId === "A14";
  const pdus: Rack3dPdu[] = mounts.filter((item) => !item.uHeight && String(item.category || "").toUpperCase() === "PDU").map((item, index) => {
    const count = Math.max(1, Math.min(48, Number(item.powerPorts) || 24));
    const side = item.side || (index % 2 === 0 ? "right" : "left");
    let sockets: Rack3dSocket[];
    if (live) {
      /* Rack A14's first rack PDU carries the live outlets shown on Control. */
      const known = a14Sockets(selectedOutlet(ctx));
      sockets = Array.from({ length: count }, (_, i) => known[i] || { n: i + 1, state: "idle", title: item.assetTag + " port " + (i + 1) + " · Unbound" });
      live = false;
    } else {
      sockets = Array.from({ length: count }, (_, i) => ({ n: i + 1, state: "idle", title: item.assetTag + " port " + (i + 1) + " · No live reading" }));
    }
    return { id: item.id, label: item.assetTag, side, sockets };
  });
  return { units, pdus };
}

/* Before the repository answers, or for a rack it has nothing in: rack A14 from its
   live devices, any other rack from its simulated servers. */
function fallback(rackId, ctx) {
  if (rackId === "A14") {
    const units = devices.filter((d) => d.u).map((d) => Object.assign(deviceUnit(d), { on: isOn(d.id, ctx), act: unitAct(d.id, ctx) }));
    return { units, pdus: [{ id: "pdu-a14", label: "PDU A14", side: "right", sockets: a14Sockets(selectedOutlet(ctx)) }] };
  }
  const pod = PODS.find((item) => (item.racks || []).some((rack) => rack.id === rackId));
  const rack = pod ? rackById(pod, rackId) : null;
  const entities = rack ? rackEntities(rack) : [];
  let top = 40;
  const units: Rack3dUnit[] = entities.map((entity) => {
    const size = entity.kind === "Switch" ? 1 : 2;
    const u = entity.kind === "Switch" ? 22 : (/shelf/i.test(entity.kind) ? 6 : top);
    if (entity.kind === "GPU tray") top -= 2;
    return {
      id: entity.id,
      label: entity.name,
      u,
      units: size,
      klass: entity.kind === "Switch" ? "net" : (/shelf/i.test(entity.kind) ? "shelf" : "gpu"),
      on: isOn(entity.id, ctx),
      led: conditionTone(entity).color,
      act: unitAct(entity.id, ctx),
      rear: entity.name,
    };
  });
  return { units, pdus: [] };
}

export function rackModel(rackId, ctx = "floor") {
  const mounts = mountsFor(rackId);
  if (mounts && mounts.some((item) => item.uHeight && item.uPosition)) return fromMounts(rackId, mounts, ctx);
  const base = fallback(rackId, ctx);
  if (mounts && rackId !== "A14") base.pdus = fromMounts(rackId, mounts, ctx).pdus;
  return base;
}

export function rackViewHtml(rackId, ctx = "floor") {
  const model = rackModel(rackId, ctx);
  const live = rackId === "A14";
  const note = model.pdus.length
    ? (live ? "Rack PDU sockets show live outlet state. From the Rear view, click a lit socket to open it on Control." : "Rack PDUs show their ports. This rack has no live outlet readings.")
    : "No rack PDU is recorded on this rack.";
  return '<div class="rack3d" data-rack3d="' + esc(rackId) + '">' + rackSceneHtml("Rack " + rackId, model.units, model.pdus) + R3_LEGEND +
    '<p class="fine r3-note">' + esc(note) + "</p>" + (live ? pduTable(ctx) : "") + "</div>";
}

export function rack3dHtml() {
  return rackViewHtml("A14", "operate");
}
