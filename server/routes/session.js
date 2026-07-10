import { loginFromEnv } from "../../src/auth.js";
import { getCredentials } from "../../src/config.js";
import { createClient } from "../../src/client.js";
import { Session } from "../../src/session.js";
import { isLoggedIn } from "../../src/session-check.js";
import { refreshClient } from "../../src/client.js";

async function getSessionStatus() {
  const session = Session.loadFromFile() ?? new Session();
  const envCookies = process.env.ASTROGAME_COOKIES?.trim();
  if (envCookies) session.loadFromHeader(envCookies);

  const cookies = session.cookies.size;
  const hasCookies = Boolean(session.toHeader());
  const { username, password } = getCredentials();
  const canLogin = Boolean(username && password);

  if (!hasCookies) {
    return { ok: true, connected: false, valid: false, cookies: 0, canLogin };
  }

  try {
    const client = createClient(session);
    const overview = await client.get("game/overview", {
      headers: { Referer: "https://play.astrogame.org/uni24/game/overview" },
      timeout: 15_000,
    });
    const valid = isLoggedIn(String(overview.data));
    return { ok: true, connected: true, valid, cookies, canLogin };
  } catch (error) {
    return {
      ok: true,
      connected: true,
      valid: false,
      cookies,
      canLogin,
      error: error.message,
    };
  }
}

export function registerSessionRoutes(app) {
  app.get("/api/session", async () => {
    try {
      return await getSessionStatus();
    } catch (error) {
      return { ok: false, connected: false, valid: false, error: error.message };
    }
  });

  app.post("/api/session/login", async (_req, reply) => {
    try {
      await loginFromEnv();
      await refreshClient();
      return { ok: true };
    } catch (error) {
      reply.code(500);
      return { ok: false, error: error.message };
    }
  });
}
