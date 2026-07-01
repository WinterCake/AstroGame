import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Coins,
  Diamond,
  Droplets,
  Radar,
  Rocket,
  ScanSearch,
  Truck,
  Wallet,
} from "lucide-react";
import { client, watchJob, type Job } from "../api/client";
import { ActiveFleetsPanel } from "../components/ActiveFleetsPanel";
import { IconText, PageTitle } from "../components/IconText";
import { formatAmount } from "../utils/format";

function isPlanetRow(p: { label?: string; isMoon?: boolean }) {
  if (p.isMoon) return false;
  return !/(lune|moon)\s*\(/i.test(p.label ?? "");
}

function mineLevel(value?: number) {
  return value != null && value > 0 ? value : value === 0 ? "0" : "—";
}

function minesSum(p: { metalMine?: number; crystalMine?: number; deutMine?: number; minesTotal?: number }) {
  if (p.minesTotal != null) return p.minesTotal;
  if (p.metalMine == null && p.crystalMine == null && p.deutMine == null) return undefined;
  return (p.metalMine ?? 0) + (p.crystalMine ?? 0) + (p.deutMine ?? 0);
}

export function EmpirePage() {
  const qc = useQueryClient();
  const [selectedCp, setSelectedCp] = useState<number | null>(null);
  const [consolidateTargetCp, setConsolidateTargetCp] = useState<number | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobStatusWarn, setJobStatusWarn] = useState(false);

  const { data: snapshotData, isLoading } = useQuery({
    queryKey: ["empire-snapshot"],
    queryFn: client.empireSnapshot,
  });

  const buildings = useQuery({
    queryKey: ["buildings", selectedCp],
    queryFn: () => client.empireBuildings(selectedCp!),
    enabled: selectedCp != null,
  });

  const scan = useMutation({
    mutationFn: client.empireScan,
    onSuccess: ({ jobId }) => {
      setJobStatusWarn(false);
      setJobStatus("Scan en cours…");
      watchJob(jobId, (job: Job) => {
        const p = job.progress as { index?: number; total?: number; coords?: string };
        if (job.status === "running") {
          if (p.coords) setJobStatus(`${p.index}/${p.total} — ${p.coords}`);
          else setJobStatus("Scan en cours…");
        }
        if (job.status === "completed") {
          setJobStatus("Scan terminé");
          qc.invalidateQueries({ queryKey: ["empire-snapshot"] });
          qc.invalidateQueries({ queryKey: ["empire-planets"] });
          qc.invalidateQueries({ queryKey: ["fleets-active"] });
        }
        if (job.status === "failed") {
          setJobStatusWarn(true);
          setJobStatus(`Erreur : ${job.error}`);
        }
      });
    },
    onError: (e: Error) => {
      setJobStatusWarn(true);
      setJobStatus(`Erreur : ${e.message}`);
    },
  });

  const consolidate = useMutation({
    mutationFn: client.empireConsolidate,
    onSuccess: ({ jobId }) => {
      setJobStatusWarn(false);
      setJobStatus("Consolidation en cours…");
      watchJob(jobId, (job: Job) => {
        const p = job.progress as {
          phase?: string;
          source?: { coords?: string };
          index?: number;
          total?: number;
          message?: string;
        };
        if (job.status === "running") {
          if (p.phase === "start" && p.source?.coords) {
            setJobStatus(`Transport ${p.index}/${p.total} — ${p.source.coords}`);
          } else if (p.message) {
            setJobStatus(p.message);
          } else {
            setJobStatus("Consolidation en cours…");
          }
        }
        if (job.status === "completed") {
          const result = job.result as { sent?: number; targetCoords?: string } | undefined;
          const msg = result?.targetCoords
            ? `Consolidation terminée — ${result.sent ?? 0} vol(s) vers ${result.targetCoords}`
            : "Consolidation terminée";
          const failed = (result as { results?: Array<{ ok: boolean }> } | undefined)?.results?.some(
            (r) => !r.ok
          );
          setJobStatusWarn(Boolean(failed));
          setJobStatus(msg);
          qc.invalidateQueries({ queryKey: ["empire-snapshot"] });
          qc.invalidateQueries({ queryKey: ["fleets-active"] });
        }
        if (job.status === "failed") {
          setJobStatusWarn(true);
          setJobStatus(`Erreur : ${job.error}`);
        }
      });
    },
    onError: (e: Error) => {
      setJobStatusWarn(true);
      setJobStatus(`Erreur : ${e.message}`);
    },
  });

  const snapshot = snapshotData?.snapshot as {
    scannedAt?: string;
    empire?: { metal: number; crystal: number; deut: number; total: number };
    planets?: Array<{
      cp: number;
      coords: string;
      label: string;
      isMoon?: boolean;
      metal: number;
      crystal: number;
      deut: number;
      total: number;
      metalMine?: number;
      crystalMine?: number;
      deutMine?: number;
      minesTotal?: number;
      ships?: Record<string, number>;
    }>;
  } | null;

  const buildingPage = buildings.data as {
    planet?: { label: string; coords: string };
    buildings?: Array<{ id: number; name: string; level: number; upgradeable: boolean; underConstruction: boolean }>;
    constructionQueue?: unknown[];
  } | undefined;

  const planetRows = snapshot?.planets?.filter(isPlanetRow) ?? [];
  const consolidateSources = planetRows.filter((p) => p.cp !== consolidateTargetCp);
  const minesNeedScan = planetRows.length > 0 && planetRows.some((p) => p.metalMine == null);

  return (
    <div className="page page--empire">
      <div className="page-header">
        <PageTitle icon={Building2}>Empire</PageTitle>
        <button type="button" className="btn btn-primary" onClick={() => scan.mutate()} disabled={scan.isPending}>
          <IconText icon={ScanSearch} size={15}>
            Scanner empire
          </IconText>
        </button>
      </div>

      {jobStatus && (
        <p className={`status-msg${jobStatusWarn ? " status-msg--warn" : ""}`}>{jobStatus}</p>
      )}

      {snapshot?.empire && (
        <div className="cards">
          <div className="card card-metal">
            <div className="card-label">
              <IconText icon={Coins} size={14} iconClassName="res-metal">
                Métal
              </IconText>
            </div>
            <div className="card-value">{formatAmount(snapshot.empire.metal)}</div>
          </div>
          <div className="card card-crystal">
            <div className="card-label">
              <IconText icon={Diamond} size={14} iconClassName="res-crystal">
                Cristal
              </IconText>
            </div>
            <div className="card-value">{formatAmount(snapshot.empire.crystal)}</div>
          </div>
          <div className="card card-deut">
            <div className="card-label">
              <IconText icon={Droplets} size={14} iconClassName="res-deut">
                Deut
              </IconText>
            </div>
            <div className="card-value">{formatAmount(snapshot.empire.deut)}</div>
          </div>
          <div className="card highlight">
            <div className="card-label">
              <IconText icon={Wallet} size={14} iconClassName="res-total">
                Total
              </IconText>
            </div>
            <div className="card-value">{formatAmount(snapshot.empire.total)}</div>
          </div>
        </div>
      )}

      {snapshot?.scannedAt && (
        <p className="muted page-meta">Dernier scan : {new Date(snapshot.scannedAt).toLocaleString("fr-FR")}</p>
      )}

      <div className="empire-body">
      <ActiveFleetsPanel className="empire-fleets" />

      {planetRows.length > 0 && (
        <div className="empire-consolidate">
          <label className="source-select source-select--inline">
            <IconText icon={Truck} size={15}>
              Consolider vers
            </IconText>
            <select
              value={consolidateTargetCp ?? ""}
              onChange={(e) => setConsolidateTargetCp(Number(e.target.value) || null)}
            >
              <option value="">Choisir une planète destination…</option>
              {planetRows.map((p) => (
                <option key={p.cp ?? p.coords} value={p.cp ?? ""}>
                  {p.label || p.coords}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!consolidateTargetCp || consolidate.isPending || consolidateSources.length === 0}
            title={
              consolidateSources.length === 0
                ? "Aucune autre planète source"
                : "Chaque planète envoie toutes ses ressources en PT vers la destination"
            }
            onClick={() => {
              if (!consolidateTargetCp) return;
              consolidate.mutate({ targetCp: consolidateTargetCp });
            }}
          >
            <IconText icon={Truck} size={15}>
              {consolidate.isPending
                ? "Envoi…"
                : `Envoyer ressources (${consolidateSources.length} planète${consolidateSources.length > 1 ? "s" : ""})`}
            </IconText>
          </button>
        </div>
      )}

      {isLoading && <p className="page-meta">Chargement…</p>}

      {!snapshot?.planets?.length && !isLoading && (
        <p className="muted">Aucun snapshot — lance un scan pour voir les ressources.</p>
      )}

      {snapshot?.planets && (
        <section className={`empire-tables split split--empire${selectedCp ? "" : " split--solo"}`}>
          <div className="empire-resources-block">
            <h2 className="empire-table-title">
              <IconText icon={Wallet} size={16}>
                Ressources & mines par planète
              </IconText>
              <span className="muted empire-table-count">{planetRows.length} planète{planetRows.length > 1 ? "s" : ""}</span>
            </h2>
            {minesNeedScan && (
              <p className="muted empire-table-hint">Relance un scan empire pour afficher les niveaux de mines.</p>
            )}
            <div className="table-wrap table-wrap--empire">
            <table className="data-table data-table--empire">
              <colgroup>
                <col className="col-coords" />
                <col className="col-res" />
                <col className="col-res" />
                <col className="col-res" />
                <col className="col-res" />
                <col className="col-mine" />
                <col className="col-mine" />
                <col className="col-mine" />
                <col className="col-mine-sum" />
                <col className="col-pt" />
                <col className="col-pt" />
              </colgroup>
              <thead>
                <tr>
                  <th>Coords</th>
                  <th className="col-res">Métal</th>
                  <th className="col-res">Cristal</th>
                  <th className="col-res">Deut</th>
                  <th className="col-res">Total</th>
                  <th className="col-mine">Mine M</th>
                  <th className="col-mine">Mine C</th>
                  <th className="col-mine">Mine D</th>
                  <th className="col-mine-sum">Σ mines</th>
                  <th className="col-pt">
                    PT <Rocket size={12} className="inline-icon" aria-hidden />
                  </th>
                  <th className="col-pt">
                    Sondes <Radar size={12} className="inline-icon" aria-hidden />
                  </th>
                </tr>
              </thead>
              <tbody>
                {planetRows.map((p) => (
                  <tr
                    key={p.cp ?? p.coords}
                    className={selectedCp === p.cp ? "selected" : ""}
                    onClick={() => setSelectedCp(p.cp)}
                  >
                    <td className="col-coords">{p.coords}</td>
                    <td className="col-res">{formatAmount(p.metal)}</td>
                    <td className="col-res">{formatAmount(p.crystal)}</td>
                    <td className="col-res">{formatAmount(p.deut)}</td>
                    <td className="col-res">{formatAmount(p.total)}</td>
                    <td className="col-mine col-mine--metal">{mineLevel(p.metalMine)}</td>
                    <td className="col-mine col-mine--crystal">{mineLevel(p.crystalMine)}</td>
                    <td className="col-mine col-mine--deut">{mineLevel(p.deutMine)}</td>
                    <td className="col-mine-sum">{mineLevel(minesSum(p))}</td>
                    <td className="col-pt">{p.ships?.ship202?.toLocaleString("fr-FR") ?? "—"}</td>
                    <td className="col-pt">{p.ships?.ship210?.toLocaleString("fr-FR") ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          {selectedCp && (
            <aside className="panel">
              <h2>
                <IconText icon={Building2} size={15}>
                  Bâtiments — {buildingPage?.planet?.coords}
                </IconText>
              </h2>
              {buildings.isLoading && <p>Chargement…</p>}
              {buildingPage?.buildings && (
                <ul className="building-list">
                  {buildingPage.buildings.map((b) => (
                    <li key={b.id}>
                      <span className="bid">[{b.id}]</span> {b.name}{" "}
                      <strong>niv. {b.level}</strong>
                      {b.underConstruction && <span className="tag">en cours</span>}
                      {b.upgradeable && !b.underConstruction && <span className="tag ok">OK</span>}
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          )}
        </section>
      )}
      </div>
    </div>
  );
}
