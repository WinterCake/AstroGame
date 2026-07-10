import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));

let cached = null;

/** Charge chrome-extension/lib/spy-core.js (généré depuis shared/). */
export function loadExtensionSpyCore() {
  if (cached) return cached;

  const code = readFileSync(join(__dirname, "../../chrome-extension/lib/spy-core.js"), "utf8");
  const context = {
    atob: (s) => Buffer.from(s, "base64").toString("utf8"),
    console,
    JSON,
    Math,
    Date,
    Number,
    String,
    Object,
    Array,
    Map,
    Set,
    RegExp,
  };

  runInNewContext(code, context);
  cached = context.AstrogameSpyCore;
  return cached;
}

/** @deprecated utiliser loadExtensionSpyCore */
export function loadExtensionSpyParse() {
  return loadExtensionSpyCore();
}
