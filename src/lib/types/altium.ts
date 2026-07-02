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
	uniqueId?: string;
	name: string;
	num: string;
	description?: string;
	x: number;
	y: number;
	orientation: number; // angle in degrees (0, 90, 180, 270)
	length?: number;
	electricalType?: number;
	ownerPartId?: number;
	ownerPartDisplayMode?: number;
	hidden?: boolean;
	hiddenNetName?: string;
	showName?: boolean;
	showDesignator?: boolean;
}

export interface AltiumSchComponent {
	id?: string;
	designator: string;
	comment: string;
	libRef: string;
	uniqueId?: string;
	sourceLibraryName?: string;
	orientation?: number;
	mirrored?: boolean;
	partCount?: number;
	currentPartId?: number;
	displayMode?: number;
	value?: string;
	footprint?: string;
	parameters?: Record<string, string>;
	x: number;
	y: number;
	pins: AltiumSchPin[];
	bounds?: AltiumBounds;
	symbolGraphics?: AltiumSchGraphic[];
	textRender?: AltiumSchText[];
}

export interface AltiumBounds {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export interface AltiumSchText {
	type?: string;
	role?: string;
	text: string;
	x: number;
	y: number;
	orientation?: number;
}

export interface AltiumSchGraphic {
	type: string;
	x1?: number;
	y1?: number;
	x2?: number;
	y2?: number;
	x?: number;
	y?: number;
	radius?: number;
	points?: AltiumPoint[];
}

export interface AltiumSchMarker {
	id?: string;
	uniqueId?: string;
	text?: string;
	name?: string;
	fileName?: string;
	ownerSheetSymbolUniqueId?: string;
	type?: string;
	source?: string;
	orientation?: number;
	x: number;
	y: number;
	bounds?: AltiumBounds;
}

export interface AltiumSchPolyline {
	id?: string;
	points: AltiumPoint[];
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
	orientation?: number;
	justification?: number;
	mirrored?: boolean;
}

export interface AltiumSchAnnotation {
	id?: string;
	type: 'text' | 'textFrame' | 'note';
	text: string;
	displayText?: string;
	x: number;
	y: number;
	orientation?: number;
	justification?: number;
	mirrored?: boolean;
	fontId?: number;
	color?: number;
	bounds?: AltiumBounds;
	showBorder?: boolean;
	wordWrap?: boolean;
	clipToRect?: boolean;
	alignment?: number;
	author?: string;
	collapsed?: boolean;
}

export interface AltiumSchSheet {
	id?: string;
	name?: string;
	fileName?: string;
	path?: string;
	components: AltiumSchComponent[];
	wires: AltiumSchWire[];
	netLabels: AltiumSchNetLabel[];
	annotations?: AltiumSchAnnotation[];
	ports?: AltiumSchMarker[];
	powerPorts?: AltiumSchMarker[];
	offSheetConnectors?: AltiumSchMarker[];
	sheetSymbols?: AltiumSchMarker[];
	sheetEntries?: AltiumSchMarker[];
	junctions?: AltiumSchMarker[];
	noERC?: AltiumSchMarker[];
	directives?: AltiumSchMarker[];
	buses?: AltiumSchPolyline[];
	busEntries?: AltiumSchMarker[];
}

export interface AltiumSchematicDoc extends AltiumDocBase {
	type: 'schematic';
	sheets: AltiumSchSheet[];
}

// ---- PCB TYPES ----

export interface AltiumPcbComponent {
	id?: string;
	designator: string;
	baseDesignator?: string;
	comment: string;
	footprint: string;
	layer: string;
	x: number;
	y: number;
	rotation: number;
	bounds?: AltiumBounds;
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
	shape: 'round' | 'oval' | 'rectangular' | 'rounded-rectangular' | 'octagonal';
	cornerRadius?: number;
	holeSize: number;
	holeSizeX?: number;
	holeSizeY?: number;
	holeShape?: 'round' | 'rectangular' | 'oblong';
	rotation?: number;
	pin1?: boolean;
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
	net?: string;
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
	role?: 'designator' | 'comment' | 'text';
	x: number;
	y: number;
	height: number;
	width?: number;
	rotation: number;
	mirrored?: boolean;
}

export interface AltiumPcbOutlineEdge {
	id?: string;
	type: string;
	source?: string;
	edgeClass?: string;
	layer?: string;
	start: AltiumPoint;
	end: AltiumPoint;
	width?: number;
}

export interface AltiumPcbDoc extends AltiumDocBase {
	type: 'pcb';
	boardOutline?: AltiumPoint[];
	boardOutlineEdges?: AltiumPcbOutlineEdge[];
	boardOutlineRenderBounds?: BoundsRect;
	boardOutlineSource?: string;
	components: AltiumPcbComponent[];
	tracks: AltiumPcbTrack[];
	arcs?: AltiumPcbArc[];
	pads: AltiumPcbPad[];
	vias: AltiumPcbVia[];
	polygons?: AltiumPcbPolygon[];
	texts?: AltiumPcbText[];
	nets?: string[];
	layers: string[];
}

export interface BoundsRect {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
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
