# GESTION DE STOCK DEKA — Neon + Vercel

## 1. Fichiers
- `index.html` : interface de l'application.
- `api/index.js` : API sécurisée qui communique avec Neon.
- `database.sql` : ajoute le champ `password_hash` à la table `utilisateurs`.
- `vercel.json` : routage API.

## 2. Préparer Neon
Dans Neon > SQL Editor, exécuter le contenu de `database.sql`.
Ne supprimez aucune table existante.

## 3. Publier sur GitHub
Téléversez tous les fichiers et le dossier `api` à la racine du dépôt. Gardez les noms exacts.

## 4. Variables Vercel
Dans Project > Settings > Environment Variables, ajouter :
- `DATABASE_URL` : chaîne de connexion Neon (secret).
- `SESSION_SECRET` : longue valeur aléatoire secrète.
- `ADMIN_EMAIL` : email du compte administrateur initial.
- `ADMIN_PASSWORD` : mot de passe initial (au moins 12 caractères conseillé).

Ne mettez jamais ces valeurs dans `index.html` ni dans GitHub. Après les avoir ajoutées, faites Redeploy.

## 5. Première connexion
À la première connexion, l'API crée le compte administrateur si l'email n'existe pas.
Utilisez `ADMIN_EMAIL` et `ADMIN_PASSWORD`.
Changez le mot de passe administrateur après la première connexion en créant un compte administrateur avec un nouveau mot de passe puis désactivez l'ancien compte via Neon si nécessaire.

## Notes importantes
- Les employés peuvent consulter les produits, clients, dépôts, entrées et sorties, et enregistrer des entrées/sorties.
- Seul l'administrateur peut créer des utilisateurs, faire des régularisations, modifier ou supprimer les données via les API.
- Inventaire, régularisation, historique, rapports et utilisateurs sont réservés à l'administrateur.
- Les mouvements d'entrée/sortie mettent à jour `produits.quantite_stock`; pour les sorties, seule `avance` diminue le stock.
- Les suppressions sont volontairement limitées aux fiches produits/clients/dépôts/utilisateurs afin de préserver l'historique des mouvements.
- Le schéma actuel ne contient pas de tables de rôles séparées ni de colonnes de modification des mouvements.
