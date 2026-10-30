import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);
const sql = neon(process.env.DATABASE_URL || "");
const COOKIE = "deka_session";
const DAY = 60 * 60 * 24;

function send(res, status, data) {
  res.status(status).json(data);
}
function cookieOptions(maxAge) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
function tokenFor(user) {
  const payload = Buffer.from(JSON.stringify({
    id: user.id, email: user.email, role: user.role, nom: user.nom,
    exp: Math.floor(Date.now() / 1000) + DAY
  })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.SESSION_SECRET || "development-only-change-me").update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function readUser(req) {
  const raw = req.headers.cookie || "";
  const match = raw.match(new RegExp(`${COOKIE}=([^;]+)`));
  if (!match) return null;
  const [payload, signature] = match[1].split(".");
  if (!payload || !signature) return null;
  const expected = crypto.createHmac("sha256", process.env.SESSION_SECRET || "development-only-change-me").update(payload).digest();
  let supplied;
  try { supplied = Buffer.from(signature, "base64url"); } catch { return null; }
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  try {
    const user = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (user.exp < Math.floor(Date.now() / 1000)) return null;
    return user;
  } catch { return null; }
}
function isAdmin(user) {
  return user && ["admin", "administrateur"].includes(String(user.role || "").toLowerCase());
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString("hex")}`;
}
async function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hex] = stored.split(":");
  const key = await scrypt(password, salt, 64);
  const old = Buffer.from(hex, "hex");
  return old.length === key.length && crypto.timingSafeEqual(old, key);
}
async function bootstrapAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  const found = await sql`SELECT id FROM utilisateurs WHERE lower(email)=lower(${email}) LIMIT 1`;
  if (!found.length) {
    const hash = await hashPassword(password);
    await sql`INSERT INTO utilisateurs (nom,email,role,actif,password_hash)
              VALUES ('Administrateur',${email},'administrateur',true,${hash})`;
  }
}
const tables = {
  produits: "produits", clients: "clients", depots: "depots",
  entrees: "entrees_stock", sorties: "sorties_stock",
  ajustements: "ajustements_stock", utilisateurs: "utilisateurs"
};
const employeeReadable = new Set(["produits", "clients", "depots", "entrees", "sorties"]);
const adminOnly = new Set(["ajustements", "utilisateurs"]);

async function list(resource) {
  const table = tables[resource];
  if (!table) throw new Error("Module inconnu.");
  if (resource === "utilisateurs") return await sql`SELECT id,nom,email,role,actif,created_at FROM utilisateurs ORDER BY id DESC`;
  if (resource === "produits") return await sql`SELECT * FROM produits ORDER BY nom`;
  if (resource === "clients") return await sql`SELECT * FROM clients ORDER BY nom`;
  if (resource === "depots") return await sql`SELECT * FROM depots ORDER BY nom`;
  if (resource === "entrees") return await sql`SELECT * FROM entrees_stock ORDER BY date_entree DESC,id DESC`;
  if (resource === "sorties") return await sql`SELECT * FROM sorties_stock ORDER BY date_sortie DESC,id DESC`;
  if (resource === "ajustements") return await sql`SELECT * FROM ajustements_stock ORDER BY created_at DESC,id DESC`;
}
async function create(resource, b) {
  if (resource === "produits") return await sql`
    INSERT INTO produits(reference,nom,categorie,depot,quantite_stock,stock_minimum,unite)
    VALUES(${b.reference||null},${b.nom},${b.categorie||null},${b.depot||null},${Number(b.quantite_stock||0)},${Number(b.stock_minimum||0)},${b.unite||"unité"}) RETURNING *`;
  if (resource === "clients") return await sql`
    INSERT INTO clients(nom,telephone,adresse) VALUES(${b.nom},${b.telephone||null},${b.adresse||null}) RETURNING *`;
  if (resource === "depots") return await sql`
    INSERT INTO depots(nom,adresse,responsable) VALUES(${b.nom},${b.adresse||null},${b.responsable||null}) RETURNING *`;
  if (resource === "entrees") {
    const qty = Number(b.quantite);
    if (!(qty > 0)) throw new Error("La quantité reçue doit être supérieure à zéro.");
    const rows = await sql`INSERT INTO entrees_stock(date_entree,produit_id,reference_document,depot,quantite,fournisseur,date_expiration,observations)
      VALUES(${b.date_entree},${Number(b.produit_id)},${b.reference_document||null},${b.depot||null},${qty},${b.fournisseur||null},${b.date_expiration||null},${b.observations||null}) RETURNING *`;
    await sql`UPDATE produits SET quantite_stock=COALESCE(quantite_stock,0)+${qty} WHERE id=${Number(b.produit_id)}`;
    return rows;
  }
  if (resource === "sorties") {
    const facture = Number(b.quantite);
    const avance = Number(b.avance);
    if (!(facture > 0) || avance < 0 || avance > facture) throw new Error("Vérifiez la quantité sur facture et l'avance.");
    const product = await sql`SELECT id,quantite_stock FROM produits WHERE id=${Number(b.produit_id)} LIMIT 1`;
    if (!product.length) throw new Error("Produit introuvable.");
    const stock = Number(product[0].quantite_stock || 0);
    if (avance > stock) throw new Error(`Stock insuffisant. Stock disponible : ${stock}.`);
    const balance = facture - avance;
    const rows = await sql`INSERT INTO sorties_stock(date_sortie,produit_id,numero_facture,quantite,client_destinataire,avance,observations,depot,chauffeur,plaque,numero_bon_livraison,telephone_chauffeur,balance)
      VALUES(${b.date_sortie},${Number(b.produit_id)},${b.numero_facture||null},${facture},${b.client_destinataire||null},${avance},${b.observations||null},${b.depot||null},${b.chauffeur||null},${b.plaque||null},${b.numero_bon_livraison||null},${b.telephone_chauffeur||null},${balance}) RETURNING *`;
    await sql`UPDATE produits SET quantite_stock=COALESCE(quantite_stock,0)-${avance} WHERE id=${Number(b.produit_id)}`;
    return rows;
  }
  if (resource === "ajustements") {
    const pid = Number(b.produit_id), after = Number(b.quantite_apres);
    const p = await sql`SELECT quantite_stock FROM produits WHERE id=${pid} LIMIT 1`;
    if (!p.length || after < 0) throw new Error("Produit introuvable ou quantité invalide.");
    const before = Number(p[0].quantite_stock || 0);
    const rows = await sql`INSERT INTO ajustements_stock(produit_id,quantite_avant,quantite_apres,motif,observations)
      VALUES(${pid},${before},${after},${b.motif||null},${b.observations||null}) RETURNING *`;
    await sql`UPDATE produits SET quantite_stock=${after} WHERE id=${pid}`;
    return rows;
  }
  if (resource === "utilisateurs") {
    if (!b.nom || !b.email || !b.password || b.password.length < 8) throw new Error("Nom, email et mot de passe (8 caractères minimum) requis.");
    const hash = await hashPassword(b.password);
    return await sql`INSERT INTO utilisateurs(nom,email,role,actif,password_hash)
      VALUES(${b.nom},${b.email},${b.role||"utilisateur"},true,${hash})
      RETURNING id,nom,email,role,actif,created_at`;
  }
  throw new Error("Création non disponible pour ce module.");
}
async function update(resource, id, b) {
  if (resource === "produits") return await sql`UPDATE produits SET reference=${b.reference||null},nom=${b.nom},categorie=${b.categorie||null},depot=${b.depot||null},stock_minimum=${Number(b.stock_minimum||0)},unite=${b.unite||"unité"} WHERE id=${id} RETURNING *`;
  if (resource === "clients") return await sql`UPDATE clients SET nom=${b.nom},telephone=${b.telephone||null},adresse=${b.adresse||null} WHERE id=${id} RETURNING *`;
  if (resource === "depots") return await sql`UPDATE depots SET nom=${b.nom},adresse=${b.adresse||null},responsable=${b.responsable||null} WHERE id=${id} RETURNING *`;
  if (resource === "utilisateurs") {
    if (b.password) {
      const hash = await hashPassword(b.password);
      return await sql`UPDATE utilisateurs SET nom=${b.nom},email=${b.email},role=${b.role},actif=${Boolean(b.actif)},password_hash=${hash} WHERE id=${id} RETURNING id,nom,email,role,actif,created_at`;
    }
    return await sql`UPDATE utilisateurs SET nom=${b.nom},email=${b.email},role=${b.role},actif=${Boolean(b.actif)} WHERE id=${id} RETURNING id,nom,email,role,actif,created_at`;
  }
  throw new Error("Modification non disponible pour ce module.");
}
async function remove(resource, id) {
  const table = tables[resource];
  if (!["produits","clients","depots","utilisateurs"].includes(resource)) throw new Error("Suppression non disponible pour ce module afin de préserver l'historique.");
  if (resource === "utilisateurs") return await sql`DELETE FROM utilisateurs WHERE id=${id} RETURNING id`;
  if (resource === "produits") return await sql`DELETE FROM produits WHERE id=${id} RETURNING id`;
  if (resource === "clients") return await sql`DELETE FROM clients WHERE id=${id} RETURNING id`;
  return await sql`DELETE FROM depots WHERE id=${id} RETURNING id`;
}

export default async function handler(req, res) {
  try {
    if (!process.env.DATABASE_URL) return send(res,500,{error:"DATABASE_URL n'est pas configurée dans Vercel."});
    const path = (req.url || "").split("?")[0].replace(/\/+$/,"");
    const parts = path.split("/").filter(Boolean);
    const resource = parts[1];
    const id = parts[2] ? Number(parts[2]) : null;
    if (resource === "auth" && req.method === "POST") {
      await bootstrapAdmin();
      const { email, password } = req.body || {};
      const rows = await sql`SELECT * FROM utilisateurs WHERE lower(email)=lower(${email||""}) AND actif=true LIMIT 1`;
      if (!rows.length || !(await verifyPassword(password||"", rows[0].password_hash))) return send(res,401,{error:"Email ou mot de passe incorrect."});
      const u = rows[0];
      res.setHeader("Set-Cookie",`${COOKIE}=${tokenFor(u)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAY}${process.env.NODE_ENV==="production"?"; Secure":""}`);
      return send(res,200,{user:{id:u.id,nom:u.nom,email:u.email,role:u.role}});
    }
    if (resource === "logout" && req.method === "POST") {
      res.setHeader("Set-Cookie",cookieOptions(0));
      return send(res,200,{ok:true});
    }
    const user = readUser(req);
    if (resource === "me" && req.method === "GET") return user ? send(res,200,{user}) : send(res,401,{error:"Session expirée."});
    if (!user) return send(res,401,{error:"Veuillez vous connecter."});
    if (resource === "dashboard" && req.method === "GET") {
      if (!isAdmin(user)) return send(res,403,{error:"Accès interdit."});
      const [products, entries, exits, clients] = await Promise.all([
        sql`SELECT COUNT(*)::int AS total FROM produits`,
        sql`SELECT COUNT(*)::int AS total FROM entrees_stock`,
        sql`SELECT COUNT(*)::int AS total FROM sorties_stock`,
        sql`SELECT COUNT(*)::int AS total FROM clients`
      ]);
      return send(res,200,{produits:products[0].total,entrees:entries[0].total,sorties:exits[0].total,clients:clients[0].total});
    }
    if (!tables[resource]) return send(res,404,{error:"Route inconnue."});
    if (adminOnly.has(resource) && !isAdmin(user)) return send(res,403,{error:"Accès réservé à l'administrateur."});
    if (req.method === "GET") {
      if (!isAdmin(user) && !employeeReadable.has(resource)) return send(res,403,{error:"Accès interdit."});
      return send(res,200,await list(resource));
    }
    if (req.method === "POST") {
      if (resource === "utilisateurs" || resource === "ajustements") {
        if (!isAdmin(user)) return send(res,403,{error:"Action réservée à l'administrateur."});
      }
      return send(res,201,await create(resource,req.body||{}));
    }
    if (req.method === "PUT") {
      if (!isAdmin(user)) return send(res,403,{error:"Seul l'administrateur peut modifier."});
      if (!id) return send(res,400,{error:"Identifiant manquant."});
      return send(res,200,await update(resource,id,req.body||{}));
    }
    if (req.method === "DELETE") {
      if (!isAdmin(user)) return send(res,403,{error:"Seul l'administrateur peut supprimer."});
      if (!id) return send(res,400,{error:"Identifiant manquant."});
      return send(res,200,await remove(resource,id));
    }
    return send(res,405,{error:"Méthode non autorisée."});
  } catch (e) {
    console.error(e);
    return send(res,500,{error:e.message || "Erreur serveur."});
  }
}
