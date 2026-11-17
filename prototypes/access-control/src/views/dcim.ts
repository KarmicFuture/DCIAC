import { deviceById } from "../data/devices";
import { authHeaders } from "../data/repository";
import { runtime, state } from "../state";
import { esc } from "../ui/format";
import { render } from "../ui/schedule";

const TABS = [
  ["capacity", "Capacity"],
  ["cables", "Cables"],
  ["work", "Work"],
  ["monitor", "Monitor"],
  ["reports", "Reports"],
  ["discovery", "Discovery"],
];

function dcim() {
  return runtime.dcim;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (err) {
    return {};
  }
}

export async function refreshDcim() {
  const headers = authHeaders();
  const [capacity, work, alarms, discovery, schedules] = await Promise.all([
    fetch("/api/v1/capacity", { cache: "no-store" }).then(readJson),
    fetch("/api/v1/work-orders", { headers, cache: "no-store" }).then(readJson),
    fetch("/api/v1/alarms", { cache: "no-store" }).then(readJson),
    fetch("/api/v1/discovery/run", { method: "POST", headers, body: "{}" }).then(readJson).catch(() => ({ items: [] })),
    fetch("/api/v1/reports/schedules", { cache: "no-store" }).then(readJson).catch(() => ({ schedules: [] })),
  ]);
  const slot = dcim();
  slot.capacity = capacity;
  slot.work = work.workOrders || [];
  slot.alarms = alarms.alarms || [];
  slot.discovery = discovery.items || slot.discovery || [];
  slot.schedules = schedules.schedules || [];
  slot.loaded = true;
  slot.loading = false;
}

export function renderDcim() {
  const slot = dcim();
  if (!slot.loaded && !slot.loading) {
    slot.loading = true;
    refreshDcim().then(() => render()).catch(() => {
      slot.loading = false;
      slot.loaded = true;
      slot.note = "The DCIM API is not reachable.";
      render();
    });
  }
  const tabs = TABS.map((pair) => '<button type="button" class="act' + (slot.tab === pair[0] ? " primary" : "") +
    '" data-act="dcim-tab" data-tab="' + pair[0] + '">' + pair[1] + "</button>").join("");
  return '<section class="panel dcim"><div class="dcim-tabs">' + tabs +
    "</div>" + panel(slot) + (slot.note ? '<p class="fine">' + esc(slot.note) + "</p>" : "") + "</section>";
}

function panel(slot) {
  if (slot.tab === "cables") return cables(slot);
  if (slot.tab === "work") return work(slot);
  if (slot.tab === "monitor") return monitor(slot);
  if (slot.tab === "reports") return reports(slot);
  if (slot.tab === "discovery") return discovery(slot);
  return capacity(slot);
}

function capacity(slot) {
  const cap = slot.capacity || {};
  const home = slot.home && slot.home.placements ? slot.home.placements : [];
  const rows = home.map((item) => "<tr><td>" + esc(item.rackId) + "</td><td>U" + esc(item.uPosition) +
    "</td><td>" + esc((item.reasons || []).join(" ")) + "</td><td><button type=\"button\" class=\"act\" data-act=\"dcim-plan\" data-rack=\"" +
    esc(item.rackId) + "\">Add to scenario</button></td></tr>").join("");
  return "<h2>Find a home</h2><p>Installed " + watts(cap.installedW) + " · provisioned " + watts(cap.provisionedW) +
    " · measured " + (cap.measuredW == null ? "no sample" : watts(cap.measuredW)) +
    " · stranded " + watts(cap.strandedW) + " · PUE " + esc(cap.pue) + " · inlet " + esc(cap.inletC) + " °C " + esc(cap.ashrae) + ".</p>" +
    '<div class="dcim-tools"><label>Model<select id="dcim-model"><option value="dell-r760">Dell PowerEdge R760</option></select></label>' +
    '<label>Hall<select id="dcim-hall"><option value="hall-3">Hall 3</option><option value="">All halls</option></select></label>' +
    '<button type="button" class="act primary" data-act="dcim-home">Find a home</button></div>' +
    (rows ? '<table><thead><tr><th>Rack</th><th>U</th><th>Why</th><th></th></tr></thead><tbody>' + rows + "</tbody></table>" : "<p>No placement yet.</p>") +
    hallTable(cap) + scopeHtml(slot.scope);
}

function hallTable(cap) {
  const halls = cap.halls || [];
  if (!halls.length) return "";
  const rows = halls.map((hall) => "<tr><td><button type=\"button\" class=\"act\" data-act=\"dcim-hall\" data-id=\"" + esc(hall.id) + "\">" + esc(hall.name) +
    "</button></td><td>" + watts(hall.installedW) + "</td><td>" + watts(hall.strandedW) + "</td><td>A " + watts(hall.installedW) + "<br>B " + watts(hall.installedW) +
    "</td><td>" + esc(hall.freeU) + "U free</td><td>" +
    esc(hall.networkFree && hall.networkFree["25G"]) + " × 25G</td><td>" + watts(hall.heatW) + " / " + watts(hall.cduW) + "</td></tr>").join("");
  return "<h3>Halls</h3><p class=\"fine\">Feeds A and B are each sized for the full hall, so one feed can carry the load.</p><table><thead><tr><th>Hall</th><th>Installed</th><th>Stranded</th><th>Circuits</th><th>Space</th><th>Network</th><th>Heat / CDU</th></tr></thead><tbody>" + rows + "</tbody></table>";
}

