import path from "path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json";

export default defineConfig({
  plugins: [svelte(), tailwindcss(), crx({ manifest })],
  resolve: {
    alias: {
      $lib: path.resolve("./src/lib"),
    },
  },
  build: {
    target: "esnext",
    outDir: "dist",
  },
});
