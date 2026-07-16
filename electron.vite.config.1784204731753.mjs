// electron.vite.config.ts
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
var __electron_vite_injected_dirname = "C:\\Users\\Thomas LALLIER\\Documents\\!Perso\\Github\\Altium-Diff-Studio";
var appVersion = JSON.parse(readFileSync(resolve(__electron_vite_injected_dirname, "package.json"), "utf8")).version;
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__electron_vite_injected_dirname, "electron/main.ts"),
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs"
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__electron_vite_injected_dirname, "electron/preload.ts")
      }
    }
  },
  renderer: {
    root: ".",
    define: {
      __APP_VERSION__: JSON.stringify(appVersion)
    },
    resolve: {
      alias: {
        $lib: resolve(__electron_vite_injected_dirname, "src/lib")
      }
    },
    build: {
      rollupOptions: {
        input: resolve(__electron_vite_injected_dirname, "index.html")
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
export {
  electron_vite_config_default as default
};
