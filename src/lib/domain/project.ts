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
import { buildSchematicNetCatalog, collectHiddenPinConnections } from './schematicConnectivity.ts';

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
		let record = records.get(key);
		if (!record) {
			record = { designator: designator.trim() };
			records.set(key, record);
		}
		return record;
	};

	for (const item of project.bom?.items ?? []) get(item.designator).bom = item;
	for (const sheet of project.schematic?.sheets ?? []) {
		for (const component of sheet.components) {
			const record = get(component.designator);
			record.schematic = component;
			record.sheet = sheet;
		}
	}
	for (const component of project.pcb?.components ?? []) get(component.designator).pcb = component;
	for (const [key, record] of records) {
		if (record.schematic || !record.pcb?.baseDesignator) continue;
		const definition = records.get(record.pcb.baseDesignator.trim().toUpperCase());
		if (!definition?.schematic) continue;
		record.schematic = definition.schematic;
		record.sheet = definition.sheet;
		if (!record.bom && definition.bom) record.bom = definition.bom;
		records.set(key, record);
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
		return {
			...record,
			nets,
			pinConnections,
			parameters,
			category: classify(record.designator, searchable),
			searchText: searchable,
			visibleInBomViewer: shouldShowBomItemInViewer(record.bom),
			bomViewerHiddenReason: bomViewerHiddenReason(record.bom)
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
