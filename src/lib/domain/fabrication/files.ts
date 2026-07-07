export interface OdbPackageFile {
	name: string;
	size: number;
	path?: string;
}

export function isOdbPackageFileName(name: string) {
	const lower = name.toLowerCase();
	return (
		lower.endsWith('.odb') ||
		lower.endsWith('.odb++') ||
		lower.endsWith('.odb.tgz') ||
		lower.endsWith('.odb.tar') ||
		lower.endsWith('.odb.tar.gz') ||
		lower.endsWith('.odb.zip') ||
		lower.endsWith('.tgz') ||
		lower.endsWith('.tar') ||
		lower.endsWith('.tar.gz') ||
		lower.endsWith('.zip')
	);
}

export function formatFileSize(size: number) {
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
