export interface User {
  id: string;
  role: string;
  note: string;
}

export interface DeviceLoad {
  gpu: number;
  mem: number;
  power: number;
  temp: number;
  drift: number;
  failover: boolean;
  rdpDown?: boolean;
  down?: boolean;
  watchDeny?: boolean;
}

export interface DeviceWatch {
  at: number;
  login: string;
  pri: number;
  text: string;
  act: string;
  go: string;
  response: string;
}

export interface Device {
  id: string;
  name: string;
  kind: string;
  u: number;
  short: string;
  host: string;
  rack: string;
  port: number;
  tty: string;
  mpu: number;
  outlet: number;
  redfishId: string;
  usb: string;
  bmc: string;
  rdp: string;
  bmcLostAt: number;
  serialReadyAt: number;
  serialFailoverTotal: number;
  serialAnnounced: boolean;
  serialOnly?: boolean;
  watchDeny?: boolean;
  watch?: DeviceWatch | null;
  load?: DeviceLoad;
  pod?: string;
  yard?: boolean;
  managed?: boolean;
  seed?: DeviceLoad;
}

export interface Outlet {
  n: number;
  deviceId: string | null;
  power: string;
}

export interface Session {
  id: string;
  deviceId: string;
  path: string;
  type: string;
  medium: string;
  openedAt: number;
  lines: string[] | null;
  entry?: string;
  stage: string;
  media: string | null;
  mediaChoice: string;
  screen: string;
  keys: string;
  rdpFailover?: boolean;
}

export interface AuditEntry {
  t: number;
  user: string;
  role: string;
  action: string;
  asset: string;
  outlet: string;
  wo: string;
  detail: string;
}

export interface Alarm {
  id: string;
  pri: number;
  asset: string;
  text: string;
  act?: string;
  go?: string;
  device?: string;
  part?: string;
  response?: string;
}

export interface FloorState {
  level: string;
  podId: string;
  rackId: string;
  serverId: string;
  rowId: string;
  feedId: string;
  partId: string;
  pitch: number;
  yaw: number;
  zoom: number;
  panX: number;
  panY: number;
  chassisPitch: number;
  chassisYaw: number;
  chassisZoom: number;
  suppressClick: boolean;
}

export interface AppState {
  user: User | null;
  view: string;
  selected: string;
  floor: FloorState;
  game: {
    score: number;
    streak: number;
    best: number;
    catches: number;
    awarded: Record<string, boolean>;
  };
  acked: Record<string, boolean>;
  rm1048: string;
  leak: boolean;
  maintenance: { name: string; wo: string } | null;
  maintName: string;
  maintWo: string;
  wo: string;
  assetTag: string;
  assetTagDraft: string;
  sessions: Session[];
  audit: AuditEntry[];
  fails: Record<string, boolean>;
  refuseNote: { key: string; text: string } | null;
  toast: string;
  labOpen: boolean;
  focusSession: string;
  focusTerm: string;
  highlightOutlet: number;
  selectedPort: number;
  menuOpen: boolean;
  portQuery: string;
  portFilter: string;
  portCompact: boolean;
  focusField: string;
  plan: {
    maker: string;
    selected: string;
    preview: string;
    seq: number;
    placements: any[];
  };
  horizon: string;
  manage: { layer: string; device: string };
  containment: string;
  theme: string;
  demoId: string;
  demoStep: number;
  demoDone: boolean;
  outletGate: {
    phase: string;
    n: number;
    op: string;
    source: string;
    before: string;
    until: number;
    error: string;
    wo: string;
    typed: string;
  } | null;
}

export interface AccessDemo {
  state: AppState;
  devices: Device[];
  outlets: Outlet[];
  setFailoverMs(ms: number): void;
  finishFailover(id: string): void;
  pushLoad(id: string, patch: Record<string, number | boolean>): void;
  setAnalyzer(next: { explain(input: any): any }): void;
  finishOutletHold(): void;
}

declare global {
  interface Window {
    AccessDemo: AccessDemo;
  }

  interface Element {
    style: CSSStyleDeclaration;
    dataset: DOMStringMap;
    value: string;
    focus(options?: FocusOptions): void;
    setSelectionRange(start: number | null, end: number | null): void;
    selectionStart: number | null;
    selectionEnd: number | null;
  }
}
