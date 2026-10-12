# Version dans le pied de page

Ajout discret dans le pied de page existant : `E.V. Solar · v2026.10.12 · …`. Le style, les liens de licence et l'interface restent inchangés. Le commit serveur est disponible dans le titre du texte.

La route publique GET /version renvoie uniquement la version et la révision fournies par l'image, avec Cache-Control: no-store. Aucun accès à la base, aucun secret ni appel Tesla. La date courante n'est jamais utilisée comme version. L'absence de métadonnées valides affiche `Version unavailable`.

Pour la prochaine image, définir EVSOLAR_VERSION au format année.mois.jour (suffixe .1, .2 possible pour plusieurs livraisons) et EVSOLAR_REVISION au commit réellement embarqué. Le retour à une ancienne image restaure sa propre identité ; les images antérieures à cette fonctionnalité n'ont pas de métadonnées. L'affichage est actualisé au chargement de la page, par une requête bornée à cinq secondes, sans polling. Le HTML change l'URL de chargement du bundle pour éviter de réutiliser sa version précédente en cache.

Le composant ajouté au bundle est conservé lisiblement dans validation/version-footer-component.js. Le fichier HTML et le bundle principal ont leurs empreintes explicitement approuvées ; current/manifest.json reste intact. Aucune ancienne source frontend n'a été réintroduite.

Validation : 229 tests serveur, 2 155 étapes, format/lint/types et treize tests d'intégrité. Aperçu navigateur mobile : version, commit au survol, absence de débordement horizontal, une seule requête, repli en cas d'erreur et absence d'erreur JavaScript. Cet aperçu teste le composant extrait, pas une recette authentifiée complète.

Changement préparé dans le Draft #87, non déployé. Le Raspberry reste sur le commit applicatif 8617582.
