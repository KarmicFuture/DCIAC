import { state } from "../state";
import { render } from "../ui/schedule";
import { stopWalk } from "../views/floor";

/* Heat path is the hall heat map: clouds of heat and cold spots on the 3D hall
   floor (views/floor.ts heatCloudsHtml). Simulate scenarios move them. */

const HALL_LEVELS = ["hall", "pod", "row"];

export function heatMapOn() {
  return !!state.heatMap;
}

function onHallFloor() {
  return state.view === "floor" && HALL_LEVELS.indexOf(state.floor.level) >= 0;
}

export function toggleHeat() {
  state.heatMap = !state.heatMap;
  if (state.heatMap && !onHallFloor()) {
    // The heat map lives on the hall floor; take the user there.
    state.menuOpen = false;
    stopWalk(true, false);
    state.view = "floor";
    state.floor.level = "hall";
    state.floor.podId = state.floor.podId || "pod-a";
    state.floor.serverId = "";
    state.floor.rowId = "";
    state.floor.feedId = "";
    state.floor.partId = "";
  }
  state.focusField = "heat-path-toggle";
  render();
}

export function heatPathButton(withId?: boolean) {
  if (!state.user) return "";
  const on = heatMapOn();
  return '<button type="button" class="act heat-path-toggle"' + (withId === false ? "" : ' id="heat-path-toggle"') +
    ' data-act="heat-path" aria-pressed="' + (on ? "true" : "false") + '"' +
    (on && onHallFloor() ? ' aria-describedby="heat-map-status"' : "") + ">Heat path</button>";
}
