import type { AltiumDiffApi } from '../electron/preload';

declare global {
	const __APP_VERSION__: string;

	interface Window {
		altiumDiff?: AltiumDiffApi;
	}
}

export {};
