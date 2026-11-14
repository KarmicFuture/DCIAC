import { deviceById, devices } from "../data/devices";
import { outletByN } from "../data/outlets";
import { state } from "../state";
import { esc } from "../ui/format";
import { pills } from "../ui/shell";
import { boxHtml } from "./floor";

export function futureOn() {
  return state.horizon === "future";
}

export function managedDevices() {
  return devices.filter((d) => !d.serialOnly);
}

export function shownBmc(d) {
  if (!d) return "up";
  if (futureOn() && d.bmc === "down") return "up";
  return d.bmc || "up";
}

export function shownLoad(d) {
  const load = (d && d.load) || { gpu: 0, mem: 0, power: 0, temp: 46 };
  if (!futureOn()) return load;
  return {
    gpu: Math.min(62, load.gpu || 40),
    mem: Math.min(60, load.mem || 40),
    power: Math.min(64, load.power || 40),
    temp: Math.min(58, Math.max(42, (load.temp || 50) - 6)),
  };
}

export function manageDevice() {
  return deviceById(state.manage.device) || managedDevices()[0];
}

export function futureHallHtml() {
  if (!futureOn()) return "";
  return '<div class="pod future" data-act="horizon-focus" style="--x:250px;--y:78px;--w:250px;--h:180px"><i class="pod-plate"></i><span class="pod-letter">2</span>' +
    '<div class="aisle cold" style="--x:12px;--y:8px;--w:220px;--h:18px"><span>Cold aisle</span></div>' +
    '<span class="row-slot" style="--y:32px">North row</span>' +
    '<div class="aisle hot" style="--x:12px;--y:72px;--w:220px;--h:22px"><span>Hot aisle</span></div>' +
    '<span class="row-slot" style="--y:104px">South row</span>' +
    '<div class="aisle cold" style="--x:12px;--y:148px;--w:220px;--h:18px"><span>Cold aisle</span></div>' +
    '<span class="future-tag">Hall 2 · planned</span></div>';
}

export function futureYardHtml() {
  if (!futureOn()) return "";
  const pieces = [
    { x: -360, y: 180, w: 100, d: 64, h: 52, cap: "Power module 2" },
    { x: 400, y: 210, w: 150, d: 56, h: 38, cap: "Heat rejection 2" },
  ];
  return pieces.map((item) => boxHtml(item, "ok", "horizon-focus", {
    klass: "future-gear", cap: item.cap, leds: [], color: "#8a9a84",
  })).join("");
}

export function stackNodes() {
  const d = manageDevice();
  const load = shownLoad(d);
  const bmc = shownBmc(d);
  const hot = load.temp >= 75 || load.gpu >= 90;
  return [
    { id: "grid", name: "Grid", detail: futureOn() ? "2 feeders · 4.8 MW" : "1 feeder · 2.4 MW" },
    { id: "mv", name: "Substation", detail: "Medium voltage" },
    { id: "xfmr", name: "Transformer", detail: "MV transformer" },
    { id: "module", name: "Power module", detail: futureOn() ? "Live module + planned skid" : "Power module" },
    { id: "battery", name: "Battery", detail: "Ride-through skid" },
    { id: "bus", name: "Bus bar", detail: "Overhead PowerBar" },
    { id: "shelf", name: "DC shelf", detail: "50 VDC" },
    { id: "rack", name: "Rack", detail: "A14" },
    { id: "tray", name: "Tray", detail: d.name },
    { id: "bmc", name: "BMC", detail: bmc === "down" ? "Path dark" : "Manager up", pri: bmc === "down" ? 1 : 0 },
    { id: "chip", name: "Chip", detail: hot ? "GPU high" : "GPU", pri: hot ? 2 : 0 },
  ];
}

export function chainHtml() {
  return '<div class="chain">' + stackNodes().map((node, index) => {
    const on = state.manage.layer === node.id ? " on" : "";
    const mark = node.pri ? '<b class="pri-mark pri-' + node.pri + '">' + node.pri + "</b>" : "";
    const arrow = index ? '<i aria-hidden="true">→</i>' : "";
    return arrow + '<button type="button" class="chain-node' + on + '" data-act="manage-layer" data-layer="' + node.id + '">' +
      mark + "<strong>" + esc(node.name) + "</strong><small>" + esc(node.detail) + "</small></button>";
  }).join("") + "</div>";
}

