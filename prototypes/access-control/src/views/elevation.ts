import { deviceById } from "../data/devices";
import { powerHtml } from "./power";
import { entityById } from "../data/pods";
import { authHeaders } from "../data/repository";
import { runtime, state } from "../state";
import { esc } from "../ui/format";
import { render } from "../ui/schedule";
import { conditionTone } from "./floor";
import { R3_LEGEND, a14Sockets, rackSceneHtml, type Rack3dPdu, type Rack3dUnit } from "./rack3d";

let request = 0;

function watts(value) {
  const n = Number(value) || 0;
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + " kW";
  return Math.round(n) + " W";
}

function mounts() {
  const data = runtime.elevation;
  if (!data || !data.mounts) return [];
  return data.mounts;
}

export async function loadElevation(rackId) {
  const mine = ++request;
  try {
    const [response, portsResponse] = await Promise.all([
      fetch("/api/v1/racks/" + encodeURIComponent(rackId) + "/elevation", { cache: "no-store" }),
      fetch("/api/v1/racks/" + encodeURIComponent(rackId) + "/ports", { cache: "no-store" }),
    ]);
    const body = await response.json().catch(() => ({}));
    const ports = await portsResponse.json().catch(() => null);
    if (mine !== request || state.floor.rackId !== rackId) return;
    runtime.elevation = response.ok ? body : { error: body.error || "This rack is not in the repository." };
    runtime.networkRack = portsResponse.ok ? ports : null;
  } catch (err) {
    if (mine !== request) return;
    runtime.elevation = { error: "The asset repository is not reachable." };
    runtime.networkRack = null;
  }
  render();
}

function tip(item) {
  const device = deviceById(item.assetTag);
  const host = device && !device.serialOnly ? device.host : "No address";
  const acs = device && device.port ? "ACS " + device.tty : "No ACS port";
  return { host, acs };
}

function measuredW(items) {
  let total = 0;
  let seen = 0;
  items.forEach((item) => {
    if (item.category === "PDU" || item.category === "PowerShelf") return;
    const device = deviceById(item.assetTag);
    const entity = device && entityById(device.id);
    if (!entity || !entity.load) return;
    seen += 1;
    total += (item.nameplateW || 0) * ((entity.load.power || 0) / 100);
  });
  return seen ? total : null;
}

function networkPorts() {
  const map = runtime.networkRack;
  const ports = [];
  if (!map || !map.devices) return ports;
  map.devices.forEach((device) => {
    (device.ports || []).forEach((port) => {
      if (port.kind === "network") ports.push(Object.assign({ assetId: device.assetId, assetTag: device.assetTag }, port));
    });
  });
  return ports;
}

function networkCables() {
  const ports = networkPorts();
  const seen = {};
  const cables = [];
  ports.forEach((port) => {
    if (!port.cable || seen[port.cable.id]) return;
    seen[port.cable.id] = true;
    cables.push(Object.assign({}, port.cable, { from: port, to: ports.find((item) => item.id === port.cable.farPort) || null }));
  });
  return cables;
}

function networkedIds() {
  const ids = new Set();
  networkCables().forEach((cable) => {
    if (cable.from) ids.add(cable.from.assetId);
    if (cable.to) ids.add(cable.to.assetId);
  });
  return ids;
}

function cableY(item) {
  const u = Number(item.uPosition) || 1;
  const height = Math.max(Number(item.uHeight) || 1, 1);
  const center = u + (height - 1) / 2;
  return 42.5 - center;
}

function cableColor(name) {
  const colors = { blue: "#2f6fed", black: "#222222", red: "#b42318", orange: "#c2410c", green: "#1f6f68", yellow: "#a16207" };
  return colors[String(name || "").toLowerCase()] || "#2f6fed";
}

function cableSvg(items) {
  const byId = {};
  items.forEach((item) => { byId[item.id] = item; });
  const paths = networkCables().map((cable) => {
    const from = cable.from && byId[cable.from.assetId];
    const to = cable.to && byId[cable.to.assetId];
    if (!from || !to || !from.uPosition || !to.uPosition) return "";
    const y1 = cableY(from).toFixed(2);
    const y2 = cableY(to).toFixed(2);
    return '<path d="M 70 ' + y1 + " C 96 " + y1 + ", 96 " + y2 + ", 70 " + y2 + '" stroke="' + cableColor(cable.color) + '"><title>' + esc(cable.label) + "</title></path>";
  }).join("");
  if (!paths) return "";
  return '<svg class="elev-cables" viewBox="0 0 100 42" preserveAspectRatio="none" aria-hidden="true">' + paths + "</svg>";
}

