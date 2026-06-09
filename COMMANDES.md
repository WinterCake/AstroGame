# Astrogame API — Commandes

Client Node pour jouer sur **uni24 (Chaos)** sans ouvrir Chrome.

## Prérequis

```bash
npm install
```

Crée un fichier `.env` à la racine (copie `.env.example`) :

```env
ASTROGAME_USERNAME=ton_pseudo
ASTROGAME_PASSWORD=ton_mot_de_passe
```

Optionnel :

```env
ASTROGAME_DEBUG=0          # réduire les logs
ASTROGAME_COOKIES=...      # fallback manuel (cookies navigateur)
```

---

## Commandes disponibles

npm run login — connexion
npm run buildings — liste des bâtiments
npm run plan — commandes prêtes pour les améliorations possibles
npm run upgrade-next — améliore le 1er bâtiment améliorable
npm run upgrade -- <id> [niv] — amélioration (+ tableau des IDs)
npm run parse-local — test hors-ligne
npm run galaxy-scrape — export JSON des positions joueurs (galaxie)
npm run galaxy-merge — fusionne des exports JSON + Excel
npm run spy-reports — résumé des rapports d'espionnage

### `npm run login`

Connexion HTTP automatique (sans navigateur).

- Lit `ASTROGAME_USERNAME` / `ASTROGAME_PASSWORD` depuis `.env`
- Passe par le portail → entrée univers `uni24` → session jeu
- Sauvegarde la session dans `.astrogame-session`

```bash
npm run login
```

À relancer si la session expire.

---

### `npm run buildings`

Liste tous les bâtiments de ta planète (données live).

```bash
npm run buildings
```

Affiche pour chaque bâtiment :
- ID, nom, niveau actuel
- statut : `améliorable`, `indisponible` ou `en construction → niv. X`
- file de construction planétaire (bâtiment en cours, temps restant, fin prévue)
- niveau cible par défaut si améliorable

---

### `npm run plan`

Affiche les **commandes prêtes à copier** pour chaque bâtiment améliorable, triés par priorité (mines → énergie → stockage → prod).

```bash
npm run plan
```

Exemple de sortie :

```
Améliorations possibles (3) :

[4] Centrale éléctrique Solaire — niv. 34 → 35
  npm run upgrade -- 4 35

[12] Centrale de fusion — niv. 7 → 8
  npm run upgrade -- 12 8

Action rapide (1er de la liste) :
  npm run upgrade-next
```

---

### `npm run upgrade-next`

Lance l'amélioration du **premier bâtiment améliorable** selon la même priorité que `plan`.

```bash
npm run upgrade-next
```

Utile en routine : une construction à la fois, puis relancer quand c'est fini.

---

### `npm run upgrade -- <id> [niveau]`

Demande l'amélioration d'un bâtiment.

```bash
# +1 niveau (défaut)
npm run upgrade -- 4

# niveau cible précis
npm run upgrade -- 4 36
```

| ID | Bâtiment |
|----|----------|
| 1  | Mine de Métal |
| 2  | Mine de Cristal |
| 3  | Synthétiseur de Deutérium |
| 4  | Centrale électrique Solaire |
| 12 | Centrale de fusion |
| 14 | Usine de Robots |
| 15 | Usine de Nanites |
| 21 | Chantier Spatial |
| 22 | Hangar de Métal |
| 23 | Hangar de Cristal |
| 24 | Réservoir de Deutérium |
| 31 | Laboratoire de Recherche |
| 33 | Terraformeur |
| 34 | Dépôt d'Alliance |
| 44 | Silo de Missiles |
| 99 | Rampe de Production de Masse |

> Un bâtiment `indisponible` est souvent en construction ou manque de ressources.

---

### `npm run parse-local`

Parse la page HTML sauvegardée localement (`Bâtiments - Chaos - Astrogame.html`).

Utile pour tester le parser **sans connexion** au site.

```bash
npm run parse-local
```

---

### `npm run galaxy-scrape`

