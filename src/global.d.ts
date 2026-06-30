import type { AltiumDiffApi } from '../electron/preload';

declare global {
	interface Window {
		altiumDiff?: AltiumDiffApi;
	}
}

export {};
