/** One year from an empty field to the live 100 MW campus. Dates are inclusive. */

export const BUILD_START = "2026-11-16";
export const BUILD_END = "2027-11-15";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const STAGES = [
  {
    id: "grass",
    name: "Grass field",
    start: "2026-11-16",
    end: "2026-12-31",
    blurb: "The parcel is still turf. Survey stakes mark where the halls will stand. Nothing is energized.",
    arrives: ["Boundary survey and geotech", "Silt fence and a site trailer"],
    grass: true,
    pads: [],
    shells: [],
    live: [],
    gear: [],
    coolers: 0,
    pumps: 0,
    groups: [],
    feeds: false,
    pipes: false,
  },
  {
    id: "civil",
    name: "Pads and roads",
    start: "2027-01-01",
    end: "2027-02-14",
    blurb: "The field is graded into ten hall pads, a west power yard, and an east cooler yard. No steel is up.",
    arrives: ["Mass grading and the loop road", "Ten hall pads", "Duct bank and water main"],
    grass: true,
    pads: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    shells: [],
    live: [],
    gear: [],
    coolers: 0,
    pumps: 0,
    groups: [],
    feeds: false,
    pipes: false,
  },
  {
    id: "utility",
    name: "Utility feeders",
    start: "2027-02-15",
    end: "2027-03-31",
    blurb: "Both utility feeders and both transformers are set on the west yard. The halls are still pads.",
    arrives: ["Feeder A and Feeder B", "Transformer A and Transformer B"],
    grass: false,
    pads: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    shells: [],
    live: [],
    gear: ["grid-1", "grid-2", "xfmr-1", "xfmr-2"],
    coolers: 0,
    pumps: 0,
    groups: [],
    feeds: false,
    pipes: false,
  },
  {
    id: "shells",
    name: "First shells",
    start: "2027-04-01",
    end: "2027-05-15",
    blurb: "Halls 1 through 5 are dried in and empty. Three coolers and a pump skid start the heat-rejection yard.",
    arrives: ["Halls 1–5 shells", "Coolers 1–3", "Pump skid A and the pipe spine"],
    grass: false,
    pads: [5, 6, 7, 8, 9],
    shells: [0, 1, 2, 3, 4],
    live: [],
    gear: ["grid-1", "grid-2", "xfmr-1", "xfmr-2"],
    coolers: 3,
    pumps: 1,
    groups: [],
    feeds: false,
    pipes: true,
  },
  {
    id: "power",
    name: "Power train",
    start: "2027-05-16",
    end: "2027-06-30",
    blurb: "Four power modules and both battery skids can feed the first five halls. Generators and the first chillers sit on the south edge. The halls are still empty shells.",
    arrives: ["Power modules A–D", "Battery skids", "Busway to halls 1–5", "Generators and the first chillers"],
    grass: false,
    pads: [5, 6, 7, 8, 9],
    shells: [0, 1, 2, 3, 4],
    live: [],
    gear: ["grid-1", "grid-2", "xfmr-1", "xfmr-2", "pwr-mod", "pwr-2", "pwr-3", "pwr-4", "batt-1", "batt-2"],
    coolers: 4,
    pumps: 1,
    groups: ["generation", "chiller"],
    feeds: true,
    pipes: true,
  },
  {
    id: "first",
    name: "First 40 MW",
    start: "2027-07-01",
    end: "2027-08-15",
    blurb: "Halls 1–4 take live IT load. Their racks, CDUs, and the inventory placed in those halls are in service. Hall 5 is still a shell.",
    arrives: ["Halls 1–4 commissioned", "Racks and in-hall inventory for those halls", "Cooler 4"],
    grass: false,
    pads: [5, 6, 7, 8, 9],
    shells: [4],
    live: [0, 1, 2, 3],
    gear: ["grid-1", "grid-2", "xfmr-1", "xfmr-2", "pwr-mod", "pwr-2", "pwr-3", "pwr-4", "batt-1", "batt-2"],
    coolers: 4,
    pumps: 1,
    groups: ["generation", "chiller"],
    feeds: true,
    pipes: true,
  },
  {
    id: "south",
    name: "South row",
    start: "2027-08-16",
    end: "2027-09-30",
    blurb: "Halls 5–8 commission. Heat rejection is complete, and cameras, the building system, and the UPS gear are outside. Halls 9 and 10 are shells.",
    arrives: ["Halls 5–8 commissioned", "Coolers 5 and 6", "UPS, busway, cameras, and the BMS", "OneCore"],
    grass: false,
    pads: [],
    shells: [8, 9],
    live: [0, 1, 2, 3, 4, 5, 6, 7],
    gear: ["grid-1", "grid-2", "xfmr-1", "xfmr-2", "pwr-mod", "pwr-2", "pwr-3", "pwr-4", "batt-1", "batt-2", "core-1"],
    coolers: 6,
    pumps: 2,
    groups: ["generation", "chiller", "electrical", "security"],
    feeds: true,
    pipes: true,
  },
  {
    id: "full",
    name: "100 MW",
    start: "2027-10-01",
    end: "2027-11-15",
    blurb: "Halls 9 and 10 commission. The site matches the live campus: every hall, both feeders, and the full cooler yard.",
    arrives: ["Halls 9 and 10 commissioned", "Remaining in-hall inventory", "Site acceptance"],
    grass: false,
    pads: [],
    shells: [],
    live: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    gear: [],
    coolers: 6,
    pumps: 2,
    groups: [],
    feeds: true,
    pipes: true,
  },
];

