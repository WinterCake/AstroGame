import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { IconText } from "./IconText";

type DetailPanelProps = {
  title: string;
  icon: LucideIcon;
  emptyMessage: string;
  report: unknown;
  onClose?: () => void;
  loading?: boolean;
  loadingMessage?: string;
  unavailable?: boolean;
  unavailableMessage?: ReactNode;
  actions?: ReactNode;
  header?: ReactNode;
  children?: ReactNode;
};

export function DetailPanel({
  title,
  icon,
  emptyMessage,
  report,
  onClose,
  loading,
  loadingMessage = "Chargement…",
  unavailable,
  unavailableMessage,
  actions,
  header,
  children,
}: DetailPanelProps) {
  if (!report) {
    return (
      <aside className="panel spy-panel">
        <p className="spy-panel-empty">{emptyMessage}</p>
      </aside>
    );
  }

  return (
    <aside className="panel spy-panel">
      <div className="spy-panel-head">
        <h2>
          <IconText icon={icon} size={15}>
            {title}
          </IconText>
        </h2>
        {onClose && (
          <button type="button" className="btn btn-ghost spy-panel-close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        )}
      </div>

      {header}

      {actions && <div className="spy-panel-actions">{actions}</div>}

      {loading && <p className="spy-panel-empty">{loadingMessage}</p>}

      {!loading && unavailable && (
        <p className="spy-panel-empty">{unavailableMessage}</p>
      )}

      {!loading && !unavailable && children}
    </aside>
  );
}
