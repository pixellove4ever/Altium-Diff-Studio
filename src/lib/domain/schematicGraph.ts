import type {
	AltiumPoint,
	AltiumSchComponent,
	AltiumSchPin,
	AltiumSchSheet
} from '$lib/types/altium';

export interface LogicalPort {
	id: string;
	name: string;
	numbers: string[];
	netId: string;
	netName: string;
	side: 'left' | 'right';
	count: number;
}

export function isPowerNet(name: string): boolean {
	const nameUpper = name.toUpperCase();
	return (
		nameUpper.includes('GND') ||
		nameUpper.includes('VCC') ||
		nameUpper.includes('VDD') ||
		nameUpper.includes('VSS') ||
		nameUpper.includes('PWR') ||
		nameUpper.includes('3V3') ||
		nameUpper.includes('5V') ||
		nameUpper.includes('12V') ||
		nameUpper.includes('VIN') ||
		nameUpper.startsWith('+') ||
		nameUpper.startsWith('-')
	);
}

export interface LogicalNode {
	id: string;
	component: AltiumSchComponent;
	label: string;
	subtitle: string;
	ports: LogicalPort[];
	powerPorts: LogicalPort[];
	x: number;
	y: number;
	width: number;
	height: number;
	kind:
		| 'resistor'
		| 'capacitor'
		| 'inductor'
		| 'diode'
		| 'testpoint'
		| 'connector'
		| 'ic'
		| 'transistor'
		| 'protection'
		| 'oscillator'
		| 'switch'
		| 'other';
}

export interface LogicalNet {
	id: string;
	name: string;
	ports: Array<{ nodeId: string; portId: string }>;
	external: boolean;
	testpoints: string[];
}