function scopeHtml(scope) {
  if (!scope) return "";
  if (scope.blocks) {
    const blocks = (scope.blocks || []).map((block) => "U" + block.start + " × " + block.length).join(", ");
    return "<h3>" + esc(scope.rackId) + "</h3><p>Largest free block " + esc(scope.largestFreeU) + "U. Contiguous: " + esc(blocks || "none") + ".</p>";
  }
  const racks = (scope.racks || []).slice(0, 20).map((rack) => '<button type="button" class="act" data-act="dcim-rack" data-id="' + esc(rack.rackId) + '">' + esc(rack.rackId) + " " + rack.freeU + "U</button>").join("");
  const rows = (scope.rows || []).map((row) => esc(row.name) + " " + row.freeU + "U free").join(" · ");
  return "<h3>" + esc(scope.name || "") + "</h3><p>" + rows + "</p><div class=\"dcim-tools\">" + racks + "</div>";
}

function rackChoices(hall) {
  const count = 20;
  if (hall === "1") return Array.from({ length: count }, (_, index) => "A" + String(index + 1).padStart(2, "0"));
  return Array.from({ length: count }, (_, index) => "H" + hall + "-" + String(index + 1).padStart(2, "0"));
}

function cables(slot) {
  const hall = slot.cableHall || "1";
  const racks = rackChoices(hall);
  const preferred = slot.cableRack || (hall === "1" ? "A14" : racks[0]);
  const rack = racks.indexOf(preferred) >= 0 ? preferred : racks[0];
  const halls = Array.from({ length: 10 }, (_, index) => String(index + 1)).map((item) =>
    '<option value="' + item + '"' + (item === hall ? " selected" : "") + ">Hall " + item + "</option>").join("");
  const rackOptions = racks.map((item) => '<option value="' + item + '"' + (item === rack ? " selected" : "") + ">" + item + "</option>").join("");
  const map = slot.map;
  const devices = (map && map.devices ? map.devices : []).map((item) => Object.assign({}, item, {
    ports: (item.ports || []).filter((port) => port.kind !== "network"),
  })).filter((item) => item.ports.length);
  const deviceId = devices.some((item) => item.assetId === slot.cableDevice) ? slot.cableDevice : (devices[0] ? devices[0].assetId : "");
  const device = devices.find((item) => item.assetId === deviceId);
  const deviceOptions = devices.map((item) => {
    const used = item.ports.filter((port) => port.status === "used").length;
    const free = item.ports.filter((port) => port.status === "free").length;
    return '<option value="' + esc(item.assetId) + '"' + (item.assetId === deviceId ? " selected" : "") + ">" +
      esc(item.assetTag) + " · " + used + " cabled, " + free + " free</option>";
  }).join("");
  const farPorts = devices.flatMap((item) => item.ports.filter((port) => port.status !== "used" && port.id !== slot.nearPort).map((port) =>
    '<option value="' + esc(port.id) + '">' + esc(item.assetTag) + " · " + esc(port.name) + " · " + esc(port.status) + "</option>"));
  const near = device && slot.nearPort ? (device.ports.find((port) => port.id === slot.nearPort) || devices.flatMap((item) => item.ports).find((port) => port.id === slot.nearPort)) : null;
  const rows = device ? device.ports.map((port) => portRow(port, slot.nearPort)).join("") : "";
  const issues = map && map.issues && map.issues.length
    ? "<p class=\"reason\">" + map.issues.map((item) => esc(item.issue + " · " + (item.portId || item.connectionId || ""))).join("<br>") + "</p>"
    : "";
  const hops = (slot.trace || []).map((hop) => "<li>" + esc(hop.name) + "</li>").join("");
  const visiblePorts = devices.flatMap((item) => item.ports);
  const counts = map ? visiblePorts.filter((port) => port.status === "used").length + " cabled · " +
    visiblePorts.filter((port) => port.status === "free").length + " free · " +
    visiblePorts.filter((port) => port.status === "reserved").length + " reserved" : "";
  return "<h2>Cables</h2><p>Pick a rack, then track the power, serial, or KVM cables you care about. Network cables are recorded on the rack elevation. A14 serial consoles are already cabled to ACS.</p>" +
    '<div class="dcim-tools"><label>Hall<select id="dcim-cable-hall">' + halls + "</select></label>" +
    '<label>Rack<select id="dcim-cable-rack">' + rackOptions + "</select></label>" +
    '<button type="button" class="act primary" data-act="dcim-cable-show">Show ports</button>' +
    '<button type="button" class="act" data-act="dcim-cables">Export CSV</button>' +
    '<label class="act file">Import CSV<input type="file" accept=".csv,text/csv" data-csv-cables="1"></label></div>' +
    (counts ? "<p>" + esc(rack) + " · " + esc(counts) + "</p>" : "") +
    issues +
    (devices.length ? '<label>Device<select id="dcim-cable-device">' + deviceOptions + "</select></label>" : (map ? "<p>This rack has no device ports yet.</p>" : "<p>Choose a rack to see its ports.</p>")) +
    (near ? '<div class="dcim-tools"><p>Tracking ' + esc(near.name) + '.</p><label>Other end<select id="dcim-cable-far">' + farPorts.join("") + "</select></label>" +
      '<label>Length m<input id="dcim-cable-length" type="number" min="0" step="0.1" value="2"></label>' +
      '<label>Color<input id="dcim-cable-color" value="blue"></label>' +
      '<button type="button" class="act primary" data-act="dcim-cable-save">Save cable</button>' +
      '<button type="button" class="act" data-act="dcim-cable-cancel">Cancel</button></div>' : "") +
    (rows ? '<table><thead><tr><th>Port</th><th>Kind</th><th>Speed</th><th>Media</th><th>Status</th><th>Cable</th><th></th></tr></thead><tbody>' + rows + "</tbody></table>" : "") +
    (hops ? "<h3>Trace</h3><ol>" + hops + "</ol>" : "");
}

