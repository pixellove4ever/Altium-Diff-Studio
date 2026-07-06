<script lang="ts">
	import BaseCanvas, { type CanvasClick } from '$lib/components/BaseCanvas.svelte';
	import {
		buildLogicalSchematic,
		resolveUniquePinNet,
		type LogicalNode,
		type LogicalPort
	} from '$lib/domain/schematicGraph';
	import type { ProjectIndex } from '$lib/domain/project';
	import { localeStore } from '$lib/state/localeStore.svelte';
	import { projectStore } from '$lib/state/projectStore.svelte';
	import type { AltiumSchSheet } from '$lib/types/altium';

	let {
		sheet,
		baselineSheet,
		targetSide = 'B',
		channel = ''
	}: {
		sheet: AltiumSchSheet;
		baselineSheet?: AltiumSchSheet;
		targetSide?: 'A' | 'B';
		channel?: string;
	} = $props();

	function resolvePinNetFromIndex(
		index: ProjectIndex,
		component: LogicalNode['component'],
		pinNumbers: string[]
	) {
		const record = index.byDesignator.get(component.designator.toUpperCase());
		return resolveUniquePinNet(
			(record?.pinConnections ?? []).filter((connection) => !/^TP\d+$/i.test(connection.net)),
			pinNumbers
		);
	}

	function resolveTargetPinNet(component: LogicalNode['component'], pinNumbers: string[]) {
		const index =
			projectStore.mode === 'view' || targetSide === 'A'
				? projectStore.indexA
				: projectStore.indexB;
		return resolvePinNetFromIndex(index, component, pinNumbers);
	}

	function resolveBaselinePinNet(component: LogicalNode['component'], pinNumbers: string[]) {
		return resolvePinNetFromIndex(projectStore.indexA, component, pinNumbers);
	}

	type LogicalStatus = 'unchanged' | 'added' | 'removed' | 'modified';

	function nodeSignature(node: LogicalNode) {
		const connections = [...node.ports, ...node.powerPorts]
			.map((port) => `${[...port.numbers].sort().join(',')}:${port.netName.toUpperCase()}`)
			.sort();
		return JSON.stringify([node.kind, node.subtitle, connections]);
	}

	function netSignature(net: ReturnType<typeof buildLogicalSchematic>['nets'][number]) {
		const ports = net.ports
			.map((port) => `${port.nodeId.split('#')[0]}:${port.portId.split(':').at(-1)}`)
			.sort()
			.join('|');
		return `${ports}::TP:${[...net.testpoints].sort().join(',')}`;
	}

	const comparison = $derived.by(() => {
		const target = buildLogicalSchematic(sheet, resolveTargetPinNet);
		const nodeStatuses = new Map<string, LogicalStatus>();
		const netStatuses = new Map<string, LogicalStatus>();
		const powerStatuses = new Map<string, LogicalStatus>();
		if (!baselineSheet) {
			for (const node of target.nodes) nodeStatuses.set(node.id, 'unchanged');
			for (const net of target.nets) netStatuses.set(net.id, 'unchanged');
			for (const node of target.nodes) {
				for (const port of node.powerPorts) powerStatuses.set(port.id, 'unchanged');
			}
			return { logical: target, nodeStatuses, netStatuses, powerStatuses };
		}

		const baseline = buildLogicalSchematic(baselineSheet, resolveBaselinePinNet);
		const baselineNodes = new Map(baseline.nodes.map((node) => [node.id, node]));
		const targetNodes = new Map(target.nodes.map((node) => [node.id, node]));
		for (const node of target.nodes) {
			const before = baselineNodes.get(node.id);
			nodeStatuses.set(
				node.id,
				!before ? 'added' : nodeSignature(before) === nodeSignature(node) ? 'unchanged' : 'modified'
			);
			for (const port of node.powerPorts) {
				const pinNumbers = new Set(port.numbers);
				const beforePort = before?.powerPorts.find((candidate) =>
					candidate.numbers.some((number) => pinNumbers.has(number))
				);
				powerStatuses.set(
					port.id,
					!beforePort
						? 'added'
						: beforePort.netName.toUpperCase() === port.netName.toUpperCase()
							? 'unchanged'
							: 'modified'
				);
			}
		}
		const removed = baseline.nodes.filter((node) => !targetNodes.has(node.id));
		for (const node of removed) {
			nodeStatuses.set(node.id, 'removed');
			for (const port of node.powerPorts) powerStatuses.set(port.id, 'removed');
		}

		const baselineNets = new Map(
			baseline.nets
				.filter((net) => !net.name.startsWith('N$'))
				.map((net) => [net.name.toUpperCase(), net])
		);
		for (const net of target.nets) {
			const before = baselineNets.get(net.name.toUpperCase());
			netStatuses.set(
				net.id,
				!before ? 'added' : netSignature(before) === netSignature(net) ? 'unchanged' : 'modified'
			);
		}

		const columns = Math.max(1, Math.floor((target.width - 70) / 440));
		const startY = target.height + 40;
		const removedNodes = removed.map((node, index) => ({
			...node,
			x: 70 + (index % columns) * 440,
			y: startY + Math.floor(index / columns) * (node.height + 55)
		}));
		const removedBottom =
			removedNodes.length > 0
				? Math.max(...removedNodes.map((node) => node.y + node.height + 40))
				: target.height;
		const allNodes = [...target.nodes, ...removedNodes];
		const allNodesById = new Map(allNodes.map((node) => [node.id, node]));
		const baselineNodesById = new Map(baseline.nodes.map((node) => [node.id, node]));
		const targetNetNames = new Set(
			target.nets.filter((net) => !net.name.startsWith('N$')).map((net) => net.name.toUpperCase())
		);
		const removedNets = baseline.nets
			.filter((net) => !net.name.startsWith('N$') && !targetNetNames.has(net.name.toUpperCase()))
			.map((net) => {
				const id = `removed:${net.id}`;
				const ports = net.ports
					.map((reference) => {
						const beforeNode = baselineNodesById.get(reference.nodeId);
						const beforePort = beforeNode?.ports.find((port) => port.id === reference.portId);
						const displayNode = allNodesById.get(reference.nodeId);
						if (!beforePort || !displayNode) return null;
						const numbers = new Set(beforePort.numbers);
						const displayPort = displayNode.ports.find((port) =>
							port.numbers.some((number) => numbers.has(number))
						);
						return displayPort ? { nodeId: displayNode.id, portId: displayPort.id } : null;
					})
					.filter(
						(reference): reference is { nodeId: string; portId: string } => reference !== null
					);
				netStatuses.set(id, 'removed');
				return { ...net, id, ports };
			})
			.filter((net) => net.ports.length > 0);
		return {
			logical: {
				...target,
				nodes: allNodes,
				nets: [...target.nets, ...removedNets],
				height: Math.max(target.height, removedBottom)
			},
			nodeStatuses,
			netStatuses,
			powerStatuses
		};
	});
	const logical = $derived(comparison.logical);
	const padding = 48;

	let animationTick = $state(0);
	let isolateSelectedNet = $state(false);
	let showDenseLabels = $state(false);
	let showStages = $state(true);
	let showMiniMap = $state(true);
	let traceMode = $state(false);
	let traceStart = $state<string | null>(null);
	let traceEnd = $state<string | null>(null);
	const traceResult = $derived.by(() => {
		if (!traceStart || !traceEnd) return null;
		const adjacency = new Map<string, Array<{ nodeId: string; netId: string }>>();
		for (const net of logical.nets) {
			if (comparison.netStatuses.get(net.id) === 'removed') continue;
			const nodeIds = Array.from(new Set(net.ports.map((port) => port.nodeId)));
			for (const from of nodeIds) {
				if (!adjacency.has(from)) adjacency.set(from, []);
				for (const to of nodeIds) {
					if (from !== to) adjacency.get(from)?.push({ nodeId: to, netId: net.id });
				}
			}
		}
		const queue = [traceStart];
		const previous = new Map<string, { nodeId: string; netId: string }>();
		const visited = new Set([traceStart]);
		while (queue.length > 0 && !visited.has(traceEnd)) {
			const current = queue.shift()!;
			for (const edge of adjacency.get(current) ?? []) {
				if (visited.has(edge.nodeId)) continue;
				visited.add(edge.nodeId);
				previous.set(edge.nodeId, { nodeId: current, netId: edge.netId });
				queue.push(edge.nodeId);
			}
		}
		if (!visited.has(traceEnd))
			return { nodeIds: new Set([traceStart, traceEnd]), netIds: new Set<string>() };
		const nodeIds = new Set<string>([traceEnd]);
		const netIds = new Set<string>();
		let current = traceEnd;
		while (current !== traceStart) {
			const step = previous.get(current);
			if (!step) break;
			nodeIds.add(step.nodeId);
			netIds.add(step.netId);
			current = step.nodeId;
		}
		return { nodeIds, netIds };
	});

	$effect(() => {
		if (!projectStore.selectedNet) return;
		let frameId: number;
		function tick() {
			animationTick += 1;
			frameId = requestAnimationFrame(tick);
		}
		frameId = requestAnimationFrame(tick);
		return () => {
			cancelAnimationFrame(frameId);
		};
	});

	function designator(node: LogicalNode) {
		return channel ? `${node.label}_${channel}` : node.label;
	}

	function portsOnSide(node: LogicalNode, side: 'left' | 'right') {
		return node.ports.filter((port) => port.side === side);
	}

	function powerAreaHeight(node: LogicalNode) {
		return node.powerPorts.length > 0 ? 12 + Math.ceil(node.powerPorts.length / 3) * 18 : 0;
	}

	function portPosition(node: LogicalNode, port: LogicalPort) {
		const sidePorts = portsOnSide(node, port.side);
		const index = sidePorts.findIndex((candidate) => candidate.id === port.id);
		const availableHeight = Math.max(20, node.height - 38 - powerAreaHeight(node));
		const step = availableHeight / Math.max(sidePorts.length + 1, 2);
		return {
			x: port.side === 'left' ? node.x : node.x + node.width,
			y: node.y + 32 + (index + 1) * step
		};
	}

	function powerPortBounds(node: LogicalNode, port: LogicalPort) {
		const index = node.powerPorts.findIndex((candidate) => candidate.id === port.id);
		const columns = Math.min(3, node.powerPorts.length);
		const gap = 5;
		const inset = 8;
		const width = (node.width - inset * 2 - gap * (columns - 1)) / columns;
		const row = Math.floor(index / 3);
		const column = index % 3;
		return {
			x: node.x + inset + column * (width + gap),
			y: node.y + node.height - 8 - (Math.ceil(node.powerPorts.length / 3) - row) * 18,
			width,
			height: 14
		};
	}

	type RoutedEndpoint = {
		x: number;
		y: number;
		side: 'left' | 'right';
		nodeId: string;
	};
	type RoutedSegment = { x1: number; y1: number; x2: number; y2: number };

	function chooseTrunkX(
		endpoints: RoutedEndpoint[],
		netIndex: number,
		occupiedSegments: RoutedSegment[]
	) {
		if (endpoints.length === 1) {
			const point = endpoints[0];
			return point.x + (point.side === 'left' ? -45 : 45);
		}
		const minX = Math.min(...endpoints.map((point) => point.x));
		const maxX = Math.max(...endpoints.map((point) => point.x));
		const minY = Math.min(...endpoints.map((point) => point.y));
		const maxY = Math.max(...endpoints.map((point) => point.y));
		const midpoint = (minX + maxX) / 2;
		const candidates = [
			midpoint + ((netIndex % 5) - 2) * 7,
			midpoint,
			minX - 36 - (netIndex % 4) * 7,
			maxX + 36 + (netIndex % 4) * 7,
			minX,
			maxX
		];
		const score = (candidate: number) => {
			let obstruction = 0;
			for (const node of logical.nodes) {
				const crossesX = candidate > node.x - 6 && candidate < node.x + node.width + 6;
				const crossesY = maxY > node.y - 6 && minY < node.y + node.height + 6;
				if (crossesX && crossesY && !endpoints.some((point) => point.nodeId === node.id)) {
					obstruction += 1;
				}
			}
			for (const point of endpoints) {
				const segmentMinX = Math.min(point.x, candidate);
				const segmentMaxX = Math.max(point.x, candidate);
				for (const node of logical.nodes) {
					if (node.id === point.nodeId) continue;
					const crossesY = point.y > node.y - 6 && point.y < node.y + node.height + 6;
					const crossesX = segmentMaxX > node.x - 6 && segmentMinX < node.x + node.width + 6;
					if (crossesX && crossesY) obstruction += 1;
				}
			}
			const wireLength = endpoints.reduce(
				(total, point) => total + Math.abs(point.x - candidate),
				maxY - minY
			);
			let crossings = 0;
			for (const occupied of occupiedSegments) {
				const occupiedVertical = occupied.x1 === occupied.x2;
				if (
					!occupiedVertical &&
					candidate >= Math.min(occupied.x1, occupied.x2) &&
					candidate <= Math.max(occupied.x1, occupied.x2) &&
					occupied.y1 >= minY &&
					occupied.y1 <= maxY
				) {
					crossings += 1;
				}
				if (!occupiedVertical) continue;
				for (const point of endpoints) {
					if (
						occupied.x1 >= Math.min(point.x, candidate) &&
						occupied.x1 <= Math.max(point.x, candidate) &&
						point.y >= Math.min(occupied.y1, occupied.y2) &&
						point.y <= Math.max(occupied.y1, occupied.y2)
					) {
						crossings += 1;
					}
				}
			}
			return obstruction * 100_000 + crossings * 250 + wireLength;
		};
		return candidates.reduce((best, candidate) =>
			score(candidate) < score(best) ? candidate : best
		);
	}

	const routedNets = $derived.by(() => {
		const nodeById = new Map(logical.nodes.map((node) => [node.id, node]));
		const occupiedSegments: RoutedSegment[] = [];
		const routes = new Map<
			string,
			{ endpoints: RoutedEndpoint[]; trunkX: number; minY: number; maxY: number }
		>();
		for (const [netIndex, net] of logical.nets.entries()) {
			const endpoints = net.ports
				.map((reference) => {
					const node = nodeById.get(reference.nodeId);
					const port = node?.ports.find((candidate) => candidate.id === reference.portId);
					return node && port
						? { ...portPosition(node, port), side: port.side, nodeId: node.id }
						: null;
				})
				.filter((point): point is RoutedEndpoint => point !== null);
			if (endpoints.length === 0) continue;
			const trunkX = chooseTrunkX(endpoints, netIndex, occupiedSegments);
			const minY = Math.min(...endpoints.map((point) => point.y));
			const maxY = Math.max(...endpoints.map((point) => point.y));
			routes.set(net.id, { endpoints, trunkX, minY, maxY });
			occupiedSegments.push({ x1: trunkX, y1: minY, x2: trunkX, y2: maxY });
			for (const point of endpoints) {
				occupiedSegments.push({ x1: point.x, y1: point.y, x2: trunkX, y2: point.y });
			}
		}
		return routes;
	});

	function isGround(name: string) {
		const upper = name.toUpperCase();
		return upper.includes('GND') || upper.includes('VSS') || upper === '0V';
	}

	function isBusNet(name: string) {
		return /\[[^\]]+\]|<[^>]+>|\bBUS\b/i.test(name);
	}

	function drawText(
		ctx: CanvasRenderingContext2D,
		text: string,
		x: number,
		y: number,
		size: number,
		align: CanvasTextAlign = 'left',
		color = '#334155',
		bold = false
	) {
		ctx.fillStyle = color;
		ctx.font = `${bold ? 'bold ' : ''}${size}px Inter, system-ui, sans-serif`;
		ctx.textAlign = align;
		ctx.textBaseline = 'middle';
		ctx.fillText(text, x, y);
	}

	function nodeTheme(kind: LogicalNode['kind']) {
		switch (kind) {
			case 'resistor':
				return { fill: '#fffbeb', stroke: '#d97706', header: '#fef3c7', tag: 'RES' };
			case 'capacitor':
				return { fill: '#f0fdf4', stroke: '#16a34a', header: '#dcfce7', tag: 'CAP' };
			case 'inductor':
				return { fill: '#faf5ff', stroke: '#9333ea', header: '#f3e8ff', tag: 'IND' };
			case 'diode':
				return { fill: '#fff5f5', stroke: '#e11d48', header: '#ffe4e6', tag: 'DIO' };
			case 'testpoint':
				return { fill: '#f0f9ff', stroke: '#0284c7', header: '#bae6fd', tag: 'TP' };
			case 'connector':
				return { fill: '#f8fafc', stroke: '#475569', header: '#e2e8f0', tag: 'CON' };
			case 'ic':
				return { fill: '#f0fdfa', stroke: '#0f766e', header: '#ccfbf1', tag: 'IC' };
			case 'transistor':
				return { fill: '#fff7ed', stroke: '#ea580c', header: '#ffedd5', tag: 'TR' };
			case 'protection':
				return { fill: '#fff1f2', stroke: '#e11d48', header: '#ffe4e6', tag: 'SAFE' };
			case 'oscillator':
				return { fill: '#eff6ff', stroke: '#2563eb', header: '#dbeafe', tag: 'CLK' };
			case 'switch':
				return { fill: '#fdf4ff', stroke: '#c026d3', header: '#fae8ff', tag: 'SW' };
			default:
				return { fill: '#ffffff', stroke: '#64748b', header: '#cbd5e1', tag: 'DEV' };
		}
	}

	function drawGlyph(ctx: CanvasRenderingContext2D, node: LogicalNode) {
		const x = node.x + node.width / 2;
		const contentBottom = node.y + node.height - powerAreaHeight(node) - 18;
		const y = (node.y + 28 + contentBottom) / 2;
		ctx.save();
		ctx.strokeStyle = nodeTheme(node.kind).stroke;
		ctx.fillStyle = '#ffffff';
		ctx.lineWidth = 1.8;
		ctx.beginPath();
		if (node.kind === 'resistor') {
			ctx.moveTo(x - 28, y);
			for (let index = 0; index < 7; index += 1) {
				ctx.lineTo(x - 21 + index * 7, y + (index % 2 === 0 ? -6 : 6));
			}
			ctx.lineTo(x + 28, y);
		} else if (node.kind === 'capacitor') {
			ctx.moveTo(x - 28, y);
			ctx.lineTo(x - 5, y);
			ctx.moveTo(x - 5, y - 10);
			ctx.lineTo(x - 5, y + 10);
			ctx.moveTo(x + 5, y - 10);
			ctx.lineTo(x + 5, y + 10);
			ctx.moveTo(x + 5, y);
			ctx.lineTo(x + 28, y);
		} else if (node.kind === 'inductor') {
			ctx.moveTo(x - 28, y);
			for (let index = 0; index < 4; index += 1) {
				ctx.arc(x - 18 + index * 12, y, 6, Math.PI, 0);
			}
			ctx.lineTo(x + 28, y);
		} else if (node.kind === 'diode') {
			ctx.moveTo(x - 28, y);
			ctx.lineTo(x - 7, y);
			ctx.moveTo(x - 7, y - 9);
			ctx.lineTo(x + 8, y);
			ctx.lineTo(x - 7, y + 9);
			ctx.closePath();
			ctx.moveTo(x + 9, y - 10);
			ctx.lineTo(x + 9, y + 10);
			ctx.moveTo(x + 9, y);
			ctx.lineTo(x + 28, y);
		} else if (node.kind === 'testpoint') {
			ctx.arc(x, y, 10, 0, Math.PI * 2);
			ctx.moveTo(x - 20, y);
			ctx.lineTo(x - 10, y);
			ctx.moveTo(x + 10, y);
			ctx.lineTo(x + 20, y);
		} else if (node.kind === 'connector') {
			for (let index = -1; index <= 1; index += 1) {
				ctx.rect(x - 16, y + index * 9 - 3, 7, 6);
				ctx.rect(x + 9, y + index * 9 - 3, 7, 6);
			}
		}
		ctx.stroke();
		ctx.restore();
	}

	function draw({
		ctx,
		width,
		height
	}: {
		ctx: CanvasRenderingContext2D;
		width: number;
		height: number;
	}) {
		// Suppress typescript warning on unused variable
		animationTick;

		const fit = Math.min(
			(width - padding * 2) / Math.max(logical.width, 1),
			(height - padding * 2) / Math.max(logical.height, 1)
		);
		ctx.save();
		ctx.translate((width - logical.width * fit) / 2, (height - logical.height * fit) / 2);
		ctx.scale(fit, fit);

		const nodeById = new Map(logical.nodes.map((node) => [node.id, node]));
		const labelRects: Array<{ x: number; y: number; width: number; height: number }> = [];

		if (showStages) {
			const columns = Array.from(
				new Set(
					logical.nodes
						.filter((node) => comparison.nodeStatuses.get(node.id) !== 'removed')
						.map((node) => node.x)
				)
			).sort((left, right) => left - right);
			for (const [index, columnX] of columns.entries()) {
				const nodes = logical.nodes.filter(
					(node) => node.x === columnX && comparison.nodeStatuses.get(node.id) !== 'removed'
				);
				if (nodes.length === 0) continue;
				const top = Math.min(...nodes.map((node) => node.y)) - 30;
				const bottom = Math.max(...nodes.map((node) => node.y + node.height)) + 25;
				ctx.fillStyle = index % 2 === 0 ? 'rgba(99, 102, 241, 0.025)' : 'rgba(6, 182, 212, 0.025)';
				ctx.strokeStyle = index % 2 === 0 ? 'rgba(99, 102, 241, 0.1)' : 'rgba(6, 182, 212, 0.1)';
				ctx.lineWidth = 0.8;
				ctx.beginPath();
				ctx.roundRect(columnX - 22, top, 264, bottom - top, 14);
				ctx.fill();
				ctx.stroke();
				drawText(
					ctx,
					`STAGE ${index + 1}`,
					columnX - 10,
					top + 12,
					8,
					'left',
					index % 2 === 0 ? '#6366f1' : '#0891b2',
					true
				);
			}
		}

		// Render Wires (Nets)
		logical.nets.forEach((net) => {
			if (traceResult && !traceResult.netIds.has(net.id)) return;
			if (
				isolateSelectedNet &&
				projectStore.selectedNet &&
				net.name.toUpperCase() !== projectStore.selectedNet.toUpperCase()
			)
				return;
			const route = routedNets.get(net.id);
			if (!route) return;
			const { endpoints, trunkX, minY, maxY } = route;

			const selected = net.name.toUpperCase() === projectStore.selectedNet?.toUpperCase();
			const netStatus = comparison.netStatuses.get(net.id) ?? 'unchanged';
			const addedNet = netStatus === 'added';
			const modifiedNet = netStatus === 'modified';
			const removedNet = netStatus === 'removed';
			const busNet = isBusNet(net.name);

			ctx.save();
			if (selected) {
				// 1. Glowing outer track
				ctx.strokeStyle = 'rgba(8, 145, 178, 0.22)';
				ctx.lineWidth = 6.0;
				ctx.lineCap = 'round';
				ctx.lineJoin = 'round';
				ctx.beginPath();
				ctx.moveTo(trunkX, minY);
				ctx.lineTo(trunkX, maxY);
				for (const point of endpoints) {
					ctx.moveTo(point.x, point.y);
					ctx.lineTo(trunkX, point.y);
				}
				ctx.stroke();

				// 2. Primary solid core
				ctx.strokeStyle = '#0891b2';
				ctx.lineWidth = 2.2;
				ctx.beginPath();
				ctx.moveTo(trunkX, minY);
				ctx.lineTo(trunkX, maxY);
				for (const point of endpoints) {
					ctx.moveTo(point.x, point.y);
					ctx.lineTo(trunkX, point.y);
				}
				ctx.stroke();

				// 3. Marching ants flowing current animation overlay
				ctx.strokeStyle = '#ffffff';
				ctx.lineWidth = 1.2;
				ctx.setLineDash([5, 5]);
				ctx.lineDashOffset = -animationTick * 0.45;
				ctx.beginPath();
				ctx.moveTo(trunkX, minY);
				ctx.lineTo(trunkX, maxY);
				for (const point of endpoints) {
					ctx.moveTo(point.x, point.y);
					ctx.lineTo(trunkX, point.y);
				}
				ctx.stroke();
			} else {
				// Regular wire
				ctx.strokeStyle = addedNet
					? '#16a34a'
					: modifiedNet
						? '#f97316'
						: removedNet
							? '#dc2626'
							: net.name.startsWith('N$')
								? 'rgba(203, 213, 225, 0.55)'
								: '#b8c5d6';
				ctx.lineWidth =
					addedNet || modifiedNet || removedNet
						? 1.8
						: busNet
							? 2.4
							: net.name.startsWith('N$')
								? 0.8
								: 1.2;
				if (removedNet) ctx.setLineDash([6, 4]);
				ctx.beginPath();
				ctx.moveTo(trunkX, minY);
				ctx.lineTo(trunkX, maxY);
				for (const point of endpoints) {
					ctx.moveTo(point.x, point.y);
					ctx.lineTo(trunkX, point.y);
				}
				ctx.stroke();
			}
			ctx.restore();

			// Draw connection junction dots on trunk (schematic style)
			if (endpoints.length > 1) {
				ctx.save();
				ctx.fillStyle = selected
					? '#0891b2'
					: addedNet
						? '#16a34a'
						: modifiedNet
							? '#f97316'
							: removedNet
								? '#dc2626'
								: net.name.startsWith('N$')
									? 'rgba(148, 163, 184, 0.55)'
									: '#94a3b8';
				for (const point of endpoints) {
					ctx.beginPath();
					ctx.arc(trunkX, point.y, net.name.startsWith('N$') ? 1.5 : 2.5, 0, Math.PI * 2);
					ctx.fill();
				}
				ctx.restore();
			}

			// Technical N$ identifiers are layout artifacts, not useful signal names.
			// Keep their wiring visible but only label named nets or nets carrying a test point.
			const touchesDenseNode = endpoints.some(
				(endpoint) => (nodeById.get(endpoint.nodeId)?.ports.length ?? 0) > 24
			);
			if (
				(!touchesDenseNode || showDenseLabels || selected) &&
				(!net.name.startsWith('N$') || net.testpoints.length > 0)
			) {
				const signalName = net.name.startsWith('N$') ? '' : `${busNet ? '▰ ' : ''}${net.name}`;
				const testpointHint = net.testpoints.length > 0 ? `TP ${net.testpoints.join(', ')}` : '';
				const label = [signalName, testpointHint].filter(Boolean).join('  ·  ');
				const singleEndpoint = endpoints.length === 1 ? endpoints[0] : null;
				const labelAlign: CanvasTextAlign = singleEndpoint?.side === 'right' ? 'left' : 'right';
				const labelX = singleEndpoint
					? singleEndpoint.x + (singleEndpoint.side === 'left' ? -9 : 9)
					: trunkX - 7;
				const anchorY = minY - 12;
				let labelY = anchorY;
				ctx.save();
				ctx.font = `${selected ? 'bold ' : ''}10px Inter, system-ui, sans-serif`;
				const labelWidth = ctx.measureText(label).width + 12;
				const labelRectX = labelAlign === 'left' ? labelX : labelX - labelWidth;
				for (let attempt = 0; attempt < 10; attempt += 1) {
					const overlaps = labelRects.some(
						(rect) =>
							labelRectX < rect.x + rect.width &&
							labelRectX + labelWidth > rect.x &&
							labelY - 8 < rect.y + rect.height &&
							labelY + 8 > rect.y
					);
					if (!overlaps) break;
					labelY += 18;
				}
				labelRects.push({ x: labelRectX, y: labelY - 8, width: labelWidth, height: 16 });
				if (labelY !== anchorY) {
					ctx.strokeStyle = removedNet ? '#fda4af' : modifiedNet ? '#fdba74' : '#cbd5e1';
					ctx.lineWidth = 0.7;
					ctx.beginPath();
					ctx.moveTo(labelX, anchorY + 3);
					ctx.lineTo(labelX, labelY - 8);
					ctx.stroke();
				}
				ctx.fillStyle = selected
					? '#ecfeff'
					: addedNet
						? '#f0fdf4'
						: modifiedNet
							? '#fff7ed'
							: removedNet
								? '#fff1f2'
								: 'rgba(248, 250, 252, 0.96)';
				ctx.strokeStyle = selected
					? '#67e8f9'
					: addedNet
						? '#86efac'
						: modifiedNet
							? '#fdba74'
							: removedNet
								? '#fda4af'
								: '#d8e0eb';
				ctx.lineWidth = 0.8;
				ctx.beginPath();
				ctx.roundRect(labelRectX, labelY - 8, labelWidth, 16, 5);
				ctx.fill();
				ctx.stroke();
				ctx.restore();
				drawText(
					ctx,
					label,
					labelX + (labelAlign === 'left' ? 6 : -6),
					labelY,
					10,
					labelAlign,
					selected
						? '#0e7490'
						: addedNet
							? '#15803d'
							: modifiedNet
								? '#c2410c'
								: removedNet
									? '#be123c'
									: '#334155',
					true
				);
			}
		});

		// Render Nodes (Component Cards)
		for (const node of logical.nodes) {
			const selected =
				projectStore.selectedDesignator?.toUpperCase() === designator(node).toUpperCase();
			const theme = nodeTheme(node.kind);
			const diffStatus = comparison.nodeStatuses.get(node.id) ?? 'unchanged';
			const diffTheme =
				diffStatus === 'added'
					? { fill: '#f0fdf4', stroke: '#16a34a', header: '#dcfce7', mark: '+' }
					: diffStatus === 'removed'
						? { fill: '#fff1f2', stroke: '#dc2626', header: '#ffe4e6', mark: '−' }
						: diffStatus === 'modified'
							? { fill: '#fff7ed', stroke: '#f97316', header: '#ffedd5', mark: '~' }
							: null;
			const compact = ['resistor', 'capacitor', 'inductor', 'diode', 'testpoint'].includes(
				node.kind
			);
			const densePorts = node.ports.length > 24;

			if (selected) {
				ctx.save();
				ctx.strokeStyle = 'rgba(37, 99, 235, 0.28)';
				ctx.lineWidth = 10;
				ctx.beginPath();
				ctx.roundRect(node.x - 9, node.y - 9, node.width + 18, node.height + 18, compact ? 18 : 14);
				ctx.stroke();
				ctx.strokeStyle = '#60a5fa';
				ctx.lineWidth = 2;
				ctx.setLineDash([7, 5]);
				ctx.beginPath();
				ctx.roundRect(node.x - 7, node.y - 7, node.width + 14, node.height + 14, compact ? 17 : 13);
				ctx.stroke();
				ctx.restore();
			}

			// Draw elegant card drop shadow
			ctx.save();
			if (selected) {
				ctx.shadowColor = 'rgba(37, 99, 235, 0.18)';
				ctx.shadowBlur = 12;
				ctx.shadowOffsetY = 4;
			} else {
				ctx.shadowColor = 'rgba(15, 23, 42, 0.05)';
				ctx.shadowBlur = 6;
				ctx.shadowOffsetY = 2;
			}

			// Fill node background card
			ctx.fillStyle = selected ? '#ffffff' : (diffTheme?.fill ?? theme.fill);
			ctx.strokeStyle = selected ? '#2563eb' : (diffTheme?.stroke ?? theme.stroke);
			ctx.lineWidth = selected ? 2.2 : 1.2;
			ctx.beginPath();
			ctx.roundRect(node.x, node.y, node.width, node.height, compact ? 12 : 8);
			ctx.fill();
			ctx.stroke();
			ctx.restore(); // remove shadow settings for further drawing

			// Draw header bar background
			ctx.save();
			ctx.fillStyle = selected ? '#2563eb' : (diffTheme?.header ?? theme.header);
			ctx.beginPath();
			ctx.roundRect(node.x, node.y, node.width, 28, [compact ? 12 : 8, compact ? 12 : 8, 0, 0]);
			ctx.fill();
			ctx.restore();

			// Draw category/type tag next to header text
			const badgeText = `${diffTheme?.mark ? `${diffTheme.mark} ` : ''}${theme.tag}`;
			const badgeWidth = badgeText.length * 5 + 10;
			ctx.save();
			ctx.fillStyle = selected ? 'rgba(255, 255, 255, 0.25)' : 'rgba(15, 23, 42, 0.06)';
			ctx.beginPath();
			ctx.roundRect(node.x + node.width - badgeWidth - 8, node.y + 6, badgeWidth, 16, 4);
			ctx.fill();
			drawText(
				ctx,
				badgeText,
				node.x + node.width - badgeWidth / 2 - 8,
				node.y + 14,
				7.5,
				'center',
				selected ? '#ffffff' : '#475569',
				true
			);

			if (diffStatus === 'removed') {
				ctx.save();
				ctx.globalAlpha = 0.62;
				ctx.strokeStyle = '#dc2626';
				ctx.lineWidth = 1.4;
				ctx.setLineDash([5, 4]);
				ctx.beginPath();
				ctx.roundRect(node.x - 3, node.y - 3, node.width + 6, node.height + 6, compact ? 14 : 10);
				ctx.stroke();
				ctx.restore();
			}
			ctx.restore();

			// Component Designator Label
			drawText(
				ctx,
				designator(node),
				node.x + 10,
				node.y + 14,
				11,
				'left',
				selected ? '#ffffff' : '#0f172a',
				true
			);

			// Component subtitle (Value, package, or description)
			if (compact || node.kind === 'connector') {
				drawGlyph(ctx, node);
			} else {
				drawText(ctx, node.subtitle, node.x + 10, node.y + 36, 8, 'left', '#475569');
			}

			if (densePorts) {
				drawText(
					ctx,
					`${node.ports.length} pins connected`,
					node.x + node.width / 2,
					node.y + node.height / 2 + 10,
					10,
					'center',
					'#94a3b8'
				);
			}

			// Power and ground belong to the component card: no dangling rail is drawn.
			for (const powerPort of node.powerPorts) {
				const bounds = powerPortBounds(node, powerPort);
				const ground = isGround(powerPort.netName);
				const selectedPower =
					powerPort.netName.toUpperCase() === projectStore.selectedNet?.toUpperCase();
				const powerStatus = comparison.powerStatuses.get(powerPort.id) ?? 'unchanged';
				ctx.save();
				ctx.fillStyle = selectedPower
					? ground
						? '#334155'
						: '#7c3aed'
					: powerStatus === 'added'
						? '#dcfce7'
						: powerStatus === 'modified'
							? '#ffedd5'
							: powerStatus === 'removed'
								? '#ffe4e6'
								: ground
									? '#e2e8f0'
									: '#ede9fe';
				ctx.beginPath();
				ctx.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, 5);
				ctx.fill();
				drawText(
					ctx,
					`${ground ? '⏚' : '◆'} ${powerPort.netName}`,
					bounds.x + bounds.width / 2,
					bounds.y + bounds.height / 2,
					7,
					'center',
					selectedPower
						? '#ffffff'
						: powerStatus === 'added'
							? '#15803d'
							: powerStatus === 'modified'
								? '#c2410c'
								: powerStatus === 'removed'
									? '#be123c'
									: ground
										? '#334155'
										: '#6d28d9',
					true
				);
				ctx.restore();
			}

			// Compact subtitle placement
			if (compact && node.subtitle) {
				const summary =
					node.subtitle.length > 20 ? `${node.subtitle.slice(0, 19)}…` : node.subtitle;
				drawText(
					ctx,
					summary,
					node.x + node.width / 2,
					node.y + node.height - powerAreaHeight(node) - 9,
					7.5,
					'center',
					selected ? '#1e40af' : '#475569'
				);
			}

			// Render Terminals (Port Contacts)
			for (const port of node.ports) {
				const point = portPosition(node, port);
				const selectedNet = port.netName.toUpperCase() === projectStore.selectedNet?.toUpperCase();

				ctx.save();
				ctx.fillStyle = selectedNet ? '#0891b2' : '#ffffff';
				ctx.strokeStyle = selectedNet ? '#0891b2' : '#94a3b8';
				ctx.lineWidth = selectedNet ? 2.0 : 1.0;
				ctx.beginPath();
				ctx.arc(point.x, point.y, selectedNet ? 3.5 : 2.4, 0, Math.PI * 2);
				ctx.fill();
				ctx.stroke();
				ctx.restore();

				if ((!compact && !densePorts) || selectedNet) {
					drawText(
						ctx,
						port.name,
						point.x + (port.side === 'left' ? 7 : -7),
						point.y,
						7.5,
						port.side === 'left' ? 'left' : 'right',
						selectedNet ? '#0891b2' : '#475569',
						selectedNet
					);
				}
			}
			if (traceResult && !traceResult.nodeIds.has(node.id)) {
				ctx.save();
				ctx.fillStyle = 'rgba(248, 250, 252, 0.82)';
				ctx.beginPath();
				ctx.roundRect(node.x - 2, node.y - 2, node.width + 4, node.height + 4, compact ? 14 : 10);
				ctx.fill();
				ctx.restore();
			}
		}
		ctx.restore();
	}

	function toLogical(event: CanvasClick) {
		const fit = Math.min(
			(event.width - padding * 2) / Math.max(logical.width, 1),
			(event.height - padding * 2) / Math.max(logical.height, 1)
		);
		const x0 = (event.width - logical.width * fit) / 2;
		const y0 = (event.height - logical.height * fit) / 2;
		const localX = (event.x - event.panX) / event.zoom;
		const localY = (event.y - event.panY) / event.zoom;
		return { x: (localX - x0) / fit, y: (localY - y0) / fit };
	}

	function nodeAt(event: CanvasClick) {
		const point = toLogical(event);
		return logical.nodes.find(
			(node) =>
				point.x >= node.x &&
				point.x <= node.x + node.width &&
				point.y >= node.y &&
				point.y <= node.y + node.height
		);
	}

	function portAt(event: CanvasClick) {
		const point = toLogical(event);
		for (const node of logical.nodes) {
			for (const port of node.ports) {
				const position = portPosition(node, port);
				if (Math.hypot(point.x - position.x, point.y - position.y) <= 9) {
					return { node, port };
				}
			}
		}
		return null;
	}

	function powerPortAt(event: CanvasClick) {
		const point = toLogical(event);
		for (const node of logical.nodes) {
			for (const port of node.powerPorts) {
				const bounds = powerPortBounds(node, port);
				if (
					point.x >= bounds.x &&
					point.x <= bounds.x + bounds.width &&
					point.y >= bounds.y &&
					point.y <= bounds.y + bounds.height
				) {
					return { node, port };
				}
			}
		}
		return null;
	}

	function onClick(event: CanvasClick) {
		const terminal = powerPortAt(event) ?? portAt(event);
		if (terminal) {
			projectStore.selectNet(terminal.port.netName);
			return;
		}
		const node = nodeAt(event);
		if (traceMode && node) {
			if (!traceStart || traceEnd) {
				traceStart = node.id;
				traceEnd = null;
			} else {
				traceEnd = node.id;
			}
			projectStore.selectDesignator(designator(node));
			return;
		}
		projectStore.selectDesignator(node ? designator(node) : null);
	}

	function toggleTraceMode() {
		traceMode = !traceMode;
		traceStart = null;
		traceEnd = null;
	}

	function tooltip(event: CanvasClick) {
		const powerTerminal = powerPortAt(event);
		if (powerTerminal) {
			return `${powerTerminal.node.label} · ${isGround(powerTerminal.port.netName) ? 'Ground' : 'Power'} · ${powerTerminal.port.netName} · pins ${powerTerminal.port.numbers.join(', ')}`;
		}
		const terminal = portAt(event);
		if (terminal) {
			return `${terminal.node.label}.${terminal.port.name} · ${terminal.port.netName} · pins ${terminal.port.numbers.join(', ')}`;
		}
		const node = nodeAt(event);
		return node
			? `${designator(node)} · ${node.subtitle} · ${node.ports.length} logical connections`
			: null;
	}

	function resolveFocus(width: number, height: number) {
		const fit = Math.min(
			(width - padding * 2) / Math.max(logical.width, 1),
			(height - padding * 2) / Math.max(logical.height, 1)
		);
		const x0 = (width - logical.width * fit) / 2;
		const y0 = (height - logical.height * fit) / 2;
		const selectedDesignator = projectStore.selectedDesignator?.toUpperCase();
		if (selectedDesignator) {
			const node = logical.nodes.find(
				(candidate) => designator(candidate).toUpperCase() === selectedDesignator
			);
			if (node) {
				return {
					x: x0 + (node.x + node.width / 2) * fit,
					y: y0 + (node.y + node.height / 2) * fit,
					zoom: Math.min(5, Math.max(2.2, 150 / Math.max(node.width * fit, 1)))
				};
			}
		}

		const selectedNet = projectStore.selectedNet?.toUpperCase();
		if (!selectedNet) return null;
		const net = logical.nets.find((candidate) => candidate.name.toUpperCase() === selectedNet);
		if (!net) return null;
		const nodeById = new Map(logical.nodes.map((node) => [node.id, node]));
		const points = net.ports
			.map((reference) => {
				const node = nodeById.get(reference.nodeId);
				const port = node?.ports.find((candidate) => candidate.id === reference.portId);
				return node && port ? portPosition(node, port) : null;
			})
			.filter((point): point is { x: number; y: number } => point !== null);
		if (points.length === 0) return null;
		return {
			x: x0 + (points.reduce((sum, point) => sum + point.x, 0) / points.length) * fit,
			y: y0 + (points.reduce((sum, point) => sum + point.y, 0) / points.length) * fit,
			zoom: 2.5
		};
	}

	function miniMapColor(node: LogicalNode) {
		const status = comparison.nodeStatuses.get(node.id) ?? 'unchanged';
		if (status === 'added') return '#22c55e';
		if (status === 'modified') return '#f97316';
		if (status === 'removed') return '#ef4444';
		return nodeTheme(node.kind).stroke;
	}
