# Réactivité solaire — 9 octobre 2026

## Correction

Le moteur appliquait aussi aux petites baisses de courant le délai prévu pour
stabiliser les variations. Avec un seuil de 2 A et un délai de 3 minutes, une
baisse de 1 ou 2 A pouvait donc attendre 180 secondes, alors que le réseau
compensait déjà le manque de solaire.

En charge solaire, toute baisse de consigne est maintenant acceptée au prochain
cycle de décision. Elle annule aussi une hausse en attente. Les petites hausses
conservent leur temporisation et leur `pendingSince` tant que la demande reste
dans la même direction ; les grandes hausses et la rampe de démarrage existante
restent inchangées. Aucun paramètre installé ni fréquence de polling n'est changé.

Le changement se limite au suivi solaire. Les délais distincts de grâce sous le
minimum de charge, d'arrêt et de redémarrage, les protections de sécurité,
le cache Tesla d'une minute, le contrôle du courant réel et les refus de commande
restent en place. Automatic charging reste un choix manuel.

## Mesure avant/après

Tests déterministes : véhicule initialement à 16 A, réduction solaire persistante,
230 V par phase, pas de 10 secondes, stabilisation configurée à 180 secondes.
L'énergie ci-dessous représente uniquement l'import causé par l'attente du moteur,
après réception du relevé et décision ; les commandes et leur effet sont simulés
sans latence. Ce n'est pas une mesure physique de Friday.

| Baisse | Phases | Attente avant | Attente après | Import d'attente avant/après |
| --- | --- | --- | --- | --- |
| 1 A | 1 | 180 s | 0 cycle supplémentaire | 11,5 / 0 Wh |
| 2 A | 1 | 180 s | 0 cycle supplémentaire | 23 / 0 Wh |
| 1 A | 3 | 180 s | 0 cycle supplémentaire | 34,5 / 0 Wh |
| 2 A | 3 | 180 s | 0 cycle supplémentaire | 69 / 0 Wh |

Les cinq tests moteur ajoutés échouaient avant correction, puis passent. Le test
d'intégration transmet une réduction 8→7 A à l'adaptateur Tesla factice au cycle
suivant, puis six variations nuageuses ne provoquent aucune remontée parasite.
Un test vérifie qu'une baisse annule la hausse en attente et impose une nouvelle
stabilisation complète à la reprise. Le test multi-véhicules de modification
manuelle vérifie maintenant les hausses temporisées, pour conserver son objectif
d'isolation entre véhicules.

Séquences à pas d'une minute, avec retour des commandes acceptées :

| Cibles | Consignes retenues |
| --- | --- |
| 5→6→7→6→7→6 | 5→5→5→5→7→6 |
| 5→7→6→8→7 | 5→5→5→8→7 |
| 5→6→5→6→5 | 5→5→5→5→5 |
| 5→8 | 5→8 |
| 5→10 | 5→10 |
| 5→16 | 5→16 |

## Simulation intégrée et validation

La journée de 24 h / 1 440 cycles couvre les nuages, la consommation domestique,
les refus START/SET AMPS/STOP, pertes de télémétrie, panne onduleur, arrêt manuel
et prise en charge par une borne externe. Même scénario qu'à l'étape précédente :
54 commandes contre 53, 552 lectures véhicule et un réveil dans les deux versions.
Énergie de charge simulée : 27,297 kWh contre 27,512 kWh ; ce total n'est pas un
indicateur d'autoconsommation et ne prouve pas une économie réelle.

La suite complète inclut également deux campagnes multi-véhicules de 720 cycles,
le planning de nuit et les reconnexions SSE. Résultats finaux consignés dans le
README de validation. Trace de cette journée :
`/tmp/chargeha-solar-response-day.json`.

## Limites et livraison

La réaction réelle dépend encore de la fraîcheur du relevé énergie, du cycle
configuré (repli serveur de 30 secondes), de la file de commandes et du véhicule.
À courant minimum, le délai de grâce peut toujours autoriser un appoint réseau.
Ce correctif n'est donc pas une garantie de zéro import instantané. Un relevé
bruité peut entraîner une baisse supplémentaire ; la remontée temporisée limite
les oscillations, avec un compromis possible sur l'énergie solaire captée.

Les 36 fichiers du design installé et `current/manifest.json` sont inchangés.
Le contrôle de version installée reste volontairement distinct de la validation
candidate et échoue avec ces modifications backend. Les sources frontend exactes
manquent toujours : ni frontend complet ni image Raspberry reconstructibles avec
certitude. La compilation native macOS ARM64 vérifie uniquement le backend ;
le binaire produit n'a pas été exécuté.

Travail sur la branche isolée `reprise/backend-security-sse-20261008` : aucune
publication, commande réelle à Friday, modification production ni déploiement.
La validation physique de la latence et du courant réel reste une étape ultérieure.
