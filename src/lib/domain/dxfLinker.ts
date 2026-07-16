import type { ProjectComponent, ProjectIndex } from '$lib/domain/project';

export type DxfTextLink =
	| { kind: 'component'; label: string; designator: string; tooltip: string }
	| { kind: 'net'; label: string; net: string; tooltip: string };

export type DxfLinkOptions = {
	preferredChannel?: string;
};

export function normalizeDxfLabel(value: string) {
	return value
		.replace(/\\P/g, ' ')
		.replace(/\\~/g, ' ')
		.replace(/\\[A-Za-z][^;]*;/g, '')
		.replace(/%%[A-Za-z0-9]/g, '')
		.replace(/[{}]/g, '')
		.replace(/\n/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toUpperCase();
}

function compact(value: string) {
	return normalizeDxfLabel(value).replace(/[^A-Z0-9_+\-/]/g, '');
}

function channelBase(candidate: string) {
	return candidate.match(/^(.+)_([A-Z]*\d+)$/)?.[1] ?? candidate;
}

function componentDescription(component: ProjectComponent) {
	return (
		component.bom?.comment ||
		component.schematic?.comment ||
		component.pcb?.comment ||
		component.category
	);
}

function componentCandidatesFor(label: string) {
	const compactLabel = compact(label);
	const candidates = new Set([label, compactLabel]);
	for (const match of label.matchAll(
		/(?:^|[^A-Z0-9])([A-Z]{1,5}\d+(?:_[A-Z]*\d+)?)(?=$|[^A-Z0-9])/g
	)) {
		candidates.add(match[1]);
		candidates.add(channelBase(match[1]));
	}
	const partMatch = compactLabel.match(/^([A-Z]{1,5}\d+)[A-Z]$/);
	if (partMatch) candidates.add(partMatch[1]);
	for (const match of compactLabel.matchAll(/[A-Z]{1,5}\d+(?:_[A-Z]*\d+)?/g)) {
		candidates.add(match[0]);
		candidates.add(channelBase(match[0]));
	}
	return Array.from(candidates).filter(Boolean);
}

function knownComponentCandidates(label: string, index: ProjectIndex) {
	const compactLabel = compact(label);
	if (!compactLabel) return [];
	return index.components
		.flatMap((component) => {
			const designator = component.designator.toUpperCase();
			const base = channelBase(designator);
			return [
				{
					candidate: designator,
					score: designator.length + (component.visibleInBomViewer ? 20 : 0)
				},
				{ candidate: base, score: base.length + 10 }
			];
		})
		.filter(({ candidate }) => {
			const compactCandidate = compact(candidate);
			if (compactCandidate.length < 2) return false;
			return compactLabel.includes(compactCandidate);
		})
		.sort((left, right) => right.score - left.score)
		.map(({ candidate }) => candidate);
}

function resolveComponentCandidate(
	candidate: string,
	index: ProjectIndex,
	options: DxfLinkOptions
) {
	const normalized = candidate.toUpperCase();
	const preferredChannel = options.preferredChannel?.trim().toUpperCase();
	const preferredDesignator = preferredChannel
		? `${channelBase(normalized)}_${preferredChannel}`
		: '';
	if (preferredDesignator) {
		const preferred = index.byDesignator.get(preferredDesignator);
		if (preferred) return preferred;
	}
	const direct = index.byDesignator.get(normalized);
	if (direct?.visibleInBomViewer !== false) return direct;
	if (direct && !preferredDesignator) return direct;
	const base = channelBase(normalized);
	return (
		index.components.find(
			(component) =>
				component.visibleInBomViewer !== false &&
				component.designator.toUpperCase().startsWith(`${base}_`)
		) ?? direct
	);
}

export function resolveDxfTextLink(
	text: string,
	index: ProjectIndex,
	options: DxfLinkOptions = {}
): DxfTextLink | null {
	const label = normalizeDxfLabel(text);
	if (!label || label.length > 160) return null;

	for (const candidate of [
		...componentCandidatesFor(label),
		...knownComponentCandidates(label, index)
	]) {
		const component = resolveComponentCandidate(candidate, index, options);
		if (!component) continue;
		return {
			kind: 'component',
			label,
			designator: component.designator,
			tooltip: `${component.designator} · ${componentDescription(component)}`
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
