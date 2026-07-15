<script lang="ts">
	import BaseCanvas, { type CanvasClick } from '$lib/components/BaseCanvas.svelte';
	import {
		prepareSchematicRenderGeometry,
		type SchematicRenderPrimitive
	} from '$lib/domain/schematicRenderGeometry';
	import { projectStore } from '$lib/state/projectStore.svelte';
	import type {
		AltiumBounds,
		AltiumPoint,
		AltiumSchMarker,
		AltiumSchSheet
	} from '$lib/types/altium';

	let { sheet, channel = '' }: { sheet: AltiumSchSheet; channel?: string } = $props();

	const padding = 42;
	const geometry = $derived(prepareSchematicRenderGeometry(sheet));
	const sheetFocusKey = $derived(sheet.id ?? sheet.path ?? sheet.fileName ?? sheet.name ?? 'sheet');

	function displayDesignator(designator: string) {
		return channel ? `${designator}_${channel}` : designator;
	}

	function primitiveText(marker: AltiumSchMarker) {
		return marker.name ?? marker.text ?? marker.fileName ?? '';
	}

	function markerName(marker: AltiumSchMarker) {
		return marker.name ?? marker.text ?? '';
	}

	function boundsContains(bounds: AltiumBounds, point: AltiumPoint) {
		const minX = Math.min(bounds.x1, bounds.x2);
		const maxX = Math.max(bounds.x1, bounds.x2);
		const minY = Math.min(bounds.y1, bounds.y2);
		const maxY = Math.max(bounds.y1, bounds.y2);
		return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
	}

	function componentHitBox(primitive: Extract<SchematicRenderPrimitive, { kind: 'component' }>) {
		return (
			primitive.bounds ?? {
				x1: primitive.x - 12,
				y1: primitive.y - 12,
				x2: primitive.x + 12,
				y2: primitive.y + 12
			}
		);
	}

	function textHitBox(primitive: Extract<SchematicRenderPrimitive, { kind: 'text' }>) {
		const text = primitive.text.text.trim();
		const width = Math.max(18, text.length * 5.5);
		const height = 12;
		return {
			x1: primitive.text.x - 2,
			y1: primitive.text.y - height / 2,
			x2: primitive.text.x + width + 2,
			y2: primitive.text.y + height / 2
		};
	}

	function textMatchesSelectedDesignator(
		primitive: Extract<SchematicRenderPrimitive, { kind: 'text' }>
	) {
		const selected = projectStore.selectedDesignator?.toUpperCase();
		if (!selected) return false;
		const linkedDesignator = primitive.componentDesignator
			? displayDesignator(primitive.componentDesignator).toUpperCase()
			: '';
		const visibleText = primitive.text.text.trim().toUpperCase();
		return linkedDesignator === selected || visibleText === selected;
	}

	function textDesignator(
		primitive: Extract<SchematicRenderPrimitive, { kind: 'text' }>
	): string | null {
		if (primitive.componentDesignator) return displayDesignator(primitive.componentDesignator);
		const text = primitive.text.text.trim();
		return /^[A-Z]+\d+[A-Z]?$/i.test(text) ? text : null;
	}

	function fitToCanvas(width: number, height: number) {
		const bounds = geometry.bounds;
		const sourceWidth = Math.max(1, bounds.maxX - bounds.minX);
		const sourceHeight = Math.max(1, bounds.maxY - bounds.minY);
		const fit = Math.min(
			(width - padding * 2) / sourceWidth,
			(height - padding * 2) / sourceHeight
		);
		return {
			fit,
			offsetX: (width - sourceWidth * fit) / 2 - bounds.minX * fit,
			offsetY: (height - sourceHeight * fit) / 2 - bounds.minY * fit
		};
	}

	function screenPoint(point: AltiumPoint, width: number, height: number) {
		const { fit, offsetX, offsetY } = fitToCanvas(width, height);
		return { x: offsetX + point.x * fit, y: offsetY + point.y * fit };
	}

	function toSheetPoint(event: CanvasClick) {
		const localX = (event.x - event.panX) / event.zoom;
		const localY = (event.y - event.panY) / event.zoom;
		const { fit, offsetX, offsetY } = fitToCanvas(event.width, event.height);
		return { x: (localX - offsetX) / fit, y: (localY - offsetY) / fit };
	}

	function drawPolyline(ctx: CanvasRenderingContext2D, points: AltiumPoint[]) {
		if (points.length === 0) return;
		ctx.beginPath();
		ctx.moveTo(points[0].x, points[0].y);
		for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
		ctx.stroke();
	}

	function drawText(
		ctx: CanvasRenderingContext2D,
		text: string,
		x: number,
		y: number,
		size = 9,
		color = '#334155',
		bold = false
	) {
		if (!text.trim()) return;
		ctx.fillStyle = color;
		ctx.font = `${bold ? '700 ' : ''}${size}px Inter, system-ui, sans-serif`;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, x, y);
	}

	function drawMarker(
		ctx: CanvasRenderingContext2D,
		primitive: Extract<SchematicRenderPrimitive, { marker: AltiumSchMarker }>
	) {
		const marker = primitive.marker;
		const label = primitiveText(marker);
		const selected = Boolean(
			label && label.toUpperCase() === projectStore.selectedNet?.toUpperCase()
		);
		const external = ['port', 'offSheetConnector', 'sheetEntry', 'busEntry'].includes(
			primitive.kind
		);
		const power = primitive.kind === 'powerPort';

		ctx.save();
		ctx.strokeStyle = selected ? '#0891b2' : power ? '#7c3aed' : external ? '#2563eb' : '#64748b';
		ctx.fillStyle = selected ? '#ecfeff' : power ? '#f5f3ff' : external ? '#eff6ff' : '#ffffff';
		ctx.lineWidth = selected ? 1.8 : 1;

		if (primitive.kind === 'junction') {
			ctx.fillStyle = '#334155';
			ctx.beginPath();
			ctx.arc(marker.x, marker.y, 2.2, 0, Math.PI * 2);
			ctx.fill();
			ctx.restore();
			return;
		}

		if (primitive.kind === 'sheetSymbol') {
			const width = Math.max(46, label.length * 6 + 14);
			ctx.beginPath();
			ctx.rect(marker.x, marker.y, width, 30);
			ctx.fill();
			ctx.stroke();
			drawText(ctx, label, marker.x + 6, marker.y + 15, 8, '#1e293b', true);
			ctx.restore();
			return;
		}

		if (external || power) {
			const width = Math.max(28, label.length * 6 + 16);
			ctx.beginPath();
			ctx.moveTo(marker.x, marker.y);
			ctx.lineTo(marker.x + width - 8, marker.y);
			ctx.lineTo(marker.x + width, marker.y + 7);
			ctx.lineTo(marker.x + width - 8, marker.y + 14);
			ctx.lineTo(marker.x, marker.y + 14);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
			drawText(
				ctx,
				label,
				marker.x + 5,
				marker.y + 7,
				8,
				selected ? '#0e7490' : '#334155',
				selected
			);
			ctx.restore();
			return;
		}

		if (label)
			drawText(
				ctx,
				label,
				marker.x + 3,
				marker.y - 7,
				8,
				marker.hidden ? '#64748b' : '#1d4ed8',
				selected
			);
		else {
			ctx.beginPath();
			ctx.rect(marker.x - 3, marker.y - 3, 6, 6);
			ctx.stroke();
		}
		ctx.restore();
	}

	function drawPrimitive(ctx: CanvasRenderingContext2D, primitive: SchematicRenderPrimitive) {
		if (primitive.kind === 'wire' || primitive.kind === 'bus') {
			ctx.save();
			ctx.strokeStyle = primitive.kind === 'bus' ? '#334155' : '#475569';
			ctx.lineWidth = primitive.kind === 'bus' ? 2.4 : 1.1;
			if (primitive.kind === 'bus') ctx.setLineDash([8, 3]);
			drawPolyline(ctx, primitive.points);
			ctx.restore();
			return;
		}
		if (primitive.kind === 'component') {
			const bounds = componentHitBox(primitive);
			const selected =
				projectStore.selectedDesignator?.toUpperCase() ===
				displayDesignator(primitive.designator).toUpperCase();
			ctx.save();
			ctx.fillStyle = selected ? 'rgba(219, 234, 254, 0.48)' : 'rgba(248, 250, 252, 0.86)';
			ctx.strokeStyle = selected ? '#2563eb' : '#94a3b8';
			ctx.lineWidth = selected ? 2 : 1;
			ctx.beginPath();
			ctx.rect(bounds.x1, bounds.y1, bounds.x2 - bounds.x1, bounds.y2 - bounds.y1);
			ctx.fill();
			ctx.stroke();
			drawText(
				ctx,
				displayDesignator(primitive.designator),
				bounds.x1 + 3,
				bounds.y1 - 7,
				8,
				selected ? '#1d4ed8' : '#0f172a',
				true
			);
			ctx.restore();
			return;
		}
		if (primitive.kind === 'symbolGraphic') {
			const graphic = primitive.graphic;
			ctx.save();
			ctx.strokeStyle = '#0f172a';
			ctx.lineWidth = 1;
			if (graphic.points) drawPolyline(ctx, graphic.points);
			else if (graphic.radius !== undefined && graphic.x !== undefined && graphic.y !== undefined) {
				ctx.beginPath();
				ctx.arc(graphic.x, graphic.y, graphic.radius, 0, Math.PI * 2);
				ctx.stroke();
			} else if (
				graphic.x1 !== undefined &&
				graphic.y1 !== undefined &&
				graphic.x2 !== undefined &&
				graphic.y2 !== undefined
			) {
				ctx.beginPath();
				ctx.moveTo(graphic.x1, graphic.y1);
				ctx.lineTo(graphic.x2, graphic.y2);
				ctx.stroke();
			}
			ctx.restore();
			return;
		}
		if (primitive.kind === 'text') {
			const selectedText = textMatchesSelectedDesignator(primitive);
			if (selectedText) {
				const bounds = textHitBox(primitive);
				ctx.save();
				ctx.fillStyle = 'rgba(219, 234, 254, 0.5)';
				ctx.strokeStyle = '#2563eb';
				ctx.lineWidth = 1.4;
				ctx.beginPath();
				ctx.rect(bounds.x1, bounds.y1, bounds.x2 - bounds.x1, bounds.y2 - bounds.y1);
				ctx.fill();
				ctx.stroke();
				ctx.restore();
			}
			drawText(
				ctx,
				primitive.text.text,
				primitive.text.x,
				primitive.text.y,
				8,
				selectedText ? '#1d4ed8' : '#475569',
				selectedText || primitive.text.role === 'designator' || Boolean(textDesignator(primitive))
			);
			return;
		}
		if (primitive.kind === 'annotation') {
			ctx.save();
			if (primitive.bounds) {
				ctx.fillStyle = 'rgba(255, 251, 235, 0.72)';
				ctx.strokeStyle = '#facc15';
				ctx.beginPath();
				ctx.rect(
					primitive.bounds.x1,
					primitive.bounds.y1,
					primitive.bounds.x2 - primitive.bounds.x1,
					primitive.bounds.y2 - primitive.bounds.y1
				);
				ctx.fill();
				ctx.stroke();
			}
			drawText(
				ctx,
				primitive.displayText ?? primitive.text,
				primitive.x + 3,
				primitive.y,
				8,
				'#854d0e'
			);
			ctx.restore();
			return;
		}
		if ('marker' in primitive) drawMarker(ctx, primitive);
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
		const { fit, offsetX, offsetY } = fitToCanvas(width, height);
		ctx.save();
		ctx.translate(offsetX, offsetY);
		ctx.scale(fit, fit);
		ctx.fillStyle = '#ffffff';
		ctx.strokeStyle = '#e2e8f0';
		ctx.lineWidth = 1 / fit;
		ctx.beginPath();
		ctx.rect(
			geometry.bounds.minX,
			geometry.bounds.minY,
			geometry.bounds.maxX - geometry.bounds.minX,
			geometry.bounds.maxY - geometry.bounds.minY
		);
		ctx.fill();
		ctx.stroke();
		for (const primitive of geometry.primitives) drawPrimitive(ctx, primitive);
		ctx.restore();
	}

	function onClick(event: CanvasClick) {
		const point = toSheetPoint(event);
		for (const primitive of [...geometry.primitives].reverse()) {
			if (primitive.kind === 'component' && boundsContains(componentHitBox(primitive), point)) {
				projectStore.selectDesignator(displayDesignator(primitive.designator));
				return;
			}
			if (primitive.kind === 'text' && boundsContains(textHitBox(primitive), point)) {
				const designator = textDesignator(primitive);
				if (designator) {
					projectStore.selectDesignator(designator);
					return;
				}
			}
			if (
				'marker' in primitive &&
				Math.hypot(point.x - primitive.marker.x, point.y - primitive.marker.y) <= 12
			) {
				const name = markerName(primitive.marker);
				if (name) {
					projectStore.selectNet(name);
					return;
				}
			}
		}
		projectStore.selectDesignator(null);
	}

	function tooltip(event: CanvasClick) {
		const point = toSheetPoint(event);
		for (const primitive of [...geometry.primitives].reverse()) {
			if (primitive.kind === 'component' && boundsContains(componentHitBox(primitive), point)) {
				return displayDesignator(primitive.designator);
			}
			if (primitive.kind === 'text' && boundsContains(textHitBox(primitive), point)) {
				const designator = textDesignator(primitive);
				if (designator) return designator;
			}
			if (
				'marker' in primitive &&
				Math.hypot(point.x - primitive.marker.x, point.y - primitive.marker.y) <= 12
			) {
				const text = primitiveText(primitive.marker);
				return text ? `${primitive.kind} · ${text}` : primitive.kind;
			}
		}
		return null;
	}

	function resolveFocus(width: number, height: number) {
		const selected = projectStore.selectedDesignator?.toUpperCase();
		if (selected) {
			const component = geometry.primitives.find(
				(primitive) =>
					primitive.kind === 'component' &&
					displayDesignator(primitive.designator).toUpperCase() === selected
			);
			if (component?.kind === 'component') {
				const bounds = componentHitBox(component);
				const center = screenPoint(
					{ x: (bounds.x1 + bounds.x2) / 2, y: (bounds.y1 + bounds.y2) / 2 },
					width,
					height
				);
				return { ...center, zoom: 2.6 };
			}
			const text = geometry.primitives.find(
				(primitive) =>
					primitive.kind === 'text' &&
					(textDesignator(primitive)?.toUpperCase() === selected ||
						primitive.text.text.trim().toUpperCase() === selected)
			);
			if (text?.kind === 'text') {
				const bounds = textHitBox(text);
				const center = screenPoint(
					{ x: (bounds.x1 + bounds.x2) / 2, y: (bounds.y1 + bounds.y2) / 2 },
					width,
					height
				);
				return { ...center, zoom: 2.8 };
			}
		}
		const selectedNet = projectStore.selectedNet?.toUpperCase();
		if (!selectedNet) return null;
		const marker = geometry.primitives.find(
			(primitive) =>
				'marker' in primitive && markerName(primitive.marker).toUpperCase() === selectedNet
		);
		return marker && 'marker' in marker
			? { ...screenPoint(marker.marker, width, height), zoom: 2.6 }
			: null;
	}
</script>

<BaseCanvas
	background="#e7ebf2"
	{draw}
	onCanvasClick={onClick}
	resolveTooltip={tooltip}
	focusKey={`${sheetFocusKey}:${projectStore.selectedDesignator ?? projectStore.selectedNet ?? ''}`}
	{resolveFocus}
	ariaLabel="Faithful schematic sheet canvas"
/>
