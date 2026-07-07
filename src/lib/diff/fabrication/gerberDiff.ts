export type GerberFile = {
	name: string;
	size: number;
	path?: string;
	text: string;
};

export type GerberDiffStatus = 'unchanged' | 'added' | 'removed' | 'modified';

export type GerberLayerDiff = {
	key: string;
	label: string;
	before: GerberFile | null;
	after: GerberFile | null;
	status: GerberDiffStatus;
	counts: {
		unchanged: number;
		added: number;
		removed: number;
	};
};

export type GerberDiffSummary = {
	layers: GerberLayerDiff[];
	counts: Record<GerberDiffStatus, number>;
	lineCounts: {
		unchanged: number;
		added: number;
		removed: number;
	};
};

const GERBER_EXTENSIONS = new Set([
	'gbr',
	'ger',
	'pho',
	'art',
	'gtl',
	'gbl',
	'gts',
	'gbs',
	'gtp',
	'gbp',
	'gto',
	'gbo',
	'gm1',
	'gm2',
	'gko',
	'gml',
	'g1',
	'g2',
	'g3',
	'drl',
	'xln'
]);

const GERBER_LAYER_NAMES: Record<string, string> = {
	gtl: 'Top copper',
	gbl: 'Bottom copper',
	gts: 'Top solder mask',
	gbs: 'Bottom solder mask',
	gtp: 'Top paste',
	gbp: 'Bottom paste',
	gto: 'Top overlay',
	gbo: 'Bottom overlay',
	gm1: 'Mechanical 1',
	gm2: 'Mechanical 2',
	gko: 'Board outline',
	gml: 'Mechanical',
	drl: 'Drill',
	xln: 'Drill'
};

export function isGerberFileName(name: string) {
	const extension = name.split('.').pop()?.toLowerCase() ?? '';
	return GERBER_EXTENSIONS.has(extension);
}

function fileStem(name: string) {
	return name.replace(/\.[^.]+$/, '');
}

export function gerberLayerKey(name: string) {
	const extension = name.split('.').pop()?.toLowerCase() ?? '';
	if (GERBER_LAYER_NAMES[extension]) return extension;
	return fileStem(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function gerberLayerLabel(name: string) {
	const extension = name.split('.').pop()?.toLowerCase() ?? '';
	return GERBER_LAYER_NAMES[extension] ?? fileStem(name);
}

export function normalizeGerberLines(text: string) {
	return text
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}

function countLineDiff(before: string[], after: string[]) {
	const afterByLine = new Map<string, number>();
	for (const line of after) afterByLine.set(line, (afterByLine.get(line) ?? 0) + 1);

	let unchanged = 0;
	let removed = 0;
	for (const line of before) {
		const remaining = afterByLine.get(line) ?? 0;
		if (remaining > 0) {
			unchanged += 1;
			afterByLine.set(line, remaining - 1);
		} else {
			removed += 1;
		}
	}

	let added = 0;
	for (const count of afterByLine.values()) added += count;
	return { unchanged, added, removed };
}

export function compareGerberFiles(before: GerberFile[], after: GerberFile[]): GerberDiffSummary {
	const beforeByLayer = new Map(before.map((file) => [gerberLayerKey(file.name), file]));
	const afterByLayer = new Map(after.map((file) => [gerberLayerKey(file.name), file]));
	const keys = Array.from(new Set([...beforeByLayer.keys(), ...afterByLayer.keys()])).sort();
	const layers = keys.map((key): GerberLayerDiff => {
		const beforeFile = beforeByLayer.get(key) ?? null;
		const afterFile = afterByLayer.get(key) ?? null;
		const label = gerberLayerLabel(afterFile?.name ?? beforeFile?.name ?? key);
		if (!beforeFile) {
			const added = normalizeGerberLines(afterFile?.text ?? '').length;
			return {
				key,
				label,
				before: null,
				after: afterFile,
				status: 'added',
				counts: { unchanged: 0, added, removed: 0 }
			};
		}
		if (!afterFile) {
			const removed = normalizeGerberLines(beforeFile.text).length;
			return {
				key,
				label,
				before: beforeFile,
				after: null,
				status: 'removed',
				counts: { unchanged: 0, added: 0, removed }
			};
		}
		const counts = countLineDiff(
			normalizeGerberLines(beforeFile.text),
			normalizeGerberLines(afterFile.text)
		);
		const status = counts.added === 0 && counts.removed === 0 ? 'unchanged' : 'modified';
		return { key, label, before: beforeFile, after: afterFile, status, counts };
	});

	return {
		layers,
		counts: {
			unchanged: layers.filter((layer) => layer.status === 'unchanged').length,
			added: layers.filter((layer) => layer.status === 'added').length,
			removed: layers.filter((layer) => layer.status === 'removed').length,
			modified: layers.filter((layer) => layer.status === 'modified').length
		},
		lineCounts: layers.reduce(
			(total, layer) => ({
				unchanged: total.unchanged + layer.counts.unchanged,
				added: total.added + layer.counts.added,
				removed: total.removed + layer.counts.removed
			}),
			{ unchanged: 0, added: 0, removed: 0 }
		)
	};
}
