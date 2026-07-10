import { projectViewerPreferenceKey, type PreferenceFile } from '$lib/domain/displayPreferences';

export type ProjectViewerTab = 'schematic' | 'pcb' | 'gerber' | '3d' | 'bom';
export type ProjectViewerAvailability = Record<ProjectViewerTab, boolean>;

const minimalUiStorageKey = 'ads:minimal-ui';

export function isProjectViewerTab(value: string | null): value is ProjectViewerTab {
	return (
		value === 'schematic' ||
		value === 'pcb' ||
		value === 'gerber' ||
		value === '3d' ||
		value === 'bom'
	);
}

export function fallbackProjectViewerTab(
	availableTabs: ProjectViewerAvailability,
	currentTab: ProjectViewerTab
): ProjectViewerTab {
	if (availableTabs[currentTab]) return currentTab;
	if (availableTabs.schematic) return 'schematic';
	if (availableTabs.pcb) return 'pcb';
	if (availableTabs.gerber) return 'gerber';
	if (availableTabs.bom) return 'bom';
	return currentTab;
}

class ViewerStore {
	minimalUi = $state(true);
	projectViewerTab = $state<ProjectViewerTab>('pcb');
	private loadedProjectViewerPreferenceKey = $state('');

	hydrateMinimalUi(storage: Storage) {
		const savedMinimal = storage.getItem(minimalUiStorageKey);
		if (savedMinimal !== null) this.minimalUi = savedMinimal !== 'false';
	}

	persistMinimalUi(storage: Storage) {
		storage.setItem(minimalUiStorageKey, String(this.minimalUi));
	}

	toggleMinimalUi() {
		this.minimalUi = !this.minimalUi;
	}

	restoreProjectViewerTab(files: PreferenceFile[], availableTabs: ProjectViewerAvailability) {
		if (typeof window === 'undefined') return;
		const key = projectViewerPreferenceKey(files);
		if (!key || key === this.loadedProjectViewerPreferenceKey) return;
		const saved = window.localStorage.getItem(key);
		this.projectViewerTab =
			isProjectViewerTab(saved) && availableTabs[saved]
				? saved
				: fallbackProjectViewerTab(availableTabs, this.projectViewerTab);
		this.loadedProjectViewerPreferenceKey = key;
	}

	ensureProjectViewerTab(availableTabs: ProjectViewerAvailability) {
		if (availableTabs[this.projectViewerTab]) return;
		this.projectViewerTab = fallbackProjectViewerTab(availableTabs, this.projectViewerTab);
	}

	persistProjectViewerTab(files: PreferenceFile[], availableTabs: ProjectViewerAvailability) {
		if (typeof window === 'undefined') return;
		const key = projectViewerPreferenceKey(files);
		if (
			!this.loadedProjectViewerPreferenceKey ||
			this.loadedProjectViewerPreferenceKey !== key ||
			!availableTabs[this.projectViewerTab]
		)
			return;
		window.localStorage.setItem(this.loadedProjectViewerPreferenceKey, this.projectViewerTab);
	}
}

export const viewerStore = new ViewerStore();
