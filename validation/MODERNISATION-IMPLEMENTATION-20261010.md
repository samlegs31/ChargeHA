# Modernisation — premier lot intégré au Draft

## Changements réalisés

- Settings : recherche par catégorie et mots-clés français/anglais ; montage des
  sections au premier usage ; conservation des catégories déjà visitées et des
  brouillons pendant le passage d’une catégorie à une autre. Design et widgets
  installés conservés. Pas de sauvegarde automatique.
- My cars : section « Why is charging limited? » en lecture seule. Elle distingue
  consigne et courant mesuré, affiche l’âge des données énergie/voiture et de la
  décision, le plafond solaire configuré, le pilotage externe et le motif du moteur.
  Un courant réellement mesuré absent reste « Unknown », jamais remplacé par la consigne.
- Diagnostic `health.regulation` soumis à l’authentification HTTP existante, y compris
  dans un batch mixte. Lecture du cache uniquement, aucun réveil/rafraîchissement Tesla.
  Aucune coordonnée, aucun secret ou détail brut d’erreur de commande dans la réponse.
- Mesures locales : durée p95 des 128 derniers cycles et séquences de commande ;
  compteurs de succès/échec depuis le démarrage. Aucun export externe ni dépendance
  ajoutée. Une séquence peut contenir plusieurs commandes physiques.
- SSE : maximum de 256 événements en attente par connexion. Dépassement => file
  libérée et erreur explicite au consommateur, sans exception dans le producteur.
  Le client tRPC installé classe les erreurs internes parmi les erreurs reconnectables
  (vérifié dans son bundle). Test de reconnexion au niveau route, pas un essai TCP de
  contre-pression avec le véhicule réel. Aucune fusion silencieuse des événements.
- Listeners SSE installés avant le snapshot, évitant le trou pendant son envoi ;
  libérés immédiatement à l’annulation même si le générateur est suspendu sur le
  snapshot initial. Fin/erreur libèrent également les abonnements.

## Validation

- 206 tests serveur/shared/plugins, 2 152 étapes : succès.
- 12 tests d’intégrité ; 468 fichiers candidat, 413 fichiers installés préservés,
  55 écarts explicites. Un seul asset frontend modifié ; manifeste original intact.
- Format (348 fichiers), lint (346 fichiers), type-check et syntaxe du bundle : succès.
- Audit Deno : aucune vulnérabilité connue signalée lors de cette passe.
- Navigateur local : réglage par 1 A, sauvegarde/annulation/erreurs, persistance,
  champs non montés avant ouverture, clavier, brouillons entre catégories,
  recherche « 22 A », diagnostic chargé au premier usage, distinction mesure inconnue
  / consigne connue, absence de débordement mobile. API et contenu des cartes avancées
  simulés ; ce n’est pas un test authentifié complet de l’installation.

## Limites et lots qui restent ouverts

- Le plafond affiché est le plafond configuré, pas un calcul complet de la limite
  effective instantanée. Le motif vient du moteur existant ; il ne suffit pas à
  attribuer précisément chaque watt d’import réseau au véhicule.
- Les âges affichés sont ceux de l’échantillon consulté : bouton Refresh, pas de
  polling automatique. Après première ouverture, les sections/catégories restent
  montées pour préserver leurs brouillons. Quitter Settings ou recharger la page ne
  sauvegarde pas ces brouillons. Pas encore d’indicateur global de brouillons.
- Recherche vers les catégories, sans lien profond au champ ou traduction complète.
- Le diagnostic ne mesure pas encore la longueur de la file de commandes ni le délai
  jusqu’à confirmation physique. Ses mesures servent de référence avant optimisation.
- OpenTelemetry exporté, migration React Activity/Compiler : non activés. React
  nécessite les sources frontend complètes et un build certifié ; exporter la
  télémétrie nécessite une destination et un budget de rétention définis.
- SQLite : WAL/index déjà présents. Aucun nouveau PRAGMA, index ou changement de
  durabilité sans profil de requêtes sur un jeu représentatif.
- Fleet Telemetry : aucun changement du polling, des réveils, de la configuration
  distante ou du réseau. La présence d’un conteneur de télémétrie ne prouve pas à elle
  seule son alimentation du cache de régulation. Cette chaîne reste à qualifier.
- Pas de benchmark ARM64 CPU/RAM ni de gain chiffré revendiqué. Pas de reconstruction
  de l’image Raspberry. Ce lot n’a pas été déployé ; aucun changement de production.

Les migrations conditionnelles restent à traiter séparément. Cette validation ne
les présente pas comme accomplies. PR conservée en Draft ; aucun merge.
