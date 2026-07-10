import type { AltiumDoc, AltiumProjectSet } from '../types/altium.ts';

export type ProjectSide = 'A' | 'B';

export type ProjectDocumentFile = {
	doc: AltiumDoc;
};

export type ProjectLoadingState<T extends ProjectDocumentFile> = {
	filesA: T[];
	filesB: T[];
	projectA: AltiumProjectSet;
	projectB: AltiumProjectSet;
};

const emptyProject = (): AltiumProjectSet => ({
	bom: null,
	pcb: null,
	schematic: null
});

function typesOf(files: ProjectDocumentFile[]) {
	return Array.from(new Set(files.map((file) => file.doc.type)));
}

function pcbDocumentScore(file: ProjectDocumentFile) {
	if (file.doc.type !== 'pcb') return 0;
	const pcb = file.doc;
	const fileName = pcb.fileName.toLowerCase();
	const nettedTracks = pcb.tracks.filter((track) => track.net?.trim()).length;
	const nettedPads = pcb.pads.filter((pad) => pad.net?.trim()).length;
	const nets = pcb.nets?.length ?? 0;
	const panelPenalty = fileName.includes('panel') ? 1_000_000 : 0;
	return (
		pcb.components.length * 10_000 +
		pcb.pads.length * 100 +
		pcb.vias.length * 200 +
		(pcb.polygons?.length ?? 0) * 40 +
		nettedPads * 50 +
		nettedTracks * 20 +
		nets * 25 -
		panelPenalty
	);
}

function preferredDocument(files: ProjectDocumentFile[], type: AltiumDoc['type']) {
	const candidates = files.filter((file) => file.doc.type === type);
	if (candidates.length === 0) return null;
	if (type !== 'pcb') return candidates[candidates.length - 1].doc;
	return candidates.reduce((best, candidate) =>
		pcbDocumentScore(candidate) > pcbDocumentScore(best) ? candidate : best
	).doc;
}

function projectFrom(files: ProjectDocumentFile[]) {
	const project = emptyProject();
	for (const type of typesOf(files)) project[type] = preferredDocument(files, type) as never;
	return project;
}

export function exporterIdentity(doc: AltiumDoc) {
	const meta = doc.exportMeta;
	if (!meta?.scriptName && !meta?.scriptVersion) return null;
	return [meta.scriptName || 'unknown-script', meta.scriptVersion || 'unknown-version'].join('|');
}

export function exporterCompatibilityWarning(files: ProjectDocumentFile[]) {
	const identities = new Set(
		files
			.map((file) => exporterIdentity(file.doc))
			.filter((identity): identity is string => !!identity)
	);
	const hasUnknownExporter = files.some((file) => !exporterIdentity(file.doc));

	if (identities.size > 1) {
		return 'Les fichiers JSON ne semblent pas provenir de la même version de l’exporteur .pas.';
	}
	if (hasUnknownExporter) {
		return "Impossible de confirmer que tous les fichiers viennent du même .pas : au moins un JSON n'a pas de métadonnée exporter.";
	}
	return null;
}

export function applyProjectFiles<T extends ProjectDocumentFile>(
	state: ProjectLoadingState<T>,
	side: ProjectSide,
	files: T[]
): { state: ProjectLoadingState<T>; error: string | null } {
	const otherFiles = side === 'A' ? state.filesB : state.filesA;
	const newTypes = typesOf(files);
	const otherTypes = typesOf(otherFiles);
	if (
		newTypes.length > 0 &&
		otherTypes.length > 0 &&
		!newTypes.some((type) => otherTypes.includes(type))
	) {
		return {
			state,
			error: `Types incompatibles : impossible de comparer ${newTypes.join(', ').toUpperCase()} en version ${side} avec ${otherTypes.join(', ').toUpperCase()} dans l'autre version. Chargez au moins un même type de fichier des deux côtés.`
		};
	}

	const project = projectFrom(files);
	return {
		state:
			side === 'A'
				? { ...state, filesA: files, projectA: project }
				: { ...state, filesB: files, projectB: project },
		error: null
	};
}
