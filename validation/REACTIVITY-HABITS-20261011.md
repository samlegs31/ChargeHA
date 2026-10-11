# Réactivité et apprentissage local — 11 octobre 2026

Cette évolution du Draft #87 conserve les réglages et le moteur de décision actuels : aucun mode solaire strict, aucun changement des tolérances, délais de grâce, cooldowns ou protections contre les marche/arrêt. Aucun déploiement Raspberry.

## Réactivité

Les événements énergie, branchement, mode et configuration peuvent avancer le prochain cycle. Les demandes sont regroupées avec un espacement de cinq secondes entre cycles anticipés ; un timer déjà prévu plus tôt n'est pas retardé. Les exécutions concurrentes partagent un seul cycle pour éviter les commandes en double. L'arrêt du contrôleur désabonne les événements et empêche sa replanification.

Ce délai concerne le calcul, pas une garantie de réponse physique Tesla. Les délais de décision, le cache Tesla, les refus de commandes et les sécurités restent applicables.

## Prévisions et habitudes

- Cache météo brut de cinq minutes, quatre entrées maximum ; les corrections par mesures réelles restent recalculées. Échecs non mémorisés.
- Résultat de prévision partagé quinze secondes, seize véhicules maximum. Une modification de configuration peut donc prendre quinze secondes pour apparaître dans cette prévision indicative.
- Apprentissage local de la présence branchée à domicile par jour et heure, avec contexte de potentiel photovoltaïque météorologique et batterie maison. Ce n'est pas une prédiction directe d'heure d'arrivée.
- Seize véhicules maximum, 168 cases hebdomadaires et neuf contextes par véhicule. Une observation horaire maximum ; examen des données au plus toutes les quinze minutes. Les observations anciennes perdent progressivement du poids après seize échantillons.
- Télémétrie énergie de moins de 90 secondes et véhicule de moins de dix minutes ; aucune interrogation Tesla ni météo supplémentaire pour apprendre. Données persistées dans runtime.charging_habits_v1, rechargées au redémarrage.
- Au moins trois observations du même créneau hebdomadaire avant de publier une probabilité. La météo absente reste inconnue. La batterie utilisée pour les 24 heures d'estimation est son état actuel, pas une simulation de son état futur.

L'estimation est disponible dans forecast.connectionOutlook et dans forecast.today.connectionOutlook. Elle est indicative : elle ne bloque pas une charge, ne remplace pas le branchement constaté et ne modifie jamais Automatic charging. Les bundles installés n'affichent pas encore cette nouvelle estimation. Les prévisions solaires existantes conservent leur apprentissage de correction.

## Validation

Suite backend : 228 tests, 2 155 étapes ; tests de rafales d'événements, mutualisation de cycles, arrêt, caches, statistiques bornées, changement d'habitudes, persistance et rechargement sans commande Tesla ni appel météo. Contrôles format, lint, types et treize tests d'intégrité inclus. Empreinte candidat : 479 fichiers ; manifeste installé et bundles inchangés par cette évolution.

Ces tests restent des simulations. Ils ne certifient ni tous les scénarios physiques ni les performances sur Raspberry. Le frontend complet et l'image Raspberry ne sont pas reconstructibles avec certitude depuis les sources disponibles. Aucun changement réseau, Docker, publication, production ou Raspberry.
