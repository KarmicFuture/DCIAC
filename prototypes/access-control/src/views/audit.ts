import { fmt } from "../domain/audit";
import { state } from "../state";
import { getAuditFilter } from "../ui/ask";
import { esc } from "../ui/format";
import { headButtons, pills } from "../ui/shell";

const FILTERS = [["all", "All"], ["manual", "Manual"], ["ask", "via Ask"]];

export function renderAudit() {
  const filter = getAuditFilter();
  const list = state.audit.filter((a) => filter === "all" || (filter === "ask" ? a.via === "ask" : a.via !== "ask"));
  const rows = list.map((a) => "<tr" + (a.via === "ask" ? ' data-via="ask"' : "") + "><td>" + esc(fmt(a.t)) + "</td><td>" + esc(a.user) + "</td><td>" +
    esc(a.role) + "</td><td>" + esc(a.action) + (a.via === "ask" ? ' <span class="pill via-ask">via Ask</span>' : "") + "</td><td>" + esc(a.asset) + "</td><td>" + esc(a.outlet) +
    "</td><td>" + esc(a.wo) + "</td><td>" + esc(a.detail) + "</td></tr>").join("");
  const table = list.length
    ? '<div class="table-wrap"><table><thead><tr><th>Time</th><th>User</th><th>Role</th><th>Action</th><th>Asset</th><th>Outlet</th><th>WO</th><th>Detail</th></tr></thead><tbody>' +
      rows + "</tbody></table></div>"
    : '<p class="empty">' + (state.audit.length ? "No entries match this filter." : "No acts yet.") + "</p>";
  const chips = '<div class="audit-filter" role="group" aria-label="Filter the log">' + FILTERS.map(([id, label]) =>
    '<button type="button" class="act" data-act="audit-filter" data-filter="' + id + '" aria-pressed="' + (filter === id) + '">' + label + "</button>").join("") + "</div>";
  return '<div class="page-head"><div class="top"><div><h1>Audit</h1>' +
    '<p class="sub">Every console session and every outlet or DI act is logged with the identity on the act. Questions and actions from Ask are tagged “via Ask”.</p></div>' + headButtons() + "</div>" +
    pills() + '</div><section class="panel"><h2>Log</h2>' + chips + table + "</section>";
}
