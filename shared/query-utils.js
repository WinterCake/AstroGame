export function isQueryTruthy(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function sortRows(rows, sortBy, sortDir, accessors = {}) {
  const dir = sortDir === "desc" ? -1 : 1;
  const key = sortBy || "coords";
  const get = accessors[key] ?? ((row) => row[key]);
  return [...rows].sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv), "fr", { numeric: true }) * dir;
  });
}

export function filterGalaxyEntries(entries, query) {
  let filtered = entries;

  if (query.inactive === "true") {
    filtered = filtered.filter((e) => e.inactive);
  } else if (query.inactive === "attackable") {
    filtered = filtered.filter((e) => e.isAttackableInactive);
  }

  if (query.vacation === "false") {
    filtered = filtered.filter((e) => !e.onVacation);
  }

  if (query.player) {
    const term = String(query.player).toLowerCase();
    filtered = filtered.filter((e) => e.username?.toLowerCase().includes(term));
  }

  if (query.galaxy) {
    const g = Number(query.galaxy);
    filtered = filtered.filter((e) => e.galaxy === g);
  }

  if (query.system) {
    const s = Number(query.system);
    filtered = filtered.filter((e) => e.system === s);
  }

  if (query.minRank) {
    const min = Number(query.minRank);
    filtered = filtered.filter((e) => (e.rank ?? Infinity) >= min);
  }

  if (query.maxRank) {
    const max = Number(query.maxRank);
    filtered = filtered.filter((e) => (e.rank ?? 0) <= max);
  }

  if (query.search) {
    const term = String(query.search).trim().toLowerCase();
    if (term) {
      filtered = filtered.filter(
        (e) =>
          e.coords?.toLowerCase().includes(term) ||
          e.username?.toLowerCase().includes(term) ||
          e.planetName?.toLowerCase().includes(term) ||
          e.alliance?.tag?.toLowerCase().includes(term)
      );
    }
  }

  return filtered;
}
