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

type ReviewReportOptions = {
	title: string;
	generatedAt: string;
	changes: ReviewReportChange[];
	reviewed: ReadonlySet<string>;
	notes: Record<string, string>;
	snapshots: Record<string, ReviewSnapshot>;
	stats: ReviewReportStats;
	captures: Array<{ label: string; dataUrl: string }>;
};

function escapeHtml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

const reportStyles =
	'body{font:14px Inter,Arial,sans-serif;color:#172033;margin:32px}h1{margin:0 0 6px}p{color:#64748b}.summary,.stats{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0}.summary b,.stats span{padding:9px 12px;border-radius:8px;background:#f1f5f9}.stats .added{color:#15803d;background:#dcfce7}.stats .modified{color:#c2410c;background:#ffedd5}.stats .removed{color:#b91c1c;background:#fee2e2}.captures,.review-captures{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:20px 0}.captures figure,.review-captures figure{margin:0;break-inside:avoid}.captures figcaption,.review-captures figcaption{margin:0 0 5px;color:#64748b;font-weight:700}.captures img,.review-captures img{display:block;width:100%;border:1px solid #cbd5e1;border-radius:7px;background:#111827}.review-captures small{display:block;margin-top:4px;color:#94a3b8}table{width:100%;border-collapse:collapse}th,td{padding:9px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}th{background:#f8fafc}.added td:first-child{border-left:4px solid #16a34a}.modified td:first-child{border-left:4px solid #f97316}.removed td:first-child{border-left:4px solid #dc2626}@media print{body{margin:0}.captures{break-after:page}thead{display:table-header-group}}';

export function createReviewReportHtml(options: ReviewReportOptions) {
	const { changes, reviewed, notes, snapshots, stats, captures } = options;
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

	return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(options.title)}</title><style>${reportStyles}</style></head><body><h1>${escapeHtml(options.title)}</h1><p>Generated ${escapeHtml(options.generatedAt)}</p><div class="summary"><b>${changes.length} changes</b><b>${reviewedCount} reviewed</b><b>${changes.length - reviewedCount} pending</b><b>${Object.keys(snapshots).length} snapshots</b></div>${statusSummary}${captureHtml ? `<section class="captures">${captureHtml}</section>` : ''}${snapshotHtml ? `<h2>Review snapshots</h2><section class="review-captures">${snapshotHtml}</section>` : ''}<table><thead><tr><th>Kind</th><th>Item</th><th>Status</th><th>Views</th><th>Description</th><th>Review</th><th>Comment</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}
import type { ReviewSnapshot } from './reviewSession.ts';
