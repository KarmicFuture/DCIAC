import type { Outlet } from "../types";

export function outletByN(n) {
  return outlets.find((o) => o.n === Number(n));
}

export const LEAK = {
  id: "DI-1",
  location: "Rack A14 · cold-plate rope · rear of U38–U40",
  outlets: [1, 2],
};

export const outlets: Outlet[] = [
  { n: 1, deviceId: "tray-01", power: "on" },
  { n: 2, deviceId: "tray-02", power: "on" },
  { n: 3, deviceId: "tray-03", power: "on" },
  { n: 4, deviceId: "sn2201", power: "on" },
  { n: 5, deviceId: "pshelf", power: "on" },
  { n: 6, deviceId: null, power: "on" },
  { n: 7, deviceId: "tray-04", power: "on" },
  { n: 8, deviceId: "tray-05", power: "on" },
  { n: 9, deviceId: "tray-06", power: "on" },
  { n: 10, deviceId: "tray-07", power: "on" },
  { n: 11, deviceId: "tray-08", power: "on" },
];
