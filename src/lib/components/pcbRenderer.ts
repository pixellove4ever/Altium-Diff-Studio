/**
 * Pure rendering functions for PCB primitives.
 * Shared between Diff, Side-by-side, and Overlay modes.
 */

import type {
	AltiumPcbArc,
	AltiumPcbComponent,
	AltiumPcbDoc,
	AltiumPcbPad,
	AltiumPcbPolygon,
	AltiumPcbText,
	AltiumPcbTrack,
	AltiumPcbVia,
	AltiumPoint
} from '$lib/types/altium';
import type { DiffStatus } from '$lib/diff/altiumDiff';
import { diffColors } from '$lib/diff/altiumDiff';

// ---- Color & Alpha helpers ----

export function pcbDiffColor(status: DiffStatus): string {
	if (status === 'added') return '#16a34a';
	if (status === 'removed') return '#dc2626';
	if (status === 'modified') return '#f97316';
	return '#6b7280';
}

export function layerColor(_layer: string, status: DiffStatus): string {
	if (status !== 'unchanged') return pcbDiffColor(status);
	return '#6b7280';
}

export function pcbAlpha(status: DiffStatus, kind: 'plane' | 'line' | 'component'): number {
	if (status !== 'unchanged') return kind === 'plane' ? 0.36 : 0.95;
	if (kind === 'plane') return 0.14;
	if (kind === 'component') return 0.42;
	return 0.34;
}

// ---- Solo mode colors (for side-by-side / overlay) ----

const SOLO_LAYER_PALETTE: Record<string, string> = {
	'Top Layer': '#c0392b',
	'Bottom Layer': '#2980b9',
	'Top Overlay': '#f1c40f',
	'Bottom Overlay': '#27ae60',
	'Top Paste': '#e74c3c',
	'Bottom Paste': '#3498db',
	'Top Solder': '#9b59b6',
	'Bottom Solder': '#1abc9c',
	'Mechanical 1': '#95a5a6',
	'Keep-Out Layer': '#e67e22'
};

const SOLO_FALLBACK_COLORS = [
	'#e74c3c',
	'#3498db',
	'#2ecc71',
	'#f39c12',
	'#9b59b6',
	'#1abc9c',
	'#e67e22',
	'#34495e'
];

export function soloLayerColor(layer: string, layers: string[]): string {
	if (SOLO_LAYER_PALETTE[layer]) return SOLO_LAYER_PALETTE[layer];
	const index = layers.indexOf(layer);
	return SOLO_FALLBACK_COLORS[index >= 0 ? index % SOLO_FALLBACK_COLORS.length : 0];
}

