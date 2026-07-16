export const busSelectionPrefix = 'BUS:';

export function netBusName(net: string) {
	const normalized = net.trim();
	if (!normalized) return '';
	const delimiter = normalized.search(/[_:[.<]/);
	if (delimiter > 1) return normalized.slice(0, delimiter);
	return '';
}

export function busSelectionValue(busName: string) {
	return `${busSelectionPrefix}${busName}`;
}

export function isBusSelection(selection: string | null | undefined) {
	return !!selection?.startsWith(busSelectionPrefix);
}

export function selectedNetLabel(selection: string | null | undefined) {
	if (!selection) return '';
	return isBusSelection(selection) ? selection.slice(busSelectionPrefix.length) : selection;
}

export function netMatchesSelection(
	net: string | null | undefined,
	selection: string | null | undefined
) {
	if (!net || !selection) return false;
	const normalizedNet = net.trim().toUpperCase();
	const normalizedSelection = selection.trim().toUpperCase();
	if (!normalizedNet || !normalizedSelection) return false;
	if (!isBusSelection(normalizedSelection)) return normalizedNet === normalizedSelection;
	const bus = normalizedSelection.slice(busSelectionPrefix.length);
	return normalizedNet === bus || normalizedNet.startsWith(`${bus}_`);
}