function networkHtml(data) {
  const map = runtime.networkRack;
  if (!map || map.rackId !== data.rackId) return "<h3>Network cables</h3><p class=\"fine\">Loading the network ports for this rack.</p>";
  const ports = networkPorts();
  const cables = networkCables();
  const canEdit = state.user && (state.user.role === "Administrator" || state.user.role === "Operator");
  const rows = cables.map((cable) => "<tr><td>" + esc(cable.from.assetTag) + " " + esc(cable.from.name) + "</td><td>" +
    esc(cable.to ? cable.to.assetTag + " " + cable.to.name : cable.farName) + "</td><td>" + esc(cable.color) + " · " + esc(cable.lengthM) +
    " m</td><td>" + (canEdit ? '<button type="button" class="act" data-act="elev-net-drop" data-id="' + esc(cable.id) + '">Drop</button>' : "") + "</td></tr>").join("");
  const free = ports.filter((port) => port.status !== "used");
  const choice = (port, selected) => '<option value="' + esc(port.id) + '"' + (selected ? " selected" : "") + ">" + esc(port.assetTag) + " · " + esc(port.name) + "</option>";
  const fromOptions = free.map((port, index) => choice(port, index === 0)).join("");
  const toOptions = free.map((port, index) => choice(port, index === 1)).join("");
  const form = canEdit && free.length > 1
    ? '<div class="dcim-tools"><label>From<select id="elev-net-from">' + fromOptions + "</select></label><label>To<select id=\"elev-net-to\">" + toOptions +
      "</select></label><label>Color<input id=\"elev-net-color\" value=\"blue\"></label><button type=\"button\" class=\"act primary\" data-act=\"elev-net-save\">Track network cable</button></div>"
    : "";
  return "<h3>Network cables</h3><p class=\"fine\">These stay on this rack. A network port is free until you record a cable.</p>" +
    (rows ? "<table><thead><tr><th>From</th><th>To</th><th>Cable</th><th></th></tr></thead><tbody>" + rows + "</tbody></table>" : "<p>No network cables on this rack.</p>") +
    form;
}

function assetHtml(item) {
  const about = tip(item);
  const half = item.width === "half" ? " half " + (item.side === "right" ? "right" : "left") : "";
  const linked = networkedIds().has(item.id);
  const pop = "<span class=\"elev-pop\"><b>" + esc(item.assetTag) + "</b><span>" + esc(item.manufacturer + " " + item.model) +
    "</span><span>" + esc(about.host) + "</span><span>" + esc(about.acs) + "</span>" +
    (linked ? "<span>Network cable on this rack</span>" : "") + "</span>";
  return '<button type="button" class="elev-asset' + half + (linked ? " net" : "") + '" data-act="elev-device" data-asset="' + esc(item.id) +
    '" data-tag="' + esc(item.assetTag) + '" data-u="' + (item.uPosition || "") + '" data-units="' + item.uHeight +
    '" data-side="' + esc(item.side || "") + '" data-face="' + esc(item.face || "front") + '" style="--u:' +
    (item.uPosition || 1) + ";--h:" + Math.max(item.uHeight, 1) + '">' + esc(item.assetTag) + pop + "</button>";
}

function rail(side, items) {
  const gear = items.filter((item) => !item.uHeight && (item.side || "left") === side);
  const cards = gear.map((item) => {
    const about = tip(item);
    return '<button type="button" class="elev-asset rail" data-act="elev-device" data-asset="' + esc(item.id) +
      '" data-tag="' + esc(item.assetTag) + '" data-units="0" data-side="' + esc(item.side || side) + '" data-face="' +
      esc(item.face || "front") + '">' + esc(item.assetTag) + "<span class=\"elev-pop\"><b>" + esc(item.assetTag) +
      "</b><span>" + esc(item.manufacturer + " " + item.model) + "</span><span>" + esc(about.host) + "</span><span>" +
      esc(about.acs) + "</span></span></button>";
  }).join("");
  return '<div class="elev-rail" data-elev-rail="' + side + '"><span>0U</span>' + cards + "</div>";
}