export function selectedLayerColor(layer: string, layers: string[]): string {
	const color = soloLayerColor(layer, layers);
	const match = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
	if (!match) return color;
	const channels = match.slice(1).map((channel) => Number.parseInt(channel, 16));
	const brightened = channels.map((channel) => Math.round(channel + (255 - channel) * 0.2));
	return `#${brightened.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

// ---- Bounds ----

export interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

function includeBounds(bounds: Bounds, x: number, y: number) {
	bounds.minX = Math.min(bounds.minX, x);
	bounds.minY = Math.min(bounds.minY, y);
	bounds.maxX = Math.max(bounds.maxX, x);
	bounds.maxY = Math.max(bounds.maxY, y);
}

const pcbBoundsCache = new WeakMap<AltiumPcbDoc, Bounds>();

function getSinglePcbBounds(pcb: AltiumPcbDoc): Bounds {
	const cached = pcbBoundsCache.get(pcb);
	if (cached) return cached;
	const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

	const outlineBounds = pcb.boardOutlineRenderBounds;
	if (
		outlineBounds &&
		Number.isFinite(outlineBounds.minX) &&
		Number.isFinite(outlineBounds.minY) &&
		Number.isFinite(outlineBounds.maxX) &&
		Number.isFinite(outlineBounds.maxY) &&
		outlineBounds.maxX > outlineBounds.minX &&
		outlineBounds.maxY > outlineBounds.minY
	) {
		includeBounds(bounds, outlineBounds.minX, outlineBounds.minY);
		includeBounds(bounds, outlineBounds.maxX, outlineBounds.maxY);
	} else {
		for (const track of pcb.tracks) {
			includeBounds(bounds, track.start.x, track.start.y);
			includeBounds(bounds, track.end.x, track.end.y);
		}
		pcb.boardOutline?.forEach((point) => includeBounds(bounds, point.x, point.y));
		pcb.boardOutlineEdges?.forEach((edge) => {
			if (edge.edgeClass !== 'boardOutlineCandidate') return;
			includeBounds(bounds, edge.start.x, edge.start.y);
			includeBounds(bounds, edge.end.x, edge.end.y);
		});
		pcb.polygons?.forEach((polygon) =>
			polygon.vertices.forEach((point) => includeBounds(bounds, point.x, point.y))
		);
		for (const pad of pcb.pads) includeBounds(bounds, pad.x, pad.y);
		for (const via of pcb.vias) includeBounds(bounds, via.x, via.y);
		for (const component of pcb.components) includeBounds(bounds, component.x, component.y);
		pcb.arcs?.forEach((arc) => {
			includeBounds(bounds, arc.center.x - arc.radius, arc.center.y - arc.radius);
			includeBounds(bounds, arc.center.x + arc.radius, arc.center.y + arc.radius);
		});
		pcb.texts?.forEach((text) => includeBounds(bounds, text.x, text.y));
	}

	if (!Number.isFinite(bounds.minX)) {
		const fallback = { minX: -50, minY: -50, maxX: 50, maxY: 50 };
		pcbBoundsCache.set(pcb, fallback);
		return fallback;
	}
	pcbBoundsCache.set(pcb, bounds);
	return bounds;
}

export function getPcbBounds(...pcbs: Array<AltiumPcbDoc | null>): Bounds {
	const available = pcbs.filter((pcb): pcb is AltiumPcbDoc => pcb !== null);
	if (available.length === 0) return { minX: -50, minY: -50, maxX: 50, maxY: 50 };
	if (available.length === 1) return getSinglePcbBounds(available[0]);

	const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
	for (const pcb of available) {
		const current = getSinglePcbBounds(pcb);
		includeBounds(bounds, current.minX, current.minY);
		includeBounds(bounds, current.maxX, current.maxY);
	}
	return bounds;
}

// ---- Draw primitives ----

function drawPadShape(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	shape: string,
	cornerRadius?: number
) {
	if (shape === 'round' || shape === 'oval') {
		ctx.beginPath();
		ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
		ctx.fill();
		return;
	}
	if (shape === 'octagonal') {
		const cut = Math.min(w, h) * 0.22;
		ctx.beginPath();
		ctx.moveTo(x - w / 2 + cut, y - h / 2);
		ctx.lineTo(x + w / 2 - cut, y - h / 2);
		ctx.lineTo(x + w / 2, y - h / 2 + cut);
		ctx.lineTo(x + w / 2, y + h / 2 - cut);
		ctx.lineTo(x + w / 2 - cut, y + h / 2);
		ctx.lineTo(x - w / 2 + cut, y + h / 2);
		ctx.lineTo(x - w / 2, y + h / 2 - cut);
		ctx.lineTo(x - w / 2, y - h / 2 + cut);
		ctx.closePath();
		ctx.fill();
		return;
	}
	if (shape === 'rounded-rectangular') {
		const radius = Math.min(cornerRadius ?? Math.min(w, h) * 0.2, w / 2, h / 2);
		ctx.beginPath();
		ctx.roundRect(x - w / 2, y - h / 2, w, h, radius);
		ctx.fill();
		return;
	}
	ctx.fillRect(x - w / 2, y - h / 2, w, h);
}

export function drawTrack(
	ctx: CanvasRenderingContext2D,
	track: AltiumPcbTrack,
	color: string,
	alpha: number
) {
	ctx.strokeStyle = color;
	ctx.globalAlpha = alpha;
	ctx.lineWidth = Math.max(track.width, 0.12);
	ctx.beginPath();
	ctx.moveTo(track.start.x, track.start.y);
	ctx.lineTo(track.end.x, track.end.y);
	ctx.stroke();
}

export function drawPad(
	ctx: CanvasRenderingContext2D,
	pad: AltiumPcbPad,
	color: string,
	alpha: number,
	showPin1Marker = false
) {
	ctx.save();
	ctx.translate(pad.x, pad.y);
	ctx.rotate(((pad.rotation ?? 0) * Math.PI) / 180);
	ctx.fillStyle = color;
	ctx.globalAlpha = alpha;
	const width = Math.max(pad.size.x, 0.5);
	const height = Math.max(pad.size.y, 0.5);
	drawPadShape(ctx, 0, 0, width, height, pad.shape, pad.cornerRadius);
	if (pad.holeSize > 0) {
		ctx.globalCompositeOperation = 'destination-out';
		ctx.beginPath();
		const holeWidth = pad.holeSizeX ?? pad.holeSize;
		const holeHeight = pad.holeSizeY ?? pad.holeSize;
		if (pad.holeShape === 'rectangular') {
			ctx.rect(-holeWidth / 2, -holeHeight / 2, holeWidth, holeHeight);
		} else if (pad.holeShape === 'oblong') {
			ctx.roundRect(
				-holeWidth / 2,
				-holeHeight / 2,
				holeWidth,
				holeHeight,
				Math.min(holeWidth, holeHeight) / 2
			);
		} else {
			ctx.ellipse(0, 0, holeWidth / 2, holeHeight / 2, 0, 0, Math.PI * 2);
		}
		ctx.fill();
	}
	if (pad.pin1 && showPin1Marker) {
		ctx.globalCompositeOperation = 'source-over';
		ctx.globalAlpha = Math.min(1, alpha + 0.15);
		ctx.strokeStyle = '#facc15';
		ctx.lineWidth = Math.max(Math.min(width, height) * 0.12, 0.12);
		ctx.strokeRect(-width / 2 - 0.12, -height / 2 - 0.12, width + 0.24, height + 0.24);
		ctx.fillStyle = '#facc15';
		ctx.beginPath();
		ctx.arc(-width / 2, height / 2, Math.max(Math.min(width, height) * 0.12, 0.16), 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.restore();
}

export function drawVia(
	ctx: CanvasRenderingContext2D,
	via: AltiumPcbVia,
	color: string,
	alpha: number
) {
	ctx.fillStyle = color;
	ctx.strokeStyle = '#f8fafc';
	ctx.globalAlpha = alpha;
	ctx.lineWidth = 0.12;
	ctx.beginPath();
	ctx.arc(via.x, via.y, Math.max(via.diameter / 2, 0.25), 0, Math.PI * 2);
	ctx.fill();
	ctx.stroke();
}

export function drawArc(
	ctx: CanvasRenderingContext2D,
	arc: AltiumPcbArc,
	color: string,
	alpha: number
) {
	// Altium angles are in degrees; canvas expects radians.
	// Altium uses CCW in a normal Y-up coordinate system.
	// Since we draw with scale(fit, -fit), the Y axis is flipped,
	// which also flips the arc direction — so we negate angles and swap start/end.
	const startRad = (-arc.endAngle * Math.PI) / 180;
	const endRad = (-arc.startAngle * Math.PI) / 180;

	ctx.strokeStyle = color;
	ctx.globalAlpha = alpha;
	ctx.lineWidth = Math.max(arc.width, 0.12);
	ctx.beginPath();
	ctx.arc(arc.center.x, arc.center.y, arc.radius, startRad, endRad);
	ctx.stroke();
}

export function drawSelectedTrack(
	ctx: CanvasRenderingContext2D,
	track: AltiumPcbTrack,
	color: string
) {
	ctx.save();
	ctx.shadowColor = color;
	ctx.shadowBlur = 9;
	drawTrack(ctx, { ...track, width: Math.max(track.width * 2.6, track.width + 0.5) }, color, 0.34);
	ctx.shadowBlur = 0;
	drawTrack(
		ctx,
		{ ...track, width: Math.max(track.width * 1.95, track.width + 0.25) },
		'#ffffff',
		0.7
	);
	drawTrack(ctx, { ...track, width: Math.max(track.width * 1.78, track.width + 0.2) }, color, 1);
	ctx.restore();
}

export function drawSelectedArc(ctx: CanvasRenderingContext2D, arc: AltiumPcbArc, color: string) {
	ctx.save();
	ctx.shadowColor = color;
	ctx.shadowBlur = 9;
	drawArc(ctx, { ...arc, width: Math.max(arc.width * 2.6, arc.width + 0.5) }, color, 0.34);
	ctx.shadowBlur = 0;
	drawArc(ctx, { ...arc, width: Math.max(arc.width * 1.95, arc.width + 0.25) }, '#ffffff', 0.7);
	drawArc(ctx, { ...arc, width: Math.max(arc.width * 1.78, arc.width + 0.2) }, color, 1);
	ctx.restore();
}

export function drawSelectedPad(
	ctx: CanvasRenderingContext2D,
	pad: AltiumPcbPad,
	color: string,
	showPin1Marker = false
) {
	const enlarged = {
		...pad,
		size: { x: pad.size.x * 1.35 + 0.2, y: pad.size.y * 1.35 + 0.2 }
	};
	ctx.save();
	ctx.shadowColor = color;
	ctx.shadowBlur = 10;
	drawPad(ctx, enlarged, color, 0.42, showPin1Marker);
	ctx.shadowBlur = 0;
	drawPad(
		ctx,
		{ ...enlarged, size: { x: enlarged.size.x * 0.9, y: enlarged.size.y * 0.9 } },
		'#ffffff',
		0.78,
		showPin1Marker
	);
	drawPad(ctx, pad, color, 1, showPin1Marker);
	ctx.restore();
}

export function drawSelectedVia(ctx: CanvasRenderingContext2D, via: AltiumPcbVia, color: string) {
	ctx.save();
	ctx.shadowColor = color;
	ctx.shadowBlur = 10;
	drawVia(ctx, { ...via, diameter: via.diameter * 1.55 + 0.2 }, color, 0.42);
	ctx.shadowBlur = 0;
	drawVia(ctx, { ...via, diameter: via.diameter * 1.25 + 0.1 }, '#ffffff', 0.82);
	drawVia(ctx, via, color, 1);
	ctx.restore();
}

export function drawPolygon(
	ctx: CanvasRenderingContext2D,
	polygon: AltiumPcbPolygon,
	color: string,
	fillAlpha: number,
	strokeAlpha: number
) {
	if (polygon.vertices.length < 3) return;

	ctx.save();
	ctx.fillStyle = color;
	ctx.strokeStyle = color;
	ctx.globalAlpha = fillAlpha;
	ctx.beginPath();
	ctx.moveTo(polygon.vertices[0].x, polygon.vertices[0].y);
	for (const point of polygon.vertices.slice(1)) ctx.lineTo(point.x, point.y);
	ctx.closePath();
	ctx.fill();
	ctx.globalAlpha = strokeAlpha;
	ctx.lineWidth = 0.12;
	ctx.stroke();
	ctx.restore();
}

export function drawPcbText(
	ctx: CanvasRenderingContext2D,
	text: AltiumPcbText,
	color: string,
	alpha: number
) {
	ctx.save();
	ctx.fillStyle = color;
	ctx.globalAlpha = alpha;
	ctx.translate(text.x, text.y);
	// Counter the Y-axis flip so text reads correctly
	ctx.scale(1, -1);
	if (text.rotation) {
		ctx.rotate((text.rotation * Math.PI) / 180);
	}
	ctx.font = `${Math.max(text.height, 0.5)}px Inter, system-ui, sans-serif`;
	ctx.textBaseline = 'bottom';
	ctx.fillText(text.text, 0, 0);
	ctx.restore();
}

export function drawComponentLabel(
	ctx: CanvasRenderingContext2D,
	component: AltiumPcbComponent,
	color: string,
	lineWidth: number,
	showOutline = true,
	showDesignator = true
) {
	ctx.save();
	ctx.strokeStyle = color;
	ctx.fillStyle = color;
	ctx.translate(component.x, component.y);
	ctx.lineWidth = lineWidth;
	if (showOutline) {
		const bounds = component.bounds;
		if (bounds) {
			ctx.strokeRect(
				bounds.x1 - component.x,
				bounds.y1 - component.y,
				bounds.x2 - bounds.x1,
				bounds.y2 - bounds.y1
			);
		} else {
			ctx.rotate((component.rotation * Math.PI) / 180);
			ctx.strokeRect(-2.4, -1.4, 4.8, 2.8);
			ctx.rotate((-component.rotation * Math.PI) / 180);
		}
	}
	if (showDesignator) {
		ctx.scale(1, -1);
		ctx.fillText(component.designator, 3.2, 2);
	}
	ctx.restore();
}

export function drawBoardOutline(
	ctx: CanvasRenderingContext2D,
	outline: AltiumPoint[] | undefined
) {
	if (!outline || outline.length < 2) return;

	ctx.save();
	ctx.strokeStyle = '#e5e7eb';
	ctx.globalAlpha = 0.72;
	ctx.lineWidth = 0.18;
	ctx.beginPath();
	ctx.moveTo(outline[0].x, outline[0].y);
	for (const point of outline.slice(1)) ctx.lineTo(point.x, point.y);
	ctx.closePath();
	ctx.stroke();
	ctx.restore();
}

export function drawBoardOutlineEdges(
	ctx: CanvasRenderingContext2D,
	pcb: AltiumPcbDoc | null | undefined
) {
	const candidates =
		pcb?.boardOutlineEdges?.filter((edge) => edge.edgeClass === 'boardOutlineCandidate') ?? [];
	if (candidates.length === 0) {
		drawBoardOutline(ctx, pcb?.boardOutline);
		return;
	}

	ctx.save();
	ctx.strokeStyle = '#f8fafc';
	ctx.globalAlpha = 0.9;
	ctx.lineCap = 'round';
	for (const edge of candidates) {
		ctx.lineWidth = Math.max(Math.min(edge.width ?? 0.18, 0.5), 0.12);
		ctx.beginPath();
		ctx.moveTo(edge.start.x, edge.start.y);
		ctx.lineTo(edge.end.x, edge.end.y);
		ctx.stroke();
	}
	ctx.restore();
}

export function drawSelectedHighlight(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	radius = 4,
	color = '#64748b'
) {
	ctx.save();
	ctx.shadowColor = color;
	ctx.shadowBlur = 10;
	ctx.globalAlpha = 0.7;
	ctx.strokeStyle = '#ffffff';
	ctx.lineWidth = 0.9;
	ctx.beginPath();
	ctx.arc(x, y, radius + 0.18, 0, Math.PI * 2);
	ctx.stroke();
	ctx.shadowBlur = 0;
	ctx.globalAlpha = 1;
	ctx.strokeStyle = color;
	ctx.lineWidth = 0.55;
	ctx.beginPath();
	ctx.arc(x, y, radius, 0, Math.PI * 2);
	ctx.stroke();
	ctx.restore();
}

function componentHighlightRadius(component: AltiumPcbComponent) {
	if (!component.bounds) return 4;
	const width = Math.abs(component.bounds.x2 - component.bounds.x1);
	const height = Math.abs(component.bounds.y2 - component.bounds.y1);
	return Math.max(4, Math.hypot(width, height) / 2 + 1);
}

// ---- Solo draw (for side-by-side / overlay: draw one PCB version with uniform layer colors) ----

export function drawSoloPcb(
	ctx: CanvasRenderingContext2D,
	pcb: AltiumPcbDoc,
	options: {
		layers: string[];
		isLayerVisible: (layer: string) => boolean;
		layerOpacity: (layer: string) => number;
		showComponents: boolean;
		showDesignators: boolean;
		showPlanes: boolean;
		showTexts: boolean;
		selected: string | null;
		selectedNet?: string | null;
		neutralColors?: boolean;
		showPin1Markers?: boolean;
	}
) {
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.font = '2.8px Inter, system-ui, sans-serif';

	const {
		layers,
		isLayerVisible,
		layerOpacity,
		showComponents,
		showDesignators,
		showPlanes,
		showTexts,
		selected,
		selectedNet,
		neutralColors = false,
		showPin1Markers = false
	} = options;
	const colorForLayer = (layer: string) =>
		neutralColors ? '#6b7280' : soloLayerColor(layer, layers);

	// Polygons
	if (showPlanes) {
		for (const polygon of pcb.polygons ?? []) {
			if (!isLayerVisible(polygon.layer)) continue;
			const color = colorForLayer(polygon.layer);
			const opacity = layerOpacity(polygon.layer);
			drawPolygon(ctx, polygon, color, 0.14 * opacity, 0.34 * opacity);
		}
	}

	// Tracks
	for (const track of pcb.tracks) {
		if (!isLayerVisible(track.layer)) continue;
		const color = colorForLayer(track.layer);
		drawTrack(ctx, track, color, 0.7 * layerOpacity(track.layer));
	}

	// Arcs
	for (const arc of pcb.arcs ?? []) {
		if (!isLayerVisible(arc.layer)) continue;
		const color = colorForLayer(arc.layer);
		drawArc(ctx, arc, color, 0.7 * layerOpacity(arc.layer));
	}

	ctx.globalAlpha = 1;

	// Pads
	for (const pad of pcb.pads) {
		if (!isLayerVisible(pad.layer)) continue;
		const color = colorForLayer(pad.layer);
		drawPad(ctx, pad, color, 0.85 * layerOpacity(pad.layer), showPin1Markers);
	}

	// Vias
	for (const via of pcb.vias) {
		const color = colorForLayer(via.startLayer);
		drawVia(ctx, via, color, 0.7 * layerOpacity(via.startLayer));
	}
	ctx.globalAlpha = 1;

	// Components
	if (showComponents || showDesignators) {
		for (const component of pcb.components) {
			if (!isLayerVisible(component.layer)) continue;
			ctx.globalAlpha = 0.65 * layerOpacity(component.layer);
			const color = colorForLayer(component.layer);
			drawComponentLabel(ctx, component, color, 0.28, showComponents, showDesignators);
		}
		ctx.globalAlpha = 1;
	}

	// Texts
	if (showTexts) {
		for (const text of pcb.texts ?? []) {
			if (!isLayerVisible(text.layer)) continue;
			const isDesignator =
				text.role === 'designator' ||
				(!text.role &&
					pcb.components.some(
						(component) => component.designator.toUpperCase() === text.text.trim().toUpperCase()
					));
			if (isDesignator && !showDesignators) continue;
			const color = colorForLayer(text.layer);
			drawPcbText(ctx, text, color, 0.7 * layerOpacity(text.layer));
		}
	}

	// Board outline
	drawBoardOutlineEdges(ctx, pcb);

	if (selectedNet) {
		const net = selectedNet.toUpperCase();
		for (const polygon of pcb.polygons ?? []) {
			if (polygon.net?.toUpperCase() === net)
				drawPolygon(ctx, polygon, selectedLayerColor(polygon.layer, layers), 0.38, 1);
		}
		for (const track of pcb.tracks) {
			if (track.net?.toUpperCase() === net)
				drawSelectedTrack(ctx, track, selectedLayerColor(track.layer, layers));
		}
		for (const arc of pcb.arcs ?? []) {
			if (arc.net?.toUpperCase() === net)
				drawSelectedArc(ctx, arc, selectedLayerColor(arc.layer, layers));
		}
		for (const via of pcb.vias) {
			if (via.net?.toUpperCase() === net)
				drawSelectedVia(ctx, via, selectedLayerColor(via.startLayer, layers));
		}
		for (const pad of pcb.pads) {
			if (pad.net?.toUpperCase() === net)
				drawSelectedPad(ctx, pad, selectedLayerColor(pad.layer, layers), showPin1Markers);
		}
	}

	// Selected highlight
	if (showComponents && selected) {
		const component = pcb.components.find(
			(c) => c.designator.toLowerCase() === selected.toLowerCase()
		);
		if (component) {
			drawSelectedHighlight(
				ctx,
				component.x,
				component.y,
				componentHighlightRadius(component),
				selectedLayerColor(component.layer, layers)
			);
		}
	}
}
