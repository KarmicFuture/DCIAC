export const USERS = [
  {
    id: "dsvs.admin",
    role: "Administrator",
    note: "Access, Control, virtual media, and the ACS asset tag.",
  },
  {
    id: "dsvs.operator",
    role: "Operator",
    note: "Open consoles and cycle bound outlets. Usual remote-hands identity.",
  },
  {
    id: "colo.readonly",
    role: "ReadOnly",
    note: "Colo read-only. Consoles open. Outlet cycle and virtual media stay closed.",
  },
];

export const REFUSED = [
  {
    key: "port-15",
    endpoint: "ttyS15 · port 15",
    kind: "Serial",
    target: "Unbound",
    rack: "—",
    reason: "Port 15 is not bound to a target. Access refused.",
  },
  {
    key: "port-16",
    endpoint: "ttyS16 · port 16",
    kind: "Serial",
    target: "Power shelf",
    rack: "B07",
    reason: "Target is in rack B07. ACS-A14 launches only inside rack A14.",
  },
];
