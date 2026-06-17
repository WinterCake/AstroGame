import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { paths } from "../src/paths.js";

const EXTRA = `
5	394	11
5	396	7
5	397	9
5	398	5
5	398	10
5	399	5
5	399	6
5	399	7
5	400	13
1	239	10
2	135	9
5	140	7
5	141	7
5	142	6
5	143	3
5	143	6
5	143	11
5	144	5
5	144	6
5	144	7
5	145	7
5	146	7
5	147	7
1	1	12
2	236	8
2	237	1
2	237	10
2	237	11
1	141	6
1	151	10
1	400	6
1	17	8
1	256	8
4	263	5
4	48	3
4	48	8
4	60	8
4	80	8
4	151	8
1	5	7
1	5	8
1	5	9
3	82	7
3	82	8
3	82	9
4	192	6
4	192	15
1	355	8
1	355	14
1	355	15
1	357	15
2	29	5
2	29	7
2	29	9
2	30	4
2	30	6
2	30	8
2	31	5
2	31	7
2	31	9
3	266	7
2	192	5
2	192	7
2	192	8
2	193	8
2	193	9
2	194	3
`.trim();

function loadCoordsFromFile(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^\d+:\d+:\d+$/.test(l));
}

function loadCoordsFromImport(path) {
  if (!existsSync(path)) return [];
  const payload = JSON.parse(readFileSync(path, "utf8"));
  return (payload.attacks ?? []).map((a) => (typeof a === "string" ? a : a.coords)).filter(Boolean);
}

function parseExtra(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split(/\s+/);
      if (parts.length >= 3) return `${parts[0]}:${parts[1]}:${parts[2]}`;
      return null;
    })
    .filter(Boolean);
}

const merged = new Map();
for (const c of [
  ...loadCoordsFromImport(paths.attacks.import()),
  ...loadCoordsFromFile("targets/previous-attacks.txt"),
  ...loadCoordsFromFile("targets/attacks-yesterday.txt"),
  ...parseExtra(EXTRA),
]) {
  merged.set(c, c);
}

const coords = [...merged.values()].sort((a, b) => {
  const [ag, as, ap] = a.split(":").map(Number);
  const [bg, bs, bp] = b.split(":").map(Number);
  return ag - bg || as - bs || ap - bp;
});

const out = "targets/respy-attacked.txt";
writeFileSync(out, `# Re-espionnage — attaques précédentes + coords ajoutées\n${coords.join("\n")}\n`, "utf8");
console.log(`${coords.length} coords uniques → ${out}`);
