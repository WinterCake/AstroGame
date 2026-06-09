/**
 * Niveaux de log :
 * - info    → info, warn, error uniquement (pas de step ni debug)
 * - verbose → info + step + détails (défaut)
 * - debug   → verbose + requêtes HTTP détaillées
 *
 * ASTROGAME_DEBUG=0 force le niveau "info" (rétrocompat).
 */
function resolveLogLevel() {
  if (process.env.ASTROGAME_DEBUG === "0") return "info";
  const level = process.env.ASTROGAME_LOG_LEVEL?.trim().toLowerCase();
  if (level === "info" || level === "verbose" || level === "debug") return level;
  return "verbose";
}

const LOG_LEVEL = resolveLogLevel();
const SHOW_STEP = LOG_LEVEL === "verbose" || LOG_LEVEL === "debug";
const SHOW_DEBUG = LOG_LEVEL === "debug";
const SHOW_DETAILS = LOG_LEVEL !== "info";
const COLORS_ENABLED = process.env.NO_COLOR !== "1" && process.stdout.isTTY;

function prefix(scope) {
  const time = new Date().toISOString().slice(11, 19);
  return `[${time}] [${scope}]`;
}

export function createLogger(scope) {
  return {
    info(message, details) {
      console.log(`${prefix(scope)} ${message}`);
      if (details !== undefined && SHOW_DETAILS) {
        console.log(details);
      }
    },
    step(message, details) {
      if (!SHOW_STEP) return;
      console.log(`${prefix(scope)} → ${message}`);
      if (details !== undefined && SHOW_DETAILS) {
        console.log(details);
      }
    },
    warn(message, details) {
      console.warn(`${prefix(scope)} ⚠ ${message}`);
      if (details !== undefined) {
        console.warn(details);
      }
    },
    error(message, details) {
      console.error(`${prefix(scope)} ✗ ${message}`);
      if (details !== undefined) {
        console.error(details);
      }
    },
    debug(message, details) {
      if (!SHOW_DEBUG) return;
      console.log(`${prefix(scope)} · ${message}`);
      if (details !== undefined) {
        console.log(details);
      }
    },
  };
}

export function green(text) {
  if (!COLORS_ENABLED) return text;
  return `\x1b[32m${text}\x1b[0m`;
}

export function logSuccess(...lines) {
  for (const line of lines) {
    console.log(green(line));
  }
}

export function maskToken(value) {
  if (!value) return "(vide)";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 8)}...`;
}

export function cookieNames(sessionOrHeader) {
  if (typeof sessionOrHeader === "string") {
    return sessionOrHeader
      .split(";")
      .map((part) => part.trim().split("=")[0])
      .filter(Boolean);
  }
  if (sessionOrHeader?.cookies) {
    return [...sessionOrHeader.cookies.keys()];
  }
  return [];
}
