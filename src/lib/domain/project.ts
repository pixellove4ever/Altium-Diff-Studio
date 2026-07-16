import type {
	AltiumBomItem,
	AltiumPcbComponent,
	AltiumPcbPad,
	AltiumPcbPolygon,
	AltiumPcbTrack,
	AltiumPcbVia,
	AltiumProjectSet,
	AltiumSchComponent,
	AltiumSchSheet
} from '$lib/types/altium';
import { bomViewerHiddenReason, shouldShowBomItemInViewer } from './bomVisibility.ts';
import {
	buildSchematicNetCatalog,
	collectHiddenPinConnections,
	markerNetName
} from './schematicConnectivity.ts';

export type ComponentCategory =
	| 'all'
	| 'resistor'
	| 'capacitor'
	| 'ic'
	| 'connector'
	| 'power'
	| 'testpoint';

export interface ProjectComponent {
	designator: string;
	bom?: AltiumBomItem;
	schematic?: AltiumSchComponent;
	sheet?: AltiumSchSheet;
	pcb?: AltiumPcbComponent;
	nets: string[];
	pinConnections: ProjectPinConnection[];
	parameters: Record<string, string>;
	category: Exclude<ComponentCategory, 'all'> | 'other';
	searchText: string;
	visibleInBomViewer: boolean;
	bomViewerHiddenReason: string;
}

export interface ProjectPinConnection {
	pinNumber: string;
	pinName: string;
	net: string;
	pad?: AltiumPcbPad;
}

export interface ProjectIndex {
	components: ProjectComponent[];
	byDesignator: Map<string, ProjectComponent>;
	nets: string[];
	byNet: Map<string, ProjectNet>;
}

export interface ProjectNet {
	name: string;
	components: string[];
	pads: AltiumPcbPad[];
	tracks: AltiumPcbTrack[];
	vias: AltiumPcbVia[];
	polygons: AltiumPcbPolygon[];
}

const naturalDesignatorSort = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const channelInstancePattern = /^(.+)_([A-Za-z]*\d+)$/;

function classify(designator: string, text: string): ProjectComponent['category'] {
	const prefix = designator.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? '';
	if (prefix === 'R' || prefix === 'RN') return 'resistor';
	if (prefix === 'C') return 'capacitor';
	if (['U', 'IC'].includes(prefix)) return 'ic';
	if (['J', 'P', 'CN', 'CON'].includes(prefix)) return 'connector';
	if (['TP', 'T'].includes(prefix) || text.includes('testpoint') || text.includes('test point'))
		return 'testpoint';
	if (['L', 'D', 'Q', 'F'].includes(prefix) || text.includes('power') || text.includes('regulator'))
		return 'power';
	return 'other';
}

function schematicReferenceKeys(value: string | undefined) {
	if (!value?.trim()) return [];
	const normalized = value.trim().replaceAll('\\', '/').toUpperCase();
	const fileName = normalized.split('/').at(-1) ?? normalized;
	const stem = fileName.replace(/\.[^.]+$/, '');
	return Array.from(new Set([normalized, fileName, stem]));
}