function portRow(port, nearId) {
  const cable = port.cable
    ? esc(port.cable.label) + " · " + esc(port.cable.lengthM) + " m · " + esc(port.cable.color) + " · " + esc(port.cable.farName)
    : "Not tracked";
  let buttons = "";
  if (port.status !== "used") {
    buttons += '<button type="button" class="act' + (port.id === nearId ? " primary" : "") + '" data-act="dcim-cable-near" data-port="' + esc(port.id) + '">Track</button>';
  }
  if (port.status === "free") buttons += '<button type="button" class="act" data-act="dcim-cable-reserve" data-port="' + esc(port.id) + '">Reserve</button>';
  if (port.status === "reserved") buttons += '<button type="button" class="act" data-act="dcim-cable-free" data-port="' + esc(port.id) + '">Release</button>';
  if (port.cable) {
    buttons += '<button type="button" class="act" data-act="dcim-trace" data-port="' + esc(port.id) + '">Trace</button>';
    buttons += '<button type="button" class="act" data-act="dcim-cable-drop" data-id="' + esc(port.cable.id) + '">Drop</button>';
  }
  return "<tr><td>" + esc(port.name) + "</td><td>" + esc(port.kind) + "</td><td>" + esc(port.speed) + "</td><td>" + esc(port.media) +
    "</td><td>" + esc(port.status) + "</td><td>" + cable + "</td><td>" + buttons + "</td></tr>";
}

function work(slot) {
  const orders = slot.work || [];
  const rows = orders.map((order) => {
    const tasks = (order.tasks || []).map((task) => esc(task.model_id || task.asset_id || "task") + " · " + esc(task.rack_id || "") + " · " + esc(task.expected || "")).join("; ");
    return "<tr><td>" + esc(order.id) + (tasks ? "<br><span class=\"fine\">" + tasks + "</span>" : "") + "</td><td>" + esc(order.kind) + "</td><td>" + esc(order.state) +
      "</td><td>" + actions(order) + "</td></tr>";
  }).join("");
  const diff = slot.diff;
  const changes = diff && diff.changes ? diff.changes.map((change) => "<li>" + esc(change.op) + " " + esc(change.modelId || change.model_id || "") + " at " + esc(change.rackId || "") + " U" + esc(change.uPosition || "") + "</li>").join("") : "";
  const compared = diff ? "<p>Now " + watts(diff.nowW) + " · future " + watts(diff.futureW) + " · delta " + watts(diff.deltaW) +
    ". Space " + esc(diff.freeUDelta) + "U · ports " + esc(diff.portsDelta) + " · heat " + watts(diff.heatDeltaW) +
    " · cooling headroom " + watts(diff.coolingHeadroomFutureW) + ". " + esc(diff.redundancy || "") +
    (diff.targetOn ? " Target " + esc(diff.targetOn) + "." : "") + "</p><ul>" + changes + "</ul>" : "";
  const kinds = ["Install", "Move", "Decommission", "Power cycle", "Cable change", "Firmware"].map((kind) => '<option>' + kind + "</option>").join("");
  return "<h2>Scenarios and work orders</h2><p>Promote creates a submitted work order. The asset changes when an administrator verifies it. Future shows the plan beside the live floor.</p>" +
    (slot.scenarioId ? "<p>Scenario <b>" + esc(slot.scenarioId) + "</b></p>" : "") +
    '<div class="dcim-tools"><button type="button" class="act primary" data-act="dcim-promote">Promote scenario</button>' +
    '<button type="button" class="act" data-act="dcim-diff">Compare now and future</button></div>' +
    compared +
    '<div class="dcim-tools"><label>Target date<input id="dcim-target" type="date"></label><label>Change<select id="dcim-op"><option>add</option><option>move</option><option>remove</option><option>change</option></select></label>' +
    '<label>Model<input id="dcim-change-model" value="dell-r760"></label><label>Rack<input id="dcim-change-rack" value="H3-07"></label>' +
    '<label>U<input id="dcim-change-u" type="number" value="1"></label><button type="button" class="act" data-act="dcim-change">Add to scenario</button></div>' +
    '<div class="dcim-tools"><label>New work order<select id="dcim-wo-kind">' + kinds + "</select></label><label>Port or device<input id=\"dcim-wo-port\" placeholder=\"tray-06\"></label>" +
    '<button type="button" class="act" data-act="dcim-wo-new">Create draft</button></div>' +
    '<table><thead><tr><th>Work order</th><th>Kind</th><th>State</th><th></th></tr></thead><tbody>' +
    (rows || "<tr><td colspan=\"4\">No work orders yet.</td></tr>") + "</tbody></table>";
}

