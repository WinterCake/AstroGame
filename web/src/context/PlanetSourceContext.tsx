import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { client, type Planet } from "../api/client";

type PlanetSourceContextValue = {
  planets: Planet[];
  sourceCp: number | null;
  setSourceCp: (cp: number | null) => void;
  sourcePlanet: Planet | null;
};

const PlanetSourceContext = createContext<PlanetSourceContextValue | null>(null);

const STORAGE_KEY = "astrogame-source-cp";

function dedupePlanets(planets: Planet[]) {
  const byCp = new Map<number, Planet>();
  for (const planet of planets) {
    if (planet.cp != null && !byCp.has(planet.cp)) {
      byCp.set(planet.cp, planet);
    }
  }
  return [...byCp.values()];
}

export function PlanetSourceProvider({ children }: { children: ReactNode }) {
  const { data } = useQuery({
    queryKey: ["empire-planets"],
    queryFn: client.empirePlanets,
  });

  const planets = useMemo(
    () => dedupePlanets(data?.planets ?? []).filter((p) => !/lune|moon/i.test(p.label)),
    [data]
  );
  const [sourceCp, setSourceCpState] = useState<number | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? Number(saved) : null;
  });

  useEffect(() => {
    if (!planets.length) return;
    if (sourceCp != null && planets.some((p) => p.cp === sourceCp)) return;
    const main =
      planets.find((p) => p.isMain && p.cp != null) ??
      planets.find((p) => p.cp != null) ??
      planets[0];
    if (main?.cp != null) setSourceCpState(main.cp);
  }, [planets, sourceCp]);

  const setSourceCp = (cp: number | null) => {
    setSourceCpState(cp);
    if (cp) localStorage.setItem(STORAGE_KEY, String(cp));
  };

  const sourcePlanet = planets.find((p) => p.cp === sourceCp) ?? null;

  return (
    <PlanetSourceContext.Provider value={{ planets, sourceCp, setSourceCp, sourcePlanet }}>
      {children}
    </PlanetSourceContext.Provider>
  );
}

export function usePlanetSource() {
  const ctx = useContext(PlanetSourceContext);
  if (!ctx) throw new Error("usePlanetSource outside provider");
  return ctx;
}
