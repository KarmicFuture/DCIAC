import { PLANT, PODS, YARD, entityById, heatBand } from "../data/pods";
import { impact, type SimImpact } from "../domain/events";
import { runtime, state } from "../state";
import { esc } from "../ui/format";
import { BUILD_END, BUILD_START, formatDay, hallPhaseOn, stageOn, yardShown } from "../domain/buildplan";
import { stageBarHtml } from "./plan";

/* Build timeline mode: the same one-line on a plan date. Gear not yet set is drawn
   dashed and faint, a hall that is built but not yet carrying load is grey, and
   energized gear is drawn as live. Faults from the simulator are not shown here. */
let buildStage: any = null;

const EDGE_NEEDS: Record<string, string[]> = {
  "grid-1": ["grid-1"],
  "grid-2": ["grid-2"],
  "grid-xfmr-a": ["grid-1", "xfmr-1"],
  "grid-xfmr-b": ["grid-2", "xfmr-2"],
  "xfmr-mod-a": ["xfmr-1", "pwr-mod"],
  "xfmr-mod-b": ["xfmr-2", "pwr-2"],
  "mod-bus": ["pwr-mod", "@feeds"],
  "mod-bus-b": ["pwr-2", "@feeds"],
  "mod-riser": ["@feeds"],
  "mod-c": ["pwr-3"],
  "mod-d": ["pwr-4"],
  "batt-a": ["batt-1"],
  "batt-b": ["batt-2"],
};

function builtOn(id: string) {
  if (!buildStage) return true;
  if (id === "@feeds") return !!buildStage.feeds;
  const item = YARD.find((row) => row.id === id) || { id };
  return yardShown(item, buildStage);
}

function buildEdgeTone(ids: string[]) {
  const needs = ids.reduce((all, id) => all.concat(EDGE_NEEDS[id] || []), [] as string[]);
  return needs.every(builtOn) ? "live" : "future";
}
import { openFloorServer, openPod } from "./floor";

type Pt = { x: number; y: number };

function yardName(id: string, fallback: string) {
  const item = YARD.find((row) => row.id === id) || entityById(id);
  return (item && (item.name || item.id)) || fallback;
}

const SIDE_A = ["grid-1", "xfmr-1", "pwr-mod", "pwr-3", "grid-xfmr-a", "xfmr-mod-a", "mod-bus", "mod-c"];
const SIDE_B = ["grid-2", "xfmr-2", "pwr-2", "pwr-4", "grid-xfmr-b", "xfmr-mod-b", "mod-bus-b", "mod-d"];

function feederDown(id: string) {
  return !!(runtime.sim.feedersDown && runtime.sim.feedersDown[id]);
}

/* One open feeder de-energizes that side and leaves the other side carrying the halls. */
function carriedTone(ids: string[], report: SimImpact) {
  if (!report.active) return "";
  const aDown = feederDown("grid-1");
  const bDown = feederDown("grid-2");
  if (!aDown && !bDown) return "";
  const onA = ids.every((id) => SIDE_A.indexOf(id) >= 0);
  const onB = ids.every((id) => SIDE_B.indexOf(id) >= 0);
  if (onA && aDown) return "failed";
  if (onB && bDown) return "failed";
  if (onA && bDown && !aDown) return "live";
  if (onB && aDown && !bDown) return "live";
  if (ids.length === 1 && ids[0] === "mod-riser" && aDown !== bDown) return "live";
  return "";
}

function nodeTone(id: string, report: SimImpact) {
  if (buildStage) return builtOn(id) ? "live" : "future";
  if (feederDown(id)) return "failed";
  if (report.active && report.failedFeeds.indexOf(id) >= 0) return "failed";
  if (report.active && report.affected[id]) return "hit";
  const entity = entityById(id);
  if (entity && entity.bmc === "down") return "failed";
  if (entity && heatBand(entity) === "critical") return "hot";
  if (entity && heatBand(entity) === "near") return "warm";
  const carried = carriedTone([id], report);
  if (carried) return carried;
  if (report.active) return "dim";
  return "live";
}

function edgeTone(ids: string[], report: SimImpact) {
  if (buildStage) return buildEdgeTone(ids);
  if (ids.some((id) => report.active && report.failedFeeds.indexOf(id) >= 0)) return "failed";
  if (ids.some((id) => feederDown(id))) return "failed";
  if (report.active && ids.some((id) => report.affected[id])) return "hit";
  const carried = carriedTone(ids, report);
  if (carried) return carried;
  if (report.active) return "dim";
  return "live";
}