export function horizonHtml() {
  return '<div class="horizon" role="group" aria-label="System horizon"><button type="button" data-act="horizon" data-horizon="now"' +
    (futureOn() ? "" : ' aria-pressed="true"') + '>Now</button><button type="button" data-act="horizon" data-horizon="future"' +
    (futureOn() ? ' aria-pressed="true"' : "") + ">Future</button></div>";
}

export function sensorCell(label, value) {
  return '<div class="sensor"><b>' + esc(value) + "</b><span>" + esc(label) + "</span></div>";
}

export function bmcPanel(d) {
  const live = d.bmc;
  const shown = shownBmc(d);
  const load = shownLoad(d);
  const outlet = outletByN(d.outlet);
  const locked = state.user.role === "ReadOnly";
  const power = outlet && outlet.power === "off" ? "Off" : "On";
  const firmware = futureOn() ? "2.4.1" : "1.8.4";
  const note = futureOn()
    ? "<p class=\"fine\">Future reading. Live control still uses the BMC that is installed now." +
      (live === "down" ? " Today this path is dark and ACS serial is the out-of-band manager." : "") + "</p>"
    : (live === "down"
      ? "<p>BMC path is dark. Out-of-band management is ACS serial. RM1048 does not take this failover.</p>"
      : "<p class=\"fine\">BMC is up. RM1048 is the in-band manager. ACS serial stays the out-of-band wire.</p>");
  const openLive = live === "down"
    ? '<button type="button" class="act primary" data-act="floor-serial" data-device="' + d.id + '">Open ACS serial</button>'
    : '<button type="button" class="act primary" data-act="launch" data-device="' + d.id + '" data-path="rm" data-type="kvm">Open BMC console</button>' +
      '<button type="button" class="act" data-act="launch" data-device="' + d.id + '" data-path="acs" data-type="serial" data-medium="rs232">Open ACS serial</button>';
  const cycle = d.outlet
    ? '<button type="button" class="act" data-act="outlet" data-outlet="' + d.outlet + '" data-op="cycle" data-source="manage"' +
      (locked ? " disabled" : "") + ">Cycle outlet " + d.outlet + "</button>"
    : "";
  return note + '<div class="sensor-row">' +
    sensorCell("Manager", shown === "down" ? "Dark" : "Up") +
    sensorCell("Firmware", firmware) +
    sensorCell("Power", power) +
    sensorCell("Inlet", Math.round(load.temp - 8) + " °C") +
    sensorCell("GPU", Math.round(load.temp) + " °C") +
    sensorCell("Tray power", Math.round(load.power) + "%") +
    sensorCell("Fans", Math.round(40 + load.power * 0.4) + "%") +
    sensorCell("Redfish", d.redfishId || "—") +
    "</div><div class=\"actions\">" + openLive + cycle + "</div>";
}

export function chipPanel(d) {
  const load = shownLoad(d);
  if (d.kind !== "GPU tray") {
    return "<p class=\"fine\">" + esc(d.name) + " has no GPU package. The chip layer is the accelerator on a GPU tray.</p>";
  }
  const dies = [0, 1, 2, 3, 4, 5, 6, 7].map((index) => {
    const temp = Math.round(load.temp + ((index % 3) - 1) * 2);
    const watts = Math.round(90 + load.power * 1.4 + index);
    return '<div class="die"><b>GPU ' + (index + 1) + "</b><span>" + temp + " °C</span><span>" + watts + " W</span></div>";
  }).join("");
  return "<p class=\"fine\">Eight GPUs on " + esc(d.name) + ". Package power follows the tray BMC sensors.</p><div class=\"die-row\">" + dies + "</div>";
}

