import type {
	AltiumBounds,
	AltiumPoint,
	AltiumSchComponent,
	AltiumSchGraphic,
	AltiumSchMarker,
	AltiumSchSheet,
	AltiumSchText,
	BoundsRect
} from '$lib/types/altium';

export type SchematicRenderPrimitive =
	| {
			kind: 'component';
			designator: string;
			logicalNodeId: string;
			x: number;
			y: number;
			bounds?: AltiumBounds;
	  }
	| {
			kind: 'symbolGraphic';
			componentDesignator: string;
			logicalNodeId: string;
			graphic: AltiumSchGraphic;
	  }
	| {
			kind: 'text';
			componentDesignator?: string;
			logicalNodeId?: string;
			text: AltiumSchText;
	  }
	| {
			kind: 'wire' | 'bus';
			points: AltiumPoint[];
	  }
	| {
			kind:
				| 'netLabel'
				| 'port'
				| 'powerPort'
				| 'offSheetConnector'
				| 'sheetSymbol'
				| 'sheetEntry'
				| 'junction'
				| 'busEntry'
				| 'noERC'
				| 'directive';
			marker: AltiumSchMarker;
	  }
	| {
			kind: 'annotation';
			text: string;
			displayText?: string;
			x: number;
			y: number;
			bounds?: AltiumBounds;
	  };

export interface SchematicRenderGeometry {
	primitives: SchematicRenderPrimitive[];
	bounds: BoundsRect;
	hasFaithfulGeometry: boolean;
	logicalNodeIds: string[];
}

function componentLogicalNodeId(component: AltiumSchComponent, index: number) {
	return `${component.designator}#${component.currentPartId ?? index}`;
}

