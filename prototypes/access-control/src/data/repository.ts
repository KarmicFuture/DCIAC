import { applyModels } from "./library";
import { PLANT, PODS, YARD, seedHallTelemetry } from "./pods";
import { state } from "../state";

function children(world, parentId, kind) {
  return world.locations.filter((item) => item.parentId === parentId && item.kind === kind);
}

function assetAt(world, locationId) {
  return world.assets.find((item) => item.locationId === locationId);
}

function applyPlant(plant) {
  Object.assign(PLANT, plant);
}

function hallFrom(world, hall) {
  const custom = hall.custom || {};
  const rows = children(world, hall.id, "row");
  const racks = [];
  rows.forEach((row) => {
    children(world, row.id, "rack").forEach((slot) => {
      const asset = assetAt(world, slot.id);
      if (!asset) return;
      const box = asset.custom || {};
      racks.push({
        id: box.rackId,
        name: box.name || asset.assetTag,
        kind: box.kind || "GPU",
        row: box.row,
        x: box.x,
        y: box.y,
        w: box.w,
        d: box.d,
        h: box.h,
        servers: box.servers || [],
        n: box.n || 0,
        assetId: asset.id,
      });
    });
  });
  racks.sort((a, b) => a.n - b.n);
  const here = world.assets.filter((item) => item.locationId === hall.id);
  const aisle = (item) => item.custom || {};
  const boxes = here.filter((item) => item.custom && item.custom.floor === "box").map((item) => ({
    id: item.id,
    x: item.custom.x,
    y: item.custom.y,
    w: item.custom.w,
    d: item.custom.d,
    h: item.custom.h,
  }));
  const aisles = here.filter((item) => item.custom && item.custom.floor === "aisle").map((item) => ({
    id: item.id,
    tone: aisle(item).tone,
    label: aisle(item).label,
    x: aisle(item).x,
    y: aisle(item).y,
    w: aisle(item).w,
    h: aisle(item).h,
  }));
  const containment = here.find((item) => item.custom && item.custom.floor === "containment");
  const busbar = here.find((item) => item.custom && item.custom.floor === "busbar");
  return {
    id: hall.id,
    name: hall.name,
    letter: custom.letter,
    managed: !!custom.managed,
    itMw: PLANT.hallItMw,
    cduMw: PLANT.cduMw,
    x: custom.x,
    y: custom.y,
    w: custom.w,
    h: custom.h,
    site: custom.site,
    racks,
    boxes,
    fit: {
      aisles,
      rows: rows.map((row) => ({
        id: row.id,
        name: row.name,
        y: row.custom.y,
        cold: row.custom.cold,
        hot: row.custom.hot,
      })),
      containment: containment ? { id: containment.id, x: containment.custom.x, y: containment.custom.y, w: containment.custom.w, d: containment.custom.d, h: containment.custom.h } : null,
      busbar: busbar ? { id: busbar.id, x: busbar.custom.x, y: busbar.custom.y, w: busbar.custom.w, d: busbar.custom.d, h: busbar.custom.h } : null,
    },
  };
}

export function applyWorld(world) {
  applyPlant(world.plant || {});
  const halls = world.locations
    .filter((item) => item.kind === "hall")
    .sort((a, b) => (a.custom.index || 0) - (b.custom.index || 0))
    .map((hall) => hallFrom(world, hall));
  const yard = world.assets
    .filter((item) => item.custom && item.custom.floor === "yard")
    .map((item) => ({
      id: item.id,
      name: item.custom.name || item.assetTag,
      kind: item.custom.kind,
      x: item.custom.x,
      y: item.custom.y,
      w: item.custom.w,
      d: item.custom.d,
      h: item.custom.h,
      power: item.custom.power,
      temp: item.custom.temp,
      klass: item.custom.klass,
      assetId: item.id,
    }));
  PODS.splice(0, PODS.length, ...halls);
  YARD.splice(0, YARD.length, ...yard);
  applyModels(world.models || []);
  seedHallTelemetry();
}

export function authHeaders() {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (state.user) {
    headers["X-Dciac-User"] = state.user.id;
    headers["X-Dciac-Role"] = state.user.role;
    if (state.user.token) headers.Authorization = "Bearer " + state.user.token;
    if (state.user.tenantId) headers["X-Dciac-Tenant"] = state.user.tenantId;
  }
  return headers;
}

export async function loadWorld() {
  const headers: Record<string, string> = {};
  if (state.user && state.user.tenantId) headers["X-Dciac-Tenant"] = state.user.tenantId;
  let response: Response | null = null;
  try {
    response = await fetch("/api/v1/world", { cache: "no-store", headers });
  } catch (err) {
    response = null;
  }
  if (!response || !response.ok) {
    response = await fetch(import.meta.env.BASE_URL + "world.json", { cache: "no-store" });
  }
  if (!response.ok) throw new Error("Asset repository returned " + response.status);
  const world = await response.json();
  if (!world || !Array.isArray(world.locations) || !world.locations.length) {
    throw new Error("Asset repository is empty.");
  }
  applyWorld(world);
  return world;
}
