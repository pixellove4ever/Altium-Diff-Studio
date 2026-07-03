import JsonParserWorker from './jsonParser.worker?worker';

type ParseResponse = { id: number; value: unknown } | { id: number; error: string };

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (reason: Error) => void;
};

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();

function rejectPending(message: string) {
	for (const request of pending.values()) request.reject(new Error(message));
	pending.clear();
}

function getWorker() {
	if (worker) return worker;
	worker = new JsonParserWorker();
	worker.onmessage = (event: MessageEvent<ParseResponse>) => {
		const request = pending.get(event.data.id);
		if (!request) return;
		pending.delete(event.data.id);
		if ('error' in event.data) request.reject(new Error(event.data.error));
		else request.resolve(event.data.value);
	};
	worker.onerror = (event) => {
		rejectPending(event.message || 'The JSON parser worker stopped unexpectedly.');
		worker?.terminate();
		worker = null;
	};
	return worker;
}

export function parseJsonOffThread(text: string): Promise<unknown> {
	if (typeof Worker === 'undefined') return Promise.resolve(JSON.parse(text) as unknown);

	const id = nextRequestId++;
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject });
		getWorker().postMessage({ id, text });
	});
}

export function cancelJsonParsing(message = 'JSON parsing canceled.') {
	rejectPending(message);
	worker?.terminate();
	worker = null;
}
