import { BUILD_END, BUILD_START, formatDay, hallMilestones, hallPhases, monthsOfPlan, spanDays } from "../domain/buildplan";
import { PODS } from "../data/pods";
import { state } from "../state";
import { esc } from "../ui/format";

/* Every hall on one build timeline: one row per hall, one bar per phase. Click a
   phase to open that hall's own timeline on the phase's first day. */

const TOTAL = spanDays({ start: BUILD_START, end: BUILD_END });

function offset(iso) {
  return spanDays({ start: BUILD_START, end: iso }) - 1;
}

function pct(days) {
  return ((days / TOTAL) * 100).toFixed(3) + "%";
}

function monthAxis() {
  return monthsOfPlan().map((month) => {
    const iso = month.year + "-" + String(month.month + 1).padStart(2, "0") + "-01";
    if (iso < BUILD_START) return "";
    const at = offset(iso);
    return '<span class="gantt-month" style="left:' + pct(at) + '">' + esc(month.label.slice(0, 3) + " " + String(month.year).slice(2)) + "</span>";
  }).join("");
}

function hallRow(pod, index, today) {
  const phases = hallPhases(index).filter((phase) => phase.start <= phase.end);
  const current = phases.find((phase) => phase.start <= today && today <= phase.end);
  const bars = phases.map((phase) => '<button type="button" class="gantt-bar s-' + phase.stage + (current === phase ? " now" : "") +
    '" data-act="gantt-open" data-pod="' + esc(pod.id) + '" data-phase="' + phase.id + '" data-date="' + phase.start +
    '" style="left:' + pct(offset(phase.start)) + ";width:" + pct(spanDays(phase)) + '" title="' +
    esc(pod.name + " · " + phase.name + " · " + formatDay(phase.start) + " – " + formatDay(phase.end)) + '"><span>' +
    esc(phase.name) + "</span></button>").join("");
  const m = hallMilestones(index);
  return '<div class="gantt-row" data-hall="' + esc(pod.id) + '" data-now="' + (current ? current.id : "") + '">' +
    '<button type="button" class="gantt-name" data-act="gantt-open" data-pod="' + esc(pod.id) + '" data-date="' + today + '">' +
    "<b>" + esc(pod.name) + "</b><small>" + esc(current ? current.name : "") + "</small></button>" +
    '<div class="gantt-track">' + bars + '<i class="gantt-now" style="left:' + pct(offset(today)) + '" aria-hidden="true"></i></div>' +
    '<div class="gantt-dates"><span>Shell ' + esc(formatDay(m.shell)) + "</span><span>Live " + esc(formatDay(m.live)) + "</span></div></div>";
}

export function renderHalls() {
  const today = state.buildDate && state.buildDate >= BUILD_START && state.buildDate <= BUILD_END ? state.buildDate : BUILD_START;
  const live = PODS.filter((pod, index) => hallMilestones(index).live <= today).length;
  const rows = PODS.map((pod, index) => hallRow(pod, index, today)).join("");
  return '<div class="gantt-page"><div class="oneline-head"><div><h2>Hall build schedule</h2>' +
    '<p class="ol-summary">Every hall from pad to live. The line marks ' + esc(formatDay(today)) + ": " + live + " of " + PODS.length +
    " halls live. Click a phase to open that hall's timeline on that day.</p></div></div>" +
    '<section class="panel gantt"><h2>Halls</h2><div class="gantt-scroll"><div class="gantt-grid">' +
    '<div class="gantt-row gantt-axis"><span></span><div class="gantt-track">' + monthAxis() + "</div><span></span></div>" +
    rows +
    "</div></div></section></div>";
}
