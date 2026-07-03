export type DxfPoint = { x: number; y: number };

export type DxfPrimitive =
	| { type: 'line'; points: DxfPoint[]; closed?: boolean }
	| { type: 'circle'; center: DxfPoint; radius: number }
	| { type: 'arc'; center: DxfPoint; radius: number; start: number; end: number }
	| {
			type: 'text';
			point: DxfPoint;
			text: string;
			height: number;
			rotation: number;
	  };

export type DxfDiffStatus = 'unchanged' | 'added' | 'removed' | 'modified';

export type DxfPrimitiveDiff = {
	before: DxfDiffStatus[];
	after: DxfDiffStatus[];
	counts: { unchanged: number; added: number; removed: number; modified: number };
};

function rounded(value: number) {
	return Math.round(value * 100) / 100;
}

function pointKey(point: DxfPoint) {
	return `${rounded(point.x)},${rounded(point.y)}`;
}

function minimalRotation(values: string[]) {
	if (values.length < 2) return values.join(';');
	let best = values.join(';');
	for (let offset = 1; offset < values.length; offset += 1) {
		const candidate = [...values.slice(offset), ...values.slice(0, offset)].join(';');
		if (candidate < best) best = candidate;
	}
	return best;
}

function lineKey(primitive: Extract<DxfPrimitive, { type: 'line' }>) {
	const points = primitive.points.map(pointKey);
	if (primitive.closed) {
		const forward = minimalRotation(points);
		const reverse = minimalRotation([...points].reverse());
		return `line:closed:${forward < reverse ? forward : reverse}`;
	}
	const forward = points.join(';');
	const reverse = [...points].reverse().join(';');
	return `line:open:${forward < reverse ? forward : reverse}`;
}

export function dxfPrimitiveKey(primitive: DxfPrimitive) {
	if (primitive.type === 'line') return lineKey(primitive);
	if (primitive.type === 'circle')
		return `circle:${pointKey(primitive.center)}:${rounded(primitive.radius)}`;
	if (primitive.type === 'arc')
		return `arc:${pointKey(primitive.center)}:${rounded(primitive.radius)}:${rounded(primitive.start)}:${rounded(primitive.end)}`;
	return `text:${pointKey(primitive.point)}:${rounded(primitive.height)}:${rounded(((primitive.rotation % 360) + 360) % 360)}:${primitive.text.replace(/\s+/g, ' ').trim()}`;
}

function modificationKey(primitive: DxfPrimitive) {
	if (primitive.type === 'line') return null;
	const point = primitive.type === 'text' ? primitive.point : primitive.center;
	const location = `${Math.round(point.x * 10)},${Math.round(point.y * 10)}`;
	if (primitive.type === 'text')
		return `text:${location}:${rounded(((primitive.rotation % 360) + 360) % 360)}`;
	return `${primitive.type}:${location}`;
}

export function compareDxfPrimitives(
	before: DxfPrimitive[],
	after: DxfPrimitive[]
): DxfPrimitiveDiff {
	const afterByKey = new Map<string, number[]>();
	after.forEach((primitive, index) => {
		const key = dxfPrimitiveKey(primitive);
		const indices = afterByKey.get(key);
		if (indices) indices.push(index);
		else afterByKey.set(key, [index]);
	});

	const beforeStatuses: DxfDiffStatus[] = before.map(() => 'removed');
	const afterStatuses: DxfDiffStatus[] = after.map(() => 'added');
	for (const [beforeIndex, primitive] of before.entries()) {
		const matches = afterByKey.get(dxfPrimitiveKey(primitive));
		const afterIndex = matches?.shift();
		if (afterIndex === undefined) continue;
		beforeStatuses[beforeIndex] = 'unchanged';
		afterStatuses[afterIndex] = 'unchanged';
	}

	const modifiedAfterByKey = new Map<string, number[]>();
	for (const [afterIndex, primitive] of after.entries()) {
		if (afterStatuses[afterIndex] !== 'added') continue;
		const key = modificationKey(primitive);
		if (!key) continue;
		const indices = modifiedAfterByKey.get(key);
		if (indices) indices.push(afterIndex);
		else modifiedAfterByKey.set(key, [afterIndex]);
	}
	for (const [beforeIndex, primitive] of before.entries()) {
		if (beforeStatuses[beforeIndex] !== 'removed') continue;
		const key = modificationKey(primitive);
		if (!key) continue;
		const bestIndex = modifiedAfterByKey.get(key)?.shift();
		if (bestIndex === undefined) continue;
		beforeStatuses[beforeIndex] = 'modified';
		afterStatuses[bestIndex] = 'modified';
	}

	return {
		before: beforeStatuses,
		after: afterStatuses,
		counts: {
			unchanged: beforeStatuses.filter((status) => status === 'unchanged').length,
			added: afterStatuses.filter((status) => status === 'added').length,
			removed: beforeStatuses.filter((status) => status === 'removed').length,
			modified: beforeStatuses.filter((status) => status === 'modified').length
		}
	};
}
