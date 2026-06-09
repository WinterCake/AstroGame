import "dotenv/config";

export const BASE_URL = "https://play.astrogame.org";
export const UNIVERSE = "uni24";
export const SITE_URL = `${BASE_URL}/${UNIVERSE}/`;
export const BUILDINGS_URL = `${SITE_URL}game/buildings`;

export function getCredentials() {
  const username = process.env.ASTROGAME_USERNAME?.trim() || "";
  const password = process.env.ASTROGAME_PASSWORD?.trim() || "";
  const cookies = process.env.ASTROGAME_COOKIES?.trim() || "";

  return { username, password, cookies };
}
