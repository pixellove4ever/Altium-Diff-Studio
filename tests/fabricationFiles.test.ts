import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import {
	formatFileSize,
	isOdbPackageFileName,
	listTarEntries,
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
		'job/steps/pcb/layers/drill/features',
		'job/steps/pcb/eda/data',
		'job/steps/pcb/netlists/cadnet/netlist'
	]);

	assert.deepEqual(summary.steps, ['pcb']);
	assert.deepEqual(summary.layers, ['bottom', 'drill', 'top']);
	assert.deepEqual(summary.drillLayers, ['drill']);
	assert.equal(summary.hasPlacements, true);
	assert.equal(summary.hasNets, true);
	assert.equal(summary.hasComponents, false);
	assert.equal(summary.unsupportedCompression, false);
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

test('lists ODB++ paths from an uncompressed tar archive', () => {
	const payload = new Uint8Array([1, 2, 3]);
	const archive = tarArchive([{ name: 'job/steps/pcb/layers/top/features', payload }]);

	assert.deepEqual(listTarEntries(archive.buffer), ['job/steps/pcb/layers/top/features']);
});

test('summarizes ODB++ paths from a gzip-compressed tar archive', async () => {
	const archive = tarArchive([
		{ name: 'job/steps/pcb/layers/top/features' },
		{ name: 'job/steps/pcb/layers/bottom/features' },
		{ name: 'job/steps/pcb/netlists/cadnet/netlist' }
	]);
	const summary = await summarizeOdbArchive(
		'board.odb.tgz',
		bufferToArrayBuffer(gzipSync(archive))
	);

	assert.deepEqual(summary.layers, ['bottom', 'top']);
	assert.equal(summary.hasNets, true);
	assert.equal(summary.unsupportedCompression, false);
});
