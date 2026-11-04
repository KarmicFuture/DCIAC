import { deviceById } from "../data/devices";
import { outletByN } from "../data/outlets";
import { outletReason } from "./outlet-policy";
import { state } from "../state";

/* Plug-in point for a later model. The mock below is deterministic and makes
   no network calls. A real adapter replaces it with setAnalyzer and returns
   the same ExplainResult. gateAction still decides whether the button runs. */

export interface ExplainLine {
  at: number;
  text: string;
}

export interface ExplainInput {
  kind: "alarm" | "serial";
  id: string;
  signal: string;
  asset: string;
  deviceId: string;
  outlet: number;
  tty: string;
  text: string;
  lines: ExplainLine[];
}

export interface ExplainEvidence {
  at: number;
  text: string;
  hit: boolean;
}

export type Suggestion =
  | "open-acs-serial"
  | "open-acs-kvm"
  | "cycle-outlet"
  | "shed-outlet"
  | "open-control"
  | "open-rack"
  | "open-server"
  | "open-inlet"
  | "none";

export interface ExplainResult {
  happened: string;
  evidence: ExplainEvidence[];
  cause: string;
  confidence: number;
  suggestion: Suggestion;
}

export interface Analyzer {
  explain(input: ExplainInput): ExplainResult;
}

export interface GatedAction {
  suggestion: Suggestion;
  label: string;
  enabled: boolean;
  reason: string;
}

function evidence(lines, needles) {
  const usable = (lines || []).filter((line) => line && String(line.text || "").trim());
  const hits = usable.filter((line) => needles.some((needle) => line.text.toLowerCase().indexOf(needle.toLowerCase()) !== -1));
  const chosen = (hits.length ? hits : usable).slice(0, 5);
  return chosen.map((line) => ({
    at: line.at,
    text: line.text,
    hit: hits.length ? hits.indexOf(line) !== -1 : true,
  }));
}

function result(happened, lines, needles, cause, confidence, suggestion): ExplainResult {
  return {
    happened,
    evidence: evidence(lines, needles),
    cause,
    confidence,
    suggestion,
  };
}

export function mockExplain(input: ExplainInput): ExplainResult {
  const name = input.asset || "This device";
  const tty = input.tty || "the serial port";
  if (input.kind === "serial") {
    if (input.signal === "blocked") {
      return result(
        "This RM1048 serial session is not taking input. The out-of-band path is ACS.",
        input.lines,
        ["bmc", "path dark", "failover", "rm1048"],
        "Single-master closed this in-band session because the BMC path is dark or the RM1048 plane is dark.",
        94,
        "open-acs-serial"
      );
    }
    if (input.signal === "waiting") {
      return result(
        "ACS serial on " + tty + " is still coming up after the BMC path was lost.",
        input.lines,
        ["coming up", "bmc", "path"],
        "The out-of-band failover timer has not finished. The target is 30 seconds.",
        97,
        "none"
      );
    }
    if (input.signal === "deny") {
      return result(
        "The automatic login on " + tty + " was denied a shell.",
        input.lines,
        ["denied", "acs.watch", "reject"],
        "acs.watch could not get a shell on this port.",
        92,
        "open-acs-serial"
      );
    }
    if (input.signal === "uefi") {
      return result(
        name + " printed a BMC serial redirect and a UEFI boot log, then stopped at the UEFI shell.",
        input.lines,
        ["[bmc]", "[uefi]", "shell"],
        input.text.indexOf("Path dark") !== -1
          ? "The BMC path is dark, so this ACS serial line is the out-of-band console."
          : "The boot image returned to the UEFI shell instead of an operating system.",
        input.text.indexOf("Path dark") !== -1 ? 95 : 84,
        "open-acs-kvm"
      );
    }
    if (input.signal === "ios") {
      return result(
        name + " accepted a login and is at the Cisco IOS exec prompt.",
        input.lines,
        ["cisco ios", "username:", "user access"],
        "The IOS transcript shows a completed login and no fault.",
        76,
        "none"
      );
    }
    if (input.signal === "bmc-down") {
      return result(
        "The BMC path on " + name + " is dark. This ACS serial session is the out-of-band console.",
        input.lines,
        ["path dark", "bmc", "failover"],
        "Management failed over to ACS serial. RM1048 did not take it.",
        95,
        "none"
      );
    }
    return result(
      name + " accepted a Linux login and is at a shell prompt on " + tty + ".",
      input.lines,
      ["login:", "ubuntu", "password:"],
      "The serial transcript shows a normal login.",
      74,
      "none"
    );
  }
  if (input.signal === "leak") {
    return result(
      "The automatic login on " + tty + " read a DI-1 leak rope on " + name + ".",
      input.lines,
      ["leak", "di-1"],
      "The cold-plate leak rope is asserted. Plant-wide trip is not the policy. Suggested control stays on the bound outlets.",
      98,
      input.outlet ? "shed-outlet" : "open-control"
    );
  }
  if (input.signal === "bmc-wait") {
    return result(
      "The BMC path on " + name + " went dark. ACS serial on " + tty + " is still coming up.",
      input.lines,
      ["coming up", "bmc", "held"],
      "Out-of-band serial has not finished the 30 second failover.",
      97,
      "open-acs-serial"
    );
  }
  if (input.signal === "bmc-down") {
    return result(
      "The BMC path on " + name + " is dark. The automatic login on " + tty + " read the ACS failover.",
      input.lines,
      ["bmc", "failover", "acs"],
      "The out-of-band path is ACS serial, not RM1048.",
      96,
      "open-acs-serial"
    );
  }
  if (input.signal === "watch-deny") {
    return result(
      "acs.watch was denied a shell on " + tty + " for " + name + ".",
      input.lines,
      ["denied", "rejected"],
      "The automatic login was rejected, so the port needs a person to look at the console.",
      93,
      "open-acs-serial"
    );
  }
  if (input.signal === "rdp-down") {
    return result(
      "In-band remote desktop on " + name + " is down. The automatic login on " + tty + " read that loss.",
      input.lines,
      ["rdp", "kvm"],
      "The desktop failover is ACS KVM. RM1048 does not take it.",
      90,
      "open-acs-kvm"
    );
  }
  if (input.signal === "feed-open") {
    return result(
      input.text || "Outlet " + input.outlet + " is open.",
      input.lines,
      ["outlet", "open", "de-energized"],
      "The DC whip is de-energized because the outlet is open.",
      97,
      "cycle-outlet"
    );
  }
  if (input.signal === "inlet" || input.signal === "recirc") {
    return result(
      input.text,
      input.lines,
      ["inlet", "recirculat", "°c"],
      input.signal === "recirc"
        ? "Supply air is recirculating at the top of the rack."
        : "The rack inlet is outside the normal envelope.",
      input.signal === "recirc" ? 80 : 86,
      "open-inlet"
    );
  }
  if (input.signal === "outside-critical") {
    return result(
      name + " is at a critical simulated load. This rack is outside ACS-A14.",
      input.lines,
      ["critical", "outside"],
      "ACS-A14 cannot open a serial session on a rack it does not own.",
      77,
      "open-server"
    );
  }
  if (input.signal === "thermal-critical" || input.signal === "thermal-near") {
    return result(
      input.text,
      input.lines,
      ["critical", "capacity", "thermal"],
      input.signal === "thermal-critical"
        ? "Serial watch read a critical thermal load."
        : "Serial watch read a load that is nearing capacity.",
      input.signal === "thermal-critical" ? 85 : 70,
      "open-server"
    );
  }
  if (input.signal === "plane-dark") {
    return result(
      "The RM1048 plane is dark. " + tty + " on " + name + " is the path that still answers.",
      input.lines,
      ["rm1048", "plane", "dark"],
      "In-band RM1048 sessions will fail until that plane is healthy.",
      88,
      "open-rack"
    );
  }
  return result(
    input.text || name + " raised an alarm.",
    input.lines,
    [],
    "The alarm text is the only evidence on hand.",
    60,
    "open-control"
  );
}

