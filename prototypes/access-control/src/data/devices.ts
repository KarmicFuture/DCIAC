import type { Device } from "../types";
import { outlets } from "./outlets";
import { REFUSED } from "./users";

export function device(id, name, kind, u, shortName, port, outlet, redfishId, usb?: string): Device {
  return {
    id,
    name,
    kind,
    u,
    short: shortName,
    host: shortName + ".oob.a14.local",
    rack: "A14",
    port,
    tty: "ttyS" + port,
    mpu: port,
    outlet,
    redfishId,
    usb: usb || "",
    bmc: "up",
    rdp: "up",
    bmcLostAt: 0,
    serialReadyAt: 0,
    serialFailoverTotal: SERIAL_FAILOVER_MS,
    serialAnnounced: true,
  };
}

export function deviceById(id) {
  return devices.find((d) => d.id === id) || serialOnly.find((d) => d.id === id);
}

export function targetOnPort(port) {
  return devices.find((d) => d.port === port) || serialOnly.find((d) => d.port === port);
}

export function assertWorld() {
  devices.forEach((d) => {
    const outlet = outlets.find((o) => o.n === d.outlet);
    if (!outlet || outlet.deviceId !== d.id) throw new Error("Outlet map does not match " + d.id);
    if (d.rack !== "A14") throw new Error("ACS domain must be rack A14");
  });
  if (outlets.filter((o) => !o.deviceId).length !== 1) throw new Error("Expected one unbound outlet");
}

export const SERIAL_FAILOVER_MS = 30000;

export const MEDIA = ["ubuntu-24.04-live.iso", "tray-firmware.iso"];

export const devices: Device[] = [
  device("tray-01", "GPU Tray 01", "GPU tray", 40, "tray-01", 1, 1, "Tray-01"),
  device("tray-02", "GPU Tray 02", "GPU tray", 38, "tray-02", 2, 2, "Tray-02"),
  device("tray-03", "GPU Tray 03", "GPU tray", 36, "tray-03", 3, 3, "Tray-03", "USB-1"),
  device("tray-04", "GPU Tray 04", "GPU tray", 34, "tray-04", 6, 7, "Tray-04"),
  device("tray-05", "GPU Tray 05", "GPU tray", 32, "tray-05", 7, 8, "Tray-05"),
  device("tray-06", "GPU Tray 06", "GPU tray", 30, "tray-06", 8, 9, "Tray-06"),
  device("tray-07", "GPU Tray 07", "GPU tray", 28, "tray-07", 9, 10, "Tray-07"),
  device("tray-08", "GPU Tray 08", "GPU tray", 26, "tray-08", 10, 11, "Tray-08"),
  device("sn2201", "SN2201", "Switch", 22, "sn2201", 4, 4, "SN2201"),
  device("pshelf", "DC power shelf", "Power shelf", 6, "pshelf", 5, 5, "PowerShelf"),
];

export const ACS_PORTS = 48;

export const serialOnly: Device[] = [];

for (let port = 1; port <= ACS_PORTS; port += 1) {
  if (devices.some((d) => d.port === port)) continue;
  if (REFUSED.some((row) => row.key === "port-" + port)) continue;
  const label = String(port).padStart(2, "0");
  serialOnly.push({
    id: "port-" + port,
    name: "Server " + label,
    kind: "Server",
    u: 0,
    short: "srv-" + label,
    host: "srv-" + label + ".oob.a14.local",
    rack: "A14",
    port: port,
    tty: "ttyS" + port,
    mpu: 0,
    outlet: 0,
    redfishId: "",
    usb: "",
    bmc: "up",
    rdp: "up",
    serialOnly: true,
    bmcLostAt: 0,
    serialReadyAt: 0,
    serialFailoverTotal: SERIAL_FAILOVER_MS,
    serialAnnounced: true,
  });
}
