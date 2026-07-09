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

function parameterEntryValue(value: unknown) {
	if (value === undefined || value === null) return undefined;
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (typeof value !== 'object') return undefined;
	const raw = value as Record<string, unknown>;
	const nested = pick(raw, ['value', 'Value', 'VALUE', 'text', 'Text', 'TEXT']);
	return nested === undefined || nested === null ? undefined : String(nested);
}

function parseParameterString(value: string): Record<string, string> | undefined {
	const entries = value.split(/\r?\n|[|;]/).flatMap((entry) => {
		const match = entry.match(/^\s*([^:=]+?)\s*[:=]\s*(.*?)\s*$/);
		return match && match[1].trim() && match[2] !== undefined
			? [[match[1].trim(), match[2]] as const]
			: [];
	});
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function pickHiddenBoolean(raw: Record<string, unknown>) {
	const explicitHidden = pickOptionalBoolean(raw, [
		'hidden',
		'Hidden',
		'HIDDEN',
		'isHidden',
		'IsHidden',
		'ISHIDDEN'
	]);
	if (explicitHidden !== undefined) return explicitHidden;
	const visible = pickOptionalBoolean(raw, [
		'visible',
		'Visible',
		'VISIBLE',
		'isVisible',
		'IsVisible',
		'ISVISIBLE'
	]);
	return visible === false ? true : undefined;
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
	if (typeof value === 'string') return parseParameterString(value);
	if (Array.isArray(value)) {
		const entries = value.flatMap((entry) => {
			if (!entry || typeof entry !== 'object') return [];
			const record = entry as Record<string, unknown>;
			const name = pickString(record, [
				'name',
				'Name',
				'NAME',
				'key',
				'Key',
				'KEY',
				'parameterName',
				'ParameterName',
				'PARAMETERNAME',
				'paramName',
				'ParamName',
				'PARAMNAME'
			]);
			const parameterValue = parameterEntryValue(
				pick(record, [
					'value',
					'Value',
					'VALUE',
					'text',
					'Text',
					'TEXT',
					'parameterValue',
					'ParameterValue',
					'PARAMETERVALUE',
					'paramValue',
					'ParamValue',
					'PARAMVALUE'
				])
			);
			return name && parameterValue !== undefined ? [[name, parameterValue] as const] : [];
		});
		return entries.length > 0 ? Object.fromEntries(entries) : undefined;
	}
	if (typeof value !== 'object') return undefined;
	const parameters = Object.fromEntries(
		Object.entries(value as Record<string, unknown>).flatMap(([key, parameterValue]) => {
			const text = parameterEntryValue(parameterValue);
			return text === undefined ? [] : ([[key, text]] as const);
		})
	);
	return Object.keys(parameters).length > 0 ? parameters : undefined;
}

function parameterValue(parameters: Record<string, string> | undefined, keys: string[]) {
	if (!parameters) return undefined;
	const wanted = new Set(keys.map((key) => key.trim().toUpperCase()));
	return Object.entries(parameters).find(([key]) => wanted.has(key.trim().toUpperCase()))?.[1];
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
		hidden: pickHiddenBoolean(raw),
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
	const value =
		pickOptionalString(raw, ['value', 'Value', 'VALUE']) ??
		parameterValue(parameters, ['Value', 'VALUE']);
	const footprint =
		pickOptionalString(raw, ['footprint', 'Footprint', 'FOOTPRINT']) ??
		parameterValue(parameters, ['Footprint', 'FOOTPRINT', 'PCB Footprint', 'PCBFOOTPRINT']);
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
		value,
		footprint,
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
		hidden: pickHiddenBoolean(raw),
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
		mirrored: pickOptionalBoolean(raw, ['mirrored', 'Mirrored', 'MIRRORED']),
		hidden: pickHiddenBoolean(raw)
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

function nativeRecordKind(raw: Record<string, unknown>) {
	const value = pick(raw, [
		'kind',
		'Kind',
		'KIND',
		'objectKind',
		'ObjectKind',
		'OBJECTKIND',
		'objectType',
		'ObjectType',
		'OBJECTTYPE',
		'recordType',
		'RecordType',
		'RECORDTYPE',
		'objectId',
		'ObjectId',
		'OBJECTID',
		'type',
		'Type',
		'TYPE'
	]);
	return String(value ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '');
}

function nativeRecordIs(raw: Record<string, unknown>, names: string[]) {
	const kind = nativeRecordKind(raw);
	return names.some((name) => kind === name);
}

function nativeOwnerKey(raw: Record<string, unknown>, keys: string[]) {
	const value = pick(raw, keys);
	return value === undefined || value === null ? undefined : String(value).trim().toUpperCase();
}

function normalizeNativeSchematicRecords(records: unknown) {
	const rawRecords = Array.isArray(records)
		? records.filter(
				(record): record is Record<string, unknown> => !!record && typeof record === 'object'
			)
		: [];
	const componentRecords = rawRecords.filter((record) =>
		nativeRecordIs(record, [
			'nativecomponent',
			'eschcomponent',
			'ischcomponent',
			'schcomponent',
			'component'
		])
	);
	const pinRecords = rawRecords.filter((record) =>
		nativeRecordIs(record, ['nativepin', 'epin', 'ischpin', 'schpin', 'pin'])
	);
	const pinsByOwner = new Map<string, Record<string, unknown>[]>();
	for (const pin of pinRecords) {
		for (const owner of [
			nativeOwnerKey(pin, ['ownerIndex', 'OwnerIndex', 'OWNERINDEX']),
			nativeOwnerKey(pin, ['ownerDesignator', 'OwnerDesignator', 'OWNERDESIGNATOR', 'component']),
			nativeOwnerKey(pin, ['ownerUniqueId', 'OwnerUniqueId', 'OWNERUNIQUEID'])
		]) {
			if (!owner) continue;
			const pins = pinsByOwner.get(owner);
			if (pins) pins.push(pin);
			else pinsByOwner.set(owner, [pin]);
		}
	}

	const components = componentRecords.map((component) => {
		const owners = [
			nativeOwnerKey(component, ['ownerIndex', 'OwnerIndex', 'OWNERINDEX']),
			nativeOwnerKey(component, ['designator', 'Designator', 'DESIGNATOR', 'name', 'Name']),
			nativeOwnerKey(component, ['uniqueId', 'UniqueId', 'UNIQUEID'])
		].filter((owner): owner is string => !!owner);
		const ownedPins = owners.flatMap((owner) => pinsByOwner.get(owner) ?? []);
		return normalizeSchematicComponent({
			...component,
			pins: [
				...asArray(pick(component, ['pins', 'Pins', 'PINS']) ?? [], 'Native pins are invalid.'),
				...ownedPins
			]
		});
	});

	return {
		hasRecords: rawRecords.length > 0,
		components,
		wires: rawRecords
			.filter((record) =>
				nativeRecordIs(record, ['nativewire', 'ewire', 'ischwire', 'schwire', 'wire'])
			)
			.map((record) => normalizeSchematicWire(record)),
		netLabels: rawRecords
			.filter((record) =>
				nativeRecordIs(record, [
					'nativenetlabel',
					'enetlabel',
					'ischnetlabel',
					'schnetlabel',
					'netlabel'
				])
			)
			.map((record) => normalizeSchematicNetLabel(record)),
		ports: rawRecords
			.filter((record) => nativeRecordIs(record, ['nativeport', 'eport', 'ischport', 'port']))
			.map((record) => normalizeSchematicMarker(record)),
		powerPorts: rawRecords
			.filter((record) =>
				nativeRecordIs(record, ['nativepowerport', 'epowerobject', 'ischpowerport', 'powerport'])
			)
			.map((record) => normalizeSchematicMarker(record)),
		offSheetConnectors: rawRecords
			.filter((record) =>
				nativeRecordIs(record, [
					'nativeoffsheetconnector',
					'eoffsheetconnector',
					'ischoffsheetconnector',
					'offsheetconnector'
				])
			)
			.map((record) => normalizeSchematicMarker(record)),
		sheetSymbols: rawRecords
			.filter((record) =>
				nativeRecordIs(record, [
					'nativesheetsymbol',
					'esheetsymbol',
					'ischsheetsymbol',
					'sheetsymbol'
				])
			)
			.map((record) => normalizeSchematicMarker(record)),
		sheetEntries: rawRecords
			.filter((record) =>
				nativeRecordIs(record, ['nativesheetentry', 'esheetentry', 'ischsheetentry', 'sheetentry'])
			)
			.map((record) => normalizeSchematicMarker(record)),
		junctions: rawRecords
			.filter((record) =>
				nativeRecordIs(record, ['nativejunction', 'ejunction', 'ischjunction', 'junction'])
			)
			.map((record) => normalizeSchematicMarker(record)),
		noERC: rawRecords
			.filter((record) => nativeRecordIs(record, ['nativenoerc', 'enoerc', 'ischnoerc', 'noerc']))
			.map((record) => normalizeSchematicMarker(record)),
		directives: rawRecords
			.filter((record) =>
				nativeRecordIs(record, [
					'nativedirective',
					'eparameterset',
					'ischparameterset',
					'parameterset',
					'directive'
				])
			)
			.map((record) => normalizeSchematicMarker(record)),
		buses: rawRecords
			.filter((record) => nativeRecordIs(record, ['nativebus', 'ebus', 'ischbus', 'bus']))
			.map((record) => normalizeSchematicPolyline(record)),
		busEntries: rawRecords
			.filter((record) =>
				nativeRecordIs(record, ['nativebusentry', 'ebusentry', 'ischbusentry', 'busentry'])
			)
			.map((record) => normalizeSchematicMarker(record)),
		annotations: rawRecords
			.filter((record) =>
				nativeRecordIs(record, [
					'nativetext',
					'etext',
					'ischtext',
					'etextframe',
					'ischtextframe',
					'enote',
					'ischnote',
					'annotation',
					'textframe',
					'note'
				])
			)
			.map((record) => normalizeSchematicAnnotation(record))
	};
}

function withFileMeta<T extends AltiumDoc>(
	doc: T,
	name: string,
	size: number,
	exportMeta?: AltiumExportMeta
): T {
	return {
		...doc,
		schemaVersion: exportMeta?.schemaVersion,
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
			const nativeRecords = normalizeNativeSchematicRecords(
				pick(sheet, ['records', 'Records', 'RECORDS', 'nativeRecords', 'NativeRecords'])
			);

			return {
				id: typeof sheet.id === 'string' ? sheet.id : undefined,
				name: typeof sheet.name === 'string' ? sheet.name : `Sheet ${index + 1}`,
				fileName: typeof sheet.fileName === 'string' ? sheet.fileName : undefined,
				path: typeof sheet.path === 'string' ? sheet.path : undefined,
				components: (Array.isArray(sheet.components)
					? sheet.components
					: nativeRecords.hasRecords
						? nativeRecords.components
						: asArray(sheet.components, 'Schematic sheet is missing components array.')
				).map((component) => normalizeSchematicComponent(component)),
				wires: (Array.isArray(sheet.wires)
					? sheet.wires
					: nativeRecords.hasRecords
						? nativeRecords.wires
						: asArray(sheet.wires, 'Schematic sheet is missing wires array.')
				).map((wire) => normalizeSchematicWire(wire)),
				netLabels: (Array.isArray(sheet.netLabels)
					? sheet.netLabels
					: nativeRecords.hasRecords
						? nativeRecords.netLabels
						: asArray(sheet.netLabels, 'Schematic sheet is missing netLabels array.')
				).map((label) => normalizeSchematicNetLabel(label)),
				annotations: Array.isArray(sheet.annotations)
					? sheet.annotations.map((annotation) => normalizeSchematicAnnotation(annotation))
					: nativeRecords.annotations,
				ports: Array.isArray(sheet.ports) ? normalizeMarkers(sheet.ports) : nativeRecords.ports,
				powerPorts: Array.isArray(sheet.powerPorts)
					? normalizeMarkers(sheet.powerPorts)
					: nativeRecords.powerPorts,
				offSheetConnectors: Array.isArray(sheet.offSheetConnectors)
					? normalizeMarkers(sheet.offSheetConnectors)
					: nativeRecords.offSheetConnectors,
				sheetSymbols: Array.isArray(sheet.sheetSymbols)
					? normalizeMarkers(sheet.sheetSymbols)
					: nativeRecords.sheetSymbols,
				sheetEntries: Array.isArray(sheet.sheetEntries)
					? normalizeMarkers(sheet.sheetEntries)
					: nativeRecords.sheetEntries,
				junctions: Array.isArray(sheet.junctions)
					? normalizeMarkers(sheet.junctions)
					: nativeRecords.junctions,
				noERC: Array.isArray(sheet.noERC) ? normalizeMarkers(sheet.noERC) : nativeRecords.noERC,
				directives: Array.isArray(sheet.directives)
					? normalizeMarkers(sheet.directives)
					: nativeRecords.directives,
				buses: Array.isArray(sheet.buses)
					? sheet.buses.map((bus) => normalizeSchematicPolyline(bus))
					: nativeRecords.buses,
				busEntries: Array.isArray(sheet.busEntries)
					? normalizeMarkers(sheet.busEntries)
					: nativeRecords.busEntries
			} satisfies AltiumSchSheet;
		});

		return withFileMeta(
			{ type: 'schematic', fileName: name, fileSize: size, sheets },
			name,
			size,
			exportMeta
		);
	}

	const nativeRecords = normalizeNativeSchematicRecords(
		pick(raw, ['records', 'Records', 'RECORDS', 'nativeRecords', 'NativeRecords'])
	);
	const sheet = {
		name: typeof raw.name === 'string' ? raw.name : name,
		components: (Array.isArray(raw.components)
			? raw.components
			: nativeRecords.hasRecords
				? nativeRecords.components
				: asArray(raw.components, 'Schematic JSON is missing components array.')
		).map((component) => normalizeSchematicComponent(component)),
		wires: (Array.isArray(raw.wires)
			? raw.wires
			: nativeRecords.hasRecords
				? nativeRecords.wires
				: asArray(raw.wires, 'Schematic JSON is missing wires array.')
		).map((wire) => normalizeSchematicWire(wire)),
		netLabels: (Array.isArray(raw.netLabels)
			? raw.netLabels
			: nativeRecords.hasRecords
				? nativeRecords.netLabels
				: asArray(raw.netLabels, 'Schematic JSON is missing netLabels array.')
		).map((label) => normalizeSchematicNetLabel(label)),
		annotations: Array.isArray(raw.annotations)
			? raw.annotations.map((annotation) => normalizeSchematicAnnotation(annotation))
			: nativeRecords.annotations,
		ports: Array.isArray(raw.ports) ? normalizeMarkers(raw.ports) : nativeRecords.ports,
		powerPorts: Array.isArray(raw.powerPorts)
			? normalizeMarkers(raw.powerPorts)
			: nativeRecords.powerPorts,
		offSheetConnectors: Array.isArray(raw.offSheetConnectors)
			? normalizeMarkers(raw.offSheetConnectors)
			: nativeRecords.offSheetConnectors,
		sheetSymbols: Array.isArray(raw.sheetSymbols)
			? normalizeMarkers(raw.sheetSymbols)
			: nativeRecords.sheetSymbols,
		sheetEntries: Array.isArray(raw.sheetEntries)
			? normalizeMarkers(raw.sheetEntries)
			: nativeRecords.sheetEntries,
		junctions: Array.isArray(raw.junctions)
			? normalizeMarkers(raw.junctions)
			: nativeRecords.junctions,
		noERC: Array.isArray(raw.noERC) ? normalizeMarkers(raw.noERC) : nativeRecords.noERC,
		directives: Array.isArray(raw.directives)
			? normalizeMarkers(raw.directives)
			: nativeRecords.directives,
		buses: Array.isArray(raw.buses)
			? raw.buses.map((bus) => normalizeSchematicPolyline(bus))
			: nativeRecords.buses,
		busEntries: Array.isArray(raw.busEntries)
			? normalizeMarkers(raw.busEntries)
			: nativeRecords.busEntries
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
