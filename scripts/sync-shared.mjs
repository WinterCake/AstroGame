#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHARED = join(ROOT, "shared");
const OUT = join(ROOT, "chrome-extension", "lib");

const SIMPLE_MODULES = ["spy-core", "galaxy-activity", "attacks-core", "verdict", "spy-labels"];
const COMPOSITE_MODULES = {
  "galaxy-parse": ["galaxy-activity", "galaxy-parse"],
};

function pascalCase(name) {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function stripModuleSource(src) {
  return src.replace(/^import .+;\s*/gm, "").replace(/^export /gm, "");
}

function buildBrowserBundle(name, body, exportNames) {
  const globalName = `Astrogame${pascalCase(name)}`;
  return `// Généré par npm run sync:shared — ne pas éditer à la main
var ${globalName} = (function() {
${body}
return { ${exportNames.join(", ")} };
})();
`;
}

function collectExports(src) {
  return [...src.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]);
}

mkdirSync(OUT, { recursive: true });

for (const name of SIMPLE_MODULES) {
  const src = readFileSync(join(SHARED, `${name}.js`), "utf8");
  writeFileSync(
    join(OUT, `${name}.js`),
    buildBrowserBundle(name, stripModuleSource(src), collectExports(src)),
    "utf8"
  );
}

const labelsSrc = stripModuleSource(readFileSync(join(SHARED, "spy-labels.js"), "utf8")).replace(
  /^const /gm,
  "var "
);
writeFileSync(
  join(ROOT, "chrome-extension", "spy-labels.js"),
  `// Généré par npm run sync:shared — ne pas éditer à la main\n${labelsSrc}`,
  "utf8"
);

for (const [name, deps] of Object.entries(COMPOSITE_MODULES)) {
  const mainSrc = readFileSync(join(SHARED, `${name}.js`), "utf8");
  const body = [...deps, name]
    .map((part) => stripModuleSource(readFileSync(join(SHARED, `${part}.js`), "utf8")))
    .join("\n\n");
  writeFileSync(join(OUT, `${name}.js`), buildBrowserBundle(name, body, collectExports(mainSrc)), "utf8");
}

console.log(
  `Synced ${SIMPLE_MODULES.length + Object.keys(COMPOSITE_MODULES).length} modules → chrome-extension/lib/ + spy-labels.js`
);
