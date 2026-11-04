/* Access prototype — P0 flows plus the AI hall floor.
   Sign-in, rack map, ACS and RM1048 serial/KVM, bound outlets, leak, single-master.
   A dark BMC fails over to ACS serial (out of band), not to RM1048.
   Alarms come from automatic ACS serial logins by acs.watch.
   The Lab drawer is simulated gear, not a product screen. */

import "@xterm/xterm/css/xterm.css";
import { deviceById, devices } from "./data/devices";
import { outlets } from "./data/outlets";
import { entityById } from "./data/pods";
import { setAnalyzer } from "./domain/analyzer";
import { finishOutletHold } from "./domain/outlet-policy";
import { stepCapacity } from "./domain/failover";
import { runtime, state } from "./state";
import { boot } from "./ui/render";

window.AccessDemo = {
  state,
  devices,
  outlets,
  setFailoverMs(ms) { runtime.serialFailoverMs = ms; },
  finishFailover(id) {
    const d = deviceById(id);
    if (d && d.serialReadyAt) d.serialReadyAt = Date.now() - 5;
  },
  pushLoad(id, patch) {
    const entity = entityById(id);
    if (!entity || !entity.load) return;
    Object.assign(entity.load, patch);
    stepCapacity();
  },
  setAnalyzer,
  finishOutletHold,
};

try {
  boot();
} catch (error) {
  document.getElementById("app").textContent = "Access could not start. " + (error && error.message ? error.message : "Reload the page.");
}
