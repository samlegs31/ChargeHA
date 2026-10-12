# E.V. Solar — revue d’usage et modernisation, 10 octobre 2026

Base revue : Draft #87, commit `42db94200940a613f8cf31c4c7d1614011191921`.
Revue du code local et des documentations officielles actuelles. Les propositions
ci-dessous ne sont pas des fonctions déjà intégrées ni des gains mesurés.
Aucun accès Raspberry, changement runtime ou nouvelle dépendance durant cette revue.

## Constats vérifiés

- `ui-current/settings/Sections.js` conserve tous les enfants montés, y compris
  avant la première ouverture. Les sections sont visuellement plus simples, mais
  leurs hooks peuvent effectuer des requêtes même lorsqu’elles restent fermées.
- Le bundle `vendor-react-BYv-AQ32.js` porte React `18.3.1` et une chaîne de version
  React DOM `18.3.1-next-f1338f8080-20240426`. Ne pas confondre ce frontend installé
  avec la montée React 19 de l’ancienne PR #78.
- `AsyncQueue.ts` libère les références consommées et évite Array.shift(), mais
  ne borne pas le nombre d’événements en attente.
- `trpc/routers/subscriptions.ts` utilise déjà une seule connexion SSE multiplexée.
  Il émet le snapshot initial avant d’inscrire les listeners. Une transition pendant
  cette phase pourrait échapper à la connexion : risque identifié par inspection,
  à reproduire dans un test avant correction. Certains statuts ont déjà un replay.
- `ChargeController.emitControllerStatus` fournit déjà action, reason, detail,
  targetAmps et checksJson. Réutiliser ces faits pour expliquer la charge.
- `/health` vérifie HTTP et une lecture SQLite ; il ne prouve pas que le compteur,
  le véhicule ou la régulation disposent de données fraîches.
- `AppDatabase.ts` active déjà WAL et busy_timeout=5000 ; les schémas ont des index
  temporels. `EnergyPoller` empêche déjà les lectures concurrentes et rafraîchit les
  cumuls toutes les 60 secondes. Ne pas présenter ces fonctions comme nouvelles.

## Ordre de réalisation recommandé

| Priorité | Amélioration | Résultat attendu / preuve à demander |
| --- | --- | --- |
| P1 | Monter les sections Settings à leur première ouverture, puis conserver leurs brouillons | Aucun appel des sections jamais ouvertes ; sauvegarde et repli inchangés. Ne pas promettre d’arrêter les effets après la première ouverture |
| P1 | Protéger les brouillons lors d’un changement de catégorie et rendre l’état non enregistré visible | Un changement de catégorie ne perd pas silencieusement une modification ; aucune sauvegarde implicite d’Automatic charging |
| P1 | Afficher la limite solaire effective et sa cause | Distinguer plafond demandé, limite électrique, surplus, courant réel et commande en attente ; ne jamais afficher la consigne comme une mesure |
| P1 | Expliquer l’import réseau dans un langage simple | Distinguer grâce au courant minimum, maison consommatrice, télémétrie ancienne et délai de commande ; afficher l’âge des données |
| P1 | Borner le SSE et fiabiliser snapshot + événements | Client lent, connexion interrompue et reconnexion testés ; mémoire plafonnée sans perdre silencieusement un événement métier |
| P1 | Diagnostic protégé de la régulation | Âge énergie/Tesla, durée du cycle, file de commandes, dernier succès/échec et délai d’application ; conserver un healthcheck Docker sobre |
| P2 | Recherche Settings et liens directs vers les réglages | « solaire », « 22 A », « batterie » conduisent au bon champ ; mobile, clavier, labels et langue cohérents |
| P2 | Unités et portée clairement indiquées | Valeur A + puissance indicative calculée selon tension/phases connues ; jamais assimiler 22 A à une limite générale d’onduleur 6 kW |
| P2 | Mesurer puis optimiser SQLite et historiques | EXPLAIN QUERY PLAN sur une copie représentative, latence p95, taille DB/WAL, volume d’écriture ; comparer agrégations et index avant modification |
| P2 | Vérifier l’usage de Fleet Telemetry déjà présent dans l’installation | Inventorier les données réellement reçues et leur fraîcheur ; diminuer le polling seulement après validation du repli et du sommeil |
| P3 | Retrouver/certifier les sources frontend et reconstruire fidèlement le design | Build reproductible, comparaison visuelle, mêmes contrats API, tests authentifiés avant toute migration React |