Scrape l'onglet **Galaxie** via l'API AJAX (`game/galaxy/ajax`) et exporte un JSON avec les emplacements de tous les joueurs.

```bash
# Un seul système (ex. 5:270)
npm run galaxy-scrape -- --system 5:270

# Toute une galaxie (1 à 400 systèmes)
npm run galaxy-scrape -- --galaxy 5 --output galaxy-g5.json

# Univers complet (6 galaxie × 400 systèmes ≈ 2400 requêtes, ~45–80 min avec délai aléatoire)
npm run galaxy-scrape -- --all --output galaxy-uni24.json

# Reprendre une plage sans écraser le reste du fichier
npm run galaxy-scrape -- --galaxy 5 --systems 374-400 --output galaxy-g5.json --merge
```

Options :

| Option | Description |
|--------|-------------|
| `--system G:S` | Un seul système (ex. `5:270`) |
| `--galaxy N` ou `N-M` | Plage de galaxie(s) |
| `--systems N` ou `N-M` | Plage de systèmes (défaut 1–400) |
| `--all` | Scan complet de l'univers |
| `--merge` | Fusionne avec le JSON existant (garde les systèmes non re-scannés) |
| `--output fichier.json` | Fichier de sortie (défaut `galaxy-players.json`) |
| Délai entre requêtes | Aléatoire entre 250 ms et 2 s (`GALAXY_SCRAPE_DELAY_MIN_MS` / `GALAXY_SCRAPE_DELAY_MAX_MS` dans `.env`) |

Sans argument, scrape le système **5:270** par défaut.

**Sans `--merge`** : le fichier est entièrement remplacé par la plage scannée.

**Avec `--merge`** : charge le fichier existant, conserve les systèmes hors plage, remplace ceux re-scannés.

Structure du JSON :

- `meta` — date, limites univers, compteurs (`systemsStored`, `lastScanned`, etc.)
- `entries` — liste plate de chaque planète occupée (`coords`, `username`, `alliance`, `moon`, `debris`, etc.)
- `players` — même données regroupées par joueur avec leur liste de planètes

Le fichier est **mis à jour après chaque système** scanné. En cas d'erreur (captcha, rate limit…), une sauvegarde partielle reste disponible (`meta.complete: false` ou `meta.runComplete: false` avec `--merge`).

---

### `npm run galaxy-merge`

Fusionne plusieurs exports galaxie (JSON scraper Node ou extension Chrome) et produit un **JSON + Excel**.

```bash
# Tous les exports sources galaxy*.json (exclut les *-merged.json)
npm run galaxy-merge -- --all --output global-galaxy.json --excel global-galaxy.xlsx

# Fichiers précis
npm run galaxy-merge -- galaxy-g5.json galaxy-2026-06-09.json

# Chemins de sortie personnalisés
npm run galaxy-merge -- --all --output galaxy-merged.json --excel galaxy-merged.xlsx
```

Options :

| Option | Description |
|--------|-------------|
| `--all` | Fusionne tous les `galaxy*.json` sources (sans les fichiers `*-merged.json`) |
| `--output fichier.json` | JSON fusionné (défaut `galaxy-merged.json`) |
| `--excel fichier.xlsx` | Excel (défaut `galaxy-merged.xlsx`) |
| `--no-json` / `--no-excel` | N'exporte qu'un seul format |

En cas de doublon (même coords `G:S:P`), le **dernier fichier** en argument l'emporte.

L'Excel contient 3 onglets :

- **Planètes** — une ligne par planète (statut inactif, vacances, coords, alliance…)
- **Inactifs (cibles)** — uniquement les joueurs inactifs hors vacances
- **Joueurs** — regroupé par joueur avec liste des coords
- **Résumé** — meta de la fusion

---

### `npm run spy-send`

Envoie des **sondes d'espionnage** vers une liste de coordonnées (même API que le bouton « Espionner » en galaxie).

```bash
npm run spy-send
npm run spy-send -- --dry-run
npm run spy-send -- --file spy-targets.txt
npm run spy-send -- 4:153:8 4:163:8
```

