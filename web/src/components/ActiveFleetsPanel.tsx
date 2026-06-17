import { useQuery } from "@tanstack/react-query";
import { Crosshair, Plane, Truck } from "lucide-react";
import { client, type ActiveFleet } from "../api/client";
import { IconText } from "./IconText";
import { cn, formatMissionTime } from "../utils/format";

type ActiveFleetsPanelProps = {
  cp?: number;
  className?: string;
};

function fleetRowClass(fleet: ActiveFleet): string {
  return cn(
    fleet.missionKind === "attack" && "fleet-row--attack",
    fleet.missionKind === "transport" && "fleet-row--transport"
  );
}

function FleetMissionCell({ fleet }: { fleet: ActiveFleet }) {
  if (fleet.missionKind === "attack") {
    return (
      <IconText icon={Crosshair} size={14} className="fleet-mission fleet-mission--attack">
        {fleet.missionLabel}
      </IconText>
    );
  }
  if (fleet.missionKind === "transport") {
    return (
      <IconText icon={Truck} size={14} className="fleet-mission fleet-mission--transport">
        {fleet.missionLabel}
      </IconText>
    );
  }
  return <span>{fleet.missionLabel}</span>;
}

export function ActiveFleetsPanel({ cp, className }: ActiveFleetsPanelProps) {
  const activeFleets = useQuery({
    queryKey: ["fleets-active", cp ?? "all"],
    queryFn: () => client.fleetsActive(cp),
    refetchInterval: (query) => (query.state.error ? false : 10_000),
  });

  return (
    <section className={cn("active-fleets", className)}>
      <h2>
        <IconText icon={Plane} size={18}>
          Flottes en vol ({activeFleets.data?.count ?? 0})
        </IconText>
      </h2>

      {activeFleets.isError && (
        <p className="muted">Impossible de charger les flottes : {(activeFleets.error as Error).message}</p>
      )}

      {activeFleets.isLoading && <p className="muted">Chargement des flottes…</p>}

      {!activeFleets.isLoading && !activeFleets.isError && (activeFleets.data?.fleets?.length ?? 0) === 0 && (
        <p className="muted">Aucune flotte en vol pour le moment.</p>
      )}

      {(activeFleets.data?.fleets?.length ?? 0) > 0 && (
        <div className="table-wrap active-fleets-table">
          <table className="data-table">
            <colgroup>
              <col className="col-mission" />
              <col className="col-status" />
              <col className="col-coords" />
              <col className="col-ships" />
              <col className="col-coords" />
              <col className="col-player" />
              <col className="col-duration" />
              <col className="col-duration" />
              <col className="col-time" />
              <col className="col-time" />
            </colgroup>
            <thead>
              <tr>
                <th>Mission</th>
                <th>Phase</th>
                <th>Départ</th>
                <th>Vaisseaux</th>
                <th>Destination</th>
                <th>Cible</th>
                <th>Aller</th>
                <th>Retour</th>
                <th>Arrivée cible</th>
                <th>Retour base</th>
              </tr>
            </thead>
            <tbody>
              {activeFleets.data!.fleets.map((fleet, index) => (
                <tr key={fleet.fleetId ?? `${fleet.targetCoords}-${index}`} className={fleetRowClass(fleet)}>
                  <td className="col-mission">
                    <FleetMissionCell fleet={fleet} />
                  </td>
                  <td className="col-status">{fleet.statusLabel}</td>
                  <td className="col-coords" title={fleet.sourceName ?? undefined}>
                    {fleet.sourceCoords ?? "—"}
                  </td>
                  <td
                    className={cn("col-ships", fleet.shipsDetail && "ships-cell--detail")}
                    title={fleet.shipsDetail ?? fleet.shipsLabel ?? undefined}
                  >
                    {fleet.shipsLabel ?? "—"}
                  </td>
                  <td className="col-coords" title={fleet.targetName ?? undefined}>
                    {fleet.targetCoords ?? "—"}
                  </td>
                  <td className="col-player" title={fleet.targetPlayer ?? undefined}>
                    {fleet.targetPlayer ?? "—"}
                  </td>
                  <td className="col-duration">{fleet.arrivalInFormatted ?? fleet.durationOutFormatted ?? "—"}</td>
                  <td className="col-duration">{fleet.returnInFormatted ?? fleet.durationReturnFormatted ?? "—"}</td>
                  <td className="col-time">{formatMissionTime(fleet.arrivalAt)}</td>
                  <td className="col-time" title={fleet.homeCoords ? `Retour ${fleet.homeCoords}` : undefined}>
                    {formatMissionTime(fleet.returnAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
