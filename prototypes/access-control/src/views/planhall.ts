import { formatDay, hallPhaseOn, spanDays } from "../domain/buildplan";
import { PODS } from "../data/pods";
import { esc } from "../ui/format";

/* One hall on the build timeline: a top-down plan that fills in as the date moves,
   from pad to empty shell, power and cooling, racks set row by row, and live. */

function rect(item, klass, extra = "") {
  const d = item.d != null ? item.d : item.h;
  return '<rect class="' + klass + '" x="' + item.x + '" y="' + item.y + '" width="' + item.w + '" height="' + d + '"' + extra + " />";
}

function label(x, y, text, klass = "hb-label") {
  return '<text class="' + klass + '" x="' + x + '" y="' + y + '">' + esc(text) + "</text>";
}

function racksInOrder(pod) {
  return (pod.racks || []).slice().sort((a, b) => (a.row || "").localeCompare(b.row || "") || (a.n || 0) - (b.n || 0));
}

function planSvg(pod, phaseId, racksSet) {
  const w = pod.w || 940;
  const h = pod.h || 380;
  const parts = [];
  if (phaseId === "field") {
    parts.push('<rect class="hb-field" x="0" y="0" width="' + w + '" height="' + h + '" />');
    parts.push(label(w / 2, h / 2, "Survey stakes only", "hb-label hb-center"));
  } else if (phaseId === "pad") {
    parts.push('<rect class="hb-pad" x="0" y="0" width="' + w + '" height="' + h + '" />');
    parts.push(label(w / 2, h / 2, "Hall pad poured. No walls yet.", "hb-label hb-center"));
  } else {
    parts.push('<rect class="hb-floor" x="0" y="0" width="' + w + '" height="' + h + '" />');
    const fitted = phaseId !== "shell";
    const fit = pod.fit || {};
    if (fitted) {
      (fit.aisles || []).forEach((aisle) => parts.push(rect(aisle, "hb-aisle " + (aisle.tone || ""))));
      if (fit.containment) parts.push(rect(fit.containment, "hb-contain"));
      if (fit.busbar) parts.push(rect(fit.busbar, "hb-bus"));
      (pod.boxes || []).forEach((box) => {
        parts.push(rect(box, "hb-box", ' data-box="' + esc(box.id) + '"'));
        parts.push(label(box.x + 4, box.y + 14, box.kind || "Equipment", "hb-label hb-small"));
      });
    } else {
      parts.push(label(w / 2, h / 2, "Empty shell. Power and cooling go in next.", "hb-label hb-center"));
    }
    if (fitted) {
      racksInOrder(pod).forEach((rack, i) => {
        const set = i < racksSet;
        const klass = !set ? "hb-rack planned" : (phaseId === "live" ? "hb-rack live" : "hb-rack set");
        parts.push(rect(rack, klass, ' data-rack="' + esc(rack.id) + '"'));
        parts.push(label(rack.x + rack.w / 2, rack.y + rack.d / 2 + 4, rack.id, "hb-label hb-rack-id"));
      });
    }
  }
  return '<svg class="hb-svg" viewBox="-8 -8 ' + (w + 16) + " " + (h + 16) + '" role="img" aria-label="' +
    esc(pod.name) + ' floor plan on this date">' + parts.join("") + "</svg>";
}

function phaseBar(phases, current) {
  return '<div class="stage-bar hall-bar" role="group" aria-label="Hall phases">' + phases.map((phase) => {
    const on = phase.id === current.id;
    return '<button type="button" class="s-' + phase.stage + (on ? " on" : "") + '" data-act="build-day" data-phase="' + phase.id +
      '" data-date="' + phase.start + '" style="--days:' + spanDays(phase) + '"' + (on ? ' aria-pressed="true"' : "") +
      ' title="' + esc(formatDay(phase.start) + " – " + formatDay(phase.end) + ". " + phase.blurb) + '"><span>' +
      esc(phase.name) + "</span></button>";
  }).join("") + "</div>";
}

export function renderHallTimeline(podId, iso) {
  const index = PODS.findIndex((pod) => pod.id === podId);
  const pod = PODS[index];
  if (!pod) return "";
  const racks = (pod.racks || []).length;
  const { phase, phases, racksSet } = hallPhaseOn(index, iso, racks);
  const live = phase.id === "live"
    ? '<button type="button" class="act" data-act="build-live" data-pod="' + esc(pod.id) + '">Open live hall</button>'
    : "";
  return '<div class="hall-build" data-hall="' + esc(pod.id) + '" data-phase="' + phase.id + '">' +
    '<div class="hall-build-head"><button type="button" class="act" data-act="build-hall-close">← Campus</button>' +
    "<div><h2>" + esc(pod.name) + " · " + esc(phase.name) + "</h2>" +
    '<p class="fine">' + esc(phase.blurb) + "</p></div>" + live + "</div>" +
    phaseBar(phases, phase) +
    '<div class="hall-build-plan">' + planSvg(pod, phase.id, racksSet) + "</div>" +
    '<p class="hall-build-count" data-racks-set="' + racksSet + '">Racks set: ' + racksSet + " of " + racks +
    " · " + esc(formatDay(phase.start)) + " – " + esc(formatDay(phase.end)) + "</p></div>";
}
