type ParseRequest = {
	id: number;
	text: string;
};

type ParseResponse = { id: number; value: unknown } | { id: number; error: string };

self.onmessage = (event: MessageEvent<ParseRequest>) => {
	const { id, text } = event.data;
	let response: ParseResponse;
	try {
		response = { id, value: JSON.parse(text) as unknown };
	} catch (error) {
		response = {
			id,
			error: error instanceof Error ? error.message : 'Invalid JSON.'
		};
	}
	self.postMessage(response);
};