function actions(order) {
  const admin = state.user && state.user.role === "Administrator";
  const next = {
    Draft: ["Submitted"],
    Submitted: ["Approved", "Rejected"],
    Approved: ["Scheduled", "Verified"],
    Scheduled: ["In progress"],
    "In progress": ["Verified"],
    Verified: ["Closed"],
  }[order.state] || [];
  const allowed = next.filter((to) => admin || (to !== "Approved" && to !== "Rejected" && to !== "Verified" && to !== "Closed"));
  return allowed.map((to) => '<button type="button" class="act" data-act="dcim-advance" data-id="' + esc(order.id) + '" data-to="' + to + '">' + to + "</button>").join(" ") +
    ' <button type="button" class="act" data-act="dcim-snow" data-id="' + esc(order.id) + '">ServiceNow</button>';
}

function monitor(slot) {
  const rows = (slot.alarms || []).map((alarm) => {
    const device = deviceById(alarm.device_id);
    const serial = device && device.rack === "A14"
      ? '<button type="button" class="act" data-act="dcim-console" data-device="' + esc(alarm.device_id) + '">ACS serial</button>'
      : "";
    return "<tr><td>P" + esc(alarm.priority) + "</td><td>" + esc(alarm.state) +
      "</td><td>" + esc(alarm.text) + "</td><td>" + esc(alarm.action || "") + " " + serial + "</td><td>" +
      (alarm.state === "open" ? '<button type="button" class="act" data-act="dcim-ack" data-id="' + esc(alarm.id) + '">Ack</button>' : esc(alarm.ack_user || "")) +
      "</td></tr>";
  }).join("");
  const trend = (slot.trend || []).map((point) => '<i style="height:' + Math.max(4, Math.min(48, Number(point.value) || 0)) + 'px" title="' + esc(point.value) + " " + esc(point.unit) + '"></i>').join("");
  return "<h2>Alarms</h2><p>Collectors for the lab, Redfish, SNMP, ACS, Modbus, and BACnet normalize into one series. A repeated reading does not open a second alarm, an in-progress work order suppresses it, and a healthy reading clears it. An A14 alarm can open ACS serial.</p>" +
    '<div class="dcim-tools"><button type="button" class="act" data-act="dcim-collect" data-source="lab">Collect lab</button>' +
    '<button type="button" class="act" data-act="dcim-collect" data-source="redfish">Sample Redfish inlet</button>' +
    '<button type="button" class="act" data-act="dcim-collect" data-source="acs">ACS watch</button>' +
    '<button type="button" class="act" data-act="dcim-collect" data-source="snmp">Bus A</button>' +
    '<button type="button" class="act" data-act="dcim-collect" data-source="bacnet">CDU</button>' +
    '<label>Trend<input id="dcim-trend-device" value="' + esc(slot.trendDevice || "tray-01") + '"></label><button type="button" class="act" data-act="dcim-trend">Trend</button></div>' +
    (trend ? '<div class="dcim-bars">' + trend + "</div>" : "") +
    '<table><thead><tr><th>Priority</th><th>State</th><th>Text</th><th>Action</th><th></th></tr></thead><tbody>' +
    (rows || "<tr><td colspan=\"5\">No alarms.</td></tr>") + "</tbody></table>";
}

function chartOf(table, rows) {
  if (!table || !rows || !rows.length) return null;
  if (table.chart) return { key: table.chart, rows: rows };
  if (table.kind === "inventory") {
    const counts = {};
    rows.forEach((row) => { const hall = row.hall || "Other"; counts[hall] = (counts[hall] || 0) + 1; });
    return { key: "assets", rows: Object.keys(counts).map((hall) => ({ hall: hall, assets: counts[hall] })) };
  }
  if (table.kind === "alarms") {
    const counts = {};
    rows.forEach((row) => { const priority = "P" + (row.priority == null ? "" : row.priority); counts[priority] = (counts[priority] || 0) + 1; });
    return { key: "count", rows: Object.keys(counts).map((priority) => ({ priority: priority, count: counts[priority] })) };
  }
  if (table.kind === "audit") {
    const counts = {};
    rows.forEach((row) => { const action = row.action || "other"; counts[action] = (counts[action] || 0) + 1; });
    return { key: "count", rows: Object.keys(counts).map((action) => ({ action: action, count: counts[action] })) };
  }
  if (table.kind === "sla") return { key: "open", rows: rows };
  return null;
}

function filteredRows(slot) {
  const table = slot.report;
  const rows = table && table.rows ? table.rows : [];
  const filter = slot.inventoryFilter;
  if (!table || table.kind !== "inventory" || !filter) return rows;
  return rows.filter((row) => {
    if (filter.hall && String(row.hall || "").toLowerCase().indexOf(filter.hall.toLowerCase()) < 0) return false;
    if (filter.vendor && String(row.vendor || row.model || "").toLowerCase().indexOf(filter.vendor.toLowerCase()) < 0) return false;
    if (filter.lifecycle && String(row.lifecycle || "").toLowerCase().indexOf(filter.lifecycle.toLowerCase()) < 0) return false;
    if (filter.warranty && !row.warrantySoon) return false;
    return true;
  });
}

export function applyInventoryFilter() {
  const hall = document.getElementById("dcim-filter-hall") as HTMLInputElement | null;
  const vendor = document.getElementById("dcim-filter-vendor") as HTMLInputElement | null;
  const life = document.getElementById("dcim-filter-life") as HTMLInputElement | null;
  const warranty = document.getElementById("dcim-filter-warranty") as HTMLInputElement | null;
  dcim().inventoryFilter = {
    hall: hall ? hall.value.trim() : "",
    vendor: vendor ? vendor.value.trim() : "",
    lifecycle: life ? life.value.trim() : "",
    warranty: !!(warranty && warranty.checked),
  };
  render();
}

