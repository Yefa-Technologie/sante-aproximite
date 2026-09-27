import bcrypt from "bcryptjs";
import { pool } from "../config/db.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function profile(row) {
  return { fullName: row.full_name, email: row.email, phoneNumber: row.phone_number };
}

function isSyntheticEmail(email) {
  return /@sante\.local$/i.test(String(email || ""));
}

export async function getProfile(req, res, next) {
  try {
    const result = await pool.query("SELECT full_name, email, phone_number FROM users WHERE id = $1", [req.user.id]);
    if (!result.rowCount) return res.status(404).json({ message: "Compte introuvable" });
    const row = result.rows[0];
    return res.json({ ...profile(row), email: isSyntheticEmail(row.email) ? "" : row.email });
  } catch (error) { next(error); }
}

export async function updateProfile(req, res, next) {
  const body = req.body || {};
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  if (fullName.length < 2 || fullName.length > 120) {
    return res.status(400).json({ message: "Le nom doit contenir entre 2 et 120 caracteres." });
  }

  const hasEmail = typeof body.email === "string";
  const email = hasEmail ? body.email.trim().toLowerCase() : "";
  if (hasEmail && email && !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ message: "Adresse e-mail invalide." });
  }

  const hasPhone = typeof body.phoneNumber === "string";
  const phoneNumber = hasPhone ? body.phoneNumber.replace(/\D/g, "").slice(0, 10) : "";
  if (hasPhone && phoneNumber && phoneNumber.length !== 10) {
    return res.status(400).json({ message: "Numero de telephone invalide (10 chiffres requis)." });
  }

  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  if (newPassword && newPassword.length < 6) {
    return res.status(400).json({ message: "Le nouveau mot de passe doit contenir au moins 6 caracteres." });
  }

  try {
    const found = await pool.query(
      "SELECT id, full_name, email, phone_number, password_hash, role FROM users WHERE id = $1",
      [req.user.id]
    );
    if (!found.rowCount) return res.status(404).json({ message: "Compte introuvable" });
    const current = found.rows[0];

    // L'e-mail et le mot de passe servent a la connexion : les changer exige le mot de passe actuel,
    // sauf pour les comptes utilisateurs simples qui se connectent par numero (e-mail synthetique).
    const emailChanged = hasEmail && email && email !== String(current.email || "").toLowerCase();
    const needsPasswordCheck = Boolean(newPassword) || (emailChanged && !isSyntheticEmail(current.email));
    if (needsPasswordCheck) {
      if (!currentPassword) {
        return res.status(400).json({ message: "Saisissez votre mot de passe actuel pour modifier l'e-mail ou le mot de passe." });
      }
      const valid = await bcrypt.compare(currentPassword, current.password_hash);
      if (!valid) return res.status(400).json({ message: "Mot de passe actuel incorrect." });
    }

    if (emailChanged) {
      const taken = await pool.query("SELECT 1 FROM users WHERE lower(email) = $1 AND id <> $2 LIMIT 1", [email, req.user.id]);
      if (taken.rowCount) return res.status(409).json({ message: "Cette adresse e-mail est deja utilisee." });
    }

    const phoneChanged = hasPhone && phoneNumber !== String(current.phone_number || "").replace(/\D/g, "");
    if (phoneChanged && phoneNumber) {
      const taken = await pool.query(
        "SELECT 1 FROM users WHERE regexp_replace(COALESCE(phone_number, ''), '[^0-9]', '', 'g') = $1 AND id <> $2 LIMIT 1",
        [phoneNumber, req.user.id]
      );
      if (taken.rowCount) return res.status(409).json({ message: "Ce numero est deja associe a un autre compte." });
    }
    if (phoneChanged && !phoneNumber && current.role === "USER") {
      return res.status(400).json({ message: "Le numero de telephone est obligatoire pour ce compte." });
    }

    const nextEmail = emailChanged ? email : current.email;
    const nextPhone = phoneChanged ? (phoneNumber || null) : current.phone_number;
    const nextHash = newPassword ? await bcrypt.hash(newPassword, 10) : current.password_hash;

    const result = await pool.query(
      `UPDATE users
       SET full_name = $1, email = $2, phone_number = $3, password_hash = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING full_name, email, phone_number`,
      [fullName, nextEmail, nextPhone, nextHash, req.user.id]
    );
    const row = result.rows[0];
    return res.json({ ...profile(row), email: isSyntheticEmail(row.email) ? "" : row.email });
  } catch (error) { next(error); }
}
