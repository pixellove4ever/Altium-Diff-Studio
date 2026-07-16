export type IdentityFile = {
	name: string;
	path?: string | null;
	webkitRelativePath?: string | null;
};

export type ProjectIdentity = {
	name: string;
	version: string;
	label: string;
};

function pathValue(file: IdentityFile) {
	return file.path || file.webkitRelativePath || file.name;
}

function pathSegments(value: string) {
	return value.replaceAll('\\', '/').split('/').filter(Boolean);
}

function basename(value: string) {
	return pathSegments(value).at(-1) ?? value;
}

function stem(value: string) {
	return basename(value).replace(
		/\.(json|pdf|dxf|gbr|ger|pho|art|gtl|gbl|gts|gbs|gtp|gbp|gto|gbo|gm\d|gko|gml|drl|xln|odb|tgz|tar|gz|zip)$/i,
		''
	);
}

function cleanVersion(value: string) {
	return value
		.replace(/^[_\-\s]+|[_\-\s]+$/g, '')
		.replace(/^(version|ver|rev|revision)[_\-\s]*/i, (match) =>
			match.toLowerCase().startsWith('rev') ? 'Rev ' : 'v'
		);
}

function extractVersion(value: string) {
	const patterns = [
		/(?:^|[_\-\s])((?:v|ver|version)[_\-\s]?\d+(?:[._-]\d+){0,3}[a-z]?)(?=$|[_\-\s])/i,
		/(?:^|[_\-\s])((?:rev|revision)[_\-\s]?[a-z0-9]+)(?=$|[_\-\s])/i,
		/(?:^|[_\-\s])(r\d{1,3}[a-z]?)(?=$|[_\-\s])/i,
		/(?:^|[_\-\s])(\d{4}[-_]\d{2}[-_]\d{2})(?=$|[_\-\s])/,
		/(?:^|[_\-\s])(\d{8})(?=$|[_\-\s])/
	];
	for (const pattern of patterns) {
		const match = value.match(pattern);
		if (match?.[1]) return cleanVersion(match[1]);
	}
	return '';
}

export function inferProjectIdentity(files: IdentityFile[], fallback = 'Project'): ProjectIdentity {
	const paths = files.map(pathValue).filter(Boolean);
	if (paths.length === 0) return { name: fallback, version: '', label: fallback };

	const stems = paths.map(stem);
	const version =
		stems.map(extractVersion).find((candidate) => candidate.trim()) ||
		paths.map(extractVersion).find((candidate) => candidate.trim()) ||
		'';

	return {
		name: fallback,
		version,
		label: version || fallback
	};
}