Par défaut lit `spy-targets.txt` (format `G S P` ou `G:S:P`, une ligne par cible).

| Option | Description |
|--------|-------------|
| `--file fichier.txt` | Liste de coords (défaut `spy-targets.txt`) |
| `--dry-run` | Simule sans envoyer |
| `--parallel N` | Espions en vol max en même temps (défaut **13**) |
| `--reserve-slots N` | Garde N slots libres pour tes autres flottes |
| `--slot-poll MS` | Intervalle de vérif. des slots libres (défaut 3000) |
| `--slot-timeout MS` | Abandon si bloqué (défaut 15 min, 0 = illimité) |
| `--delay-min` / `--delay-max` | Petite pause entre envois réussis (ms) |

Le script **attend un slot de flotte libre** avant chaque envoi. Par défaut jusqu'à **13 espions en parallèle** (ajuste avec `--parallel N` ou `SPY_SEND_PARALLEL` dans `.env`).

Le nombre de sondes par mission suit ton **réglage en jeu** (pas modifiable via cette commande).

---

### `npm run spy-reports`

Récupère **tous** tes rapports d'espionnage (messages catégorie 0) et affiche un résumé trié par **date décroissante**.

```bash
npm run spy-reports
npm run spy-reports -- --output spy-reports.json
npm run spy-reports -- --page 1
npm run spy-reports -- --max-pages 3
npm run spy-reports -- --filter gros-butin-sans-defense
```

Options :

| Option | Description |
|--------|-------------|
| `--excel fichier.xlsx` | Export Excel (défaut `spy-reports.xlsx`, généré à chaque run) |
| `--no-excel` | Pas d’export Excel |
| `--output fichier.json` | Export JSON complet (données brutes `spyData` incluses) |
| `--page N` | Une seule page de messages (25 rapports) |
| `--max-pages N` | Limite le nombre de pages scannées |
| `--filter nom` | Filtre l’affichage : `sans-defense`, `gros-butin-sans-defense`, `gros-butin`, `today`, `today-sans-defense`, `today-gros-sans-defense`… |

Fichier Excel : onglets **Rapports**, **Gros butin**, **Sans défense**, **Gros butin sans déf.**, **Cibles**, **Résumé**.

Exemple de sortie (tableau) :

```
#  Date          Coords    Joueur    Planète            Butin   Flotte  Défense  Mines           Destr.  Espion.  Verdict
─  ────          ──────    ──────    ───────            ─────   ──────  ───────  ─────           ──────  ───────  ───────
1  09/06 10:05   5:399:5   samogon   Главная планета    5.2 Md  0       156.7 K  M41/C40/D38    15%     42%      Défense lourde
```

---

## Extension Chrome v1.2.1

Popup avec deux onglets — **aucune modification visuelle** des pages Astrogame.

| Onglet | Usage |
|--------|--------|
| **Galaxie** | Navigation manuelle → capture auto + export JSON |
| **Espionnage** | Bouton **Charger** → tableau récap (filtres gros butin / jour) + export JSON |

1. Chrome → `chrome://extensions` → recharger l’extension
2. Connecté sur Astrogame → icône extension → onglet voulu

Voir `chrome-extension/README.md` pour le détail. Excel complet : `npm run spy-reports`.

---

## Workflow typique

```bash
npm run login
npm run plan
npm run upgrade-next
```

Les commandes `buildings` et `upgrade` réutilisent la session sauvegardée. Si elle est expirée, reconnexion automatique via les identifiants `.env`.

---

## Logs

3 niveaux via `ASTROGAME_LOG_LEVEL` dans `.env` :

| Niveau | Affiche |
|--------|---------|
| `info` | `info`, `warn`, `error` seulement |
| `verbose` | + les étapes `→` (défaut) |
| `debug` | + requêtes HTTP détaillées |

Pour n'afficher **que les messages importants** (sans les `→ step`) :

```env
ASTROGAME_LOG_LEVEL=info
```

Raccourci équivalent :

```env
ASTROGAME_DEBUG=0
```
