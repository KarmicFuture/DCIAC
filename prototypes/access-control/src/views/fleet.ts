import { PLANT, PODS, entityById, heatBand, rackEntities } from "../data/pods";
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
  const rows = halls.map((hall) => {
    const load = pct(hall.itKw, hall.capKw);
    return '<tr data-hall="' + esc(hall.id) + '"' + (hall.worst === 1 ? ' class="fleet-p1"' : "") + ">" +
      '<td><button type="button" class="act" data-act="oneline-hall" data-pod="' + esc(hall.id) + '">' + esc(hall.name) + "</button></td>" +
      '<td data-col="alarms">' + alarmCell(hall) + "</td>" +
      '<td data-col="power">' + mw(hall.itKw) + " of " + mw(hall.capKw) + " · " + load + "%" +
      (hall.feed === "normal" ? "" : ' <span class="fleet-feed ' + hall.feed + '">' + (hall.feed === "lost" ? "Power lost" : "At risk") + "</span>") + "</td>" +
      '<td data-col="headroom">' + mw(Math.max(0, hall.capKw - hall.itKw)) + "</td>" +
      '<td data-col="racks">' + hall.racks + (hall.critical ? " · " + hall.critical + " critical" : "") +
      (hall.hot ? " · " + hall.hot + " near" : "") + "</td></tr>";
  }).join("");
  const tiles = '<div class="fleet-tiles">' +
    '<div class="fleet-tile"><span>Halls</span><b>' + halls.length + "</b></div>" +
    '<div class="fleet-tile"><span>Open alarms</span><b data-total="alarms">' + total.alarms + "</b></div>" +
    '<div class="fleet-tile"><span>IT load</span><b>' + mw(total.itKw) + "</b><small>" + pct(total.itKw, total.capKw) + "% of " + mw(total.capKw) + "</small></div>" +
    '<div class="fleet-tile"><span>Critical racks</span><b>' + total.critical + "</b><small>of " + total.racks + "</small></div></div>";
  return '<div class="fleet-page"><div class="oneline-head"><div><h2>Fleet</h2>' +
    '<p class="ol-summary">Every hall at a glance. Alarm, power and capacity readings update with the live simulation. Open a hall to see its racks.</p>' +
    simNote() + "</div></div>" +
    tiles + '<section class="panel"><h2>Halls</h2><div class="table-wrap"><table class="fleet-table"><thead><tr><th>Hall</th><th>Alarms</th><th>IT power</th><th>Headroom</th><th>Racks</th></tr></thead><tbody>' +
    rows + "</tbody></table></div></section></div>";
}
