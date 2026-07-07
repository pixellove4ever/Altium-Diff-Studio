export type PcbViewMode = 'diff' | 'side-by-side' | 'overlay';
export type PcbBoardSide = 'all' | 'top' | 'bottom' | 'custom';
export type PcbLayerSide = 'top' | 'bottom' | 'inner' | 'all';

export type PcbDisplayPreferences = {
	version: 1;
	visibleLayers: Record<string, boolean>;
	layerOpacities: Record<string, number>;
	viewMode: PcbViewMode;
	boardSide: PcbBoardSide;
	showComponents: boolean;
	showDesignators: boolean;
	showPlanes: boolean;
	showTexts: boolean;
	showVias: boolean;
	showPin1Markers: boolean;
	mirrored: boolean;
	sliderPosition: number;
};

export type PreferenceFile = { name: string; size: number };

export function projectPreferenceKey(filesA: PreferenceFile[], filesB: PreferenceFile[]) {
	const identify = (files: PreferenceFile[]) =>
		files
			.map((file) => `${file.name}:${file.size}`)
			.sort()
			.join('|');
	return `ads:display:v1:${identify(filesA)}::${identify(filesB)}`;
}

export function projectViewerPreferenceKey(files: PreferenceFile[]) {
	if (files.length === 0) return '';
	return `ads:viewer-tab:v1:${files
		.map((file) => `${file.name}:${file.size}`)
		.sort()
		.join('|')}`;
}

export function defaultPcbDisplayPreferences(layers: string[]): PcbDisplayPreferences {
	return {
		version: 1,
		visibleLayers: Object.fromEntries(layers.map((layer) => [layer, true])),
		layerOpacities: Object.fromEntries(layers.map((layer) => [layer, 1])),
		viewMode: 'diff',
		boardSide: 'all',
		showComponents: true,
		showDesignators: false,
		showPlanes: true,
		showTexts: false,
		showVias: true,
		showPin1Markers: false,
		mirrored: false,
		sliderPosition: 0.5
	};
}

export function pcbLayerSide(layer: string): PcbLayerSide {
	const normalized = layer.toLowerCase().replace(/[^a-z0-9]+/g, '');
	if (!normalized) return 'all';
	if (
		normalized.includes('multilayer') ||
		normalized.includes('keepout') ||
		normalized.includes('mechanical') ||
		normalized.includes('outline') ||
		normalized.includes('drill') ||
		normalized.includes('board')
	)
		return 'all';
	if (
		normalized.includes('bottom') ||
		normalized.startsWith('bot') ||
		normalized.startsWith('bcu') ||
		normalized.startsWith('bmask') ||
		normalized.startsWith('bpaste') ||
		normalized.startsWith('bsilk') ||
		normalized.startsWith('boverlay')
	)
		return 'bottom';
	if (
		normalized.includes('top') ||
		normalized.startsWith('fcu') ||
		normalized.startsWith('fmask') ||
		normalized.startsWith('fpaste') ||
		normalized.startsWith('fsilk') ||
		normalized.startsWith('foverlay')
	)
		return 'top';
	if (
		normalized.includes('mid') ||
		normalized.includes('inner') ||
		normalized.includes('internal') ||
		/^l\d+$/.test(normalized) ||
		/^signal\d+$/.test(normalized)
	)
		return 'inner';
	return 'all';
}

export function visibleLayersForBoardSide(layers: string[], side: PcbBoardSide) {
	if (side === 'all' || side === 'custom')
		return Object.fromEntries(layers.map((layer) => [layer, true]));
	return Object.fromEntries(
		layers.map((layer) => {
			const layerSide = pcbLayerSide(layer);
			return [layer, layerSide === side || layerSide === 'all'];
		})
	);
}

export function parsePcbDisplayPreferences(
	text: string | null,
	layers: string[]
): PcbDisplayPreferences {
	const defaults = defaultPcbDisplayPreferences(layers);
	if (!text) return defaults;
	try {
		const value = JSON.parse(text) as Partial<PcbDisplayPreferences>;
		if (value.version !== 1) return defaults;
		const visibleLayers = { ...defaults.visibleLayers };
		const layerOpacities = { ...defaults.layerOpacities };
		for (const layer of layers) {
			if (typeof value.visibleLayers?.[layer] === 'boolean')
				visibleLayers[layer] = value.visibleLayers[layer];
			const opacity = value.layerOpacities?.[layer];
			if (typeof opacity === 'number' && Number.isFinite(opacity))
				layerOpacities[layer] = Math.max(0.05, Math.min(1, opacity));
		}
		const viewMode = ['diff', 'side-by-side', 'overlay'].includes(value.viewMode ?? '')
			? (value.viewMode as PcbViewMode)
			: defaults.viewMode;
		const boardSide = ['all', 'top', 'bottom', 'custom'].includes(value.boardSide ?? '')
			? (value.boardSide as PcbBoardSide)
			: defaults.boardSide;
		const boolean = <K extends keyof PcbDisplayPreferences>(key: K) =>
			typeof value[key] === 'boolean' ? (value[key] as boolean) : (defaults[key] as boolean);
		return {
			version: 1,
			visibleLayers,
			layerOpacities,
			viewMode,
			boardSide,
			showComponents: boolean('showComponents'),
			showDesignators: boolean('showDesignators'),
			showPlanes: boolean('showPlanes'),
			showTexts: boolean('showTexts'),
			showVias: boolean('showVias'),
			showPin1Markers: boolean('showPin1Markers'),
			mirrored: boolean('mirrored'),
			sliderPosition:
				typeof value.sliderPosition === 'number' && Number.isFinite(value.sliderPosition)
					? Math.max(0, Math.min(1, value.sliderPosition))
					: defaults.sliderPosition
		};
	} catch {
		return defaults;
	}
}
