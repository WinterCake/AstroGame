import { getClient } from "../src/client.js";
import * as cheerio from "cheerio";

const client = await getClient();

function parseRes(html) {
  const $ = cheerio.load(html);
  const num = (id) => Number($(id).text().replace(/\./g, "").replace(",", ".")) || 0;
  const metal = num("#current_metal");
  const crystal = num("#current_crystal");
  const deut = num("#current_deuterium");
  return { metal, crystal, deut, total: metal + crystal + deut };
}

const ov = String((await client.get("game/overview")).data);
const $ = cheerio.load(ov);
const planets = [];
$("#planetSelector option").each((_, el) => {
  const node = $(el);
  planets.push({ cp: node.attr("value"), coords: node.text().match(/\[(\d+:\d+:\d+)\]/)?.[1] });
});

let empire = { metal: 0, crystal: 0, deut: 0, total: 0 };
for (const p of planets) {
  const html = String((await client.get(`game/overview?cp=${p.cp}`)).data);
  const $p = cheerio.load(html);
  const metal = Number($p("#current_metal").text()) || 0;
  const crystal = Number($p("#current_crystal").text()) || 0;
  const deut = Number($p("#current_deuterium").text()) || 0;
  const r = { metal, crystal, deut, total: metal + crystal + deut };
  empire.metal += r.metal;
  empire.crystal += r.crystal;
  empire.deut += r.deut;
  empire.total += r.total;
  if (p.coords?.startsWith("4:36") || r.total > 1e9) {
    console.log(p.coords, `${(r.metal/1e9).toFixed(2)}M / ${(r.crystal/1e9).toFixed(2)}C / ${(r.deut/1e9).toFixed(2)}D`);
  }
}
console.log("\nEMPIRE TOTAL:", `${(empire.metal/1e9).toFixed(2)} Md métal, ${(empire.crystal/1e9).toFixed(2)} Md cristal, ${(empire.deut/1e9).toFixed(2)} Md deut`);
