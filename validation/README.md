# Dernière étape : réactivité solaire

Voir [le rapport avant/après](SOLAR-RESPONSE.md). Les baisses de courant solaire
s'appliquent au prochain cycle, sans les trois minutes de stabilisation des
petites hausses. Les protections et le design installé sont conservés.

- **190 tests et 2 146 sous-tests passent**, ainsi que 10 tests Python d'intégrité.
- Format : 343 fichiers ; lint : 341 fichiers ; type-check serveur : OK.
- Compilation native macOS ARM64 : OK, binaire non exécuté.
- Audit des dépendances : aucune vulnérabilité connue signalée le 9 octobre 2026.
- Candidate : 463 fichiers vérifiés ; 421 fichiers installés identiques et
  42 écarts backend/tests explicitement listés. Tous les assets dist et le
  manifeste installé sont inchangés.
- Simulation 24 h : 1 440 cycles, 54 commandes, 552 lectures, un réveil simulé.

Le contrôle original de version figée reste incompatible avec les changements
backend. Aucune reconstruction frontend complète ou image Raspberry certifiée,
aucun déploiement ni publication. Les bilans ci-dessous sont historiques.

---

# Étape précédente : simulation intégrée et pannes combinées

Voir [le rapport de simulation](SIMULATION.md) pour les trois défauts de sécurité
reproduits et corrigés, la journée complète, les campagnes multi-véhicules,
Overseer, planning de nuit et reconnexions SSE.

Résultat de cette étape : **184 tests, 2 146 sous-tests et 10 tests d'intégrité passent**.
Format/lint/type-check et compilation backend passent également. Design installé
et manifeste préservés, aucune opération de production.

Les sections ci-dessous conservent les bilans des étapes précédentes ; leurs
comptages et archives décrivent ces étapes, pas la dernière candidate.

---

# Étape précédente — validation de la version candidate

La poursuite du développement conserve la base installée et le commit de reprise
`698e22d`. Aucun changement de comportement de régulation dans cette étape :
nettoyage des directives obsolètes, types explicites et format backend uniquement.
Les fragments frontend restent inchangés.

## Résultats actuels

- **Format backend : OK**, 337 fichiers, sans reformater les bundles ou TSX.
- **Lint backend : OK**, 335 fichiers, aucune règle désactivée. Les directives de
  plugins supprimés ont été retirées ; imports/exports purement typés et signatures
  publiques précisés. Les fichiers frontend non certifiés sont hors de ce périmètre.
- **Type-check : OK**, entrée serveur avec lock runtime figé.
- **Compilation native backend : OK**, binaire macOS ARM64 de validation non exécuté
  (`/tmp/chargeha-backend-validation-next`). Aucun build Linux/Raspberry revendiqué.
- **Suite backend : 179 tests, 2 141 sous-tests, aucun échec** après ces changements.
- **10 tests Python : OK** : altération de source, UI ou manifeste, ajout/retrait
  de fichier, symlink, provenance incorrecte, restauration du client retiré,
  assemblage reproductible et contenu de l'archive vérifié par SHA256.
- **Intégrité candidate : OK**, 457 fichiers, incluant les 36 bundles/fichiers dist
  inchangés. 426 fichiers installés restent identiques ; 26 fichiers backend/tests
  changés et 5 tests ajoutés sont explicitement listés par rapport au manifeste.
- `current/manifest.json`, dépendances runtime, migrations et entrypoint intacts.

## Contrôle distinct et assemblage local

`candidate.py verify` compare chaque fichier au nouveau
`candidate-manifest.json`, puis vérifie les protections de la version installée.
L'empreinte du manifeste installé est fixée dans le vérificateur. La commande
`record` est une action explicite après revue des changements autorisés ; elle
n'est jamais appelée par la CI. Les empreintes détectent la dérive, elles ne sont
pas une signature d'authenticité indépendante du dépôt.

