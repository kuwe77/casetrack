import { build } from "esbuild";
await build({
  entryPoints: ["cloudflare/index.ts"], outfile: "dist/_worker.js",
  bundle: true, format: "esm", platform: "neutral", target: "es2022",
  conditions: ["workerd", "worker", "browser"], external: ["node:*"],
  minify: true,
});
