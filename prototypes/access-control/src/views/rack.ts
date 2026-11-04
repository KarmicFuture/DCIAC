import { deviceById, devices } from "../data/devices";
import { outletByN } from "../data/outlets";
import { bmcText, countdownBlock, failBox, failoverBanner, waiting } from "../domain/failover";
import { onLeak } from "../domain/leak";
import { state } from "../state";
import { esc } from "../ui/format";
import { render } from "../ui/schedule";
import { fruSummary, pills } from "../ui/shell";
import { conditionTone } from "./floor";
import { rdpLauncher } from "./sessions";

export function uLabel(n) {
  return "U" + String(n).padStart(2, "0");
}

export function selectDevice(id) {
  state.selected = id;
  state.view = "rack";
  render();
}

export function launcher(d, path, type, label, caption, medium, extraClass?: string) {
  return '<button type="button" class="act launch' + (extraClass ? " " + extraClass : "") + '" data-act="launch" data-device="' + d.id + '" data-path="' + path +
    '" data-type="' + type + '" data-medium="' + (medium || "") + '"><strong>' + esc(label) + "</strong><small>" +
    esc(caption) + "</small></button>";
}

export function thermalReading(entity) {
  const load = (entity && entity.load) || { temp: 48, power: 40 };
  const hac = state.containment !== "cac";
  const u = entity && entity.u ? entity.u : 20;
  const top = u >= 36 ? (hac ? 1.1 : 2.6) : (u >= 28 ? 0.5 : 0.2);
  const loadRise = Math.max(0, (load.temp || 48) - 52) * (hac ? 0.08 : 0.18);
  const inlet = 20.5 + top + loadRise;
  const exhaust = inlet + 11 + (load.power || 40) * 0.06;
  const ret = hac ? Math.min(39, Math.max(35, 34 + (load.power || 40) * 0.04)) : (24 + (exhaust - inlet) * 0.35);
  let envelope = "In the 21–24 °C inlet band";
  let pri = 0;
  if (inlet > 27) {
    envelope = "Above the ASHRAE recommended inlet range";
    pri = 2;
  } else if (inlet > 24) {
    envelope = "Above the study inlet band, still under 27 °C";
    pri = 3;
  }
  return {
    supply: 20.5,
    inlet: inlet,
    exhaust: exhaust,
    ret: ret,
    hac: hac,
    envelope: envelope,
    pri: pri,
    recirculation: !hac && u >= 36,
  };
}

export function containSwitch() {
  const hac = state.containment !== "cac";
  return '<div class="horizon" role="group" aria-label="Containment"><button type="button" data-act="contain" data-mode="hac"' +
    (hac ? ' aria-pressed="true"' : "") + '>Hot aisle containment</button><button type="button" data-act="contain" data-mode="cac"' +
    (hac ? "" : ' aria-pressed="true"') + ">Cold aisle containment</button></div>";
}

export function thermalCard(entity) {
  const t = thermalReading(entity);
  const mark = t.pri ? '<b class="pri-mark pri-' + t.pri + '">' + t.pri + "</b> " : "";
  const mode = t.hac
    ? "Hot aisle containment. Exhaust is captured and returned near " + t.ret.toFixed(0) + " °C. The room outside the hood stays the cold aisle."
    : "Cold aisle containment. Supply is enclosed at the intake. Exhaust spills into the hall, and the top U can recirculate.";
  return '<div class="thermal-card"><div class="thermal-read">' +
    '<div><b>' + t.supply.toFixed(1) + ' °C</b><span>Supply</span></div>' +
    '<div><b>' + t.inlet.toFixed(1) + ' °C</b><span>Rack inlet</span></div>' +
    '<div><b>' + t.exhaust.toFixed(1) + ' °C</b><span>Rear exhaust</span></div>' +
    '<div><b>' + t.ret.toFixed(1) + ' °C</b><span>' + (t.hac ? "Return" : "Room") + "</span></div></div>" +
    "<p>" + mark + esc(t.envelope) + "</p><p class=\"fine\">" + mode +
    (t.recirculation ? " This U is high in the rack, where cold-aisle containment showed recirculation." : "") +
    ' Targets follow the <a href="https://www.linkedin.com/pulse/optimizing-thermal-performance-data-centers-analysis-hot-bhushan-vwrqf">HAC and CAC comparison</a>: supply 20.5 °C, HAC return about 37 °C, CAC inlets 21–24 °C.</p></div>';
}

export function faceplate(entity, pressed, act?: string) {
  const tone = conditionTone(entity);
  const kind = entity.kind === "Switch" ? "net" : (entity.kind === "Power shelf" || entity.kind === "Powershelf" ? "shelf" : "gpu");
  const bmc = entity.bmc === "down" ? " dark" : "";
  const action = act || "select";
  const part = action === "floor-server" ? '" data-part="inlet' : "";
  return '<button type="button" class="face ' + kind + bmc + (pressed ? " on" : "") + '" data-act="' + action + '" data-device="' +
    entity.id + '" data-server="' + entity.id + part + '"' + (pressed ? ' aria-pressed="true"' : "") + '><i class="u-tick">' + (entity.u ? entity.u : "") +
    '</i><span class="perf" aria-hidden="true"></span><span class="face-name">' + esc(entity.short || entity.name) +
    '</span><i class="bay-led" style="background:' + tone.color + '"></i></button>';
}