function ghostHtml() {
  if (state.horizon !== "future" || !runtime.elevation) return "";
  const face = state.floor.elevationFace || "front";
  return (runtime.futureChanges || []).filter((change) => change.rackId === runtime.elevation.rackId && (change.op || "add") !== "remove" && face === "front").map((change) => {
    const height = 2;
    const u = Number(change.uPosition) || 1;
    return '<div class="elev-asset ghost" style="--u:' + u + ';--h:' + height + '">Planned ' + esc(change.modelId || "device") + "</div>";
  }).join("");
}

function grid(items) {
  const slots = [];
  for (let u = 42; u >= 1; u -= 1) slots.push('<div class="elev-slot" data-u="' + u + '"><span>' + u + "</span></div>");
  const drawn = items.filter((item) => item.uHeight && item.face === (state.floor.elevationFace || "front")).map(assetHtml).join("");
  return '<div class="elev-grid">' + slots.join("") + drawn + ghostHtml() + cableSvg(items) + "</div>";
}

function stat(label, value) {
  return "<div><b>" + esc(value) + "</b><span>" + esc(label) + "</span></div>";
}

function detail(data) {
  const numbers = data.budget;
  const live = measuredW(data.mounts || []);
  const powerFree = numbers.powerPortsTotal
    ? numbers.powerPortsFree + " free of " + numbers.powerPortsTotal
    : "No rPDU";
  const netFree = numbers.netPortsTotal
    ? numbers.netPortsFree + " free of " + numbers.netPortsTotal
    : "No switch";
  const face = state.floor.elevationFace === "rear" ? "rear" : "front";
  const racks = (data.siblings || []).map((item) => '<button type="button" class="elev-rack" data-act="floor-rack" data-elev-rack="' +
    esc(item.rackId) + '" data-pod="' + esc(state.floor.podId) + '" data-rack="' + esc(item.rackId) + '"' +
    (item.rackId === data.rackId ? ' aria-current="true"' : "") + ">" + esc(item.rackId) + "</button>").join("");
  return "<h2>" + esc(data.name || data.rackId) + "</h2><p class=\"fine\">" + (state.user && state.user.role === "Administrator"
    ? "Drag a device to a free U. Drop it on another rack to move it."
    : "Only an Administrator can move a device.") + "</p><div class=\"elev-stats\">" +
    stat("Space", numbers.usedU + "U used · " + numbers.freeU + "U free") +
    stat("Largest free block", numbers.largestFreeU + "U") +
    stat("Weight", numbers.weightKg + " / " + numbers.weightLimitKg + " kg") +
    stat("Nameplate", watts(numbers.nameplateW)) +
    stat("Derated", watts(numbers.deratedW)) +
    stat("Typical", watts(numbers.typicalW)) +
    stat("Rack budget", watts(numbers.budgetW)) +
    stat("Measured", live == null ? "No Lab load" : watts(live)) +
    stat("Power ports", numbers.powerPortsUsed + " used · " + powerFree) +
    stat("Network ports", numbers.netPortsUsed + " used · " + netFree) +
    "</div><p class=\"fine\">Showing the " + face + ".</p>" + networkHtml(data) + powerHtml(data.rackId) + "<h3>Racks in this hall</h3><div class=\"elev-racks\">" + racks + "</div>" +
    '<p class="elev-actions"><button type="button" class="act" data-act="elev-chassis">3D chassis</button></p>';
}

/* Model names from the repository can carry vendor branding. The 3D rack shows the
   product line only. */
function unbranded(text) {
  return String(text || "").replace(/\b(vertiv|avocent|geist|liebert)\b/gi, "").replace(/\s+/g, " ").trim();
}

function unitKlass(category) {
  const c = String(category || "").toLowerCase();
  if (c.indexOf("switch") >= 0) return "net";
  if (c.indexOf("shelf") >= 0 || c.indexOf("power") >= 0) return "shelf";
  if (c.indexOf("gpu") >= 0) return "gpu";
  return "srv";
}

