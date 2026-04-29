import path from "path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { crx } from "@crxjs/vite-plugin";
import { createManifest } from "./manifest.config";

export default defineConfig(({ mode }) => ({
  plugins: [svelte(), tailwindcss(), crx({ manifest: createManifest({ isDev: mode !== "production" }) })],
  resolve: {
    alias: {
      $lib: path.resolve("./src/lib"),
    },
  },
  build: {
    target: "esnext",
    outDir: "dist",
  },
}));
