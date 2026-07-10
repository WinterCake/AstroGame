import { FileText, Trash2 } from "lucide-react";
import type { CombatReport } from "../api/client";
import { IconText } from "./IconText";
import { DetailPanel } from "./DetailPanel";
import {
  combatResultTone,
  formatCombatLoot,
  formatCombatReportDate,
  formatCombatResultLabel,
  formatCompactResource,
} from "../utils/combat-detail";

type Props = {
  report: CombatReport | null;
  loading?: boolean;
  onClose?: () => void;
  onDelete?: (messageId: string) => void;
  deletePending?: boolean;
};

export function CombatReportPanel({
  report,
  loading,
  onClose,
  onDelete,
  deletePending,
}: Props) {
  const displayHtml = report?.fullHtml || report?.htmlBody;

  return (
    <DetailPanel
      title="Rapport de combat"
      icon={FileText}
      emptyMessage="Clique sur un rapport pour afficher le détail du combat."
      report={report}
      onClose={onClose}
      loading={loading}
      loadingMessage="Chargement du rapport complet…"
      unavailable={!loading && !displayHtml}
      unavailableMessage={
        <>
          Contenu HTML indisponible.
          <br />
          Relance <strong>Sync depuis le jeu</strong>.
        </>
      }
      header={
        report ? (
          <header className="spy-detail-header">
            <h3>
              {report.coords ? (
                <>
                  Bataille <span className="spy-detail-coords">[{report.coords}]</span>
                </>
              ) : (
                "Rapport de bataille"
              )}
            </h3>
            <p className="spy-detail-meta">
              {formatCombatReportDate(report)}
              {(report.result || report.outcome) && (
                <>
                  {" · "}
                  <span className={combatResultTone(report.result)}>
                    {formatCombatResultLabel(report.result, report.outcome)}
                  </span>
                </>
              )}
              {report.battleOutcome && (
                <>
                  {" · "}
                  <span className="muted">{report.battleOutcome}</span>
                </>
              )}
            </p>
            {(report.attacker || report.defender) && (
              <p className="spy-detail-meta">
                {report.attacker && (
                  <>
                    <strong>Attaquant</strong> {report.attacker}
                    {report.attackerCoords ? ` [${report.attackerCoords}]` : ""}
                  </>
                )}
                {report.attacker && report.defender && " · "}
                {report.defender && (
                  <>
                    <strong>Défenseur</strong> {report.defender}
                    {report.defenderCoords ? ` [${report.defenderCoords}]` : ""}
                  </>
                )}
              </p>
            )}
            <div className="combat-summary-grid">
              <div>
                <span className="muted">Butin</span>
                <strong>{formatCombatLoot(report)}</strong>
              </div>
              <div>
                <span className="muted">Débris</span>
                <strong>{report.debrisFormatted ?? formatCompactResource(report.debrisTotal)}</strong>
              </div>
              <div>
                <span className="muted">Pertes att.</span>
                <strong>{formatCompactResource(report.attackerLosses)}</strong>
              </div>
              <div>
                <span className="muted">Pertes déf.</span>
                <strong>{formatCompactResource(report.defenderLosses)}</strong>
              </div>
            </div>
            {report.subject && <p className="muted spy-detail-subject">{report.subject}</p>}
          </header>
        ) : undefined
      }
      actions={
        report && onDelete ? (
          <button
            type="button"
            className="btn btn-danger"
            disabled={deletePending}
            onClick={() => onDelete(report.messageId)}
          >
            <IconText icon={Trash2} size={15}>
              Supprimer
            </IconText>
          </button>
        ) : undefined
      }
    >
      {displayHtml && (
        <div className="combat-report-html" dangerouslySetInnerHTML={{ __html: displayHtml }} />
      )}
    </DetailPanel>
  );
}
