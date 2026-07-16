export interface OdbPackageFile {
	name: string;
	size: number;
	path?: string;
	summary?: OdbPackageSummary;
}

export interface OdbPackageSummary {
	entryCount: number;
	steps: string[];
	layers: string[];
	drillLayers: string[];
	layerTypes: Record<string, OdbLayerType>;
	layerTypeCounts: Record<OdbLayerType, number>;
	layerFeatureCounts: Record<string, number>;
	layerPrimitiveCounts: Record<string, OdbLayerPrimitiveCounts>;
	layerPreviews: Record<string, OdbLayerPreview>;
	components: string[];
	placements: OdbComponentPlacement[];
	nets: string[];
	placementCount: number;
	parsedTextEntryCount: number;
	hasComponents: boolean;
	hasPlacements: boolean;
	hasNets: boolean;
	unsupportedCompression: boolean;
}

export type OdbLayerType =
	| 'copper'
	| 'mask'
	| 'paste'
	| 'silk'
	| 'drill'
	| 'outline'
	| 'mechanical'
	| 'document'
	| 'unknown';

export interface OdbLayerPrimitiveCounts {
	pads: number;
	lines: number;
	arcs: number;
	surfaces: number;
	texts: number;
	other: number;
}

export interface OdbPoint {
	x: number;
	y: number;
}

export interface OdbBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export type OdbVisualPrimitiveKind =
	| 'pad'
	| 'track'
	| 'arc'
	| 'surface'
	| 'drill'
	| 'outline'
	| 'other';

export type OdbLayerVisualPrimitive =
	| { type: 'point'; kind: OdbVisualPrimitiveKind; at: OdbPoint }
	| { type: 'line'; kind: OdbVisualPrimitiveKind; from: OdbPoint; to: OdbPoint }
	| { type: 'polygon'; kind: OdbVisualPrimitiveKind; points: OdbPoint[] };

export interface OdbLayerPreview {
	primitives: OdbLayerVisualPrimitive[];
	bounds: OdbBounds | null;
	truncated: boolean;
}

export interface OdbComponentPlacement {
	designator: string;
	x?: number;
	y?: number;
	rotation?: number;
	side?: 'top' | 'bottom' | 'unknown';
}

export interface TarArchiveEntry {
	name: string;
	size: number;
	text?: string;
}

export interface ZipArchiveEntry {
	name: string;
	size: number;
	compressionMethod: number;
	text?: string;
}

export interface OdbArchiveReadOptions {
	isCanceled?: () => boolean;
	onProgress?: (processedEntries: number, totalEntries: number) => void;
}

export function isOdbPackageFileName(name: string) {
	const lower = name.toLowerCase();
	return (
		lower.endsWith('.odb') ||
		lower.endsWith('.odb++') ||
		lower.endsWith('.odb.tgz') ||
		lower.endsWith('.odb.tar') ||
		lower.endsWith('.odb.tar.gz') ||
		lower.endsWith('.odb.zip') ||
		lower.endsWith('.tgz') ||
		lower.endsWith('.tar') ||
		lower.endsWith('.tar.gz') ||
		lower.endsWith('.zip')
	);
}

