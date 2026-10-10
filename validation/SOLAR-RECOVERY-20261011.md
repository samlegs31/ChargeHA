# Reprise solaire après cycles marche/arrêt

Le mécanisme actuel déclenche une pause persistante lorsque plus de trois transitions marche/arrêt sont détectées dans une heure. Son déblocage nécessitait un acquittement manuel. C'est une explication possible du signalement Friday ; les journaux de production n'ont pas été consultés dans cette passe.

La candidate conserve le STOP réel et son échec explicite, puis vérifie automatiquement la reprise après cinq minutes (contrôle toutes les minutes). Conditions : état arrêté, relevé âgé de 90 secondes au maximum et postérieur au déclenchement. Un état absent, périmé, futur ou toujours en charge maintient la pause. Aucun réveil ni requête Tesla supplémentaire : lecture du cache uniquement.

À la reprise, le marqueur de détection exclut les anciens cycles et le STOP de sécurité. Le contrôleur reprend ses décisions normales : excédent suffisant, délai de démarrage, plafond solaire, limite batterie et autres protections restent applicables. Le bouton Automatic charging reste exclusivement manuel. Les notifications et le journal de décision expliquent la reprise automatique.

Les pauses anciennes avec une date ou une alerte manquante restent à acquitter manuellement. La pause demeure globale comme précédemment ; l'isoler par véhicule demanderait une évolution distincte. Il ne s'agit pas d'une promesse de charger sans excédent suffisant ou malgré un défaut matériel.

Tests ajoutés : temporisation non écoulée, télémétrie absente/périmée, STOP non confirmé, reprise avec bouton OFF et ON, absence de redéclenchement à partir des anciens cycles. Les tests de refus STOP et de protections de régulation sont conservés.

Travail dans la Draft #87 seulement. Aucun changement sur le Raspberry, aucun merge ni déploiement.
