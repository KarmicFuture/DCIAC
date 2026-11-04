import { fmt } from "../domain/audit";
import { state } from "../state";
import { esc } from "../ui/format";
import { pills } from "../ui/shell";

export function renderAudit() {
  const rows = state.audit.map((a) => "<tr><td>" + esc(fmt(a.t)) + "</td><td>" + esc(a.user) + "</td><td>" +
    esc(a.role) + "</td><td>" + esc(a.action) + "</td><td>" + esc(a.asset) + "</td><td>" + esc(a.outlet) +
    "</td><td>" + esc(a.wo) + "</td><td>" + esc(a.detail) + "</td></tr>").join("");
  const table = state.audit.length
    ? '<div class="table-wrap"><table><thead><tr><th>Time</th><th>User</th><th>Role</th><th>Action</th><th>Asset</th><th>Outlet</th><th>WO</th><th>Detail</th></tr></thead><tbody>' +
      rows + "</tbody></table></div>"
    : '<p class="empty">No acts yet.</p>';
  return '<div class="page-head"><div class="top"><div><h1>Audit</h1>' +
    '<p class="sub">Every console session and every outlet or DI act is logged with the identity on the act.</p></div></div>' +
    pills() + '</div><section class="panel"><h2>Log</h2>' + table + "</section>";
}
