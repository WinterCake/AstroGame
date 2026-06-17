import { FileSearch, Crosshair, Radar } from "lucide-react";
import type { SpyReport } from "../api/client";
import { IconText } from "./IconText";
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
};

export function SpyReportPanel({
  report,
  loading,
  onClose,
  onSendToAttacks,
  onRespy,
  respyDisabled,
  respyPending,
}: Props) {
  if (!report) {
    return (
      <aside className="panel spy-panel">
        <p className="spy-panel-empty">Clique sur un rapport pour voir le détail raccourci.</p>
      </aside>
    );
  }

  const sections = buildSpyDetailSections(report);
  const mines =
    report.metalMine || report.crystalMine || report.deutMine
      ? `M${report.metalMine ?? 0} · C${report.crystalMine ?? 0} · D${report.deutMine ?? 0}`
      : null;
  const attackedToday = report.attackedToday ?? report.alreadyAttacked;
  const activity = formatPlayerActivity(report);

  return (
    <aside className="panel spy-panel">
      <div className="spy-panel-head">
        <h2>
          <IconText icon={FileSearch} size={15}>
            Rapport
          </IconText>
        </h2>
        {onClose && (
          <button type="button" className="btn btn-ghost spy-panel-close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        )}
      </div>

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
          {activity.tone !== "unknown" && activity.title !== activity.short && (
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

      {(onSendToAttacks || onRespy) && (
        <div className="spy-panel-actions">
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
            <button
              type="button"
              className="btn"
              onClick={() => onSendToAttacks(report.coords)}
            >
              <IconText icon={Crosshair} size={15}>
                Vers attaques
              </IconText>
            </button>
          )}
        </div>
      )}

      {loading && <p className="spy-panel-empty">Chargement du détail…</p>}

      {!loading && !sections && (
        <p className="spy-panel-empty">
          Détail indisponible pour ce rapport.
          <br />
          Relance <strong>Sync depuis le jeu</strong> pour récupérer flotte et défense.
        </p>
      )}

      {!loading && sections && (
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
    </aside>
  );
}
