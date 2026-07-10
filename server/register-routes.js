import { getClient } from "../src/client.js";
import { createServerContext } from "./context.js";
import { registerAttacksRoutes } from "./routes/attacks.js";
import { registerCombatRoutes } from "./routes/combat.js";
import { registerEmpireRoutes } from "./routes/empire.js";
import { registerFleetsRoutes, registerJobsRoutes } from "./routes/misc.js";
import { registerGalaxyRoutes } from "./routes/galaxy.js";
import { registerSessionRoutes } from "./routes/session.js";
import { registerSpyRoutes } from "./routes/spy.js";

export function registerRoutes(app) {
  const ctx = createServerContext();
  const deps = { getClient };

  registerSessionRoutes(app);
  registerEmpireRoutes(app, ctx, deps);
  registerGalaxyRoutes(app, ctx, deps);
  registerSpyRoutes(app, ctx, deps);
  registerCombatRoutes(app, ctx, deps);
  registerAttacksRoutes(app, ctx, deps);
  registerFleetsRoutes(app, deps);
  registerJobsRoutes(app);
}
