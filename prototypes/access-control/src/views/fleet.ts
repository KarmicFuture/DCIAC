import { PLANT, PODS, deviceRackId, entityById, heatBand, rackEntities, worstBand } from "../data/pods";
import { deviceById } from "../data/devices";
import { activeAlarms } from "../ui/alarms";
import { impact } from "../domain/events";
import { runtime } from "../state";
import { esc } from "../ui/format";

export type HallSummary = {
  id: string;
  name: string;
  racks: number;
  hot: number;
  critical: number;
  alarms: number;
  worst: number;
  itKw: number;
  capKw: number;
  feed: string;
};

/* The hall an alarm belongs to. Devices on ACS-A14 carry no pod, so they sit in
   the managed hall. */
function alarmHall(alarm) {
  const entity = alarm.device ? entityById(alarm.device) : null;
  if (entity && entity.pod) return entity.pod;
  const managed = PODS.find((pod) => pod.managed);
  return managed ? managed.id : "";
}

export type RackSummary = {
  id: string;
  name: string;
  kw: number;
  alarms: number;
  worst: number;
  band: string;
};

/* Which hall's racks are listed under its row, and how they are sorted. */
const drill = { podId: "", sort: "power" };

export function setFleetDrill(podId: string, sort?: string) {
  drill.podId = podId;
  if (sort === "power" || sort === "alarms") drill.sort = sort;
}

export function drillOpenHall() {
  return drill.podId;
}

export function toggleFleetRacks(podId: string) {
  drill.podId = drill.podId === podId ? "" : podId;
}

/* The rack an alarm belongs to. ACS-A14 devices carry no rack, so they sit in A14. */
function alarmRack(alarm) {
  const entity = alarm.device ? entityById(alarm.device) : null;
  if (entity && entity.rack) return entity.rack;
  return alarm.device && deviceById(alarm.device) ? deviceRackId(alarm.device) : "";
}

export function rackSummary(podId: string, sort = drill.sort): RackSummary[] {
  const pod = PODS.find((item) => item.id === podId);
  if (!pod) return [];
  const alarms = activeAlarms().filter((alarm) => alarmHall(alarm) === podId);
  const list = (pod.racks || []).map((rack) => {
    const mine = alarms.filter((alarm) => alarmRack(alarm) === rack.id);
    return {
      id: rack.id,
      name: rack.name || rack.id,
      kw: rackKw(rack),
      alarms: mine.length,
      worst: mine.length ? Math.min(...mine.map((alarm) => alarm.pri)) : 0,
      band: worstBand(rackEntities(rack)),
    };
  });
  const byPower = (a, b) => b.kw - a.kw;
  const byAlarms = (a, b) => (b.alarms ? 1 : 0) - (a.alarms ? 1 : 0) ||
    (a.worst || 9) - (b.worst || 9) || b.alarms - a.alarms || byPower(a, b);
  return list.sort(sort === "alarms" ? byAlarms : byPower);
}

function rackKw(rack) {
  const list = rackEntities(rack).filter((entity) => entity.load);
  if (!list.length) return 0;
  const avg = list.reduce((sum, entity) => sum + (entity.load.power || 0), 0) / list.length;
  return (PLANT.kwPerRack * avg) / 100;
}

/* The hall's power feed under the simulator: normal, at risk (redundancy gone or
   on the affected path), or lost. */
function feedState(report, hallId) {
  if (!report || !report.active || !report.affected || !report.affected[hallId]) return "normal";
  return report.loadLost ? "lost" : "risk";
}

export function fleetSummary(): HallSummary[] {
  const alarms = activeAlarms();
  const report = impact(runtime.sim);
  return PODS.map((pod) => {
    const racks = pod.racks || [];
    let hot = 0;
    let critical = 0;
    let itKw = 0;
    racks.forEach((rack) => {
      const bands = rackEntities(rack).map(heatBand);
      if (bands.some((band) => band === "critical" || band === "failover")) critical += 1;
      else if (bands.indexOf("near") >= 0) hot += 1;
      itKw += rackKw(rack);
    });
    const mine = alarms.filter((alarm) => alarmHall(alarm) === pod.id);
    return {
      id: pod.id,
      name: pod.name || pod.id,
      racks: racks.length,
      hot,
      critical,
      alarms: mine.length,
      worst: mine.length ? Math.min(...mine.map((alarm) => alarm.pri)) : 0,
      itKw,
      capKw: racks.length * PLANT.kwPerRack,
      feed: feedState(report, pod.id),
    };
  });
}

function mw(kw) {
  return (kw / 1000).toFixed(2) + " MW";
}

function pct(part, whole) {
  return whole ? Math.round((part / whole) * 100) : 0;
}

function alarmCell(hall: HallSummary) {
  if (!hall.alarms) return '<span class="fleet-clear">Clear</span>';
  return '<span class="pri-mark pri-' + hall.worst + '" aria-hidden="true">' + hall.worst + "</span> " +
    hall.alarms + " · worst P" + hall.worst;
}

const BAND_LABEL = { ok: "Normal", near: "Near limit", critical: "Critical", failover: "BMC dark" };

