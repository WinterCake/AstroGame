import { NavLink, Outlet } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Crosshair,
  Globe2,
  LayoutDashboard,
  LogIn,
  Orbit,
  Radar,
  Wifi,
  WifiOff,
} from "lucide-react";
import { client } from "../api/client";
import { IconText } from "./IconText";
import { usePlanetSource } from "../context/PlanetSourceContext";
import { cn } from "../utils/format";

const links = [
  { to: "/empire", label: "Empire", icon: LayoutDashboard },
  { to: "/galaxy", label: "Galaxie", icon: Globe2 },
  { to: "/spy", label: "Espionnage", icon: Radar },
  { to: "/attacks", label: "Attaques", icon: Crosshair },
] as const;

export function Layout() {
  const qc = useQueryClient();
  const { data: session, refetch } = useQuery({
    queryKey: ["session"],
    queryFn: client.session,
    refetchInterval: (query) => (query.state.error ? false : 60_000),
  });

  const login = useMutation({
    mutationFn: client.login,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["session"] });
      qc.invalidateQueries({ queryKey: ["empire-planets"] });
      refetch();
    },
  });

  const { planets, sourceCp, setSourceCp, sourcePlanet } = usePlanetSource();
  const connected = session?.connected;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <Orbit size={20} strokeWidth={2.2} className="icon brand-icon" aria-hidden />
          AstroGame
        </div>
        <nav>
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => cn("nav-link", isActive && "active")}
            >
              <link.icon size={17} strokeWidth={2} className="nav-icon" aria-hidden />
              {link.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="main">
        <header className="header">
          <div className="session">
            {connected ? (
              <Wifi size={15} className="icon icon-ok" aria-hidden />
            ) : (
              <WifiOff size={15} className="icon icon-ko" aria-hidden />
            )}
            {connected ? "Session active" : "Non connecté"}
            {!connected && (
              <button type="button" className="btn btn-sm" onClick={() => login.mutate()} disabled={login.isPending}>
                <IconText icon={LogIn} size={14}>
                  {login.isPending ? "Connexion…" : "Reconnecter"}
                </IconText>
              </button>
            )}
          </div>

          <label className="source-select">
            <IconText icon={Orbit} size={15} className="source-label">
              Planète source
            </IconText>
            <select
              value={sourceCp ?? ""}
              onChange={(e) => setSourceCp(Number(e.target.value) || null)}
            >
              {planets.map((p) => (
                <option key={p.cp ?? p.coords} value={p.cp ?? ""}>
                  {p.label}
                </option>
              ))}
            </select>
            {sourcePlanet && <span className="muted">{sourcePlanet.coords}</span>}
          </label>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
