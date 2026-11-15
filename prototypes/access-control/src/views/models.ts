import { MODELS, applyModels } from "../data/library";
import { authHeaders } from "../data/repository";
import { state } from "../state";
import { esc } from "../ui/format";
import { render } from "../ui/schedule";
import { pills, themeButton } from "../ui/shell";

const FIELDS = [
  ["manufacturer", "Manufacturer", "text"],
  ["model", "Model", "text"],
  ["category", "Category", "text"],
  ["place", "Place", "text"],
  ["uHeight", "Height U", "number"],
  ["depthMm", "Depth mm", "number"],
  ["weightKg", "Weight kg", "number"],
  ["nameplateW", "Nameplate W", "number"],
  ["typicalW", "Typical W", "number"],
  ["deratedW", "Derated W", "number"],
  ["inputVoltage", "Voltage", "text"],
  ["plugType", "Plug", "text"],
  ["powerPorts", "Power ports", "number"],
  ["powerPortType", "Power connector", "text"],
  ["powerRedundancy", "Redundancy", "text"],
  ["netPorts", "Network ports", "number"],
  ["netSpeed", "Network speed", "text"],
  ["netMedia", "Network media", "text"],
  ["redfishType", "Redfish type", "text"],
];

function blank() {
  return { id: "", manufacturer: "", model: "", category: "Server", place: "rack", uHeight: 1, nameplateW: 0, note: "" };
}

function current() {
  if (state.modelEdit === "new") return blank();
  return MODELS.find((item) => item.id === state.modelEdit) || null;
}

export async function reloadModels() {
  const response = await fetch("/api/v1/models", { cache: "no-store" });
  const body = await response.json();
  applyModels(body.models || []);
}

async function send(path, method, payload) {
  const response = await fetch(path, { method, headers: authHeaders(), body: JSON.stringify(payload || {}) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    state.toast = body.error || "The model change was refused.";
    render();
    return false;
  }
  await reloadModels();
  return body;
}

export async function saveModel(form) {
  const data = new FormData(form);
  const payload: any = { note: String(data.get("note") || "") };
  FIELDS.forEach((field) => {
    const raw = String(data.get(field[0]) || "");
    payload[field[0]] = field[2] === "number" ? Number(raw || 0) : raw;
  });
  const creating = state.modelEdit === "new";
  if (creating) payload.id = String(data.get("id") || "").trim();
  const path = creating ? "/api/v1/models" : "/api/v1/models/" + encodeURIComponent(state.modelEdit);
  const saved = await send(path, creating ? "POST" : "PATCH", payload);
  if (!saved) return;
  state.modelEdit = "";
  state.toast = (saved.model || "Model") + " saved.";
  render();
}

export async function cloneModel(id) {
  const saved = await send("/api/v1/models/" + encodeURIComponent(id) + "/clone", "POST", {});
  if (!saved) return;
  state.modelEdit = saved.id;
  state.toast = saved.model + " cloned.";
  render();
}

export async function importModels(file) {
  const csv = await file.text();
  const saved = await send("/api/v1/models/import", "POST", { csv });
  if (!saved) return;
  state.toast = "Imported " + (saved.imported || []).length + " models.";
  render();
}

function field(name, label, kind, value) {
  return '<label>' + esc(label) + '<input name="' + name + '" type="' + kind + '" value="' + esc(value == null ? "" : String(value)) + '"></label>';
}

function formHtml(model) {
  const id = state.modelEdit === "new"
    ? '<label>Id<input name="id" required placeholder="dell-r760"></label>'
    : '<label>Id<input value="' + esc(model.id) + '" disabled></label>';
  const fields = FIELDS.map((item) => field(item[0], item[1], item[2], model[item[0]])).join("");
  return '<form class="model-form" data-act="model-save">' + id + fields +
    '<label class="model-note">Note<textarea name="note">' + esc(model.note || "") + "</textarea></label>" +
    '<div class="model-actions"><button type="submit" class="act">Save</button>' +
    '<button type="button" class="act" data-act="model-cancel">Cancel</button></div></form>';
}

export function renderModels() {
  const admin = state.user && state.user.role === "Administrator";
  const editing = current();
  const rows = MODELS.map((model) => "<tr><td>" + esc(model.manufacturer) + "</td><td>" + esc(model.model) +
    "</td><td>" + esc(model.category) + "</td><td>" + esc(model.place || "plant") + "</td><td>" +
    (model.uHeight || 0) + "U</td><td>" + (model.nameplateW || 0) + " W</td><td>" + (model.usedBy || 0) + "</td><td>" +
    (admin ? '<button type="button" class="act" data-act="model-edit" data-id="' + esc(model.id) + '">Edit</button> ' +
      '<button type="button" class="act" data-act="model-clone" data-id="' + esc(model.id) + '">Clone</button>' : "") +
    "</td></tr>").join("");
  const tools = admin
    ? '<div class="model-tools"><button type="button" class="act" data-act="model-new">Add model</button>' +
      '<label class="act file">Import CSV<input type="file" accept=".csv,text/csv" data-csv-models="1"></label></div>'
    : '<p class="fine">Read only. An administrator can add or change models.</p>';
  return '<div class="page-head"><div class="top"><div><h1>Models</h1><p class="sub">Every device type the floor can place. Used by counts the assets that already use it.</p></div>' +
    themeButton() + "</div>" + pills() + "</div><section class=\"panel\"><h2>Library</h2>" + tools +
    (editing ? formHtml(editing) : "") +
    '<div class="table-wrap"><table><thead><tr><th>Manufacturer</th><th>Model</th><th>Category</th><th>Place</th><th>U</th><th>Nameplate</th><th>Used by</th><th></th></tr></thead><tbody>' +
    rows + "</tbody></table></div></section>";
}
