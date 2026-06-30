import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
		build: {
			rollupOptions: {
				input: resolve(__dirname, 'electron/main.ts')
			}
		}
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
		build: {
			rollupOptions: {
				input: resolve(__dirname, 'electron/preload.ts')
			}
		}
	},
	renderer: {
		root: '.',
		resolve: {
			alias: {
				$lib: resolve(__dirname, 'src/lib')
			}
		},
		build: {
			rollupOptions: {
				input: resolve(__dirname, 'index.html')
			}
		},
		plugins: [
			svelte({
				compilerOptions: {
					runes: true
				}
			})
		]
	}
});
