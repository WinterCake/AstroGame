export function isLoggedIn(html) {
  return (
    /loggedIn\s*=\s*parseInt\(['"]1['"]\)/.test(html) ||
    html.includes("game/logout")
  );
}

export function assertLoggedIn(html) {
  if (!isLoggedIn(html)) {
    throw new Error(
      "Session invalide ou expirée. Lance npm run login ou mets à jour tes identifiants."
    );
  }
}
