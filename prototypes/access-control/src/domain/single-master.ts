import { deviceById } from "../data/devices";
import { audit } from "./audit";
import { state } from "../state";
import { render } from "../ui/schedule";

export function sessionBlocked(s) {
  if (!s || s.path !== "rm1048") return false;
  const mapped = deviceById(s.deviceId);
  return state.rm1048 !== "healthy" || !!(mapped && mapped.bmc === "down");
}

export function rmBlockCopy(d, type) {
  const label = type === "kvm" ? "KVM" : "Redfish serial";
  if (d.bmc === "down") {
    return "BMC path is dark on " + d.name + ". " + label + " stays on the RM1048 in-band plane. The failover is out-of-band, on ACS.";
  }
  return "RM1048 plane is dark. " + label + " for " + d.name + " is unavailable on that path.";
}

export function mediaReason() {
  if (state.user && state.user.role === "ReadOnly") {
    return "ReadOnly cannot open write-capable KVM virtual media.";
  }
  return "";
}

export function toggleRm() {
  state.rm1048 = state.rm1048 === "healthy" ? "dark" : "healthy";
  if (state.rm1048 === "healthy") state.fails = {};
  audit({
    user: "RM1048",
    role: "plane",
    action: state.rm1048 === "healthy" ? "plane healthy" : "plane dark",
    detail: state.rm1048 === "healthy" ? "ACS yields outlet Control." : "ACS may cycle bound outlets.",
  });
  state.toast = state.rm1048 === "healthy"
    ? "RM1048 plane is healthy. ACS yields outlet Control."
    : "RM1048 plane is dark. ACS can cycle bound outlets.";
  render();
}
