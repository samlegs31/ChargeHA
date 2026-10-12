# Suite de la Draft #87 — 11 octobre 2026

Le test `packages/server/src/trpc/httpCompatibility.test.ts` traverse le véritable adaptateur HTTP tRPC et les schémas Zod avec une base SQLite en mémoire et le vrai ConfigService. Il couvre :

- lecture de plusieurs sections dans un batch JSON ;
- modifications 22 → 23 → 21 A et relecture persistée ;
- sauvegarde partielle ancienne qui préserve le plafond solaire ;
- rejet de valeurs fractionnaires, hors limites, chaîne et null, sans altérer la valeur persistée ;
- refus d'une mutation via GET ;
- réponse mixte HTTP 207 : résultat valide préservé et erreur NOT_FOUND structurée.

L'erreur 500 initiale était propre au mock : son proxy exposait une méthode `then` fictive, appelée lorsque l'adaptateur attendait le contexte. Le contexte simulé déclare désormais explicitement `then: undefined`. Aucun correctif runtime n'était nécessaire.

`validation/check-runtime.ts` ouvre seulement une base en mémoire et vérifie SQLite 3.53.4 réellement chargé, son contrôle d'intégrité et la présence de DENO_SQLITE_PATH. La CI ARM64 l'exécute avant la suite serveur ; elle ne peut donc plus afficher une validation SQLite 3.53.4 si l'ancien moteur a été chargé à sa place.

Ces tests de transport complètent les tests directs des routeurs. Ils ne constituent pas une recette navigateur du bundle installé, ni un test sur une Tesla réelle. Aucun bundle, manifeste installé, réglage de production ou Raspberry n'est modifié. Aucun merge ni déploiement.
