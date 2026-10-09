# Simulation intégrée et corrections de sécurité — 9 octobre 2026

Branche locale `reprise/backend-security-sse-20261008`, toujours basée sur
`46e10d950896689aa84a113c78d1f1d2921da017`. Aucun merge ni déploiement.

## Ce qui est réellement simulé

Les scénarios intégrés exécutent le vrai ChargeController, ControllerEngine,
VehicleManager, middleware Tesla, garde des limites électriques, événements et
journaux SQLite en mémoire. Les seules entrées remplacées sont le véhicule,
l'onduleur et l'horloge. Le courant physique simulé suit les commandes acceptées
au relevé suivant ; il n'est pas recopié depuis le cache optimiste du gestionnaire.

Ce n'est pas une simulation du frontend navigateur, du réseau Tesla réel, de
l'image Docker ou du matériel Raspberry. Les tests HTTP d'adaptateur existants
complètent la campagne avec des serveurs factices locaux. Aucun véhicule réel
n'est contacté. Une campagne réussie ne prouve pas l'absence de tout défaut.

## Trois défauts reproduits, puis corrigés

1. **Perte de télémétrie + refus de STOP.** L'erreur de commande remplaçait l'erreur
   de rafraîchissement dans le même emplacement ; la boucle suivante pouvait ne
   plus reconnaître le besoin de STOP. Une mémoire d'erreur de télémétrie séparée
   conserve maintenant ce besoin, indépendamment de la dernière erreur de commande.
2. **Redémarrage pendant une panne de télémétrie.** Après un STOP réussi, un cache
   « arrêté » pouvait permettre un nouveau START alors que les lectures échouaient
   encore. Le contrôleur reste maintenant en attente pour les modes automatiques,
   jusqu'à réception d'un relevé distinct. Charge Now reste un choix manuel explicite.
3. **STOP pendant START en cours.** Le STOP utilisait l'ancien état arrêté fourni
   par son appelant, même lorsqu'un START venait de réussir en tête de file. Le
   STOP consulte aussi l'état mis à jour au moment de son exécution. Si l'un des
   deux états signale une charge, il tente l'arrêt ; le test vérifie le dernier
   appel à l'adaptateur et son état physique, pas seulement `success: true`.

Les trois tests échouaient avant correction et passent après. Un scénario
supplémentaire relie le véritable Overseer au gestionnaire et au contrôleur :
oscillation → verrou de sécurité → STOP refusé → alerte explicite → nouvelle
boucle → STOP réussi, sans modifier Automatic charging.

Le test préexistant d'état initial absent a été adapté au diagnostic plus précis
« Wait — vehicle state refresh failed », tout en conservant l'action `none` et
le contrôle d'absence de télémétrie.

## Campagne et résultats

| Scénario | Volume et assertions |
| --- | --- |
| Journée complète | 1 440 cycles d'une minute, nuit → lever → nuages → charges domestiques → orage → reprise → coucher |
| Refus combinés | 1 SET AMPS, 1 START, 2 STOP refusés ; refus visibles et non journalisés comme exécutés |
| Commande utilisateur | OFF arrête, ON permet la reprise ; aucun changement automatique du choix utilisateur |
| Télémétrie Tesla | Panne de dix minutes, arrêt réessayé malgré le backoff, aucun nouveau START/SET AMPS pendant la panne |
| Onduleur | Panne de dix minutes, réduction au minimum puis arrêt ; reprise après lectures valides |
| Borne externe | Fenêtre d'exclusion de trente minutes sans commande du contrôleur |
| Limites multi-véhicules | Deux campagnes de 720 cycles de dix secondes, trois voitures dont une externe, graine 8731, priorité activée/désactivée |
| Budget électrique | Plafonds individuels 12/16 A, minimum 5 A, import maximal 3 kW avec consommation externe soustraite ; assertion à chaque cycle |
| Planning | 25 cycles autour de minuit Europe/Paris ; plage 23:58–00:10 interrompue par OFF puis réactivée par ON |
| SSE | 20 vagues de 12 abonnés au routeur tRPC, 100 événements par vague, annulation en pleine rafale ; zéro listener restant après chaque vague |

