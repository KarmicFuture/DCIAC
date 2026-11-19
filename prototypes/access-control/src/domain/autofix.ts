/* AI-determined corrective action on a launched ACS serial session.

   The story: a GPU tray reboots after a BIOS update, the update resets the boot
   order, network boot fails, and the tray stops at the UEFI shell. The OS never
   loads, so SSH and RDP are dark. acs.watch sees the shell and raises a P1.

   The analyzer then works the console the way a person would:
   1. Read-only check: bcfg boot dump. Nothing changes.
   2. Decide: Ubuntu (Boot0003) is last behind PXE and HTTP boot.
   3. Act: runbook RB-UEFI-01 moves Boot0003 first and resets the tray.
      It is pre-approved for automatic runs because it changes only the boot
      order over serial. It never touches outlet power.
   4. Verify: the tray boots, acs.watch logs in, the alarm clears.

   Every step is written to the audit log with who ran it. */

import { deviceById } from "../data/devices";
import { runtime, state } from "../state";
import { render } from "../ui/schedule";
import { writeTermLines } from "../ui/terminal";
import { BOOT_RUNBOOK } from "./analyzer";
import { audit, userAudit } from "./audit";
import { openSession, serialPrompt, sessionById } from "./sessions";

/* Streamed console output waits in one queue. A single timer plays it out a line
   at a time. finishFix() plays the rest at once, so a demo step can jump ahead
   without leaving a half-written console behind. */
type QueueItem = { sessionId: string; line: string } | { run: () => void };

const fix = {
  queue: [] as QueueItem[],
  timer: 0 as any,
  lineMs: 160,
};

export function setFixLineMs(ms) {
  fix.lineMs = Math.max(0, Number(ms) || 0);
}

export function cancelFix() {
  if (fix.timer) clearTimeout(fix.timer);
  fix.timer = 0;
  fix.queue = [];
}

function apply(item: QueueItem, live: boolean) {
  if ("run" in item) {
    item.run();
    return;
  }
  const session = sessionById(item.sessionId);
  if (!session) return;
  if (!session.lines) session.lines = [];
  session.lines.push(item.line);
  if (live && !writeTermLines(item.sessionId, [item.line])) render();
}

function pump() {
  if (fix.timer || !fix.queue.length) return;
  fix.timer = setTimeout(() => {
    fix.timer = 0;
    const item = fix.queue.shift();
    if (item) apply(item, true);
    pump();
  }, fix.lineMs);
}

export function finishFix() {
  if (fix.timer) clearTimeout(fix.timer);
  fix.timer = 0;
  while (fix.queue.length) {
    const item = fix.queue.shift();
    if (item) apply(item, false);
  }
}

function record(auto, action, asset, detail) {
  if (auto) {
    audit({ user: "analyzer", role: "automatic", action, asset, detail });
    return;
  }
  userAudit(action, { asset, detail, wo: "" });
}

/* Queue lines for a session so they scroll in like a live serial line, then run
   done once the last line is out. */
function stream(sessionId, lines, done?: () => void) {
  lines.forEach((line) => fix.queue.push({ sessionId, line }));
  fix.queue.push({
    run() {
      render();
      if (done) done();
    },
  });
  if (!fix.lineMs) finishFix();
  else pump();
}

function typed(d, session, command) {
  return serialPrompt(d, session) + " " + command;
}

export function breakBoot(deviceId) {
  const d = deviceById(deviceId);
  if (!d) return;
  d.bootStuck = true;
  audit({
    user: d.short,
    role: "BMC",
    action: "host reset",
    asset: d.name,
    detail: "BIOS update stage 2 complete. Host reset on " + d.tty + ".",
  });
}

export function clearBoot(deviceId) {
  const d = deviceById(deviceId);
  if (d) d.bootStuck = false;
}

/* Open ACS serial straight from the P1 alarm. The incident is the reason, so the
   session does not wait on a work order. */
