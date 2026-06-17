import type { SpyReport } from "../api/client";
import { formatPlayerActivity } from "../utils/player-activity";

export function PlayerActivityTag({
  report,
}: {
  report: Pick<SpyReport, "inactive" | "onVacation" | "isAttackableInactive" | "activityLabel">;
}) {
  const activity = formatPlayerActivity(report);
  if (activity.tone === "unknown") return <span className="muted">—</span>;

  const className =
    activity.tone === "inactive"
      ? "tag warn"
      : activity.tone === "vacation"
        ? "tag"
        : "tag ok";

  return (
    <span className={className} title={activity.title}>
      {activity.short}
    </span>
  );
}
