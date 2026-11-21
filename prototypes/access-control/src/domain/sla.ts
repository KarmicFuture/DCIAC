/* Alarm SLA: how long an alarm has been open and when it escalates.
   An unacknowledged alarm escalates once its priority's acknowledge window runs out.
   Acknowledging stops the escalation clock; the open time keeps counting. */

import { state } from "../state";

/* Minutes to acknowledge before an alarm escalates, by priority. */
export const SLA_MINUTES = { 1: 15, 2: 60, 3: 240 };

export function slaWindowMs(pri: number): number {
  return (SLA_MINUTES[pri] || SLA_MINUTES[3]) * 60000;
}

export function shortDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  return h + "h " + String(m % 60).padStart(2, "0") + "m";
}

export interface SlaStatus {
  openMs: number;
  leftMs: number;
  escalated: boolean;
  acked: boolean;
  label: string;
}

/* Pure: the timer line for one alarm at time `now`. */
export function slaStatus(pri: number, since: number, now: number, acked: boolean): SlaStatus {
  const openMs = Math.max(0, now - since);
  const leftMs = slaWindowMs(pri) - openMs;
  const escalated = !acked && leftMs <= 0;
  const open = "Open " + shortDuration(openMs);
  let label;
  if (acked) label = "Acked · " + open.toLowerCase();
  else if (escalated) label = "Escalated " + shortDuration(-leftMs) + " ago · " + open.toLowerCase();
  else label = open + " · escalates in " + shortDuration(leftMs + 999);
  return { openMs, leftMs, escalated, acked, label };
}

/* Records when each alarm was first seen at its current priority, and forgets cleared ones. */
export function trackSince(alarms: { id: string; pri: number }[], now = Date.now()): Record<string, number> {
  const seen = state.alarmSince;
  const live = {};
  alarms.forEach((alarm) => {
    const prev = seen[alarm.id];
    live[alarm.id] = prev && prev.pri === alarm.pri ? prev : { pri: alarm.pri, at: now };
  });
  state.alarmSince = live;
  const out = {};
  Object.keys(live).forEach((id) => { out[id] = live[id].at; });
  return out;
}

export function slaHtml(alarm: { id: string; pri: number; since?: number }): string {
  const since = alarm.since || Date.now();
  const status = slaStatus(alarm.pri, since, Date.now(), !!state.acked[alarm.id]);
  return '<span class="alarm-sla' + (status.escalated ? " is-escalated" : "") + '" data-sla-alarm="' + alarm.id +
    '" data-since="' + since + '" data-pri="' + alarm.pri + '">' + status.label + "</span>";
}

/* Repaints the timers in place every tick, without a full render. */
export function updateAlarmTimers(now = Date.now()) {
  document.querySelectorAll<HTMLElement>("[data-sla-alarm]").forEach((el) => {
    const id = el.dataset.slaAlarm;
    const status = slaStatus(Number(el.dataset.pri), Number(el.dataset.since), now, !!state.acked[id]);
    if (el.textContent !== status.label) el.textContent = status.label;
    el.classList.toggle("is-escalated", status.escalated);
  });
}

/* Test and demo hook: pretend an alarm has been open `ms` longer. */
export function ageAlarm(id: string, ms: number) {
  const entry = state.alarmSince[id];
  if (!entry) return false;
  entry.at -= ms;
  document.querySelectorAll<HTMLElement>('[data-sla-alarm="' + id + '"]').forEach((el) => { el.dataset.since = String(entry.at); });
  updateAlarmTimers();
  return true;
}