function line(a: Pt, b: Pt, tone: string, feedId = "") {
  return '<line class="ol-line ' + tone + '" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"' +
    (feedId ? ' data-feed="' + esc(feedId) + '"' : "") + " />";
}

function poly(points: Pt[], tone: string, feedId = "") {
  const d = points.map((p, i) => (i ? "L" : "M") + p.x + " " + p.y).join(" ");
  return '<path class="ol-line ' + tone + '" d="' + d + '"' +
    (feedId ? ' data-feed="' + esc(feedId) + '"' : "") + " fill=\"none\" />";
}

function breaker(at: Pt, tone: string) {
  return '<g class="ol-breaker ' + tone + '" transform="translate(' + at.x + " " + at.y + ')">' +
    '<circle r="7" /><line x1="-14" y1="0" x2="-7" y2="0" /><line x1="7" y1="0" x2="14" y2="0" /></g>';
}

function xfmr(at: Pt, tone: string) {
  return '<g class="ol-xfmr ' + tone + '" transform="translate(' + at.x + " " + at.y + ')">' +
    '<circle cx="-8" r="12" /><circle cx="8" r="12" /></g>';
}

function batt(at: Pt, tone: string) {
  return '<g class="ol-batt ' + tone + '" transform="translate(' + at.x + " " + at.y + ')">' +
    '<line x1="-10" y1="-8" x2="-10" y2="8" /><line x1="-4" y1="-14" x2="-4" y2="14" />' +
    '<line x1="4" y1="-8" x2="4" y2="8" /><line x1="10" y1="-14" x2="10" y2="14" /></g>';
}

function deviceBox(at: Pt, label: string, sub: string, tone: string, serverId: string, w = 108) {
  const x = at.x - w / 2;
  const y = at.y - 22;
  return '<g class="ol-node ' + tone + '" data-act="oneline-open" data-server="' + esc(serverId) + '" role="button" tabindex="0">' +
    '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="44" rx="4" />' +
    '<text class="ol-label" x="' + at.x + '" y="' + (at.y - 2) + '">' + esc(label) + "</text>" +
    '<text class="ol-sub" x="' + at.x + '" y="' + (at.y + 14) + '">' + esc(sub) + "</text></g>";
}

function hallTap(at: Pt, hall, tone: string, sub = PLANT.hallItMw + " MW IT") {
  const act = buildStage ? "oneline-build-hall" : "oneline-hall";
  return '<g class="ol-hall ' + tone + '" data-act="' + act + '" data-pod="' + esc(hall.id) + '" role="button" tabindex="0">' +
    '<rect class="ol-hit" x="' + (at.x - 12) + '" y="' + (at.y - 14) + '" width="160" height="30" />' +
    '<circle cx="' + at.x + '" cy="' + at.y + '" r="6" />' +
    '<text class="ol-label" x="' + (at.x + 14) + '" y="' + (at.y + 4) + '">' + esc(hall.name) + "</text>" +
    '<text class="ol-sub" x="' + (at.x + 14) + '" y="' + (at.y + 18) + '">' + esc(sub) + "</text></g>";
}

function summaryHtml(report: SimImpact) {
  if (report.active && report.summary) {
    return '<p class="ol-summary" role="status">' + esc(report.summary) + "</p>";
  }
  const feeders = YARD.filter((item) => item.kind === "Grid");
  const live = feeders.filter((item) => !(runtime.sim.feedersDown && runtime.sim.feedersDown[item.id])).length;
  return '<p class="ol-summary" role="status">' + live + " of " + Math.max(feeders.length, 2) +
    " utility feeders closed · " + PLANT.itMw + " MW IT campus</p>";
}

