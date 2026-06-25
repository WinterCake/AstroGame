import { mkdirSync, writeFileSync } from "node:fs";
import { getClient } from "../src/client.js";
import { parseCombatReportsHtml } from "../src/combat-reports.js";

mkdirSync("data/combat", { recursive: true });
const client = await getClient();

for (const cat of [100, 1, 2, 3, 4, 5, 99]) {
  const res = await client.get(`game/messages/view?messcat=${cat}&site=1&ajax=1`, {
    headers: { "X-Requested-With": "XMLHttpRequest" },
    transformResponse: [(d) => d],
  });
  const html = String(res.data);
  const reports = parseCombatReportsHtml(html);
  console.log(`messcat=${cat} len=${html.length} reports=${reports.length} bataille=${/bataille/i.test(html)}`);
}

const res = await client.get("game/messages/view?messcat=100&site=1&ajax=1", {
  headers: { "X-Requested-With": "XMLHttpRequest" },
  transformResponse: [(d) => d],
});
const html = String(res.data);
writeFileSync("data/combat/sample-page1.html", html, "utf8");

const detailId = html.match(/data-message-id="(\d+)"/)?.[1];
if (detailId) {
  for (const url of [
    `game/messages/view?messcat=100&messageID=${detailId}&ajax=1`,
    `game/messages/view?messcat=100&msgID=${detailId}&ajax=1`,
    `game/messages/read?messageID=${detailId}&ajax=1`,
  ]) {
    try {
      const d = await client.get(url, {
        headers: { "X-Requested-With": "XMLHttpRequest" },
        transformResponse: [(x) => x],
      });
      writeFileSync(`data/combat/detail-${detailId}-${url.split("?")[1].replace(/[&=]/g, "_")}.html`, String(d.data), "utf8");
      console.log("detail ok", url, String(d.data).length);
    } catch (e) {
      console.log("detail fail", url, e.message);
    }
  }
}

const reports = parseCombatReportsHtml(html);
console.log("parsed sample", JSON.stringify(reports[0], null, 2)?.slice(0, 2000));

const raport = html.match(/combatReport\?raport=([a-f0-9]+)/)?.[1];
if (raport) {
  const full = await client.get(`game/combatReport?raport=${raport}`, {
    transformResponse: [(d) => d],
  });
  writeFileSync("data/combat/full-report.html", String(full.data), "utf8");
  console.log("full report len", String(full.data).length);
}
