import { deviceById } from "../data/devices";
import { waiting } from "../domain/failover";
import { state } from "../state";
import { esc } from "../ui/format";

/* One device view for every place a device opens (Operate › Rack and the floor).
   It shows the ports that device type really has, which of them reach the ACS
   (serial) and the MPU2 (KVM), and every way in, with the best out-of-band and the
   best in-band path marked. Launch buttons go through the same session checks as
   everywhere else.

   Port lists follow the vendor documentation for each model:
   - GPU tray: GB200 NVL72 compute tray (BMC and BlueField-3 BMC RJ45, host LAN RJ45,
     4 ConnectX-7 OSFP, BlueField-3 QSFP, Micro-USB UART, USB 3.0, Mini DisplayPort).
   - Switch: SN2201 (48 x 1GbE RJ45, 4 x 100G QSFP28, RS232 Console, MGT RJ45, USB 2.0).
   - Power shelf: shelf controller management RJ45 and console, six 5.5 kW PSUs.
   - Server: a 2U rack server like the PowerEdge R760 (dedicated BMC RJ45, VGA, USB,
     OCP NIC ports, two PSUs). */

type Port = { label: string; role: string; connector: string; count?: number; note?: string; to?: string };
type Group = { title: string; ports: Port[] };
type Path = { id: string; band: "oob" | "inband"; name: string; via: string; status: string; ok: boolean; button: string; why: string };

function family(entity) {
  const kind = String((entity && entity.kind) || "").toLowerCase();
  if (kind.indexOf("switch") >= 0) return "switch";
  if (kind.indexOf("shelf") >= 0) return "shelf";
  if (kind.indexOf("gpu") >= 0) return "gpu";
  return "server";
}

const MODEL = {
  gpu: "GB200 NVL72 compute tray",
  switch: "SN2201 1G management switch",
  shelf: "ORv3 DC power shelf",
  server: "2U rack server",
};

function acsLink(d) {
  return d && d.port ? "ACS-A14 port " + d.port + " · " + d.tty : "";
}

function mpuLink(d) {
  return d && d.mpu ? "MPU2 port " + d.mpu : "";
}

function portGroups(entity): Group[] {
  const d = deviceById(entity.id);
  const kind = family(entity);
  const acs = acsLink(d);
  const mpu = d && !d.serialOnly ? mpuLink(d) : "";
  if (kind === "switch") {
    return [
      { title: "Data", ports: [
        { label: "1GbE", role: "data", connector: "RJ45", count: 48, note: "10/100/1000BASE-T" },
        { label: "100G", role: "data", connector: "QSFP28", count: 4, note: "Uplinks. Break out to 4 x 10/25G or 2 x 50G" },
      ] },
      { title: "Management", ports: [
        { label: "Console", role: "serial", connector: "RJ45 RS232", to: acs, note: "Serial console" },
        { label: "MGT", role: "mgmt", connector: "RJ45 1GbE", note: "Management network. SSH and the NOS API" },
        { label: "USB", role: "usb", connector: "USB 2.0", note: "Software images and files" },
      ] },
    ];
  }
  if (kind === "shelf") {
    return [
      { title: "Management", ports: [
        { label: "Shelf mgmt", role: "mgmt", connector: "RJ45 1GbE", note: "Shelf controller on the out-of-band network" },
        { label: "Console", role: "serial", connector: "RJ45 RS232", to: acs, note: "Shelf controller console" },
      ] },
      { title: "Power", ports: [
        { label: "PSU", role: "power", connector: "5.5 kW", count: 6, note: "AC in, 50 V DC out" },
        { label: "Bus bar", role: "power", connector: "50 V DC", note: "Feeds the trays in this rack" },
      ] },
    ];
  }
  if (kind === "gpu") {
    return [
      { title: "Management", ports: [
        { label: "BMC", role: "mgmt", connector: "RJ45 1GbE", note: "Out-of-band BMC on the IPMI network. Redfish, web, and serial over LAN" },
        { label: "DPU BMC", role: "mgmt", connector: "RJ45 1GbE", note: "BlueField-3 BMC" },
        { label: "Host LAN", role: "inband", connector: "RJ45 1GbE", note: "Operating system management network" },
      ] },
      { title: "Console and KVM", ports: [
        { label: "UART", role: "serial", connector: "Micro-USB", to: acs, note: "CPU serial console" },
        { label: "Video", role: "video", connector: "Mini DisplayPort", to: mpu, note: "Up to 1920 x 1200" },
        { label: "USB", role: "usb", connector: "USB 3.0", to: mpu, note: "Keyboard and mouse, virtual media" },
      ] },
      { title: "Fabric", ports: [
        { label: "ConnectX-7", role: "data", connector: "OSFP 400G", count: 4, note: "Compute fabric" },
        { label: "BlueField-3", role: "data", connector: "QSFP112 400G", count: 4, note: "Two DPUs, two ports each. Storage and in-band network" },
      ] },
    ];
  }
  return [
    { title: "Management", ports: [
      { label: "BMC", role: "mgmt", connector: "RJ45 1GbE", note: "Dedicated BMC port. Redfish, IPMI, web, virtual console" },
      { label: "Serial", role: "serial", connector: d && d.port ? "RJ45 RS232" : "Serial over LAN", to: acs, note: d && d.port ? "Console to the ACS" : "Through the BMC" },
    ] },
    { title: "Console and KVM", ports: [
      { label: "VGA", role: "video", connector: "DB15", to: mpu, note: mpu ? "To the MPU2" : "Not cabled to an MPU2" },
      { label: "USB", role: "usb", connector: "USB 2.0 / 3.0", count: 2, to: mpu, note: "Keyboard and mouse" },
    ] },
    { title: "Network and power", ports: [
      { label: "OCP NIC", role: "data", connector: "OCP 3.0", note: "In-band network" },
      { label: "PSU", role: "power", connector: "AC", count: 2, note: "A and B feeds" },
    ] },
  ];
}

