import * as cheerio from "cheerio";
import axios from "axios";
import { BASE_URL, getCredentials, SITE_URL, UNIVERSE } from "./config.js";
import { createLogger, cookieNames, maskToken } from "./logger.js";
import { assertLoggedIn } from "./session-check.js";
import { Session } from "./session.js";

const log = createLogger("auth");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

function createAuthClient(session) {
  const client = axios.create({
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "fr-FR,fr;q=0.9",
    },
    maxRedirects: 10,
    validateStatus: (status) => status >= 200 && status < 400,
  });

  client.interceptors.request.use((config) => {
    const cookie = session.toHeader();
    if (cookie) {
      config.headers.Cookie = cookie;
    }
    log.debug(`HTTP ${config.method?.toUpperCase()} ${config.url}`, {
      cookies: cookieNames(session),
    });
    return config;
  });

  client.interceptors.response.use((response) => {
    const before = cookieNames(session);
    session.updateFromSetCookie(response.headers["set-cookie"]);
    const after = cookieNames(session);
    const added = after.filter((name) => !before.includes(name));
    if (added.length) {
      log.debug(`Cookies reçus sur ${response.config.url}`, { added });
    }
    return response;
  });

  return client;
}

function extractLoginToken(html) {
  const $ = cheerio.load(html);
  const token =
    $("#ajaxHomeLoginToken").attr("value") ??
    $('input[name="token"]').first().attr("value");

  if (!token) {
    throw new Error("Token de login introuvable sur la page d'accueil.");
  }

  return token;
}

function extractPlayGameUrl(html) {
  const $ = cheerio.load(html);
  const href = $(`a[href*='${UNIVERSE}/playGame']`).first().attr("href");
  if (!href) return null;
  return new URL(href, `${BASE_URL}/`).href;
}

function responseUrl(response) {
  return response.request?.res?.responseUrl ?? response.config?.url ?? "(inconnu)";
}

async function followRedirectChain(client, startUrl, referer) {
  let url = startUrl;
  let response;
  let step = 0;

  while (step < 5) {
    response = await client.get(url, {
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: { Referer: referer },
    });

    const location = response.headers?.location;
    if (!location || response.status < 300) {
      break;
    }

    step += 1;
    const nextUrl = new URL(location, url).href;
    log.step(`Redirection ${step}`, { status: response.status, from: url, to: nextUrl });
    referer = url;
    url = nextUrl;
  }

  return { response, finalUrl: url };
}

async function enterUniverse(client, session) {
  log.step("Chargement du portail connecté pour trouver l'entrée univers...");
  const portal = await client.get(`${BASE_URL}/`, {
    headers: { Referer: `${BASE_URL}/` },
  });

  const playGameUrl = extractPlayGameUrl(portal.data);
  if (!playGameUrl) {
    log.error(`Aucun lien ${UNIVERSE}/playGame trouvé sur le portail.`);
    log.warn(
      "Vérifie que ton compte est bien inscrit dans cet univers (Chaos / uni24)."
    );
    throw new Error(
      `Impossible d'entrer dans l'univers ${UNIVERSE}. Compte non inscrit ou page inattendue.`
    );
  }

  log.step("Entrée univers via playGame", { url: playGameUrl });
  const { response: entry, finalUrl } = await followRedirectChain(
    client,
    playGameUrl,
    `${BASE_URL}/`
  );

  log.step("Chaîne de redirections terminée", {
    finalUrl,
    status: entry.status,
    cookies: cookieNames(session),
  });

  return entry;
}

