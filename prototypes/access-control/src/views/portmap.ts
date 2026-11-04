import { ACS_PORTS, deviceById, devices, targetOnPort } from "../data/devices";
import { LEAK, outlets } from "../data/outlets";
import { REFUSED } from "../data/users";
import { state } from "../state";
import { activeAlarms } from "../ui/alarms";
import { esc } from "../ui/format";
import { fruSummary, pills } from "../ui/shell";

export function mapButton(button) {
  if (button.type === "refuse") {
    return '<button type="button" class="act" data-act="refuse" data-key="' + esc(button.key) + '">Launch</button>';
  }
  if (button.type === "nav") {
    return '<button type="button" class="act" data-act="nav" data-view="' + button.view + '">' + esc(button.label) + "</button>";
  }
  if (button.type === "show-outlet") {
    return '<button type="button" class="act" data-act="show-outlet" data-outlet="' + button.outlet + '">' + esc(button.label) + "</button>";
  }
  return '<button type="button" class="act" data-act="launch" data-device="' + button.device + '" data-path="' +
    button.path + '" data-type="' + button.sessionType + '" data-medium="' + (button.medium || "") + '">' +
    esc(button.label) + "</button>";
}

export function mapRows() {
  const rows = [];
  devices.forEach((d) => {
    rows.push({
      key: "tty-" + d.id,
      endpoint: d.tty + " · port " + d.port,
      kind: "Serial",
      target: d.name,
      rack: "A14",
      bind: "Bound",
      button: { type: "launch", device: d.id, path: "acs", sessionType: "serial", medium: "rs232", label: "ACS serial" },
    });
    if (d.usb) {
      rows.push({
        key: "usb-" + d.id,
        endpoint: d.usb,
        kind: "USB console",
        target: d.name,
        rack: "A14",
        bind: "Bound",
        button: { type: "launch", device: d.id, path: "acs", sessionType: "serial", medium: "usb", label: "USB console" },
      });
    }
    rows.push({
      key: "mpu-" + d.id,
      endpoint: "MPU " + d.mpu,
      kind: "KVM",
      target: d.name,
      rack: "A14",
      bind: "Bound",
      button: { type: "launch", device: d.id, path: "acs", sessionType: "kvm", medium: "", label: "ACS KVM" },
    });
  });
  rows.push({
    key: "di-1",
    endpoint: "DI-1",
    kind: "Digital input",
    target: LEAK.location,
    rack: "A14",
    bind: "Outlets 1 and 2",
    button: { type: "nav", view: "control", label: "Leak policy" },
  });
  outlets.forEach((o) => {
    const d = o.deviceId ? deviceById(o.deviceId) : null;
    const leak = LEAK.outlets.indexOf(o.n) !== -1;
    rows.push({
      key: "out-" + o.n,
      endpoint: "Outlet " + o.n,
      kind: "Outlet",
      target: d ? d.name : "Unbound",
      rack: d ? "A14" : "—",
      bind: d ? (leak ? "Bound · DI-1 policy" : "Bound") : "Unbound",
      button: { type: "show-outlet", outlet: o.n, label: "Control" },
    });
  });
  REFUSED.forEach((r) => {
    rows.push({
      key: r.key,
      endpoint: r.endpoint,
      kind: r.kind,
      target: r.target,
      rack: r.rack,
      bind: "Refused",
      refused: true,
      button: { type: "refuse", key: r.key, label: "Launch" },
    });
  });
  return rows;
}

export function mapTable() {
  const body = mapRows().map((row) => {
    const note = state.refuseNote && state.refuseNote.key === row.key
      ? '<tr class="refuse-note"><td colspan="6">' + esc(state.refuseNote.text) + "</td></tr>"
      : "";
    const bindClass = row.refused ? "bind-refused" : "";
    return '<tr class="' + (row.refused ? "refused" : "") + '"><td class="mono">' + esc(row.endpoint) +
      "</td><td>" + esc(row.kind) + "</td><td>" + esc(row.target) + "</td><td>" + esc(row.rack) +
      '</td><td class="' + bindClass + '">' + esc(row.bind) + "</td><td>" + mapButton(row.button) +
      "</td></tr>" + note;
  }).join("");
  return "<table><thead><tr><th>Endpoint</th><th>Kind</th><th>Target</th><th>Rack</th><th>Binding</th><th></th></tr></thead><tbody>" +
    body + "</tbody></table>";
}

export function portFacts(port) {
  const refused = REFUSED.find((row) => row.key === "port-" + port);
  if (refused) {
    return { port, kind: "refused", name: refused.target, tty: "ttyS" + port, alarm: false, id: "", key: refused.key };
  }
  const target = targetOnPort(port);
  const alarm = activeAlarms().some((item) => item.device === target.id) || !!(target.watch && target.watch.pri);
  return {
    port,
    kind: target.serialOnly ? "serial" : "rack",
    name: target.name,
    tty: target.tty,
    alarm,
    id: target.id,
    key: "",
  };
}

