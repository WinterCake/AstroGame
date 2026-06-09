import axios from "axios";
import { BASE_URL, SITE_URL } from "./config.js";
import { ensureSession, resolveSession } from "./auth.js";
import { createLogger, cookieNames } from "./logger.js";
import { assertLoggedIn } from "./session-check.js";

const log = createLogger("http");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

/** @type {import('axios').AxiosInstance | null} */
let cachedClient = null;

export { assertLoggedIn };

export function createClient(session) {
  const client = axios.create({
    baseURL: SITE_URL,
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
    const target = config.url?.startsWith("http")
      ? config.url
      : `${config.baseURL ?? ""}${config.url ?? ""}`;
    log.debug(`${config.method?.toUpperCase()} ${target}`);
    return config;
  });

  client.interceptors.response.use((response) => {
    session.updateFromSetCookie(response.headers["set-cookie"]);
    session.saveToFile();
    return response;
  });

  return client;
}

export function resetClient() {
  cachedClient = null;
}

export async function getClient() {
  if (cachedClient) {
    log.debug("Réutilisation du client HTTP en cache");
    return cachedClient;
  }

  log.info("Initialisation du client HTTP");
  let session = await resolveSession();
  session = await ensureSession(session);
  cachedClient = createClient(session);
  log.info("Client prêt", { cookies: cookieNames(session) });
  return cachedClient;
}

export async function refreshClient() {
  resetClient();
  return getClient();
}

export function resolveUrl(pathOrUrl) {
  if (pathOrUrl.startsWith("http")) return pathOrUrl;
  return new URL(pathOrUrl, SITE_URL).href;
}

export async function fetchPage(client, path) {
  log.step(`GET ${path}`);
  const response = await client.get(path, {
    headers: { Referer: `${BASE_URL}/` },
  });
  assertLoggedIn(response.data);
  log.step(`Page OK (${path})`);
  return response.data;
}

export async function postForm(client, path, body, referer) {
  const params = new URLSearchParams(body);
  const safeBody = { ...body };
  if (safeBody.token) safeBody.token = `${String(safeBody.token).slice(0, 8)}...`;

  log.step(`POST ${path}`, safeBody);
  const response = await client.post(path, params.toString(), {
    headers: {
      Referer: referer ?? resolveUrl(path),
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  assertLoggedIn(response.data);
  log.step(`POST OK (${path})`);
  return response.data;
}
