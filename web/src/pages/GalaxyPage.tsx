import { useEffect, useRef, useState } from "react";
import { ListPagination } from "../components/ListPagination";
import { usePaginatedQuery } from "../hooks/usePaginatedQuery";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudDownload, Globe2, Radar, RefreshCw } from "lucide-react";
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

const MAX_TARGETS_KEY = "astrogame-spy-max-targets";

type GalaxySortKey = "coords" | "username" | "rank" | "points" | "planetName" | "alliance";

function SpyStatusCell({ spiedToday, everSpied }: { spiedToday?: boolean; everSpied?: boolean }) {
  if (spiedToday) {
    return (
      <span className="spy-badge" title="Espionné aujourd'hui">
        oui
      </span>
    );
  }
  if (everSpied) {
    return (
      <span className="muted" title="Déjà espionné (rapport ou sonde), mais pas aujourd'hui">
        ancien
      </span>
    );
  }
  return (
    <span className="tag" title="Jamais espionné">
      jamais
    </span>
  );
}

export function GalaxyPage() {
  const qc = useQueryClient();
  const { sourceCp } = usePlanetSource();
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
  const [maxTargets, setMaxTargets] = useState(() => localStorage.getItem(MAX_TARGETS_KEY) ?? "");
  const { sortKey, sortDir, toggle } = useSortState<GalaxySortKey>("coords");

  const trimmedSearch = search.trim();

  const { page, setPage, params } = usePaginatedQuery({
    sortKey,
    sortDir,
    filters: {
      inactive: inactive || undefined,
      notSpiedToday: notSpiedToday || neverSpied || undefined,
      neverSpied: neverSpied || undefined,
      search: trimmedSearch || undefined,
      galaxy: galaxy || undefined,
    },
  });

  const meta = useQuery({ queryKey: ["galaxy-meta"], queryFn: client.galaxyMeta });
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["galaxy-entries", params.toString()],
    queryFn: () => client.galaxyEntries(params),
    enabled: meta.data?.exists === true,
  });

  const galaxyScrape = useMutation({
    mutationFn: () => client.galaxyScrape({ all: true, refresh: true }),
    onSuccess: ({ jobId }) => {
      setJobMsgWarn(false);
      setJobMsg("Scan galaxie démarré…");
      watchJob(jobId, (job: Job) => {
        const p = job.progress as {
          scanned?: number;
          total?: number;
          planetEntries?: number;
          message?: string;
        };
        if (job.status === "running") {
          if (p.scanned != null && p.total != null) {
            setJobMsg(
              `Scan galaxie ${p.scanned}/${p.total}` +
                (p.planetEntries != null ? ` — ${p.planetEntries.toLocaleString("fr-FR")} planètes` : "")
            );
          } else {
            setJobMsg(p.message ?? "Scan galaxie en cours…");
          }
        }
        if (job.status === "completed") {
          const result = job.result as { meta?: { planetEntries?: number; systemsScannedThisRun?: number } } | undefined;
          const planets = result?.meta?.planetEntries ?? p.planetEntries;
          const scanned = result?.meta?.systemsScannedThisRun ?? p.scanned;
          setJobMsg(
            `Scan galaxie terminé` +
              (scanned != null ? ` — ${scanned} systèmes` : "") +
              (planets != null ? ` — ${planets.toLocaleString("fr-FR")} planètes` : "")
          );
          qc.invalidateQueries({ queryKey: ["galaxy-meta"] });
          qc.invalidateQueries({ queryKey: ["galaxy-entries"] });
          refetch();
        }
        if (job.status === "failed") {
          setJobMsgWarn(true);
          setJobMsg(`Erreur : ${job.error}`);
        }
      });
    },
    onError: (e: Error) => {
      setJobMsgWarn(true);
      setJobMsg(`Erreur : ${e.message}`);
    },
  });

  const spySend = useMutation({
    mutationFn: (coords: string[]) => {
      const max = maxTargets ? Number(maxTargets) : undefined;
      const toSend = max && max > 0 ? coords.slice(0, max) : coords;
      return client.spySend({
        coords: toSend,
        cp: sourceCp ?? undefined,
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

  function saveMaxTargets(v: string) {
    setMaxTargets(v);
    localStorage.setItem(MAX_TARGETS_KEY, v);
  }

  const scrapeButton = (
    <button
      type="button"
      className="btn btn-primary"
      disabled={galaxyScrape.isPending}
      title="Re-scan complet de toutes les galaxies (écrit data/galaxy/global.json)"
      onClick={() => {
        if (
          !window.confirm(
            "Lancer un scan complet de toutes les galaxies ?\n\nCela peut prendre plusieurs minutes."
          )
        ) {
          return;
        }
        galaxyScrape.mutate();
      }}
    >
      <IconText icon={CloudDownload} size={15}>
        {galaxyScrape.isPending ? "Scan…" : "Scanner toutes les galaxies"}
      </IconText>
    </button>
  );

  if (!meta.data?.exists) {
    return (
      <div className="page">
        <div className="page-header">
          <PageTitle icon={Globe2}>Galaxie</PageTitle>
          <div className="actions">{scrapeButton}</div>
        </div>
        {jobMsg && <p className={`status-msg${jobMsgWarn ? " status-msg--warn" : ""}`}>{jobMsg}</p>}
        <p className="muted">
          Aucun fichier galaxie — lance un scan depuis le jeu, ou{" "}
          <code>npm run galaxy-merge</code>.
        </p>
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
          {scrapeButton}
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
              <th title="oui = aujourd'hui · ancien = déjà espionné · jamais = jamais sondé">Espion.</th>
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
                  <SpyStatusCell spiedToday={e.spiedToday} everSpied={e.everSpied} />
                </td>
                <td className="col-alliance" title={e.alliance?.tag}>{e.alliance?.tag ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ListPagination page={page} onPageChange={setPage} total={data?.total} />
    </div>
  );
}
