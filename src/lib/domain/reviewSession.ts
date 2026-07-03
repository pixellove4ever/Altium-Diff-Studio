export type ReviewSnapshot = {
	dataUrl: string;
	view: string;
	capturedAt: string;
};

export type ReviewSession = {
	format: 'altium-diff-review';
	version: 3;
	projectKey: string;
	generatedAt: string;
	author: string;
	modifiedAt: string;
	reviewed: string[];
	notes: Record<string, string>;
	snapshots: Record<string, ReviewSnapshot>;
};

export function createReviewSession(
	projectKey: string,
	reviewed: Iterable<string>,
	notes: Record<string, string>,
	snapshots: Record<string, ReviewSnapshot> = {},
	metadata: { author?: string; modifiedAt?: string } = {}
): ReviewSession {
	const generatedAt = new Date().toISOString();
	return {
		format: 'altium-diff-review',
		version: 3,
		projectKey,
		generatedAt,
		author: metadata.author?.trim() ?? '',
		modifiedAt: metadata.modifiedAt ?? generatedAt,
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
	const session = JSON.parse(text) as Omit<Partial<ReviewSession>, 'version'> & {
		version?: number;
	};
	if (
		session.format !== 'altium-diff-review' ||
		(session.version !== 1 && session.version !== 2 && session.version !== 3)
	)
		throw new Error('Unsupported review session format.');
	if (session.projectKey !== expectedProjectKey)
		throw new Error('This review session belongs to a different project pair.');

	const ignored = { reviewed: [] as string[], notes: [] as string[], snapshots: [] as string[] };
	const reviewed: string[] = [];
	if (Array.isArray(session.reviewed)) {
		for (const key of session.reviewed) {
			if (typeof key === 'string' && validKeys.has(key)) reviewed.push(key);
			else ignored.reviewed.push(typeof key === 'string' ? key : JSON.stringify(key));
		}
	}
	const notes: Record<string, string> = {};
	if (session.notes && typeof session.notes === 'object') {
		for (const [key, note] of Object.entries(session.notes)) {
			if (validKeys.has(key) && typeof note === 'string') notes[key] = note;
			else ignored.notes.push(key);
		}
	}
	const snapshots: Record<string, ReviewSnapshot> = {};
	if (
		(session.version === 2 || session.version === 3) &&
		session.snapshots &&
		typeof session.snapshots === 'object'
	) {
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
			else ignored.snapshots.push(key);
		}
	}
	return {
		reviewed,
		notes,
		snapshots,
		author: session.version === 3 && typeof session.author === 'string' ? session.author : '',
		modifiedAt:
			session.version === 3 && typeof session.modifiedAt === 'string'
				? session.modifiedAt
				: typeof session.generatedAt === 'string'
					? session.generatedAt
					: '',
		migratedFrom: session.version < 3 ? session.version : null,
		ignored
	};
}
