# Déploiement autorisé — 9 octobre 2026

L'utilisateur a ensuite demandé explicitement la mise à jour du Raspberry et de
GitHub. Cette autorisation remplace l'interdiction antérieure de déploiement pour
cette opération. La PR reste Draft et aucun merge dans main n'est effectué.

## Version livrée

- Source backend : `352986bfef2d0d26251bea4e45d3b00e046aef02`.
- Image locale Raspberry : `evsolar:backend-352986b`.
- Identité Docker : `sha256:7534b9181fa209e0a11c10d207cf2e36b645077e5bbaea5d0b41888a7ef12700`.
- Base exacte : `sha256:898e27be90a793b3311786435882c9dd44e6f1f33121d3db52c3429bf9a6943d`.
- Overlay des 47 fichiers backend/tests validés ; aucun bundle frontend changé.
- Empreinte de `overlay.tar` : `309aa538cb1f8225b1f0cfda47925c4ce5c879f625d2c5a1330409fbc1d2c27c`.
- Paquet et procédure sur le Raspberry : `/home/chargeha/chargeha-release-352986b`.

L'image a été assemblée nativement en ARM64 à partir de l'image locale vérifiée,
sans mise à jour de Deno ou des dépendances et sans récupération d'une image latest.
Ce n'est pas une reconstruction du frontend depuis ses sources. Aucun ancien
workflow Docker/publication n'est réintroduit dans le dépôt.

## Validations avant et après

Les 202 tests / 2 149 sous-tests et 10 tests d'intégrité de la revue locale restent
la validation complète du code. Sur Raspberry : type-check avec **Deno 2.9.4**,
démarrage d'un conteneur isolé sans réseau, sans données ni clés réelles, et
`/health` 200 avec serveur/base OK. Le conteneur d'essai a ensuite été supprimé.

Après bascule : conteneur **healthy**, zéro redémarrage automatique au contrôle,
`/health` serveur/base OK et **465 empreintes de fichiers conformes**. Variables
d'environnement, ports hôtes, volumes, réseau Docker existant, racine en lecture
seule et restrictions du conteneur ont été conservés. Le service de télémétrie
voisin n'a pas été remplacé. Aucune modification Tailscale ou réseau Raspberry.

F.R.I.D.A.Y. est identifié par son nom exact en base, sans publier son VIN.
Le plafond solaire est passé d'absent à **22 A**. Mode conservé : `vacation`
(Solar Only). Automatic charging était `true` et reste `true`. Configuration de
pilotage externe, verrou de sécurité et limites générales comparés à la sauvegarde
et inchangés. Aucun START/STOP/réveil de test envoyé aux véhicules ; le contrôleur
reprend son fonctionnement normal avec la configuration utilisateur.

## Sauvegardes et reprise

- Copie complète initiale : `/home/chargeha/evsolar-backups/backend-20261009-190038`.
- Sauvegarde SQLite cohérente actualisée et clé privée :
  `/home/chargeha/evsolar-backups/backend-20261009-190518`.
- Conteneur précédent conservé arrêté : `chargeha-rollback-20261009-190518`.
- Image précédente étiquetée : `evsolar:rollback-backend-20261009-190518`.

La première tentative s'est arrêtée avant remplacement : le contrôle recherchait
le nom littéral Friday alors que la base contient F.R.I.D.A.Y. L'ancien service a
été redémarré automatiquement, puis l'identité exacte a été vérifiée. La seconde
préparation a utilisé une sauvegarde SQLite transactionnellement cohérente en ligne
(VACUUM INTO, puis quick_check) avant d'arrêter le service, afin de raccourcir la
coupure. La copie complète initiale est également conservée. Sauvegardes et clé
restent privées sur le Raspberry ; elles ne sont pas ajoutées à GitHub.

Pour un retour arrière ultérieurement décidé, arrêter le nouveau conteneur avant
de remettre en service le précédent ; ne jamais laisser les deux piloter le même
véhicule. Les migrations n'ont pas changé. Restaurer une base n'est pas nécessaire
pour le simple retour de code ; cela ferait perdre les données postérieures à la
sauvegarde. L'ancien code ne connaît pas le nouveau plafond solaire.

## GitHub et limites restantes

Branche publiée : `reprise/backend-security-sse-20261008`.
PR **Draft** : https://github.com/samlegs31/ChargeHA/pull/87 .
Le contrôle candidat est vert ; le contrôle de version figée reste en échec attendu.
`current/manifest.json`, main et la release de restauration du 8 octobre restent
inchangés. Ce document et le manifeste candidat décrivent la nouvelle livraison.

Le plafond est modifiable côté serveur par pas de 1 A. **Le champ dédié dans
l'interface n'existe toujours pas** ; il nécessite les sources exactes du frontend.
La santé du service et les empreintes ne prouvent pas l'effet physique immédiat
d'une consigne Tesla ni l'absence d'appoint réseau.