function reports(slot) {
  const table = slot.report;
  const filtered = filteredRows(slot);
  const rows = table && table.kind === "inventory"
    ? filtered.map((row) => "<tr><td>" + esc(row.tag) + "</td><td>" + esc(row.vendor) + "</td><td>" + esc(row.model) +
      "</td><td>" + esc(row.hall || "") + "</td><td>" + esc(row.lifecycle) + "</td></tr>").join("")
    : filtered.slice(0, 8).map((row) => "<tr><td>" + esc(row.tag || row.hall || row.period || row.priority || "") + "</td><td>" + esc(JSON.stringify(row)).slice(0, 180) + "</td></tr>").join("");
  const chart = chartOf(table, filtered);
  const widest = chart ? Math.max.apply(null, chart.rows.map((row) => Number(row[chart.key]) || 0).concat([1])) : 1;
  const bars = chart ? chart.rows.slice(0, 10).map((row) => {
    const value = Number(row[chart.key]) || 0;
    return "<div><span>" + esc(row.hall || row.period || row.priority || row.action || "") + "</span><b style=\"width:" + Math.max(8, Math.round((value / widest) * 240)) + "px\"></b></div>";
  }).join("") : "";
  const inventory = table && table.kind === "inventory"
    ? '<div class="dcim-tools"><label>Hall<input id="dcim-filter-hall" placeholder="Hall 3"></label><label>Vendor<input id="dcim-filter-vendor" placeholder="Dell"></label>' +
      '<label>Lifecycle<input id="dcim-filter-life" placeholder="In service"></label><label>Warranty<input id="dcim-filter-warranty" type="checkbox"> 90 days</label>' +
      '<button type="button" class="act" data-act="dcim-filter">Filter</button></div>'
    : "";
  return "<h2>Reports</h2><div class=\"dcim-tools\">" +
    ["inventory", "capacity", "energy", "alarms", "sla", "audit"].map((kind) => '<button type="button" class="act" data-act="dcim-report" data-kind="' + kind + '">' + kind + "</button>").join("") +
    '<button type="button" class="act" data-act="dcim-csv">CSV</button><button type="button" class="act" data-act="dcim-pdf">PDF</button>' +
    '<button type="button" class="act" data-act="dcim-schedule">Schedule daily</button></div>' + inventory +
    ((slot.schedules || []).length ? "<p>Scheduled: " + slot.schedules.map((item) => esc(item.cadence) + " " + esc(item.kind)).join(", ") + ".</p>" : "") +
    (slot.capacity && slot.capacity.pue ? '<p class="dcim-pue">PUE ' + esc(slot.capacity.pue) + ". Facility kW is IT kW plus 5% auxiliaries.</p>" : "") +
    (bars ? '<div class="dcim-chart">' + bars + "</div>" : "") +
    (rows ? "<div class=\"table-wrap\"><table>" + (table && table.kind === "inventory" ? "<thead><tr><th>Tag</th><th>Vendor</th><th>Model</th><th>Where</th><th>Lifecycle</th></tr></thead>" : "") + "<tbody>" + rows + "</tbody></table></div>" : "");
}

function discovery(slot) {
  const rows = (slot.discovery || []).map((item) => "<tr><td>" + esc(item.kind) + "</td><td>" + esc(item.state) + "</td><td>" + esc(item.detail) +
    "</td><td>" + (item.state === "pending"
      ? '<button type="button" class="act" data-act="dcim-decide" data-id="' + esc(item.id) + '" data-accept="1">Accept</button><button type="button" class="act" data-act="dcim-decide" data-id="' + esc(item.id) + '" data-accept="0">Reject</button>'
      : "") +
    "</td></tr>").join("");
  return "<h2>Discovery</h2><p>Redfish, SNMP, and ACS compare what they see with the repository. Accept or reject writes an audit row. A tag scan checks the recorded rack and U.</p>" +
    '<div class="dcim-tools"><button type="button" class="act" data-act="dcim-sweep">Sample sweep</button>' +
    '<button type="button" class="act" data-act="dcim-missing">Tray 08 not seen</button></div>' +
    '<div class="dcim-tools"><label>Tag or QR<input id="dcim-scan-tag" value="tray-01" placeholder="tray-01|A14|40"></label><label>Rack<input id="dcim-scan-rack" value="A14"></label><label>U<input id="dcim-scan-u" type="number" value="40"></label>' +
    '<button type="button" class="act" data-act="dcim-scan">Confirm scan</button></div>' +
    (slot.scan ? "<p>" + esc(slot.scan) + "</p>" : "") +
    "<table><tbody>" + (rows || "<tr><td>No discoveries.</td></tr>") + "</tbody></table>";
}

function watts(value) {
  if (value == null || value === "") return "—";
  if (value >= 1000000) return (value / 1000000).toFixed(2) + " MW";
  if (value >= 1000) return (value / 1000).toFixed(1) + " kW";
  return value + " W";
}