export function stageOn(iso) {
  const found = STAGES.find((stage) => stage.start <= iso && iso <= stage.end);
  if (found) return found;
  return iso < BUILD_START ? STAGES[0] : STAGES[STAGES.length - 1];
}

export function shiftDate(iso, days) {
  const parts = String(iso || BUILD_START).split("-").map(Number);
  const dt = new Date(Date.UTC(parts[0], (parts[1] || 1) - 1, (parts[2] || 1) + days));
  const next = dt.toISOString().slice(0, 10);
  if (next < BUILD_START) return BUILD_START;
  if (next > BUILD_END) return BUILD_END;
  return next;
}

export function formatDay(iso) {
  const parts = String(iso).split("-").map(Number);
  return parts[2] + " " + SHORT[(parts[1] || 1) - 1] + " " + parts[0];
}

export function spanDays(stage) {
  const start = Date.parse(stage.start + "T00:00:00Z");
  const end = Date.parse(stage.end + "T00:00:00Z");
  return Math.round((end - start) / 86400000) + 1;
}

export function monthsOfPlan() {
  const out = [];
  let year = 2026;
  let month = 10;
  while (year < 2027 || (year === 2027 && month <= 10)) {
    out.push({ year, month, label: MONTHS[month] + " " + year });
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return out;
}

export function monthCells(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  const blanks = first.getUTCDay();
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < blanks; i += 1) cells.push(null);
  for (let day = 1; day <= count; day += 1) {
    const iso = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
    const inSpan = iso >= BUILD_START && iso <= BUILD_END;
    cells.push({ iso, day, inSpan, stage: inSpan ? stageOn(iso) : null });
  }
  return cells;
}

export function stockGroup(item) {
  const name = String((item && item.name) || "").toLowerCase();
  if (name.indexOf("generator") >= 0) return "generation";
  if (name.indexOf("chiller") >= 0 || name.indexOf("afc") >= 0) return "chiller";
  if (name.indexOf("camera") >= 0 || name.indexOf("building management") >= 0 || name.indexOf("clean agent") >= 0) return "security";
  return "electrical";
}

export function yardShown(item, stage) {
  if (!item || !stage) return false;
  if (stage.id === "full") return true;
  const id = item.id || "";
  if (id.indexOf("heat-") === 0) return Number(id.slice(5)) <= stage.coolers;
  if (id.indexOf("hydro-") === 0) return Number(id.slice(6)) <= stage.pumps;
  if (stage.gear.indexOf(id) >= 0) return true;
  if (id.indexOf("stock-") !== 0) return false;
  return stage.groups.indexOf(stockGroup(item)) >= 0;
}
