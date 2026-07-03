export type ReviewSnapshot = {
	dataUrl: string;
	view: string;
	capturedAt: string;
};

export type ReviewSession = {
	format: 'altium-diff-review';
	version: 2;
	projectKey: string;
	generatedAt: string;
	reviewed: string[];
	notes: Record<string, string>;
	snapshots: Record<string, ReviewSnapshot>;
};

export function createReviewSession(
	projectKey: string,
	reviewed: Iterable<string>,
	notes: Record<string, string>,
	snapshots: Record<string, ReviewSnapshot> = {}
): ReviewSession {
	return {
		format: 'altium-diff-review',
		version: 2,
		projectKey,
		generatedAt: new Date().toISOString(),
		reviewed: Array.from(reviewed),
		notes,
		snapshots
	};
}

export function parseReviewSession(
	text: string,
	expectedProjectKey: string,
	validKeys: ReadonlySet<string>
) {
	const session = JSON.parse(text) as Partial<ReviewSession> & { version?: number };
	if (session.format !== 'altium-diff-review' || (session.version !== 1 && session.version !== 2))
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
	const snapshots: Record<string, ReviewSnapshot> = {};
	if (session.version === 2 && session.snapshots && typeof session.snapshots === 'object') {
		for (const [key, snapshot] of Object.entries(session.snapshots)) {
			if (
				validKeys.has(key) &&
				snapshot &&
				typeof snapshot === 'object' &&
				typeof snapshot.dataUrl === 'string' &&
				/^data:image\/(?:jpeg|png|webp);base64,/i.test(snapshot.dataUrl) &&
				typeof snapshot.view === 'string' &&
				typeof snapshot.capturedAt === 'string'
			)
				snapshots[key] = snapshot;
		}
	}
	return { reviewed, notes, snapshots };
}
