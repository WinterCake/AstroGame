import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe2, Radar, RefreshCw } from "lucide-react";
import { client, watchJob, type Job } from "../api/client";
import { IconText, PageTitle } from "../components/IconText";
import { SortableTh, useSortState } from "../components/SortableTh";
import { usePlanetSource } from "../context/PlanetSourceContext";
import { formatAmount } from "../utils/format";
import { handleSpySendJobUpdate } from "../utils/spy-job";
import {
  applyTableRowSelect,
  selectAllTableRows,
  toggleAllTableRows,
  toggleTableRow,
} from "../utils/table-selection";

const PARALLEL_KEY = "astrogame-spy-parallel";
const MAX_TARGETS_KEY = "astrogame-spy-max-targets";

type GalaxySortKey = "coords" | "username" | "rank" | "points" | "planetName" | "alliance";

export function GalaxyPage() {
  const qc = useQueryClient();
  const { sourceCp } = usePlanetSource();
  const [page, setPage] = useState(1);
  const [inactive, setInactive] = useState("true");
  const [notSpiedToday, setNotSpiedToday] = useState(false);
  const [neverSpied, setNeverSpied] = useState(false);
  const [search, setSearch] = useState("");
  const [galaxy, setGalaxy] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [jobMsg, setJobMsg] = useState<string | null>(null);
  const [jobMsgWarn, setJobMsgWarn] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const [parallel, setParallel] = useState(() => localStorage.getItem(PARALLEL_KEY) ?? "13");
  const [maxTargets, setMaxTargets] = useState(() => localStorage.getItem(MAX_TARGETS_KEY) ?? "");
  const { sortKey, sortDir, toggle } = useSortState<GalaxySortKey>("coords");

  const trimmedSearch = search.trim();

  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: "100" });
    if (inactive) p.set("inactive", inactive);
    if (notSpiedToday || neverSpied) p.set("notSpiedToday", "true");
    if (neverSpied) p.set("neverSpied", "true");
    if (trimmedSearch) p.set("search", trimmedSearch);
    if (galaxy) p.set("galaxy", galaxy);
    p.set("sortBy", sortKey);
    p.set("sortDir", sortDir);
    return p;
  }, [page, inactive, notSpiedToday, neverSpied, trimmedSearch, galaxy, sortKey, sortDir]);

  const meta = useQuery({ queryKey: ["galaxy-meta"], queryFn: client.galaxyMeta });
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["galaxy-entries", params.toString()],
    queryFn: () => client.galaxyEntries(params),
    enabled: meta.data?.exists === true,
  });

  const spySend = useMutation({
    mutationFn: (coords: string[]) => {
      const max = maxTargets ? Number(maxTargets) : undefined;
      const toSend = max && max > 0 ? coords.slice(0, max) : coords;
      return client.spySend({
        coords: toSend,
        cp: sourceCp ?? undefined,
        parallel: Number(parallel) || 13,
        maxTargets: max,
      });
    },
    onSuccess: ({ jobId }) => {
      setJobMsgWarn(false);
      setJobMsg("Espionnage lancé…");
      watchJob(jobId, (job: Job) => {
        handleSpySendJobUpdate(job, selected.size, setJobMsg, setJobMsgWarn, () => {
          refetch();
          qc.invalidateQueries({ queryKey: ["spy-reports"] });
        });
      });
    },
    onError: (e: Error) => setJobMsg(`Erreur : ${e.message}`),
  });

  const entries = data?.entries ?? [];

  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAllTableRows(entries, (entry) => entry.coords, setSelected);
      }
    };
    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [entries]);

  function handleRowSelect(coords: string, event: React.MouseEvent) {
    const nextAnchor = applyTableRowSelect(
      coords,
      event,
      entries,
      (entry) => entry.coords,
      selectionAnchor,
      setSelected
    );
    setSelectionAnchor(nextAnchor);
  }

  function toggleCoord(coords: string) {
    toggleTableRow(coords, setSelected);
    setSelectionAnchor(coords);
  }

  function toggleAllVisible() {
    toggleAllTableRows(entries, (entry) => entry.coords, selected, setSelected);
  }

  function saveParallel(v: string) {
    setParallel(v);
    localStorage.setItem(PARALLEL_KEY, v);
  }

  function saveMaxTargets(v: string) {
    setMaxTargets(v);
    localStorage.setItem(MAX_TARGETS_KEY, v);
  }

  if (!meta.data?.exists) {
    return (
      <div className="page">
        <h1>Galaxie</h1>
        <p className="muted">Aucun fichier galaxie — lance <code>npm run galaxy-merge</code> ou un scrape.</p>
      </div>
    );
  }

  const effectiveCount = maxTargets
    ? Math.min(selected.size, Number(maxTargets) || selected.size)
    : selected.size;

  return (
    <div className="page page--table">
      <div className="page-header">
        <PageTitle icon={Globe2}>Galaxie</PageTitle>
        <div className="actions">
          <button type="button" className="btn" onClick={() => refetch()}>
            <IconText icon={RefreshCw} size={15}>
              Rafraîchir
            </IconText>
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!selected.size || spySend.isPending}
            title={
              sourceCp
                ? undefined
                : "Planète source non définie — choisis un monde dans l'en-tête si l'envoi échoue."
            }
            onClick={() => spySend.mutate([...selected])}
          >
            <IconText icon={Radar} size={15}>
              Espionner ({effectiveCount})
            </IconText>
          </button>
        </div>
      </div>

      {jobMsg && <p className={`status-msg${jobMsgWarn ? " status-msg--warn" : ""}`}>{jobMsg}</p>}

      <div className="filters">
        <input
          placeholder="Recherche joueur / coords"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          onBlur={(e) => {
            const trimmed = e.target.value.trim();
            if (trimmed !== search) {
              setSearch(trimmed);
              setPage(1);
            }
          }}
        />
        <select value={inactive} onChange={(e) => { setInactive(e.target.value); setPage(1); }}>
          <option value="">Tous</option>
          <option value="true">Inactifs</option>
          <option value="attackable">Inactifs attaquables</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={notSpiedToday || neverSpied}
            disabled={neverSpied}
            onChange={(e) => { setNotSpiedToday(e.target.checked); setPage(1); }}
          />
          Pas espionné aujourd&apos;hui
        </label>
        <label>
          <input
            type="checkbox"
            checked={neverSpied}
            onChange={(e) => {
              const checked = e.target.checked;
              setNeverSpied(checked);
              if (checked) setNotSpiedToday(true);
              setPage(1);
            }}
          />
          Jamais espionné
        </label>
        <input
          placeholder="Galaxie #"
          value={galaxy}
          onChange={(e) => { setGalaxy(e.target.value); setPage(1); }}
          style={{ width: 80 }}
        />
        <label className="inline-label">
          Espionnages simultanés
          <input
            type="number"
            min={1}
            max={50}
            value={parallel}
            onChange={(e) => saveParallel(e.target.value)}
            style={{ width: 64 }}
            title="Nombre de sondes envoyées en parallèle (slots flotte)"
          />
        </label>
        <label className="inline-label">
          Max cibles
          <input
            type="number"
            min={1}
            placeholder="∞"
            value={maxTargets}
            onChange={(e) => saveMaxTargets(e.target.value)}
            style={{ width: 72 }}
            title="Limite le nombre de coords espionnées par clic"
          />
        </label>
      </div>

      <p className="muted page-meta">
        {data?.total?.toLocaleString("fr-FR")} planètes — page {data?.page}/{data?.totalPages}
        {data?.spiedToday != null && ` — ${data.spiedToday} espionné(s) aujourd'hui`}
        {neverSpied && data?.allSpied != null && ` — ${data.allSpied} exclue(s) (archive espionnage)`}
        {` — sélection : ${selected.size}`}
      </p>

      {isLoading && <p className="page-meta">Chargement…</p>}

      <div className="table-wrap table-wrap--fill" ref={tableRef} tabIndex={0}>
        <table className="data-table">
          <colgroup>
            <col className="col-check" />
            <col className="col-coords" />
            <col className="col-player" />
            <col className="col-rank" />
            <col className="col-points" />
            <col className="col-planet" />
            <col className="col-status" />
            <col className="col-flag" />
            <col className="col-alliance" />
          </colgroup>
          <thead>
            <tr>
              <th className="col-check">
                <input
                  type="checkbox"
                  checked={entries.length > 0 && entries.every((e) => selected.has(e.coords))}
                  onChange={toggleAllVisible}
                  aria-label="Tout sélectionner sur cette page"
                />
              </th>
              <SortableTh label="Coords" active={sortKey === "coords"} dir={sortDir} onClick={() => { toggle("coords"); setPage(1); }} />
              <SortableTh label="Joueur" active={sortKey === "username"} dir={sortDir} onClick={() => { toggle("username"); setPage(1); }} />
              <SortableTh label="Rang" active={sortKey === "rank"} dir={sortDir} onClick={() => { toggle("rank"); setPage(1); }} />
              <SortableTh label="Points" active={sortKey === "points"} dir={sortDir} onClick={() => { toggle("points"); setPage(1); }} />
              <SortableTh label="Planète" active={sortKey === "planetName"} dir={sortDir} onClick={() => { toggle("planetName"); setPage(1); }} />
              <th>Statut</th>
              <th>Espion.</th>
              <SortableTh label="Alliance" active={sortKey === "alliance"} dir={sortDir} onClick={() => { toggle("alliance"); setPage(1); }} />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr
                key={e.coords}
                className={[selected.has(e.coords) ? "selected" : "", "row-clickable"].filter(Boolean).join(" ")}
                onClick={(event) => handleRowSelect(e.coords, event)}
              >
                <td className="col-check">
                  <input
                    type="checkbox"
                    checked={selected.has(e.coords)}
                    onClick={(ev) => ev.stopPropagation()}
                    onChange={() => toggleCoord(e.coords)}
                  />
                </td>
                <td className="col-coords" title={e.coords}>{e.coords}</td>
                <td className="col-player" title={e.username}>{e.username}</td>
                <td className="col-rank">{e.rank}</td>
                <td className="col-points col-num">{formatAmount(e.points)}</td>
                <td className="col-planet" title={e.planetName}>{e.planetName}</td>
                <td className="col-status">
                  {e.onVacation && <span className="tag">VM</span>}
                  {e.isAttackableInactive && <span className="tag warn">inactif</span>}
                  {!e.inactive && !e.onVacation && <span className="tag ok">actif</span>}
                </td>
                <td className="col-flag">
                  {e.spiedToday ? (
                    <span className="spy-badge">oui</span>
                  ) : e.everSpied ? (
                    <span className="muted" title="Déjà espionné, mais pas aujourd'hui">ancien</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="col-alliance" title={e.alliance?.tag}>{e.alliance?.tag ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Précédent
        </button>
        <span>Page {page}</span>
        <button
          type="button"
          className="btn"
          disabled={!data || page >= (data.totalPages ?? 1)}
          onClick={() => setPage((p) => p + 1)}
        >
          Suivant
        </button>
      </div>
    </div>
  );
}
