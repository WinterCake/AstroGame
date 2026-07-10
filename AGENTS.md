# Équipe d'agents AstroGame

Toolkit d'automatisation Astrogame (uni24) : CLI Node, API Fastify, dashboard React, extension Chrome MV3.

## Agents

| Agent | Skill / règle | Périmètre | Quand l'invoquer |
|-------|---------------|-----------|------------------|
| **dev-backend** | `.cursor/skills/dev-backend/` | `src/`, `server/`, `scripts/` | Logique métier, API, CLI, données JSON |
| **dev-frontend** | `.cursor/skills/dev-frontend/` | `web/src/` | UI React, hooks, composants, client API |
| **dev-test** | `.cursor/skills/dev-test/` | `tests/`, `**/*.test.*` | Écrire ou corriger des tests, fixtures, CI |
| **architecte** | `.cursor/skills/architecte/` | tout le repo | Audit structure, duplications, plan de refacto |

Invoquer un agent : mentionner le skill dans le chat, ex. *« utilise le skill dev-backend pour… »*.

## Commandes

```bash
npm run dev          # API (3847) + web Vite (5173)
npm run dev:api      # API seule
npm run dev:web      # Web seule
npm test             # Vitest (backend + web)
npm run test:watch   # Vitest en mode watch
npm run test:coverage
npm run build:web    # Build production React
npm start            # API + web/dist en prod
```

## Architecture (3 surfaces)

```
src/          → logique métier partagée (CLI + API)
server/       → Fastify REST + jobs SSE
web/          → Dashboard React (proxy /api → 3847)
chrome-extension/ → Capture in-game (MV3)
data/         → JSON / XLSX persistés
```

**Règle d'or** : la logique métier pure vit dans `shared/`. `src/` ajoute I/O (fichiers, HTTP). L'extension consomme `chrome-extension/lib/` (généré via `npm run sync:shared`).

## Conventions

- ESM (`"type": "module"`)
- UI en français
- Pas de commit sans demande explicite
- Tests avant refactor des fonctions partagées

## Automations Cursor

Voir [`.cursor/automations/README.md`](.cursor/automations/README.md) pour CI tests et garde-fous PR.