function rack3dScene(data, items) {
  const units: Rack3dUnit[] = items.filter((item) => item.uHeight && item.uPosition).map((item) => {
    const device = deviceById(item.assetTag);
    const entity = device ? entityById(device.id) : null;
    const model = unbranded(item.model);
    return {
      id: item.id,
      label: item.assetTag,
      u: Number(item.uPosition),
      units: Math.max(1, Number(item.uHeight) || 1),
      klass: unitKlass(item.category),
      led: entity ? conditionTone(entity).color : undefined,
      act: 'data-act="elev-device" data-asset="' + esc(item.id) + '" data-tag="' + esc(item.assetTag) + '"',
      rear: item.assetTag + (model ? " · " + model : ""),
      aria: item.assetTag + (model ? ", " + model : "") + ", U" + item.uPosition + (item.face === "rear" ? ", rear mounted" : ""),
    };
  });
  const a14 = data.rackId === "A14";
  let live = a14;
  const pdus: Rack3dPdu[] = items.filter((item) => !item.uHeight && String(item.category || "").toUpperCase() === "PDU").map((item, index) => {
    const count = Math.max(1, Math.min(48, Number(item.powerPorts) || 24));
    const side = item.side || (index % 2 === 0 ? "right" : "left");
    let sockets;
    if (live) {
      /* Rack A14's first rPDU carries the live outlets shown on Control. */
      const known = a14Sockets();
      sockets = Array.from({ length: count }, (_, i) => known[i] || { n: i + 1, state: "idle", title: item.assetTag + " port " + (i + 1) + " · Unbound" });
      live = false;
    } else {
      sockets = Array.from({ length: count }, (_, i) => ({ n: i + 1, state: "idle", title: item.assetTag + " port " + (i + 1) + " · No live reading" }));
    }
    return { id: item.id, label: item.assetTag, side, sockets };
  });
  const note = pdus.length
    ? (a14 ? "Rack PDU sockets show live outlet state for rack A14. Click a lit socket to open it on Control." : "Rack PDUs show their ports. This rack has no live outlet readings.")
    : "No rack PDU is recorded on this rack.";
  return '<div class="rack3d elev-3d">' + rackSceneHtml(data.name || data.rackId, units, pdus) + R3_LEGEND +
    '<p class="fine">' + esc(note) + " Switch to 2D to move devices or export.</p></div>";
}

export function elevationParts() {
  const data = runtime.elevation;
  if (!data) {
    return { scene: '<div class="scene elev-scene"><p class="fine">Loading the elevation…</p></div>', detail: '<aside class="inspector"><p class="fine">Loading.</p></aside>' };
  }
  if (data.error) {
    return { scene: '<div class="scene elev-scene"><p class="fine">' + esc(data.error) + "</p></div>", detail: '<aside class="inspector"></aside>' };
  }
  const items = mounts();
  const face = state.floor.elevationFace === "rear" ? "rear" : "front";
  const is3d = state.floor.elevation3d !== false;
  const mode = '<button type="button" class="act" data-act="elev-3d" data-mode="3d"' + (is3d ? ' aria-pressed="true"' : "") + ">3D</button>" +
    '<button type="button" class="act" data-act="elev-3d" data-mode="2d"' + (is3d ? "" : ' aria-pressed="true"') + ">2D</button>";
  if (is3d) {
    return {
      scene: '<div class="scene elev-scene is-3d"><div class="elev-tools">' + mode + "</div>" + rack3dScene(data, items) + "</div>",
      detail: '<aside class="inspector">' + detail(data) + "</aside>",
    };
  }
  const scene = '<div class="scene elev-scene"><div class="elev-tools">' + mode + '<button type="button" class="act" data-act="elev-face" data-face="front"' +
    (face === "front" ? ' aria-pressed="true"' : "") + '>Front</button><button type="button" class="act" data-act="elev-face" data-face="rear"' +
    (face === "rear" ? ' aria-pressed="true"' : "") + '>Rear</button><button type="button" class="act" data-act="elev-png">PNG</button><button type="button" class="act" data-act="elev-pdf">PDF</button></div>' +
    '<div class="elev-stage">' + rail("left", items) + grid(items) + rail("right", items) + "</div></div>";
  return { scene, detail: '<aside class="inspector">' + detail(data) + "</aside>" };
}

function uAt(clientY, grid) {
  const rect = grid.getBoundingClientRect();
  if (!rect.height) return 1;
  const ratio = Math.min(0.999, Math.max(0, (clientY - rect.top) / rect.height));
  return 42 - Math.floor(ratio * 42);
}