export function layerCopy(id, d) {
  const future = futureOn();
  if (id === "grid") return "<p>Utility feed into the OneCore yard.</p><p class=\"fine\">" + (future ? "A second feeder is reserved. Nameplate rises from 2.4 MW to 4.8 MW." : "One feeder is in service at 2.4 MW.") + "</p>";
  if (id === "mv") return "<p>Medium-voltage substation between the grid and the transformer.</p><p class=\"fine\">Protection and metering sit here, before the power module.</p>";
  if (id === "xfmr") return "<p>MV transformer in the yard, ahead of the power module.</p>" + '<button type="button" class="act" data-act="floor-server" data-server="xfmr-1">Show it outside</button>';
  if (id === "module") return "<p>Power module rectifies and holds the hall.</p><p class=\"fine\">" + (future ? "A second module is planned beside the live skid." : "One module is installed.") + "</p>" + '<button type="button" class="act" data-act="floor-server" data-server="pwr-mod">Show it outside</button>';
  if (id === "battery") return "<p>Battery skid rides through a utility dip. It does not replace the BMC path.</p>" + '<button type="button" class="act" data-act="floor-server" data-server="batt-1">Show it outside</button>';
  if (id === "bus") return "<p>Overhead bus bar along the hot aisle. It feeds the 50 V DC shelves.</p>" + '<button type="button" class="act" data-act="floor-server" data-server="bus-a">Show bus bar A</button>';
  if (id === "shelf") return "<p>DC power shelf in rack A14. 50 V to the trays.</p>" + '<button type="button" class="act" data-act="select" data-device="pshelf">Open the shelf</button>';
  if (id === "rack") return "<p>Rack A14 is the ACS domain. One ACS, 48 serial ports.</p>" + '<button type="button" class="act" data-act="floor-rack" data-pod="pod-a" data-rack="A14">Open the rack</button>';
  if (id === "tray") return "<p>" + esc(d.name) + " · " + esc(d.kind) + " · U" + d.u + " · " + esc(d.tty) + ".</p>" + '<button type="button" class="act" data-act="select" data-device="' + d.id + '">Open on the rack</button>';
  if (id === "bmc") return bmcPanel(d);
  if (id === "chip") return chipPanel(d);
  return "";
}

export function futureBrief() {
  const list = managedDevices();
  const dark = list.filter((d) => d.bmc === "down").length;
  const placed = state.plan.placements.length;
  const rows = [
    ["Grid", "2.4 MW · 1 feeder", "4.8 MW · 2 feeders"],
    ["Halls", "1 compute hall", "2 halls"],
    ["BMC paths", dark ? dark + " dark" : "All up", "All up"],
    ["Library plan", placed + " placed", placed ? placed + " built" : "None waiting"],
  ];
  const changes = ["Hall 2 is added, with a cold aisle, a contained hot aisle, and a bus bar."];
  if (dark) changes.push("Dark BMC paths are restored. ACS serial remains the out-of-band wire.");
  changes.push("A second feeder, power module, and heat-rejection skid land in the yard.");
  if (placed) changes.push(placed + " library " + (placed === 1 ? "piece is" : "pieces are") + " treated as built.");
  return '<aside class="future-card"><h2>' + (futureOn() ? "Future state" : "Now") + '</h2><p class="fine">The whole system, grid to chip. Switching horizon does not change live power or sessions.</p><table><tbody>' +
    rows.map((row) => "<tr><th>" + esc(row[0]) + "</th><td>" + esc(row[1]) + "</td><td>" + esc(row[2]) + "</td></tr>").join("") +
    "</tbody></table><h3>What the future adds</h3><ul>" + changes.map((line) => "<li>" + esc(line) + "</li>").join("") + "</ul>" +
    '<button type="button" class="act" data-act="nav" data-view="floor">Show this on the floor</button></aside>';
}

export function renderManage() {
  const d = manageDevice();
  const picker = managedDevices().map((item) => '<button type="button" data-act="manage-device" data-device="' + item.id + '"' +
    (item.id === d.id ? ' aria-pressed="true"' : "") + ">" + esc(item.name) + "</button>").join("");
  const layer = stackNodes().find((node) => node.id === state.manage.layer) || stackNodes()[0];
  return '<div class="page-head"><div class="top"><div><h1>Data center management</h1><p class="sub">Grid to chip, including the BMC. Now is the live system. Future is the planned state of the whole site.</p></div></div>' +
    pills() + "</div>" + horizonHtml() + chainHtml() + '<div class="manage-grid"><section class="panel"><div class="panel-head"><h2>' +
    esc(layer.name) + "</h2><p class=\"fine\">" + esc(layer.detail) + "</p></div>" +
    (state.manage.layer === "bmc" || state.manage.layer === "chip" || state.manage.layer === "tray" ? '<div class="device-pick">' + picker + "</div>" : "") +
    layerCopy(state.manage.layer, d) + "</section>" + futureBrief() + "</div>";
}
