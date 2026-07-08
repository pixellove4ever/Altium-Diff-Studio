export function minimalRotation(items: string[]) {
	if (items.length < 2) return items.join(';');
	const doubled = [...items, ...items];
	let left = 0;
	let right = 1;
	let offset = 0;
	while (left < items.length && right < items.length && offset < items.length) {
		const a = doubled[left + offset];
		const b = doubled[right + offset];
		if (a === b) {
			offset += 1;
			continue;
		}
		if (a > b) left += offset + 1;
		else right += offset + 1;
		if (left === right) right += 1;
		offset = 0;
	}
	const start = Math.min(left, right);
	return [...items.slice(start), ...items.slice(0, start)].join(';');
}
