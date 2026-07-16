export type GerberFile = {
	name: string;
	size: number;
	path?: string;
	text: string;
};

export type GerberDiffStatus = 'unchanged' | 'added' | 'removed' | 'modified';

export type GerberLayerDiff = {
	key: string;
	label: string;
	before: GerberFile | null;
	after: GerberFile | null;
	status: GerberDiffStatus;
	counts: {
		unchanged: number;
		added: number;
		removed: number;
	};
};

export type GerberDiffSummary = {
	layers: GerberLayerDiff[];
	counts: Record<GerberDiffStatus, number>;
	lineCounts: {
		unchanged: number;
		added: number;
		removed: number;
	};
};

export type GerberUnit = 'mm' | 'inch';

export type GerberPoint = {
	x: number;
	y: number;
};

export type GerberAperture = {
	code: number;
	shape: 'circle' | 'rectangle' | 'obround' | 'unknown';
	width: number;
	height: number;
};

export type GerberDrawPrimitive = {
	type: 'draw';
	from: GerberPoint;
	to: GerberPoint;
	width: number;
	apertureCode: number | null;
};

export type GerberFlashPrimitive = {
	type: 'flash';
	at: GerberPoint;
	width: number;
	height: number;
	shape: GerberAperture['shape'];
	apertureCode: number | null;
};

export type GerberPrimitive = GerberDrawPrimitive | GerberFlashPrimitive;

export type GerberBounds = {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
};

export type GerberGeometry = {
	primitives: GerberPrimitive[];
	bounds: GerberBounds | null;
	unit: GerberUnit;
	unsupportedCount: number;
};

const FIXED_GERBER_EXTENSIONS = new Set([
	'gbr',
	'ger',
	'pho',
	'art',
	'gtl',
	'gbl',
	'gts',
	'gbs',
	'gtp',
	'gbp',
	'gto',
	'gbo',
	'gko',
	'gml',
	'apr',
	'gd1',
	'gg1',
	'drl',
	'xln'
]);

const GERBER_LAYER_NAMES: Record<string, string> = {
	gtl: 'Top copper',
	gbl: 'Bottom copper',
	gts: 'Top solder mask',
	gbs: 'Bottom solder mask',
	gtp: 'Top paste',
	gbp: 'Bottom paste',
	gto: 'Top overlay',
	gbo: 'Bottom overlay',
	gm1: 'Mechanical 1',
	gm2: 'Mechanical 2',
	gko: 'Board outline',
	gml: 'Mechanical',
	drl: 'Drill',
	xln: 'Drill'
};

export function isGerberFileName(name: string) {
	const extension = name.split('.').pop()?.toLowerCase() ?? '';
	return (
		FIXED_GERBER_EXTENSIONS.has(extension) ||
		/^g\d+$/i.test(extension) ||
		/^gm\d+$/i.test(extension)
	);
}

function fileStem(name: string) {
	return name.replace(/\.[^.]+$/, '');
}

