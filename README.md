# E.V. Solar — version actuelle figée

Ce dépôt conserve la version réellement utilisée sur le Raspberry Pi et vérifiée le **8 octobre 2026**. Il constitue la référence de restauration d’E.V. Solar.

**Aucune mise à jour ChargeHA amont n’est intégrée. Aucun workflow ne construit, ne déploie ou ne remplace automatiquement cette version.**

## Version de référence

- Release : [evsolar-current-2026.10.08](https://github.com/samlegs31/ChargeHA/releases/tag/evsolar-current-2026.10.08)
- Plateforme : Raspberry Pi, `linux/arm64`.
- Image active capturée : `evsolar:maintenance-20261007`.
- Identité de l’image : `sha256:898e27be90a793b3311786435882c9dd44e6f1f33121d3db52c3429bf9a6943d`.
- Le design actuel, le bouton Automatic charging sous contrôle manuel, le pilotage par borne externe, les protections Tesla et les derniers correctifs sont conservés.

## Une seule interface courante

L’interface de référence est dans `packages/server/dist`, avec son entrée `index-CQx0j9kn.js`. Les anciennes sources de design, les bundles non utilisés, les anciennes prévisualisations et les scripts qui reconstruisaient une autre interface ont été retirés de la branche principale.

Les sources serveur/plugins et les fichiers utilisés par l’interface ont été capturés depuis le conteneur actif. Les fichiers conservés correspondent octet pour octet à cette capture. Les ajouts React lisibles figurent dans `ui-current`.

Les sources TypeScript complètes du frontend historique n’ont pas été retrouvées avec certitude : cette version préserve donc les bundles exacts, sans prétendre les reconstruire depuis un ancien design. L’historique Git reste disponible pour attribution et récupération, mais ne constitue pas une version à réinstaller.

## Vérification

```sh
python3 scripts/verify-current.py
```

`current/manifest.json` fixe les empreintes des fichiers actifs et de l’image. GitHub vérifie uniquement cette intégrité. Toute future modification de cette référence doit être explicite et examinée ; ne pas utiliser une image `latest`.

## Restauration

Télécharger `evsolar-current-arm64.tar.gz` depuis la release, puis lire [la procédure de restauration](current/RESTORE.md). L’archive contient l’image logicielle exacte, pas les données personnelles. Elle conserve aussi les fichiers inactifs présents dans l’image d’origine afin de rester une sauvegarde fidèle ; ces fichiers ne sont pas une interface alternative proposée par le dépôt courant.

Les données, les jetons Tesla et la clé de chiffrement ne sont pas publiés. Leur sauvegarde privée doit rester séparée. Le fichier Compose est un modèle de récupération et n’est jamais lancé par GitHub.

## Licence

E.V. Solar est un dérivé de [ChargeHA](https://github.com/startswithaj/ChargeHA), distribué sous AGPL-3.0. Voir [LICENSE](LICENSE) et [NOTICE.md](NOTICE.md).