export async function loginWithCredentials(username, password) {
  log.info("Début de connexion Astrogame");
  log.step("Identifiant utilisé", { username, passwordLength: password.length });

  const session = new Session();
  const client = createAuthClient(session);

  log.step(`GET page d'accueil (${BASE_URL}/)`);
  const home = await client.get(`${BASE_URL}/`, {
    headers: { Referer: `${BASE_URL}/` },
  });
  log.step("Page d'accueil chargée", {
    status: home.status,
    cookies: cookieNames(session),
  });

  const token = extractLoginToken(home.data);
  log.step("Token CSRF login extrait", { token: maskToken(token) });

  const body = new URLSearchParams({
    username,
    password,
    currentUrl: `${BASE_URL}/`,
    token,
  });

  log.step("POST /loginAjax");
  const login = await client.post(`${BASE_URL}/loginAjax`, body.toString(), {
    headers: {
      Referer: `${BASE_URL}/`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    },
    transformResponse: [(data) => data],
  });

  let payload;
  try {
    payload = JSON.parse(login.data);
  } catch {
    log.error("Réponse login non JSON", { snippet: String(login.data).slice(0, 300) });
    throw new Error("Réponse login invalide (pas du JSON).");
  }

  log.step("Réponse /loginAjax", {
    success: payload.success,
    message: payload.message,
    redirect: payload.redirect ?? null,
    reload: payload.reload ?? null,
  });

  if (!payload.success) {
    throw new Error(payload.message || "Échec de connexion.");
  }

  if (payload.redirect) {
    log.step("Suivi de la redirection post-login", { url: payload.redirect });
    await client.get(payload.redirect, {
      headers: { Referer: `${BASE_URL}/` },
    });
  }

  log.step("Cookies après login portail", { cookies: cookieNames(session) });
  await enterUniverse(client, session);

  log.step(`Vérification session jeu (${SITE_URL}game/overview)`);
  const overview = await client.get(`${SITE_URL}game/overview`, {
    headers: { Referer: `${BASE_URL}/` },
  });

  log.step("Page overview chargée", {
    finalUrl: responseUrl(overview),
    status: overview.status,
  });

  try {
    assertLoggedIn(overview.data);
  } catch (error) {
    log.error("Session jeu invalide après entrée univers", {
      finalUrl: responseUrl(overview),
      title: overview.data.match(/<title>([^<]+)/)?.[1]?.trim(),
    });
    throw error;
  }

  session.saveToFile();
  log.info("Connexion réussie — session sauvegardée dans .astrogame-session", {
    cookies: cookieNames(session),
  });

  return session;
}

export async function loginFromEnv() {
  const { username, password } = getCredentials();
  if (!username || !password) {
    throw new Error(
      "ASTROGAME_USERNAME et ASTROGAME_PASSWORD requis dans .env pour le login automatique."
    );
  }
  return loginWithCredentials(username, password);
}

export async function resolveSession() {
  const { username, password, cookies } = getCredentials();

  if (cookies) {
    log.info("Utilisation des cookies depuis ASTROGAME_COOKIES");
    const session = new Session();
    session.loadFromHeader(cookies);
    log.step("Cookies chargés", { cookies: cookieNames(session) });
    return session;
  }

  const saved = Session.loadFromFile();
  if (saved) {
    log.info("Utilisation de la session sauvegardée (.astrogame-session)");
    log.step("Cookies chargés", { cookies: cookieNames(saved) });
    return saved;
  }

  if (username && password) {
    log.info("Aucune session existante — login automatique");
    return loginWithCredentials(username, password);
  }

  throw new Error(
    "Aucune session disponible. Renseigne ASTROGAME_USERNAME/ASTROGAME_PASSWORD ou ASTROGAME_COOKIES dans .env."
  );
}

export async function ensureSession(session) {
  const client = createAuthClient(session);
  log.step("Vérification de la session existante...");
  try {
    const overview = await client.get(`${SITE_URL}game/overview`, {
      headers: { Referer: `${BASE_URL}/` },
    });
    assertLoggedIn(overview.data);
    log.info("Session encore valide", { finalUrl: responseUrl(overview) });
    session.saveToFile();
    return session;
  } catch (error) {
    log.warn("Session expirée ou invalide — nouvelle connexion nécessaire", {
      reason: error.message,
    });
    const { username, password } = getCredentials();
    if (!username || !password) {
      throw new Error(
        "Session expirée. Relance npm run login ou mets à jour ASTROGAME_COOKIES."
      );
    }
    return loginWithCredentials(username, password);
  }
}
