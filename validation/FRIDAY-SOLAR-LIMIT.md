# Friday : plafond solaire de 22 A

Préparation locale uniquement, à la demande de l'utilisateur. Rien n'est appliqué
à la base de production et aucune commande n'est envoyée au véhicule.

## Comportement

Nouveau réglage par véhicule : `vehicleSolarCurrentLimits`, stocké dans la clé
`vehicle_solar_current_limits` sous forme d'un objet JSON identifiant → ampères.
La valeur par défaut est vide : aucun véhicule n'est limité implicitement.

Pour Friday, la valeur préparée est **22 A**. Elle s'applique au suivi solaire
(Solar Only et Solar + Clock hors plage de charge programmée). La charge forcée
et les plages programmées conservent leurs consignes et protections actuelles.
Les limites matérielles et électriques plus basses restent prioritaires.

Une charge solaire déjà au-dessus du plafond redescend au prochain cycle sans
attendre la stabilisation des hausses. L'allocation multi-véhicules prend aussi
le plafond en compte pour redistribuer le surplus. Les prévisions utilisent le
même réglage. Aucun bundle frontend n'est modifié et aucun nouveau champ visible
dans l'interface installée n'est revendiqué.

22 A à 230 V en monophasé correspondent à 5,06 kW. Ce plafond est une limite
par véhicule en ampères, pas une limite globale de puissance de l'onduleur.
Le suivi du surplus tient toujours compte de la consommation de la maison.

## Réglage préparé, non activé

Le fichier `friday-solar-limit.example.json` contient le champ de configuration
et la valeur 22. **FRIDAY_VEHICLE_ID est un emplacement à remplacer**, pas un
identifiant réel : aucun VIN de production n'a été déduit des fixtures de tests.
Avant toute activation ultérieure autorisée, relever l'identifiant exact de Friday
et ajouter cette entrée en conservant les autres entrées éventuelles du réglage.
Ne pas utiliser `vehicle_current_limits` pour cette demande : cette autre clé
plafonne également les modes de charge forcée et programmée.

Déployer le code seul n'active pas le plafond ; le réglage pour Friday devra être
renseigné explicitement. Aucune migration, modification réseau ou opération
Raspberry n'a été effectuée.

## Vérifications

Huit tests ajoutés : départ solaire à 22 A, réduction 23/32→22 A dans les deux
modes solaires, limites inférieures, maintien de 32 A en charge forcée ou programmée,
redistribution vers un autre véhicule, arrêt si le plafond est inférieur au minimum
matériel, et lecture réelle de la configuration avec commande à l'adaptateur factice.
La suite complète, l'intégrité et les contrôles backend sont consignés dans README.md.
