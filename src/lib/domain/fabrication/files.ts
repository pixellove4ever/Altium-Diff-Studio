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
	hasComponents: boolean;
	hasPlacements: boolean;
	hasNets: boolean;
	unsupportedCompression: boolean;
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

export function summarizeOdbEntries(entries: string[]): OdbPackageSummary {
	const normalized = entries
		.map((entry) => entry.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase())
		.filter(Boolean);
	const steps = new Set<string>();
	const layers = new Set<string>();
	const drillLayers = new Set<string>();
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
	}

	return {
		entryCount: normalized.length,
		steps: uniqueSorted(steps),
		layers: uniqueSorted(layers),
		drillLayers: uniqueSorted(drillLayers),
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
	const entries: string[] = [];
	for (let index = 0; index < entryCount && offset + 46 <= bytes.length; index += 1) {
		if (readUInt32(data, offset) !== 0x02014b50) break;
		const nameLength = readUInt16(data, offset + 28);
		const extraLength = readUInt16(data, offset + 30);
		const commentLength = readUInt16(data, offset + 32);
		const nameStart = offset + 46;
		const nameEnd = nameStart + nameLength;
		if (nameEnd > bytes.length) break;
		const name = decodeAscii(bytes.slice(nameStart, nameEnd));
		if (name && !name.endsWith('/')) entries.push(name);
		offset = nameEnd + extraLength + commentLength;
	}
	return entries;
}

export function listTarEntries(buffer: ArrayBuffer): string[] {
	const bytes = new Uint8Array(buffer);
	const entries: string[] = [];
	for (let offset = 0; offset + 512 <= bytes.length; ) {
		const header = bytes.slice(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;
		const name = decodeAscii(header.slice(0, 100)).replace(/\0.*$/, '');
		const prefix = decodeAscii(header.slice(345, 500)).replace(/\0.*$/, '');
		const sizeOctal = decodeAscii(header.slice(124, 136)).replace(/\0.*$/, '').trim();
		const size = Number.parseInt(sizeOctal || '0', 8);
		if (name) entries.push(prefix ? `${prefix}/${name}` : name);
		offset += 512 + Math.ceil((Number.isFinite(size) ? size : 0) / 512) * 512;
	}
	return entries;
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
		return summarizeOdbEntries(listZipEntries(buffer));
	}
	if (lower.endsWith('.tar') || lower.endsWith('.odb.tar')) {
		return summarizeOdbEntries(listTarEntries(buffer));
	}
	if (lower.endsWith('.tgz') || lower.endsWith('.tar.gz') || lower.endsWith('.odb.tgz')) {
		const decompressed = await decompressGzip(buffer);
		if (decompressed) return summarizeOdbEntries(listTarEntries(decompressed));
	}
	return { ...summarizeOdbEntries([]), unsupportedCompression: true };
}
