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
    const sql = neon(process.env.DATABASE_URL);

    if (req.method === "GET") {
      const produits = await sql`
        SELECT *
        FROM produits
        ORDER BY id DESC
      `;

      return res.status(200).json(produits);
    }

    const {
      reference,
      nom,
      categorie,
      depot,
      quantite_stock,
      stock_minimum,
      unite
    } = req.body || {};

    if (!nom || !String(nom).trim()) {
      return res.status(400).json({
        error: "Le nom du produit est obligatoire."
      });
    }

    const quantite = Number(quantite_stock ?? 0);
    const minimum = Number(stock_minimum ?? 0);

    if (
      !Number.isFinite(quantite) ||
      !Number.isFinite(minimum) ||
      quantite < 0 ||
      minimum < 0
    ) {
      return res.status(400).json({
        error: "Les quantités doivent être positives."
      });
    }

    const resultat = await sql`
      INSERT INTO produits (
        reference, nom, categorie, depot,
        quantite_stock, stock_minimum, unite
      )
      VALUES (
        ${reference || null},
        ${String(nom).trim()},
        ${categorie || null},
        ${depot || null},
        ${quantite},
        ${minimum},
        ${unite || null}
      )
      RETURNING *
    `;

    return res.status(201).json(resultat[0]);
  } catch (error) {
    console.error("Erreur API produits :", error.message);

    return res.status(500).json({
      error: "Impossible de traiter les produits."
    });
  }
}
