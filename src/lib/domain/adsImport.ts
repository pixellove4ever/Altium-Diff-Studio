import type {
	AltiumBomDoc,
	AltiumDoc,
	AltiumExportMeta,
	AltiumPcbDoc,
	AltiumPoint,
	AltiumSchComponent,
	AltiumSchAnnotation,
	AltiumSchGraphic,
	AltiumSchMarker,
	AltiumSchNetLabel,
	AltiumSchPin,
	AltiumSchPolyline,
	AltiumSchSheet,
	AltiumSchText,
	AltiumSchWire,
	AltiumSchematicDoc
} from '../types/altium.ts';
import { validateAdsDocument } from './adsValidation.ts';

function assertObject(value: unknown, message: string): asserts value is Record<string, unknown> {
	if (!value || typeof value !== 'object') throw new Error(message);
}

function asArray<T = unknown>(value: unknown, message: string): T[] {
	if (!Array.isArray(value)) throw new Error(message);
	return value as T[];
}

function pick(raw: Record<string, unknown>, keys: string[]) {
	for (const key of keys) {
		if (raw[key] !== undefined) return raw[key];
	}
	return undefined;
}

function pickString(raw: Record<string, unknown>, keys: string[], fallback = '') {
	const value = pick(raw, keys);
	return typeof value === 'string' ? value : fallback;
}

function pickOptionalString(raw: Record<string, unknown>, keys: string[]) {
	const value = pick(raw, keys);
	return typeof value === 'string' ? value : undefined;
}

