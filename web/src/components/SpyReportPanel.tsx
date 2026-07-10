import { Crosshair, FileSearch, Radar, Trash2 } from "lucide-react";
import type { SpyReport } from "../api/client";
import { IconText } from "./IconText";
import { DetailPanel } from "./DetailPanel";
import { buildSpyDetailSections, formatSpyReportDate, verdictTone } from "../utils/spy-detail";
import { formatPlayerActivity } from "../utils/player-activity";
import { PlayerActivityTag } from "./PlayerActivityTag";

type Props = {
  report: SpyReport | null;
  loading?: boolean;
  onClose?: () => void;
  onSendToAttacks?: (coords: string) => void;
  onRespy?: (coords: string) => void;
  respyDisabled?: boolean;
  respyPending?: boolean;
  onDelete?: (coords: string) => void;
  deletePending?: boolean;
};

export function SpyReportPanel({
  report,
  loading,
  onClose,
  onSendToAttacks,
  onRespy,
  respyDisabled,
  respyPending,
  onDelete,
  deletePending,
}: Props) {
  const sections = report ? buildSpyDetailSections(report) : null;
  const mines =
    report?.metalMine || report?.crystalMine || report?.deutMine
      ? `M${report.metalMine ?? 0} · C${report.crystalMine ?? 0} · D${report.deutMine ?? 0}`
      : null;
  const attackedToday = report?.attackedToday ?? report?.alreadyAttacked;
  const activity = report ? formatPlayerActivity(report) : null;

  return (
    <DetailPanel
      title="Rapport"
      icon={FileSearch}
      emptyMessage="Clique sur un rapport pour voir le détail raccourci."
      report={report}
      onClose={onClose}
      loading={loading}
      loadingMessage="Chargement du détail…"
      unavailable={!loading && !sections}
      unavailableMessage={
        <>
          Détail indisponible pour ce rapport.
          <br />
          Relance <strong>Sync depuis le jeu</strong> pour récupérer flotte et défense.
        </>
      }
      header={
        report ? (
          <header className="spy-detail-header">
            <h3>
              {report.planetName || "Planète"}{" "}
              <span className="spy-detail-coords">[{report.coords}]</span>
            </h3>
            <p className="spy-detail-meta">
              <strong>{report.username}</strong>
              {" · "}
              {formatSpyReportDate(report)}
              {report.verdict && (
                <>
                  {" · "}
                  <span className={verdictTone(report.verdict)}>{report.verdict}</span>
                </>
              )}
            </p>
            <p className="spy-detail-activity">
              <PlayerActivityTag report={report} />
              {activity && activity.tone !== "unknown" && activity.title !== activity.short && (
                <span className="spy-detail-activity-label">{activity.title}</span>
              )}
            </p>
            {attackedToday ? (
              <p className="spy-attack-status spy-attack-status--done">Déjà attaqué aujourd&apos;hui</p>
            ) : (
              <p className="spy-attack-status">Pas encore attaqué aujourd&apos;hui</p>
            )}
            {(report.targetChance != null || report.spyChance != null) && (
              <p className="spy-detail-chances">
                Destruction {report.targetChance ?? "?"}% · Espionnage {report.spyChance ?? "?"}%
              </p>
            )}
            {mines && <p className="spy-detail-mines">Mines {mines}</p>}
          </header>
        ) : undefined
      }
      actions={
        report && (onSendToAttacks || onRespy || onDelete) ? (
          <>
            {onRespy && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={respyDisabled || respyPending}
                onClick={() => onRespy(report.coords)}
              >
                <IconText icon={Radar} size={15}>
                  {respyPending ? "Espionnage…" : "Espionner de nouveau"}
                </IconText>
              </button>
            )}
            {onSendToAttacks && (
              <button type="button" className="btn" onClick={() => onSendToAttacks(report.coords)}>
                <IconText icon={Crosshair} size={15}>
                  Vers attaques
                </IconText>
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                className="btn btn-danger"
                disabled={deletePending}
                onClick={() => onDelete(report.coords)}
              >
                <IconText icon={Trash2} size={15}>
                  Supprimer
                </IconText>
              </button>
            )}
          </>
        ) : undefined
      }
    >
      {sections && (
        <div className="spy-detail-sections">
          {sections.map((section) => (
            <section key={section.title} className="spy-detail-section">
              <div className="spy-detail-section-head">
                <h4>{section.title}</h4>
                <span className="spy-detail-total">Total {section.total}</span>
              </div>
              <ul className="spy-detail-list">
                {section.items.length ? (
                  section.items.map((item) => (
                    <li key={item.id}>
                      <span className="spy-detail-name">{item.name}</span>
                      <span className="spy-detail-value">{item.display}</span>
                    </li>
                  ))
                ) : (
                  <li className="spy-detail-none">
                    <span className="spy-detail-name">—</span>
                    <span className="spy-detail-value">Rien</span>
                  </li>
                )}
              </ul>
            </section>
          ))}
        </div>
      )}
    </DetailPanel>
  );
}
