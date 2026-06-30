// Definitions of Altium JSON structures for Schematic, PCB, and BOM

export interface AltiumExportMeta {
	scriptName?: string;
	scriptVersion?: string;
	schemaVersion?: string;
	generatedAt?: string;
}

export interface AltiumDocBase {
	fileName: string;
	fileSize: number;
	exportMeta?: AltiumExportMeta;
}

// ---- SCHEMATIC TYPES ----

export interface AltiumSchPin {
	id?: string;
	name: string;
	num: string;
	x: number;
	y: number;
	orientation: number; // angle in degrees (0, 90, 180, 270)
}

export interface AltiumSchComponent {
	id?: string;
	designator: string;
	comment: string;
	libRef: string;
	x: number;
	y: number;
	pins: AltiumSchPin[];
}

export interface AltiumSchWire {
	id?: string;
	start?: { x: number; y: number };
	end?: { x: number; y: number };
	points?: Array<{ x: number; y: number }>;
	net?: string;
}

export interface AltiumSchNetLabel {
	id?: string;
	text: string;
	x: number;
	y: number;
}

export interface AltiumSchSheet {
	name?: string;
	fileName?: string;
	components: AltiumSchComponent[];
	wires: AltiumSchWire[];
	netLabels: AltiumSchNetLabel[];
}

export interface AltiumSchematicDoc extends AltiumDocBase {
	type: 'schematic';
	sheets: AltiumSchSheet[];
}

// ---- PCB TYPES ----

export interface AltiumPcbComponent {
	id?: string;
	designator: string;
	comment: string;
	footprint: string;
	layer: string;
	x: number;
	y: number;
	rotation: number;
}

export interface AltiumPcbTrack {
	id?: string;
	layer: string;
	start: { x: number; y: number };
	end: { x: number; y: number };
	width: number;
	net?: string;
}

export interface AltiumPcbPad {
	id?: string;
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
	id?: string;
	x: number;
	y: number;
	diameter: number;
	holeSize: number;
	startLayer: string;
	endLayer: string;
	net?: string;
}

export interface AltiumPoint {
	x: number;
	y: number;
}

export interface AltiumPcbArc {
	id?: string;
	layer: string;
	center: AltiumPoint;
	radius: number;
	startAngle: number;
	endAngle: number;
	width: number;
}

export interface AltiumPcbPolygon {
	id?: string;
	layer: string;
	net?: string;
	vertices: AltiumPoint[];
}

export interface AltiumPcbText {
	id?: string;
	layer: string;
	text: string;
	x: number;
	y: number;
	height: number;
	rotation: number;
}

export interface AltiumPcbDoc extends AltiumDocBase {
	type: 'pcb';
	boardOutline?: AltiumPoint[];
	components: AltiumPcbComponent[];
	tracks: AltiumPcbTrack[];
	arcs?: AltiumPcbArc[];
	pads: AltiumPcbPad[];
	vias: AltiumPcbVia[];
	polygons?: AltiumPcbPolygon[];
	texts?: AltiumPcbText[];
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

export interface AltiumBomDoc extends AltiumDocBase {
	type: 'bom';
	items: AltiumBomItem[];
}

// ---- GENERAL TYPE ----

export type AltiumDoc = AltiumSchematicDoc | AltiumPcbDoc | AltiumBomDoc;

export interface AltiumProjectSet {
	bom: AltiumBomDoc | null;
	pcb: AltiumPcbDoc | null;
	schematic: AltiumSchematicDoc | null;
}
