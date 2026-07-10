# Audit architecture AstroGame

*Mis à jour le 10 juillet 2026 — Phase C/D complétée*

## Résumé exécutif

Architecture unifiée autour de `shared/` : spy, galaxy, attacks, verdicts, labels. Serveur modulaire, web avec hooks pagination, extension avec `spy-ui-common.js`, store spy canonique via `saveSpyReportsBundle`.

**67 tests Vitest** + **5 tests Playwright E2E**.

---

## Modules shared

| Module | Rôle |
|--------|------|
| `shared/spy-core.js` | parse, filter, merge, verdict |
| `shared/spy-labels.js` | labels bâtiments/flotte/défense (71 entrées) |
| `shared/galaxy-parse.js` | parse système galaxie |
| `shared/galaxy-activity.js` | labels activité joueur |
| `shared/attacks-core.js` | normalize/merge attacks |
| `shared/verdict.js` | classes CSS verdict |
| `shared/query-utils.js` | sort/filter/pagination API |

Sync auto : `npm run sync:shared` → `chrome-extension/lib/` + `spy-labels.js`

---

## Refactors réalisés

### Serveur
- [x] `server/routes/*.js` + `server/context.js`
- [x] `server/index.js` ~45 lignes (bootstrap)

### Web
- [x] `DetailPanel` générique → `SpyReportPanel` / `CombatReportPanel`
- [x] `usePaginatedQuery` + `ListPagination`
- [x] `spy-labels.ts` → `@shared/spy-labels.js`

### Extension
- [x] `spy-ui-common.js` (popup + panel)
- [x] `spy-labels.js` généré depuis shared

### Données spy
- [x] `saveSpyReportsBundle` — `loot-targets.json` canonique, `reports.json` miroir archive
- [x] Tests `tests/spy-store.test.js`

### E2E
- [x] Playwright (`e2e/spy-filters.spec.ts`, `e2e/combat-filters.spec.ts`)
- [x] CI GitHub Actions

---

## Commandes

```bash
npm run sync:shared
npm test              # 67 tests Vitest
npm run test:e2e      # 5 tests Playwright
npm run dev
```