export function cabinetHtml(list) {
  const rows = list.slice().sort((a, b) => (b.u || 0) - (a.u || 0));
  return '<div class="cabinet" aria-label="Rack A14 front, cold aisle"><div class="cab-rail" aria-hidden="true"></div><div class="cab-bay">' +
    rows.map((entity) => faceplate(entity, state.selected === entity.id)).join("") +
    '</div><div class="cab-rail" aria-hidden="true"></div></div>';
}

export function deviceFaces(d) {
  const t = thermalReading(d);
  const part = (id, label) => '<button type="button" class="act" data-act="floor-part" data-server="' + d.id + '" data-part="' + id + '">' + label + "</button>";
  return '<div class="device-faces"><figure class="server-face"><figcaption>Front · cold aisle intake</figcaption><button type="button" class="bezel front" data-act="floor-part" data-server="' +
    d.id + '" data-part="inlet"><span class="perf tall"></span><span class="bezel-meta"><b>' +
    esc(d.short || d.name) + '</b><span>Intake</span></span><i class="bay-led" style="background:' +
    (d.bmc === "down" ? "#8a3030" : "#1f6b45") + '"></i></button><p class="fine">Servers pull ' + t.supply.toFixed(1) +
    " °C supply. Inlet here is " + t.inlet.toFixed(1) + ' °C.</p></figure><figure class="server-face"><figcaption>Rear · hot aisle exhaust</figcaption><button type="button" class="bezel rear" data-act="floor-part" data-server="' +
    d.id + '" data-part="exhaust"><span class="psu"></span><span class="psu"></span><span class="nic"></span><span class="exhaust"></span></button><p class="fine">Exhaust leaves at ' +
    t.exhaust.toFixed(0) + " °C" + (t.hac ? " into the contained hot aisle." : " into the open hall.") + "</p></figure></div>" +
    '<div class="part-row">' + part("bmc", "BMC") + part("feed", "DC feed") + "</div>";
}

export function deviceDetail(d) {
  const outlet = outletByN(d.outlet);
  const leak = onLeak(d.id) ? "On the DI-1 rope" : "Not on the DI-1 rope";
  const failover = d.bmc === "down";
  const rmSerialCap = failover ? "BMC dark · use ACS" : (state.rm1048 === "healthy" ? "SerialInterfaces/" + d.redfishId : "Plane dark");
  const rmKvmCap = failover ? "BMC dark · use ACS" : (state.rm1048 === "healthy" ? "Graphical console" : "Plane dark");
  const acsClass = failover ? "primary" : "";
  const rmClass = failover || state.rm1048 !== "healthy" ? "held" : "";
  const usb = d.usb
    ? launcher(d, "acs", "serial", "USB console", d.usb + " · OOB", "usb", acsClass)
    : "";
  const wait = waiting(d)
    ? countdownBlock(d, "BMC path lost. Out-of-band serial is coming up on ACS " + d.tty + ".")
    : (failover ? '<p class="fine">Out-of-band serial is up on ACS ' + esc(d.tty) + ".</p>" : "");
  const facts = "<dl><dt>Kind</dt><dd>" + esc(d.kind) + "</dd><dt>Location</dt><dd>" + uLabel(d.u) +
    " · rack A14</dd><dt>BMC</dt><dd>" + esc(bmcText(d)) + "</dd><dt>Serial</dt><dd class=\"mono\">" +
    esc(d.tty) + " · port " + d.port + "</dd>" +
    (d.usb ? '<dt>USB console</dt><dd class="mono">' + esc(d.usb) + "</dd>" : "") +
    '<dt>KVM</dt><dd class="mono">MPU port ' + d.mpu + "</dd><dt>Outlet</dt><dd>Outlet " + d.outlet +
    " · " + esc(outlet.power) + "</dd><dt>Leak</dt><dd>" + esc(leak) + "</dd></dl>";
  return deviceFaces(d) + thermalCard(d) + "<h3>" + esc(d.name) + "</h3><p class=\"fine\">" + esc(d.kind) + " · " + uLabel(d.u) +
    "</p>" + failoverBanner(d) + '<div class="launch-grid">' +
    launcher(d, "acs", "serial", "ACS serial", d.tty + " · port " + d.port + " · out of band", "rs232", acsClass) +
    launcher(d, "acs", "kvm", "ACS KVM", "MPU port " + d.mpu + " · HTML5", "", acsClass) +
    launcher(d, "rm1048", "serial", "RM1048 serial", rmSerialCap, "", rmClass) +
    launcher(d, "rm1048", "kvm", "RM1048 KVM", rmKvmCap, "", rmClass) +
    "</div>" + usb + rdpLauncher(d) + failBox(d.id, "serial") + failBox(d.id, "kvm") + facts + wait +
    '<p class="fine">Unbound and cross-rack launches are refused on the port map.</p>' +
    '<button type="button" class="act" data-act="nav" data-view="map">Open the port map</button>';
}

export function elevation() {
  return cabinetHtml(devices.filter((item) => item.u));
}

export function renderRack() {
  const d = deviceById(state.selected);
  return '<div class="page-head"><div class="top"><div><h1>Rack A14</h1>' +
    "<p class=\"sub\">Front faces the cold aisle. Rear exhausts into the hot aisle. Inlet temperature is the reading that has to stay in band.</p></div></div>" +
    pills() + "</div>" + containSwitch() +
    '<div class="rack-wrap"><section class="panel"><h2>Cold aisle front</h2><div class="elevation">' + elevation() +
    '</div></section><section class="panel"><h2>Device</h2><div class="detail">' +
    (d ? deviceDetail(d) : '<p class="empty">Select a device.</p>') +
    '</div></section></div><section class="panel"><h2>ACS FRU</h2>' + fruSummary(false) + "</section>";
}
