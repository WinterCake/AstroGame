# Astrogame Assistant — v1.4.3

## Installation propre (important)

Si tu vois `DEFAULT_SPY_SETTINGS already declared` :

1. Chrome → `chrome://extensions`
2. **Supprimer** l'extension Astrogame Assistant
3. **Recharger** l'onglet Astrogame (F5)
4. **Charger** à nouveau le dossier `chrome-extension/`

## Espionnage

1. Onglet Astrogame ouvert + connecté → **F5**
2. Popup → Espionnage → **Charger**
3. Clique **▶** sur une ligne → **détail inline** (ressources / flotte / défense)
4. **Panneau** → vue plein écran avec détail à droite

### Données stockées (Chrome `storage.local`)

| Donnée | Clé | Comportement |
|--------|-----|--------------|
| Rapports d'espionnage | `spyReports` | Copie locale au **Charger** / capture auto. **Supprimer les messages en jeu ne les efface pas** dans l'extension. **Charger** fusionne avec le cache (les anciens rapports restent). |
| Historique d'attaques | `attacksHistory` | Enregistré à chaque clic **Attaquer** (rapport, galaxie…). **Permanent** (plus seulement « du jour »). Badge « Déjà attaqué » = aujourd'hui. Export **Attaques** dans le popup. |

Le bouton ▶ n'ouvre plus un nouvel onglet (le popup se fermait avant).

## Galaxie

Navigation manuelle → export JSON depuis le popup.
