// Definitions of Altium JSON structures for Schematic, PCB, and BOM

// ---- SCHEMATIC TYPES ----

export interface AltiumSchPin {
  id: string;
  name: string;
  num: string;
  x: number;
  y: number;
  orientation: number; // angle in degrees (0, 90, 180, 270)
}

export interface AltiumSchComponent {
  id: string;
  designator: string;
  comment: string;
  libRef: string;
  x: number;
  y: number;
  pins: AltiumSchPin[];
}

export interface AltiumSchWire {
  id: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  net?: string;
}

export interface AltiumSchNetLabel {
  id: string;
  text: string;
  x: number;
  y: number;
}

export interface AltiumSchDoc {
  type: 'schematic';
  fileName: string;
  fileSize: number;
  components: AltiumSchComponent[];
  wires: AltiumSchWire[];
  netLabels: AltiumSchNetLabel[];
}

// ---- PCB TYPES ----

export interface AltiumPcbComponent {
  id: string;
  designator: string;
  comment: string;
  footprint: string;
  layer: string;
  x: number;
  y: number;
  rotation: number;
}

export interface AltiumPcbTrack {
  id: string;
  layer: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  width: number;
  net?: string;
}

export interface AltiumPcbPad {
  id: string;
  designator: string;
  component?: string; // parent component designator if applicable
  x: number;
  y: number;
  size: { x: number; y: number };
  shape: 'round' | 'rectangular' | 'octagonal';
  holeSize: number;
  layer: string;
  net?: string;
}

export interface AltiumPcbVia {
  id: string;
  x: number;
  y: number;
  diameter: number;
  holeSize: number;
  startLayer: string;
  endLayer: string;
  net?: string;
}

export interface AltiumPcbDoc {
  type: 'pcb';
  fileName: string;
  fileSize: number;
  components: AltiumPcbComponent[];
  tracks: AltiumPcbTrack[];
  pads: AltiumPcbPad[];
  vias: AltiumPcbVia[];
  layers: string[];
}

// ---- BOM TYPES ----

export interface AltiumBomItem {
  designator: string;
  comment: string;
  footprint: string;
  description?: string;
  libRef?: string;
  quantity?: number;
  parameters?: Record<string, string>; // custom key-value pairs (e.g. Manufacturer, MPN, supplier)
}

export interface AltiumBomDoc {
  type: 'bom';
  fileName: string;
  fileSize: number;
  items: AltiumBomItem[];
}

// ---- GENERAL TYPE ----

export type AltiumDoc = AltiumSchDoc | AltiumPcbDoc | AltiumBomDoc;
