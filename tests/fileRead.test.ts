import assert from 'node:assert/strict';
import test from 'node:test';
import { readBlobBufferInChunks, readBlobTextInChunks } from '../src/lib/domain/fileRead.ts';

test('reads blob text in chunks and reports byte progress', async () => {
	const progress: Array<[number, number]> = [];
	const text = await readBlobTextInChunks(new Blob(['abcdef']), {
		chunkSize: 2,
		onProgress: (loaded, total) => progress.push([loaded, total])
	});

	assert.equal(text, 'abcdef');
	assert.deepEqual(progress, [
		[2, 6],
		[4, 6],
		[6, 6]
	]);
});

test('keeps multibyte text intact across chunk boundaries', async () => {
	const text = await readBlobTextInChunks(new Blob(['résistance']), { chunkSize: 3 });

	assert.equal(text, 'résistance');
});

test('cancels chunked text reads between chunks', async () => {
	let progressCalls = 0;

	await assert.rejects(
		readBlobTextInChunks(new Blob(['abcdef']), {
			chunkSize: 2,
			isCanceled: () => progressCalls > 0,
			onProgress: () => {
				progressCalls += 1;
			}
		}),
		/File read canceled/
	);
});

test('reads blob buffers in chunks', async () => {
	const buffer = await readBlobBufferInChunks(new Blob([new Uint8Array([1, 2, 3, 4, 5])]), {
		chunkSize: 2
	});

	assert.deepEqual(Array.from(new Uint8Array(buffer)), [1, 2, 3, 4, 5]);
});
