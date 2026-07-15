import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDxfTextLink } from '../src/lib/domain/dxfLinker.ts';
import type { ProjectComponent, ProjectIndex } from '../src/lib/domain/project.ts';

function component(designator: string, visibleInBomViewer = true): ProjectComponent {
	return {
		designator,
		bom: { designator, comment: 'Capacitor 0805' },
		nets: [],
		pinConnections: [],
		parameters: {},
		category: 'capacitor',
		searchText: designator.toLowerCase(),
		visibleInBomViewer,
		bomViewerHiddenReason: visibleInBomViewer ? '' : 'Template'
	};
}

function indexFor(components: ProjectComponent[]): ProjectIndex {
	return {
		components,
		byDesignator: new Map(components.map((item) => [item.designator.toUpperCase(), item])),
		nets: [],
		byNet: new Map()
	};
}

test('resolves generic DXF component labels to the preferred channel instance', () => {
	const index = indexFor([component('C323', false), component('C323_FR0'), component('C323_FR1')]);

	const link = resolveDxfTextLink('C323', index, { preferredChannel: 'FR1' });

	assert.equal(link?.kind, 'component');
	assert.equal(link?.designator, 'C323_FR1');
});

test('extracts component references from formatted DXF text', () => {
	const index = indexFor([component('C206')]);

	const link = resolveDxfTextLink('{\\fArial|b0|i0;C206 22uF 35V}', index);

	assert.equal(link?.kind, 'component');
	assert.equal(link?.designator, 'C206');
});

test('matches known project components when DXF text glues designator and value', () => {
	const index = indexFor([component('C20'), component('C206')]);

	const link = resolveDxfTextLink('C20622uF35V0805X5R', index);

	assert.equal(link?.kind, 'component');
	assert.equal(link?.designator, 'C206');
});