Les deux campagnes multi-véhicules totalisent **1 440 cycles**, avec respect du
budget à chaque cycle malgré les sauts pseudo-aléatoires de production et de
consommation. Elles produisent respectivement 863 et 758 commandes SET AMPS dans
ce scénario volontairement brutal ; ces nombres ne constituent pas une cible
pour l'exploitation réelle.

La journée délivre **27,512 kWh simulés**, avec **552 lectures véhicule, 53 commandes
et un seul réveil**. Énergie calculée avec un modèle monophasé à 230 V, sans modèle
thermique, rendement batterie ni délais physiques réalistes. Ce n'est ni une
prévision de production ni une estimation de coût API.

Extraits de la trace (indices de scénario, pas heures locales) :

| Minute | Résultat |
| --- | --- |
| 570 | OFF manuel : STOP réussi |
| 580 | ON manuel : reprise |
| 630–631 | Télémétrie perdue, STOP refusés, action journalisée `none` |
| 632 | STOP réussi |
| 639 | Toujours arrêté, attente de télémétrie |
| 640 | Télémétrie rétablie, reprise |
| 780 | Orage, réduction à 5 A pendant le délai de grâce |
| 800 | Retour du solaire et reprise |
| 840 | Panne onduleur, réduction à 5 A |
| 849 | Charge arrêtée |
| 850 | Première lecture valide : reprise encore suspendue |
| 870 | Charge rétablie |
| 990–1019 | Contrôle par borne externe : aucune commande |
| 1100–1439 | Nuit : charge arrêtée |

Trace locale : `validation/results/system-day.json` et `system-day.csv`, exclues
volontairement de Git. Le courant de chaque ligne est mesuré avant la décision,
l'état de charge après. Le champ `action` rapporte le dernier journal disponible ;
pendant l'exclusion externe, ce journal n'est pas renouvelé (la liste `commands`
est vide). L'horloge commence à 00:00 UTC et avance d'une minute avant le premier cycle.

## Validation finale

- **184 tests / 2 146 sous-tests, zéro échec**, suite serveur/shared/plugins backend.
- Les six séquences d'ampérage demandées restent dans la suite.
- **10 tests Python d'intégrité/assemblage : OK**.
- **Format, lint sans désactivation de règle, type-check backend : OK**.
- **Compilation native backend macOS ARM64 : OK**, binaire non exécuté.
- Audit du lock runtime : **aucune vulnérabilité connue signalée**.
- **461 fichiers candidat vérifiés** ; 36 fichiers dist inchangés, manifeste installé
  intact. 423 fichiers installés inchangés et 38 écarts backend/tests listés.
- Nouveau contrôle candidat conservé distinct du contrôle historique, qui continue
  à signaler les différences avec la version installée. Aucune exécution CI GitHub
  revendiquée, travail local seulement.

Archive locale candidate : `/tmp/chargeha-candidate-simulation-20261009.tar.gz`.
SHA256 : `87c5c198c18c3155c2bd1727f34e582063f4ec5bd7c7dba2f5ed7ab3a93dfe0a`.
Archive de sources et bundles exacts, pas une image Raspberry certifiée.

## Reproduire

```sh
CHARGEHA_SIM_REPORT=/tmp/evsolar-day.json bash validation/check-backend.sh
```

Les erreurs imprimées pour les commandes refusées sont des injections attendues ;
le résultat des assertions détermine le succès de la campagne.

## Limites et suite

La campagne couvre un jour synthétique, deux campagnes déterministes de charge
électrique, les transitions horaires de minuit et plusieurs pannes combinées.
Elle ne couvre pas toutes les trajectoires, le changement d'heure saisonnier,
les redémarrages machine ou la persistance du cache à travers une panne de courant.
Le backlog SSE non consommé reste non borné ; le test vérifie son abandon et le
retrait des listeners, pas une limite maximale de mémoire sous client bloqué.
La file de commandes reste sérialisée : un STOP doit attendre une commande déjà
partie. Les délais réels du réseau ne sont pas reproduits dans le modèle de journée.

Avant production : revue des changements, stratégie de release candidate, puis
validation Linux ARM64 et matériel explicitement autorisée. Les sources complètes
du frontend installé restent non certifiées et aucun ancien frontend ou mécanisme
de publication n'a été restauré.
