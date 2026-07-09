import type {
	AltiumPoint,
	AltiumSchComponent,
	AltiumSchMarker,
	AltiumSchSheet
} from '$lib/types/altium';

export interface SchematicNetAnchor {
	point: AltiumPoint;
	name: string;
	external: boolean;
	source: 'netLabel' | 'port' | 'powerPort' | 'offSheetConnector' | 'sheetEntry' | 'busEntry';
	hidden: boolean;
}

export interface SchematicHiddenPinConnection {
	component: AltiumSchComponent;
	pinNumber: string;
	pinName: string;
	net: string;
	point: AltiumPoint;
}

export type SchematicNetCatalogSource =
	| SchematicNetAnchor['source']
	| 'hiddenPin'
	| 'wire'
	| 'hierarchy';

export interface SchematicNetCatalogEntry {
	name: string;
	components: Set<string>;
	external: boolean;
	sources: Set<SchematicNetCatalogSource>;
}

export interface SchematicConnectivityDiagnostic {
	severity: 'warning' | 'error';
	path: string;
	message: string;
}

export interface SchematicHierarchyLink {
	name: string;
	parentSheetIndex: number;
	parentSymbolIndex: number;
	parentEntry: AltiumSchMarker;
	childSheetIndex: number;
	childPort: AltiumSchMarker;
	childSource: 'port' | 'offSheetConnector';
}

class UnionFind {
	private parent = new Map<string, string>();

	add(value: string) {
		if (!this.parent.has(value)) this.parent.set(value, value);
	}

	find(value: string): string {
		this.add(value);
		const parent = this.parent.get(value)!;
		if (parent === value) return value;
		const root = this.find(parent);
		this.parent.set(value, root);
		return root;
	}

	union(a: string, b: string) {
		const rootA = this.find(a);
		const rootB = this.find(b);
		if (rootA !== rootB) this.parent.set(rootB, rootA);
	}
}

const topologyCellSize = 100;
const topologyMaxCells = 256;
const maxExpandedBusBits = 256;
const pointKey = (point: AltiumPoint) => `${Math.round(point.x)},${Math.round(point.y)}`;
const inferredHiddenPowerNet =
	/^(VCC|VDD|VDDA|VDDD|VSS|VEE|VBAT|VIN|VOUT|PVDD|PVIN|AVDD|DVDD|IOVDD|GND|AGND|DGND|PGND|[+-]?\d+(?:V\d*|V)?|[+-]?V\d+(?:V\d+)?)$/i;

export function normalizeNetName(name: string) {
	return name.trim().toUpperCase();
}

export function isBusLikeNetName(name: string) {
	return /\[[^\]]+\]|<[^>]+>|\bBUS\b/i.test(name);
}

export function expandBusEntryNetNames(name: string) {
	const trimmed = name.trim();
	const match = trimmed.match(/^(.*?)(?:\[|<)\s*(-?\d+)\s*(?:\.\.|:)\s*(-?\d+)\s*(?:\]|>)$/);
	if (!match) return [trimmed].filter(Boolean);
	const [, prefix, startText, endText] = match;
	const start = Number.parseInt(startText, 10);
	const end = Number.parseInt(endText, 10);
	if (!Number.isFinite(start) || !Number.isFinite(end)) return [trimmed];
	const count = Math.abs(end - start) + 1;
	if (count > maxExpandedBusBits) return [trimmed];
	const step = start <= end ? 1 : -1;
	return Array.from({ length: count }, (_, index) => `${prefix.trim()}[${start + index * step}]`);
}

export function markerNetName(marker: { name?: string; text?: string }) {
	return marker.name || marker.text || '';
}

export function hiddenPinNetName(pin: { hidden?: boolean; hiddenNetName?: string; name: string }) {
	if (!pin.hidden) return null;
	if (pin.hiddenNetName?.trim()) return pin.hiddenNetName.trim();
	const name = pin.name.trim();
	return inferredHiddenPowerNet.test(name) ? name : null;
}

export function activeSchematicPins(component: AltiumSchComponent) {
	const part = component.pins.filter(
		(pin) =>
			component.currentPartId === undefined ||
			pin.ownerPartId === undefined ||
			pin.ownerPartId === 0 ||
			pin.ownerPartId === component.currentPartId
	);
	const display = part.filter(
		(pin) =>
			component.displayMode === undefined ||
			pin.ownerPartDisplayMode === undefined ||
			pin.ownerPartDisplayMode === component.displayMode
	);
	return display.length > 0 ? display : part.length > 0 ? part : component.pins;
}

