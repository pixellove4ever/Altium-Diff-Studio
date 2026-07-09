import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const appVersion = (
	JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }
).version;

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
		build: {
			rollupOptions: {
				input: resolve(__dirname, 'electron/main.ts'),
				output: {
					format: 'cjs',
					entryFileNames: '[name].cjs'
				}
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
		define: {
			__APP_VERSION__: JSON.stringify(appVersion)
		},
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