function diagramSvg(report: SimImpact) {
  const halls = PODS.slice();
  const hallStartY = 86;
  const hallGap = 34;
  const hallX = 760;
  const busX = 640;
  const busTop = 70;
  const busBottom = hallStartY + Math.max(halls.length - 1, 0) * hallGap + 24;
  const height = Math.max(420, busBottom + 70);

  const aY = 110;
  const bY = 220;
  const utility: Pt = { x: 48, y: 165 };
  const gridA: Pt = { x: 150, y: aY };
  const gridB: Pt = { x: 150, y: bY };
  const brA1: Pt = { x: 230, y: aY };
  const brB1: Pt = { x: 230, y: bY };
  const xfA: Pt = { x: 310, y: aY };
  const xfB: Pt = { x: 310, y: bY };
  const brA2: Pt = { x: 390, y: aY };
  const brB2: Pt = { x: 390, y: bY };
  const modA: Pt = { x: 500, y: aY };
  const modB: Pt = { x: 500, y: bY };
  const modC: Pt = { x: 500, y: 48 };
  const modD: Pt = { x: 500, y: 282 };
  const battAy: Pt = { x: 560, y: aY + 36 };
  const battBy: Pt = { x: 560, y: bY - 36 };
  const busJoinA: Pt = { x: busX, y: aY };
  const busJoinB: Pt = { x: busX, y: bY };

  const toneA = edgeTone(["grid-1", "grid-xfmr-a", "xfmr-mod-a", "mod-bus"], report);
  const toneB = edgeTone(["grid-2", "grid-xfmr-b", "xfmr-mod-b", "mod-bus-b"], report);
  const toneBus = edgeTone(["mod-riser"], report);
  const bothDown = !!(runtime.sim.feedersDown && runtime.sim.feedersDown["grid-1"] && runtime.sim.feedersDown["grid-2"]);
  const hallEdge = bothDown || (report.active && report.loadLost) ? "failed" : (report.active && report.redundancyGone ? "hit" : (report.active ? "dim" : "live"));

  let body = "";
  body += '<text class="ol-title" x="48" y="36">Facility power · one-line</text>';
  body += '<text class="ol-sub" x="48" y="54">Utility to hall busway · click a node to open it on the floor</text>';

  // Utility stem
  const stem = buildStage ? buildEdgeTone(["grid-1"]) : "live";
  body += line(utility, { x: 90, y: utility.y }, stem);
  body += line({ x: 90, y: aY }, { x: 90, y: bY }, stem);
  body += line({ x: 90, y: aY }, { x: gridA.x - 54, y: aY }, toneA, "grid-xfmr-a");
  body += line({ x: 90, y: bY }, { x: gridB.x - 54, y: bY }, toneB, "grid-xfmr-b");
  body += '<g class="ol-utility"><rect x="24" y="148" width="48" height="34" rx="3" /><text class="ol-label" x="48" y="169">UTIL</text></g>';

  // Side A chain
  body += deviceBox(gridA, "Feeder A", yardName("grid-1", "grid-1"), nodeTone("grid-1", report), "grid-1", 100);
  body += line({ x: gridA.x + 50, y: aY }, { x: brA1.x - 14, y: aY }, toneA, "grid-xfmr-a");
  body += breaker(brA1, toneA);
  body += line({ x: brA1.x + 14, y: aY }, { x: xfA.x - 20, y: aY }, toneA, "grid-xfmr-a");
  body += xfmr(xfA, nodeTone("xfmr-1", report));
  body += '<text class="ol-sub" x="' + xfA.x + '" y="' + (aY + 28) + '">XFMR A</text>';
  body += line({ x: xfA.x + 20, y: aY }, { x: brA2.x - 14, y: aY }, toneA, "xfmr-mod-a");
  body += breaker(brA2, toneA);
  body += line({ x: brA2.x + 14, y: aY }, { x: modA.x - 54, y: aY }, toneA, "xfmr-mod-a");
  body += deviceBox(modA, "Module A", yardName("pwr-mod", "pwr-mod"), nodeTone("pwr-mod", report), "pwr-mod");
  body += line({ x: modA.x + 54, y: aY }, busJoinA, toneA, "mod-bus");

  // Side B chain
  body += deviceBox(gridB, "Feeder B", yardName("grid-2", "grid-2"), nodeTone("grid-2", report), "grid-2", 100);
  body += line({ x: gridB.x + 50, y: bY }, { x: brB1.x - 14, y: bY }, toneB, "grid-xfmr-b");
  body += breaker(brB1, toneB);
  body += line({ x: brB1.x + 14, y: bY }, { x: xfB.x - 20, y: bY }, toneB, "grid-xfmr-b");
  body += xfmr(xfB, nodeTone("xfmr-2", report));
  body += '<text class="ol-sub" x="' + xfB.x + '" y="' + (bY + 28) + '">XFMR B</text>';
  body += line({ x: xfB.x + 20, y: bY }, { x: brB2.x - 14, y: bY }, toneB, "xfmr-mod-b");
  body += breaker(brB2, toneB);
  body += line({ x: brB2.x + 14, y: bY }, { x: modB.x - 54, y: bY }, toneB, "xfmr-mod-b");
  body += deviceBox(modB, "Module B", yardName("pwr-2", "pwr-2"), nodeTone("pwr-2", report), "pwr-2");
  body += line({ x: modB.x + 54, y: bY }, busJoinB, toneB, "mod-bus-b");

  // Expansion modules
  body += line({ x: modA.x, y: aY - 22 }, { x: modC.x, y: modC.y + 22 }, edgeTone(["mod-c"], report), "mod-c");
  body += deviceBox(modC, "Module C", yardName("pwr-3", "pwr-3"), nodeTone("pwr-3", report), "pwr-3", 100);
  body += line({ x: modB.x, y: bY + 22 }, { x: modD.x, y: modD.y - 22 }, edgeTone(["mod-d"], report), "mod-d");
  body += deviceBox(modD, "Module D", yardName("pwr-4", "pwr-4"), nodeTone("pwr-4", report), "pwr-4", 100);

  // Batteries
  body += poly([
    { x: modA.x + 20, y: aY + 22 },
    { x: battAy.x, y: aY + 22 },
    battAy,
  ], edgeTone(["batt-a"], report), "batt-a");
  body += batt(battAy, nodeTone("batt-1", report));
  body += '<text class="ol-sub" x="' + (battAy.x + 28) + '" y="' + (battAy.y + 4) + '">Batt A</text>';
  body += '<g data-act="oneline-open" data-server="batt-1" role="button" tabindex="0"><rect class="ol-hit" x="' +
    (battAy.x - 18) + '" y="' + (battAy.y - 18) + '" width="70" height="36" /></g>';

  body += poly([
    { x: modB.x + 20, y: bY - 22 },
    { x: battBy.x, y: bY - 22 },
    battBy,
  ], edgeTone(["batt-b"], report), "batt-b");
  body += batt(battBy, nodeTone("batt-2", report));
  body += '<text class="ol-sub" x="' + (battBy.x + 28) + '" y="' + (battBy.y + 4) + '">Batt B</text>';
  body += '<g data-act="oneline-open" data-server="batt-2" role="button" tabindex="0"><rect class="ol-hit" x="' +
    (battBy.x - 18) + '" y="' + (battBy.y - 18) + '" width="70" height="36" /></g>';

  // Main bus riser
  body += line({ x: busX, y: busTop }, { x: busX, y: busBottom }, toneBus, "mod-riser");
  body += '<text class="ol-sub" x="' + (busX - 8) + '" y="' + (busTop - 10) + '" text-anchor="end">MV bus</text>';

  // Hall taps
  halls.forEach((hall, index) => {
    const y = hallStartY + index * hallGap;
    const feedId = "feed-hall-" + hall.id;
    if (buildStage) {
      const phase = hallPhaseOn(index, state.buildDate, (hall.racks || []).length).phase;
      const built = phase.id !== "field" && phase.id !== "pad";
      const hallTone = phase.id === "live" ? "live" : (built && buildStage.feeds ? "dead" : "future");
      const feedTone = buildStage.feeds && built ? hallTone : "future";
      body += line({ x: busX, y }, { x: hallX - 8, y }, feedTone, feedId);
      body += breaker({ x: hallX - 28, y }, feedTone);
      body += hallTap({ x: hallX, y }, hall, hallTone, phase.id === "live" ? PLANT.hallItMw + " MW IT" : phase.name);
      return;
    }
    const tone = report.active && report.failedFeeds.indexOf(feedId) >= 0 ? "failed" : hallEdge;
    body += line({ x: busX, y }, { x: hallX - 8, y }, tone, feedId);
    body += breaker({ x: hallX - 28, y }, tone);
    body += hallTap({ x: hallX, y }, hall, nodeTone(hall.id, report) === "dim" && !report.affected[hall.id] ? tone : (report.affected[hall.id] ? "hit" : tone));
  });

  // Legend
  const legendY = height - 28;
  if (buildStage) {
    body += '<g class="ol-legend" transform="translate(48 ' + legendY + ')">' +
      '<line class="ol-line live" x1="0" y1="0" x2="28" y2="0" /><text class="ol-sub" x="34" y="4" style="text-anchor:start">Energized</text>' +
      '<line class="ol-line dead" x1="120" y1="0" x2="148" y2="0" /><text class="ol-sub" x="154" y="4" style="text-anchor:start">Built, no load</text>' +
      '<line class="ol-line future" x1="260" y1="0" x2="288" y2="0" /><text class="ol-sub" x="294" y="4" style="text-anchor:start">Not yet built</text></g>';
    return '<svg class="ol-svg" viewBox="0 0 980 ' + height + '" role="img" aria-label="Facility power one-line diagram on ' +
      esc(formatDay(state.buildDate)) + '">' + body + "</svg>";
  }
  body += '<g class="ol-legend" transform="translate(48 ' + legendY + ')">' +
    '<line class="ol-line live" x1="0" y1="0" x2="28" y2="0" /><text class="ol-sub" x="34" y="4">Live</text>' +
    '<line class="ol-line hit" x1="90" y1="0" x2="118" y2="0" /><text class="ol-sub" x="124" y="4">At risk</text>' +
    '<line class="ol-line failed" x1="190" y1="0" x2="218" y2="0" /><text class="ol-sub" x="224" y="4">Open / failed</text>' +
    '<circle class="ol-breaker live" cx="330" cy="0" r="6" /><text class="ol-sub" x="342" y="4">Breaker</text>' +
    '<g class="ol-xfmr live" transform="translate(430 0)"><circle cx="-6" r="8" /><circle cx="6" r="8" /></g>' +
    '<text class="ol-sub" x="448" y="4">Transformer</text></g>';

  return '<svg class="ol-svg" viewBox="0 0 980 ' + height + '" role="img" aria-label="Facility power one-line diagram">' +
    body + "</svg>";
}

