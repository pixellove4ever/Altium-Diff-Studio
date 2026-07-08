import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync, gzipSync } from 'node:zlib';
import {
	classifyOdbLayer,
	formatFileSize,
	isOdbPackageFileName,
	listTarEntries,
	listZipEntries,
	readTarEntries,
	readZipEntries,
	summarizeOdbArchive,
	summarizeOdbEntries
} from '../src/lib/domain/fabrication/files.ts';

test('detects common ODB++ package names', () => {
	assert.equal(isOdbPackageFileName('board.odb'), true);
	assert.equal(isOdbPackageFileName('board.odb++'), true);
	assert.equal(isOdbPackageFileName('board.odb.tgz'), true);
	assert.equal(isOdbPackageFileName('board.odb.tar.gz'), true);
	assert.equal(isOdbPackageFileName('fab-package.tgz'), true);
	assert.equal(isOdbPackageFileName('fab-package.zip'), true);
	assert.equal(isOdbPackageFileName('gerbers.txt'), false);
});

test('formats fabrication package sizes', () => {
	assert.equal(formatFileSize(42), '42 B');
	assert.equal(formatFileSize(2048), '2.0 KB');
	assert.equal(formatFileSize(2 * 1024 * 1024), '2.0 MB');
});

test('summarizes ODB++ layer, drill and net coverage from entry paths', () => {
	const summary = summarizeOdbEntries([
		'job/steps/pcb/layers/top/features',
		'job/steps/pcb/layers/bottom/features',
		'job/steps/pcb/layers/top_mask/features',
		'job/steps/pcb/layers/top_paste/features',
		'job/steps/pcb/layers/top_silk/features',
		'job/steps/pcb/layers/outline/features',
		'job/steps/pcb/layers/drill/features',
		'job/steps/pcb/eda/data',
		'job/steps/pcb/netlists/cadnet/netlist'
	]);

	assert.deepEqual(summary.steps, ['pcb']);
	assert.deepEqual(summary.layers, [
		'bottom',
		'drill',
		'outline',
		'top',
		'top_mask',
		'top_paste',
		'top_silk'
	]);
	assert.deepEqual(summary.drillLayers, ['drill']);
	assert.equal(summary.layerTypes.top, 'copper');
	assert.equal(summary.layerTypes.top_mask, 'mask');
	assert.equal(summary.layerTypes.top_paste, 'paste');
	assert.equal(summary.layerTypes.top_silk, 'silk');
	assert.equal(summary.layerTypes.outline, 'outline');
	assert.equal(summary.layerTypeCounts.copper, 2);
	assert.equal(summary.layerTypeCounts.drill, 1);
	assert.equal(summary.hasPlacements, true);
	assert.equal(summary.hasNets, true);
	assert.equal(summary.hasComponents, false);
	assert.equal(summary.parsedTextEntryCount, 0);
	assert.deepEqual(summary.layerFeatureCounts, {});
	assert.equal(summary.unsupportedCompression, false);
});

test('classifies common ODB++ fabrication layer names', () => {
	assert.equal(classifyOdbLayer('top'), 'copper');
	assert.equal(classifyOdbLayer('inner-2-gnd'), 'copper');
	assert.equal(classifyOdbLayer('bottom_solder_mask'), 'mask');
	assert.equal(classifyOdbLayer('top-paste'), 'paste');
	assert.equal(classifyOdbLayer('top_overlay'), 'silk');
	assert.equal(classifyOdbLayer('npth-drill'), 'drill');
	assert.equal(classifyOdbLayer('board-outline'), 'outline');
	assert.equal(classifyOdbLayer('fab-drawing'), 'document');
	assert.equal(classifyOdbLayer('courtyard-top'), 'mechanical');
	assert.equal(classifyOdbLayer('custom-layer'), 'unknown');
});