export function schematicPinOuterPoint(pin: {
	x: number;
	y: number;
	orientation: number;
	length?: number;
}): AltiumPoint {
	const length = pin.length ?? 0;
	switch (pin.orientation) {
		case 1:
			return { x: pin.x, y: pin.y + length };
		case 2:
			return { x: pin.x - length, y: pin.y };
		case 3:
			return { x: pin.x, y: pin.y - length };
		default:
			return { x: pin.x + length, y: pin.y };
	}
}

function anchorsFromMarkers(
	markers: AltiumSchMarker[] | undefined,
	source: SchematicNetAnchor['source'],
	external: boolean
) {
	return (markers ?? []).map((marker) => ({
		point: marker,
		name: markerNetName(marker),
		external,
		source,
		hidden: marker.hidden === true
	}));
}

export function collectSchematicNetAnchors(sheet: AltiumSchSheet): SchematicNetAnchor[] {
	return [
		...sheet.netLabels.map((marker) => ({
			point: marker,
			name: marker.text,
			external: false,
			source: 'netLabel' as const,
			hidden: marker.hidden === true
		})),
		...anchorsFromMarkers(sheet.ports, 'port', true),
		...anchorsFromMarkers(sheet.offSheetConnectors, 'offSheetConnector', true),
		...anchorsFromMarkers(sheet.powerPorts, 'powerPort', true),
		...anchorsFromMarkers(sheet.sheetEntries, 'sheetEntry', true),
		...anchorsFromMarkers(sheet.busEntries, 'busEntry', true)
	];
}

export function collectHiddenPinConnections(sheet: AltiumSchSheet): SchematicHiddenPinConnection[] {
	return sheet.components.flatMap((component) =>
		activeSchematicPins(component).flatMap((pin) => {
			const net = hiddenPinNetName(pin);
			return net
				? [
						{
							component,
							pinNumber: pin.num,
							pinName: pin.name,
							net,
							point: schematicPinOuterPoint(pin)
						}
					]
				: [];
		})
	);
}

export function buildSchematicNetCatalog(sheets: AltiumSchSheet[]) {
	const entries = new Map<string, SchematicNetCatalogEntry>();
	const get = (name: string, source: SchematicNetCatalogSource, external = false) => {
		const normalized = normalizeNetName(name);
		if (!normalized) return null;
		let entry = entries.get(normalized);
		if (!entry) {
			entry = {
				name: name.trim(),
				components: new Set(),
				external,
				sources: new Set()
			};
			entries.set(normalized, entry);
		}
		entry.external ||= external;
		entry.sources.add(source);
		return entry;
	};

	for (const sheet of sheets) {
		for (const wire of sheet.wires ?? []) {
			if (wire.net?.trim()) get(wire.net, 'wire');
		}
		for (const anchor of collectSchematicNetAnchors(sheet)) {
			const names =
				anchor.source === 'busEntry' ? expandBusEntryNetNames(anchor.name) : [anchor.name];
			for (const name of names) get(name, anchor.source, anchor.external);
		}
		for (const connection of collectHiddenPinConnections(sheet)) {
			get(connection.net, 'hiddenPin')?.components.add(connection.component.designator);
		}
	}
	for (const link of buildSchematicHierarchyLinks(sheets)) {
		get(link.name, 'hierarchy', true);
	}

	return entries;
}

function buildSheetRootResolver(sheet: AltiumSchSheet) {
	const union = new UnionFind();
	const segmentBuckets = new Map<string, Array<[AltiumPoint, AltiumPoint]>>();
	const globalSegments: Array<[AltiumPoint, AltiumPoint]> = [];
	const cellCoord = (value: number) => Math.floor(value / topologyCellSize);
	const cellKey = (x: number, y: number) => `${x},${y}`;
	const addSegmentToIndex = (segment: [AltiumPoint, AltiumPoint]) => {
		const [start, end] = segment;
		const minX = cellCoord(Math.min(start.x, end.x));
		const maxX = cellCoord(Math.max(start.x, end.x));
		const minY = cellCoord(Math.min(start.y, end.y));
		const maxY = cellCoord(Math.max(start.y, end.y));
		const cellCount = (maxX - minX + 1) * (maxY - minY + 1);
		if (cellCount > topologyMaxCells) {
			globalSegments.push(segment);
			return;
		}
		for (let x = minX; x <= maxX; x += 1) {
			for (let y = minY; y <= maxY; y += 1) {
				const key = cellKey(x, y);
				const bucket = segmentBuckets.get(key);
				if (bucket) bucket.push(segment);
				else segmentBuckets.set(key, [segment]);
			}
		}
	};
	const segmentsNear = (point: AltiumPoint) => [
		...globalSegments,
		...(segmentBuckets.get(cellKey(cellCoord(point.x), cellCoord(point.y))) ?? [])
	];
	for (const wire of sheet.wires) {
		const points = wire.points ?? (wire.start && wire.end ? [wire.start, wire.end] : []);
		for (let index = 0; index < points.length; index += 1) {
			union.add(pointKey(points[index]));
			if (index > 0) {
				union.union(pointKey(points[index - 1]), pointKey(points[index]));
				addSegmentToIndex([points[index - 1], points[index]]);
			}
		}
	}
	const rootAt = (point: AltiumPoint) => {
		const key = pointKey(point);
		union.add(key);
		for (const [start, end] of segmentsNear(point)) {
			const cross =
				(point.x - start.x) * (end.y - start.y) - (point.y - start.y) * (end.x - start.x);
			const within =
				point.x >= Math.min(start.x, end.x) &&
				point.x <= Math.max(start.x, end.x) &&
				point.y >= Math.min(start.y, end.y) &&
				point.y <= Math.max(start.y, end.y);
			if (Math.abs(cross) <= 1 && within) union.union(key, pointKey(start));
		}
		return union.find(key);
	};

	return { rootAt };
}

