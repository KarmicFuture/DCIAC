import { state } from "../state";

export function fmt(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function maintenanceOpen() {
  return !!(state.maintenance && state.maintenance.name);
}

export function currentWo() {
  const typed = (state.wo || "").trim();
  if (typed) return typed;
  if (state.maintenance && state.maintenance.wo) return state.maintenance.wo;
  return "";
}

export function audit(entry) {
  state.audit.unshift({
    t: Date.now(),
    user: entry.user || "",
    role: entry.role || "",
    action: entry.action || "",
    asset: entry.asset || "",
    outlet: entry.outlet || "",
    wo: entry.wo || "",
    detail: entry.detail || "",
  });
  if (state.audit.length > 300) state.audit.length = 300;
}

export function userAudit(action, extra) {
  audit(Object.assign({
    user: state.user.id,
    role: state.user.role,
    action,
    wo: currentWo(),
  }, extra || {}));
}