export async function findHome() {
  const model = (document.getElementById("dcim-model") as HTMLSelectElement | null);
  const hall = (document.getElementById("dcim-hall") as HTMLSelectElement | null);
  const response = await fetch("/api/v1/capacity/home", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ modelId: model ? model.value : "dell-r760", quantity: 1, hallId: hall ? hall.value : "hall-3" }),
  });
  const body = await readJson(response);
  dcim().home = body;
  dcim().note = response.ok ? "Homes that fit the model." : (body.error || "Find a home failed.");
  render();
}

export async function planHome(rackId) {
  const hit = ((dcim().home && dcim().home.placements) || []).find((item) => item.rackId === rackId);
  if (!hit) return;
  const response = await fetch("/api/v1/scenarios", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      name: "Install R760 at " + rackId,
      targetOn: "2026-12-01",
      change: { op: "add", modelId: "dell-r760", rackId, uPosition: hit.uPosition, detail: "Find a home" },
    }),
  });
  const body = await readJson(response);
  dcim().scenarioId = body.id || "";
  dcim().tab = "work";
  dcim().note = response.ok ? "Scenario " + body.id + " plans " + rackId + ". The asset is not installed yet." : (body.error || "Scenario was refused.");
  render();
}

export async function promoteScenario() {
  const id = dcim().scenarioId;
  if (!id) {
    dcim().note = "Add a rack to a scenario first.";
    render();
    return;
  }
  const response = await fetch("/api/v1/scenarios/" + encodeURIComponent(id) + "/promote", { method: "POST", headers: authHeaders(), body: "{}" });
  const body = await readJson(response);
  dcim().workId = body.workOrderId || "";
  dcim().note = response.ok ? "Work order " + body.workOrderId + " is submitted." : (body.error || "Promote was refused.");
  await refreshDcim();
  dcim().tab = "work";
  render();
}

export async function advanceWork(id, to) {
  const response = await fetch("/api/v1/work-orders/" + encodeURIComponent(id) + "/advance", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ to }),
  });
  const body = await readJson(response);
  dcim().note = response.ok ? id + " is " + body.state + "." : (body.error || "That move was refused.");
  await refreshDcim();
  dcim().tab = "work";
  render();
}

async function reloadCableMap() {
  const rackId = dcim().cableRack || "A14";
  const response = await fetch("/api/v1/racks/" + encodeURIComponent(rackId) + "/ports", { cache: "no-store" });
  const body = await readJson(response);
  if (!response.ok) {
    dcim().map = null;
    dcim().note = body.error || "That rack has no port map.";
    return;
  }
  dcim().map = body;
  const devices = body.devices || [];
  if (!devices.some((item) => item.assetId === dcim().cableDevice) && devices[0]) dcim().cableDevice = devices[0].assetId;
}

export async function showCableRack() {
  const hall = document.getElementById("dcim-cable-hall") as HTMLSelectElement | null;
  const rack = document.getElementById("dcim-cable-rack") as HTMLSelectElement | null;
  dcim().cableHall = hall ? hall.value : (dcim().cableHall || "1");
  dcim().cableRack = rack ? rack.value : (dcim().cableRack || "A14");
  dcim().cableDevice = "";
  dcim().nearPort = "";
  dcim().trace = [];
  await reloadCableMap();
  dcim().tab = "cables";
  dcim().note = dcim().map ? "Ports for " + dcim().cableRack + ". Track a cable only where you want one recorded." : dcim().note;
  render();
}

export function chooseCablePort(portId) {
  dcim().nearPort = portId;
  dcim().tab = "cables";
  render();
}

export function cancelCable() {
  dcim().nearPort = "";
  render();
}

export async function saveCable() {
  const far = document.getElementById("dcim-cable-far") as HTMLSelectElement | null;
  const length = document.getElementById("dcim-cable-length") as HTMLInputElement | null;
  const color = document.getElementById("dcim-cable-color") as HTMLInputElement | null;
  const response = await fetch("/api/v1/connections", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      aPort: dcim().nearPort,
      bPort: far ? far.value : "",
      lengthM: length ? Number(length.value) : 1,
      color: color ? color.value : "black",
    }),
  });
  const body = await readJson(response);
  const flagged = body.issues && body.issues.length ? " " + body.issues.map((item) => item.issue).join(", ") + " flagged." : "";
  dcim().note = response.ok ? "Tracked " + (body.label || "cable") + "." + flagged : (body.error || "The cable was not saved.");
  if (response.ok) dcim().nearPort = "";
  await reloadCableMap();
  dcim().tab = "cables";
  render();
}

export async function dropCable(cableId) {
  const response = await fetch("/api/v1/connections/" + encodeURIComponent(cableId) + "/drop", { method: "POST", headers: authHeaders(), body: "{}" });
  const body = await readJson(response);
  dcim().note = response.ok ? "Cable dropped. The ports are free again." : (body.error || "The cable stayed.");
  await reloadCableMap();
  dcim().tab = "cables";
  render();
}

export async function reservePort(portId, status) {
  const response = await fetch("/api/v1/ports/" + encodeURIComponent(portId) + "/status", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ status }),
  });
  const body = await readJson(response);
  dcim().note = response.ok ? "Port is " + status + "." : (body.error || "The port was not changed.");
  await reloadCableMap();
  dcim().tab = "cables";
  render();
}

export async function traceCable(portId) {
  const response = await fetch("/api/v1/ports/" + encodeURIComponent(portId || "port-tray-01-serial") + "/trace", { cache: "no-store" });
  const body = await readJson(response);
  dcim().trace = body.trace || [];
  dcim().tab = "cables";
  dcim().note = (dcim().trace || []).map((hop) => hop.name).join(" → ");
  render();
}

