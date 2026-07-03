export type ReviewSession = {
	format: 'altium-diff-review';
	version: 1;
	projectKey: string;
	generatedAt: string;
	reviewed: string[];
	notes: Record<string, string>;
};

export function createReviewSession(
	projectKey: string,
	reviewed: Iterable<string>,
	notes: Record<string, string>
): ReviewSession {
	return {
		format: 'altium-diff-review',
		version: 1,
		projectKey,
		generatedAt: new Date().toISOString(),
		reviewed: Array.from(reviewed),
		notes
	};
}

export function parseReviewSession(
	text: string,
	expectedProjectKey: string,
	validKeys: ReadonlySet<string>
) {
	const session = JSON.parse(text) as Partial<ReviewSession>;
	if (session.format !== 'altium-diff-review' || session.version !== 1)
		throw new Error('Unsupported review session format.');
	if (session.projectKey !== expectedProjectKey)
		throw new Error('This review session belongs to a different project pair.');

	const reviewed = Array.isArray(session.reviewed)
		? session.reviewed.filter((key): key is string => typeof key === 'string' && validKeys.has(key))
		: [];
	const notes: Record<string, string> = {};
	if (session.notes && typeof session.notes === 'object') {
		for (const [key, note] of Object.entries(session.notes)) {
			if (validKeys.has(key) && typeof note === 'string') notes[key] = note;
		}
	}
	return { reviewed, notes };
}
