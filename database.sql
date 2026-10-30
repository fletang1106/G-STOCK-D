-- À exécuter une seule fois dans Neon > SQL Editor.
-- Ajoute uniquement le champ nécessaire à l'authentification.
ALTER TABLE utilisateurs
ADD COLUMN IF NOT EXISTS password_hash text;

-- Vérification facultative :
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'utilisateurs'
ORDER BY ordinal_position;
