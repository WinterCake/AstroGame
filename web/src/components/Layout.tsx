import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Crosshair,
  Globe2,
  LayoutDashboard,
  LogIn,
  Orbit,
  Radar,
  Swords,
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
  { to: "/combats", label: "Combats", icon: Swords },
  { to: "/attacks", label: "Attaques", icon: Crosshair },
] as const;

export function Layout() {
  const qc = useQueryClient();
  const [loginMsg, setLoginMsg] = useState<string | null>(null);
  const { data: session, refetch } = useQuery({
    queryKey: ["session"],
    queryFn: client.session,
    refetchInterval: (query) => (query.state.error ? false : 60_000),
  });

  const login = useMutation({
    mutationFn: client.login,
    onSuccess: () => {
      setLoginMsg(null);
      qc.invalidateQueries({ queryKey: ["session"] });
      qc.invalidateQueries({ queryKey: ["empire-planets"] });
      refetch();
    },
    onError: (error: Error) => {
      setLoginMsg(error.message);
    },
  });

  const { planets, sourceCp, setSourceCp, sourcePlanet } = usePlanetSource();
  const sessionValid = session?.valid === true;
  const sessionExpired = session?.connected && !sessionValid;
  const sessionLabel = sessionValid
    ? "Session active"
    : sessionExpired
      ? "Session expirée"
      : "Non connecté";

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
          <div className="header-left">
            <div className="session">
              {sessionValid ? (
                <Wifi size={15} className="icon icon-ok" aria-hidden />
              ) : (
                <WifiOff size={15} className="icon icon-ko" aria-hidden />
              )}
              <span className={sessionExpired ? "session-status session-status--warn" : "session-status"}>
                {sessionLabel}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => login.mutate()}
                disabled={login.isPending || session?.canLogin === false}
                title={
                  session?.canLogin === false
                    ? "Renseigne ASTROGAME_USERNAME et ASTROGAME_PASSWORD dans .env"
                    : "Reconnecter au jeu Astrogame"
                }
              >
                <IconText icon={LogIn} size={14}>
                  {login.isPending ? "Connexion…" : "Reconnecter"}
                </IconText>
              </button>
            </div>
            {loginMsg && <p className="session-error">{loginMsg}</p>}
            {session?.canLogin === false && !sessionValid && (
              <p className="session-error">
                Identifiants manquants — ajoute ASTROGAME_USERNAME et ASTROGAME_PASSWORD dans <code>.env</code>.
              </p>
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
