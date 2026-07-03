export type PcbViewMode = 'diff' | 'side-by-side' | 'overlay';

export type PcbDisplayPreferences = {
	version: 1;
	visibleLayers: Record<string, boolean>;
	layerOpacities: Record<string, number>;
	viewMode: PcbViewMode;
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

export function defaultPcbDisplayPreferences(layers: string[]): PcbDisplayPreferences {
	return {
		version: 1,
		visibleLayers: Object.fromEntries(layers.map((layer) => [layer, true])),
		layerOpacities: Object.fromEntries(layers.map((layer) => [layer, 1])),
		viewMode: 'diff',
		showComponents: true,
		showDesignators: false,
		showPlanes: true,
		showTexts: false,
		showVias: false,
		showPin1Markers: false,
		mirrored: false,
		sliderPosition: 0.5
	};
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
		const boolean = <K extends keyof PcbDisplayPreferences>(key: K) =>
			typeof value[key] === 'boolean' ? (value[key] as boolean) : (defaults[key] as boolean);
		return {
			version: 1,
			visibleLayers,
			layerOpacities,
			viewMode,
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