function tarHeader(name: string, size: number) {
	const header = new Uint8Array(512);
	const encoder = new TextEncoder();
	header.set(encoder.encode(name), 0);
	header.set(encoder.encode(size.toString(8).padStart(11, '0') + '\0'), 124);
	header[156] = '0'.charCodeAt(0);
	return header;
}

function tarArchive(entries: Array<{ name: string; payload?: Uint8Array }>) {
	const chunks: Uint8Array[] = [];
	for (const entry of entries) {
		const payload = entry.payload ?? new Uint8Array();
		const paddedSize = Math.ceil(payload.length / 512) * 512;
		const paddedPayload = new Uint8Array(paddedSize);
		paddedPayload.set(payload);
		chunks.push(tarHeader(entry.name, payload.length), paddedPayload);
	}
	chunks.push(new Uint8Array(1024));
	const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
	const archive = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		archive.set(chunk, offset);
		offset += chunk.length;
	}
	return archive;
}

function bufferToArrayBuffer(buffer: Buffer) {
	return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function writeUInt16(output: Uint8Array, offset: number, value: number) {
	output[offset] = value & 0xff;
	output[offset + 1] = (value >> 8) & 0xff;
}

function writeUInt32(output: Uint8Array, offset: number, value: number) {
	output[offset] = value & 0xff;
	output[offset + 1] = (value >> 8) & 0xff;
	output[offset + 2] = (value >> 16) & 0xff;
	output[offset + 3] = (value >> 24) & 0xff;
}

function zipArchive(
	entries: Array<{ name: string; payload: Uint8Array; compressionMethod?: 0 | 8 }>
) {
	const encoder = new TextEncoder();
	const localParts: Uint8Array[] = [];
	const centralParts: Uint8Array[] = [];
	let offset = 0;

	for (const entry of entries) {
		const name = encoder.encode(entry.name);
		const compressionMethod = entry.compressionMethod ?? 0;
		const compressedPayload =
			compressionMethod === 8 ? new Uint8Array(deflateRawSync(entry.payload)) : entry.payload;
		const local = new Uint8Array(30 + name.length + compressedPayload.length);
		writeUInt32(local, 0, 0x04034b50);
		writeUInt16(local, 4, 20);
		writeUInt16(local, 8, compressionMethod);
		writeUInt32(local, 18, compressedPayload.length);
		writeUInt32(local, 22, entry.payload.length);
		writeUInt16(local, 26, name.length);
		local.set(name, 30);
		local.set(compressedPayload, 30 + name.length);

		const central = new Uint8Array(46 + name.length);
		writeUInt32(central, 0, 0x02014b50);
		writeUInt16(central, 4, 20);
		writeUInt16(central, 6, 20);
		writeUInt16(central, 10, compressionMethod);
		writeUInt32(central, 20, compressedPayload.length);
		writeUInt32(central, 24, entry.payload.length);
		writeUInt16(central, 28, name.length);
		writeUInt32(central, 42, offset);
		central.set(name, 46);

		localParts.push(local);
		centralParts.push(central);
		offset += local.length;
	}

	const centralOffset = offset;
	const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
	const end = new Uint8Array(22);
	writeUInt32(end, 0, 0x06054b50);
	writeUInt16(end, 8, entries.length);
	writeUInt16(end, 10, entries.length);
	writeUInt32(end, 12, centralSize);
	writeUInt32(end, 16, centralOffset);

	const size = centralOffset + centralSize + end.length;
	const archive = new Uint8Array(size);
	let writeOffset = 0;
	for (const part of [...localParts, ...centralParts, end]) {
		archive.set(part, writeOffset);
		writeOffset += part.length;
	}
	return archive.buffer;
}

function storedZip(entries: Array<{ name: string; payload: Uint8Array }>) {
	return zipArchive(entries);
}

test('lists ODB++ paths from an uncompressed tar archive', () => {
	const payload = new Uint8Array([1, 2, 3]);
	const archive = tarArchive([{ name: 'job/steps/pcb/layers/top/features', payload }]);

	assert.deepEqual(listTarEntries(archive.buffer), ['job/steps/pcb/layers/top/features']);
	assert.deepEqual(readTarEntries(archive.buffer), [
		{ name: 'job/steps/pcb/layers/top/features', size: 3, text: '\u0001\u0002\u0003' }
	]);
});

test('summarizes ODB++ content from a gzip-compressed tar archive', async () => {
	const encoder = new TextEncoder();
	const archive = tarArchive([
		{
			name: 'job/steps/pcb/layers/top/features',
			payload: encoder.encode('P 1 2\nL 1 2 3 4\n# C\n')
		},
		{ name: 'job/steps/pcb/layers/bottom/features', payload: encoder.encode('S 0 0\n') },
		{ name: 'job/steps/pcb/eda/data', payload: encoder.encode('CMP R1\nCOMPONENT U2\n') },
		{ name: 'job/steps/pcb/netlists/cadnet/netlist', payload: encoder.encode('NET GND\n$1 VCC\n') }
	]);
	const summary = await summarizeOdbArchive(
		'board.odb.tgz',
		bufferToArrayBuffer(gzipSync(archive))
	);

	assert.deepEqual(summary.layers, ['bottom', 'top']);
	assert.deepEqual(summary.layerFeatureCounts, { bottom: 1, top: 2 });
	assert.deepEqual(summary.components, ['R1', 'U2']);
	assert.deepEqual(summary.nets, ['GND', 'VCC']);
	assert.equal(summary.placementCount, 2);
	assert.equal(summary.parsedTextEntryCount, 4);
	assert.equal(summary.hasComponents, true);
	assert.equal(summary.hasPlacements, true);
	assert.equal(summary.hasNets, true);
	assert.equal(summary.unsupportedCompression, false);
});

test('summarizes ODB++ content from a stored zip archive', async () => {
	const encoder = new TextEncoder();
	const archive = storedZip([
		{ name: 'job/steps/pcb/layers/top/features', payload: encoder.encode('P 1 2\nL 1 2 3 4\n') },
		{ name: 'job/steps/pcb/eda/data', payload: encoder.encode('CMP U3\n') },
		{ name: 'job/steps/pcb/netlists/cadnet/netlist', payload: encoder.encode('NET /RESET\n') }
	]);
	const entries = await readZipEntries(archive);
	const summary = await summarizeOdbArchive('board.odb.zip', archive);

	assert.deepEqual(listZipEntries(archive), [
		'job/steps/pcb/layers/top/features',
		'job/steps/pcb/eda/data',
		'job/steps/pcb/netlists/cadnet/netlist'
	]);
	assert.equal(entries[0].text, 'P 1 2\nL 1 2 3 4\n');
	assert.deepEqual(summary.layerFeatureCounts, { top: 2 });
	assert.deepEqual(summary.components, ['U3']);
	assert.deepEqual(summary.nets, ['/RESET']);
	assert.equal(summary.parsedTextEntryCount, 3);
});

test('summarizes ODB++ content from a deflated zip archive', async () => {
	const encoder = new TextEncoder();
	const archive = zipArchive([
		{
			name: 'job/steps/pcb/layers/bottom/features',
			payload: encoder.encode('P 2 3\nL 2 3 4 5\n'),
			compressionMethod: 8
		},
		{
			name: 'job/steps/pcb/netlists/cadnet/netlist',
			payload: encoder.encode('NET +3V3\n'),
			compressionMethod: 8
		}
	]);
	const entries = await readZipEntries(archive);
	const summary = await summarizeOdbArchive('board.odb.zip', archive);

	assert.equal(entries[0].compressionMethod, 8);
	assert.equal(entries[0].text, 'P 2 3\nL 2 3 4 5\n');
	assert.deepEqual(summary.layerFeatureCounts, { bottom: 2 });
	assert.deepEqual(summary.nets, ['+3V3']);
	assert.equal(summary.parsedTextEntryCount, 2);
});
