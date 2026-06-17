import { getClient } from "../src/client.js";
import { scanEmpireResources } from "../src/empire.js";
import { paths } from "../src/paths.js";

const payload = await scanEmpireResources();
console.log(`\nExport → ${paths.empire.snapshot()}`);
console.log(`Empire total : ${payload.empire.total.toLocaleString("fr-FR")}`);
