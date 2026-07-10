/** Wrapper extension — logique dans lib/galaxy-parse.js */
const G = AstrogameGalaxyParse;

const parseSystemEntries = G.parseSystemEntries;
const groupEntriesByPlayer = G.groupEntriesByPlayer;
const countStoredSystems = G.countStoredSystems;
const countInactivePlanets = G.countInactivePlanets;
const buildPayload = (entries, lastScanned) =>
  G.buildGalaxyPayload(entries, { source: "chrome-extension", lastScanned });
