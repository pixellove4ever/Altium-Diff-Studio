import type { ProjectIndex } from '$lib/domain/project';

export type DxfTextLink =
	| { kind: 'component'; label: string; designator: string; tooltip: string }
	| { kind: 'net'; label: string; net: string; tooltip: string };

export function normalizeDxfLabel(value: string) {
	return value.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
}

function compact(value: string) {
	return normalizeDxfLabel(value).replace(/[^A-Z0-9_+\-/]/g, '');
}

export function resolveDxfTextLink(text: string, index: ProjectIndex): DxfTextLink | null {
	const label = normalizeDxfLabel(text);
	if (!label || label.length > 160) return null;

	const componentCandidates = new Set([label, compact(label)]);
	const partMatch = compact(label).match(/^([A-Z]{1,5}\d+)[A-Z]$/);
	if (partMatch) componentCandidates.add(partMatch[1]);

	for (const candidate of componentCandidates) {
		const component = index.byDesignator.get(candidate);
		if (!component) continue;
		const description =
			component.bom?.comment ||
			component.schematic?.comment ||
			component.pcb?.comment ||
			component.category;
		return {
			kind: 'component',
			label,
			designator: component.designator,
			tooltip: `${component.designator} · ${description}`
		};
	}

	const directNet = index.byNet.get(label);
	if (directNet) {
		return {
			kind: 'net',
			label,
			net: directNet.name,
			tooltip: `${directNet.name} · ${directNet.components.length} component(s)`
		};
	}

	const compactLabel = compact(label);
	const normalizedNet = index.nets.find((net) => compact(net) === compactLabel);
	if (normalizedNet) {
		const record = index.byNet.get(normalizedNet.toUpperCase());
		return {
			kind: 'net',
			label,
			net: record?.name ?? normalizedNet,
			tooltip: `${record?.name ?? normalizedNet} · ${record?.components.length ?? 0} component(s)`
		};
	}

	return null;
}
