import { validateAdsDocument } from '$lib/domain/adsValidation';
import type {
	AltiumBomDoc,
	AltiumDoc,
	AltiumExportMeta,
	AltiumPcbDoc,
	AltiumSchSheet,
	AltiumSchematicDoc
} from '$lib/types/altium';

function assertObject(value: unknown, message: string): asserts value is Record<string, unknown> {
	if (!value || typeof value !== 'object') throw new Error(message);
}

function asArray<T = unknown>(value: unknown, message: string): T[] {
	if (!Array.isArray(value)) throw new Error(message);
	return value as T[];
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
				components: asArray(sheet.components, 'Schematic sheet is missing components array.'),
				wires: asArray(sheet.wires, 'Schematic sheet is missing wires array.'),
				netLabels: asArray(sheet.netLabels, 'Schematic sheet is missing netLabels array.'),
				annotations: Array.isArray(sheet.annotations) ? sheet.annotations : [],
				ports: Array.isArray(sheet.ports) ? sheet.ports : [],
				powerPorts: Array.isArray(sheet.powerPorts) ? sheet.powerPorts : [],
				offSheetConnectors: Array.isArray(sheet.offSheetConnectors) ? sheet.offSheetConnectors : [],
				sheetSymbols: Array.isArray(sheet.sheetSymbols) ? sheet.sheetSymbols : [],
				sheetEntries: Array.isArray(sheet.sheetEntries) ? sheet.sheetEntries : [],
				junctions: Array.isArray(sheet.junctions) ? sheet.junctions : [],
				noERC: Array.isArray(sheet.noERC) ? sheet.noERC : [],
				directives: Array.isArray(sheet.directives) ? sheet.directives : [],
				buses: Array.isArray(sheet.buses) ? sheet.buses : [],
				busEntries: Array.isArray(sheet.busEntries) ? sheet.busEntries : []
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
		components: asArray(raw.components, 'Schematic JSON is missing components array.'),
		wires: asArray(raw.wires, 'Schematic JSON is missing wires array.'),
		netLabels: asArray(raw.netLabels, 'Schematic JSON is missing netLabels array.'),
		annotations: Array.isArray(raw.annotations) ? raw.annotations : []
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
