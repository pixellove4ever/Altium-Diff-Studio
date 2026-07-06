import type { ReviewSnapshot } from './reviewSession.ts';
import { translate, type Locale } from '../i18n.ts';

export type ReviewReportChange = {
	key: string;
	kind: 'component' | 'net';
	value: string;
	status: 'added' | 'modified' | 'removed';
	sources: Array<'pcb' | 'schematic' | 'bom'>;
	summary: string;
};

export type ReviewReportStats = {
	statuses: { added: number; modified: number; removed: number };
	sources: { pcb: number; schematic: number; bom: number };
	components: number;
	nets: number;
};

export type ReviewReportFile = {
	side: 'A' | 'B';
	name: string;
	size: number;
	type: string;
	exportMeta?: {
		scriptName?: string;
		scriptVersion?: string;
		schemaVersion?: string;
		generatedAt?: string;
	};
};

export type ReviewReportDiagnostic = {
	side: 'A' | 'B';
	file: string;
	severity: 'warning' | 'error';
	message: string;
};

type ReviewReportOptions = {
	title: string;
	locale: Locale;
	generatedAt: string;
	changes: ReviewReportChange[];
	scope: 'complete' | 'filtered';
	totalChanges: number;
	reviewed: ReadonlySet<string>;
	notes: Record<string, string>;
	snapshots: Record<string, ReviewSnapshot>;
	stats: ReviewReportStats;
	captures: Array<{ label: string; dataUrl: string }>;
	files: ReviewReportFile[];
	diagnostics: ReviewReportDiagnostic[];
};

function escapeHtml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

const reportStyles =
	'body{font:14px Inter,Arial,sans-serif;color:#172033;margin:32px}h1{margin:0 0 6px}h2{margin-top:28px}p{color:#64748b}.cover{min-height:240px;padding:32px;border:1px solid #cbd5e1;border-radius:12px;background:linear-gradient(135deg,#f8fafc,#eef2ff)}.cover .scope{text-transform:uppercase;letter-spacing:.12em;color:#4f46e5;font-weight:700}.summary,.stats{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0}.summary b,.stats span{padding:9px 12px;border-radius:8px;background:#f1f5f9}.stats .added{color:#15803d;background:#dcfce7}.stats .modified{color:#c2410c;background:#ffedd5}.stats .removed{color:#b91c1c;background:#fee2e2}.files{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.file{padding:12px;border:1px solid #e2e8f0;border-radius:8px;break-inside:avoid}.file strong,.file span{display:block}.file span{color:#64748b;margin-top:3px}.diagnostics{padding-left:20px}.diagnostics li{margin:7px 0}.diagnostics .error{color:#b91c1c}.diagnostics .warning{color:#a16207}.captures,.review-captures{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:20px 0}.captures figure,.review-captures figure{margin:0;break-inside:avoid}.captures figcaption,.review-captures figcaption{margin:0 0 5px;color:#64748b;font-weight:700}.captures img,.review-captures img{display:block;width:100%;border:1px solid #cbd5e1;border-radius:7px;background:#111827}.review-captures small{display:block;margin-top:4px;color:#94a3b8}table{width:100%;border-collapse:collapse}th,td{padding:9px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}th{background:#f8fafc}.added td:first-child{border-left:4px solid #16a34a}.modified td:first-child{border-left:4px solid #f97316}.removed td:first-child{border-left:4px solid #dc2626}@media print{body{margin:0}.cover{min-height:90vh;box-sizing:border-box;break-after:page}.captures{break-after:page}thead{display:table-header-group}}';