export function launchAlarmSerial(deviceId) {
  const d = deviceById(deviceId);
  if (!d) return "";
  runtime.consolePass = true;
  try {
    openSession(deviceId, "acs", "serial", "rs232");
  } finally {
    runtime.consolePass = false;
  }
  const session = state.sessions.find((item) => item.deviceId === deviceId && item.path === "acs" && item.type === "serial");
  if (!session) return "";
  audit({
    user: "acs.watch",
    role: "automatic",
    action: "session launched from alarm",
    asset: d.name,
    detail: "P1 on " + d.tty + ": stopped at the UEFI shell. ACS serial session " + session.id + " opened.",
  });
  return session.id;
}

export function diagnoseBoot(sessionId, auto, done?: () => void) {
  const session = sessionById(sessionId);
  const d = session ? deviceById(session.deviceId) : null;
  if (!session || !d) return;
  record(auto, "read-only check", d.name, "bcfg boot dump -s on " + d.tty + ". No change made.");
  stream(sessionId, [
    typed(d, session, "bcfg boot dump -s"),
    "Option: 00. Variable: Boot0000",
    "  Desc    - UEFI PXE IPv4 (net0)",
    "Option: 01. Variable: Boot0001",
    "  Desc    - UEFI HTTP IPv4 (net0)",
    "Option: 02. Variable: Boot0003",
    "  Desc    - ubuntu",
    "  DevPath - HD(1,GPT)/\\EFI\\ubuntu\\shimx64.efi",
  ], () => {
    session.bootDiagnosed = true;
    record(auto, "diagnosis", d.name,
      "Boot order reset by the BIOS update. Network boot is first; ubuntu (Boot0003) is last. Confidence 93%.");
    render();
    if (done) done();
  });
}

export function fixBoot(sessionId, auto, done?: () => void) {
  const session = sessionById(sessionId);
  const d = session ? deviceById(session.deviceId) : null;
  if (!session || !d) return;
  record(auto, auto ? "runbook " + BOOT_RUNBOOK + " run (pre-approved)" : "runbook " + BOOT_RUNBOOK + " run", d.name,
    "bcfg boot mv 02 00, then reset, on " + d.tty + ". Boot order only. No outlet power change.");
  stream(sessionId, [
    typed(d, session, "bcfg boot mv 02 00"),
    "Moved Boot0003 (ubuntu) to position 00.",
    typed(d, session, "reset"),
    "Resetting system...",
  ], () => {
    session.prompt = d.short + " login:";
    stream(sessionId, [
      "",
      "[BMC] Host reset",
      "[UEFI] Boot mode UEFI",
      "[UEFI] Boot0003 ubuntu  HD(1,GPT)/\\EFI\\ubuntu\\shimx64.efi",
      "[    0.000000] Linux version 6.8.0-49-generic (buildd@lcy02-amd64) #49-Ubuntu SMP",
      "[    3.912204] nvme nvme0: 8/0/0 default/read/poll queues",
      "[    6.402118] nvidia: loading out-of-tree module, 4 GPUs found",
      "[  OK  ] Started nvidia-fabricmanager.service - NVIDIA fabric manager.",
      "[  OK  ] Reached target multi-user.target - Multi-User System.",
      "",
      "Ubuntu 24.04.2 LTS " + d.short + " " + d.tty,
      "",
    ], () => {
      if (done) done();
    });
  });
}

export function verifyBoot(sessionId, auto) {
  const session = sessionById(sessionId);
  const d = session ? deviceById(session.deviceId) : null;
  if (!session || !d) return;
  d.bootStuck = false;
  session.bootFixed = true;
  session.lines = session.lines || [];
  session.lines.push("[acs.watch] Automatic login ok on " + d.tty + ". Ubuntu shell answered. SSH is reachable again.");
  record(auto, "fix verified", d.name, "acs.watch logged in on " + d.tty + ". P1 cleared. In-band SSH and RDP are back.");
  state.toast = d.name + " is back on Ubuntu. The P1 alarm cleared.";
  render();
}

/* Full automatic response, used by the Explain button and by the demo. */
export function runBootFix(sessionId, auto) {
  const session = sessionById(sessionId);
  if (!session) return;
  if (!session.bootDiagnosed) {
    diagnoseBoot(sessionId, auto, () => fixBoot(sessionId, auto, () => verifyBoot(sessionId, auto)));
    return;
  }
  fixBoot(sessionId, auto, () => verifyBoot(sessionId, auto));
}
