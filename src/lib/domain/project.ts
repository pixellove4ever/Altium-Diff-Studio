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
	category: Exclude<ComponentCategory, 'all'> | 'other';
	searchText: string;
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
	if (['TP', 'T'].includes(prefix) || text.includes('testpoint') || text.includes('test point')) return 'testpoint';
	if (['L', 'D', 'Q', 'F'].includes(prefix) || text.includes('power') || text.includes('regulator')) return 'power';
	return 'other';
}

export function buildProjectIndex(project: AltiumProjectSet): ProjectIndex {
	const records = new Map<
		string,
		Omit<ProjectComponent, 'nets' | 'pinConnections' | 'category' | 'searchText'>
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

	const padsByComponent = new Map<string, Set<string>>();
	for (const pad of project.pcb?.pads ?? []) {
		if (!pad.component || !pad.net) continue;
		const key = pad.component.toUpperCase();
		if (!padsByComponent.has(key)) padsByComponent.set(key, new Set());
		padsByComponent.get(key)?.add(pad.net);
	}

	const components = Array.from(records.entries()).map(([key, record]) => {
		const nets = Array.from(padsByComponent.get(key) ?? []).sort(naturalDesignatorSort.compare);
		const componentPads = (project.pcb?.pads ?? []).filter(
			(pad) => pad.component?.trim().toUpperCase() === key
		);
		const pinConnections = (record.schematic?.pins ?? [])
			.map((pin) => {
				const pad = componentPads.find(
					(candidate) => candidate.designator.trim().toUpperCase() === pin.num.trim().toUpperCase()
				);
				return pad?.net
					? { pinNumber: pin.num, pinName: pin.name, net: pad.net, pad }
					: null;
			})
			.filter((connection): connection is NonNullable<typeof connection> => connection !== null);
		const parameters = Object.entries(record.bom?.parameters ?? {}).flat();
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
			...parameters,
			...nets
		]
			.filter(Boolean)
			.join(' ')
			.toLowerCase();
		return {
			...record,
			nets,
			pinConnections,
			category: classify(record.designator, searchable),
			searchText: searchable
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
			record = { name: name.trim(), components: new Set(), pads: [], tracks: [], vias: [], polygons: [] };
			netRecords.set(key, record);
		}
		return record;
	};
	for (const name of project.pcb?.nets ?? []) {
		if (name.trim()) netRecord(name);
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
		byDesignator: new Map(components.map((component) => [component.designator.toUpperCase(), component])),
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