export function gerberLayerKey(name: string) {
	const extension = name.split('.').pop()?.toLowerCase() ?? '';
	if (GERBER_LAYER_NAMES[extension]) return extension;
	return fileStem(name)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

export function gerberLayerLabel(name: string) {
	const extension = name.split('.').pop()?.toLowerCase() ?? '';
	if (GERBER_LAYER_NAMES[extension]) return GERBER_LAYER_NAMES[extension];
	const signalLayer = /^g(\d+)$/i.exec(extension);
	if (signalLayer) return `Signal layer ${signalLayer[1]}`;
	const mechanicalLayer = /^gm(\d+)$/i.exec(extension);
	if (mechanicalLayer) return `Mechanical ${mechanicalLayer[1]}`;
	if (extension === 'gd1') return 'Drill drawing';
	if (extension === 'gg1') return 'Drill guide';
	if (extension === 'apr') return 'Aperture report';
	return fileStem(name);
}

export function normalizeGerberLines(text: string) {
	return text
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}

function parseApertureDimension(value: string, unit: GerberUnit) {
	const parsed = Number.parseFloat(value);
	if (!Number.isFinite(parsed)) return 0;
	return unit === 'inch' ? parsed * 25.4 : parsed;
}

function apertureFallback(code: number): GerberAperture {
	return { code, shape: 'circle', width: 0.15, height: 0.15 };
}

function parseApertureDefinition(line: string, unit: GerberUnit): GerberAperture | null {
	const match = /^%ADD(\d+)([A-Z]+),?([^*%]*)\*%$/i.exec(line);
	if (!match) return null;

	const code = Number.parseInt(match[1], 10);
	const shapeCode = match[2].toUpperCase();
	const dimensions = match[3]
		.split(/[Xx]/)
		.map((dimension) => parseApertureDimension(dimension, unit))
		.filter((dimension) => dimension > 0);

	if (shapeCode === 'C') {
		const diameter = dimensions[0] ?? 0.15;
		return { code, shape: 'circle', width: diameter, height: diameter };
	}
	if (shapeCode === 'R') {
		return {
			code,
			shape: 'rectangle',
			width: dimensions[0] ?? 0.15,
			height: dimensions[1] ?? dimensions[0] ?? 0.15
		};
	}
	if (shapeCode === 'O') {
		return {
			code,
			shape: 'obround',
			width: dimensions[0] ?? 0.15,
			height: dimensions[1] ?? dimensions[0] ?? 0.15
		};
	}

	return {
		code,
		shape: 'unknown',
		width: dimensions[0] ?? 0.15,
		height: dimensions[1] ?? dimensions[0] ?? 0.15
	};
}

function parseCoordinate(
	value: string,
	integerDigits: number,
	decimalDigits: number,
	unit: GerberUnit
) {
	const parsedWithDecimal = value.includes('.') ? Number.parseFloat(value) : null;
	if (parsedWithDecimal !== null && Number.isFinite(parsedWithDecimal)) {
		return unit === 'inch' ? parsedWithDecimal * 25.4 : parsedWithDecimal;
	}

	const sign = value.startsWith('-') ? -1 : 1;
	const unsigned = value.replace(/^[-+]/, '');
	const padded = unsigned.padStart(integerDigits + decimalDigits, '0');
	const splitAt = Math.max(0, padded.length - decimalDigits);
	const whole = padded.slice(0, splitAt) || '0';
	const fractional = padded.slice(splitAt).padEnd(decimalDigits, '0');
	const parsed = Number.parseFloat(`${whole}.${fractional}`);
	if (!Number.isFinite(parsed)) return null;
	const coordinate = parsed * sign;
	return unit === 'inch' ? coordinate * 25.4 : coordinate;
}

function updateBounds(bounds: GerberBounds | null, point: GerberPoint, margin = 0): GerberBounds {
	const minX = point.x - margin;
	const minY = point.y - margin;
	const maxX = point.x + margin;
	const maxY = point.y + margin;
	if (!bounds) return { minX, minY, maxX, maxY };
	return {
		minX: Math.min(bounds.minX, minX),
		minY: Math.min(bounds.minY, minY),
		maxX: Math.max(bounds.maxX, maxX),
		maxY: Math.max(bounds.maxY, maxY)
	};
}

function parseCoordinateCommand(line: string) {
	const tokens = line.match(/[A-Z][-+]?\d+(?:\.\d+)?/gi) ?? [];
	const command: { x?: string; y?: string; i?: string; j?: string; d?: number; g?: number } = {};
	for (const token of tokens) {
		const prefix = token[0].toUpperCase();
		const value = token.slice(1);
		if (prefix === 'X') command.x = value;
		else if (prefix === 'Y') command.y = value;
		else if (prefix === 'I') command.i = value;
		else if (prefix === 'J') command.j = value;
		else if (prefix === 'D') command.d = Number.parseInt(value, 10);
		else if (prefix === 'G') command.g = Number.parseInt(value, 10);
	}
	return command;
}

function normalizeAngle(angle: number) {
	const fullCircle = Math.PI * 2;
	let normalized = angle % fullCircle;
	if (normalized < 0) normalized += fullCircle;
	return normalized;
}

function arcSweep(startAngle: number, endAngle: number, clockwise: boolean) {
	const fullCircle = Math.PI * 2;
	const start = normalizeAngle(startAngle);
	const end = normalizeAngle(endAngle);
	if (Math.abs(start - end) < 1e-9) return fullCircle;
	if (clockwise) return start >= end ? start - end : start + fullCircle - end;
	return end >= start ? end - start : end + fullCircle - start;
}

function approximateArcPoints(
	from: GerberPoint,
	to: GerberPoint,
	center: GerberPoint,
	clockwise: boolean
) {
	const radius = Math.hypot(from.x - center.x, from.y - center.y);
	if (radius <= 0) return [];
	const startAngle = Math.atan2(from.y - center.y, from.x - center.x);
	const endAngle = Math.atan2(to.y - center.y, to.x - center.x);
	const sweep = arcSweep(startAngle, endAngle, clockwise);
	const segmentCount = Math.max(4, Math.min(96, Math.ceil(sweep / (Math.PI / 18))));
	const direction = clockwise ? -1 : 1;
	const points: GerberPoint[] = [];
	for (let index = 1; index <= segmentCount; index += 1) {
		const angle = startAngle + (direction * (sweep * index)) / segmentCount;
		points.push({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
	}
	points[points.length - 1] = to;
	return points;
}

export function parseGerberGeometry(text: string): GerberGeometry {
	const lines = normalizeGerberLines(text);
	const apertures = new Map<number, GerberAperture>();
	const primitives: GerberPrimitive[] = [];
	let unit: GerberUnit = 'mm';
	let xIntegerDigits = 2;
	let xDecimalDigits = 4;
	let yIntegerDigits = 2;
	let yDecimalDigits = 4;
	let position: GerberPoint = { x: 0, y: 0 };
	let selectedAperture: GerberAperture | null = null;
	let currentOperation: 1 | 2 | 3 = 2;
	let interpolationMode: 1 | 2 | 3 = 1;
	let bounds: GerberBounds | null = null;
	let unsupportedCount = 0;

	for (const line of lines) {
		const unitMatch = /^%MO(IN|MM)\*%$/i.exec(line);
		if (unitMatch) {
			unit = unitMatch[1].toUpperCase() === 'IN' ? 'inch' : 'mm';
			continue;
		}

		const formatMatch = /^%FS[LT]?A?X(\d)(\d)Y(\d)(\d)\*%$/i.exec(line);
		if (formatMatch) {
			xIntegerDigits = Number.parseInt(formatMatch[1], 10);
			xDecimalDigits = Number.parseInt(formatMatch[2], 10);
			yIntegerDigits = Number.parseInt(formatMatch[3], 10);
			yDecimalDigits = Number.parseInt(formatMatch[4], 10);
			continue;
		}

		const apertureDefinition = parseApertureDefinition(line, unit);
		if (apertureDefinition) {
			apertures.set(apertureDefinition.code, apertureDefinition);
			continue;
		}

		const command = parseCoordinateCommand(line);
		if (command.g === 1 || command.g === 2 || command.g === 3) interpolationMode = command.g;
		if (
			command.d !== undefined &&
			command.d >= 10 &&
			command.x === undefined &&
			command.y === undefined
		) {
			selectedAperture = apertures.get(command.d) ?? apertureFallback(command.d);
			continue;
		}

		const nextPoint =
			command.x !== undefined || command.y !== undefined
				? {
						x:
							command.x !== undefined
								? (parseCoordinate(command.x, xIntegerDigits, xDecimalDigits, unit) ?? position.x)
								: position.x,
						y:
							command.y !== undefined
								? (parseCoordinate(command.y, yIntegerDigits, yDecimalDigits, unit) ?? position.y)
								: position.y
					}
				: null;

		if (!nextPoint) continue;
		const operation: 1 | 2 | 3 =
			command.d === 1 || command.d === 2 || command.d === 3
				? (command.d as 1 | 2 | 3)
				: currentOperation;
		if (operation === 1) {
			const aperture = selectedAperture ?? apertureFallback(0);
			if (interpolationMode === 2 || interpolationMode === 3) {
				const centerOffset = {
					x:
						command.i !== undefined
							? (parseCoordinate(command.i, xIntegerDigits, xDecimalDigits, unit) ?? 0)
							: 0,
					y:
						command.j !== undefined
							? (parseCoordinate(command.j, yIntegerDigits, yDecimalDigits, unit) ?? 0)
							: 0
				};
				const center = { x: position.x + centerOffset.x, y: position.y + centerOffset.y };
				const arcPoints = approximateArcPoints(
					position,
					nextPoint,
					center,
					interpolationMode === 2
				);
				if (arcPoints.length === 0) {
					unsupportedCount += 1;
				} else {
					let segmentStart = position;
					for (const segmentEnd of arcPoints) {
						primitives.push({
							type: 'draw',
							from: segmentStart,
							to: segmentEnd,
							width: aperture.width,
							apertureCode: selectedAperture?.code ?? null
						});
						bounds = updateBounds(
							updateBounds(bounds, segmentStart, aperture.width / 2),
							segmentEnd,
							aperture.width / 2
						);
						segmentStart = segmentEnd;
					}
				}
			} else {
				primitives.push({
					type: 'draw',
					from: position,
					to: nextPoint,
					width: aperture.width,
					apertureCode: selectedAperture?.code ?? null
				});
				bounds = updateBounds(
					updateBounds(bounds, position, aperture.width / 2),
					nextPoint,
					aperture.width / 2
				);
			}
		} else if (operation === 3) {
			const aperture = selectedAperture ?? apertureFallback(0);
			primitives.push({
				type: 'flash',
				at: nextPoint,
				width: aperture.width,
				height: aperture.height,
				shape: aperture.shape,
				apertureCode: selectedAperture?.code ?? null
			});
			bounds = updateBounds(bounds, nextPoint, Math.max(aperture.width, aperture.height) / 2);
		}

		position = nextPoint;
		currentOperation = operation;
	}

	return { primitives, bounds, unit, unsupportedCount };
}

function countLineDiff(before: string[], after: string[]) {
	const afterByLine = new Map<string, number>();
	for (const line of after) afterByLine.set(line, (afterByLine.get(line) ?? 0) + 1);

	let unchanged = 0;
	let removed = 0;
	for (const line of before) {
		const remaining = afterByLine.get(line) ?? 0;
		if (remaining > 0) {
			unchanged += 1;
			afterByLine.set(line, remaining - 1);
		} else {
			removed += 1;
		}
	}

	let added = 0;
	for (const count of afterByLine.values()) added += count;
	return { unchanged, added, removed };
}

export function compareGerberFiles(before: GerberFile[], after: GerberFile[]): GerberDiffSummary {
	const beforeByLayer = new Map(before.map((file) => [gerberLayerKey(file.name), file]));
	const afterByLayer = new Map(after.map((file) => [gerberLayerKey(file.name), file]));
	const keys = Array.from(new Set([...beforeByLayer.keys(), ...afterByLayer.keys()])).sort();
	const layers = keys.map((key): GerberLayerDiff => {
		const beforeFile = beforeByLayer.get(key) ?? null;
		const afterFile = afterByLayer.get(key) ?? null;
		const label = gerberLayerLabel(afterFile?.name ?? beforeFile?.name ?? key);
		if (!beforeFile) {
			const added = normalizeGerberLines(afterFile?.text ?? '').length;
			return {
				key,
				label,
				before: null,
				after: afterFile,
				status: 'added',
				counts: { unchanged: 0, added, removed: 0 }
			};
		}
		if (!afterFile) {
			const removed = normalizeGerberLines(beforeFile.text).length;
			return {
				key,
				label,
				before: beforeFile,
				after: null,
				status: 'removed',
				counts: { unchanged: 0, added: 0, removed }
			};
		}
		const counts = countLineDiff(
			normalizeGerberLines(beforeFile.text),
			normalizeGerberLines(afterFile.text)
		);
		const status = counts.added === 0 && counts.removed === 0 ? 'unchanged' : 'modified';
		return { key, label, before: beforeFile, after: afterFile, status, counts };
	});

	return {
		layers,
		counts: {
			unchanged: layers.filter((layer) => layer.status === 'unchanged').length,
			added: layers.filter((layer) => layer.status === 'added').length,
			removed: layers.filter((layer) => layer.status === 'removed').length,
			modified: layers.filter((layer) => layer.status === 'modified').length
		},
		lineCounts: layers.reduce(
			(total, layer) => ({
				unchanged: total.unchanged + layer.counts.unchanged,
				added: total.added + layer.counts.added,
				removed: total.removed + layer.counts.removed
			}),
			{ unchanged: 0, added: 0, removed: 0 }
		)
	};
}
