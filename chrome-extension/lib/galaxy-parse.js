// Généré par npm run sync:shared — ne pas éditer à la main
var AstrogameGalaxyParse = (function() {
/**
 * Statuts joueur issus de user.class (API galaxy/ajax).
 */
function derivePlayerActivity(slot) {
  const classes = Array.isArray(slot?.user?.class) ? [...slot.user.class] : [];
  const lastActivity = slot?.lastActivity ?? "";
  const rawMinutes = slot?.lastActivityNum;
  const lastActivityMinutes =
    rawMinutes !== "" && rawMinutes != null && !Number.isNaN(Number(rawMinutes))
      ? Number(rawMinutes)
      : null;

  const onVacation = classes.includes("vacation");
  const inactive = classes.includes("inactive");
  const isNoob = classes.includes("noob");
  const isStrong = classes.includes("strong");

  let activityLabel;
  if (onVacation) {
    activityLabel = "Vacances";
  } else if (inactive) {
    activityLabel = "Inactif (7j+)";
  } else if (lastActivity === "(*)") {
    activityLabel = "En ligne";
  } else if (lastActivity) {
    activityLabel = `Actif ${lastActivity}`;
  } else {
    activityLabel = "Actif";
  }

  return {
    playerClasses: classes,
    inactive,
    onVacation,
    isNoob,
    isStrong,
    activityLabel,
    lastActivity: lastActivity || null,
    lastActivityMinutes,
    isAttackableInactive: inactive && !onVacation,
  };
}


function parseSystemEntries(galaxy, system, existsPlanets) {
  const entries = [];

  for (const [position, slot] of Object.entries(existsPlanets ?? {})) {
    if (!slot || slot === false || !slot.user?.username || !slot.planet?.id) continue;

    const g = Number(galaxy);
    const s = Number(system);
    const p = Number(position);
    const activity = derivePlayerActivity(slot);

    entries.push({
      coords: `${g}:${s}:${p}`,
      galaxy: g,
      system: s,
      position: p,
      planetId: slot.planet.id,
      planetName: slot.planet.name,
      playerId: slot.user.id,
      username: slot.user.username,
      rank: Number(slot.user.rank) || slot.user.rank,
      points: slot.user.points,
      alliance: slot.alliance
        ? {
            id: slot.alliance.id,
            tag: slot.alliance.tag,
            name: slot.alliance.name,
            rank: slot.alliance.rank,
          }
        : null,
      moon: slot.moon
        ? {
            id: slot.moon.id,
            name: slot.moon.name,
            diameter: slot.moon.diameter,
            tempMin: slot.moon.temp_min,
          }
        : null,
      debris: slot.debris
        ? {
            metal: slot.debris.metal,
            crystal: slot.debris.crystal,
          }
        : null,
      ownPlanet: Boolean(slot.ownPlanet),
      isEnemy: Boolean(slot.user.isEnemy),
      ...activity,
    });
  }

  return entries;
}

function groupEntriesByPlayer(entries) {
  const players = new Map();

  for (const entry of entries) {
    if (!players.has(entry.playerId)) {
      players.set(entry.playerId, {
        playerId: entry.playerId,
        username: entry.username,
        rank: entry.rank,
        points: entry.points,
        alliance: entry.alliance,
        inactive: entry.inactive,
        onVacation: entry.onVacation,
        activityLabel: entry.activityLabel,
        planets: [],
      });
    }

    const player = players.get(entry.playerId);
    player.planets.push({
      coords: entry.coords,
      galaxy: entry.galaxy,
      system: entry.system,
      position: entry.position,
      planetId: entry.planetId,
      planetName: entry.planetName,
      moon: entry.moon,
      debris: entry.debris,
      activityLabel: entry.activityLabel,
      inactive: entry.inactive,
      onVacation: entry.onVacation,
      lastActivity: entry.lastActivity,
      ownPlanet: entry.ownPlanet,
      isEnemy: entry.isEnemy,
    });
  }

  return [...players.values()].sort((a, b) => a.username.localeCompare(b.username));
}

function countStoredSystems(entries) {
  return new Set(entries.map((entry) => `${entry.galaxy}:${entry.system}`)).size;
}

function countInactivePlanets(entries) {
  return entries.filter((entry) => entry.inactive).length;
}

function buildGalaxyPayload(entries, meta = {}) {
  const players = groupEntriesByPlayer(entries);
  return {
    meta: {
      scrapedAt: new Date().toISOString(),
      systemsStored: countStoredSystems(entries),
      planetEntries: entries.length,
      uniquePlayers: players.length,
      inactivePlanets: countInactivePlanets(entries),
      attackableInactivePlanets: entries.filter((e) => e.isAttackableInactive).length,
      ...meta,
    },
    entries,
    players,
  };
}


function parseSystemEntries(galaxy, system, existsPlanets) {
  const entries = [];

  for (const [position, slot] of Object.entries(existsPlanets ?? {})) {
    if (!slot || slot === false || !slot.user?.username || !slot.planet?.id) continue;

    const g = Number(galaxy);
    const s = Number(system);
    const p = Number(position);
    const activity = derivePlayerActivity(slot);

    entries.push({
      coords: `${g}:${s}:${p}`,
      galaxy: g,
      system: s,
      position: p,
      planetId: slot.planet.id,
      planetName: slot.planet.name,
      playerId: slot.user.id,
      username: slot.user.username,
      rank: Number(slot.user.rank) || slot.user.rank,
      points: slot.user.points,
      alliance: slot.alliance
        ? {
            id: slot.alliance.id,
            tag: slot.alliance.tag,
            name: slot.alliance.name,
            rank: slot.alliance.rank,
          }
        : null,
      moon: slot.moon
        ? {
            id: slot.moon.id,
            name: slot.moon.name,
            diameter: slot.moon.diameter,
            tempMin: slot.moon.temp_min,
          }
        : null,
      debris: slot.debris
        ? {
            metal: slot.debris.metal,
            crystal: slot.debris.crystal,
          }
        : null,
      ownPlanet: Boolean(slot.ownPlanet),
      isEnemy: Boolean(slot.user.isEnemy),
      ...activity,
    });
  }

  return entries;
}

function groupEntriesByPlayer(entries) {
  const players = new Map();

  for (const entry of entries) {
    if (!players.has(entry.playerId)) {
      players.set(entry.playerId, {
        playerId: entry.playerId,
        username: entry.username,
        rank: entry.rank,
        points: entry.points,
        alliance: entry.alliance,
        inactive: entry.inactive,
        onVacation: entry.onVacation,
        activityLabel: entry.activityLabel,
        planets: [],
      });
    }

    const player = players.get(entry.playerId);
    player.planets.push({
      coords: entry.coords,
      galaxy: entry.galaxy,
      system: entry.system,
      position: entry.position,
      planetId: entry.planetId,
      planetName: entry.planetName,
      moon: entry.moon,
      debris: entry.debris,
      activityLabel: entry.activityLabel,
      inactive: entry.inactive,
      onVacation: entry.onVacation,
      lastActivity: entry.lastActivity,
      ownPlanet: entry.ownPlanet,
      isEnemy: entry.isEnemy,
    });
  }

  return [...players.values()].sort((a, b) => a.username.localeCompare(b.username));
}

function countStoredSystems(entries) {
  return new Set(entries.map((entry) => `${entry.galaxy}:${entry.system}`)).size;
}

function countInactivePlanets(entries) {
  return entries.filter((entry) => entry.inactive).length;
}

function buildGalaxyPayload(entries, meta = {}) {
  const players = groupEntriesByPlayer(entries);
  return {
    meta: {
      scrapedAt: new Date().toISOString(),
      systemsStored: countStoredSystems(entries),
      planetEntries: entries.length,
      uniquePlayers: players.length,
      inactivePlanets: countInactivePlanets(entries),
      attackableInactivePlanets: entries.filter((e) => e.isAttackableInactive).length,
      ...meta,
    },
    entries,
    players,
  };
}

return { parseSystemEntries, groupEntriesByPlayer, countStoredSystems, countInactivePlanets, buildGalaxyPayload };
})();