function rackDrill(hall: HallSummary) {
  const racks = rackSummary(hall.id);
  const sortBtn = (key, label) => '<button type="button" class="act" data-act="fleet-sort" data-sort="' + key + '" aria-pressed="' +
    (drill.sort === key) + '">' + label + "</button>";
  const rows = racks.map((rack) => '<tr data-rack="' + esc(rack.id) + '">' +
    '<td><button type="button" class="act" data-act="floor-rack" data-pod="' + esc(hall.id) + '" data-rack="' + esc(rack.id) + '">' + esc(rack.name) + "</button></td>" +
    '<td data-col="alarms">' + (rack.alarms ? '<span class="pri-mark pri-' + rack.worst + '" aria-hidden="true">' + rack.worst + "</span> " +
      rack.alarms + " · worst P" + rack.worst : '<span class="fleet-clear">Clear</span>') + "</td>" +
    '<td data-col="power" data-kw="' + rack.kw.toFixed(1) + '">' + rack.kw.toFixed(1) + " of " + PLANT.kwPerRack + " kW · " + pct(rack.kw, PLANT.kwPerRack) + "%</td>" +
    '<td data-col="heat"><span class="fleet-band ' + rack.band + '">' + (BAND_LABEL[rack.band] || rack.band) + "</span></td></tr>").join("");
  return '<tr class="fleet-racks-row" data-racks-for="' + esc(hall.id) + '"><td colspan="5">' +
    '<div class="fleet-sort" role="group" aria-label="Sort racks">Sort by ' + sortBtn("power", "Power") + sortBtn("alarms", "Alarms") + "</div>" +
    '<div class="table-wrap"><table class="fleet-rack-table"><thead><tr><th>Rack</th><th>Alarms</th><th>IT power</th><th>Heat</th></tr></thead><tbody>' +
    rows + "</tbody></table></div></td></tr>";
}

function simNote() {
  const report = impact(runtime.sim);
  if (!report || !report.active || !report.summary) return "";
  return '<p class="fleet-sim" role="status">Simulation: ' + esc(report.summary) + "</p>";
}

export function renderFleet() {
  const halls = fleetSummary();
  const total = halls.reduce((acc, hall) => ({
    racks: acc.racks + hall.racks,
    alarms: acc.alarms + hall.alarms,
    critical: acc.critical + hall.critical,
    itKw: acc.itKw + hall.itKw,
    capKw: acc.capKw + hall.capKw,
  }), { racks: 0, alarms: 0, critical: 0, itKw: 0, capKw: 0 });
  if (drill.podId && !halls.some((hall) => hall.id === drill.podId)) drill.podId = "";
  const rows = halls.map((hall) => {
    const open = drill.podId === hall.id;
    const load = pct(hall.itKw, hall.capKw);
    return '<tr data-hall="' + esc(hall.id) + '"' + (hall.worst === 1 ? ' class="fleet-p1"' : "") + ">" +
      '<td><button type="button" class="act" data-act="oneline-hall" data-pod="' + esc(hall.id) + '">' + esc(hall.name) + "</button></td>" +
      '<td data-col="alarms">' + alarmCell(hall) + "</td>" +
      '<td data-col="power">' + mw(hall.itKw) + " of " + mw(hall.capKw) + " · " + load + "%" +
      (hall.feed === "normal" ? "" : ' <span class="fleet-feed ' + hall.feed + '">' + (hall.feed === "lost" ? "Power lost" : "At risk") + "</span>") + "</td>" +
      '<td data-col="headroom">' + mw(Math.max(0, hall.capKw - hall.itKw)) + "</td>" +
      '<td data-col="racks">' + hall.racks + (hall.critical ? " · " + hall.critical + " critical" : "") +
      (hall.hot ? " · " + hall.hot + " near" : "") +
      (hall.racks ? ' <button type="button" class="act fleet-racks" data-act="fleet-racks" data-pod="' + esc(hall.id) + '" aria-expanded="' + open + '">' +
        (open ? "Hide racks" : "Show racks") + "</button>" : "") + "</td></tr>" +
      (open ? rackDrill(hall) : "");
  }).join("");
  const tiles = '<div class="fleet-tiles">' +
    '<div class="fleet-tile"><span>Halls</span><b>' + halls.length + "</b></div>" +
    '<div class="fleet-tile"><span>Open alarms</span><b data-total="alarms">' + total.alarms + "</b></div>" +
    '<div class="fleet-tile"><span>IT load</span><b>' + mw(total.itKw) + "</b><small>" + pct(total.itKw, total.capKw) + "% of " + mw(total.capKw) + "</small></div>" +
    '<div class="fleet-tile"><span>Critical racks</span><b>' + total.critical + "</b><small>of " + total.racks + "</small></div></div>";
  return '<div class="fleet-page"><div class="oneline-head"><div><h2>Fleet</h2>' +
    '<p class="ol-summary">Every hall at a glance. Alarm, power and capacity readings update with the live simulation. Open a hall to see it on the floor, or show its racks to compare them by power or alarms.</p>' +
    simNote() + "</div></div>" +
    tiles + '<section class="panel"><h2>Halls</h2><div class="table-wrap"><table class="fleet-table"><thead><tr><th>Hall</th><th>Alarms</th><th>IT power</th><th>Headroom</th><th>Racks</th></tr></thead><tbody>' +
    rows + "</tbody></table></div></section></div>";
}
