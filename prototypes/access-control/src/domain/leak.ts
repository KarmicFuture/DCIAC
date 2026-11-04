import { deviceById } from "../data/devices";
import { LEAK, outletByN } from "../data/outlets";
import { audit } from "./audit";
import { outletReason } from "./outlet-policy";
import { state } from "../state";
import { esc } from "../ui/format";
import { render } from "../ui/schedule";

export function onLeak(id) {
  return LEAK.outlets.some((n) => outletByN(n).deviceId === id);
}

export function setLeak(on, keepOpen) {
  if (state.leak === !!on) return;
  state.leak = !!on;
  if (state.leak) {
    audit({
      user: "ACS-A14",
      role: "appliance",
      action: "DI-1 alarm",
      asset: LEAK.location,
      outlet: "Outlet 1, Outlet 2",
      detail: "Bound control only. Plant-wide trip is not the policy.",
    });
    state.view = "control";
    if (!keepOpen) state.labOpen = false;
    state.toast = "DI-1 alarm. Suggested control is Outlet 1 and Outlet 2.";
  } else {
    audit({
      user: "ACS-A14",
      role: "appliance",
      action: "DI-1 clear",
      asset: LEAK.location,
    });
    state.toast = "DI-1 is quiet.";
  }
  render();
}

export function toggleLeak(keepOpen?) {
  setLeak(!state.leak, keepOpen);
}

export function leakNames() {
  return LEAK.outlets.map((n) => "Outlet " + n + " (" + deviceById(outletByN(n).deviceId).name + ")").join(" and ");
}

export function leakCard() {
  const names = leakNames();
  if (!state.leak) {
    return '<section class="policy"><h2>DI-1 leak policy</h2><p>Location: ' + esc(LEAK.location) +
      ".</p><p>Bound Control: " + esc(names) + ". Plant-wide trip is not the policy.</p>" +
      '<p class="fine">DI-1 is quiet. Trip it from the Lab to raise the alarm.</p></section>';
  }
  const sample = outletReason(outletByN(LEAK.outlets[0]));
  const shed = LEAK.outlets.map((n) => {
    const reason = outletReason(outletByN(n));
    const dis = reason ? " disabled" : "";
    const title = reason ? ' title="' + esc(reason) + '"' : "";
    return '<button type="button" class="act danger" data-act="outlet" data-outlet="' + n +
      '" data-op="off" data-source="DI-1"' + dis + title + ">Shed Outlet " + n + "</button>";
  }).join("");
  return '<section class="alarm" role="status"><h2>DI-1 leak alarm</h2><p>Location: ' + esc(LEAK.location) +
    ".</p><p>Suggested Control: " + esc(names) + ' only.</p><div class="actions">' + shed + "</div>" +
    (sample ? '<p class="reason">' + esc(sample) + "</p>" : "") + "</section>";
}