Le nouveau workflow **Verify backend candidate** vérifie uniquement l'intégrité
et les tests Python. Il ne compile, ne publie et ne déploie aucune image. Il a été
ajouté localement ; aucune exécution GitHub n'est revendiquée.
Le contrôle requis **Verify current version** et ses règles restent inchangés :
il continuera de refuser les différences avec la version installée. La validation
candidate ne contourne pas cette protection et ne rend pas la branche fusionnable.

L'assemblage produit une archive déterministe des sources backend présentes et
des bundles installés exacts, avec leurs deux manifestes. Il exclut les fichiers
non listés, notamment secrets, `.env`, base utilisateur et `.git`, et refuse
l'écrasement d'un fichier de sortie existant. L'archive inclut les fragments de
sources conservés dans la capture ; elle ne reconstitue pas les sources frontend
manquantes.

```sh
bash validation/check-backend.sh
python3 validation/candidate.py verify
python3 validation/candidate.py assemble --output /tmp/evsolar-candidate.tar.gz
```

Archive locale produite : `/tmp/chargeha-backend-candidate-20261009.tar.gz`.
SHA256 : `b148bf308ac276f989136d49e0131352c5d93d53e739451695ea47e4429b064d`.
Ce fichier est une archive de sources et d'assets, **pas une image Raspberry**.
Aucune exécution applicative, migration de base réelle, commande Tesla, connexion
Raspberry ni publication n'a été effectuée.

La prochaine étape avant un déploiement serait de définir et valider séparément
l'environnement Linux ARM64 (Deno, SQLite FFI, proxy Tesla, fichiers runtime),
puis une procédure de release candidate approuvée. Le rebuild du frontend complet
reste impossible à certifier sans retrouver ses sources exactes. Aucun ancien
Dockerfile ni automatisme de publication n'est restauré.

---

Le bilan ci-dessous décrit l'étape initiale, avant le nettoyage format/lint et
le contrôle candidat ajoutés ci-dessus.

# Bilan initial de la reprise backend — 9 octobre 2026

Base : `46e10d950896689aa84a113c78d1f1d2921da017` (main distant vérifié).
Branche isolée : `reprise/backend-security-sse-20261008`.
Référence historique uniquement : `6cd938d3688fb64eab8b0eebddf071c8225712e4`.
Aucun cherry-pick global, merge, déploiement, accès Raspberry ou changement de production.

## Changements retenus

- **Auth** : reprise sélective de #78. Une exemption tRPC exige que toutes les
  procédures du batch soient exactement `auth.login` ou `auth.session`, via GET
  ou POST. Les préfixes trompeurs, batches mixtes et chemins API avec extension
  statique restent protégés. `/health` est une exemption exacte. Les ressources
  du design installé restent accessibles pour afficher le formulaire de connexion.
- **SSE / AsyncQueue** : curseur FIFO avec coût amorti O(1), retrait du listener
  AbortSignal à chaque réveil, arrêt pendant une rafale lors d'une annulation,
  libération immédiate des références consommées et compactage périodique.
  #78 seul conservait les références jusqu'au prochain vidage et continuait une
  rafale malgré l'annulation. Tests sur 4 096 événements, FIFO, `undefined`, abort
  avant lecture, pendant attente et pendant rafale.
- **Télémétrie / sécurité** : un retour du même cache ne supprime plus une erreur
  de rafraîchissement. Le nouveau test d'intégration échouait avant cette correction
  (SET AMPS à 16 A au lieu du STOP attendu), puis passe. La récupération s'appuie
  sur le changement de `lastUpdated`, contrat déjà utilisé pour les événements.
- **Overseer** : une absence d'état produit une alerte explicite « STOP not
  confirmed ». Le verrou de sécurité demeure, sans toucher au choix manuel
  Automatic charging. Tests STOP réel, refus, absence d'état et borne externe.
