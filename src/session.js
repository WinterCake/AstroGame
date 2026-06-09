import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SESSION_FILE = resolve(".astrogame-session");

export class Session {
  constructor() {
    /** @type {Map<string, string>} */
    this.cookies = new Map();
  }

  loadFromHeader(header) {
    if (!header?.trim()) return;
    for (const part of header.split(";")) {
      const trimmed = part.trim();
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        this.cookies.set(trimmed.slice(0, idx), trimmed.slice(idx + 1));
      }
    }
  }

  updateFromSetCookie(setCookie) {
    if (!setCookie) return;
    const lines = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const line of lines) {
      const [pair] = line.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) {
        this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }
    }
  }

  toHeader() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  saveToFile() {
    writeFileSync(SESSION_FILE, this.toHeader(), "utf8");
  }

  static loadFromFile() {
    try {
      const session = new Session();
      session.loadFromHeader(readFileSync(SESSION_FILE, "utf8"));
      return session.toHeader() ? session : null;
    } catch {
      return null;
    }
  }
}