export function diagnoseSchematicConnectivity(
	sheet: AltiumSchSheet,
	sheetPath = 'sheet'
): SchematicConnectivityDiagnostic[] {
	const diagnostics: SchematicConnectivityDiagnostic[] = [];
	const add = (path: string, message: string) =>
		diagnostics.push({ severity: 'warning', path, message });
	const namedBusEntries = (sheet.busEntries ?? []).filter((entry) => markerNetName(entry).trim());
	if ((sheet.buses?.length ?? 0) > 0 && namedBusEntries.length === 0) {
		add(
			`${sheetPath}.buses`,
			'Bus graphics are present without named bus entries; bit-level bus connectivity is not resolved yet.'
		);
	}
	const sheetSymbolIds = new Set(
		(sheet.sheetSymbols ?? [])
			.map((symbol) => symbol.uniqueId || symbol.id)
			.filter((id): id is string => !!id?.trim())
	);
	for (const [index, entry] of (sheet.sheetEntries ?? []).entries()) {
		if (
			entry.ownerSheetSymbolUniqueId?.trim() &&
			sheetSymbolIds.size > 0 &&
			!sheetSymbolIds.has(entry.ownerSheetSymbolUniqueId)
		) {
			add(
				`${sheetPath}.sheetEntries[${index}]`,
				`Sheet entry "${markerNetName(entry) || index + 1}" references a missing sheet symbol.`
			);
		}
	}
	for (const [componentIndex, component] of sheet.components.entries()) {
		for (const [pinIndex, pin] of activeSchematicPins(component).entries()) {
			if (!pin.hidden || hiddenPinNetName(pin)) continue;
			add(
				`${sheetPath}.components[${componentIndex}].pins[${pinIndex}]`,
				`Hidden pin "${pin.name || pin.num}" has no hidden net name and could not be inferred safely.`
			);
		}
	}
	const { rootAt } = buildSheetRootResolver(sheet);
	const namesByRoot = new Map<string, Map<string, string>>();
	const registerName = (point: AltiumPoint, name: string) => {
		const normalized = normalizeNetName(name);
		if (!normalized || isBusLikeNetName(name)) return;
		const root = rootAt(point);
		let names = namesByRoot.get(root);
		if (!names) {
			names = new Map();
			namesByRoot.set(root, names);
		}
		if (!names.has(normalized)) names.set(normalized, name.trim());
	};
	for (const anchor of collectSchematicNetAnchors(sheet)) registerName(anchor.point, anchor.name);
	for (const connection of collectHiddenPinConnections(sheet))
		registerName(connection.point, connection.net);
	for (const [root, names] of namesByRoot) {
		if (names.size < 2) continue;
		add(
			`${sheetPath}.connectivity.${root}`,
			`Connected schematic node has multiple net names: ${Array.from(names.values()).join(', ')}.`
		);
	}
	return diagnostics;
}

function schematicReferenceKeys(value: string | undefined) {
	if (!value?.trim()) return [];
	const normalized = value.trim().replaceAll('\\', '/').toUpperCase();
	const fileName = normalized.split('/').at(-1) ?? normalized;
	const stem = fileName.replace(/\.[^.]+$/, '');
	return Array.from(new Set([normalized, fileName, stem]));
}

function markerNameSet(markers: AltiumSchMarker[] | undefined) {
	return new Map(
		(markers ?? [])
			.map((marker) => markerNetName(marker))
			.filter((name) => name.trim())
			.map((name) => [normalizeNetName(name), name.trim()])
	);
}

