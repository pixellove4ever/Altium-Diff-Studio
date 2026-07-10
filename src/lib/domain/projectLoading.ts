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

function projectFrom(files: ProjectDocumentFile[]) {
	const project = emptyProject();
	for (const file of files) project[file.doc.type] = file.doc as never;
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