## Technologies actuelles retenues sous conditions

1. **Deno 2.9, outillage et mesures natives.** Le projet est déjà dans cette génération.
   Aligner ultérieurement un patch stable testé avec le runtime ARM64 et le lockfile,
   sans mise à jour majeure groupée. Les nouvelles fonctions desktop n’apportent rien
   au service Raspberry. [Deno 2.9](https://deno.com/blog/v2.9).
2. **OpenTelemetry avec Deno**, pour corréler cycle, appel Tesla et échec. Instrumentation
   légère d’abord ; export optionnel, échantillonnage et rétention limités. Aucun jeton,
   VIN ou coordonnée dans les traces. Mesurer son coût avant activation sur Raspberry.
   [Documentation Deno](https://docs.deno.com/runtime/fundamentals/open_telemetry/).
3. **React Activity et React Compiler** après récupération du frontend. Activity peut
   conserver l’état des sections masquées en nettoyant leurs effets ; Compiler peut
   réduire les rendus inutiles. Une migration de bundles isolés n’est pas une solution
   fiable. Vérifier la compatibilité des composants et le gain avec un profil avant/après.
   [Activity](https://react.dev/reference/react/Activity),
   [Compiler](https://react.dev/learn/react-compiler).
4. **SQLite WAL et PRAGMA optimize** : WAL est déjà activé. Évaluer optimize avec la
   version embarquée et les plans de requêtes ; ne pas ajouter VACUUM ou checkpoints
   agressifs dans le cycle de régulation et ne pas réduire la durabilité des écritures.
   [SQLite](https://www.sqlite.org/pragma.html), [WAL](https://www.sqlite.org/wal.html).
5. **Tesla Fleet Telemetry** : flux de données à exploiter suivant compatibilité et
   configuration réelle. Un flux ne supprime pas les pertes réseau, les données
   périmées ni le besoin de confirmer les commandes. Ne pas modifier le réseau ou
   réveiller les véhicules pour cette étude.
   [Tesla](https://developer.tesla.com/docs/fleet-api/fleet-telemetry).

## À écarter pour cette reprise

- Réécriture Next.js, migration Bun, microservices ou Kubernetes sans besoin mesuré.
- IA/LLM dans les décisions START/STOP/SET AMPS : conserver un moteur déterministe.
- Polling Tesla plus fréquent par défaut pour masquer des délais de télémétrie.
- Remplacement complet du frontend à partir de sources non certifiées.
- Service worker qui garderait en cache des états ou commandes de charge périmés.
- Fusion d’événements SSE sans distinguer snapshots remplaçables et transitions métier.
- Promesse de zéro import : délais physiques et courant minimum restent à prendre en compte.

## Validation nécessaire pour les futurs lots

La précédente version a passé 202 tests / 2 149 étapes, 12 tests d’intégrité et les
scénarios navigateur locaux. Cette revue documentaire ne relance pas ces suites et
ne constitue pas une validation des propositions.

Pour chaque lot runtime : tests ciblés, suite serveur, format/lint/types, intégrité
candidate. Pour SSE : producteur rapide/consommateur bloqué, interruption au snapshot,
reconnexion, cleanup et mesures mémoire. Pour Settings : appels réseau réellement
comptés, navigation avec brouillon, échec de sauvegarde, accès clavier et mobile.
Pour régulation : reprendre les six séquences, plusieurs véhicules, horaires, données
périmées, refus de commande et STOP hors backoff. Comparer import Wh, nombre de commandes,
réveils et délai observation→consigne→courant réel, sans confondre simulation et mesure.

Le benchmark CPU/RAM/p95 ARM64 et les essais physiques restent à effectuer dans un
cadre isolé approprié. Aucun gain chiffré n’est affirmé ici. Le frontend complet et
l’image ne sont toujours pas reconstructibles avec certitude. Les Settings du Draft
restent non déployés. La PR reste Draft, sans merge ni changement de production.
