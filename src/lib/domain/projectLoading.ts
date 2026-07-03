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