function emptyBounds(): BoundsRect {
	return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function includePoint(bounds: BoundsRect, point: AltiumPoint) {
	bounds.minX = Math.min(bounds.minX, point.x);
	bounds.minY = Math.min(bounds.minY, point.y);
	bounds.maxX = Math.max(bounds.maxX, point.x);
	bounds.maxY = Math.max(bounds.maxY, point.y);
}

function includeAltiumBounds(bounds: BoundsRect, source: AltiumBounds | undefined) {
	if (!source) return;
	bounds.minX = Math.min(bounds.minX, source.x1, source.x2);
	bounds.minY = Math.min(bounds.minY, source.y1, source.y2);
	bounds.maxX = Math.max(bounds.maxX, source.x1, source.x2);
	bounds.maxY = Math.max(bounds.maxY, source.y1, source.y2);
}

function includeGraphic(bounds: BoundsRect, graphic: AltiumSchGraphic) {
	if (graphic.x !== undefined && graphic.y !== undefined)
		includePoint(bounds, { x: graphic.x, y: graphic.y });
	if (graphic.x1 !== undefined && graphic.y1 !== undefined)
		includePoint(bounds, { x: graphic.x1, y: graphic.y1 });
	if (graphic.x2 !== undefined && graphic.y2 !== undefined)
		includePoint(bounds, { x: graphic.x2, y: graphic.y2 });
	for (const point of graphic.points ?? []) includePoint(bounds, point);
	if (graphic.radius !== undefined && graphic.x !== undefined && graphic.y !== undefined) {
		includePoint(bounds, { x: graphic.x - graphic.radius, y: graphic.y - graphic.radius });
		includePoint(bounds, { x: graphic.x + graphic.radius, y: graphic.y + graphic.radius });
	}
}

function markerText(marker: AltiumSchMarker) {
	return marker.name ?? marker.text ?? marker.fileName ?? '';
}

function includeMarker(bounds: BoundsRect, marker: AltiumSchMarker) {
	includePoint(bounds, marker);
	includeAltiumBounds(bounds, marker.bounds);
}

function finalBounds(bounds: BoundsRect): BoundsRect {
	if (Number.isFinite(bounds.minX)) return bounds;
	return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
}

function addMarkerPrimitives(
	primitives: SchematicRenderPrimitive[],
	bounds: BoundsRect,
	kind: Extract<
		SchematicRenderPrimitive['kind'],
		| 'port'
		| 'powerPort'
		| 'offSheetConnector'
		| 'sheetSymbol'
		| 'sheetEntry'
		| 'junction'
		| 'busEntry'
		| 'noERC'
		| 'directive'
	>,
	markers: AltiumSchMarker[] | undefined
) {
	for (const marker of markers ?? []) {
		primitives.push({ kind, marker });
		includeMarker(bounds, marker);
	}
}

export function prepareSchematicRenderGeometry(sheet: AltiumSchSheet): SchematicRenderGeometry {
	const primitives: SchematicRenderPrimitive[] = [];
	const bounds = emptyBounds();
	const logicalNodeIds: string[] = [];
	let hasFaithfulGeometry = false;

	for (const [index, component] of sheet.components.entries()) {
		const logicalNodeId = componentLogicalNodeId(component, index);
		logicalNodeIds.push(logicalNodeId);
		primitives.push({
			kind: 'component',
			designator: component.designator,
			logicalNodeId,
			x: component.x,
			y: component.y,
			bounds: component.bounds
		});
		includePoint(bounds, component);
		includeAltiumBounds(bounds, component.bounds);
		if (component.bounds) hasFaithfulGeometry = true;

		for (const graphic of component.symbolGraphics ?? []) {
			primitives.push({
				kind: 'symbolGraphic',
				componentDesignator: component.designator,
				logicalNodeId,
				graphic
			});
			includeGraphic(bounds, graphic);
			hasFaithfulGeometry = true;
		}
		for (const text of component.textRender ?? []) {
			primitives.push({
				kind: 'text',
				componentDesignator: component.designator,
				logicalNodeId,
				text
			});
			includePoint(bounds, text);
			hasFaithfulGeometry = true;
		}
		for (const pin of component.pins) includePoint(bounds, pin);
	}

	for (const wire of sheet.wires) {
		const points = wire.points ?? (wire.start && wire.end ? [wire.start, wire.end] : []);
		primitives.push({ kind: 'wire', points });
		for (const point of points) includePoint(bounds, point);
	}
	for (const bus of sheet.buses ?? []) {
		primitives.push({ kind: 'bus', points: bus.points });
		for (const point of bus.points) includePoint(bounds, point);
	}
	for (const label of sheet.netLabels) {
		const marker: AltiumSchMarker = {
			id: label.id,
			text: label.text,
			orientation: label.orientation,
			hidden: label.hidden,
			x: label.x,
			y: label.y
		};
		primitives.push({ kind: 'netLabel', marker });
		includeMarker(bounds, marker);
	}

	addMarkerPrimitives(primitives, bounds, 'port', sheet.ports);
	addMarkerPrimitives(primitives, bounds, 'powerPort', sheet.powerPorts);
	addMarkerPrimitives(primitives, bounds, 'offSheetConnector', sheet.offSheetConnectors);
	addMarkerPrimitives(primitives, bounds, 'sheetSymbol', sheet.sheetSymbols);
	addMarkerPrimitives(primitives, bounds, 'sheetEntry', sheet.sheetEntries);
	addMarkerPrimitives(primitives, bounds, 'junction', sheet.junctions);
	addMarkerPrimitives(primitives, bounds, 'busEntry', sheet.busEntries);
	addMarkerPrimitives(primitives, bounds, 'noERC', sheet.noERC);
	addMarkerPrimitives(primitives, bounds, 'directive', sheet.directives);

	for (const annotation of sheet.annotations ?? []) {
		primitives.push({
			kind: 'annotation',
			text: annotation.text,
			displayText: annotation.displayText,
			x: annotation.x,
			y: annotation.y,
			bounds: annotation.bounds
		});
		includePoint(bounds, annotation);
		includeAltiumBounds(bounds, annotation.bounds);
		hasFaithfulGeometry = true;
	}

	for (const primitive of primitives) {
		if ('marker' in primitive && markerText(primitive.marker)) hasFaithfulGeometry = true;
	}

	return {
		primitives,
		bounds: finalBounds(bounds),
		hasFaithfulGeometry,
		logicalNodeIds
	};
}
