import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({
      error: "Méthode non autorisée"
    });
  }

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL manquante");
    }

    const sql = neon(process.env.DATABASE_URL);

    // AFFICHER LES ENTREES
    if (req.method === "GET") {
      const entrees = await sql`
        SELECT
          e.*,
          p.nom AS produit_nom,
          p.reference AS produit_reference
        FROM entrees_stock e
        LEFT JOIN produits p
          ON p.id = e.produit_id
        ORDER BY e.id DESC
      `;

      return res.status(200).json(entrees);
    }

    // ENREGISTRER UNE ENTREE
    const {
      date_entree,
      produit_id,
      reference_document,
      depot,
      quantite,
      fournisseur,
      date_expiration,
      observations
    } = req.body || {};

    const produitId = Number(produit_id);
    const quantiteEntree = Number(quantite);

    if (!date_entree || !/^\d{4}-\d{2}-\d{2}$/.test(date_entree)) {
      return res.status(400).json({
        error: "La date d'entrée est obligatoire."
      });
    }

    if (!Number.isSafeInteger(produitId) || produitId <= 0) {
      return res.status(400).json({
        error: "Veuillez sélectionner un produit valide."
      });
    }

    if (
      !Number.isFinite(quantiteEntree) ||
      quantiteEntree <= 0
    ) {
      return res.status(400).json({
        error: "La quantité doit être supérieure à zéro."
      });
    }

    // INSERTION ET MISE A JOUR DU STOCK
    const resultat = await sql`
      WITH nouvelle_entree AS (
        INSERT INTO entrees_stock (
          date_entree,
          produit_id,
          reference_document,
          depot,
          quantite,
          fournisseur,
          date_expiration,
          observations
        )
        SELECT
          ${date_entree}::date,
          p.id,
          ${reference_document || null},
          ${depot || null},
          ${quantiteEntree},
          ${fournisseur || null},
          ${date_expiration || null}::date,
          ${observations || null}
        FROM produits p
        WHERE p.id = ${produitId}
        RETURNING *
      ),
      stock_mis_a_jour AS (
        UPDATE produits p
        SET quantite_stock =
          COALESCE(p.quantite_stock, 0) + n.quantite
        FROM nouvelle_entree n
        WHERE p.id = n.produit_id
        RETURNING p.id
      )
      SELECT
        n.*,
        p.nom AS produit_nom,
        p.reference AS produit_reference
      FROM nouvelle_entree n
      JOIN produits p ON p.id = n.produit_id
    `;

    if (!resultat.length) {
      return res.status(404).json({
        error: "Produit introuvable."
      });
    }

    return res.status(201).json({
      message: "Entrée enregistrée avec succès.",
      entree: resultat[0]
    });

  } catch (error) {
    console.error("Erreur API entrées :", error);

    return res.status(500).json({
      error: "Impossible d'enregistrer l'entrée."
    });
  }
}