export function formatFileSize(size: number) {
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function uniqueSorted(values: Iterable<string>) {
	return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function emptyLayerTypeCounts(): Record<OdbLayerType, number> {
	return {
		copper: 0,
		mask: 0,
		paste: 0,
		silk: 0,
		drill: 0,
		outline: 0,
		mechanical: 0,
		document: 0,
		unknown: 0
	};
}

function emptyPrimitiveCounts(): OdbLayerPrimitiveCounts {
	return {
		pads: 0,
		lines: 0,
		arcs: 0,
		surfaces: 0,
		texts: 0,
		other: 0
	};
}

export function classifyOdbLayer(name: string): OdbLayerType {
	const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
	if (/(^|-)(drill|via|pth|npth|rout|route|slot)(-|$)/.test(normalized)) return 'drill';
	if (/(^|-)(outline|profile|border|edge|contour|dimension)(-|$)/.test(normalized))
		return 'outline';
	if (/(^|-)(mask|soldermask|solder-mask|sm)(-|$)/.test(normalized)) return 'mask';
	if (/(^|-)(paste|cream|solderpaste|solder-paste)(-|$)/.test(normalized)) return 'paste';
	if (/(^|-)(silk|silkscreen|legend|overlay|ss)(-|$)/.test(normalized)) return 'silk';
	if (/(^|-)(assembly|assy|fab|drawing|notes|document|doc)(-|$)/.test(normalized))
		return 'document';
	if (/(^|-)(mech|mechanical|keepout|courtyard)(-|$)/.test(normalized)) return 'mechanical';
	if (
		/(^|-)(top|bottom|bot|signal|plane|power|gnd|ground|inner|internal|l\d+|gtl|gbl)(-|$)/.test(
			normalized
		)
	)
		return 'copper';
	return 'unknown';
}

function normalizeEntryPath(entry: string) {
	return entry.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

function countFeatureLines(text: string) {
	return text
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => /^[A-Z]/i.test(line)).length;
}

function countFeaturePrimitives(text: string): OdbLayerPrimitiveCounts {
	const counts = emptyPrimitiveCounts();
	for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
		const code = line.trim().split(/\s+/, 1)[0]?.toUpperCase() ?? '';
		if (!code || code === '#' || code === '@' || code === '$') continue;
		if (code.startsWith('P')) counts.pads += 1;
		else if (code.startsWith('L')) counts.lines += 1;
		else if (code.startsWith('A')) counts.arcs += 1;
		else if (code === 'S' || code === 'OB' || code === 'OS' || code === 'OC') counts.surfaces += 1;
		else if (code.startsWith('T')) counts.texts += 1;
		else counts.other += 1;
	}
	return counts;
}

function extractNumbers(line: string) {
	return (line.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [])
		.map((value) => Number.parseFloat(value))
		.filter((value) => Number.isFinite(value));
}

function pointFromNumbers(numbers: number[], index = 0): OdbPoint | null {
	const x = numbers[index];
	const y = numbers[index + 1];
	return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function updateOdbBounds(bounds: OdbBounds | null, point: OdbPoint): OdbBounds {
	if (!bounds) return { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
	return {
		minX: Math.min(bounds.minX, point.x),
		minY: Math.min(bounds.minY, point.y),
		maxX: Math.max(bounds.maxX, point.x),
		maxY: Math.max(bounds.maxY, point.y)
	};
}

function includePrimitiveBounds(bounds: OdbBounds | null, primitive: OdbLayerVisualPrimitive) {
	if (primitive.type === 'point') return updateOdbBounds(bounds, primitive.at);
	if (primitive.type === 'line')
		return updateOdbBounds(updateOdbBounds(bounds, primitive.from), primitive.to);
	return primitive.points.reduce((current, point) => updateOdbBounds(current, point), bounds);
}

function primitiveKindForCode(code: string, layerType: OdbLayerType): OdbVisualPrimitiveKind {
	if (layerType === 'drill') return 'drill';
	if (layerType === 'outline') return 'outline';
	if (code === 'P') return 'pad';
	if (code === 'L') return 'track';
	if (code === 'A') return 'arc';
	if (code === 'OB' || code === 'OS' || code === 'OC' || code === 'S') return 'surface';
	return 'other';
}

function parseFeaturePreview(
	text: string,
	layerType: OdbLayerType = 'unknown',
	maxPrimitives = 6000
): OdbLayerPreview {
	const primitives: OdbLayerVisualPrimitive[] = [];
	let bounds: OdbBounds | null = null;
	let polygon: OdbPoint[] = [];
	let truncated = false;

	const addPrimitive = (primitive: OdbLayerVisualPrimitive) => {
		if (primitives.length >= maxPrimitives) {
			truncated = true;
			return;
		}
		primitives.push(primitive);
		bounds = includePrimitiveBounds(bounds, primitive);
	};
	const flushPolygon = () => {
		if (polygon.length >= 2)
			addPrimitive({
				type: 'polygon',
				kind: primitiveKindForCode('S', layerType),
				points: polygon
			});
		polygon = [];
	};

	for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#') || line.startsWith('$') || line.startsWith('@')) continue;
		const code = line.split(/\s+/, 1)[0]?.toUpperCase() ?? '';
		const numbers = extractNumbers(line);

		if (code === 'P') {
			flushPolygon();
			const at = pointFromNumbers(numbers);
			if (at) addPrimitive({ type: 'point', kind: primitiveKindForCode(code, layerType), at });
		} else if (code === 'L' || code === 'A') {
			flushPolygon();
			const from = pointFromNumbers(numbers);
			const to = pointFromNumbers(numbers, 2);
			if (from && to)
				addPrimitive({ type: 'line', kind: primitiveKindForCode(code, layerType), from, to });
		} else if (code === 'OB') {
			flushPolygon();
			const point = pointFromNumbers(numbers);
			if (point) polygon = [point];
		} else if (code === 'OS' || code === 'OC') {
			const point = pointFromNumbers(numbers);
			if (point) polygon.push(point);
		} else if (code === 'OE') {
			flushPolygon();
		}
	}
	flushPolygon();
	return { primitives, bounds, truncated };
}

function extractNamedValues(text: string, keywords: string[]) {
	const values = new Set<string>();
	const keywordPattern = keywords.join('|');
	const pattern = new RegExp(`^(?:${keywordPattern})\\s+["']?([^\\s"']+)`, 'i');
	for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
		const trimmed = line.trim();
		const keywordMatch = pattern.exec(trimmed);
		if (keywordMatch) values.add(keywordMatch[1]);

		const assignmentMatch = /\b(?:REFDES|NET_NAME|NET)\s*=\s*["']?([A-Za-z0-9_.+\-/]+)/i.exec(
			trimmed
		);
		if (assignmentMatch) values.add(assignmentMatch[1]);

		const indexedNameMatch = /^\$\d+\s+([A-Za-z0-9_.+\-/]+)\b/.exec(trimmed);
		if (indexedNameMatch) values.add(indexedNameMatch[1]);
	}
	return values;
}

function parseNumberValue(value: string | undefined) {
	if (!value) return undefined;
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizePlacementSide(
	value: string | undefined
): OdbComponentPlacement['side'] | undefined {
	if (!value) return undefined;
	const normalized = value.toLowerCase();
	if (normalized === 'top' || normalized === 't' || normalized === '1') return 'top';
	if (normalized === 'bottom' || normalized === 'bot' || normalized === 'b' || normalized === '2')
		return 'bottom';
	return 'unknown';
}

function extractAssignment(line: string, names: string[]) {
	const pattern = new RegExp(`\\b(?:${names.join('|')})\\s*=\\s*["']?([^\\s"']+)`, 'i');
	return pattern.exec(line)?.[1];
}

function extractComponentPlacements(text: string) {
	const placements = new Map<string, OdbComponentPlacement>();
	for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const keywordMatch = /^(?:CMP|COMP|COMPONENT|REFDES)\s+["']?([A-Za-z0-9_.+\-/]+)/i.exec(
			trimmed
		);
		const assignmentDesignator = extractAssignment(trimmed, [
			'REFDES',
			'DESIGNATOR',
			'COMP',
			'COMPONENT'
		]);
		const designator = keywordMatch?.[1] ?? assignmentDesignator;
		if (!designator) continue;

		const tokens = trimmed.split(/\s+/);
		const tokenNumbers = tokens
			.slice(keywordMatch ? 2 : 1)
			.map((token) => Number.parseFloat(token))
			.filter((value) => Number.isFinite(value));
		const sideMatch = /\b(?:SIDE|LAYER|MIRROR|COMP_SIDE)\s*=\s*["']?([A-Za-z0-9_+\-/]+)/i.exec(
			trimmed
		);
		const sideToken = tokens.find((token) => /^(top|bottom|bot|t|b)$/i.test(token));
		const x =
			parseNumberValue(extractAssignment(trimmed, ['X', 'X_POS', 'XPOS'])) ?? tokenNumbers[0];
		const y =
			parseNumberValue(extractAssignment(trimmed, ['Y', 'Y_POS', 'YPOS'])) ?? tokenNumbers[1];
		const rotation =
			parseNumberValue(extractAssignment(trimmed, ['ROT', 'ROTATION', 'ANGLE'])) ?? tokenNumbers[2];
		const side = normalizePlacementSide(sideMatch?.[1] ?? sideToken);
		const placement: OdbComponentPlacement = { designator };
		if (x !== undefined) placement.x = x;
		if (y !== undefined) placement.y = y;
		if (rotation !== undefined) placement.rotation = rotation;
		if (side !== undefined) placement.side = side;
		placements.set(designator.toUpperCase(), placement);
	}
	return placements;
}

export function summarizeOdbEntries(
	entries: string[],
	contents: Map<string, string> = new Map()
): OdbPackageSummary {
	const normalized = entries.map(normalizeEntryPath).filter(Boolean);
	const steps = new Set<string>();
	const layers = new Set<string>();
	const drillLayers = new Set<string>();
	const layerTypes: Record<string, OdbLayerType> = {};
	const components = new Set<string>();
	const placements = new Map<string, OdbComponentPlacement>();
	const nets = new Set<string>();
	const layerFeatureCounts: Record<string, number> = {};
	const layerPrimitiveCounts: Record<string, OdbLayerPrimitiveCounts> = {};
	const layerPreviews: Record<string, OdbLayerPreview> = {};
	let parsedTextEntryCount = 0;
	let hasComponents = false;
	let hasPlacements = false;
	let hasNets = false;

	for (const entry of normalized) {
		const parts = entry.split('/').filter(Boolean);
		const stepIndex = parts.indexOf('steps');
		if (stepIndex >= 0 && parts[stepIndex + 1]) steps.add(parts[stepIndex + 1]);

		const layerIndex = parts.indexOf('layers');
		if (layerIndex >= 0 && parts[layerIndex + 1]) {
			const layerName = parts[layerIndex + 1];
			layers.add(layerName);
			const layerType = classifyOdbLayer(layerName);
			layerTypes[layerName] = layerType;
			if (layerType === 'drill') drillLayers.add(layerName);
		}

		if (parts.includes('components') || parts.includes('comps')) hasComponents = true;
		if (parts.includes('eda') || parts.includes('placements') || parts.includes('comp_+_top'))
			hasPlacements = true;
		if (parts.includes('nets') || entry.endsWith('/netlists/cadnet/netlist')) hasNets = true;

		const text = contents.get(entry);
		if (!text) continue;
		parsedTextEntryCount += 1;

		if (layerIndex >= 0 && parts[layerIndex + 1] && parts.at(-1) === 'features') {
			const layerName = parts[layerIndex + 1];
			const layerType = layerTypes[layerName] ?? classifyOdbLayer(layerName);
			layerFeatureCounts[layerName] = countFeatureLines(text);
			layerPrimitiveCounts[layerName] = countFeaturePrimitives(text);
			layerPreviews[layerName] = parseFeaturePreview(text, layerType);
		}

		if (parts.includes('eda') || parts.includes('components') || parts.includes('placements')) {
			for (const component of extractNamedValues(text, ['CMP', 'COMP', 'COMPONENT', 'REFDES'])) {
				components.add(component);
			}
			for (const [key, placement] of extractComponentPlacements(text)) {
				placements.set(key, placement);
				components.add(placement.designator);
			}
		}

		if (parts.includes('nets') || entry.endsWith('/netlists/cadnet/netlist')) {
			for (const net of extractNamedValues(text, ['NET', 'NET_NAME'])) nets.add(net);
		}
	}

	const placementCount = placements.size;
	const layerTypeCounts = emptyLayerTypeCounts();
	for (const layer of layers) layerTypeCounts[layerTypes[layer] ?? 'unknown'] += 1;
	hasComponents = hasComponents || components.size > 0;
	hasPlacements = hasPlacements || placements.size > 0;
	hasNets = hasNets || nets.size > 0;

	return {
		entryCount: normalized.length,
		steps: uniqueSorted(steps),
		layers: uniqueSorted(layers),
		drillLayers: uniqueSorted(drillLayers),
		layerTypes,
		layerTypeCounts,
		layerFeatureCounts,
		layerPrimitiveCounts,
		layerPreviews,
		components: uniqueSorted(components),
		placements: Array.from(placements.values()).sort((a, b) =>
			a.designator.localeCompare(b.designator, undefined, { numeric: true })
		),
		nets: uniqueSorted(nets),
		placementCount,
		parsedTextEntryCount,
		hasComponents,
		hasPlacements,
		hasNets,
		unsupportedCompression: false
	};
}

function readUInt16(data: DataView, offset: number) {
	return data.getUint16(offset, true);
}

function readUInt32(data: DataView, offset: number) {
	return data.getUint32(offset, true);
}

function decodeAscii(bytes: Uint8Array) {
	return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function listZipEntries(buffer: ArrayBuffer): string[] {
	return readZipDirectory(buffer).map((entry) => entry.name);
}

interface ZipDirectoryEntry {
	name: string;
	size: number;
	compressedSize: number;
	compressionMethod: number;
	localHeaderOffset: number;
}

function readZipDirectory(buffer: ArrayBuffer): ZipDirectoryEntry[] {
	const bytes = new Uint8Array(buffer);
	const data = new DataView(buffer);
	const minEndOffset = Math.max(0, bytes.length - 65557);
	let endOffset = -1;
	for (let offset = bytes.length - 22; offset >= minEndOffset; offset -= 1) {
		if (readUInt32(data, offset) === 0x06054b50) {
			endOffset = offset;
			break;
		}
	}
	if (endOffset < 0) return [];

	const entryCount = readUInt16(data, endOffset + 10);
	let offset = readUInt32(data, endOffset + 16);
	const entries: ZipDirectoryEntry[] = [];
	for (let index = 0; index < entryCount && offset + 46 <= bytes.length; index += 1) {
		if (readUInt32(data, offset) !== 0x02014b50) break;
		const compressionMethod = readUInt16(data, offset + 10);
		const compressedSize = readUInt32(data, offset + 20);
		const size = readUInt32(data, offset + 24);
		const nameLength = readUInt16(data, offset + 28);
		const extraLength = readUInt16(data, offset + 30);
		const commentLength = readUInt16(data, offset + 32);
		const localHeaderOffset = readUInt32(data, offset + 42);
		const nameStart = offset + 46;
		const nameEnd = nameStart + nameLength;
		if (nameEnd > bytes.length) break;
		const name = decodeAscii(bytes.slice(nameStart, nameEnd));
		if (name && !name.endsWith('/')) {
			entries.push({ name, size, compressedSize, compressionMethod, localHeaderOffset });
		}
		offset = nameEnd + extraLength + commentLength;
	}
	return entries;
}

let deflateRawUnavailable = false;

function timeoutAfter<T>(durationMs: number, value: T) {
	return new Promise<T>((resolve) => globalThis.setTimeout(() => resolve(value), durationMs));
}

async function decompressDeflateRaw(data: Uint8Array, timeoutMs = 3000) {
	if (deflateRawUnavailable) return null;
	if (typeof DecompressionStream === 'undefined') return null;
	try {
		const input = new Uint8Array(data).buffer;
		const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
		const result = await Promise.race([
			new Response(stream).arrayBuffer(),
			timeoutAfter<ArrayBuffer | null>(timeoutMs, null)
		]);
		if (!result) {
			deflateRawUnavailable = true;
			return null;
		}
		return new Uint8Array(result);
	} catch {
		deflateRawUnavailable = true;
		return null;
	}
}

async function readZipPayload(buffer: ArrayBuffer, entry: ZipDirectoryEntry, maxTextBytes: number) {
	if (entry.size <= 0 || entry.size > maxTextBytes) return undefined;
	const bytes = new Uint8Array(buffer);
	const data = new DataView(buffer);
	const offset = entry.localHeaderOffset;
	if (offset + 30 > bytes.length || readUInt32(data, offset) !== 0x04034b50) return undefined;
	const nameLength = readUInt16(data, offset + 26);
	const extraLength = readUInt16(data, offset + 28);
	const payloadStart = offset + 30 + nameLength + extraLength;
	const payloadEnd = payloadStart + entry.compressedSize;
	if (payloadEnd > bytes.length) return undefined;
	const payload = bytes.slice(payloadStart, payloadEnd);
	if (entry.compressionMethod === 0) return payload;
	if (entry.compressionMethod === 8) return await decompressDeflateRaw(payload);
	return undefined;
}

export async function readZipEntries(
	buffer: ArrayBuffer,
	maxTextBytes = 512 * 1024,
	options: OdbArchiveReadOptions = {}
): Promise<ZipArchiveEntry[]> {
	const entries: ZipArchiveEntry[] = [];
	const directory = readZipDirectory(buffer);
	for (const [index, entry] of directory.entries()) {
		if (options.isCanceled?.()) throw new Error('File read canceled.');
		const archiveEntry: ZipArchiveEntry = {
			name: entry.name,
			size: entry.size,
			compressionMethod: entry.compressionMethod
		};
		const payload = await readZipPayload(buffer, entry, maxTextBytes);
		if (payload) archiveEntry.text = decodeAscii(payload);
		entries.push(archiveEntry);
		options.onProgress?.(index + 1, directory.length);
	}
	return entries;
}

export function listTarEntries(buffer: ArrayBuffer): string[] {
	return readTarEntries(buffer).map((entry) => entry.name);
}

export function readTarEntries(buffer: ArrayBuffer, maxTextBytes = 512 * 1024): TarArchiveEntry[] {
	const bytes = new Uint8Array(buffer);
	const entries: TarArchiveEntry[] = [];
	for (let offset = 0; offset + 512 <= bytes.length; ) {
		const header = bytes.slice(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;
		const name = decodeAscii(header.slice(0, 100)).replace(/\0.*$/, '');
		const prefix = decodeAscii(header.slice(345, 500)).replace(/\0.*$/, '');
		const sizeOctal = decodeAscii(header.slice(124, 136)).replace(/\0.*$/, '').trim();
		const size = Number.parseInt(sizeOctal || '0', 8);
		const entrySize = Number.isFinite(size) ? size : 0;
		if (name) {
			const fullName = prefix ? `${prefix}/${name}` : name;
			const payloadStart = offset + 512;
			const payloadEnd = payloadStart + entrySize;
			const entry: TarArchiveEntry = { name: fullName, size: entrySize };
			if (entrySize > 0 && entrySize <= maxTextBytes && payloadEnd <= bytes.length) {
				entry.text = decodeAscii(bytes.slice(payloadStart, payloadEnd));
			}
			entries.push(entry);
		}
		offset += 512 + Math.ceil(entrySize / 512) * 512;
	}
	return entries;
}

function summarizeTarArchive(buffer: ArrayBuffer) {
	const entries = readTarEntries(buffer);
	return summarizeOdbEntries(
		entries.map((entry) => entry.name),
		new Map(
			entries
				.filter((entry): entry is TarArchiveEntry & { text: string } => entry.text !== undefined)
				.map((entry) => [normalizeEntryPath(entry.name), entry.text])
		)
	);
}

async function summarizeZipArchive(buffer: ArrayBuffer, options: OdbArchiveReadOptions = {}) {
	const entries = await readZipEntries(buffer, 512 * 1024, options);
	return summarizeOdbEntries(
		entries.map((entry) => entry.name),
		new Map(
			entries
				.filter((entry): entry is ZipArchiveEntry & { text: string } => entry.text !== undefined)
				.map((entry) => [normalizeEntryPath(entry.name), entry.text])
		)
	);
}

async function decompressGzip(buffer: ArrayBuffer) {
	if (typeof DecompressionStream === 'undefined') return null;
	const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
	return await new Response(stream).arrayBuffer();
}

export async function summarizeOdbArchive(
	name: string,
	buffer: ArrayBuffer,
	options: OdbArchiveReadOptions = {}
): Promise<OdbPackageSummary> {
	const lower = name.toLowerCase();
	if (lower.endsWith('.zip') || lower.endsWith('.odb') || lower.endsWith('.odb++')) {
		return await summarizeZipArchive(buffer, options);
	}
	if (lower.endsWith('.tar') || lower.endsWith('.odb.tar')) {
		return summarizeTarArchive(buffer);
	}
	if (lower.endsWith('.tgz') || lower.endsWith('.tar.gz') || lower.endsWith('.odb.tgz')) {
		const decompressed = await decompressGzip(buffer);
		if (decompressed) return summarizeTarArchive(decompressed);
	}
	return { ...summarizeOdbEntries([]), unsupportedCompression: true };
}
