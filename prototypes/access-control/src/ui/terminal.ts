import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";
import { deviceById } from "../data/devices";
import { serialPathLabel, serialPrompt, sessionById, shellReply, consoleKind } from "../domain/sessions";
import { saveWorld } from "../domain/storage";
import { sessionBlocked } from "../domain/single-master";
import { state } from "../state";
import { render } from "./schedule";

const live = new Map();

function inputClosed(session) {
  if (!session) return true;
  if (sessionBlocked(session)) return true;
  return !!(state.user && state.user.role === "ReadOnly");
}

function trim(session) {
  if (session.lines && session.lines.length > 2000) {
    session.lines.splice(0, session.lines.length - 2000);
  }
}

export function logText(session) {
  const mapped = deviceById(session.deviceId);
  const who = state.user ? state.user.id + " · " + state.user.role : "";
  const lines = (session.lines || []).slice();
  if (mapped && session.entry) lines.push(serialPrompt(mapped, session) + " " + session.entry);
  return [serialPathLabel(mapped, session), who, ""].concat(lines).join("\n") + "\n";
}

function breakLines(mapped) {
  const kind = consoleKind(mapped);
  if (kind === "ios") return ["[BREAK]", "% Break received. Returning to the exec prompt."];
  if (kind === "uefi") return ["[BREAK]", "UEFI shell interrupt. Still at the shell."];
  return ["[BREAK]"];
}

function onTermData(id, term, data) {
  const session = sessionById(id);
  if (!session || inputClosed(session)) return;
  const mapped = deviceById(session.deviceId);
  if (!mapped) return;
  if (data.charCodeAt(0) === 27) return;
  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    if (ch === "\r" || ch === "\n") {
      const text = session.entry || "";
      session.entry = "";
      session.lines.push(serialPrompt(mapped, session) + (text ? " " + text : ""));
      const reply = shellReply(mapped, text);
      reply.forEach((line) => session.lines.push(line));
      trim(session);
      saveWorld();
      term.write("\r\n");
      if (reply.length) term.write(reply.join("\r\n") + "\r\n");
      term.write(serialPrompt(mapped, session) + " ");
      if (ch === "\r" && data[i + 1] === "\n") i += 1;
      continue;
    }
    if (ch === "\x7f" || ch === "\b") {
      if (session.entry) {
        session.entry = session.entry.slice(0, -1);
        term.write("\b \b");
      }
      continue;
    }
    if (ch === "\x03") {
      session.lines.push(serialPrompt(mapped, session) + " ^C");
      session.entry = "";
      term.write("^C\r\n" + serialPrompt(mapped, session) + " ");
      continue;
    }
    if (ch < " ") continue;
    session.entry = (session.entry || "") + ch;
    term.write(ch);
  }
}

function openTerm(host, id) {
  const session = sessionById(id);
  const mapped = session ? deviceById(session.deviceId) : null;
  const closed = !session || !mapped || inputClosed(session);
  const term = new Terminal({
    cursorBlink: !closed,
    scrollback: 2000,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 13,
    theme: {
      background: "#141414",
      foreground: "#e7d7c4",
      cursor: "#c45c26",
      selectionBackground: "#6b3a22",
    },
    disableStdin: closed,
  });
  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.open(host);
  if (session && mapped) {
    const lines = session.lines || [];
    const prompt = serialPrompt(mapped, session) + " " + (closed ? "" : (session.entry || ""));
    term.write((lines.length ? lines.join("\r\n") + "\r\n" : "") + prompt);
  }
  if (!closed) term.onData((data) => onTermData(id, term, data));
  const wrap = host.closest(".term-wrap");
  const query = wrap ? wrap.querySelector("[data-term-query]") : null;
  if (query && !query.dataset.bound) {
    query.dataset.bound = "1";
    query.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      searchTerm(id, query.value);
    });
  }
  const fitNow = () => {
    if (!host.isConnected) return;
    try { fit.fit(); } catch (err) { /* host not laid out yet */ }
  };
  requestAnimationFrame(fitNow);
  return { host, term, fit, search, dispose() { term.dispose(); } };
}

export function mountTerminals() {
  const hosts = document.querySelectorAll("[data-xterm]");
  const seen = new Set();
  hosts.forEach((host) => {
    const id = host.getAttribute("data-xterm");
    if (!id) return;
    seen.add(id);
    const current = live.get(id);
    if (current && current.host === host) {
      try { current.fit.fit(); } catch (err) { /* hidden */ }
      return;
    }
    if (current) current.dispose();
    live.set(id, openTerm(host, id));
  });
  Array.from(live.keys()).forEach((id) => {
    if (seen.has(id)) return;
    live.get(id).dispose();
    live.delete(id);
  });
}

export function focusTerm(id) {
  const slot = live.get(id);
  if (!slot || slot.term.options.disableStdin) return;
  slot.term.focus();
}

function copyWith(text, done) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    return;
  }
  fallbackCopy(text, done);
}

function fallbackCopy(text, done) {
  const area = document.createElement("textarea");
  area.value = text;
  document.body.appendChild(area);
  area.select();
  try { document.execCommand("copy"); } catch (err) { /* clipboard blocked */ }
  area.remove();
  done();
}

export function copyTerm(id) {
  const session = sessionById(id);
  const slot = live.get(id);
  const selected = slot ? slot.term.getSelection() : "";
  const text = selected || (session ? logText(session) : "");
  if (!text.trim()) return;
  copyWith(text, () => {
    state.toast = selected ? "Copied the selection." : "Copied the session log.";
    render();
  });
}

export function searchTerm(id, query) {
  const slot = live.get(id);
  if (!slot) return;
  const q = String(query || "");
  if (!q.trim()) return;
  const hit = slot.search.findNext(q, { caseSensitive: false });
  state.toast = hit ? "Found “" + q.trim() + "” in the scrollback." : "No match in the scrollback.";
  render();
}

export function sendBreak(id) {
  const session = sessionById(id);
  if (!session || session.type !== "serial" || inputClosed(session)) return;
  const mapped = deviceById(session.deviceId);
  if (!mapped) return;
  if (session.entry) {
    session.lines.push(serialPrompt(mapped, session) + " " + session.entry);
    session.entry = "";
  }
  const note = breakLines(mapped);
  note.forEach((line) => session.lines.push(line));
  trim(session);
  saveWorld();
  const slot = live.get(id);
  if (slot) slot.term.write("\r\n" + note.join("\r\n") + "\r\n" + serialPrompt(mapped, session) + " ");
}

export function downloadLog(id) {
  const session = sessionById(id);
  if (!session) return;
  const mapped = deviceById(session.deviceId);
  const blob = new Blob([logText(session)], { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = (mapped && mapped.tty ? mapped.tty : "session") + "-" + session.id + ".log";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1500);
}
