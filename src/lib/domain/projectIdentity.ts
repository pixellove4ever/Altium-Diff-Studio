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

const technicalTokens = new Set([
	'ads',
	'altium',
	'archive',
	'archives',
	'baseline',
	'bom',
	'bot',
	'bottom',
	'candidate',
	'cam',
	'compare',
	'comparison',
	'diff',
	'desktop',
	'download',
	'downloads',
	'document',
	'documents',
	'dxf',
	'export',
	'exports',
	'fab',
	'fabrication',
	'gerber',
	'gerbers',
	'gbr',
	'generated',
	'github',
	'manufacturing',
	'odb',
	'odbpp',
	'odb++',
	'output',
	'outputs',
	'pcb',
	'pcbdocument',
	'pdf',
	'prod',
	'production',
	'perso',
	'personal',
	'release',
	'releases',
	'repo',
	'repos',
	'sch',
	'schdoc',
	'schema',
	'schematic',
	'smartpdf',
	'source',
	'sources',
	'studio',
	'user',
	'users',
	'workspace',
	'workspaces',
	'top'
]);

const pathBoundaryTokens = new Set([
	'desktop',
	'document',
	'documents',
	'download',
	'downloads',
	'github',
	'personal',
	'perso',
	'repo',
	'repos',
	'user',
	'users',
	'workspace',
	'workspaces'
]);

function pathValue(file: IdentityFile) {
	return file.path || file.webkitRelativePath || file.name;
}

function pathSegments(value: string) {
	return value.replaceAll('\\', '/').split('/').filter(Boolean);
}

function basename(value: string) {
	return pathSegments(value).at(-1) ?? value;
}

function directorySegments(value: string) {
	const segments = pathSegments(value);
	return segments.length > 1 ? segments.slice(0, -1) : [];
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

function stripVersionTokens(value: string, version: string) {
	const explicitVersion = version
		? value.replace(new RegExp(version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ')
		: value;
	return explicitVersion
		.replace(/(?:^|[_\-\s])(?:v|ver|version)[_\-\s]?\d+(?:[._-]\d+){0,3}[a-z]?(?=$|[_\-\s])/gi, ' ')
		.replace(/(?:^|[_\-\s])(?:rev|revision)[_\-\s]?[a-z0-9]+(?=$|[_\-\s])/gi, ' ')
		.replace(/(?:^|[_\-\s])r\d{1,3}[a-z]?(?=$|[_\-\s])/gi, ' ')
		.replace(/(?:^|[_\-\s])\d{4}[-_]\d{2}[-_]\d{2}(?=$|[_\-\s])/g, ' ')
		.replace(/(?:^|[_\-\s])\d{8}(?=$|[_\-\s])/g, ' ');
}

function normalizeWords(value: string) {
	return stem(value)
		.replace(/\([^)]*\)/g, ' ')
		.replace(/\[[^\]]*\]/g, ' ')
		.replace(/[_+.-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function projectNameCandidate(value: string, version: string) {
	const words = normalizeWords(stripVersionTokens(value, version))
		.split(' ')
		.filter((word) => {
			const normalized = word.toLowerCase().replace(/[^a-z0-9+]+/g, '');
			if (!normalized) return false;
			if (/^[a-z]:$/.test(normalized)) return false;
			if (technicalTokens.has(normalized)) return false;
			if (/^v?\d+(?:\.\d+)*[a-z]?$/.test(normalized)) return false;
			return true;
		});
	return words.join(' ').trim();
}

function segmentHasBoundaryToken(value: string) {
	return normalizeWords(value)
		.split(' ')
		.some((word) => pathBoundaryTokens.has(word.toLowerCase().replace(/[^a-z0-9+]+/g, '')));
}

function longestCommonPrefix(values: string[]) {
	if (values.length === 0) return '';
	let prefix = values[0];
	for (const value of values.slice(1)) {
		let index = 0;
		while (
			index < prefix.length &&
			index < value.length &&
			prefix[index].toLowerCase() === value[index].toLowerCase()
		) {
			index += 1;
		}
		prefix = prefix.slice(0, index);
	}
	return prefix.replace(/[_\-\s.]+$/g, '').trim();
}

function bestDirectoryCandidate(paths: string[], version: string) {
	const scores = new Map<string, { label: string; score: number }>();
	for (const path of paths) {
		const directories = directorySegments(path);
		for (const [depth, segment] of directories.slice().reverse().entries()) {
			if (segmentHasBoundaryToken(segment)) break;
			const candidate = projectNameCandidate(segment, version);
			if (!candidate) continue;
			const normalized = candidate.toLowerCase();
			const proximity = Math.max(1, 8 - depth);
			const existing = scores.get(normalized);
			scores.set(normalized, {
				label: existing?.label ?? candidate,
				score: (existing?.score ?? 0) + proximity + Math.min(candidate.length, 28) / 28
			});
		}
	}

	const [best] = [...scores.values()].sort((a, b) => b.score - a.score);
	return best?.label ?? '';
}

export function inferProjectIdentity(files: IdentityFile[], fallback = 'Project'): ProjectIdentity {
	const paths = files.map(pathValue).filter(Boolean);
	if (paths.length === 0) return { name: fallback, version: '', label: fallback };

	const stems = paths.map(stem);
	const version =
		stems.map(extractVersion).find((candidate) => candidate.trim()) ||
		paths.map(extractVersion).find((candidate) => candidate.trim()) ||
		'';
	const candidates = stems.map((value) => projectNameCandidate(value, version)).filter(Boolean);
	const common = projectNameCandidate(longestCommonPrefix(stems), version);
	const directoryCandidate = bestDirectoryCandidate(paths, version);
	const name =
		directoryCandidate || common || candidates.sort((a, b) => b.length - a.length)[0] || fallback;

	return {
		name,
		version,
		label: version ? `${name} - ${version}` : name
	};
}
