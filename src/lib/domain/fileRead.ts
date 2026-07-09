export interface ChunkedBlobReadOptions {
	chunkSize?: number;
	encoding?: string;
	isCanceled?: () => boolean;
	onProgress?: (loadedBytes: number, totalBytes: number) => void;
}

const defaultChunkSize = 1024 * 1024;

function assertNotCanceled(isCanceled: ChunkedBlobReadOptions['isCanceled']) {
	if (isCanceled?.()) throw new Error('File read canceled.');
}

export async function readBlobTextInChunks(
	blob: Blob,
	options: ChunkedBlobReadOptions = {}
): Promise<string> {
	const chunkSize = Math.max(1, options.chunkSize ?? defaultChunkSize);
	const decoder = new TextDecoder(options.encoding ?? 'utf-8', { fatal: false });
	const chunks: string[] = [];

	for (let offset = 0; offset < blob.size; offset += chunkSize) {
		assertNotCanceled(options.isCanceled);
		const end = Math.min(offset + chunkSize, blob.size);
		const bytes = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
		chunks.push(decoder.decode(bytes, { stream: end < blob.size }));
		options.onProgress?.(end, blob.size);
	}
	assertNotCanceled(options.isCanceled);
	chunks.push(decoder.decode());
	if (blob.size === 0) options.onProgress?.(0, 0);

	return chunks.join('');
}

export async function readBlobBufferInChunks(
	blob: Blob,
	options: Omit<ChunkedBlobReadOptions, 'encoding'> = {}
): Promise<ArrayBuffer> {
	const chunkSize = Math.max(1, options.chunkSize ?? defaultChunkSize);
	const chunks: Uint8Array[] = [];
	let loadedBytes = 0;

	for (let offset = 0; offset < blob.size; offset += chunkSize) {
		assertNotCanceled(options.isCanceled);
		const end = Math.min(offset + chunkSize, blob.size);
		const chunk = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
		chunks.push(chunk);
		loadedBytes += chunk.byteLength;
		options.onProgress?.(loadedBytes, blob.size);
	}
	assertNotCanceled(options.isCanceled);
	if (blob.size === 0) options.onProgress?.(0, 0);

	const output = new Uint8Array(loadedBytes);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output.buffer;
}