- **Tests** : rétablissement des attentes conformes aux corrections de septembre /
  octobre, sans revenir aux comportements anciens : STOP hors backoff,
  notification Charging Paused, sonde HTTP `/health` du proxy. Ajout d'assertions
  qu'un refus START/STOP/SET AMPS n'est pas journalisé comme action exécutée.
- **Validation séparée** : imports de test et lockfile dans `validation/` ; aucun
  changement de `deno.json`, `deno.lock` ou des exports des packages du runtime.
  Les versions et intégrités des packages runtime sont conservées. Deno a
  normalisé trois listes de dépendances JSR dans le lock de validation ; les
  intégrités correspondantes restent identiques.

## Protections conservées

| Protection | Vérification |
| --- | --- |
| `pendingSince` persiste dans une même direction | Six nouvelles séquences moteur, retour de commande simulé |
| `chargeAmpsActual` / `charger_actual_current` | Code inchangé ; test TeslaAdapter de télémétrie réelle et suite moteur |
| Cache une minute pendant la charge | Nouveau test de frontière 59 999 / 60 000 ms |
| Refus START, STOP, SET AMPS | Backoff + log `none` / `Command not executed` |
| STOP sécurité hors backoff | Test révisé conforme au comportement actuel |
| STOP réel Overseer, échec explicite | Tests STOP forcé, refus et état manquant |
| `charging_enabled=false` | Test arrêt d'une charge automatique active |
| Perte télémétrie | Test avec cache actif et fetch en échec ; erreur non effacée par le cache |
| Borne externe | Tests absence de commande/poll et exclusion Overseer |
| Réveils inutiles | Stratégie actuelle inchangée, tests TeslaApiStrategy / middleware |
| Automatic charging manuel | Assertions du choix utilisateur inchangé après safety trip |
| Design installé | 36 fichiers dist identiques octet pour octet ; manifeste intact |

Séquences à pas d'une minute, seuil 2 A, stabilisation 3 minutes, avec retour de
chaque commande acceptée :

| Cibles | Ampérages effectivement retenus par le test |
| --- | --- |
| 5→6→7→6→7→6 | 5→5→5→5→7→7 |
| 5→7→6→8→7 | 5→5→5→8→8 |
| 5→6→5→6→5 | 5→5→5→5→5 |
| 5→8 | 5→8 |
| 5→10 | 5→10 |
| 5→16 | 5→16 |

Ce sont des tests de décisions avec retour simulé, pas des essais physiques sur
Tesla. Les changements de 1 A sont volontairement temporisés ; revenir à la
consigne actuelle interrompt une demande de changement.

## Résultats

Deno 2.9.6, macOS ARM64. Sources backend locales, DB de test en mémoire, serveurs
HTTP factices ; réseau d'exécution des tests limité à localhost/127.0.0.1/0.0.0.0.

- Suite serveur + shared + plugins backend : **179 tests, 2 141 sous-tests,
  aucun échec**, avec vérification TypeScript activée.
- Six séquences : **6/6 en UTC et 6/6 en Europe/Paris**.
- Type-check `packages/server/src/main.ts` avec lock runtime figé : **OK**.
- `deno audit --lock=deno.lock` : **No known vulnerabilities found**. C'est le
  résultat de la base consultée à cette date, pas une garantie d'absence de faille.
- Compilation native du backend par `deno compile` : **OK**. Binaire de validation
  dans `/tmp/chargeha-backend-validation`, non exécuté. Ni image Linux ARM64, ni
  certification d'un paquet déployable : fichiers dist/migrations et environnement
  d'exécution resteraient à assembler et vérifier séparément.
- Format des fichiers changés et `git diff --check` : **OK**.
- Format général : **2 fichiers préexistants non formatés**, `ProxyHealth.ts` et
  `TeslaService.ts`, également présents dans l'archive intacte de la base.