export function elevationPointerDown(event) {
  if (state.view !== "floor" || state.floor.level !== "elevation" || event.button !== 0) return false;
  const asset = event.target.closest && event.target.closest(".elev-asset");
  if (!asset) return false;
  if (!state.user || state.user.role !== "Administrator") {
    state.toast = "Only an Administrator can move an asset.";
    render();
    return true;
  }
  const grid = document.querySelector(".elev-grid");
  runtime.elevDrag = {
    id: event.pointerId,
    assetId: asset.dataset.asset,
    units: Number(asset.dataset.units || 0),
    startU: Number(asset.dataset.u || 0),
    u: Number(asset.dataset.u || 0),
    side: asset.dataset.side || "",
    face: asset.dataset.face || "front",
    originX: event.clientX,
    originY: event.clientY,
    startPointerU: grid ? uAt(event.clientY, grid) : 0,
    moved: false,
  };
  if (asset.setPointerCapture) asset.setPointerCapture(event.pointerId);
  return true;
}

export function elevationPointerMove(event) {
  const drag = runtime.elevDrag;
  if (!drag || drag.id !== event.pointerId) return false;
  if (Math.abs(event.clientX - drag.originX) + Math.abs(event.clientY - drag.originY) > 4) drag.moved = true;
  if (!drag.units) return true;
  const grid = document.querySelector(".elev-grid");
  if (!grid) return true;
  const next = drag.startU + (uAt(event.clientY, grid) - drag.startPointerU);
  const max = 42 - drag.units + 1;
  drag.u = Math.min(max, Math.max(1, next));
  if (drag.u !== drag.startU) drag.moved = true;
  const el = document.querySelector('.elev-asset[data-asset="' + drag.assetId + '"]');
  if (el) el.style.setProperty("--u", String(drag.u));
  return true;
}

async function commitMove(drag, event) {
  const hit = document.elementFromPoint(event.clientX, event.clientY);
  const chip = hit && hit.closest ? hit.closest("[data-elev-rack]") : null;
  const railEl = hit && hit.closest ? hit.closest("[data-elev-rail]") : null;
  const rackId = chip ? chip.getAttribute("data-elev-rack") : (runtime.elevation && runtime.elevation.rackId);
  const face = drag.units ? (state.floor.elevationFace || "front") : drag.face;
  const side = !drag.units && railEl ? railEl.getAttribute("data-elev-rail") : drag.side;
  const samePlace = rackId === runtime.elevation.rackId && (!drag.units || drag.u === drag.startU) && side === drag.side && face === drag.face;
  if (samePlace) {
    loadElevation(runtime.elevation.rackId);
    return;
  }
  const payload: any = { assetId: drag.assetId, rackId, face };
  if (drag.units) payload.uPosition = drag.u;
  if (side) payload.side = side;
  let body: any = {};
  let response: Response;
  try {
    response = await fetch("/api/v1/moves", { method: "POST", headers: authHeaders(), body: JSON.stringify(payload) });
    body = await response.json();
  } catch (err) {
    state.toast = "The asset repository did not accept the move.";
    loadElevation(state.floor.rackId);
    return;
  }
  if (!response.ok) {
    state.toast = body.error || "That U is taken.";
    loadElevation(state.floor.rackId);
    return;
  }
  runtime.elevation = body.elevation;
  if (body.elevation && body.elevation.rackId) state.floor.rackId = body.elevation.rackId;
  state.toast = (body.asset.assetTag || "Device") + " moved.";
  render();
}

export function elevationPointerUp(event) {
  const drag = runtime.elevDrag;
  if (!drag || drag.id !== event.pointerId) return false;
  runtime.elevDrag = null;
  if (drag.moved) {
    state.floor.suppressClick = true;
    setTimeout(() => { state.floor.suppressClick = false; }, 0);
    commitMove(drag, event);
  }
  return true;
}

function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function drawPng(data) {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 980;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f6f3ee";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "24px sans-serif";
  const face = state.floor.elevationFace || "front";
  ctx.fillText(data.name + " · " + face, 36, 48);
  const top = 80;
  const row = 20;
  const left = 70;
  const width = 360;
  ctx.strokeStyle = "#d5cfc6";
  for (let u = 1; u <= 42; u += 1) {
    const y = top + (42 - u) * row;
    ctx.strokeRect(left, y, width, row);
    ctx.fillStyle = "#5c564e";
    ctx.font = "12px sans-serif";
    ctx.fillText(String(u), 36, y + 14);
  }
  data.mounts.filter((item) => item.uHeight && item.face === face).forEach((item) => {
    const y = top + (42 - (item.uPosition + item.uHeight - 1)) * row;
    ctx.fillStyle = "#1f6f68";
    ctx.fillRect(left + 2, y + 1, width - 4, item.uHeight * row - 2);
    ctx.fillStyle = "#f6f3ee";
    ctx.font = "12px sans-serif";
    ctx.fillText(item.assetTag + "  " + item.model, left + 8, y + 14);
  });
  canvas.toBlob((blob) => { if (blob) download(data.rackId + "-" + face + ".png", blob); });
}