export interface LogicalSchematic {
	nodes: LogicalNode[];
	nets: LogicalNet[];
	width: number;
	height: number;
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

const pointKey = (point: AltiumPoint) => `${Math.round(point.x)},${Math.round(point.y)}`;

function pinOuterPoint(pin: AltiumSchPin): AltiumPoint {
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

function activePins(component: AltiumSchComponent) {
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

export function resolveUniquePinNet(
	connections: Array<{ pinNumber: string; net: string }>,
	pinNumbers: string[]
) {
	const pins = new Set(pinNumbers.map((number) => number.trim().toUpperCase()));
	const nets = new Map<string, string>();
	for (const connection of connections) {
		if (!pins.has(connection.pinNumber.trim().toUpperCase()) || !connection.net.trim()) continue;
		nets.set(connection.net.trim().toUpperCase(), connection.net.trim());
	}
	return nets.size === 1 ? nets.values().next().value : undefined;
}

function componentKey(component: AltiumSchComponent, index: number) {
	return `${component.designator}#${component.currentPartId ?? index}`;
}

function componentKind(component: AltiumSchComponent): LogicalNode['kind'] {
	const prefix = component.designator.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? '';
	if (prefix === 'R' || prefix === 'RN') return 'resistor';
	if (prefix === 'C') return 'capacitor';
	if (prefix === 'L') return 'inductor';
	if (prefix === 'D' || prefix === 'LED') return 'diode';
	if (prefix === 'TP') return 'testpoint';
	if (['J', 'P', 'JP', 'CN', 'CON'].includes(prefix)) return 'connector';
	if (['U', 'IC'].includes(prefix)) return 'ic';
	if (['Q', 'T'].includes(prefix)) return 'transistor';
	if (['F', 'FU', 'MOV', 'TVS'].includes(prefix)) return 'protection';
	if (['Y', 'X', 'XTAL'].includes(prefix)) return 'oscillator';
	if (['SW', 'K', 'RL'].includes(prefix)) return 'switch';
	return 'other';
}

export function buildLogicalSchematic(
	sheet: AltiumSchSheet,
	resolvePinNet?: (component: AltiumSchComponent, pinNumbers: string[]) => string | undefined
): LogicalSchematic {
	const union = new UnionFind();
	const segments: Array<[AltiumPoint, AltiumPoint]> = [];
	for (const wire of sheet.wires) {
		const points = wire.points ?? (wire.start && wire.end ? [wire.start, wire.end] : []);
		for (let index = 0; index < points.length; index += 1) {
			union.add(pointKey(points[index]));
			if (index > 0) {
				union.union(pointKey(points[index - 1]), pointKey(points[index]));
				segments.push([points[index - 1], points[index]]);
			}
		}
	}
	const rootAt = (point: AltiumPoint) => {
		const key = pointKey(point);
		union.add(key);
		for (const [start, end] of segments) {
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

	const namedMarkers = [
		...sheet.netLabels,
		...(sheet.ports ?? []),
		...(sheet.offSheetConnectors ?? []),
		...(sheet.powerPorts ?? []),
		...(sheet.sheetEntries ?? [])
	];
	for (const marker of namedMarkers) rootAt(marker);
	for (const component of sheet.components) {
		for (const pin of activePins(component)) rootAt(pinOuterPoint(pin));
	}

	const namesByRoot = new Map<string, string[]>();
	const externalRoots = new Set<string>();
	const addName = (point: AltiumPoint, name: string, external = false) => {
		if (!name.trim()) return;
		const root = rootAt(point);
		if (!namesByRoot.has(root)) namesByRoot.set(root, []);
		namesByRoot.get(root)?.push(name.trim());
		if (external) externalRoots.add(root);
	};
	for (const label of sheet.netLabels) addName(label, label.text);
	for (const component of sheet.components) {
		for (const pin of activePins(component)) {
			if (pin.hidden && pin.hiddenNetName?.trim()) addName(pinOuterPoint(pin), pin.hiddenNetName);
		}
	}
	for (const marker of [
		...(sheet.ports ?? []),
		...(sheet.offSheetConnectors ?? []),
		...(sheet.powerPorts ?? []),
		...(sheet.sheetEntries ?? [])
	]) {
		addName(marker, marker.text || marker.name || '', true);
	}

	const netByRoot = new Map<string, LogicalNet>();
	let unnamedIndex = 1;
	const getNet = (root: string) => {
		let net = netByRoot.get(root);
		if (!net) {
			const names = namesByRoot.get(root) ?? [];
			net = {
				id: root,
				name: names[0] || `N$${unnamedIndex++}`,
				ports: [],
				external: externalRoots.has(root),
				testpoints: []
			};
			netByRoot.set(root, net);
		}
		return net;
	};

	const allNodes: LogicalNode[] = sheet.components.map((component, componentIndex) => {
		const groups = new Map<
			string,
			{ pins: AltiumSchPin[]; net: LogicalNet; leftVotes: number; rightVotes: number }
		>();
		for (const pin of activePins(component)) {
			const root = rootAt(pinOuterPoint(pin));
			const net = getNet(root);
			const key = `${root}|${pin.name.trim().toUpperCase()}`;
			let group = groups.get(key);
			if (!group) {
				group = { pins: [], net, leftVotes: 0, rightVotes: 0 };
				groups.set(key, group);
			}
			group.pins.push(pin);
			if (pin.orientation === 2) group.leftVotes += 1;
			else group.rightVotes += 1;
		}
		const id = componentKey(component, componentIndex);
		const allPorts: LogicalPort[] = Array.from(groups.values()).map((group, portIndex) => {
			const first = group.pins[0];
			const resolvedNet = resolvePinNet?.(
				component,
				group.pins.map((pin) => pin.num)
			);
			if (resolvedNet && (group.net.name.startsWith('N$') || /^TP\d+$/i.test(group.net.name))) {
				group.net.name = resolvedNet;
			}
			const name = first.name || group.net.name;
			const port: LogicalPort = {
				id: `${id}:p${portIndex}`,
				name: group.pins.length > 1 ? `${name} ×${group.pins.length}` : name,
				numbers: group.pins.map((pin) => pin.num),
				netId: group.net.id,
				netName: group.net.name,
				side: group.leftVotes > group.rightVotes ? 'left' : 'right',
				count: group.pins.length
			};
			return port;
		});

		const ports = allPorts.filter((p) => !isPowerNet(p.netName));
		const powerPorts = allPorts.filter((p) => isPowerNet(p.netName));

		for (const port of ports) {
			const net = netByRoot.get(port.netId);
			if (net) {
				net.ports.push({ nodeId: id, portId: port.id });
			}
		}

		const leftCount = ports.filter((port) => port.side === 'left').length;
		const rightCount = ports.length - leftCount;
		const kind = componentKind(component);
		const compact = ['resistor', 'capacitor', 'inductor', 'diode', 'testpoint'].includes(kind);
		const powerRows = Math.ceil(powerPorts.length / 3);
		const extraPowerHeight = powerRows > 0 ? 12 + powerRows * 18 : 0;

		return {
			id,
			component,
			label: component.designator,
			subtitle: component.value || component.comment || component.libRef,
			ports,
			powerPorts,
			x: 0,
			y: 0,
			width: compact ? (kind === 'testpoint' ? 126 : 154) : kind === 'connector' ? 184 : 220,
			height:
				(compact
					? Math.max(84, Math.max(leftCount, rightCount) * 18 + 54)
					: Math.max(78, Math.max(leftCount, rightCount) * 22 + 60)) + extraPowerHeight,
			kind
		};
	});

	for (const node of allNodes) {
		if (node.kind !== 'testpoint') continue;
		for (const port of node.ports) {
			const net = netByRoot.get(port.netId);
			if (!net) continue;
			net.testpoints.push(node.label);
			net.ports = net.ports.filter((reference) => reference.nodeId !== node.id);
		}
	}
	const nodes = allNodes.filter((node) => node.kind !== 'testpoint');
	const columns = Math.max(1, Math.min(7, Math.ceil(Math.sqrt(nodes.length * 0.65))));

	// Build adjacency list for non-power nets to calculate signal flow distance
	const adj = new Map<string, string[]>();
	const netsList = Array.from(netByRoot.values()).filter((net) => net.ports.length > 0);
	for (const net of netsList) {
		// Skip power and ground rails
		if (isPowerNet(net.name)) {
			continue;
		}
		const connectedNodeIds = net.ports.map((p) => p.nodeId);
		for (const idA of connectedNodeIds) {
			for (const idB of connectedNodeIds) {
				if (idA !== idB) {
					if (!adj.has(idA)) adj.set(idA, []);
					adj.get(idA)!.push(idB);
				}
			}
		}
	}

	// Determine layers (column rankings) using BFS from connectors or ICs
	const layers = new Map<string, number>();
	const visited = new Set<string>();
	const queue: string[] = [];

	const startNodes = nodes.filter((n) => n.kind === 'connector');
	const fallbackStartNodes = nodes.filter((n) => n.kind === 'ic');
	const initialNodes =
		startNodes.length > 0
			? startNodes
			: fallbackStartNodes.length > 0
				? fallbackStartNodes
				: [nodes[0]];

	for (const node of initialNodes) {
		if (node) {
			queue.push(node.id);
			layers.set(node.id, 0);
			visited.add(node.id);
		}
	}

	while (queue.length > 0) {
		const curr = queue.shift()!;
		const currLayer = layers.get(curr)!;
		const neighbors = adj.get(curr) ?? [];
		for (const neighbor of neighbors) {
			if (!visited.has(neighbor)) {
				visited.add(neighbor);
				layers.set(neighbor, currLayer + 1);
				queue.push(neighbor);
			}
		}
	}

	// Handle disconnected components/graphs
	for (const node of nodes) {
		if (!visited.has(node.id)) {
			visited.add(node.id);
			layers.set(node.id, 0);
			queue.push(node.id);
			while (queue.length > 0) {
				const curr = queue.shift()!;
				const currLayer = layers.get(curr)!;
				const neighbors = adj.get(curr) ?? [];
				for (const neighbor of neighbors) {
					if (!visited.has(neighbor)) {
						visited.add(neighbor);
						layers.set(neighbor, currLayer + 1);
						queue.push(neighbor);
					}
				}
			}
		}
	}

	// Sort components by BFS layer and then by original X coordinate
	const ordered = [...nodes].sort((a, b) => {
		const layerA = layers.get(a.id) ?? 0;
		const layerB = layers.get(b.id) ?? 0;
		return layerA - layerB || a.component.x - b.component.x;
	});

	const columnNodes: LogicalNode[][] = Array.from({ length: columns }, () => []);
	for (let index = 0; index < ordered.length; index += 1) {
		const node = ordered[index];
		const column = Math.min(
			columns - 1,
			Math.floor((index * columns) / Math.max(ordered.length, 1))
		);
		columnNodes[column].push(node);
	}

	// Leave enough room for external signal labels between two component columns.
	const columnWidth = 440;
	let maxHeight = 0;
	for (let column = 0; column < columns; column += 1) {
		const items = columnNodes[column].sort((a, b) => b.component.y - a.component.y);
		let y = 70;
		for (const node of items) {
			node.x = 70 + column * columnWidth;
			node.y = y;
			y += node.height + 70;
		}
		maxHeight = Math.max(maxHeight, y);
	}

	return {
		nodes,
		nets: Array.from(netByRoot.values()).filter((net) => net.ports.length > 0),
		width: 70 + columns * columnWidth,
		height: Math.max(300, maxHeight)
	};
}
