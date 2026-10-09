import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { builtinModules } from "node:module";

const production = process.argv[2] === "production";
// Set NOTION_IMPORT_PLUGIN_DIR to a vault's .obsidian/plugins/notion-import folder to build straight into it.
const outputDirectory = process.env.NOTION_IMPORT_PLUGIN_DIR ?? path.resolve("dist");
fs.mkdirSync(outputDirectory, { recursive: true });

const copyReleaseFiles = {
  name: "copy-release-files",
  setup(build) {
    build.onEnd(result => {
      if (result.errors.length) return;
      for (const name of ["manifest.json", "styles.css"]) {
        fs.copyFileSync(path.resolve(name), path.join(outputDirectory, name));
      }
    });
  },
};

const options = {
  entryPoints: ["src/main.ts"],
  outfile: path.join(outputDirectory, "main.js"),
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2022",
  sourcemap: production ? false : "inline",
  minify: production,
  treeShaking: true,
  logLevel: "info",
  external: ["obsidian", "electron", "@codemirror/state", "@codemirror/view", ...builtinModules],
  plugins: [copyReleaseFiles],
};

if (production) await esbuild.build(options);
else {
  const context = await esbuild.context(options);
  await context.watch();
}