export function openOnelineNode(serverId: string) {
  if (!serverId) return;
  state.view = "floor";
  openFloorServer(serverId);
}

export function openOnelineHall(podId: string) {
  if (!podId) return;
  state.view = "floor";
  openPod(podId);
}

export function openOnelineSite() {
  state.view = "floor";
  state.floor.level = "site";
  state.floor.serverId = "";
  state.floor.rowId = "";
  state.floor.feedId = "";
  state.floor.partId = "";
  state.inspectorOpen = false;
}

function buildSummary(stage) {
  const feeders = ["grid-1", "grid-2"].filter(builtOn).length;
  const modules = ["pwr-mod", "pwr-2", "pwr-3", "pwr-4"].filter(builtOn).length;
  const live = PODS.filter((hall, index) => hallPhaseOn(index, state.buildDate, (hall.racks || []).length).phase.id === "live").length;
  return '<p class="ol-summary" role="status">' + esc(formatDay(state.buildDate) + " · " + stage.name) + ": " + feeders + " of 2 feeders, " +
    modules + " of 4 power modules · " + live + " of " + PODS.length + " halls energized · " + live * PLANT.hallItMw + " MW IT</p>";
}

export function renderOneline() {
  const building = !!state.onelineBuild;
  if (building && !(state.buildDate >= BUILD_START && state.buildDate <= BUILD_END)) state.buildDate = BUILD_START;
  buildStage = building ? stageOn(state.buildDate) : null;
  const report = impact(runtime.sim);
  const toggle = '<button type="button" class="act" data-act="oneline-build" aria-pressed="' + (building ? "true" : "false") + '">Build timeline</button>';
  if (building) {
    const html = '<div class="oneline-page oneline-build">' +
      '<div class="oneline-head"><div><h2>One-line · build timeline</h2>' + buildSummary(buildStage) + "</div>" +
      '<div class="oneline-actions">' + toggle + "</div></div>" +
      stageBarHtml(buildStage) +
      '<div class="oneline-sheet">' + diagramSvg(report) + "</div></div>";
    buildStage = null;
    return html;
  }
  return '<div class="oneline-page">' +
    '<div class="oneline-head"><div><h2>One-line</h2>' + summaryHtml(report) + "</div>" +
    '<div class="oneline-actions">' + toggle +
    '<button type="button" class="act" data-act="oneline-site">Outside floor</button>' +
    '<button type="button" class="act" data-act="sim-open">Simulate</button>' +
    "</div></div>" +
    '<div class="oneline-sheet' + (report.active ? " sim-active" : "") + '">' + diagramSvg(report) + "</div></div>";
}
