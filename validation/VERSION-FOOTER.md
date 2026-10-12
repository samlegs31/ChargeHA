# Version dans le pied de page

Ajout discret dans le pied de page existant : `E.V. Solar · v2026.10.12 · …`. Le style, les liens de licence et l'interface restent inchangés. Le commit serveur est disponible dans le titre du texte.

La route publique GET /version renvoie uniquement la version et la révision fournies par l'image, avec Cache-Control: no-store. Aucun accès à la base, aucun secret ni appel Tesla. La date courante n'est jamais utilisée comme version. L'absence de métadonnées valides affiche `Version unavailable`.

Pour la prochaine image, définir EVSOLAR_VERSION au format année.mois.jour (suffixe .1, .2 possible pour plusieurs livraisons) et EVSOLAR_REVISION au commit réellement embarqué. Le retour à une ancienne image restaure sa propre identité ; les images antérieures à cette fonctionnalité n'ont pas de métadonnées. L'affichage est actualisé au chargement de la page, par une requête bornée à cinq secondes, sans polling. Le HTML change l'URL de chargement du bundle pour éviter de réutiliser sa version précédente en cache.

Le composant ajouté au bundle est conservé lisiblement dans validation/version-footer-component.js. Le fichier HTML et le bundle principal ont leurs empreintes explicitement approuvées ; current/manifest.json reste intact. Aucune ancienne source frontend n'a été réintroduite.

Validation : 229 tests serveur, 2 155 étapes, format/lint/types et treize tests d'intégrité. Aperçu navigateur mobile : version, commit au survol, absence de débordement horizontal, une seule requête, repli en cas d'erreur et absence d'erreur JavaScript. Cet aperçu teste le composant extrait, pas une recette authentifiée complète.

Déployé le 12 octobre 2026 après autorisation utilisateur. Commit applicatif : 8a1b267b5e2072748957bb1206303bf4dbdf22ab ; version affichée : 2026.10.12. Image : sha256:d02045508aeb31aa13c431d51506269605d0524393e5412f27f0318425d8435b.

Essais sur une copie de la base, sans réseau : démarrage nouvelle image, endpoint /version, HTML/assets, puis redémarrage de l’ancienne image et intégrité SQLite validés. Après bascule : /version exact, serveur/base OK, healthy, zéro redémarrage automatique, 481 empreintes et réglages protégés conformes. Aucun changement de régulation ou de dépendances.

Sauvegarde complète : /home/chargeha/evsolar-backups/backend-20261012-154422. Ancien conteneur arrêté : chargeha-rollback-20261012-154422. Retour au commit précédent 8617582 : exécuter sur Raspberry `python3 /home/chargeha/evsolar-release-8a1b267/rollback.py`. La procédure arrête le nouveau conteneur avant de redémarrer l’ancien et conserve les données courantes ; la compatibilité a été testée sur copie. La sauvegarde reste sur le Raspberry. La PR #87 reste Draft, sans merge.

## Retrait après incident

La livraison 8a1b267 a été annulée et la production restaurée à 8617582. Le paramètre d'URL du module principal présentait un risque de chargement en double. La disparition persistante des silhouettes a ensuite été attribuée à la perte des caractéristiques d'apparence au redémarrage ; voir TESLA-APPEARANCE-RECOVERY.md. L'affichage de version est retiré du candidat courant.
