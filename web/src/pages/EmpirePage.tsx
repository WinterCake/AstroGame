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
  Wallet,
} from "lucide-react";
import { client, watchJob, type Job } from "../api/client";
import { ActiveFleetsPanel } from "../components/ActiveFleetsPanel";
import { IconText, PageTitle } from "../components/IconText";
import { formatAmount } from "../utils/format";

export function EmpirePage() {
  const qc = useQueryClient();
  const [selectedCp, setSelectedCp] = useState<number | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);

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
        if (job.status === "failed") setJobStatus(`Erreur : ${job.error}`);
      });
    },
    onError: (e: Error) => setJobStatus(`Erreur : ${e.message}`),
  });

  const snapshot = snapshotData?.snapshot as {
    scannedAt?: string;
    empire?: { metal: number; crystal: number; deut: number; total: number };
    planets?: Array<{
      cp: number;
      coords: string;
      label: string;
      metal: number;
      crystal: number;
      deut: number;
      total: number;
      ships?: Record<string, number>;
    }>;
  } | null;

  const buildingPage = buildings.data as {
    planet?: { label: string; coords: string };
    buildings?: Array<{ id: number; name: string; level: number; upgradeable: boolean; underConstruction: boolean }>;
    constructionQueue?: unknown[];
  } | undefined;

  return (
    <div className={`page${snapshot?.planets?.length ? " page--table" : ""}`}>
      <div className="page-header">
        <PageTitle icon={Building2}>Empire</PageTitle>
        <button type="button" className="btn btn-primary" onClick={() => scan.mutate()} disabled={scan.isPending}>
          <IconText icon={ScanSearch} size={15}>
            Scanner ressources
          </IconText>
        </button>
      </div>

      {jobStatus && <p className="status-msg">{jobStatus}</p>}

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

      <ActiveFleetsPanel className="empire-fleets" />

      {isLoading && <p className="page-meta">Chargement…</p>}

      {!snapshot?.planets?.length && !isLoading && (
        <p className="muted">Aucun snapshot — lance un scan pour voir les ressources.</p>
      )}

      {snapshot?.planets && (
        <div className={`split split--fill${selectedCp ? "" : " split--solo"}`}>
          <div className="table-wrap table-wrap--fill">
            <table className="data-table">
              <colgroup>
                <col className="col-coords" />
                <col className="col-res" />
                <col className="col-res" />
                <col className="col-res" />
                <col className="col-res" />
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
                  <th className="col-pt">
                    PT <Rocket size={12} className="inline-icon" aria-hidden />
                  </th>
                  <th className="col-pt">
                    Sondes <Radar size={12} className="inline-icon" aria-hidden />
                  </th>
                </tr>
              </thead>
              <tbody>
                {snapshot.planets.map((p) => (
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
                    <td className="col-pt">{p.ships?.ship202?.toLocaleString("fr-FR") ?? "—"}</td>
                    <td className="col-pt">{p.ships?.ship210?.toLocaleString("fr-FR") ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
        </div>
      )}
    </div>
  );
}