</script>

<div class="logical-shell">
	<BaseCanvas
		background="#f8fafc"
		{draw}
		onCanvasClick={onClick}
		resolveTooltip={tooltip}
		focusKey={projectStore.selectedDesignator ?? projectStore.selectedNet}
		{resolveFocus}
		showHud={true}
	/>
	{#if !projectStore.minimalUi}
		<div class="logical-tools">
			<button class:active={showStages} onclick={() => (showStages = !showStages)}
				>{localeStore.t('logical.stages')}</button
			>
			<button class:active={showDenseLabels} onclick={() => (showDenseLabels = !showDenseLabels)}
				>{localeStore.t('logical.icLabels')}</button
			>
			<button
				class:active={isolateSelectedNet}
				disabled={!projectStore.selectedNet}
				onclick={() => (isolateSelectedNet = !isolateSelectedNet)}
				>{localeStore.t('logical.isolateNet')}</button
			>
			<button class:active={traceMode} onclick={toggleTraceMode}
				>{localeStore.t('logical.tracePath')}</button
			>
			<button class:active={showMiniMap} onclick={() => (showMiniMap = !showMiniMap)}
				>{localeStore.t('logical.map')}</button
			>
		</div>
	{/if}
	{#if traceMode && !projectStore.minimalUi}
		<div class="trace-hint">
			{#if !traceStart}
				{localeStore.t('logical.selectSource')}
			{:else if !traceEnd}
				{localeStore.t('logical.selectDestination')}
			{:else if traceResult && traceResult.netIds.size > 0}
				{localeStore.t('logical.pathFound', { count: traceResult.netIds.size })}
			{:else}
				{localeStore.t('logical.noPath')}
			{/if}
			<button
				onclick={() => {
					traceStart = null;
					traceEnd = null;
				}}>{localeStore.t('logical.reset')}</button
			>
		</div>
	{/if}
	{#if showMiniMap && !projectStore.minimalUi}
		<div class="mini-map" aria-label={localeStore.t('logical.mapLabel')}>
			{#each logical.nodes as node}
				<button
					title={designator(node)}
					class:selected={projectStore.selectedDesignator?.toUpperCase() ===
						designator(node).toUpperCase()}
					style={`left:${(node.x / logical.width) * 100}%;top:${(node.y / logical.height) * 100}%;width:${Math.max(2, (node.width / logical.width) * 100)}%;height:${Math.max(3, (node.height / logical.height) * 100)}%;--node-color:${miniMapColor(node)}`}
					onclick={() => projectStore.selectDesignator(designator(node))}
				></button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.logical-shell {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 0;
	}

	.logical-tools {
		position: absolute;
		z-index: 5;
		top: 10px;
		right: 10px;
		display: flex;
		gap: 4px;
		padding: 4px;
		border: 1px solid rgba(203, 213, 225, 0.85);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.9);
		box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
		backdrop-filter: blur(8px);
	}

	.logical-tools button {
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: #64748b;
		cursor: pointer;
		font-size: 0.68rem;
		font-weight: 800;
		padding: 6px 8px;
	}

	.logical-tools button:hover,
	.logical-tools button.active {
		background: #eef2ff;
		color: #4f46e5;
	}

	.logical-tools button:disabled {
		cursor: default;
		opacity: 0.4;
	}

	.trace-hint {
		position: absolute;
		z-index: 5;
		top: 56px;
		left: 50%;
		display: flex;
		align-items: center;
		gap: 10px;
		border: 1px solid #c7d2fe;
		border-radius: 999px;
		background: rgba(238, 242, 255, 0.95);
		color: #4338ca;
		font-size: 0.72rem;
		font-weight: 800;
		padding: 6px 8px 6px 12px;
		box-shadow: 0 6px 18px rgba(79, 70, 229, 0.12);
		transform: translateX(-50%);
	}

	.trace-hint button {
		border: 0;
		border-radius: 999px;
		background: #ffffff;
		color: #4f46e5;
		cursor: pointer;
		font: inherit;
		padding: 3px 8px;
	}

	.mini-map {
		position: absolute;
		z-index: 5;
		left: 12px;
		bottom: 12px;
		width: 184px;
		height: 116px;
		border: 1px solid rgba(148, 163, 184, 0.6);
		border-radius: 9px;
		background:
			linear-gradient(rgba(255, 255, 255, 0.92), rgba(248, 250, 252, 0.94)),
			repeating-linear-gradient(0deg, transparent, transparent 11px, #e2e8f0 12px);
		box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
		overflow: hidden;
	}

	.mini-map button {
		position: absolute;
		min-width: 3px;
		min-height: 3px;
		border: 0;
		border-radius: 2px;
		background: color-mix(in srgb, var(--node-color) 28%, white);
		box-shadow: inset 0 0 0 1px var(--node-color);
		cursor: pointer;
	}

	.mini-map button:hover,
	.mini-map button.selected {
		z-index: 2;
		background: var(--node-color);
		box-shadow:
			0 0 0 2px #ffffff,
			0 0 0 4px var(--node-color);
	}
</style>