function formatBytes(size: number) {
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function calculateStats(changes: ReviewReportChange[]): ReviewReportStats {
	const stats: ReviewReportStats = {
		statuses: { added: 0, modified: 0, removed: 0 },
		sources: { pcb: 0, schematic: 0, bom: 0 },
		components: 0,
		nets: 0
	};
	for (const change of changes) {
		stats.statuses[change.status] += 1;
		stats[change.kind === 'component' ? 'components' : 'nets'] += 1;
		for (const source of change.sources) stats.sources[source] += 1;
	}
	return stats;
}

export function createReviewReportHtml(options: ReviewReportOptions) {
	const { changes, reviewed, notes, snapshots, captures } = options;
	const stats = options.scope === 'filtered' ? calculateStats(changes) : options.stats;
	const rows = changes
		.map(
			(change) =>
				`<tr class="${change.status}"><td>${change.kind === 'net' ? 'Net' : 'Component'}</td><td>${escapeHtml(change.value)}</td><td>${change.status}</td><td>${escapeHtml(change.sources.map((source) => (source === 'schematic' ? 'SCH' : source.toUpperCase())).join(', '))}</td><td>${escapeHtml(change.summary)}</td><td>${reviewed.has(change.key) ? 'Reviewed' : 'Pending'}</td><td>${escapeHtml(notes[change.key] ?? '')}</td></tr>`
		)
		.join('');
	const captureHtml = captures
		.map(
			(capture) =>
				`<figure><figcaption>${escapeHtml(capture.label)}</figcaption><img src="${escapeHtml(capture.dataUrl)}" alt="${escapeHtml(capture.label)}"></figure>`
		)
		.join('');
	const reviewedCount = changes.filter((change) => reviewed.has(change.key)).length;
	const changesByKey = new Map(changes.map((change) => [change.key, change]));
	const snapshotHtml = Object.entries(snapshots)
		.filter(([key]) => changesByKey.has(key))
		.map(([key, snapshot]) => {
			const change = changesByKey.get(key)!;
			return `<figure><figcaption>${escapeHtml(change.value)} · ${escapeHtml(snapshot.view)}</figcaption><img src="${escapeHtml(snapshot.dataUrl)}" alt="${escapeHtml(change.value)} review snapshot"><small>${escapeHtml(snapshot.capturedAt)}</small></figure>`;
		})
		.join('');
	const statusSummary = `<div class="stats"><span class="added">${stats.statuses.added} added</span><span class="modified">${stats.statuses.modified} modified</span><span class="removed">${stats.statuses.removed} removed</span><span>${stats.components} components</span><span>${stats.nets} nets</span><span>PCB ${stats.sources.pcb}</span><span>SCH ${stats.sources.schematic}</span><span>BOM ${stats.sources.bom}</span></div>`;
	const fileHtml = options.files
		.map((file) => {
			const meta = file.exportMeta;
			const details = [
				`${file.type.toUpperCase()} · ${formatBytes(file.size)}`,
				meta?.scriptName &&
					`Exporter: ${meta.scriptName}${meta.scriptVersion ? ` ${meta.scriptVersion}` : ''}`,
				meta?.schemaVersion && `Schema: ${meta.schemaVersion}`,
				meta?.generatedAt && `Exported: ${meta.generatedAt}`
			].filter(Boolean);
			return `<div class="file"><strong>${file.side} · ${escapeHtml(file.name)}</strong>${details.map((detail) => `<span>${escapeHtml(String(detail))}</span>`).join('')}</div>`;
		})
		.join('');
	const diagnosticHtml = options.diagnostics
		.map(
			(diagnostic) =>
				`<li class="${diagnostic.severity}"><strong>${diagnostic.severity.toUpperCase()} · ${diagnostic.side} · ${escapeHtml(diagnostic.file)}</strong> — ${escapeHtml(diagnostic.message)}</li>`
		)
		.join('');
	const coverage = options.totalChanges
		? Math.round((Math.min(reviewed.size, options.totalChanges) / options.totalChanges) * 100)
		: 100;

	const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(options.title)}</title><style>${reportStyles}</style></head><body><header class="cover"><div class="scope">${options.scope === 'filtered' ? 'Filtered review report' : 'Complete review report'}</div><h1>${escapeHtml(options.title)}</h1><p>Generated ${escapeHtml(options.generatedAt)}</p><div class="summary"><b>${changes.length}${options.scope === 'filtered' ? ` / ${options.totalChanges}` : ''} changes</b><b>${reviewedCount} reviewed in report</b><b>${changes.length - reviewedCount} pending</b><b>${coverage}% overall review coverage</b><b>${Object.keys(snapshots).length} snapshots</b></div>${statusSummary}</header><h2>Source files</h2><section class="files">${fileHtml || '<p>No source file metadata available.</p>'}</section>${diagnosticHtml ? `<h2>Important diagnostics</h2><ul class="diagnostics">${diagnosticHtml}</ul>` : '<h2>Diagnostics</h2><p>No important import diagnostic.</p>'}${captureHtml ? `<section class="captures">${captureHtml}</section>` : ''}${snapshotHtml ? `<h2>Review snapshots</h2><section class="review-captures">${snapshotHtml}</section>` : ''}<h2>Changes</h2><table><thead><tr><th>Kind</th><th>Item</th><th>Status</th><th>Views</th><th>Description</th><th>Review</th><th>Comment</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
	return html
		.replace('Complete review report', translate(options.locale, 'report.complete'))
		.replace('Filtered review report', translate(options.locale, 'report.filtered'))
		.replace(
			`Generated ${escapeHtml(options.generatedAt)}`,
			translate(options.locale, 'report.generated', { date: escapeHtml(options.generatedAt) })
		)
		.replace('Source files', translate(options.locale, 'report.sourceFiles'))
		.replaceAll('Diagnostics', translate(options.locale, 'report.diagnostics'))
		.replace('No important import diagnostic.', translate(options.locale, 'report.noDiagnostics'))
		.replaceAll('Changes', translate(options.locale, 'report.changes'))
		.replace('Status', translate(options.locale, 'common.status'));
}
