export function assertLoggedIn(html) {
  const loggedIn =
    /loggedIn\s*=\s*parseInt\(['"]1['"]\)/.test(html) ||
    html.includes("game/logout");

  if (!loggedIn) {
    throw new Error(
      "Session invalide ou expirée. Lance npm run login ou mets à jour tes identifiants."
    );
  }
}