function portVisible(facts) {
  const filter = state.portFilter || "all";
  if (filter === "rack" && facts.kind !== "rack") return false;
  if (filter === "serial" && facts.kind !== "serial") return false;
  if (filter === "refused" && facts.kind !== "refused") return false;
  if (filter === "alarm" && !facts.alarm) return false;
  const query = (state.portQuery || "").trim().toLowerCase();
  if (!query) return true;
  const hay = (facts.name + " " + facts.tty + " port " + facts.port + " " + facts.port).toLowerCase();
  return hay.indexOf(query) !== -1;
}

export function portCell(port) {
  const facts = portFacts(port);
  if (!portVisible(facts)) return "";
  const selected = state.selectedPort === port ? " selected" : "";
  const alarm = facts.alarm ? " alarm" : "";
  if (facts.kind === "refused") {
    const why = port === 15 ? "Unbound" : "Other rack";
    return '<button type="button" class="port-cell refused' + selected + '" data-act="refuse" data-port="' + port + '" data-port-kind="refused" data-key="' + esc(facts.key) +
      '"><span class="port-num">Port ' + port + " · " + esc(facts.tty) + '</span><span class="port-name">' + esc(facts.name) +
      '</span><span class="port-meta">' + why + "</span></button>";
  }
  const meta = facts.kind === "serial" ? "Serial-only" : "In the rack";
  const tone = facts.kind === "serial" ? "" : " managed";
  return '<button type="button" class="port-cell' + tone + alarm + selected + '" data-act="launch" data-port="' + port + '" data-port-kind="' + facts.kind + '" data-device="' + esc(facts.id) +
    '" data-path="acs" data-type="serial" data-medium="rs232"><span class="port-num">Port ' + port + " · " + esc(facts.tty) +
    '</span><span class="port-name">' + esc(facts.name) + '</span><span class="port-meta">' + meta + (facts.alarm ? " · Alarm" : "") + "</span></button>";
}

const PORT_FILTERS = [
  ["all", "All"],
  ["rack", "In rack"],
  ["serial", "Serial-only"],
  ["refused", "Refused"],
  ["alarm", "Alarm"],
];

export function portTools(shown) {
  const filters = PORT_FILTERS.map((pair) => {
    const on = (state.portFilter || "all") === pair[0];
    return '<button type="button" class="act' + (on ? " primary" : "") + '" data-act="port-filter" data-filter="' + pair[0] +
      '" aria-pressed="' + (on ? "true" : "false") + '">' + pair[1] + "</button>";
  }).join("");
  const compact = !!state.portCompact;
  return '<div class="port-tools"><label class="port-search">Search<input id="port-search" type="search" placeholder="Device, port, or tty" aria-label="Search ports by device, port, or tty" autocomplete="off" spellcheck="false"></label>' +
    '<div class="port-filters" role="group" aria-label="Port filters">' + filters + "</div>" +
    '<button type="button" class="act" data-act="port-density" aria-pressed="' + (compact ? "true" : "false") + '">' +
    (compact ? "Comfortable" : "Compact") + "</button></div>" +
    '<ul class="port-legend"><li><i class="swatch rack"></i> In the rack</li><li><i class="swatch serial"></i> Serial-only</li><li><i class="swatch refused"></i> Refused</li><li><i class="swatch alarm"></i> Alarm</li></ul>' +
    '<p class="fine port-count">Showing ' + shown + " of " + ACS_PORTS + ".</p>";
}

export function portGrid() {
  let html = "";
  let shown = 0;
  for (let port = 1; port <= ACS_PORTS; port += 1) {
    const cell = portCell(port);
    if (!cell) continue;
    shown += 1;
    html += cell;
  }
  const grid = shown
    ? '<div class="port-grid' + (state.portCompact ? " compact" : "") + '">' + html + "</div>"
    : '<p class="empty">No ports match.</p>';
  return portTools(shown) + grid;
}

export function renderMap() {
  const ready = ACS_PORTS - REFUSED.length;
  return '<div class="page-head"><div class="top"><div><h1>Port map</h1>' +
    "<p class=\"sub\">ACS 8000 has " + ACS_PORTS + " serial ports. " + ready +
    " of them reach a server in rack A14. Open a port and the console is already logged in.</p></div></div>" +
    pills() + '</div><section class="panel"><h2>48 serial ports</h2><p class="fine port-lead">One server per port. A cell marked “In the rack” is one of the named trays, the switch, or the power shelf. The rest are serial servers on the same ACS. Port 15 is unbound. Port 16 is in rack B07, so ACS-A14 will not open it.</p>' +
    portGrid() + '</section><section class="panel"><h2>FRU</h2>' + fruSummary(true) +
    '</section><section class="panel"><h2>Bindings</h2><div class="table-wrap">' + mapTable() + "</div></section>";
}
