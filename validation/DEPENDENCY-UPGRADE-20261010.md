# Mises à jour isolées du 10 octobre 2026

Aucun déploiement Raspberry. La version installée et `current/manifest.json` restent inchangés. La PR reste Draft.

| Dépendance | Avant | Candidate |
| --- | --- | --- |
| @db/sqlite | 0.12.0 | 0.13.0 |
| Drizzle | 0.45.2 | 0.45.3 |
| better-sqlite3 | 11.10.0 | 13.0.3 |
| TypeScript npm | 5.9.3 | 7.0.2 |
| jsmodbus | 4.0.10 | 5.0.0 |
| oauth4webapi | 3.8.6 | 3.8.8 |
| Zod | 3.25.76 | 4.6.5 |
| Hono | 4.12.33 | 4.13.9 |
| tRPC serveur | 11.18.0 | 11.19.0 |
| @std/dotenv | 0.225.7 | 0.225.8 |

Les deux lockfiles sont régénérés et contrôlés en mode frozen. La politique de maturité minimale de 14 jours est conservée : Hono 4.13.13 et Drizzle 0.45.4 sont différés. Les dépendances transitives gardent les contraintes de leurs éditeurs.

Zod 4 nécessite des clés explicites pour les records et des tuples pour conserver les listes de jours non vides. Les valeurs désérialisées restent validées. Les protections de régulation ne sont pas modifiées.

## Runtime et SQLite

Validation avec Deno 2.9.7 téléchargé séparément, sans remplacer le Deno système. Son compilateur TypeScript interne reste 6.0.3, distinct du paquet npm TypeScript.

Le pilote @db/sqlite 0.13.0 fournit encore SQLite 3.46.0. Mettre à jour son numéro ne suffit donc pas à corriger le moteur. La suite utilise SQLite **3.53.4** compilé depuis les sources officielles dont l'empreinte SHA3 est vérifiée par `validation/build-sqlite.py`. Cette version comprend la correction de la course WAL décrite par [SQLite](https://www.sqlite.org/wal.html). Les empreintes officielles sont publiées dans [les changements SQLite](https://www.sqlite.org/changes.html).

Ce moteur est sélectionné **uniquement avec `DENO_SQLITE_PATH`**. Aucun remplacement global ni intégration dans une image Raspberry n'est revendiqué. Une future livraison devra assembler et sélectionner explicitement la bibliothèque ARM64 vérifiée. `better-sqlite3` est une dépendance résolue pour Drizzle ; le driver exécuté par l'application reste @db/sqlite via SqliteCompat.

Le changement de moteur a révélé un ordre ambigu des journaux avec des timestamps identiques. Un second tri par identifiant stabilise l'ordre chronologique et la pagination. Un test de non-régression reproduit cette égalité de dates.

## Reproduction

```sh
python3 validation/build-sqlite.py --output /tmp/libevsolar-sqlite.so
export DENO_SQLITE_PATH=/tmp/libevsolar-sqlite.so
export EVSOLAR_DENO_BIN=/chemin/vers/deno-2.9.7
deno ci
deno install --frozen --import-map=validation/imports.json --lock=validation/deno.lock
bash validation/check-backend.sh
deno audit
```

Utiliser également le binaire sélectionné pour les commandes `deno` ci-dessus. Sur macOS, choisir une sortie `.dylib`. Le workflow candidat ajoute la même validation sur Linux ARM64, sans publication d'image.

## Limites

Les bundles frontend n'ont pas changé pendant cette migration. React, le client tRPC embarqué et les outils frontend ne sont pas mis à jour faute de sources complètes certifiées. Les tests serveur ne prouvent pas à eux seuls toute la compatibilité du client installé : une recette navigateur complète reste nécessaire avant livraison.

Aucun inventaire ou changement de Docker, Compose, Raspberry OS, Fleet Telemetry ou firmware n'a été effectué. Aucune image complète Raspberry n'est reconstruite. Le contrôle original de version figée reste volontairement distinct du contrôle candidat et échoue lorsque le runtime diffère du manifeste installé.

## Résultats locaux

Deno 2.9.7 / SQLite 3.53.4 sur macOS ARM64 : **207 tests, 2 152 étapes, zéro échec** ; 13 tests d’intégrité ; format (348 fichiers), lint (346 fichiers), type-check et audit réussis. 468 empreintes candidat vérifiées. Les faux serveurs HTTP nécessitent une exécution autorisant les sockets locales.
