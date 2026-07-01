<script lang="ts">
	import BaseCanvas, { type CanvasClick } from '$lib/components/BaseCanvas.svelte';
	import {
		diffColors,
		getNetLabelDiff,
		getSchematicComponentDiff,
		getWireDiff,
		type DiffStatus
	} from '$lib/diff/altiumDiff';
	import { projectStore } from '$lib/state/projectStore.svelte';
	import { buildPowerGraph } from '$lib/domain/powerGraph';
	import type {
		AltiumSchAnnotation,
		AltiumSchComponent,
		AltiumSchMarker,
		AltiumSchNetLabel,
		AltiumSchSheet,
		AltiumSchWire,
		AltiumSchematicDoc
	} from '$lib/types/altium';

	type Bounds = {
		minX: number;
		minY: number;
		maxX: number;
		maxY: number;
	};

	const schematicA = $derived(projectStore.projectA.schematic);
	const schematicB = $derived(
		projectStore.mode === 'view' ? projectStore.projectA.schematic : projectStore.projectB.schematic
	);
	let selectedSheetIndex = $state(0);
	let selectedChannel = $state('');
	const sheetOptions = $derived.by(() => {
		const maxLength = Math.max(schematicA?.sheets.length ?? 0, schematicB?.sheets.length ?? 0);
		return Array.from({ length: maxLength }, (_, index) => {
			const sheetA = schematicA?.sheets[index];
			const sheetB = schematicB?.sheets[index];
			return {
				index,
				label: sheetA?.name || sheetA?.fileName || sheetB?.name || sheetB?.fileName || `Sheet ${index + 1}`
			};
		});
	});
	const selectedA = $derived(sliceSchematic(schematicA, selectedSheetIndex));
	const selectedB = $derived(sliceSchematic(schematicB, selectedSheetIndex));
	const componentDiff = $derived(getSchematicComponentDiff(selectedA, selectedB));
	const wireDiff = $derived(getWireDiff(selectedA, selectedB));
	const netLabelDiff = $derived(getNetLabelDiff(selectedA, selectedB));
	const visibleComponentDiff = $derived(componentDiff.filter((item) => item.status !== 'unchanged'));
	const visibleWireDiff = $derived(wireDiff.filter((item) => item.status !== 'unchanged'));
	const visibleNetLabelDiff = $derived(netLabelDiff.filter((item) => item.status !== 'unchanged'));
	const selectedSheet = $derived(selectedB?.sheets[0] ?? selectedA?.sheets[0]);
	const powerGraph = $derived(
		buildPowerGraph(projectStore.mode === 'view' ? projectStore.indexA : projectStore.indexB)
	);
	const channelOptions = $derived.by(() => {
		const target = selectedSheet;
		if (!target) return [];
		const targetNames = [target.fileName, target.name, target.path]
			.filter(Boolean)
			.map((value) => (value as string).replace(/^.*[\\/]/, '').replace(/\.SchDoc$/i, '').toUpperCase());
		const result: string[] = [];
		for (const sheet of (schematicB ?? schematicA)?.sheets ?? []) {
			for (const symbol of sheet.sheetSymbols ?? []) {
				const child = (symbol.fileName ?? '').replace(/^.*[\\/]/, '').replace(/\.SchDoc$/i, '').toUpperCase();
				if (!child || !targetNames.includes(child)) continue;
				const name = symbol.name?.trim() ?? '';
				const repeat = name.match(/^Repeat\(\s*([^,]+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
				if (repeat) {
					for (let index = Number(repeat[2]); index <= Number(repeat[3]); index += 1) {
						result.push(`${repeat[1]}${index}`);
					}
				} else if (name) {
					result.push(name);
				}
			}
		}
		return Array.from(new Set(result));
	});
	let showPinNames = $state(true);
	let showValues = $state(false);
	let showSheetEntryNames = $state(false);
	let showAnnotations = $state(true);

	$effect(() => {
		if (selectedSheetIndex >= sheetOptions.length) selectedSheetIndex = Math.max(0, sheetOptions.length - 1);
	});

	$effect(() => {
		if (channelOptions.length === 0) selectedChannel = '';
		else if (!channelOptions.includes(selectedChannel)) selectedChannel = channelOptions[0];
	});

	$effect(() => {
		const selected = projectStore.selectedDesignator;
		if (!selected) return;
		const channelMatch = selected.match(/_([A-Za-z]+\d+)$/);
		const designator = selected.replace(/_[A-Za-z]+\d+$/, '').toLowerCase();
		const index = (schematicB ?? schematicA)?.sheets.findIndex((sheet) =>
			sheet.components.some((component) => component.designator.toLowerCase() === designator)
		);
		if (index !== undefined && index >= 0) {
			selectedSheetIndex = index;
			if (channelMatch) selectedChannel = channelMatch[1];
		}
	});

	function instanceDesignator(designator: string) {
		return selectedChannel ? `${designator}_${selectedChannel}` : designator;
	}

	function instanceNetName(name: string, channel = selectedChannel) {
		if (!channel) return name;
		const index = projectStore.mode === 'view' ? projectStore.indexA : projectStore.indexB;
		const candidates = [name, `${name}_${channel}`, `${channel}_${name}`];
		return (
			candidates.find((candidate) => index.byNet.has(candidate.toUpperCase())) ??
			index.nets.find(
				(net) =>
					net.toUpperCase().includes(name.toUpperCase()) &&
					net.toUpperCase().includes(channel.toUpperCase())
			) ??
			name
		);
	}

	function sliceSchematic(doc: AltiumSchematicDoc | null, index: number): AltiumSchematicDoc | null {
		const sheet = doc?.sheets[index];
		if (!doc || !sheet) return null;
		return { ...doc, sheets: [sheet] };
	}

	function include(bounds: Bounds, x: number, y: number) {
		bounds.minX = Math.min(bounds.minX, x);
		bounds.minY = Math.min(bounds.minY, y);
		bounds.maxX = Math.max(bounds.maxX, x);
		bounds.maxY = Math.max(bounds.maxY, y);
	}

	function getSheets(doc: AltiumSchematicDoc | null): AltiumSchSheet[] {
		return doc?.sheets ?? [];
	}

	function getBounds(...docs: Array<AltiumSchematicDoc | null>): Bounds {
		const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

		for (const doc of docs) {
			for (const sheet of getSheets(doc)) {
				for (const wire of sheet.wires) {
					const points = wire.points ?? (wire.start && wire.end ? [wire.start, wire.end] : []);
					points.forEach((point) => include(bounds, point.x, point.y));
				}
				for (const label of sheet.netLabels) include(bounds, label.x, label.y);
				for (const annotation of sheet.annotations ?? []) {
					include(bounds, annotation.x, annotation.y);
					if (annotation.bounds) {
						include(bounds, annotation.bounds.x1, annotation.bounds.y1);
						include(bounds, annotation.bounds.x2, annotation.bounds.y2);
					}
				}
				for (const marker of [
					...(sheet.ports ?? []),
					...(sheet.powerPorts ?? []),
					...(sheet.offSheetConnectors ?? []),
					...(sheet.sheetSymbols ?? []),
					...(sheet.sheetEntries ?? []),
					...(sheet.junctions ?? []),
					...(sheet.noERC ?? []),
					...(sheet.directives ?? []),
					...(sheet.busEntries ?? [])
				]) include(bounds, marker.x, marker.y);
				for (const bus of sheet.buses ?? []) bus.points.forEach((point) => include(bounds, point.x, point.y));
				for (const component of sheet.components) {
					include(bounds, component.x, component.y);
					if (component.bounds) {
						include(bounds, component.bounds.x1, component.bounds.y1);
						include(bounds, component.bounds.x2, component.bounds.y2);
					}
					component.textRender?.forEach((text) => include(bounds, text.x, text.y));
					component.pins?.forEach((pin) => include(bounds, pin.x, pin.y));
				}
			}
		}

		if (!Number.isFinite(bounds.minX)) return { minX: -100, minY: -100, maxX: 100, maxY: 100 };
		const paddingX = Math.max((bounds.maxX - bounds.minX) * 0.04, 3000000);
		const paddingY = Math.max((bounds.maxY - bounds.minY) * 0.04, 3000000);
		return {
			minX: bounds.minX - paddingX,
			minY: bounds.minY - paddingY,
			maxX: bounds.maxX + paddingX,
			maxY: bounds.maxY + paddingY
		};
	}

	function drawReadableText(
		ctx: CanvasRenderingContext2D,
		text: string,
		x: number,
		y: number,
		worldPerPx: number,
		size = 11,
		align: CanvasTextAlign = 'left',
		orientation = 0
	) {
		ctx.save();
		ctx.translate(x, y);
		// Schematic coordinates can be tens of millions of internal Altium units.
		// Scaling the font size into world units creates million-pixel fonts that
		// Chromium clamps. Scale the local text coordinate system instead so the
		// actual CSS font remains a normal screen-space size.
		ctx.scale(worldPerPx, -worldPerPx);
		ctx.rotate((-orientation * Math.PI) / 2);
		ctx.textAlign = align;
		ctx.textBaseline = 'middle';
		ctx.font = `${size}px Inter, system-ui, sans-serif`;
		ctx.fillText(text, 0, 0);
		ctx.restore();
	}

	function getComponentBody(component: AltiumSchComponent, worldPerPx: number) {
		const pins = semanticPins(component);
		const pinsWithLength = pins.filter((pin) => (pin.length ?? 0) > 0);
		if (pinsWithLength.length >= 2) {
			const inner = pinsWithLength.map((pin) => pinInnerPoint(pin));
			const xs = inner.map((point) => point.x);
			const ys = inner.map((point) => point.y);
			const pad = 0;
			return {
				left: Math.min(...xs) - pad,
				right: Math.max(...xs) + pad,
				top: Math.min(...ys) - pad,
				bottom: Math.max(...ys) + pad
			};
		}
		if (component.bounds) {
			return {
				left: Math.min(component.bounds.x1, component.bounds.x2),
				right: Math.max(component.bounds.x1, component.bounds.x2),
				top: Math.min(component.bounds.y1, component.bounds.y2),
				bottom: Math.max(component.bounds.y1, component.bounds.y2)
			};
		}
		if (pins.length === 0) {
			const width = 86 * worldPerPx;
			const height = 42 * worldPerPx;
			return {
				left: component.x - width / 2,
				right: component.x + width / 2,
				top: component.y - height / 2,
				bottom: component.y + height / 2
			};
		}

		const xs = pins.map((pin) => pin.x);
		const ys = pins.map((pin) => pin.y);
		const pad = 18 * worldPerPx;
		const minWidth = 90 * worldPerPx;
		const minHeight = 46 * worldPerPx;
		const pinLeft = Math.min(...xs);
		const pinRight = Math.max(...xs);
		const pinTop = Math.min(...ys);
		const pinBottom = Math.max(...ys);
		const centerX = (pinLeft + pinRight + component.x) / 3;
		const centerY = (pinTop + pinBottom + component.y) / 3;
		const width = Math.max(pinRight - pinLeft + pad * 2, minWidth);
		const height = Math.max(pinBottom - pinTop + pad * 2, minHeight);

		return {
			left: centerX - width / 2,
			right: centerX + width / 2,
			top: centerY - height / 2,
			bottom: centerY + height / 2
		};
	}

	function clamp(value: number, min: number, max: number) {
		return Math.max(min, Math.min(max, value));
	}

	function pinInnerPoint(pin: AltiumSchComponent['pins'][number]) {
		const length = pin.length ?? 0;
		switch (pin.orientation) {
			case 1:
				return { x: pin.x, y: pin.y - length };
			case 2:
				return { x: pin.x + length, y: pin.y };
			case 3:
				return { x: pin.x, y: pin.y + length };
			default:
				return { x: pin.x - length, y: pin.y };
		}
	}

	function semanticPins(component: AltiumSchComponent) {
		const allPins = component.pins ?? [];
		const modePins =
			component.displayMode === undefined
				? allPins
				: allPins.filter(
						(pin) =>
							pin.ownerPartDisplayMode === undefined ||
							pin.ownerPartDisplayMode === component.displayMode
					);
		const candidates = modePins.length > 0 ? modePins : allPins;
		const groups = new Map<string, AltiumSchComponent['pins']>();
		for (const pin of candidates) {
			const key = pin.num.trim().toUpperCase() || pin.name.trim().toUpperCase() || pin.id || '';
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key)?.push(pin);
		}

		const grouped = Array.from(groups.values());
		if (grouped.length === 2 && grouped.some((group) => group.length > 1)) {
			let best: AltiumSchComponent['pins'] | null = null;
			let bestScore = Infinity;
			for (const first of grouped[0]) {
				for (const second of grouped[1]) {
					const centerX = (first.x + second.x) / 2;
					const centerY = (first.y + second.y) / 2;
					const centerDistance = Math.hypot(centerX - component.x, centerY - component.y);
					const axisPenalty =
						component.orientation === 1 || component.orientation === 3
							? Math.abs(first.x - second.x)
							: Math.abs(first.y - second.y);
					const score = centerDistance + axisPenalty * 2;
					if (score < bestScore) {
						best = [first, second];
						bestScore = score;
					}
				}
			}
			if (best) return best;
		}

		const byNumber = new Map<string, AltiumSchComponent['pins'][number]>();
		for (const pin of candidates) {
			const key = pin.num.trim().toUpperCase() || pin.name.trim().toUpperCase() || pin.id || '';
			const current = byNumber.get(key);
			const distance = Math.hypot(pin.x - component.x, pin.y - component.y);
			const currentDistance = current
				? Math.hypot(current.x - component.x, current.y - component.y)
				: Infinity;
			if (!current || distance < currentDistance) byNumber.set(key, pin);
		}
		return Array.from(byNumber.values());
	}

	function componentFamily(component: AltiumSchComponent) {
		const prefix = component.designator.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? '';
		if (prefix === 'R' || prefix === 'RN') return 'resistor';
		if (prefix === 'C') return 'capacitor';
		if (prefix === 'L') return 'inductor';
		if (prefix === 'D' || prefix === 'LED') return 'diode';
		if (prefix === 'TP') return 'testpoint';
		return 'generic';
	}

	function componentDisplayValue(component: AltiumSchComponent) {
		const family = componentFamily(component);
		if (component.value || component.parameters?.Value) return component.value || component.parameters?.Value || '';
		if (family === 'resistor') return component.parameters?.Resistance || component.comment;
		if (family === 'capacitor') return component.parameters?.Capacitance || component.comment;
		if (family === 'inductor') return component.parameters?.Inductance || component.comment;
		return component.comment || component.libRef;
	}

	function drawAuthoredComponentText(
		ctx: CanvasRenderingContext2D,
		component: AltiumSchComponent,
		designator: string,
		fallbackX: number,
		fallbackY: number,
		worldPerPx: number,
		color: string
	) {
		const designatorText = component.textRender?.find((text) => text.role === 'designator');
		ctx.fillStyle = color;
		drawReadableText(
			ctx,
			designator,
			designatorText?.x ?? fallbackX,
			designatorText?.y ?? fallbackY,
			worldPerPx,
			9,
			'left',
			designatorText?.orientation ?? 0
		);
		if (!showValues) return;
		const value = componentDisplayValue(component);
		if (!value) return;
		const commentText = component.textRender?.find((text) => text.role === 'comment');
		ctx.fillStyle = '#64748b';
		drawReadableText(
			ctx,
			value,
			commentText?.x ?? fallbackX,
			commentText?.y ?? (fallbackY - 12 * worldPerPx),
			worldPerPx,
			8,
			'left',
			commentText?.orientation ?? 0
		);
	}

	function drawCompactComponent(
		ctx: CanvasRenderingContext2D,
		component: AltiumSchComponent,
		color: string,
		worldPerPx: number,
		isSelected: boolean
	) {
		const family = componentFamily(component);
		const pins = semanticPins(component);
		if (family === 'testpoint' && pins.length === 1) {
			ctx.save();
			ctx.strokeStyle = isSelected ? '#2563eb' : '#334155';
			ctx.fillStyle = isSelected ? '#dbeafe' : '#ffffff';
			ctx.lineWidth = (isSelected ? 2.4 : 1.5) * worldPerPx;
			ctx.beginPath();
			ctx.arc(pins[0].x, pins[0].y, 5 * worldPerPx, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
			drawAuthoredComponentText(
				ctx,
				component,
				component.designator,
				pins[0].x + 8 * worldPerPx,
				pins[0].y,
				worldPerPx,
				'#0f172a'
			);
			ctx.restore();
			return true;
		}
		if (!['resistor', 'capacitor', 'inductor', 'diode'].includes(family) || pins.length !== 2) return false;

		const [first, second] = pins;
		const dx = second.x - first.x;
		const dy = second.y - first.y;
		const distance = Math.max(Math.hypot(dx, dy), worldPerPx);
		const ux = dx / distance;
		const uy = dy / distance;
		const centerX = (first.x + second.x) / 2;
		const centerY = (first.y + second.y) / 2;
		const bodyHalf = Math.min(distance * 0.28, 10 * worldPerPx);
		const startX = centerX - ux * bodyHalf;
		const startY = centerY - uy * bodyHalf;
		const endX = centerX + ux * bodyHalf;
		const endY = centerY + uy * bodyHalf;

		ctx.save();
		ctx.strokeStyle = isSelected ? '#2563eb' : '#334155';
		ctx.fillStyle = isSelected ? '#dbeafe' : '#ffffff';
		ctx.lineWidth = (isSelected ? 2.4 : 1.4) * worldPerPx;
		ctx.beginPath();
		ctx.moveTo(first.x, first.y);
		ctx.lineTo(startX, startY);
		ctx.moveTo(endX, endY);
		ctx.lineTo(second.x, second.y);
		ctx.stroke();

		ctx.translate(centerX, centerY);
		ctx.rotate(Math.atan2(dy, dx));
		if (family === 'capacitor') {
			ctx.lineWidth = 2 * worldPerPx;
			ctx.beginPath();
			ctx.moveTo(-3.5 * worldPerPx, -8 * worldPerPx);
			ctx.lineTo(-3.5 * worldPerPx, 8 * worldPerPx);
			ctx.moveTo(3.5 * worldPerPx, -8 * worldPerPx);
			ctx.lineTo(3.5 * worldPerPx, 8 * worldPerPx);
			ctx.stroke();
		} else if (family === 'diode') {
			ctx.beginPath();
			ctx.moveTo(-7 * worldPerPx, -6 * worldPerPx);
			ctx.lineTo(4 * worldPerPx, 0);
			ctx.lineTo(-7 * worldPerPx, 6 * worldPerPx);
			ctx.closePath();
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(5 * worldPerPx, -7 * worldPerPx);
			ctx.lineTo(5 * worldPerPx, 7 * worldPerPx);
			ctx.stroke();
		} else if (family === 'inductor') {
			for (let index = -2; index <= 1; index += 1) {
				ctx.beginPath();
				ctx.arc((index * 4 + 2) * worldPerPx, 0, 2 * worldPerPx, Math.PI, 0);
				ctx.stroke();
			}
		} else {
			ctx.fillRect(-bodyHalf, -5 * worldPerPx, bodyHalf * 2, 10 * worldPerPx);
			ctx.strokeRect(-bodyHalf, -5 * worldPerPx, bodyHalf * 2, 10 * worldPerPx);
		}
		ctx.restore();

		drawAuthoredComponentText(
			ctx,
			component,
			component.designator,
			centerX,
			centerY + 12 * worldPerPx,
			worldPerPx,
			color
		);
		return true;
	}

	function drawComponent(
		ctx: CanvasRenderingContext2D,
		component: AltiumSchComponent,
		status: DiffStatus,
		selected: string | null,
		worldPerPx: number
	) {
		const renderedDesignator = instanceDesignator(component.designator);
		const isSelected =
			selected?.toLowerCase() === renderedDesignator.toLowerCase() ||
			(!selectedChannel && selected?.toLowerCase() === component.designator.toLowerCase());
		const body = getComponentBody(component, worldPerPx);
		const width = body.right - body.left;
		const height = body.bottom - body.top;
		const indexedComponent = (
			projectStore.mode === 'view' ? projectStore.indexA : projectStore.indexB
		).byDesignator.get(renderedDesignator.toUpperCase()) ??
			(projectStore.mode === 'view' ? projectStore.indexA : projectStore.indexB).byDesignator.get(
				component.designator.toUpperCase()
			);
		if (
			drawCompactComponent(
				ctx,
				{ ...component, designator: renderedDesignator },
				status === 'unchanged' ? '#0f172a' : diffColors[status],
				worldPerPx,
				isSelected
			)
		)
			return;

		ctx.save();
		ctx.strokeStyle = isSelected ? '#2563eb' : status === 'unchanged' ? '#64748b' : diffColors[status];
		ctx.fillStyle = isSelected ? 'rgba(219,234,254,0.9)' : 'rgba(255,255,255,0.94)';
		ctx.lineWidth = (isSelected ? 2.6 : 1.6) * worldPerPx;
		ctx.fillRect(body.left, body.top, width, height);
		ctx.strokeRect(body.left, body.top, width, height);

		drawAuthoredComponentText(
			ctx,
			component,
			renderedDesignator,
			body.left,
			body.bottom + 10 * worldPerPx,
			worldPerPx,
			isSelected ? '#1d4ed8' : '#0f172a'
		);

		for (const pin of semanticPins(component)) {
			const pinNet = indexedComponent?.pinConnections.find(
				(connection) => connection.pinNumber.trim().toUpperCase() === pin.num.trim().toUpperCase()
			)?.net;
			const isSelectedNet =
				!!pinNet && pinNet.toUpperCase() === projectStore.selectedNet?.toUpperCase();
			const innerPoint = (pin.length ?? 0) > 0
				? pinInnerPoint(pin)
				: { x: clamp(pin.x, body.left, body.right), y: clamp(pin.y, body.top, body.bottom) };
			ctx.strokeStyle = isSelectedNet ? '#0891b2' : status === 'unchanged' ? '#64748b' : diffColors[status];
			ctx.fillStyle = isSelectedNet ? '#0891b2' : status === 'unchanged' ? '#64748b' : diffColors[status];
			ctx.lineWidth = (isSelectedNet ? 2.4 : 1.1) * worldPerPx;
			ctx.beginPath();
			ctx.moveTo(pin.x, pin.y);
			ctx.lineTo(innerPoint.x, innerPoint.y);
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(pin.x, pin.y, 2.2 * worldPerPx, 0, Math.PI * 2);
			ctx.fill();
			if (showPinNames) {
				const pinText = [
					pin.showDesignator !== false ? pin.num : '',
					pin.showName !== false ? pin.name : '',
					isSelectedNet ? pinNet : ''
				]
					.filter(Boolean)
					.join(' ');
				if (!pinText) continue;
				let labelX = pin.x;
				let labelY = pin.y;
				let align: CanvasTextAlign = 'left';
				if (pin.orientation === 2) {
					labelX -= 5 * worldPerPx;
					labelY += 7 * worldPerPx;
					align = 'right';
				} else if (pin.orientation === 0) {
					labelX += 5 * worldPerPx;
					labelY += 7 * worldPerPx;
				} else if (pin.orientation === 1) {
					labelX += 5 * worldPerPx;
					labelY += 6 * worldPerPx;
				} else {
					labelX += 5 * worldPerPx;
					labelY -= 7 * worldPerPx;
				}
				drawReadableText(ctx, pinText, labelX, labelY, worldPerPx, 7, align);
			}
		}
		ctx.restore();
	}

	function drawMarker(ctx: CanvasRenderingContext2D, marker: AltiumSchMarker, kind: string, worldPerPx: number) {
		const markerName = marker.text || marker.name || '';
		const isSelectedNet =
			!!markerName &&
			instanceNetName(markerName).toUpperCase() === projectStore.selectedNet?.toUpperCase();
		const color = isSelectedNet
			? '#0891b2'
			: kind === 'power'
				? '#9333ea'
				: kind === 'port'
					? '#2563eb'
					: kind === 'warning'
						? '#ea580c'
						: '#64748b';
		ctx.save();
		ctx.strokeStyle = color;
		ctx.fillStyle = color;
		ctx.lineWidth = 1.2 * worldPerPx;
		if (kind === 'junction') {
			ctx.beginPath();
			ctx.arc(marker.x, marker.y, 2.4 * worldPerPx, 0, Math.PI * 2);
			ctx.fill();
		} else if (kind === 'port') {
			const width = Math.max(42, markerName.length * 7 + 18) * worldPerPx;
			const height = 12 * worldPerPx;
			ctx.fillStyle = '#fef3c7';
			ctx.beginPath();
			ctx.moveTo(marker.x, marker.y);
			ctx.lineTo(marker.x + 7 * worldPerPx, marker.y - height / 2);
			ctx.lineTo(marker.x + width, marker.y - height / 2);
			ctx.lineTo(marker.x + width, marker.y + height / 2);
			ctx.lineTo(marker.x + 7 * worldPerPx, marker.y + height / 2);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
		} else if (kind === 'power') {
			const isGround = (marker.text || marker.name || '').toUpperCase().includes('GND');
			ctx.beginPath();
			ctx.moveTo(marker.x, marker.y);
			if (isGround) {
				ctx.lineTo(marker.x, marker.y - 8 * worldPerPx);
				ctx.moveTo(marker.x - 7 * worldPerPx, marker.y - 8 * worldPerPx);
				ctx.lineTo(marker.x + 7 * worldPerPx, marker.y - 8 * worldPerPx);
				ctx.moveTo(marker.x - 4 * worldPerPx, marker.y - 11 * worldPerPx);
				ctx.lineTo(marker.x + 4 * worldPerPx, marker.y - 11 * worldPerPx);
			} else {
				ctx.lineTo(marker.x, marker.y + 10 * worldPerPx);
				ctx.moveTo(marker.x, marker.y + 10 * worldPerPx);
				ctx.lineTo(marker.x - 4 * worldPerPx, marker.y + 5 * worldPerPx);
				ctx.moveTo(marker.x, marker.y + 10 * worldPerPx);
				ctx.lineTo(marker.x + 4 * worldPerPx, marker.y + 5 * worldPerPx);
			}
			ctx.stroke();
		} else {
			ctx.strokeRect(marker.x - 4 * worldPerPx, marker.y - 4 * worldPerPx, 8 * worldPerPx, 8 * worldPerPx);
		}
		const text = marker.text || marker.name;
		if (text) {
			ctx.fillStyle = isSelectedNet ? '#0e7490' : kind === 'port' ? '#92400e' : color;
			const textX = kind === 'port' ? marker.x + 12 * worldPerPx : marker.x + 7 * worldPerPx;
			const textY = kind === 'power' ? marker.y + 15 * worldPerPx : marker.y;
			drawReadableText(ctx, text, textX, textY, worldPerPx, 9);
		}
		ctx.restore();
	}

	function sheetSymbolBounds(symbol: AltiumSchMarker, worldPerPx: number) {
		const entries = (selectedSheet?.sheetEntries ?? []).filter(
			(entry) =>
				!!symbol.uniqueId && entry.ownerSheetSymbolUniqueId === symbol.uniqueId
		);
		const xs = [symbol.x, ...entries.map((entry) => entry.x)];
		const ys = [symbol.y, ...entries.map((entry) => entry.y)];
		const padding = 10 * worldPerPx;
		return {
			left: Math.min(...xs) - padding,
			right: Math.max(...xs) + padding,
			top: Math.min(...ys) - padding,
			bottom: Math.max(...ys) + padding,
			entries
		};
	}

	function drawSheetSymbol(
		ctx: CanvasRenderingContext2D,
		symbol: AltiumSchMarker,
		worldPerPx: number
	) {
		const bounds = sheetSymbolBounds(symbol, worldPerPx);
		ctx.save();
		ctx.fillStyle = 'rgba(239,246,255,0.94)';
		ctx.strokeStyle = '#2563eb';
		ctx.lineWidth = 1.5 * worldPerPx;
		ctx.fillRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
		ctx.strokeRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);

		ctx.fillStyle = '#1e3a8a';
		drawReadableText(
			ctx,
			symbol.name || 'Child sheet',
			bounds.left + 7 * worldPerPx,
			bounds.bottom - 12 * worldPerPx,
			worldPerPx,
			11
		);
		if (symbol.fileName) {
			ctx.fillStyle = '#64748b';
			drawReadableText(
				ctx,
				symbol.fileName,
				bounds.left + 7 * worldPerPx,
				bounds.bottom - 27 * worldPerPx,
				worldPerPx,
				8
			);
		}

		for (const entry of bounds.entries) {
			ctx.fillStyle = '#2563eb';
			ctx.beginPath();
			ctx.arc(entry.x, entry.y, 2.6 * worldPerPx, 0, Math.PI * 2);
			ctx.fill();
			const onLeft = Math.abs(entry.x - bounds.left) < Math.abs(entry.x - bounds.right);
			if (showSheetEntryNames) {
				drawReadableText(
					ctx,
					entry.name || '',
					entry.x + (onLeft ? 6 : -6) * worldPerPx,
					entry.y,
					worldPerPx,
					8,
					onLeft ? 'left' : 'right'
				);
			}
		}
		ctx.restore();
	}

	function drawWire(ctx: CanvasRenderingContext2D, wire: AltiumSchWire, status: DiffStatus, worldPerPx: number) {
		const points = wire.points ?? (wire.start && wire.end ? [wire.start, wire.end] : []);
		if (points.length < 2) return;

		const isSelectedNet =
			!!wire.net && wire.net.toUpperCase() === projectStore.selectedNet?.toUpperCase();
		ctx.strokeStyle = isSelectedNet ? '#0891b2' : status === 'unchanged' ? '#47705a' : diffColors[status];
		ctx.lineWidth = (isSelectedNet ? 2.8 : status === 'unchanged' ? 1.2 : 2.2) * worldPerPx;
		ctx.beginPath();
		ctx.moveTo(points[0].x, points[0].y);
		for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
		ctx.stroke();
	}

	function drawNetLabel(
		ctx: CanvasRenderingContext2D,
		label: AltiumSchNetLabel,
		status: DiffStatus,
		worldPerPx: number
	) {
		const isSelectedNet =
			instanceNetName(label.text).toUpperCase() === projectStore.selectedNet?.toUpperCase();
		ctx.fillStyle = isSelectedNet ? '#0891b2' : status === 'unchanged' ? '#166534' : diffColors[status];
		drawReadableText(ctx, label.text, label.x, label.y, worldPerPx, 12);
	}

	function drawAnnotation(
		ctx: CanvasRenderingContext2D,
		annotation: AltiumSchAnnotation,
		worldPerPx: number
	) {
		const text = annotation.displayText || annotation.text;
		if (!text) return;
		const lines = text.replace(/\r\n?/g, '\n').split('\n');
		const align: CanvasTextAlign =
			annotation.justification !== undefined && annotation.justification % 3 === 1
				? 'center'
				: annotation.justification !== undefined && annotation.justification % 3 === 2
					? 'right'
					: 'left';

		ctx.save();
		if (annotation.type === 'textFrame' && annotation.bounds) {
			const left = Math.min(annotation.bounds.x1, annotation.bounds.x2);
			const right = Math.max(annotation.bounds.x1, annotation.bounds.x2);
			const top = Math.min(annotation.bounds.y1, annotation.bounds.y2);
			const bottom = Math.max(annotation.bounds.y1, annotation.bounds.y2);
			ctx.fillStyle = 'rgba(255, 251, 235, 0.88)';
			ctx.fillRect(left, top, right - left, bottom - top);
			if (annotation.showBorder !== false) {
				ctx.strokeStyle = '#d97706';
				ctx.lineWidth = worldPerPx;
				ctx.strokeRect(left, top, right - left, bottom - top);
			}
			ctx.fillStyle = '#713f12';
			lines.forEach((line, index) =>
				drawReadableText(
					ctx,
					line,
					left + 7 * worldPerPx,
					bottom - (10 + index * 13) * worldPerPx,
					worldPerPx,
					9
				)
			);
		} else {
			ctx.fillStyle = '#334155';
			lines.forEach((line, index) =>
				drawReadableText(
					ctx,
					line,
					annotation.x,
					annotation.y - index * 13 * worldPerPx,
					worldPerPx,
					10,
					align,
					annotation.orientation ?? 0
				)
			);
		}
		ctx.restore();
	}

	function drawDiff(ctx: CanvasRenderingContext2D, selected: string | null, worldPerPx: number) {
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';

		for (const { item, status } of wireDiff) {
			drawWire(ctx, item, status, worldPerPx);
		}

		for (const bus of selectedSheet?.buses ?? []) {
			drawWire(ctx, { points: bus.points }, 'unchanged', worldPerPx);
		}

		for (const { item, status } of netLabelDiff) {
			drawNetLabel(ctx, item, status, worldPerPx);
		}

		if (showAnnotations) {
			for (const annotation of selectedSheet?.annotations ?? []) {
				drawAnnotation(ctx, annotation, worldPerPx);
			}
		}

		for (const diff of componentDiff) {
			const component = diff.after ?? diff.before;
			if (!component) continue;
			drawComponent(ctx, component, diff.status, selected, worldPerPx);
		}

		for (const marker of selectedSheet?.ports ?? []) drawMarker(ctx, marker, 'port', worldPerPx);
		for (const marker of selectedSheet?.powerPorts ?? []) drawMarker(ctx, marker, 'power', worldPerPx);
		for (const marker of selectedSheet?.offSheetConnectors ?? []) drawMarker(ctx, marker, 'port', worldPerPx);
		for (const marker of selectedSheet?.sheetSymbols ?? []) drawSheetSymbol(ctx, marker, worldPerPx);
		for (const marker of (selectedSheet?.sheetEntries ?? []).filter((entry) => !entry.ownerSheetSymbolUniqueId)) {
			drawMarker(ctx, marker, 'sheet', worldPerPx);
		}
		for (const marker of selectedSheet?.junctions ?? []) drawMarker(ctx, marker, 'junction', worldPerPx);
		for (const marker of selectedSheet?.noERC ?? []) drawMarker(ctx, marker, 'warning', worldPerPx);
		for (const marker of selectedSheet?.directives ?? []) drawMarker(ctx, marker, 'warning', worldPerPx);
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
		const bounds = getBounds(selectedA, selectedB);
		const dataWidth = Math.max(bounds.maxX - bounds.minX, 1);
		const dataHeight = Math.max(bounds.maxY - bounds.minY, 1);
		const fit = Math.max(0.000001, Math.min((width - 96) / dataWidth, (height - 96) / dataHeight));
		const worldPerPx = 1 / fit;

		ctx.save();
		ctx.strokeStyle = '#eef2f7';
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (let x = 0.5; x < width; x += 24) {
			ctx.moveTo(x, 0);
			ctx.lineTo(x, height);
		}
		for (let y = 0.5; y < height; y += 24) {
			ctx.moveTo(0, y);
			ctx.lineTo(width, y);
		}
		ctx.stroke();
		ctx.restore();

		ctx.save();
		ctx.translate(width / 2, height / 2);
		ctx.scale(fit, -fit);
		ctx.translate(-(bounds.minX + bounds.maxX) / 2, -(bounds.minY + bounds.maxY) / 2);

		drawDiff(ctx, projectStore.selectedDesignator, worldPerPx);
		ctx.restore();
	}

	function canvasToWorld(event: CanvasClick) {
		const bounds = getBounds(selectedA, selectedB);
		const fit = Math.max(
			0.000001,
			Math.min(
				(event.width - 96) / Math.max(bounds.maxX - bounds.minX, 1),
				(event.height - 96) / Math.max(bounds.maxY - bounds.minY, 1)
			)
		);
		const localX = (event.x - event.panX) / event.zoom;
		const localY = (event.y - event.panY) / event.zoom;
		return {
			x: (bounds.minX + bounds.maxX) / 2 + (localX - event.width / 2) / fit,
			y: (bounds.minY + bounds.maxY) / 2 - (localY - event.height / 2) / fit,
			worldPerPx: 1 / fit,
			tolerance: 7 / Math.max(fit * event.zoom, 0.001)
		};
	}

	function componentAt(x: number, y: number, worldPerPx: number, tolerance: number) {
		return [...(selectedSheet?.components ?? [])].reverse().find((component) => {
			const body = getComponentBody(component, worldPerPx);
			return (
				x >= body.left - tolerance &&
				x <= body.right + tolerance &&
				y >= body.top - tolerance &&
				y <= body.bottom + tolerance
			);
		});
	}

	function connectionMarkerAt(x: number, y: number, tolerance: number) {
		const markers = [
			...(selectedSheet?.ports ?? []),
			...(selectedSheet?.powerPorts ?? []),
			...(selectedSheet?.offSheetConnectors ?? []),
			...(selectedSheet?.sheetEntries ?? [])
		];
		return markers.find((marker) => {
			const name = marker.text || marker.name || '';
			const isOwnedSheetEntry = !!marker.ownerSheetSymbolUniqueId;
			const width = (isOwnedSheetEntry ? 3 : Math.max(18, name.length * 7 + 18)) * tolerance;
			return (
				x >= marker.x - tolerance * 2 &&
				x <= marker.x + width &&
				Math.abs(y - marker.y) <= tolerance * 2.5
			);
		});
	}

	function sheetSymbolAt(x: number, y: number, worldPerPx: number) {
		return (selectedSheet?.sheetSymbols ?? []).find((symbol) => {
			const bounds = sheetSymbolBounds(symbol, worldPerPx);
			return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
		});
	}

	function annotationAt(x: number, y: number, tolerance: number) {
		return (selectedSheet?.annotations ?? []).find((annotation) => {
			if (annotation.bounds) {
				const left = Math.min(annotation.bounds.x1, annotation.bounds.x2);
				const right = Math.max(annotation.bounds.x1, annotation.bounds.x2);
				const top = Math.min(annotation.bounds.y1, annotation.bounds.y2);
				const bottom = Math.max(annotation.bounds.y1, annotation.bounds.y2);
				return x >= left && x <= right && y >= top && y <= bottom;
			}
			return Math.hypot(x - annotation.x, y - annotation.y) <= tolerance * 3;
		});
	}

	function resolveSchematicTooltip(event: CanvasClick) {
		const { x, y, worldPerPx, tolerance } = canvasToWorld(event);
		const component = componentAt(x, y, worldPerPx, tolerance);
		if (component) {
			const renderedDesignator = instanceDesignator(component.designator);
			const nets = (projectStore.mode === 'view' ? projectStore.indexA : projectStore.indexB).byDesignator.get(
				renderedDesignator.toUpperCase()
			)?.nets;
			return [renderedDesignator, component.value || component.comment || component.libRef, nets?.join(', ')]
				.filter(Boolean)
				.join(' - ');
		}
		const label = (selectedSheet?.netLabels ?? []).find(
			(candidate) => Math.hypot(x - candidate.x, y - candidate.y) <= tolerance * 2
		);
		if (label) return `Net ${label.text}`;
		if (showAnnotations) {
			const annotation = annotationAt(x, y, tolerance);
			if (annotation) return `Annotation: ${annotation.displayText || annotation.text}`;
		}
		const marker = connectionMarkerAt(x, y, tolerance);
		const markerName = marker?.text || marker?.name;
		if (markerName) return `Connection ${markerName} - click to highlight`;
		const sheetSymbol = sheetSymbolAt(x, y, worldPerPx);
		return sheetSymbol
			? `${sheetSymbol.name || 'Child sheet'} - ${sheetSymbol.fileName || 'unknown file'} - click to open`
			: null;
	}

	function onSchematicClick(event: CanvasClick) {
		const { x, y, worldPerPx, tolerance } = canvasToWorld(event);
		const component = componentAt(x, y, worldPerPx, tolerance);
		if (component) {
			projectStore.selectDesignator(instanceDesignator(component.designator));
			return;
		}
		const label = (selectedSheet?.netLabels ?? []).find(
			(candidate) => Math.hypot(x - candidate.x, y - candidate.y) <= tolerance * 2
		);
		if (label) {
			projectStore.selectNet(instanceNetName(label.text));
			return;
		}
		const marker = connectionMarkerAt(x, y, tolerance);
		const markerName = marker?.text || marker?.name;
		if (markerName) {
			const ownerChannel = marker?.ownerSheetSymbolUniqueId
				? selectedSheet?.sheetSymbols?.find(
						(symbol) => symbol.uniqueId === marker.ownerSheetSymbolUniqueId
					)?.name
				: undefined;
			projectStore.selectNet(instanceNetName(markerName, ownerChannel || selectedChannel));
			return;
		}
		const sheetSymbol = sheetSymbolAt(x, y, worldPerPx);
		if (sheetSymbol?.fileName) {
			const childName = sheetSymbol.fileName.replace(/^.*[\\/]/, '').replace(/\.SchDoc$/i, '').toUpperCase();
			const childIndex = (schematicB ?? schematicA)?.sheets.findIndex((sheet) =>
				[sheet.name, sheet.fileName, sheet.path]
					.filter(Boolean)
					.some(
						(value) =>
							(value as string).replace(/^.*[\\/]/, '').replace(/\.SchDoc$/i, '').toUpperCase() ===
							childName
					)
			);
			if (childIndex !== undefined && childIndex >= 0) {
				selectedSheetIndex = childIndex;
				selectedChannel = sheetSymbol.name ?? '';
			}
			return;
		}
		projectStore.selectDesignator(null);
	}

	function resolveSelectionFocus(width: number, height: number) {
		const designator = projectStore.selectedDesignator?.replace(/_[A-Za-z]+\d+$/, '').toUpperCase();
		if (!designator) return null;
		const component = selectedSheet?.components.find(
			(candidate) => candidate.designator.toUpperCase() === designator
		);
		if (!component) return null;
		const bounds = getBounds(selectedA, selectedB);
		const fit = Math.max(
			0.000001,
			Math.min(
				(width - 96) / Math.max(bounds.maxX - bounds.minX, 1),
				(height - 96) / Math.max(bounds.maxY - bounds.minY, 1)
			)
		);
		return {
			x: width / 2 + (component.x - (bounds.minX + bounds.maxX) / 2) * fit,
			y: height / 2 - (component.y - (bounds.minY + bounds.maxY) / 2) * fit,
			zoom: 3
		};
	}

	const focusKey = $derived(
		projectStore.selectedDesignator
			? `sch:${selectedSheetIndex}:${selectedChannel}:${projectStore.selectedDesignator}`
			: null
	);
</script>

<div class="schematic-view">
	<aside class="diff-panel">
		<div class="page-control">
			<label>
				Page
				<select bind:value={selectedSheetIndex}>
					{#each sheetOptions as sheet}
						<option value={sheet.index}>{sheet.label}</option>
					{/each}
				</select>
			</label>
			{#if channelOptions.length > 0}
				<label>
					Channel instance
					<select bind:value={selectedChannel}>
						{#each channelOptions as channel}
							<option value={channel}>{channel}</option>
						{/each}
					</select>
				</label>
			{/if}
		</div>
		{#if projectStore.mode === 'compare'}
		<div class="legend">
			<span><i class="added"></i>Added</span>
			<span><i class="removed"></i>Removed</span>
			<span><i class="modified"></i>Modified</span>
		</div>
		{/if}
		<div class="sheet-stats">
			{#if projectStore.mode === 'view'}
			<span>{selectedA?.sheets[0]?.components.length ?? 0} components</span>
			<span>{selectedA?.sheets[0]?.wires.length ?? 0} wires</span>
			<span>{(selectedA?.sheets[0]?.ports?.length ?? 0) + (selectedA?.sheets[0]?.powerPorts?.length ?? 0)} ports</span>
			<span>{selectedA?.sheets[0]?.buses?.length ?? 0} buses · {selectedA?.sheets[0]?.noERC?.length ?? 0} No ERC</span>
			{:else}
			<span>A: {selectedA?.sheets[0]?.components.length ?? 0} comp, {selectedA?.sheets[0]?.wires.length ?? 0} wires</span>
			<span>B: {selectedB?.sheets[0]?.components.length ?? 0} comp, {selectedB?.sheets[0]?.wires.length ?? 0} wires</span>
			{/if}
		</div>
		<div class="display-options">
			<label><input type="checkbox" bind:checked={showValues} /> Values</label>
			<label><input type="checkbox" bind:checked={showPinNames} /> Pin names & numbers</label>
			<label><input type="checkbox" bind:checked={showSheetEntryNames} /> Sheet entry names</label>
			<label><input type="checkbox" bind:checked={showAnnotations} /> Annotations</label>
		</div>
		<details class="power-tree">
			<summary>Power tree ({powerGraph.rails.length} rails)</summary>
			{#if powerGraph.edges.length > 0}
				<div class="power-edges">
					{#each powerGraph.edges as edge}
						<button onclick={() => projectStore.selectNet(edge.to)}>
							<span>{edge.from} -&gt; {edge.to}</span>
							<small>{edge.component} - {edge.confidence}</small>
						</button>
					{/each}
				</div>
			{:else}
				<p>No directed converter relation detected.</p>
			{/if}
			<div class="power-rails">
				{#each powerGraph.rails as rail}
					<button onclick={() => projectStore.selectNet(rail.name)}>
						<strong>{rail.name}</strong>
						<small>{rail.components.length} components</small>
					</button>
				{/each}
			</div>
		</details>
		<div class="change-list">
			{#if projectStore.mode === 'view'}
			<h3>Components</h3>
			{#each selectedA?.sheets[0]?.components ?? [] as component}
				<button
					class:selected={projectStore.selectedDesignator === instanceDesignator(component.designator)}
					style="--status-color: #6b7280"
					onclick={() => projectStore.selectDesignator(instanceDesignator(component.designator))}
				>
					<strong>{instanceDesignator(component.designator)}</strong>
					<span>{component.value || component.comment || component.libRef}</span>
				</button>
			{/each}
			{:else}
			<h3>Differences</h3>
			{#each visibleComponentDiff as diff}
				<button
					class:selected={projectStore.selectedDesignator === diff.designator}
					style={`--status-color: ${diffColors[diff.status]}`}
					onclick={() => projectStore.selectDesignator(diff.designator)}
				>
					<strong>{diff.designator}</strong>
					<span>{diff.status}</span>
				</button>
			{/each}
			{#if visibleWireDiff.length > 0 || visibleNetLabelDiff.length > 0}
				<p>{visibleWireDiff.length} wire changes, {visibleNetLabelDiff.length} label changes</p>
			{/if}
			{#if visibleComponentDiff.length === 0 && visibleWireDiff.length === 0 && visibleNetLabelDiff.length === 0}
				<p>No schematic difference on this page.</p>
			{/if}
			{/if}
		</div>
	</aside>
	<div class="canvas-area">
		<BaseCanvas
			background="#fbfcff"
			{draw}
			onCanvasClick={onSchematicClick}
			resolveTooltip={resolveSchematicTooltip}
			{focusKey}
			resolveFocus={resolveSelectionFocus}
		/>
	</div>
</div>

<style>
	.schematic-view {
		width: 100%;
		height: 100%;
		display: grid;
		grid-template-columns: 236px minmax(0, 1fr);
		min-height: 0;
	}

	.diff-panel {
		border-right: 1px solid #d5dbe5;
		background: #ffffff;
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		overflow: auto;
	}

	.canvas-area {
		min-width: 0;
		min-height: 0;
	}

	label {
		display: grid;
		gap: 7px;
		color: #526070;
		font-size: 0.78rem;
		font-weight: 800;
	}

	.display-options {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		border-block: 1px solid #e5e7eb;
		padding: 9px 0;
	}

	.display-options label {
		display: flex;
		align-items: center;
		gap: 6px;
		color: #344054;
		font-size: 0.76rem;
	}

	.power-tree {
		border: 1px solid #cbd5e1;
		border-radius: 7px;
		background: #f8fafc;
		padding: 8px;
	}

	.power-tree summary {
		color: #334155;
		cursor: pointer;
		font-size: 0.78rem;
		font-weight: 800;
	}

	.power-tree p {
		color: #64748b;
		font-size: 0.72rem;
	}

	.power-edges,
	.power-rails {
		display: flex;
		flex-direction: column;
		gap: 5px;
		margin-top: 8px;
	}

	.power-tree button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 7px;
		border: 0;
		border-left: 3px solid #8b5cf6;
		border-radius: 4px;
		background: #ffffff;
		color: #334155;
		cursor: pointer;
		font-size: 0.7rem;
		padding: 6px 7px;
		text-align: left;
	}

	.power-tree button:hover {
		background: #f1f5f9;
	}

	.power-tree small {
		color: #64748b;
		font-size: 0.64rem;
	}

	select {
		border: 1px solid #d0d5dd;
		border-radius: 5px;
		background: #ffffff;
		color: #111827;
		font: inherit;
		min-height: 28px;
		width: 100%;
		padding: 0 8px;
	}

	.legend {
		display: flex;
		flex-direction: column;
		gap: 12px;
		border-bottom: 1px solid #e5e7eb;
		padding-bottom: 12px;
		color: #526070;
		font-size: 0.78rem;
		font-weight: 800;
	}

	.legend span {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.legend i {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}

	.legend .added {
		background: #16a34a;
	}

	.legend .removed {
		background: #dc2626;
	}

	.legend .modified {
		background: #f97316;
	}

	.sheet-stats {
		display: flex;
		flex-direction: column;
		gap: 5px;
		border-radius: 6px;
		background: rgba(17, 24, 39, 0.82);
		color: #ffffff;
		font-size: 0.78rem;
		font-weight: 700;
		padding: 7px 9px;
	}

	.change-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	h3 {
		margin: 0 0 2px;
		color: #526070;
		font-size: 0.78rem;
		text-transform: uppercase;
	}

	.change-list button {
		border-left: 4px solid var(--status-color);
		border-radius: 6px;
		background: #f8fafc;
		color: #111827;
		cursor: pointer;
		display: flex;
		justify-content: space-between;
		gap: 10px;
		padding: 8px 10px;
		text-align: left;
	}

	.change-list button.selected {
		background: #fffbeb;
	}

	.change-list span {
		color: var(--status-color);
		font-weight: 800;
		text-transform: uppercase;
	}

	.change-list p {
		margin: 0;
		color: #667085;
		font-size: 0.83rem;
	}
</style>