export async function exportCables() {
  const response = await fetch("/api/v1/connections", { headers: { Accept: "text/csv" } });
  const body = await readJson(response);
  const file = new Blob([body.csv || ""], { type: "text/csv" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = "cables.csv";
  link.click();
  URL.revokeObjectURL(url);
  dcim().note = "Cable CSV downloaded.";
  render();
}

export async function importCables(file) {
  const csv = await file.text();
  const response = await fetch("/api/v1/connections/import", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ csv }),
  });
  const body = await readJson(response);
  dcim().note = response.ok ? "Imported " + ((body.imported || []).length) + " cables." : (body.error || "Import was refused.");
  if (dcim().cableRack) await reloadCableMap();
  dcim().tab = "cables";
  render();
}

export async function openReport(kind, format) {
  dcim().reportKind = kind || dcim().reportKind || "capacity";
  const suffix = format === "csv" ? ".csv" : format === "pdf" ? ".pdf" : "";
  const response = await fetch("/api/v1/reports/" + dcim().reportKind + suffix, { cache: "no-store" });
  const body = await readJson(response);
  if (format === "csv") dcim().note = (body.csv || "").split("\n").slice(0, 2).join(" ");
  else if (format === "pdf") dcim().note = body.pdf ? "PDF ready (" + body.pdf.length + " characters)." : "No PDF.";
  else dcim().report = body;
  render();
}

export async function loadAlarms() {
  const response = await fetch("/api/v1/alarms", { cache: "no-store" });
  const body = await readJson(response);
  dcim().alarms = body.alarms || [];
  dcim().tab = "monitor";
  render();
}

export async function ackAlarm(id) {
  await fetch("/api/v1/alarms/" + encodeURIComponent(id) + "/ack", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ note: "Seen from the DCIM monitor." }),
  });
  await refreshDcim();
  dcim().tab = "monitor";
  render();
}

export async function decideDiscovery(id, accept) {
  const response = await fetch("/api/v1/discovery/" + encodeURIComponent(id) + "/decide", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ accept: accept !== false && accept !== "0" }),
  });
  const body = await readJson(response);
  dcim().note = response.ok ? "Discovery " + body.state + "." : (body.error || "Decision was refused.");
  await refreshDcim();
  dcim().tab = "discovery";
  render();
}

export async function openHall(hallId) {
  const response = await fetch("/api/v1/capacity/hall/" + encodeURIComponent(hallId), { cache: "no-store" });
  dcim().scope = await readJson(response);
  dcim().tab = "capacity";
  render();
}

export async function openRackCapacity(rackId) {
  const response = await fetch("/api/v1/capacity/rack/" + encodeURIComponent(rackId), { cache: "no-store" });
  dcim().scope = await readJson(response);
  dcim().tab = "capacity";
  render();
}

export async function compareScenario() {
  const id = dcim().scenarioId;
  if (!id) {
    dcim().note = "Add a rack to a scenario first.";
    render();
    return;
  }
  const response = await fetch("/api/v1/scenarios/" + encodeURIComponent(id) + "/diff", { cache: "no-store" });
  const body = await readJson(response);
  dcim().diff = response.ok ? body : null;
  runtime.futureChanges = body.changes || [];
  dcim().note = response.ok ? "Future is " + watts(body.futureW) + " against " + watts(body.nowW) + " now." : (body.error || "No diff.");
  dcim().tab = "work";
  render();
}

export async function addScenarioChange() {
  const id = dcim().scenarioId;
  if (!id) {
    dcim().note = "Create a scenario from Find a home first.";
    render();
    return;
  }
  const op = document.getElementById("dcim-op") as HTMLSelectElement | null;
  const model = document.getElementById("dcim-change-model") as HTMLInputElement | null;
  const rack = document.getElementById("dcim-change-rack") as HTMLInputElement | null;
  const u = document.getElementById("dcim-change-u") as HTMLInputElement | null;
  const target = document.getElementById("dcim-target") as HTMLInputElement | null;
  const response = await fetch("/api/v1/scenarios/" + encodeURIComponent(id) + "/changes", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ op: op ? op.value : "add", modelId: model ? model.value : "", rackId: rack ? rack.value : "", uPosition: u ? Number(u.value) : 1, targetOn: target ? target.value : "" }),
  });
  const body = await readJson(response);
  dcim().diff = response.ok ? body : dcim().diff;
  runtime.futureChanges = body.changes || runtime.futureChanges;
  dcim().note = response.ok ? "Scenario change recorded. Promote still creates the work order." : (body.error || "The change was refused.");
  dcim().tab = "work";
  render();
}

export async function createWorkOrder() {
  const kind = document.getElementById("dcim-wo-kind") as HTMLSelectElement | null;
  const port = document.getElementById("dcim-wo-port") as HTMLInputElement | null;
  const response = await fetch("/api/v1/work-orders", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ kind: kind ? kind.value : "Install", title: (kind ? kind.value : "Work") + " " + (port ? port.value : ""), deviceId: port ? port.value : "", expected: port ? port.value : "" }),
  });
  const body = await readJson(response);
  dcim().note = response.ok ? "Draft " + body.id + " created." : (body.error || "The work order was refused.");
  await refreshDcim();
  dcim().tab = "work";
  render();
}