function portHtml(port: Port) {
  const many = port.count && port.count > 1;
  const jacks = many && port.count! > 8
    ? '<span class="dv-jacks dense">' + Array.from({ length: port.count! }, () => "<i></i>").join("") + "</span>"
    : (many ? '<span class="dv-jacks">' + Array.from({ length: port.count! }, () => "<i></i>").join("") + "</span>" : '<span class="dv-jacks"><i></i></span>');
  const title = port.label + " · " + port.connector + (port.count && port.count > 1 ? " x " + port.count : "") + (port.note ? " · " + port.note : "") + (port.to ? " · " + port.to : "");
  return '<div class="dv-port role-' + port.role + '" title="' + esc(title) + '" data-port-role="' + port.role + '">' + jacks +
    "<b>" + esc(port.label) + (many ? " x " + port.count : "") + "</b><small>" + esc(port.connector) + "</small>" +
    (port.to ? '<span class="dv-to">→ ' + esc(port.to) + "</span>" : "") + "</div>";
}

function launch(d, path, type, label, medium, primary) {
  return '<button type="button" class="act' + (primary ? " primary" : "") + '" data-act="launch" data-device="' + esc(d.id) +
    '" data-path="' + path + '" data-type="' + type + '" data-medium="' + (medium || "") + '">' + esc(label) + "</button>";
}

function paths(entity): Path[] {
  const d = deviceById(entity.id);
  const kind = family(entity);
  const list: Path[] = [];
  if (!d) {
    return [{ id: "none", band: "oob", name: "ACS serial", via: "Not cabled", status: "Outside rack A14", ok: false, button: "", why: "ACS-A14 only serves rack A14. This device is simulated." }];
  }
  const bmcDown = d.bmc === "down";
  const rmDark = state.rm1048 !== "healthy";
  const noOs = !!d.bootStuck;
  const waitingSerial = bmcDown && waiting(d);
  list.push({
    id: "acs-serial", band: "oob", name: "ACS serial",
    via: acsLink(d) + (kind === "gpu" ? " · Micro-USB UART" : " · RS232 console"),
    status: waitingSerial ? "Coming up" : "Ready", ok: true,
    button: launch(d, "acs", "serial", "Open serial", "rs232", false),
    why: "Works with no operating system, no network, and no BMC. The ACS logs every session.",
  });
  if (kind === "gpu" || (kind === "server" && d.mpu && !d.serialOnly)) {
    list.push({
      id: "mpu-kvm", band: "oob", name: "MPU2 KVM",
      via: mpuLink(d) + (kind === "gpu" ? " · Mini DisplayPort + USB" : " · VGA + USB"),
      status: "Ready", ok: true,
      button: launch(d, "acs", "kvm", "Open KVM", "", false),
      why: "Keyboard, video, and mouse from power-on, including BIOS. Does not depend on the BMC.",
    });
  }
  if (kind === "gpu" || kind === "server") {
    const held = bmcDown ? "BMC dark" : (rmDark ? "RM1048 plane dark" : "Ready");
    list.push({
      id: "bmc", band: "oob", name: "BMC",
      via: "BMC RJ45 · Redfish " + (d.redfishId || d.short) + " through the RM1048",
      status: held, ok: !bmcDown && !rmDark,
      button: !bmcDown && !rmDark ? launch(d, "rm1048", "kvm", "BMC console", "", false) + launch(d, "rm1048", "serial", "Serial over LAN", "", false) : "",
      why: "Power state, sensors, logs, and the BMC's own console. Needs the BMC and its network.",
    });
  }
  if (kind === "shelf") {
    list.push({
      id: "shelf-mgmt", band: "inband", name: "Shelf controller",
      via: "Shelf mgmt RJ45 · Redfish and SNMP on the out-of-band network",
      status: "Read only here", ok: true,
      button: '<button type="button" class="act" data-act="nav" data-view="control">Open Control</button>',
      why: "Readings and alarms. Switching power happens on Control, with its checks.",
    });
    return list;
  }
  const sshVia = kind === "switch" ? "MGT RJ45 · " + d.host : "Host LAN · " + d.host;
  list.push({
    id: "ssh", band: "inband", name: "SSH",
    via: sshVia + ":22",
    status: noOs ? "No OS running" : "Ready", ok: !noOs,
    button: noOs ? "" : '<button type="button" class="act" data-act="copy-ssh" data-text="' + esc("ssh " + ((state.user && state.user.id) || "admin") + "@" + d.host) + '">Copy SSH command</button>',
    why: kind === "switch" ? "The switch's own management port. Fast and scriptable." : "The operating system's own network. Fast and scriptable.",
  });
  if (kind === "gpu" || kind === "server") {
    const down = d.rdp === "down";
    list.push({
      id: "rdp", band: "inband", name: "RDP",
      via: d.host + ":3389",
      status: noOs ? "No OS running" : (down ? "Down" : "Ready"), ok: !noOs && !down,
      button: noOs ? "" : (down
        ? '<button type="button" class="act primary" data-act="rdp-failover" data-device="' + esc(d.id) + '">Fail over to MPU2 KVM</button>'
        : '<button type="button" class="act" data-act="rdp-open" data-device="' + esc(d.id) + '">Open RDP</button>'),
      why: "Graphical desktop through the operating system. If it drops, the MPU2 KVM takes over.",
    });
  }
  return list;
}

