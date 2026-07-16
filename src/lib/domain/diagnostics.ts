import type { ImportDiagnostic } from '$lib/state/importStore.svelte';
import type { LoadedJsonFile } from '$lib/state/projectStore.svelte';

export type DiagnosticRow = ImportDiagnostic & { count: number };

export const compactDiagnosticMessage = (message: string) => {
	let compacted = message.replace(/\[[0-9]+\]/g, '[*]');
	compacted = compacted.replace(/Duplicate BOM designator "[^"]+"/g, 'Duplicate BOM designator "***"');
	compacted = compacted.replace(/\.[0-9]+,[0-9]+:/g, '.*,*:');
	compacted = compacted.replace(/multiple net names: .*$/g, 'multiple net names: ***');
	return compacted;
};

export function groupDiagnostics(diagnostics: ImportDiagnostic[]): DiagnosticRow[] {
	const grouped = new Map<string, DiagnosticRow>();
	for (const diagnostic of diagnostics) {
		if (diagnostic.severity === 'info') continue;
		const message = compactDiagnosticMessage(diagnostic.message);
		const key = [diagnostic.side, diagnostic.file, diagnostic.severity, message].join('|');
		const current = grouped.get(key);
		if (current) {
			current.count += 1;
		} else {
			grouped.set(key, { ...diagnostic, message, count: 1 });
		}
	}
	return Array.from(grouped.values()).map((diagnostic) =>
		diagnostic.count > 1
			? { ...diagnostic, message: `${diagnostic.message} (${diagnostic.count} occurrences)` }
			: diagnostic
	);
}

export function exportDiagnosticsReport(
	mode: string,
	filesA: LoadedJsonFile[],
	filesB: LoadedJsonFile[],
	diagnostics: ImportDiagnostic[],
	appVersion: string
) {
	const report = {
		generatedAt: new Date().toISOString(),
		appVersion,
		testedAltiumVersion: '26.7.1',
		mode,
		filesA: filesA.map((file) => ({
			name: file.name,
			size: file.size,
			type: file.doc.type,
			exporter: file.doc.exportMeta
		})),
		filesB: filesB.map((file) => ({
			name: file.name,
			size: file.size,
			type: file.doc.type,
			exporter: file.doc.exportMeta
		})),
		diagnostics
	};
	const url = URL.createObjectURL(
		new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' })
	);
	const link = document.createElement('a');
	link.href = url;
	link.download = `altium-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
	link.click();
	window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
