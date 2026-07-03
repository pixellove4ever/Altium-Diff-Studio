<script lang="ts">
	import BaseCanvas, {
		type CanvasClick,
		type DrawContext
	} from '$lib/components/BaseCanvas.svelte';

	type Pair = { code: number; value: string };
	type Point = { x: number; y: number };
	type Matrix = [number, number, number, number, number, number];
	type Entity = {
		type: string;
		values: Pair[];
	};
	type Block = { name: string; base: Point; entities: Entity[] };
	type Primitive =
		| { type: 'line'; points: Point[]; closed?: boolean }
		| { type: 'circle'; center: Point; radius: number }
		| { type: 'arc'; center: Point; radius: number; start: number; end: number }
		| { type: 'text'; point: Point; text: string; height: number; rotation: number };
	type TextPrimitive = Extract<Primitive, { type: 'text' }>;
	type TextHitRegion = {
		primitive: TextPrimitive;
		origin: Point;
		width: number;
		minY: number;
		maxY: number;
		angle: number;
	};

	let {
		text,
		name,
		focusText = null,
		onTextClick,
		resolveTextTooltip,
		comparisonText,
		synced = false,
		syncZoom = $bindable(1),
		syncPanX = $bindable(0),
		syncPanY = $bindable(0)
	}: {
		text: string;
		name: string;
		focusText?: string | null;
		onTextClick?: (text: string) => void;
		resolveTextTooltip?: (text: string) => string | null;
		comparisonText?: string;
		synced?: boolean;
		syncZoom?: number;
		syncPanX?: number;
		syncPanY?: number;
	} = $props();

	const identity: Matrix = [1, 0, 0, 1, 0, 0];
	let hitRegions: TextHitRegion[] = [];
	const drawing = $derived.by(() => parseDxf(text));
	const comparisonPrimitives = $derived.by(() =>
		comparisonText ? parseDxf(comparisonText).primitives : []
	);
	const bounds = $derived(getBounds([...drawing.primitives, ...comparisonPrimitives]));
	const focusedPrimitives = $derived.by(() => {
		const target = normalizeText(focusText);
		if (!target) return [];
		const textPrimitives = drawing.primitives.filter(
			(primitive): primitive is TextPrimitive => primitive.type === 'text'
		);
		const exact = textPrimitives.filter((primitive) => normalizeText(primitive.text) === target);
		if (exact.length > 0) return exact;
		const prefix = textPrimitives.find((primitive) =>
			normalizeText(primitive.text).startsWith(target)
		);
		return prefix ? [prefix] : [];
	});
	const focusedPrimitive = $derived(focusedPrimitives[0] ?? null);

	function numberValue(values: Pair[], code: number, fallback = 0) {
		const pair = values.find((item) => item.code === code);
		const value = pair ? Number(pair.value) : fallback;
		return Number.isFinite(value) ? value : fallback;
	}

	function stringValue(values: Pair[], code: number, fallback = '') {
		return values.find((item) => item.code === code)?.value ?? fallback;
	}

	function points(values: Pair[]) {
		const result: Point[] = [];
		let current: Point | null = null;
		for (const pair of values) {
			if (pair.code === 10) {
				current = { x: Number(pair.value) || 0, y: 0 };
				result.push(current);
			} else if (pair.code === 20 && current) {
				current.y = Number(pair.value) || 0;
			}
		}
		return result;
	}

	function multiply(left: Matrix, right: Matrix): Matrix {
		return [
			left[0] * right[0] + left[2] * right[1],
			left[1] * right[0] + left[3] * right[1],
			left[0] * right[2] + left[2] * right[3],
			left[1] * right[2] + left[3] * right[3],
			left[0] * right[4] + left[2] * right[5] + left[4],
			left[1] * right[4] + left[3] * right[5] + left[5]
		];
	}

	function transform(point: Point, matrix: Matrix): Point {
		return {
			x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
			y: matrix[1] * point.x + matrix[3] * point.y + matrix[5]
		};
	}

	function entityMatrix(entity: Entity, block: Block): Matrix {
		const x = numberValue(entity.values, 10);
		const y = numberValue(entity.values, 20);
		const scaleX = numberValue(entity.values, 41, 1);
		const scaleY = numberValue(entity.values, 42, 1);
		const angle = (numberValue(entity.values, 50) * Math.PI) / 180;
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		return [
			cos * scaleX,
			sin * scaleX,
			-sin * scaleY,
			cos * scaleY,
			x - block.base.x * cos * scaleX + block.base.y * sin * scaleY,
			y - block.base.x * sin * scaleX - block.base.y * cos * scaleY
		];
	}

	function parsePairs(source: string): Pair[] {
		const lines = source.replace(/\r/g, '').split('\n');
		const result: Pair[] = [];
		for (let index = 0; index + 1 < lines.length; index += 2) {
			const code = Number(lines[index].trim());
			if (Number.isFinite(code)) result.push({ code, value: lines[index + 1].trimEnd() });
		}
		return result;
	}

	function collectEntities(pairs: Pair[], start: number, stop: Set<string>) {
		const entities: Entity[] = [];
		let index = start;
		while (index < pairs.length) {
			if (pairs[index].code === 0 && stop.has(pairs[index].value.toUpperCase())) break;
			if (pairs[index].code !== 0) {
				index += 1;
				continue;
			}
			const type = pairs[index].value.toUpperCase();
			const values: Pair[] = [];
			index += 1;
			while (index < pairs.length && pairs[index].code !== 0) {
				values.push(pairs[index]);
				index += 1;
			}
			entities.push({ type, values });
		}
		return { entities, index };
	}

	function parseDxf(source: string) {
		const pairs = parsePairs(source);
		const blocks = new Map<string, Block>();
		let entities: Entity[] = [];

		for (let index = 0; index < pairs.length; index += 1) {
			if (pairs[index].code !== 0 || pairs[index].value.toUpperCase() !== 'SECTION') continue;
			const sectionName = pairs[index + 1]?.code === 2 ? pairs[index + 1].value.toUpperCase() : '';
			index += 2;
			if (sectionName === 'ENTITIES') {
				const parsed = collectEntities(pairs, index, new Set(['ENDSEC']));
				entities = parsed.entities;
				index = parsed.index;
			} else if (sectionName === 'BLOCKS') {
				while (
					index < pairs.length &&
					!(pairs[index].code === 0 && pairs[index].value === 'ENDSEC')
				) {
					if (pairs[index].code !== 0 || pairs[index].value !== 'BLOCK') {
						index += 1;
						continue;
					}
					const header: Pair[] = [];
					index += 1;
					while (index < pairs.length && pairs[index].code !== 0) header.push(pairs[index++]);
					const parsed = collectEntities(pairs, index, new Set(['ENDBLK']));
					const block: Block = {
						name: stringValue(header, 2),
						base: { x: numberValue(header, 10), y: numberValue(header, 20) },
						entities: parsed.entities
					};
					if (block.name) blocks.set(block.name.toUpperCase(), block);
					index = parsed.index + 1;
				}
			}
		}

		const primitives: Primitive[] = [];
		flattenEntities(entities, blocks, identity, primitives, 0);
		return { primitives, blockCount: blocks.size };
	}

	function normalizeText(value: string | null | undefined) {
		return (value ?? '').replace(/\s+/g, '').toUpperCase();
	}

	function flattenEntities(
		entities: Entity[],
		blocks: Map<string, Block>,
		matrix: Matrix,
		output: Primitive[],
		depth: number
	) {
		if (depth > 12) return;
		for (let index = 0; index < entities.length; index += 1) {
			const entity = entities[index];
			if (entity.type === 'INSERT') {
				const block = blocks.get(stringValue(entity.values, 2).toUpperCase());
				if (block)
					flattenEntities(
						block.entities,
						blocks,
						multiply(matrix, entityMatrix(entity, block)),
						output,
						depth + 1
					);
				continue;
			}
			if (entity.type === 'POLYLINE') {
				const vertices: Point[] = [];
				while (entities[index + 1]?.type === 'VERTEX') {
					index += 1;
					vertices.push({
						x: numberValue(entities[index].values, 10),
						y: numberValue(entities[index].values, 20)
					});
				}
				if (vertices.length > 1) {
					output.push({
						type: 'line',
						points: vertices.map((point) => transform(point, matrix)),
						closed: (numberValue(entity.values, 70) & 1) === 1
					});
				}
				continue;
			}
			if (entity.type === 'LINE') {
				output.push({
					type: 'line',
					points: [
						transform(
							{ x: numberValue(entity.values, 10), y: numberValue(entity.values, 20) },
							matrix
						),
						transform(
							{ x: numberValue(entity.values, 11), y: numberValue(entity.values, 21) },
							matrix
						)
					]
				});
			} else if (['LWPOLYLINE', 'SPLINE', 'SOLID', 'TRACE', '3DFACE'].includes(entity.type)) {
				const vertices = points(entity.values).map((point) => transform(point, matrix));
				if (vertices.length > 1) {
					output.push({
						type: 'line',
						points: vertices,
						closed:
							entity.type !== 'SPLINE' &&
							((numberValue(entity.values, 70) & 1) === 1 || entity.type !== 'LWPOLYLINE')
					});
				}
			} else if (entity.type === 'CIRCLE') {
				const center = transform(
					{ x: numberValue(entity.values, 10), y: numberValue(entity.values, 20) },
					matrix
				);
				const edge = transform(
					{
						x: numberValue(entity.values, 10) + numberValue(entity.values, 40),
						y: numberValue(entity.values, 20)
					},
					matrix
				);
				output.push({
					type: 'circle',
					center,
					radius: Math.hypot(edge.x - center.x, edge.y - center.y)
				});
			} else if (entity.type === 'ARC') {
				const center = transform(
					{ x: numberValue(entity.values, 10), y: numberValue(entity.values, 20) },
					matrix
				);
				const edge = transform(
					{
						x: numberValue(entity.values, 10) + numberValue(entity.values, 40),
						y: numberValue(entity.values, 20)
					},
					matrix
				);
				output.push({
					type: 'arc',
					center,
					radius: Math.hypot(edge.x - center.x, edge.y - center.y),
					start: (numberValue(entity.values, 50) * Math.PI) / 180,
					end: (numberValue(entity.values, 51) * Math.PI) / 180
				});
			} else if (entity.type === 'TEXT' || entity.type === 'MTEXT' || entity.type === 'ATTRIB') {
				const content = entity.values
					.filter((pair) => pair.code === 1 || pair.code === 3)
					.map((pair) => pair.value)
					.join('')
					.replace(/\\P/g, '\n')
					.replace(/\\[A-Za-z][^;]*;/g, '');
				if (content) {
					output.push({
						type: 'text',
						point: transform(
							{ x: numberValue(entity.values, 10), y: numberValue(entity.values, 20) },
							matrix
						),
						text: content,
						height: Math.max(1, numberValue(entity.values, 40, 10)),
						rotation: numberValue(entity.values, 50)
					});
				}
			}
		}
	}

	function getBounds(primitives: Primitive[]) {
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		const include = (point: Point) => {
			minX = Math.min(minX, point.x);
			minY = Math.min(minY, point.y);
			maxX = Math.max(maxX, point.x);
			maxY = Math.max(maxY, point.y);
		};
		for (const primitive of primitives) {
			if (primitive.type === 'line') primitive.points.forEach(include);
			else if (primitive.type === 'text') include(primitive.point);
			else {
				include({
					x: primitive.center.x - primitive.radius,
					y: primitive.center.y - primitive.radius
				});
				include({
					x: primitive.center.x + primitive.radius,
					y: primitive.center.y + primitive.radius
				});
			}
		}
		if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
		return { minX, minY, maxX, maxY };
	}

	function draw({ ctx, width, height }: DrawContext) {
		const sourceWidth = Math.max(1, bounds.maxX - bounds.minX);
		const sourceHeight = Math.max(1, bounds.maxY - bounds.minY);
		const scale = Math.min((width - 56) / sourceWidth, (height - 56) / sourceHeight);
		const offsetX = (width - sourceWidth * scale) / 2;
		const offsetY = (height - sourceHeight * scale) / 2;
		const map = (point: Point): Point => ({
			x: offsetX + (point.x - bounds.minX) * scale,
			y: offsetY + (bounds.maxY - point.y) * scale
		});

		ctx.lineWidth = Math.max(0.65, Math.min(1.4, scale * 0.8));
		ctx.strokeStyle = '#24364f';
		ctx.fillStyle = '#24364f';
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		hitRegions = [];

		for (const primitive of drawing.primitives) {
			if (primitive.type === 'line') {
				if (primitive.points.length < 2) continue;
				ctx.beginPath();
				const first = map(primitive.points[0]);
				ctx.moveTo(first.x, first.y);
				for (const point of primitive.points.slice(1)) {
					const mapped = map(point);
					ctx.lineTo(mapped.x, mapped.y);
				}
				if (primitive.closed) ctx.closePath();
				ctx.stroke();
			} else if (primitive.type === 'circle') {
				const center = map(primitive.center);
				ctx.beginPath();
				ctx.arc(center.x, center.y, primitive.radius * scale, 0, Math.PI * 2);
				ctx.stroke();
			} else if (primitive.type === 'arc') {
				const center = map(primitive.center);
				ctx.beginPath();
				ctx.arc(center.x, center.y, primitive.radius * scale, -primitive.end, -primitive.start);
				ctx.stroke();
			} else {
				const point = map(primitive.point);
				const isFocused = focusedPrimitives.includes(primitive);
				ctx.save();
				ctx.translate(point.x, point.y);
				ctx.rotate((-primitive.rotation * Math.PI) / 180);
				const fontSize = Math.max(5, Math.min(28, primitive.height * scale));
				ctx.font = `${isFocused ? 700 : 400} ${fontSize}px Arial, sans-serif`;
				ctx.textBaseline = 'bottom';
				const lines = primitive.text.split('\n');
				const lineSpacing = Math.max(7, primitive.height * scale * 1.15);
				const textWidth = Math.max(...lines.map((line) => ctx.measureText(line).width), fontSize);
				hitRegions.push({
					primitive,
					origin: point,
					width: textWidth + 10,
					minY: -fontSize - 5,
					maxY: Math.max(5, (lines.length - 1) * lineSpacing + 5),
					angle: (-primitive.rotation * Math.PI) / 180
				});
				if (isFocused) {
					ctx.fillStyle = 'rgba(245, 158, 11, 0.26)';
					ctx.strokeStyle = '#f59e0b';
					ctx.lineWidth = 2;
					ctx.fillRect(-5, -fontSize - 5, textWidth + 10, fontSize + 10);
					ctx.strokeRect(-5, -fontSize - 5, textWidth + 10, fontSize + 10);
					ctx.fillStyle = '#9a3412';
				}
				for (const [lineIndex, line] of lines.entries()) {
					ctx.fillText(line, 0, lineIndex * lineSpacing);
				}
				ctx.restore();
			}
		}
	}

	function hitTest(event: CanvasClick) {
		const point = {
			x: (event.x - event.panX) / event.zoom,
			y: (event.y - event.panY) / event.zoom
		};
		for (let index = hitRegions.length - 1; index >= 0; index -= 1) {
			const region = hitRegions[index];
			const dx = point.x - region.origin.x;
			const dy = point.y - region.origin.y;
			const cos = Math.cos(region.angle);
			const sin = Math.sin(region.angle);
			const localX = dx * cos + dy * sin;
			const localY = -dx * sin + dy * cos;
			if (
				localX >= -5 &&
				localX <= region.width &&
				localY >= region.minY &&
				localY <= region.maxY
			) {
				return region.primitive;
			}
		}
		return null;
	}

	function onCanvasClick(event: CanvasClick) {
		const primitive = hitTest(event);
		if (primitive) onTextClick?.(primitive.text);
	}

	function resolveTooltip(event: CanvasClick) {
		const primitive = hitTest(event);
		return primitive ? (resolveTextTooltip?.(primitive.text) ?? null) : null;
	}

	function resolveFocus(width: number, height: number) {
		if (!focusedPrimitive) return null;
		const sourceWidth = Math.max(1, bounds.maxX - bounds.minX);
		const sourceHeight = Math.max(1, bounds.maxY - bounds.minY);
		const scale = Math.min((width - 56) / sourceWidth, (height - 56) / sourceHeight);
		const offsetX = (width - sourceWidth * scale) / 2;
		const offsetY = (height - sourceHeight * scale) / 2;
		return {
			x: offsetX + (focusedPrimitive.point.x - bounds.minX) * scale,
			y: offsetY + (bounds.maxY - focusedPrimitive.point.y) * scale,
			zoom: 3.5
		};
	}
</script>

<div class="viewer">
	<BaseCanvas
		background="#fbfcff"
		{draw}
		focusKey={focusText}
		{resolveFocus}
		{onCanvasClick}
		{resolveTooltip}
		{synced}
		bind:syncZoom
		bind:syncPanX
		bind:syncPanY
	/>
	<div class="status">
		<strong>{name}</strong>
		<span>{drawing.primitives.length} primitives · {drawing.blockCount} blocks</span>
	</div>
</div>

<style>
	.viewer {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 520px;
		overflow: hidden;
	}

	.status {
		position: absolute;
		top: 14px;
		left: 14px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		border: 1px solid #d9e0eb;
		border-radius: 7px;
		background: rgba(255, 255, 255, 0.9);
		box-shadow: 0 4px 16px rgba(31, 41, 55, 0.08);
		color: #344054;
		padding: 8px 10px;
		pointer-events: none;
	}

	.status span {
		color: #667085;
		font-size: 0.74rem;
	}
</style>