/* The first ready path in each band, in the order listed: serial before KVM before
   the BMC out of band, SSH before RDP in band. */
export function bestPaths(entity) {
  const list = paths(entity);
  const oob = list.find((p) => p.band === "oob" && p.ok) || null;
  const inband = list.find((p) => p.band === "inband" && p.ok) || null;
  return { oob: oob ? oob.id : "", inband: inband ? inband.id : "", list };
}

function pathRow(p: Path, best: boolean) {
  return '<tr data-path="' + p.id + '" data-band="' + p.band + '"' + (best ? ' class="best"' : "") + "><td><b>" + esc(p.name) + "</b>" +
    (best ? ' <span class="dv-best">Best ' + (p.band === "oob" ? "out of band" : "in band") + "</span>" : "") +
    '<small>' + esc(p.via) + "</small>" + (p.button ? '<div class="dv-go">' + p.button + "</div>" : "") +
    '</td><td><span class="dv-state ' + (p.ok ? "ok" : "held") + '">' + esc(p.status) + "</span></td></tr>" +
    '<tr class="dv-why"><td colspan="2">' + esc(p.why) + "</td></tr>";
}

function na(kind) {
  if (kind === "switch") return "No KVM (no video port), no BMC, no RDP. The management CPU answers on MGT.";
  if (kind === "shelf") return "No KVM, BMC, SSH, or RDP. The shelf controller is managed over its RJ45.";
  return "";
}

export function deviceViewHtml(entity) {
  if (!entity) return "";
  const kind = family(entity);
  const groups = portGroups(entity).map((g) => '<div class="dv-group"><h4>' + esc(g.title) + '</h4><div class="dv-ports">' + g.ports.map(portHtml).join("") + "</div></div>").join("");
  const best = bestPaths(entity);
  const oob = best.list.filter((p) => p.band === "oob").map((p) => pathRow(p, p.id === best.oob)).join("");
  const inband = best.list.filter((p) => p.band === "inband").map((p) => pathRow(p, p.id === best.inband)).join("");
  const missing = na(kind);
  return '<section class="device-view" data-family="' + kind + '"><h3>Device view · ' + esc(MODEL[kind]) + "</h3>" +
    '<div class="dv-face">' + groups + "</div>" +
    '<div class="dv-legend"><span class="role-serial">Serial</span><span class="role-video">KVM</span><span class="role-mgmt">Management</span><span class="role-inband">Host LAN</span><span class="role-data">Data</span><span class="role-power">Power</span></div>' +
    "<h4>Ways in</h4>" +
    '<div class="table-wrap"><table class="dv-paths"><thead><tr><th>Out of band</th><th>State</th></tr></thead><tbody>' + oob + "</tbody>" +
    (inband ? "<thead><tr><th>In band</th><th>State</th></tr></thead><tbody>" + inband + "</tbody>" : "") + "</table></div>" +
    (missing ? '<p class="fine">' + esc(missing) + "</p>" : "") + "</section>";
}
