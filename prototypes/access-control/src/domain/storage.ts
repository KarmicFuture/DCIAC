import { devices } from "../data/devices";
import { outlets } from "../data/outlets";
import { runtime, state } from "../state";

const KEY = "dciac.world";

function readStore() {
  try {
    return localStorage.getItem(KEY);
  } catch (err) {
    return null;
  }
}

function writeStore(value) {
  try {
    localStorage.setItem(KEY, value);
  } catch (err) {
    /* private mode and blocked storage still leave the page usable */
  }
}

export function saveWorld() {
  try {
    const snapshot = {
      seq: runtime.seq,
      sessions: state.sessions,
      audit: state.audit,
      acked: state.acked,
      leak: state.leak,
      maintenance: state.maintenance,
      maintName: state.maintName,
      maintWo: state.maintWo,
      rm1048: state.rm1048,
      assetTag: state.assetTag,
      assetTagDraft: state.assetTagDraft,
      outlets: outlets.map((outlet) => ({ n: outlet.n, power: outlet.power })),
      devices: devices.map((device) => ({
        id: device.id,
        bmc: device.bmc,
        rdp: device.rdp,
        watchDeny: !!device.watchDeny,
        bmcLostAt: device.bmcLostAt,
        serialReadyAt: device.serialReadyAt,
        serialAnnounced: device.serialAnnounced,
        serialFailoverTotal: device.serialFailoverTotal,
        load: device.load || null,
      })),
    };
    writeStore(JSON.stringify(snapshot));
  } catch (err) {
    /* a snapshot that cannot be serialized is skipped */
  }
}

export function restoreWorld() {
  try {
    const raw = readStore();
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return;
    if (typeof data.seq === "number" && data.seq >= 0) runtime.seq = data.seq;
    if (Array.isArray(data.sessions)) state.sessions = data.sessions;
    if (Array.isArray(data.audit)) state.audit = data.audit;
    if (data.acked && typeof data.acked === "object") state.acked = data.acked;
    if (typeof data.leak === "boolean") state.leak = data.leak;
    if (data.maintenance && typeof data.maintenance.name === "string") state.maintenance = { name: data.maintenance.name, wo: data.maintenance.wo || "" };
    else if (data.maintenance === null) state.maintenance = null;
    if (typeof data.maintName === "string") state.maintName = data.maintName;
    if (typeof data.maintWo === "string") state.maintWo = data.maintWo;
    if (data.rm1048 === "healthy" || data.rm1048 === "dark") state.rm1048 = data.rm1048;
    if (typeof data.assetTag === "string" && data.assetTag) {
      state.assetTag = data.assetTag;
      state.assetTagDraft = typeof data.assetTagDraft === "string" ? data.assetTagDraft : data.assetTag;
    }
    if (Array.isArray(data.outlets)) {
      data.outlets.forEach((saved) => {
        const outlet = outlets.find((item) => item.n === saved.n);
        if (!outlet) return;
        if (saved.power === "on" || saved.power === "off" || saved.power === "cycling") outlet.power = saved.power;
      });
    }
    if (Array.isArray(data.devices)) {
      data.devices.forEach((saved) => {
        const device = devices.find((item) => item.id === saved.id);
        if (!device || !saved) return;
        if (saved.bmc === "up" || saved.bmc === "down") device.bmc = saved.bmc;
        if (saved.rdp === "up" || saved.rdp === "down") device.rdp = saved.rdp;
        if (typeof saved.watchDeny === "boolean") device.watchDeny = saved.watchDeny;
        if (typeof saved.bmcLostAt === "number") device.bmcLostAt = saved.bmcLostAt;
        if (typeof saved.serialReadyAt === "number") device.serialReadyAt = saved.serialReadyAt;
        if (typeof saved.serialAnnounced === "boolean") device.serialAnnounced = saved.serialAnnounced;
        if (typeof saved.serialFailoverTotal === "number") device.serialFailoverTotal = saved.serialFailoverTotal;
        if (saved.load && typeof saved.load === "object") device.load = saved.load;
      });
    }
    state.sessions.forEach((session) => {
      const match = /^s(\d+)$/.exec(session && session.id || "");
      if (match) runtime.seq = Math.max(runtime.seq, Number(match[1]));
    });
  } catch (err) {
    /* corrupt or blocked storage leaves the seeded world in place */
  }
}
