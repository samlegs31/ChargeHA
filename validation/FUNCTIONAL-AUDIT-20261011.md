# Audit fonctionnel de la candidate — 11 octobre 2026

## Verdict et périmètre

Cette campagne augmente la confiance ; elle ne constitue pas une garantie de fonctionnement dans tous les scénarios. Elle porte sur les sources backend/shared/plugins présentes et les composants Settings extraits du bundle conservé. Les APIs et matériels externes sont simulés. Ni Raspberry ni véhicule réel n'ont été contactés. Aucun merge ou déploiement.

## Défauts reproduits et corrigés

1. Les mesures non finies d'onduleur n'étaient pas explicitement classées indisponibles. Le test échouait avant correction. Les champs requis et les champs facultatifs lorsqu'ils sont présents rejettent NaN et ±Infinity. La protection existante de perte d'énergie est appliquée : pas de nouveau START solaire, réduction puis STOP après le délai de grâce. 36 combinaisons : six champs × trois valeurs × charge active/inactive. Les valeurs null facultatives restent acceptées.
2. Deux contrôles Overseer simultanés pouvaient doubler STOP et notification. Le test échouait avant correction. Un verrou local libéré dans finally empêche le chevauchement, y compris lorsque le contrôle précédent attend des I/O. Il ne contourne ni STOP ni protection.

## Matrice des vérifications

| Domaine | Preuve exécutée | Limite |
| --- | --- | --- |
| Régulation solaire | Séquences 5→6→7→6→7→6, 5→7→6→8→7, 5→6→5→6→5, 5→8, 5→10, 5→16 ; hausses temporisées, baisses rapides ; plafonds individuels | Modèle électrique simulé |
| Journées complètes | Deux journées de 1 440 cycles : plafond non fixé / 22 A, nuit, nuages, orage, charges domestiques, erreurs de commandes et pertes de télémétrie | Pas de rendement/thermique batterie ou latence réseau réelle |
| Plusieurs véhicules | Huit campagnes de 720 cycles, trois véhicules dont un externe, quatre graines (0, 1, 8731, 4294967295), priorité ON/OFF ; plafonds et budget à chaque cycle | Total 5 760 cycles ; pas une mesure de performance Raspberry |
| Pause anti-oscillation | Vrai Overseer + ChargeController + VehicleManager + SQLite : STOP, 12 minutes de boucles, reprise ON, maintien OFF, plafond 22 A, aucun redéclenchement ancien | Pause toujours globale ; registres anciens mal formés restent manuels |
| Sécurité des commandes | STOP refusé, perte télémétrie, STOP pendant START, commande hors backoff, refus START/SET AMPS ; borne externe exclue | Acceptation et courant physique Tesla réels non certifiés |
| Plannings | Minuit, fuseaux, mémoire de blocage batterie ; Paris 29 mars et 25 octobre 2026 : heure absente/répétée ; réexécution ciblée TZ=Europe/Paris | Saut arbitraire d'horloge système/NTP non couvert entièrement |
| Authentification / API | Sessions, mots de passe, OIDC, exemptions exactes, batches mixtes, fichiers statiques, validation Zod ; transport HTTP Settings | Fournisseur OIDC et réseau public simulés |
| SSE / mémoire | Files bornées, abort, initialisation, saturation, reconnexions simulées et libération des listeners | Pas de campagne de plusieurs jours sur Raspberry |
| Données | Tests AppDatabase, repos, journaux, rétention, historique Charge HQ, stats, tarifs, configuration ; nouveau test de totaux multianuels, base vide et isolation de véhicule | Disque plein, coupure secteur, sauvegarde/restauration réelle non certifiés |
| Adaptateurs | Tests Tesla, Fronius local/cloud, Enphase, Sigenergy Modbus, simulateurs, tokens, découverte | Aucun équipement tiers réel exercé |
| Simulateur d’interface | Deux journées, 0/6 kW, deux véhicules et batterie domestique ; reproductibilité exacte, bornes SOC/courant, compteurs statistiques | Calcul pur, sans DOM ni matériel |
| Services | Tests notifications, forecast, tunnel, géocodage, wizard, health et diagnostics | Livraison réelle des notifications et services Internet non exercés |
| Settings | Navigateur isolé : 1 A, annulation, sauvegarde/rechargement, erreurs/retry, suppression, autres véhicules, sections clavier, brouillons, recherche, diagnostics et mobile | Données fictives ; pas un E2E complet avec authentification/backend réel |
| Construction / intégrité | Format, lint, types, audit, compilation backend ; 473 empreintes candidat ; 13 tests d'intégrité | Frontend complet et image Raspberry non reconstruits |

## Limites qui interdisent une promesse « 100 % »

- Les huit tests TSX et le test client oauthOrigin dépendent de la chaîne frontend retirée ; ils sont exclus de la suite Deno. Les tests navigateur Settings ne les remplacent pas.
- Les sources complètes du frontend installé ne sont pas certifiées. Pas de rebuild fidèle ni validation complète de toutes les pages avec le nouveau serveur.
- Aucun test matériel : pertes réseau longues, délais Tesla, limitations du chargeur, compteurs réels, coupure secteur et usure/charge du stockage demandent une recette isolée sur matériel.
- La couverture mesure les fichiers chargés par les tests, pas tous les chemins et toutes les combinaisons possibles. Un pourcentage élevé ne prouve pas la sûreté du système.
- Les tests de logique solaire ne garantissent pas zéro import transitoire : délai d'échantillonnage, commande et courant minimal du chargeur restent physiques.

## Prochaines étapes avant une livraison

Recette navigateur authentifiée contre un backend isolé, reconstruction documentée du runtime ARM64 avec SQLite vérifié, restauration d'une copie de sauvegarde et tests de coupure/reprise sur matériel hors production. Déploiement uniquement sur nouvelle autorisation. Le contrôle historique de version figée doit rester distingué de l'intégrité de la candidate : son échec est attendu, son manifeste n'est pas réécrit.

## Résultats locaux finaux

- Suite complète en UTC : **221 tests, 2 155 étapes, zéro échec**.
- Campagne ciblée Europe/Paris : 6 tests, 23 étapes, zéro échec.
- Intégrité : 473 fichiers, 13 tests ; format : 353 fichiers ; lint : 351 fichiers ; type-check, compilation native backend et audit réussis.
- Navigateur Opera/Chromium isolé : interactions Settings réussies, zéro erreur JavaScript capturée.
- Couverture des fichiers chargés, hors tests/mocks : **82,8 % lignes, 87,9 % branches, 86,5 % fonctions**. ChargeController : 97,4 % lignes ; ControllerEngine : 95,9 % ; Overseer : 94,1 %. Totaux historiques : 98,5 % ; simulateur : 94,4 % ; statistiques du simulateur : 100 %.
- Les chemins non importés ne sont pas comptés. En particulier, le bootstrap complet, les intégrations réseau réelles et toutes les pages frontend ne sont pas certifiés par ces chiffres.

[Table détaillée de couverture](COVERAGE-20261011.md). Le rapport correspond aux commandes `deno test --coverage` sur server/shared/plugins (client/TSX exclus), puis `deno coverage --include='.*packages/.*' --exclude='.*(test|Mock|Harness|node_modules).*'`.