export async function collectSample(source) {
  const presets = {
    redfish: [{ deviceId: "tray-01", name: "inlet", value: 29, unit: "C" }],
    acs: [{ deviceId: "tray-01", name: "serial", value: 1, unit: "up" }],
    snmp: [{ deviceId: "bus-a", name: "power", value: 60, unit: "%" }],
    bacnet: [{ deviceId: "cdu-1", name: "inlet", value: 20, unit: "C" }],
  };
  const samples = presets[source] || [];
  const response = await fetch("/api/v1/collect", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ source, samples }),
  });
  const body = await readJson(response);
  if (samples[0]) dcim().trendDevice = samples[0].deviceId;
  dcim().note = response.ok ? source + " collector stored " + ((body.alarms || []).filter(Boolean).length) + " alarm." : (body.error || "Collector refused the sample.");
  await refreshDcim();
  if (samples[0]) {
    const trend = await fetch("/api/v1/metrics/" + encodeURIComponent(samples[0].deviceId), { cache: "no-store" });
    const series = await readJson(trend);
    dcim().trend = series.metrics || [];
  }
  dcim().tab = "monitor";
  render();
}

export async function loadFuturePlan() {
  if (state.horizon !== "future") return;
  const response = await fetch("/api/v1/scenarios", { cache: "no-store" });
  const body = await readJson(response);
  const scenarios = body.scenarios || [];
  const active = scenarios[scenarios.length - 1];
  if (!active) {
    runtime.futureChanges = [];
    if (state.horizon === "future") render();
    return;
  }
  const diffResponse = await fetch("/api/v1/scenarios/" + encodeURIComponent(active.id) + "/diff", { cache: "no-store" });
  const diff = await readJson(diffResponse);
  if (state.horizon !== "future") return;
  runtime.futureChanges = diff.changes || [];
  dcim().scenarioId = active.id;
  dcim().diff = diffResponse.ok ? diff : null;
  render();
}

export async function reportMissing() {
  const response = await fetch("/api/v1/discovery/run", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ found: [{ source: "acs", assetTag: "tray-08", kind: "missing", detail: "ACS did not answer on ttyS10." }] }),
  });
  const body = await readJson(response);
  dcim().discovery = body.items || [];
  dcim().note = response.ok ? "Tray 08 is queued as missing. The rest of the campus stays recorded." : (body.error || "The sweep failed.");
  dcim().tab = "discovery";
  render();
}

export async function loadTrend() {
  const field = document.getElementById("dcim-trend-device") as HTMLInputElement | null;
  const deviceId = field && field.value.trim() ? field.value.trim() : "tray-01";
  const response = await fetch("/api/v1/metrics/" + encodeURIComponent(deviceId), { cache: "no-store" });
  const body = await readJson(response);
  dcim().trend = body.metrics || [];
  dcim().tab = "monitor";
  render();
}

export async function scheduleReport() {
  const response = await fetch("/api/v1/reports/schedules", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ kind: dcim().reportKind || "capacity", cadence: "daily" }),
  });
  const body = await readJson(response);
  dcim().note = response.ok ? "Daily " + (dcim().reportKind || "capacity") + " report scheduled." : (body.error || "Schedule was refused.");
  await refreshDcim();
  dcim().tab = "reports";
  render();
}

export async function sendServiceNow(workId) {
  const response = await fetch("/api/v1/integrations/servicenow", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ workOrderId: workId }),
  });
  const body = await readJson(response);
  dcim().note = response.ok ? workId + " mapped to " + body.number + ". The stub does not call ServiceNow." : (body.error || "ServiceNow stub refused the work order.");
  dcim().tab = "work";
  render();
}

export async function sampleSweep() {
  const response = await fetch("/api/v1/discovery/run", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      found: [
        { source: "redfish", assetTag: "BMC-NEW", detail: "BMC replied and is not in the repository." },
        { source: "redfish", assetTag: "tray-01", serial: "SN-MISMATCH" },
        { source: "acs", assetTag: "tray-02", rackId: "H3-07", detail: "ACS port map places this tray in another rack." },
      ],
    }),
  });
  const body = await readJson(response);
  dcim().discovery = body.items || [];
  dcim().note = response.ok ? "Sweep queued " + ((body.created || []).length) + " differences." : (body.error || "Sweep failed.");
  dcim().tab = "discovery";
  render();
}

export async function scanAsset() {
  const tag = document.getElementById("dcim-scan-tag") as HTMLInputElement | null;
  const rack = document.getElementById("dcim-scan-rack") as HTMLInputElement | null;
  const u = document.getElementById("dcim-scan-u") as HTMLInputElement | null;
  const raw = tag && tag.value.trim() ? tag.value.trim() : "tray-01";
  const parts = raw.split("|").map((item) => item.trim());
  const assetTag = parts.length === 3 ? parts[0] : raw;
  const rackId = parts.length === 3 ? parts[1] : (rack ? rack.value : "A14");
  const uPosition = parts.length === 3 ? Number(parts[2]) : (u ? Number(u.value) : 40);
  const response = await fetch("/api/v1/discovery/audit", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ assetTag, rackId, uPosition }),
  });
  const body = await readJson(response);
  const scanned = assetTag + " at " + rackId + " U" + uPosition;
  dcim().scan = body.ok ? scanned + " matches the repository." : (body.issue || "The scan did not match.");
  render();
}