function pickNumber(raw: Record<string, unknown>, keys: string[], fallback = 0) {
	const value = pick(raw, keys);
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function pickOptionalNumber(raw: Record<string, unknown>, keys: string[]) {
	const value = pick(raw, keys);
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function pickOptionalBoolean(raw: Record<string, unknown>, keys: string[]) {
	const value = pick(raw, keys);
	return typeof value === 'boolean' ? value : undefined;
}

function normalizePoint(raw: unknown): AltiumPoint {
	assertObject(raw, 'Invalid schematic point.');
	return {
		x: pickNumber(raw, ['x', 'X']),
		y: pickNumber(raw, ['y', 'Y'])
	};
}

function normalizeBounds(raw: unknown) {
	if (!raw || typeof raw !== 'object') return undefined;
	const bounds = raw as Record<string, unknown>;
	return {
		x1: pickNumber(bounds, ['x1', 'X1']),
		y1: pickNumber(bounds, ['y1', 'Y1']),
		x2: pickNumber(bounds, ['x2', 'X2']),
		y2: pickNumber(bounds, ['y2', 'Y2'])
	};
}

function normalizeParameters(value: unknown): Record<string, string> | undefined {
	if (!value) return undefined;
	if (Array.isArray(value)) {
		const entries = value.flatMap((entry) => {
			if (!entry || typeof entry !== 'object') return [];
			const record = entry as Record<string, unknown>;
			const name = pickString(record, ['name', 'Name', 'NAME', 'key', 'Key', 'KEY']);
			const parameterValue = pick(record, ['value', 'Value', 'VALUE', 'text', 'Text', 'TEXT']);
			return name && parameterValue !== undefined ? [[name, String(parameterValue)] as const] : [];
		});
		return entries.length > 0 ? Object.fromEntries(entries) : undefined;
	}
	if (typeof value !== 'object') return undefined;
	const parameters = Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.filter(([, parameterValue]) => parameterValue !== undefined && parameterValue !== null)
			.map(([key, parameterValue]) => [key, String(parameterValue)])
	);
	return Object.keys(parameters).length > 0 ? parameters : undefined;
}

function normalizeSchematicPin(raw: unknown): AltiumSchPin {
	assertObject(raw, 'Invalid schematic pin.');
	return {
		id: pickOptionalString(raw, ['id', 'ID']),
		uniqueId: pickOptionalString(raw, ['uniqueId', 'UniqueId', 'UNIQUEID']),
		name: pickString(raw, ['name', 'Name', 'NAME', 'pinName', 'PinName'], ''),
		num: pickString(raw, ['num', 'number', 'Number', 'NUM', 'PINNUMBER', 'pinNumber'], ''),
		description: pickOptionalString(raw, ['description', 'Description', 'DESCRIPTION']),
		ownerIndex: pickOptionalNumber(raw, ['ownerIndex', 'OwnerIndex', 'OWNERINDEX']),
		x: pickNumber(raw, ['x', 'X']),
		y: pickNumber(raw, ['y', 'Y']),
		orientation: pickNumber(raw, ['orientation', 'Orientation', 'ORIENTATION']),
		length: pickOptionalNumber(raw, ['length', 'Length', 'PINLENGTH']),
		electricalType: pickOptionalNumber(raw, ['electricalType', 'ElectricalType', 'ELECTRICALTYPE']),
		ownerPartId: pickOptionalNumber(raw, ['ownerPartId', 'OwnerPartId', 'OWNERPARTID']),
		ownerPartDisplayMode: pickOptionalNumber(raw, [
			'ownerPartDisplayMode',
			'OwnerPartDisplayMode',
			'OWNERPARTDISPLAYMODE',
			'ownerDisplayMode',
			'OwnerDisplayMode'
		]),
		hidden: pickOptionalBoolean(raw, ['hidden', 'Hidden', 'ISHIDDEN']),
		hiddenNetName: pickOptionalString(raw, ['hiddenNetName', 'HiddenNetName', 'HIDDENNETNAME']),
		showName: pickOptionalBoolean(raw, ['showName', 'ShowName', 'SHOWNAME']),
		showDesignator: pickOptionalBoolean(raw, ['showDesignator', 'ShowDesignator', 'SHOWDESIGNATOR'])
	};
}

function normalizeSchematicText(raw: unknown): AltiumSchText {
	assertObject(raw, 'Invalid schematic text render item.');
	return {
		type: pickOptionalString(raw, ['type', 'Type', 'TYPE']),
		role: pickOptionalString(raw, ['role', 'Role', 'ROLE']),
		text: pickString(raw, ['text', 'Text', 'TEXT', 'displayText', 'DisplayText', 'DISPLAYTEXT']),
		x: pickNumber(raw, ['x', 'X']),
		y: pickNumber(raw, ['y', 'Y']),
		orientation: pickOptionalNumber(raw, ['orientation', 'Orientation', 'ORIENTATION'])
	};
}

function normalizeSchematicGraphic(raw: unknown): AltiumSchGraphic {
	assertObject(raw, 'Invalid schematic symbol graphic.');
	const points = pick(raw, ['points', 'Points', 'POINTS']);
	return {
		type: pickString(raw, ['type', 'Type', 'TYPE']),
		x1: pickOptionalNumber(raw, ['x1', 'X1']),
		y1: pickOptionalNumber(raw, ['y1', 'Y1']),
		x2: pickOptionalNumber(raw, ['x2', 'X2']),
		y2: pickOptionalNumber(raw, ['y2', 'Y2']),
		x: pickOptionalNumber(raw, ['x', 'X']),
		y: pickOptionalNumber(raw, ['y', 'Y']),
		radius: pickOptionalNumber(raw, ['radius', 'Radius', 'RADIUS']),
		points: Array.isArray(points) ? points.map((point) => normalizePoint(point)) : undefined
	};
}

function normalizeSchematicAnnotation(raw: unknown): AltiumSchAnnotation {
	assertObject(raw, 'Invalid schematic annotation.');
	return {
		id: pickOptionalString(raw, ['id', 'ID']),
		type: pickString(raw, ['type', 'Type', 'TYPE'], 'text') as AltiumSchAnnotation['type'],
		text: pickString(raw, ['text', 'Text', 'TEXT']),
		displayText: pickOptionalString(raw, ['displayText', 'DisplayText', 'DISPLAYTEXT']),
		x: pickNumber(raw, ['x', 'X']),
		y: pickNumber(raw, ['y', 'Y']),
		orientation: pickOptionalNumber(raw, ['orientation', 'Orientation', 'ORIENTATION']),
		justification: pickOptionalNumber(raw, ['justification', 'Justification', 'JUSTIFICATION']),
		mirrored: pickOptionalBoolean(raw, ['mirrored', 'Mirrored', 'MIRRORED']),
		fontId: pickOptionalNumber(raw, ['fontId', 'FontId', 'FONTID']),
		color: pickOptionalNumber(raw, ['color', 'Color', 'COLOR']),
		bounds: normalizeBounds(pick(raw, ['bounds', 'Bounds', 'BOUNDS'])),
		showBorder: pickOptionalBoolean(raw, ['showBorder', 'ShowBorder', 'SHOWBORDER']),
		wordWrap: pickOptionalBoolean(raw, ['wordWrap', 'WordWrap', 'WORDWRAP']),
		clipToRect: pickOptionalBoolean(raw, ['clipToRect', 'ClipToRect', 'CLIPTORECT']),
		alignment: pickOptionalNumber(raw, ['alignment', 'Alignment', 'ALIGNMENT']),
		author: pickOptionalString(raw, ['author', 'Author', 'AUTHOR']),
		collapsed: pickOptionalBoolean(raw, ['collapsed', 'Collapsed', 'COLLAPSED'])
	};
}

function normalizeSchematicComponent(raw: unknown): AltiumSchComponent {
	assertObject(raw, 'Invalid schematic component.');
	const parameters = normalizeParameters(pick(raw, ['parameters', 'Parameters', 'PARAMETERS']));
	return {
		id: pickOptionalString(raw, ['id', 'ID']),
		designator: pickString(raw, ['designator', 'Designator', 'DESIGNATOR', 'name', 'Name'], ''),
		comment: pickString(raw, ['comment', 'Comment', 'COMMENT', 'value', 'Value'], ''),
		libRef: pickString(
			raw,
			['libRef', 'LibRef', 'LIBREF', 'libraryReference', 'LibraryReference'],
			''
		),
		uniqueId: pickOptionalString(raw, ['uniqueId', 'UniqueId', 'UNIQUEID']),
		sourceLibraryName: pickOptionalString(raw, [
			'sourceLibraryName',
			'SourceLibraryName',
			'SOURCELIBRARYNAME'
		]),
		ownerIndex: pickOptionalNumber(raw, ['ownerIndex', 'OwnerIndex', 'OWNERINDEX']),
		orientation: pickOptionalNumber(raw, ['orientation', 'Orientation', 'ORIENTATION']),
		mirrored: pickOptionalBoolean(raw, ['mirrored', 'Mirrored', 'MIRRORED']),
		partCount: pickOptionalNumber(raw, ['partCount', 'PartCount', 'PARTCOUNT']),
		currentPartId: pickOptionalNumber(raw, ['currentPartId', 'CurrentPartId', 'CURRENTPARTID']),
		displayMode: pickOptionalNumber(raw, ['displayMode', 'DisplayMode', 'DISPLAYMODE']),
		value: pickOptionalString(raw, ['value', 'Value', 'VALUE']),
		footprint: pickOptionalString(raw, ['footprint', 'Footprint', 'FOOTPRINT']),
		parameters,
		x: pickNumber(raw, ['x', 'X']),
		y: pickNumber(raw, ['y', 'Y']),
		pins: asArray(
			pick(raw, ['pins', 'Pins', 'PINS']) ?? [],
			'Schematic component pins are invalid.'
		).map((pin) => normalizeSchematicPin(pin)),
		bounds: normalizeBounds(pick(raw, ['bounds', 'Bounds', 'BOUNDS'])),
		symbolGraphics: Array.isArray(pick(raw, ['symbolGraphics', 'SymbolGraphics', 'SYMBOLGRAPHICS']))
			? (pick(raw, ['symbolGraphics', 'SymbolGraphics', 'SYMBOLGRAPHICS']) as unknown[]).map(
					(graphic) => normalizeSchematicGraphic(graphic)
				)
			: undefined,
		textRender: Array.isArray(pick(raw, ['textRender', 'TextRender', 'TEXTRENDER']))
			? (pick(raw, ['textRender', 'TextRender', 'TEXTRENDER']) as unknown[]).map((text) =>
					normalizeSchematicText(text)
				)
			: undefined
	};
}

function normalizeSchematicMarker(raw: unknown): AltiumSchMarker {
	assertObject(raw, 'Invalid schematic marker.');
	return {
		id: pickOptionalString(raw, ['id', 'ID']),
		uniqueId: pickOptionalString(raw, ['uniqueId', 'UniqueId', 'UNIQUEID']),
		text: pickOptionalString(raw, ['text', 'Text', 'TEXT']),
		name: pickOptionalString(raw, ['name', 'Name', 'NAME']),
		fileName: pickOptionalString(raw, ['fileName', 'FileName', 'FILENAME']),
		ownerSheetSymbolUniqueId: pickOptionalString(raw, [
			'ownerSheetSymbolUniqueId',
			'OwnerSheetSymbolUniqueId',
			'OWNERSHEETSYMBOLUNIQUEID'
		]),
		type: pickOptionalString(raw, ['type', 'Type', 'TYPE']),
		source: pickOptionalString(raw, ['source', 'Source', 'SOURCE']),
		orientation: pickOptionalNumber(raw, ['orientation', 'Orientation', 'ORIENTATION']),
		x: pickNumber(raw, ['x', 'X']),
		y: pickNumber(raw, ['y', 'Y']),
		bounds: normalizeBounds(pick(raw, ['bounds', 'Bounds', 'BOUNDS']))
	};
}

function normalizeSchematicNetLabel(raw: unknown): AltiumSchNetLabel {
	assertObject(raw, 'Invalid schematic net label.');
	return {
		id: pickOptionalString(raw, ['id', 'ID']),
		text: pickString(raw, ['text', 'Text', 'TEXT', 'name', 'Name', 'NAME']),
		x: pickNumber(raw, ['x', 'X']),
		y: pickNumber(raw, ['y', 'Y']),
		orientation: pickOptionalNumber(raw, ['orientation', 'Orientation', 'ORIENTATION']),
		justification: pickOptionalNumber(raw, ['justification', 'Justification', 'JUSTIFICATION']),
		mirrored: pickOptionalBoolean(raw, ['mirrored', 'Mirrored', 'MIRRORED'])
	};
}

function normalizeSchematicWire(raw: unknown): AltiumSchWire {
	assertObject(raw, 'Invalid schematic wire.');
	const points = pick(raw, ['points', 'Points', 'POINTS']);
	const start = pick(raw, ['start', 'Start', 'START']);
	const end = pick(raw, ['end', 'End', 'END']);
	return {
		id: pickOptionalString(raw, ['id', 'ID']),
		start: start ? normalizePoint(start) : undefined,
		end: end ? normalizePoint(end) : undefined,
		points: Array.isArray(points) ? points.map((point) => normalizePoint(point)) : undefined,
		net: pickOptionalString(raw, ['net', 'Net', 'NET'])
	};
}

function normalizeSchematicPolyline(raw: unknown): AltiumSchPolyline {
	assertObject(raw, 'Invalid schematic polyline.');
	return {
		id: pickOptionalString(raw, ['id', 'ID']),
		points: asArray(
			pick(raw, ['points', 'Points', 'POINTS']) ?? [],
			'Polyline points are invalid.'
		).map((point) => normalizePoint(point))
	};
}

function normalizeMarkers(raw: unknown) {
	return Array.isArray(raw) ? raw.map((marker) => normalizeSchematicMarker(marker)) : [];
}

function withFileMeta<T extends AltiumDoc>(
	doc: T,
	name: string,
	size: number,
	exportMeta?: AltiumExportMeta
): T {
	return {
		...doc,
		fileName: name,
		fileSize: size,
		exportMeta
	};
}

function readExportMeta(raw: Record<string, unknown>): AltiumExportMeta | undefined {
	const exporter = raw.exporter;
	const meta: AltiumExportMeta = {};

	if (exporter && typeof exporter === 'object') {
		const exporterObject = exporter as Record<string, unknown>;
		if (typeof exporterObject.scriptName === 'string') meta.scriptName = exporterObject.scriptName;
		if (typeof exporterObject.scriptVersion === 'string')
			meta.scriptVersion = exporterObject.scriptVersion;
		if (typeof exporterObject.schemaVersion === 'string')
			meta.schemaVersion = exporterObject.schemaVersion;
		if (typeof exporterObject.generatedAt === 'string')
			meta.generatedAt = exporterObject.generatedAt;
	}

	if (typeof raw.scriptName === 'string') meta.scriptName = raw.scriptName;
	if (typeof raw.scriptVersion === 'string') meta.scriptVersion = raw.scriptVersion;
	if (typeof raw.schemaVersion === 'string') meta.schemaVersion = raw.schemaVersion;
	if (typeof raw.generatedAt === 'string') meta.generatedAt = raw.generatedAt;

	return Object.keys(meta).length > 0 ? meta : undefined;
}

function normalizeSchematic(
	raw: Record<string, unknown>,
	name: string,
	size: number,
	exportMeta?: AltiumExportMeta
): AltiumSchematicDoc {
	if (Array.isArray(raw.sheets)) {
		const sheets = raw.sheets.map((sheet, index) => {
			assertObject(sheet, `Invalid schematic sheet at index ${index}.`);

			return {
				id: typeof sheet.id === 'string' ? sheet.id : undefined,
				name: typeof sheet.name === 'string' ? sheet.name : `Sheet ${index + 1}`,
				fileName: typeof sheet.fileName === 'string' ? sheet.fileName : undefined,
				path: typeof sheet.path === 'string' ? sheet.path : undefined,
				components: asArray(sheet.components, 'Schematic sheet is missing components array.').map(
					(component) => normalizeSchematicComponent(component)
				),
				wires: asArray(sheet.wires, 'Schematic sheet is missing wires array.').map((wire) =>
					normalizeSchematicWire(wire)
				),
				netLabels: asArray(sheet.netLabels, 'Schematic sheet is missing netLabels array.').map(
					(label) => normalizeSchematicNetLabel(label)
				),
				annotations: Array.isArray(sheet.annotations)
					? sheet.annotations.map((annotation) => normalizeSchematicAnnotation(annotation))
					: [],
				ports: normalizeMarkers(sheet.ports),
				powerPorts: normalizeMarkers(sheet.powerPorts),
				offSheetConnectors: normalizeMarkers(sheet.offSheetConnectors),
				sheetSymbols: normalizeMarkers(sheet.sheetSymbols),
				sheetEntries: normalizeMarkers(sheet.sheetEntries),
				junctions: normalizeMarkers(sheet.junctions),
				noERC: normalizeMarkers(sheet.noERC),
				directives: normalizeMarkers(sheet.directives),
				buses: Array.isArray(sheet.buses)
					? sheet.buses.map((bus) => normalizeSchematicPolyline(bus))
					: [],
				busEntries: normalizeMarkers(sheet.busEntries)
			} satisfies AltiumSchSheet;
		});

		return withFileMeta(
			{ type: 'schematic', fileName: name, fileSize: size, sheets },
			name,
			size,
			exportMeta
		);
	}

	const sheet = {
		name: typeof raw.name === 'string' ? raw.name : name,
		components: asArray(raw.components, 'Schematic JSON is missing components array.').map(
			(component) => normalizeSchematicComponent(component)
		),
		wires: asArray(raw.wires, 'Schematic JSON is missing wires array.').map((wire) =>
			normalizeSchematicWire(wire)
		),
		netLabels: asArray(raw.netLabels, 'Schematic JSON is missing netLabels array.').map((label) =>
			normalizeSchematicNetLabel(label)
		),
		annotations: Array.isArray(raw.annotations)
			? raw.annotations.map((annotation) => normalizeSchematicAnnotation(annotation))
			: [],
		ports: normalizeMarkers(raw.ports),
		powerPorts: normalizeMarkers(raw.powerPorts),
		offSheetConnectors: normalizeMarkers(raw.offSheetConnectors),
		sheetSymbols: normalizeMarkers(raw.sheetSymbols),
		sheetEntries: normalizeMarkers(raw.sheetEntries),
		junctions: normalizeMarkers(raw.junctions),
		noERC: normalizeMarkers(raw.noERC),
		directives: normalizeMarkers(raw.directives),
		buses: Array.isArray(raw.buses) ? raw.buses.map((bus) => normalizeSchematicPolyline(bus)) : [],
		busEntries: normalizeMarkers(raw.busEntries)
	} satisfies AltiumSchSheet;

	return withFileMeta(
		{ type: 'schematic', fileName: name, fileSize: size, sheets: [sheet] },
		name,
		size,
		exportMeta
	);
}

function normalizeAltiumJsonUnchecked(parsed: unknown, name: string, size: number): AltiumDoc {
	assertObject(parsed, `${name} is not a JSON object.`);
	const exportMeta = readExportMeta(parsed);

	switch (parsed.type) {
		case 'bom':
			return withFileMeta(
				{
					type: 'bom',
					fileName: name,
					fileSize: size,
					items: asArray(parsed.items, 'BOM JSON is missing items array.')
				} satisfies AltiumBomDoc,
				name,
				size,
				exportMeta
			);
		case 'pcb':
			return withFileMeta(
				{
					type: 'pcb',
					fileName: name,
					fileSize: size,
					components: asArray(parsed.components, 'PCB JSON is missing components array.'),
					tracks: asArray(parsed.tracks, 'PCB JSON is missing tracks array.'),
					boardOutline: Array.isArray(parsed.boardOutline) ? parsed.boardOutline : undefined,
					boardOutlineEdges: Array.isArray(parsed.boardOutlineEdges)
						? parsed.boardOutlineEdges
						: undefined,
					boardOutlineRenderBounds:
						parsed.boardOutlineRenderBounds && typeof parsed.boardOutlineRenderBounds === 'object'
							? (parsed.boardOutlineRenderBounds as AltiumPcbDoc['boardOutlineRenderBounds'])
							: undefined,
					boardOutlineSource:
						typeof parsed.boardOutlineSource === 'string' ? parsed.boardOutlineSource : undefined,
					arcs: Array.isArray(parsed.arcs) ? parsed.arcs : undefined,
					pads: asArray(parsed.pads, 'PCB JSON is missing pads array.'),
					vias: asArray(parsed.vias, 'PCB JSON is missing vias array.'),
					polygons: Array.isArray(parsed.polygons) ? parsed.polygons : undefined,
					texts: Array.isArray(parsed.texts) ? parsed.texts : undefined,
					nets: Array.isArray(parsed.nets) ? (parsed.nets as string[]) : undefined,
					layers: asArray<string>(parsed.layers, 'PCB JSON is missing layers array.')
				} satisfies AltiumPcbDoc,
				name,
				size,
				exportMeta
			);
		case 'schematic':
			return normalizeSchematic(parsed, name, size, exportMeta);
		default:
			throw new Error(`${name} has unsupported or missing type. Expected bom, pcb, or schematic.`);
	}
}

export function normalizeAltiumJson(parsed: unknown, name: string, size: number): AltiumDoc {
	const document = normalizeAltiumJsonUnchecked(parsed, name, size);
	const errors = validateAdsDocument(document).filter((issue) => issue.severity === 'error');
	if (errors.length > 0)
		throw new Error(
			`Invalid ADS export: ${errors.map((issue) => `${issue.path}: ${issue.message}`).join(' ')}`
		);
	return document;
}

export function parseAltiumJson(text: string, name: string, size: number): AltiumDoc {
	return normalizeAltiumJson(JSON.parse(text) as unknown, name, size);
}
