import { shouldShowBomItemInViewer } from './bomVisibility.ts';
import type { AltiumProjectSet } from '$lib/types/altium';

export interface ProjectConsistencyDiagnostic {
	file: string;
	message: string;
}

const naturalDesignatorSort = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function normalizedDesignator(value: string | undefined) {
	return value?.trim().toUpperCase() ?? '';
}

function formatDesignatorList(designators: string[]) {
	const shown = designators.slice(0, 12);
	const suffix =
		designators.length > shown.length ? `, +${designators.length - shown.length} more` : '';
	return `${shown.join(', ')}${suffix}`;
}

export function diagnoseProjectConsistency(
	project: AltiumProjectSet
): ProjectConsistencyDiagnostic[] {
	const diagnostics: ProjectConsistencyDiagnostic[] = [];
	if (!project.bom || !project.pcb) return diagnostics;

	const pcbDesignators = new Set(
		project.pcb.components
			.map((component) => normalizedDesignator(component.designator))
			.filter(Boolean)
	);
	const bomDesignators = new Set(
		project.bom.items
			.filter((item) => shouldShowBomItemInViewer(item))
			.map((item) => normalizedDesignator(item.designator))
			.filter(Boolean)
	);
	const bomDisplayByKey = new Map(
		project.bom.items
			.filter((item) => shouldShowBomItemInViewer(item))
			.map((item) => [normalizedDesignator(item.designator), item.designator.trim()])
	);
	const pcbDisplayByKey = new Map(
		project.pcb.components.map((component) => [
			normalizedDesignator(component.designator),
			component.designator.trim()
		])
	);

	const bomMissingOnPcb = Array.from(bomDesignators)
		.filter((designator) => !pcbDesignators.has(designator))
		.map((designator) => bomDisplayByKey.get(designator) ?? designator)
		.sort(naturalDesignatorSort.compare);
	if (bomMissingOnPcb.length > 0) {
		diagnostics.push({
			file: `${project.bom.fileName} / ${project.pcb.fileName}`,
			message: `${bomMissingOnPcb.length} fitted BOM component${bomMissingOnPcb.length > 1 ? 's are' : ' is'} missing from the PCB / pick-and-place export: ${formatDesignatorList(bomMissingOnPcb)}. Selection from the BOM will not show a PCB placement for ${bomMissingOnPcb.length > 1 ? 'these references' : 'this reference'}.`
		});
	}

	const pcbMissingInBom = Array.from(pcbDesignators)
		.filter((designator) => !bomDesignators.has(designator))
		.map((designator) => pcbDisplayByKey.get(designator) ?? designator)
		.sort(naturalDesignatorSort.compare);
	if (pcbMissingInBom.length > 0) {
		diagnostics.push({
			file: `${project.pcb.fileName} / ${project.bom.fileName}`,
			message: `${pcbMissingInBom.length} PCB component${pcbMissingInBom.length > 1 ? 's are' : ' is'} missing from the fitted BOM export: ${formatDesignatorList(pcbMissingInBom)}. Verify the BOM/pick-and-place generation settings or fitted variant.`
		});
	}

	return diagnostics;
}