- Lint général : **38 problèmes contre 40 dans la base intacte**. Les anciens
  plugins de lint ont disparu mais leurs directives subsistent ; autres écarts
  préexistants de types/export/import. Aucun nettoyage global du runtime figé.
  Lint ciblé : OK après exclusion explicitement limitée de
  `ban-unknown-rule-code` et `no-slow-types` (les cinq erreurs de cette dernière
  règle proviennent d'exports préexistants hors fichiers changés).
- Contrôle original `scripts/verify-current.py` : **échec attendu**, 11 fichiers
  backend/tests modifiés et 5 nouveaux tests. Ne pas présenter ce contrôle comme vert.
- Contrôle complémentaire `validation/verify-preserved.py` : **OK**, 441 fichiers
  installés inchangés, exactement 16 écarts listés, manifeste et tous les dist intacts.
  La liste d'écarts est un outil de revue, pas une nouvelle attestation de release.

## Non retenu de #78

Pas de restauration de `packages/client`, React 19/Vite 8/Vitest 4/Recharts 3,
Dockerfile, publication, précompression d'assets, anciens scripts ou ancien design.
Les changements de types/imports HealthService et routes de plugins de #78
n'apportent pas de correction manquante justifiant une migration ici.
Pas de mise à jour opportuniste des dépendances : audit courant sans alerte et
priorité à la compatibilité du backend avec les bundles installés.

Les sources complètes du frontend installé ne sont pas certifiées. Impossible de
revendiquer un rebuild fidèle, la suite client historique, les optimisations du
Dashboard de #78, une nouvelle image Docker ARM64 complète ou un smoke de cette
image sous contraintes Raspberry. Les fragments TSX des plugins ne reconstituent
pas l'ancien package client. Aucun essai `/health` sur production effectué.

## Risques et suites recommandées

1. **Intégrité de release** : garder la reprise en Draft tant qu'une procédure de
   version candidate n'a pas été décidée. Ne pas réécrire le manifeste installé
   pour simplement satisfaire le contrôle requis. Aucun workflow modifié ici.
2. **SSE lent** : la mémoire des événements consommés est libérée, mais le backlog
   non consommé reste non borné. Définir d'abord une politique de déconnexion /
   resynchronisation ou de coalescence par type pour ne pas perdre des événements
   importants. Ajouter ensuite tests client/serveur et métriques de profondeur.
3. **Observabilité** : conserver l'erreur de télémétrie et l'échec STOP explicites.
   Étape suivante : métriques âge du relevé, durée/attente des commandes et
   compteurs de refus, sans VIN ni jetons dans les labels. Éviter une journalisation
   par tick qui augmenterait les écritures SQLite sur Raspberry.
4. **Régulation** : les refus et pertes réseau sont simulés ; l'acceptation d'une
   commande par l'API ne prouve pas le courant réellement délivré. Conserver la
   vérification par télémétrie réelle. Étudier séparément les délais de la file
   globale des commandes et les longues exécutions Overseer avant tout refactoring.
5. **Performance Raspberry** : gain algorithmique SSE démontré par le code ; aucun
   chiffre CPU/RAM sur Raspberry revendiqué. Mesures sous charge et validation
   physique restent une étape ultérieure explicitement autorisée.
6. **Tests/outillage** : configuration séparée reproductible ci-dessous. Restaurer
   une chaîne complète uniquement quand la provenance des sources frontend et le
   contrat de release candidat seront établis.

## Reproduction locale

Depuis la racine de cette branche (ne démarre ni serveur applicatif ni véhicule) :

```sh
deno test --frozen --import-map=validation/imports.json --lock=validation/deno.lock \
  --allow-env --allow-read --allow-write --allow-ffi \
  --allow-net=127.0.0.1,localhost,0.0.0.0 --unstable-ffi \
  --ignore='**/client/**,**/*.test.tsx' packages/server packages/shared packages/plugins
deno check --frozen packages/server/src/main.ts
deno audit --lock=deno.lock
python3 validation/verify-preserved.py
python3 scripts/verify-current.py # échec attendu : version installée != candidate
```
