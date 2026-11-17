import { BUILD_END, BUILD_START, STAGES, formatDay, monthCells, monthsOfPlan, spanDays, stageOn, yardShown } from "../domain/buildplan";
import { PLANT, PODS, YARD } from "../data/pods";
import { state } from "../state";
import { esc } from "../ui/format";
import { boxHtml, cameraTransform, feedHtml, itemPoint, siteFeedHtml, sitePipesHtml, yardById } from "./floor";

function hallsOf(indexes) {
  return indexes.map((index) => PODS[index]).filter((hall) => hall && hall.site);
}

function plantIds(stage) {
  const ids = [];
  for (let n = 1; n <= stage.coolers; n += 1) ids.push("heat-" + n);
  for (let n = 1; n <= stage.pumps; n += 1) ids.push("hydro-" + n);
  return ids;
}

function utilityLinks() {
  const pairs = [
    ["grid-1", "xfmr-1", "grid-xfmr-a"],
    ["grid-2", "xfmr-2", "grid-xfmr-b"],
  ];
  return pairs.map((pair) => {
    const from = yardById(pair[0]);
    const to = yardById(pair[1]);
    if (!from || !to) return "";
    return feedHtml(itemPoint(from), itemPoint(to), "live", pair[2], "", "cable");
  }).join("");
}

function sceneHtml(stage) {
  const built = hallsOf(stage.shells.concat(stage.live));
  const pads = hallsOf(stage.pads).map((hall) => boxHtml(
    { x: hall.site.x, y: hall.site.y, w: hall.site.w, d: hall.site.d, h: 6 },
    "ok",
    "build-quiet",
    { klass: "pad", cap: "Pad", color: "#b7a57a", leds: [], pod: hall.id, label: hall.name + " pad" },
  )).join("");
  const shells = hallsOf(stage.shells).map((hall) => boxHtml(
    { x: hall.site.x, y: hall.site.y, w: hall.site.w, d: hall.site.d, h: 18 },
    "ok",
    "build-open",
    { klass: "building shell", cap: hall.name + " shell", color: "#d7d0c6", leds: [], pod: hall.id, attrs: ' data-live="0"', label: hall.name + " shell" },
  )).join("");
  const live = hallsOf(stage.live).map((hall) => boxHtml(hall.site, "ok", "build-open", {
    klass: "building",
    color: hall.managed ? "#d9d2c8" : "#e4ddd4",
    cap: hall.name,
    pod: hall.id,
    attrs: ' data-live="1"',
    leds: [],
    label: hall.name,
  })).join("");
  const gear = YARD.filter((item) => yardShown(item, stage)).map((item) => boxHtml(item, "ok", "build-quiet", {
    server: item.id,
    klass: item.klass,
    cap: item.name,
    color: item.klass === "cooler-yard" || item.klass === "heat-yard" ? "#2f4a3c" : (item.klass === "core-block" ? "#1c1c1c" : "#3a342e"),
    leds: [],
    label: item.name,
  })).join("");
  let services = "";
  if (stage.feeds && built.length && stage.gear.indexOf("pwr-mod") >= 0) services += siteFeedHtml(built);
  else if (stage.gear.indexOf("grid-1") >= 0) services += utilityLinks();
  if (stage.pipes && built.length && stage.coolers) services += sitePipesHtml(built, plantIds(stage));
  const slab = stage.grass ? "grass-slab" : "yard-slab";
  const it = stage.live.length * PLANT.hallItMw;
  const hint = it ? it + " MW · " + stage.live.length + " halls" : "0 MW";
  return '<div class="scene thermal site-scene build-scene"><div class="stage"><div class="world" style="transform:' + cameraTransform() +
    ";--pitch:" + state.floor.pitch + "deg;--yaw:" + state.floor.yaw + 'deg"><div class="slab ' + slab + '"></div>' +
    pads + shells + live + gear + services +
    '</div></div><div class="legend"><span class="swatch s-' + stage.id + '"></span><span>' + esc(stage.name) + '</span><span class="legend-hint">' + esc(hint) + "</span></div></div>";
}

function calendarHtml(currentIso) {
  const heads = ["S", "M", "T", "W", "T", "F", "S"].map((day) => '<span class="cal-dow">' + day + "</span>").join("");
  return monthsOfPlan().map((month) => {
    const cells = monthCells(month.year, month.month).map((cell) => {
      if (!cell) return '<span class="cal-blank"></span>';
      if (!cell.inSpan) return '<span class="cal-day off">' + cell.day + "</span>";
      const on = cell.iso === currentIso ? ' aria-pressed="true"' : "";
      return '<button type="button" class="cal-day s-' + cell.stage.id + '" data-act="build-day" data-date="' + cell.iso +
        '" title="' + esc(cell.stage.name) + '"' + on + ">" + cell.day + "</button>";
    }).join("");
    return '<section class="cal-month"><h3>' + esc(month.label) + '</h3><div class="cal-grid">' + heads + cells + "</div></section>";
  }).join("");
}

function barHtml(current) {
  return STAGES.map((stage) => '<button type="button" class="s-' + stage.id + (stage.id === current.id ? " on" : "") +
    '" data-act="build-stage" data-date="' + stage.start + '" style="--days:' + spanDays(stage) + '"' +
    (stage.id === current.id ? ' aria-pressed="true"' : "") + ' title="' +
    esc(formatDay(stage.start) + " – " + formatDay(stage.end) + ". " + stage.arrives[0]) + '"><span>' +
    esc(stage.name) + "</span></button>").join("");
}

export function renderPlan() {
  const iso = state.buildDate && state.buildDate >= BUILD_START && state.buildDate <= BUILD_END ? state.buildDate : BUILD_START;
  state.buildDate = iso;
  const stage = stageOn(iso);
  return '<p class="sub plan-day">' + esc(formatDay(iso)) + "</p>" +
    '<div class="stage-bar" role="group" aria-label="Build stages">' + barHtml(stage) + "</div>" +
    sceneHtml(stage) +
    '<div class="cal-year">' + calendarHtml(iso) + "</div>";
}
