# Restauration des visuels Tesla — 12 octobre 2026

La capture montrait le dessin générique avec « Electric vehicle ». Les deux PNG étaient présents et accessibles. Après redémarrage, le cache de télémétrie ne conservait pas carType/exteriorColor/wheelType ; le rechargement initial depuis les décisions du contrôleur omet ces champs. Une voiture hors ligne ne les renvoie pas de nouveau. Le rollback du pied de page ne suffisait donc pas à restaurer l'apparence.

Les journaux locaux contenaient encore les caractéristiques de Friday et Edith. La reprise extrait uniquement modèle/couleur/jantes pour les véhicules enregistrés et les range dans tesla.vehicle_appearance.<id>. Aucun réveil, aucune commande de charge ni changement de limite. Ces caractéristiques sont désormais sauvegardées quand Tesla renvoie des informations nouvelles ; des valeurs manquantes ne les effacent pas.

Une route derrière l'authentification restitue seulement ces trois champs. Le composant de carte les utilise comme secours lorsque l'état live n'en contient pas. Il ne change pas l'état en ligne, la batterie, la puissance, la fraîcheur ou le branchement. Même sans télémétrie en mémoire, le visuel reste récupérable indépendamment.

Le pied de page de version est retiré, ainsi que son paramètre d'URL sur le module principal. Les imports des chunks doivent partager la même URL de module ; un test d'intégrité vérifie cette contrainte. La cause de la silhouette constatée était la perte des métadonnées ; le risque de double chargement du module était un autre défaut de la tentative de version.

Validation : 230 tests / 2 155 étapes ; format, lint, types ; 14 tests d'intégrité. Navigateur mobile : rendu des deux PNG actuels avec état hors ligne, aucune erreur JavaScript, aucun débordement horizontal et batterie témoin inchangée. Ce test utilise les composants extraits du bundle et ne remplace pas une recette complète authentifiée.
