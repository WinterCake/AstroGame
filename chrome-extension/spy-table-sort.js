const SPY_DEFAULT_SORT = { key: "date", dir: "desc" };

function getSpySortValue(report, key, attacksStore) {
  switch (key) {
    case "date":
      return report.timestamp ?? 0;
    case "coords":
      return (
        (Number(report.galaxy) || 0) * 1_000_000 +
        (Number(report.system) || 0) * 1_000 +
        (Number(report.position) || 0)
      );
    case "username":
      return String(report.username ?? "").toLowerCase();
    case "planet":
      return String(report.planetName ?? "").toLowerCase();
    case "loot":
      return Number(report.loot) || 0;
    case "fleet":
      return Number(report.fleet) || 0;
    case "defense":
      return Number(report.defense) || 0;
    case "verdict":
      return String(report.verdict ?? "").toLowerCase();
    case "status":
      return isCoordAttackedToday(report.coords, attacksStore) ? 1 : 0;
    default:
      return 0;
  }
}

function sortSpyReports(reports, key, dir, attacksStore) {
  const direction = dir === "asc" ? 1 : -1;
  const sorted = [...reports];

  sorted.sort((left, right) => {
    const leftValue = getSpySortValue(left, key, attacksStore);
    const rightValue = getSpySortValue(right, key, attacksStore);

    if (typeof leftValue === "string") {
      return leftValue.localeCompare(rightValue, "fr") * direction;
    }

    if (leftValue === rightValue) {
      return (right.timestamp ?? 0) - (left.timestamp ?? 0);
    }

    return (leftValue - rightValue) * direction;
  });

  return sorted;
}

function defaultSortDirForKey(key) {
  if (key === "date" || key === "loot" || key === "fleet" || key === "defense") {
    return "desc";
  }
  return "asc";
}

function toggleSpySort(state, key) {
  if (state.key === key) {
    return { key, dir: state.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: defaultSortDirForKey(key) };
}

function updateSpySortHeaders(thead, sortState) {
  if (!thead) return;

  thead.querySelectorAll("[data-sort]").forEach((header) => {
    const label = header.dataset.label ?? header.textContent.trim();
    const key = header.dataset.sort;
    const indicator = key === sortState.key ? (sortState.dir === "asc" ? " ▲" : " ▼") : "";
    header.textContent = `${label}${indicator}`;
    header.classList.toggle("sort-active", key === sortState.key);
  });
}

function bindSpySortHeaders(thead, getSortState, setSortState, onSorted) {
  if (!thead || thead.dataset.sortBound === "1") return;
  thead.dataset.sortBound = "1";

  thead.addEventListener("click", (event) => {
    const header = event.target.closest("[data-sort]");
    if (!header) return;

    const next = toggleSpySort(getSortState(), header.dataset.sort);
    setSortState(next);
    updateSpySortHeaders(thead, next);
    onSorted();
  });
}