let current: Analyzer = { explain: mockExplain };

export function setAnalyzer(next: Analyzer) {
  current = next && typeof next.explain === "function" ? next : { explain: mockExplain };
}

export function getAnalyzer() {
  return current;
}

export function explain(input: ExplainInput): ExplainResult {
  return current.explain(input);
}

function blockedOutlet(n, verb, suggestion): GatedAction {
  const outlet = outletByN(n);
  if (!outlet) {
    return { suggestion, label: verb + " outlet " + n, enabled: false, reason: "That outlet is not on this PDU.", };
  }
  const reason = outletReason(outlet);
  if (!reason) return { suggestion, label: verb + " outlet " + n, enabled: true, reason: "" };
  let short = "not available";
  if (!state.user) short = "requires sign-in";
  else if (state.user.role === "ReadOnly") short = "requires Operator";
  else if (reason.indexOf("maintenance") !== -1 || reason.indexOf("Unbound") !== -1) short = "requires a maintenance window";
  else if (reason.indexOf("RM1048") !== -1) short = "held for RM1048";
  return { suggestion, label: verb + " outlet " + n + " – " + short, enabled: false, reason };
}

export function gateAction(input: ExplainInput, result: ExplainResult): GatedAction {
  const suggestion = result.suggestion;
  if (suggestion === "cycle-outlet") return blockedOutlet(input.outlet, "Cycle", suggestion);
  if (suggestion === "shed-outlet") return blockedOutlet(input.outlet, "Shed", suggestion);
  if (suggestion === "none") {
    if (input.signal === "waiting") {
      return {
        suggestion,
        label: "Wait for ACS serial",
        enabled: false,
        reason: "ACS serial is still inside the 30 second failover.",
      };
    }
    return {
      suggestion,
      label: "No control change",
      enabled: false,
      reason: "The analyzer did not suggest a control change.",
    };
  }
  if (suggestion === "open-acs-serial" || suggestion === "open-acs-kvm") {
    const mapped = input.deviceId ? deviceById(input.deviceId) : null;
    if (!mapped) {
      return { suggestion, label: "Open ACS serial", enabled: false, reason: "ACS-A14 opens consoles only inside rack A14." };
    }
    if (suggestion === "open-acs-kvm" && !mapped.mpu) {
      return { suggestion, label: "Open ACS KVM", enabled: false, reason: "This device has no MPU KVM port." };
    }
    return {
      suggestion,
      label: suggestion === "open-acs-kvm" ? "Open ACS KVM" : "Open ACS serial",
      enabled: true,
      reason: "",
    };
  }
  if (suggestion === "open-server" || suggestion === "open-inlet") {
    if (!input.deviceId) {
      return { suggestion, label: "Open server", enabled: false, reason: "No device is tied to this alarm." };
    }
    return {
      suggestion,
      label: suggestion === "open-inlet" ? "Open inlet" : "Open server",
      enabled: true,
      reason: "",
    };
  }
  if (suggestion === "open-rack") return { suggestion, label: "Open rack", enabled: true, reason: "" };
  return { suggestion: "open-control", label: "Open control", enabled: true, reason: "" };
}
