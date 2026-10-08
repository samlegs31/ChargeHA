# Restaurer la version figée

Cette procédure est destinée à une restauration explicitement décidée. Aucun de ces scripts ne modifie automatiquement le Raspberry Pi.

1. Conserver une sauvegarde cohérente de l’installation cible. Préparer la base et sa clé de chiffrement correspondante, conservées séparément de GitHub.
2. Télécharger l’image `evsolar-current-arm64.tar.gz` de la release `evsolar-current-2026.10.08`. Vérifier la release et `current/manifest.json`.
3. Sur un hôte Docker Linux ARM64, lancer `scripts/load-current-image.sh /chemin/evsolar-current-arm64.tar.gz`. Le script vérifie SHA-256 avant de charger l’image ; il ne démarre aucun conteneur.
4. Pour remplacer une installation, arrêter son service avant de restaurer la base et sa clé. Ne pas mélanger une base restaurée avec des fichiers WAL/SHM d’une autre copie.
5. Reprendre les volumes, les adresses/ports et le réseau de l’installation à restaurer. `docker/compose.current.yml` est uniquement un modèle ; une installation avec plusieurs adresses liées doit conserver l’ensemble de ses liaisons.
6. Après démarrage explicitement décidé, vérifier `/health`, le design, le choix Automatic charging et les voitures déclarées en borne externe.

L’image est celle qui tournait lors de la capture, sans reconstruction. Aucun téléchargement d’une image `latest`, aucune mise à jour amont, aucun changement d’accès distant n’est nécessaire pour la charger.
