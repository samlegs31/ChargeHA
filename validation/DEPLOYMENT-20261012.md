# Déploiement autorisé — 12 octobre 2026

L'utilisateur a autorisé la livraison GitHub/Raspberry après contrôles, avec retour à la version précédente. La PR #87 reste Draft ; main n'est pas modifié.

## Version et contrôles

- Commit applicatif : `8617582b374ec43e5484b69122eced449192cc3e`.
- Image ARM64 locale : `evsolar:candidate-8617582`.
- Image livrée : `sha256:e0217f1c0c329b934fe283c2bee84b4aad3f6334da68716d623c6d963b4615c4`.
- Base : image réellement active avant livraison, `sha256:7534b9181fa209e0a11c10d207cf2e36b645077e5bbaea5d0b41888a7ef12700`.
- Runtime confirmé dans le conteneur : Deno 2.9.7 / SQLite 3.53.4, bibliothèque sélectionnée explicitement par DENO_SQLITE_PATH.
- SQLite ARM64 compilé depuis la source vérifiée : SHA256 `59822484d1049295068e4db069aec3cd059349d89e7f824c0eb563e7eaeafb3e`.
- Sources exactes exportées par git archive ; bundles installés conservés avec le patch Settings déjà revu. Pas de reconstruction du frontend depuis des sources certifiées.
- CI Linux ARM64 : https://github.com/samlegs31/ChargeHA/actions/runs/38157603113 ; suite 228 tests / 2 155 étapes, intégrité, format, lint, types et audit validés.

La construction initiale a échoué avant bascule : résolution de l'identifiant local avec BuildKit, puis permissions du cache Deno hérité. Le constructeur compatible avec l'image locale et les droits du cache dans la nouvelle image ont résolu ces problèmes. Aucun changement de permissions du conteneur actif.

## Essai préalable de restauration

Une copie SQLite cohérente de la base a été démarrée avec la nouvelle image, puis avec l'ancienne image sur cette même copie. Les deux conteneurs étaient sans réseau, sans port publié, sans accès aux volumes de production. Les deux démarrages, l'intégrité SQLite, la page HTML et ses assets ont été validés. Aucun ordre de test envoyé aux véhicules.

Le noyau ne permet pas d'appliquer la limite mémoire Docker demandée ; les essais ne constituent donc pas une certification sous plafond mémoire. Le plafond CPU était demandé à un cœur. Les tests ne remplacent pas une recette complète de toutes les pages authentifiées ni des scénarios physiques Tesla/onduleur.

## Bascule et résultat

Sauvegarde SQLite en ligne puis arrêt, copie complète des données arrêtées et contrôle d'intégrité. Ancien conteneur conservé, nouveau créé avec les ports, volumes, réseau et restrictions existants. Ajout explicite de DENO_SQLITE_PATH ; aucun réglage manuel de charge modifié.

Après bascule : healthy, /health serveur et base OK, zéro redémarrage automatique, 479 empreintes conformes. charging_enabled, exclusion de pilotage externe, limites générales et limites solaires comparés à la sauvegarde et inchangés. Premiers journaux sans erreur détectée ; nouvelles mesures énergie sans poll_failed et nouvelles décisions de régulation enregistrées. Pas de solaire strict ; temporisations existantes conservées. Fleet Telemetry inchangé.

## Retour arrière

Répertoire opérationnel privé sur Raspberry : `/home/chargeha/evsolar-release-8617582`.

- Sauvegarde complète et clé : `/home/chargeha/evsolar-backups/backend-20261012-103106` (accès privé).
- Conteneur précédent arrêté : `chargeha-rollback-20261012-103106`.
- Image précédente conservée : `evsolar:rollback-backend-20261012-103106`.
- Procédure préparée : `python3 /home/chargeha/evsolar-release-8617582/rollback.py` sur le Raspberry.

Cette procédure vérifie l'image active, prend le verrou de maintenance, arrête la candidate avant de démarrer l'ancien conteneur et contrôle sa santé. La candidate reste arrêtée et conservée. Aucun changement de schéma : le retour de code utilise la base courante afin de conserver l'historique récent, compatibilité testée sur copie. Restaurer la sauvegarde complète reste une opération distincte, service arrêté, qui ferait perdre les écritures postérieures à cette sauvegarde. Ne jamais démarrer les deux contrôleurs simultanément.

Les sauvegardes de cette livraison sont sur le Raspberry ; elles ne couvrent pas à elles seules une panne de sa carte de stockage. Aucune promesse de fiabilité absolue. Le contrôle du manifeste historique reste en échec attendu pour cette candidate ; il n'a pas été réécrit pour masquer l'écart.
