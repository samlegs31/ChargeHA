# Settings : plafond solaire visible et limites clarifiées

Demande utilisateur : revoir Settings, ajouter le réglage et rendre sa portée claire.

Emplacement : **Settings → My cars → Solar current limit**. Chaque véhicule dispose
d'un champ « solar maximum », exprimé en ampères entiers, avec un pas de 1 A.
La valeur vient du serveur ; Friday n'est pas codé en dur à 22 A dans l'interface.
Enregistrer avec Save ; Cancel abandonne les changements. Un champ vide retire
uniquement ce plafond solaire. Les autres véhicules conservent leurs valeurs.

Deux blocs distincts évitent de confondre les limites :

- **Solar current limit** : Solar Only et Solar + Clock hors plage programmée ;
  plafond sans effet sur Charge Now, les plages programmées ou les commandes
  manuelles directes. Les limites plus basses et le surplus disponible s'appliquent.
- **Electrical limits — all modes** : limites générales par véhicule, puis
  **Whole-home grid import limit** pour la puissance soutirée par toute la maison.

L'interface indique aussi la plage 1–80 A, le comportement sous le minimum
matériel, la stabilisation des hausses, la différence entre ampérage et puissance
(monophasé/triphasé), et le maintien du pilotage par borne externe.

## Réalisation et preuve

Un seul asset installé est modifié : `Settings-C2gay-IT.js`. Son nom d'import,
les autres pages, les images et les composants React/Radix restent inchangés.
Le code ajouté est lisible dans `ui-current/settings/SolarCurrentSettings.js`.
Le script de patch vérifie l'empreinte de la référence exacte et les points
uniques de remplacement. Ce n'est pas une reconstruction des sources frontend
historiques manquantes.

La protection d'intégrité accepte uniquement la nouvelle empreinte autorisée de
ce fichier précis ; toute autre modification frontend reste rejetée. Le manifeste
historique `current/manifest.json` est inchangé. Les tests vérifient aussi que le
patch reproduit exactement le bundle livré et que l'original correspond au manifeste.

Validation : 202 tests backend / 2 149 sous-tests, 12 tests Python, format/lint/types
backend verts. Tests navigateur isolés : affichage de 22 A, flèches par pas de 1 A,
annulation, enregistrement/rechargement, décimales et dépassement refusés, erreur
API et nouvelle tentative, effacement, conservation des autres véhicules, erreur
de lecture/reprise. Rendu inspecté à 1280 px et 390 px, sans débordement horizontal.
Les widgets et le traitement de brouillon réels sont utilisés avec API fictive.
Aucune valeur de production n'est modifiée par ces tests.

## Publication

Correctif publié dans la PR Draft #87, commit `046abff`.
Le premier transfert préparatoire Raspberry a été refusé par l'examen automatique,
qui invoquait l'ancienne interdiction de production. Le transfert n'a pas eu lieu.
Une confirmation ciblée de déploiement a été demandée. Tant qu'elle n'est pas
reçue et l'installation vérifiée, l'interface Raspberry reste celle précédemment
installée ; le nouveau champ ne doit pas être présenté comme déjà en ligne.