function channelNamesFromSheetSymbol(symbol: { name?: string; text?: string }) {
	const name = markerNetName(symbol).trim();
	if (!name) return [];
	const repeat = name.match(/^Repeat\(\s*([^,]*?)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
	if (!repeat) return [];
	const prefix = repeat[1].trim();
	const start = Number(repeat[2]);
	const end = Number(repeat[3]);
	if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
	const step = start <= end ? 1 : -1;
	return Array.from({ length: Math.abs(end - start) + 1 }, (_, index) => {
		const value = start + index * step;
		return `${prefix}${value}`;
	});
}

function childSheetForSymbol(
	sheetsByReference: Map<string, { sheet: AltiumSchSheet; index: number }>,
	parentIndex: number,
	symbol: { fileName?: string; name?: string; text?: string }
) {
	for (const key of [
		...schematicReferenceKeys(symbol.fileName),
		...schematicReferenceKeys(markerNetName(symbol))
	]) {
		const match = sheetsByReference.get(key);
		if (match && match.index !== parentIndex) return match;
	}
	return null;
}

export function buildProjectIndex(project: AltiumProjectSet): ProjectIndex {
	const records = new Map<
		string,
		Omit<
			ProjectComponent,
			| 'nets'
			| 'pinConnections'
			| 'parameters'
			| 'category'
			| 'searchText'
			| 'visibleInBomViewer'
			| 'bomViewerHiddenReason'
		>
	>();
	const get = (designator: string) => {
		const key = designator.trim().toUpperCase();
		if (!key) return null;
		let record = records.get(key);
		if (!record) {
			record = { designator: designator.trim() };
			records.set(key, record);
		}
		return record;
	};

	for (const item of project.bom?.items ?? []) {
		const record = get(item.designator);
		if (record) record.bom = item;
	}
	for (const sheet of project.schematic?.sheets ?? []) {
		for (const component of sheet.components) {
			const record = get(component.designator);
			if (!record) continue;
			record.schematic = component;
			record.sheet = sheet;
		}
	}
	for (const component of project.pcb?.components ?? []) {
		const record = get(component.designator);
		if (record) record.pcb = component;
	}
	const schematicSheets = project.schematic?.sheets ?? [];
	if (schematicSheets.length > 0) {
		const sheetsByReference = new Map<string, { sheet: AltiumSchSheet; index: number }>();
		for (const [index, sheet] of schematicSheets.entries()) {
			for (const key of [
				...schematicReferenceKeys(sheet.fileName),
				...schematicReferenceKeys(sheet.path),
				...schematicReferenceKeys(sheet.name)
			]) {
				if (!sheetsByReference.has(key)) sheetsByReference.set(key, { sheet, index });
			}
		}
		const sheetSymbolRefs: Array<{
			child: { sheet: AltiumSchSheet; index: number };
			symbolName: string;
			repeatChannels: string[];
		}> = [];
		for (const [parentIndex, sheet] of schematicSheets.entries()) {
			for (const symbol of sheet.sheetSymbols ?? []) {
				const child = childSheetForSymbol(sheetsByReference, parentIndex, symbol);
				if (!child) continue;
				sheetSymbolRefs.push({
					child,
					symbolName: markerNetName(symbol).trim(),
					repeatChannels: channelNamesFromSheetSymbol(symbol)
				});
			}
		}
		const refsByChild = new Map<number, typeof sheetSymbolRefs>();
		for (const ref of sheetSymbolRefs) {
			const refs = refsByChild.get(ref.child.index) ?? [];
			refs.push(ref);
			refsByChild.set(ref.child.index, refs);
		}
		for (const ref of sheetSymbolRefs) {
			const childRefs = refsByChild.get(ref.child.index) ?? [];
			const channels =
				ref.repeatChannels.length > 0
					? ref.repeatChannels
					: childRefs.length > 1
						? [ref.symbolName]
						: [];
			for (const channel of channels) {
				const normalizedChannel = channel.trim();
				if (!normalizedChannel) continue;
				for (const component of ref.child.sheet.components) {
					const baseRecord = get(component.designator);
					const instance = get(`${component.designator}_${normalizedChannel}`);
					if (!baseRecord || !instance) continue;
					instance.schematic = component;
					instance.sheet = ref.child.sheet;
					if (!instance.bom && baseRecord.bom) instance.bom = baseRecord.bom;
				}
			}
		}
	}
	for (const [key, record] of records) {
		if (record.schematic || !record.pcb?.baseDesignator) continue;
		const definition = records.get(record.pcb.baseDesignator.trim().toUpperCase());
		if (!definition?.schematic) continue;
		record.schematic = definition.schematic;
		record.sheet = definition.sheet;
		if (!record.bom && definition.bom) record.bom = definition.bom;
		records.set(key, record);
	}
	const channelTemplateKeys = new Set<string>();
	for (const record of records.values()) {
		const match = record.designator.match(channelInstancePattern);
		if (!match) continue;
		const baseKey = match[1].trim().toUpperCase();
		const baseRecord = records.get(baseKey);
		if (baseRecord && !baseRecord.pcb) channelTemplateKeys.add(baseKey);
	}

	const padsByComponent = new Map<
		string,
		{ nets: Set<string>; padsByDesignator: Map<string, AltiumPcbPad> }
	>();
	for (const pad of project.pcb?.pads ?? []) {
		if (!pad.component) continue;
		const key = pad.component.trim().toUpperCase();
		let componentPads = padsByComponent.get(key);
		if (!componentPads) {
			componentPads = { nets: new Set(), padsByDesignator: new Map() };
			padsByComponent.set(key, componentPads);
		}
		if (pad.net) componentPads.nets.add(pad.net);
		const padKey = pad.designator.trim().toUpperCase();
		if (!componentPads.padsByDesignator.has(padKey)) {
			componentPads.padsByDesignator.set(padKey, pad);
		}
	}

	const components = Array.from(records.entries()).map(([key, record]) => {
		const componentPads = padsByComponent.get(key);
		const schematicHiddenConnections = record.schematic
			? collectHiddenPinConnections({
					components: [record.schematic],
					wires: [],
					netLabels: []
				}).map((connection) => ({
					pinNumber: connection.pinNumber,
					pinName: connection.pinName,
					net: connection.net
				}))
			: [];
		const nets = Array.from(
			new Set([
				...Array.from(componentPads?.nets ?? []),
				...schematicHiddenConnections.map((connection) => connection.net)
			])
		).sort(naturalDesignatorSort.compare);
		const pcbPinConnections = (record.schematic?.pins ?? [])
			.map((pin) => {
				const pad = componentPads?.padsByDesignator.get(pin.num.trim().toUpperCase());
				return pad?.net ? { pinNumber: pin.num, pinName: pin.name, net: pad.net, pad } : null;
			})
			.filter((connection): connection is NonNullable<typeof connection> => connection !== null);
		const pcbConnectedPins = new Set(
			pcbPinConnections.map((connection) => connection.pinNumber.trim().toUpperCase())
		);
		const pinConnections = [
			...pcbPinConnections,
			...schematicHiddenConnections.filter(
				(connection) => !pcbConnectedPins.has(connection.pinNumber.trim().toUpperCase())
			)
		];
		const parameters = {
			...(record.schematic?.parameters ?? {}),
			...(record.bom?.parameters ?? {})
		};
		const parameterSearchTokens = Object.entries(parameters).flat();
		const searchable = [
			record.designator,
			record.bom?.comment,
			record.bom?.footprint,
			record.bom?.description,
			record.bom?.libRef,
			record.schematic?.comment,
			record.schematic?.libRef,
			record.pcb?.comment,
			record.pcb?.footprint,
			record.sheet?.name,
			...parameterSearchTokens,
			...nets
		]
			.filter(Boolean)
			.join(' ')
			.toLowerCase();
		const isChannelTemplate = channelTemplateKeys.has(key);
		const hiddenReason = isChannelTemplate ? 'Template' : bomViewerHiddenReason(record.bom);
		return {
			...record,
			nets,
			pinConnections,
			parameters,
			category: classify(record.designator, searchable),
			searchText: searchable,
			visibleInBomViewer: !isChannelTemplate && shouldShowBomItemInViewer(record.bom),
			bomViewerHiddenReason: hiddenReason
		};
	});
	components.sort((a, b) => naturalDesignatorSort.compare(a.designator, b.designator));

	const netRecords = new Map<
		string,
		{
			name: string;
			components: Set<string>;
			pads: AltiumPcbPad[];
			tracks: AltiumPcbTrack[];
			vias: AltiumPcbVia[];
			polygons: AltiumPcbPolygon[];
		}
	>();
	const netRecord = (name: string) => {
		const key = name.trim().toUpperCase();
		let record = netRecords.get(key);
		if (!record) {
			record = {
				name: name.trim(),
				components: new Set(),
				pads: [],
				tracks: [],
				vias: [],
				polygons: []
			};
			netRecords.set(key, record);
		}
		return record;
	};
	for (const name of project.pcb?.nets ?? []) {
		if (name.trim()) netRecord(name);
	}
	for (const schematicNet of buildSchematicNetCatalog(project.schematic?.sheets ?? []).values()) {
		const record = netRecord(schematicNet.name);
		for (const component of schematicNet.components) record.components.add(component);
	}
	for (const pad of project.pcb?.pads ?? []) {
		if (!pad.net?.trim()) continue;
		const record = netRecord(pad.net);
		record.pads.push(pad);
		if (pad.component) record.components.add(pad.component);
	}
	for (const track of project.pcb?.tracks ?? []) {
		if (track.net?.trim()) netRecord(track.net).tracks.push(track);
	}
	for (const via of project.pcb?.vias ?? []) {
		if (via.net?.trim()) netRecord(via.net).vias.push(via);
	}
	for (const polygon of project.pcb?.polygons ?? []) {
		if (polygon.net?.trim()) netRecord(polygon.net).polygons.push(polygon);
	}
	const byNet = new Map<string, ProjectNet>(
		Array.from(netRecords.entries()).map(([key, record]) => [
			key,
			{ ...record, components: Array.from(record.components).sort(naturalDesignatorSort.compare) }
		])
	);
	const nets = Array.from(byNet.values())
		.map((net) => net.name)
		.sort(naturalDesignatorSort.compare);

	return {
		components,
		byDesignator: new Map(
			components.map((component) => [component.designator.toUpperCase(), component])
		),
		nets,
		byNet
	};
}

export function searchProject(
	index: ProjectIndex,
	query: string,
	category: ComponentCategory = 'all'
): ProjectComponent[] {
	const needle = query.trim().toLowerCase();
	return index.components.filter(
		(component) =>
			(category === 'all' || component.category === category) &&
			(!needle || component.searchText.includes(needle))
	);
}