function childSheetForSymbol(
	sheetsByReference: Map<string, { sheet: AltiumSchSheet; index: number }>,
	sheetIndex: number,
	symbol: AltiumSchMarker
) {
	return [
		...schematicReferenceKeys(symbol.fileName),
		...schematicReferenceKeys(markerNetName(symbol))
	].flatMap((key) => {
		const match = sheetsByReference.get(key);
		return match && match.index !== sheetIndex ? [match] : [];
	})[0];
}

function sheetsByReference(sheets: AltiumSchSheet[]) {
	const result = new Map<string, { sheet: AltiumSchSheet; index: number }>();
	for (const [index, sheet] of sheets.entries()) {
		for (const key of [
			...schematicReferenceKeys(sheet.fileName),
			...schematicReferenceKeys(sheet.path),
			...schematicReferenceKeys(sheet.name)
		]) {
			if (!result.has(key)) result.set(key, { sheet, index });
		}
	}
	return result;
}

export function buildSchematicHierarchyLinks(sheets: AltiumSchSheet[]): SchematicHierarchyLink[] {
	const references = sheetsByReference(sheets);
	const links: SchematicHierarchyLink[] = [];

	for (const [parentSheetIndex, sheet] of sheets.entries()) {
		for (const [parentSymbolIndex, symbol] of (sheet.sheetSymbols ?? []).entries()) {
			const child = childSheetForSymbol(references, parentSheetIndex, symbol);
			if (!child) continue;
			const symbolId = symbol.uniqueId || symbol.id;
			const entries = (sheet.sheetEntries ?? []).filter(
				(entry) =>
					!entry.ownerSheetSymbolUniqueId?.trim() ||
					!symbolId?.trim() ||
					entry.ownerSheetSymbolUniqueId === symbolId
			);
			if (entries.length === 0) continue;
			const childPorts = [
				...(child.sheet.ports ?? []).map((marker) => ({
					marker,
					source: 'port' as const
				})),
				...(child.sheet.offSheetConnectors ?? []).map((marker) => ({
					marker,
					source: 'offSheetConnector' as const
				}))
			];
			const childByName = new Map(
				childPorts
					.map((port) => [normalizeNetName(markerNetName(port.marker)), port] as const)
					.filter(([name]) => !!name)
			);

			for (const entry of entries) {
				const name = markerNetName(entry);
				const childPort = childByName.get(normalizeNetName(name));
				if (!childPort) continue;
				links.push({
					name: name.trim(),
					parentSheetIndex,
					parentSymbolIndex,
					parentEntry: entry,
					childSheetIndex: child.index,
					childPort: childPort.marker,
					childSource: childPort.source
				});
			}
		}
	}

	return links;
}

export function diagnoseSchematicHierarchy(
	sheets: AltiumSchSheet[]
): SchematicConnectivityDiagnostic[] {
	const diagnostics: SchematicConnectivityDiagnostic[] = [];
	const add = (path: string, message: string) =>
		diagnostics.push({ severity: 'warning', path, message });
	const references = sheetsByReference(sheets);

	for (const [sheetIndex, sheet] of sheets.entries()) {
		for (const [symbolIndex, symbol] of (sheet.sheetSymbols ?? []).entries()) {
			const child = childSheetForSymbol(references, sheetIndex, symbol);
			if (!child) continue;

			const symbolId = symbol.uniqueId || symbol.id;
			const entries = (sheet.sheetEntries ?? []).filter(
				(entry) =>
					!entry.ownerSheetSymbolUniqueId?.trim() ||
					!symbolId?.trim() ||
					entry.ownerSheetSymbolUniqueId === symbolId
			);
			if (entries.length === 0) continue;

			const entryNames = markerNameSet(entries);
			const childPortNames = markerNameSet([
				...(child.sheet.ports ?? []),
				...(child.sheet.offSheetConnectors ?? [])
			]);
			if (childPortNames.size === 0) continue;

			for (const [entryName, displayName] of entryNames) {
				if (!childPortNames.has(entryName)) {
					add(
						`sheets[${sheetIndex}].sheetSymbols[${symbolIndex}]`,
						`Sheet entry "${displayName}" has no matching port on child sheet "${child.sheet.name ?? child.sheet.fileName ?? child.index + 1}".`
					);
				}
			}
			for (const [portName, displayName] of childPortNames) {
				if (!entryNames.has(portName)) {
					add(
						`sheets[${child.index}]`,
						`Child sheet port "${displayName}" has no matching sheet entry on parent sheet "${sheet.name ?? sheet.fileName ?? sheetIndex + 1}".`
					);
				}
			}
		}
	}

	return diagnostics;
}
