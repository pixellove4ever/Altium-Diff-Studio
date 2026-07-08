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
	layerFeatureCounts: Record<string, number>;
	components: string[];
	nets: string[];
	placementCount: number;
	parsedTextEntryCount: number;
	hasComponents: boolean;
	hasPlacements: boolean;
	hasNets: boolean;
	unsupportedCompression: boolean;
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

export function summarizeOdbEntries(
	entries: string[],
	contents: Map<string, string> = new Map()
): OdbPackageSummary {
	const normalized = entries.map(normalizeEntryPath).filter(Boolean);
	const steps = new Set<string>();
	const layers = new Set<string>();
	const drillLayers = new Set<string>();
	const components = new Set<string>();
	const nets = new Set<string>();
	const layerFeatureCounts: Record<string, number> = {};
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
			if (layerName.includes('drill') || layerName.includes('rout')) drillLayers.add(layerName);
		}

		if (parts.includes('components') || parts.includes('comps')) hasComponents = true;
		if (parts.includes('eda') || parts.includes('placements') || parts.includes('comp_+_top'))
			hasPlacements = true;
		if (parts.includes('nets') || entry.endsWith('/netlists/cadnet/netlist')) hasNets = true;

		const text = contents.get(entry);
		if (!text) continue;
		parsedTextEntryCount += 1;

		if (layerIndex >= 0 && parts[layerIndex + 1] && parts.at(-1) === 'features') {
			layerFeatureCounts[parts[layerIndex + 1]] = countFeatureLines(text);
		}

		if (parts.includes('eda') || parts.includes('components') || parts.includes('placements')) {
			for (const component of extractNamedValues(text, ['CMP', 'COMP', 'COMPONENT', 'REFDES'])) {
				components.add(component);
			}
		}

		if (parts.includes('nets') || entry.endsWith('/netlists/cadnet/netlist')) {
			for (const net of extractNamedValues(text, ['NET', 'NET_NAME'])) nets.add(net);
		}
	}

	const placementCount = components.size;
	hasComponents = hasComponents || components.size > 0;
	hasPlacements = hasPlacements || placementCount > 0;
	hasNets = hasNets || nets.size > 0;

	return {
		entryCount: normalized.length,
		steps: uniqueSorted(steps),
		layers: uniqueSorted(layers),
		drillLayers: uniqueSorted(drillLayers),
		layerFeatureCounts,
		components: uniqueSorted(components),
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

async function decompressDeflateRaw(data: Uint8Array) {
	if (typeof DecompressionStream === 'undefined') return null;
	try {
		const input = new Uint8Array(data).buffer;
		const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
		return new Uint8Array(await new Response(stream).arrayBuffer());
	} catch {
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
	maxTextBytes = 512 * 1024
): Promise<ZipArchiveEntry[]> {
	const entries: ZipArchiveEntry[] = [];
	for (const entry of readZipDirectory(buffer)) {
		const archiveEntry: ZipArchiveEntry = {
			name: entry.name,
			size: entry.size,
			compressionMethod: entry.compressionMethod
		};
		const payload = await readZipPayload(buffer, entry, maxTextBytes);
		if (payload) archiveEntry.text = decodeAscii(payload);
		entries.push(archiveEntry);
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

async function summarizeZipArchive(buffer: ArrayBuffer) {
	const entries = await readZipEntries(buffer);
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
	buffer: ArrayBuffer
): Promise<OdbPackageSummary> {
	const lower = name.toLowerCase();
	if (lower.endsWith('.zip') || lower.endsWith('.odb') || lower.endsWith('.odb++')) {
		return await summarizeZipArchive(buffer);
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