function pdfEscape(text) {
  return String(text || "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function pdfBytes(stream) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += (index + 1) + " 0 obj\n" + body + "\nendobj\n";
  });
  const xref = out.length;
  out += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
  offsets.forEach((offset) => { out += String(offset).padStart(10, "0") + " 00000 n \n"; });
  out += "trailer << /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF";
  return out;
}

function drawPdf(data) {
  const face = state.floor.elevationFace || "front";
  const top = 560;
  const row = 12;
  const left = 70;
  const width = 280;
  let stream = "0.96 0.95 0.93 rg 0 0 792 612 re f\n";
  stream += "BT /F1 16 Tf 0.1 0.1 0.1 rg 1 0 0 1 36 580 Tm (" + pdfEscape(data.name + " · " + face) + ") Tj ET\n";
  stream += "0.75 0.72 0.68 RG\n";
  for (let u = 1; u <= 42; u += 1) {
    const y = 36 + (u - 1) * row;
    stream += "0.1 0.1 0.1 rg BT /F1 7 Tf 1 0 0 1 40 " + (y + 3) + " Tm (" + u + ") Tj ET\n";
    stream += "0.75 0.72 0.68 RG " + left + " " + y + " " + width + " " + row + " re S\n";
  }
  stream += "0.12 0.43 0.41 rg\n";
  data.mounts.filter((item) => item.uHeight && item.face === face).forEach((item) => {
    const y = 36 + (item.uPosition - 1) * row;
    const h = item.uHeight * row;
    stream += left + " " + y + " " + width + " " + h + " re f\n";
    stream += "BT /F1 8 Tf 1 1 1 rg 1 0 0 1 " + (left + 6) + " " + (y + 3) + " Tm (" + pdfEscape(item.assetTag) + ") Tj ET\n";
    stream += "0.12 0.43 0.41 rg\n";
  });
  let line = 560;
  data.mounts.filter((item) => !item.uHeight || item.face === face).forEach((item) => {
    const where = item.uHeight ? "U" + item.uPosition : "0U";
    stream += "BT /F1 9 Tf 0.1 0.1 0.1 rg 1 0 0 1 380 " + line + " Tm (" + pdfEscape(where + "  " + item.assetTag + "  " + item.model) + ") Tj ET\n";
    line -= 14;
  });
  download(data.rackId + "-" + face + ".pdf", new Blob([pdfBytes(stream)], { type: "application/pdf" }));
}

export async function saveNetworkCable() {
  const from = document.getElementById("elev-net-from") as HTMLSelectElement | null;
  const to = document.getElementById("elev-net-to") as HTMLSelectElement | null;
  const color = document.getElementById("elev-net-color") as HTMLInputElement | null;
  const rackId = state.floor.rackId;
  let body: any = {};
  let response: Response;
  try {
    response = await fetch("/api/v1/connections", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ aPort: from ? from.value : "", bPort: to ? to.value : "", color: color ? color.value : "blue", cableType: "network", lengthM: 2 }),
    });
    body = await response.json();
  } catch (err) {
    state.toast = "The network cable was not saved.";
    render();
    return;
  }
  state.toast = response.ok
    ? "Network cable " + (body.label || "saved") + "." + (body.issues && body.issues.length ? " " + body.issues.map((item) => item.issue).join(", ") + " flagged." : "")
    : (body.error || "The network cable was not saved.");
  loadElevation(rackId);
}

export async function dropNetworkCable(cableId) {
  const rackId = state.floor.rackId;
  let body: any = {};
  let response: Response;
  try {
    response = await fetch("/api/v1/connections/" + encodeURIComponent(cableId) + "/drop", { method: "POST", headers: authHeaders(), body: "{}" });
    body = await response.json();
  } catch (err) {
    state.toast = "The network cable stayed.";
    render();
    return;
  }
  state.toast = response.ok ? "Network cable dropped." : (body.error || "The network cable stayed.");
  loadElevation(rackId);
}

export function exportElevation(kind) {
  const data = runtime.elevation;
  if (!data || !data.mounts) return;
  if (kind === "pdf") drawPdf(data);
  else drawPng(data);
}
