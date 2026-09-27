import { pool } from "../config/db.js";

// Observations/suggestions deposees par le public en scannant le QR code d'un centre.
// La page est servie par le backend lui-meme : un simple appareil photo de telephone suffit,
// sans application ni compte. Le code de visite du centre (inclus dans le QR) sert de cle.

const KINDS = new Set(["OBSERVATION", "SUGGESTION"]);
const MESSAGE_MIN = 5;
const MESSAGE_MAX = 1500;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
const recentSubmissions = new Map();

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function isRateLimited(key) {
  const now = Date.now();
  const hits = (recentSubmissions.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    recentSubmissions.set(key, hits);
    return true;
  }
  hits.push(now);
  recentSubmissions.set(key, hits);
  if (recentSubmissions.size > 5000) {
    for (const [k, times] of recentSubmissions) {
      if (!times.some((t) => now - t < RATE_WINDOW_MS)) recentSubmissions.delete(k);
    }
  }
  return false;
}

async function findPublicCenter(centerId, code) {
  if (!Number.isInteger(centerId) || centerId <= 0 || !code) return null;
  const result = await pool.query(
    `SELECT id, name, address
     FROM health_centers
     WHERE id = $1 AND UPPER(checkin_code) = $2 AND is_active = TRUE AND approval_status = 'APPROVED'
     LIMIT 1`,
    [centerId, code]
  );
  return result.rows[0] || null;
}

export function buildFeedbackUrl(req, centerId, checkinCode) {
  const base = String(process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
  return `${base}/avis/${centerId}?c=${encodeURIComponent(checkinCode || "")}`;
}

function page(title, body) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { --primary:#1A56DB; --primary-dark:#1337A4; --text:#0F172A; --muted:#64748B; --border:#E2E8F0; --bg:#EEF4FB; --green:#059669; --red:#DC2626; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: linear-gradient(180deg,#CFE0FA,#D5F1EC); color: var(--text); min-height: 100vh; }
  .wrap { max-width: 520px; margin: 0 auto; padding: 20px 16px 40px; }
  .brand { text-align:center; color: var(--primary-dark); font-weight: 800; letter-spacing: .3px; margin: 6px 0 14px; }
  .card { background:#fff; border-radius: 18px; padding: 20px; box-shadow: 0 4px 18px rgba(15,23,42,.08); }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: var(--muted); font-size: 14px; margin: 0 0 18px; }
  label { display:block; font-weight: 700; font-size: 14px; margin: 14px 0 6px; }
  .kinds { display:flex; gap: 10px; }
  .kind { flex:1; border: 2px solid var(--border); border-radius: 14px; padding: 12px; text-align:center; cursor:pointer; font-weight:700; background:#fff; color: var(--text); font-size: 15px; }
  .kind small { display:block; font-weight: 500; color: var(--muted); font-size: 12px; margin-top: 3px; }
  .kind.active { border-color: var(--primary); background: #EBF1FF; color: var(--primary-dark); }
  textarea, input { width:100%; border:1px solid var(--border); border-radius: 12px; padding: 12px; font-size: 16px; font-family: inherit; color: var(--text); background:#fff; }
  textarea { min-height: 140px; resize: vertical; }
  .hint { color: var(--muted); font-size: 12px; margin-top: 4px; }
  .row { display:flex; gap: 10px; }
  .row > div { flex: 1; }
  button { width:100%; margin-top: 18px; border:0; border-radius: 12px; padding: 15px; font-size: 16px; font-weight: 700; color:#fff; background: var(--primary); cursor:pointer; }
  button[disabled] { opacity: .6; }
  .error { color: var(--red); font-weight: 600; margin-top: 12px; }
  .ok { text-align:center; }
  .ok .icon { font-size: 44px; }
  .privacy { text-align:center; color: var(--muted); font-size: 12px; margin-top: 16px; }
</style>
</head>
<body><div class="wrap"><div class="brand">Sante Aproximite</div>${body}</div></body>
</html>`;
}

export async function renderFeedbackPage(req, res, next) {
  try {
    const centerId = Number(req.params.centerId);
    const code = normalizeCode(req.query.c);
    const center = await findPublicCenter(centerId, code);
    res.set("Content-Type", "text/html; charset=utf-8");
    if (!center) {
      return res.status(404).send(page("QR code invalide", `
        <div class="card ok"><div class="icon">⚠️</div><h1>QR code invalide</h1>
        <p class="sub">Ce QR code n'est plus valide ou le centre n'est pas disponible. Demandez a l'accueil le QR code a jour.</p></div>`));
    }
    const action = `/api/public/centers/${center.id}/feedback`;
    return res.send(page(`Votre avis - ${center.name}`, `
      <div class="card" id="formCard">
        <h1>${escapeHtml(center.name)}</h1>
        <p class="sub">Partagez une observation ou une suggestion. Votre message est transmis uniquement a ce centre.</p>
        <form id="f" novalidate>
          <label>Type de message</label>
          <div class="kinds">
            <button type="button" class="kind active" data-kind="OBSERVATION">Observation<small>Ce que vous avez constate</small></button>
            <button type="button" class="kind" data-kind="SUGGESTION">Suggestion<small>Une idee d'amelioration</small></button>
          </div>
          <label for="message">Votre message</label>
          <textarea id="message" maxlength="${MESSAGE_MAX}" placeholder="Decrivez votre observation ou votre suggestion..." required></textarea>
          <div class="hint"><span id="count">0</span> / ${MESSAGE_MAX}</div>
          <div class="row">
            <div><label for="name">Nom <span class="hint">(facultatif)</span></label><input id="name" maxlength="120" autocomplete="name"></div>
            <div><label for="phone">Telephone <span class="hint">(facultatif)</span></label><input id="phone" inputmode="tel" maxlength="20" autocomplete="tel"></div>
          </div>
          <div class="error" id="err" hidden></div>
          <button type="submit" id="submit">Envoyer au centre</button>
        </form>
      </div>
      <div class="card ok" id="doneCard" hidden><div class="icon">✅</div><h1>Merci !</h1>
        <p class="sub">Votre message a bien ete transmis a ${escapeHtml(center.name)}.</p>
        <button type="button" id="again">Envoyer un autre message</button></div>
      <p class="privacy">Seul le centre de sante peut lire votre message.</p>
      <script>
        (function () {
          var kind = "OBSERVATION";
          var kinds = document.querySelectorAll(".kind");
          kinds.forEach(function (b) { b.addEventListener("click", function () {
            kind = b.getAttribute("data-kind");
            kinds.forEach(function (x) { x.classList.toggle("active", x === b); });
          }); });
          var msg = document.getElementById("message"), count = document.getElementById("count");
          msg.addEventListener("input", function () { count.textContent = msg.value.length; });
          var err = document.getElementById("err"), btn = document.getElementById("submit");
          document.getElementById("f").addEventListener("submit", function (e) {
            e.preventDefault();
            err.hidden = true;
            var text = msg.value.trim();
            if (text.length < ${MESSAGE_MIN}) { err.textContent = "Votre message est trop court."; err.hidden = false; return; }
            btn.disabled = true; btn.textContent = "Envoi...";
            fetch(${JSON.stringify(action)}, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code: ${JSON.stringify(code)}, kind: kind, message: text,
                authorName: document.getElementById("name").value, authorPhone: document.getElementById("phone").value })
            }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
              .then(function (res) {
                if (!res.ok) throw new Error(res.d && res.d.message || "Envoi impossible");
                document.getElementById("formCard").hidden = true;
                document.getElementById("doneCard").hidden = false;
              })
              .catch(function (e2) { err.textContent = e2.message || "Envoi impossible. Reessayez."; err.hidden = false; })
              .finally(function () { btn.disabled = false; btn.textContent = "Envoyer au centre"; });
          });
          document.getElementById("again").addEventListener("click", function () {
            msg.value = ""; count.textContent = "0";
            document.getElementById("doneCard").hidden = true;
            document.getElementById("formCard").hidden = false;
          });
        })();
      </script>`));
  } catch (error) { next(error); }
}

export async function submitPublicFeedback(req, res, next) {
  try {
    const centerId = Number(req.params.centerId);
    const code = normalizeCode(req.body?.code);
    const kind = String(req.body?.kind || "").trim().toUpperCase();
    const message = String(req.body?.message || "").trim();
    const authorName = String(req.body?.authorName || "").trim().slice(0, 120) || null;
    const authorPhone = String(req.body?.authorPhone || "").replace(/[^\d+]/g, "").slice(0, 20) || null;

    if (!KINDS.has(kind)) return res.status(400).json({ message: "Type de message invalide." });
    if (message.length < MESSAGE_MIN) return res.status(400).json({ message: "Votre message est trop court." });
    if (message.length > MESSAGE_MAX) return res.status(400).json({ message: "Votre message est trop long." });

    const center = await findPublicCenter(centerId, code);
    if (!center) return res.status(404).json({ message: "QR code invalide ou centre indisponible." });

    if (isRateLimited(`${req.ip}:${centerId}`)) {
      return res.status(429).json({ message: "Trop de messages envoyes. Reessayez dans quelques minutes." });
    }

    await pool.query(
      `INSERT INTO center_qr_feedback (center_id, kind, message, author_name, author_phone)
       VALUES ($1, $2, $3, $4, $5)`,
      [centerId, kind, message, authorName, authorPhone]
    );
    return res.status(201).json({ success: true });
  } catch (error) { next(error); }
}

// Seul le centre (son createur, ou un compte rattache par center_id / code etablissement) y a acces.
async function canManageCenter(userId, centerId) {
  const result = await pool.query(
    `SELECT 1
     FROM health_centers hc
     JOIN users u ON u.id = $2
     WHERE hc.id = $1
       AND (hc.created_by = u.id
         OR hc.id = u.center_id
         OR (u.establishment_code IS NOT NULL AND upper(hc.establishment_code) = upper(u.establishment_code)))
     LIMIT 1`,
    [centerId, userId]
  );
  return result.rowCount > 0;
}

function mapFeedbackRow(row) {
  return {
    _id: String(row.id),
    kind: row.kind,
    message: row.message,
    authorName: row.author_name || null,
    authorPhone: row.author_phone || null,
    isRead: row.is_read === true,
    readAt: row.read_at || null,
    createdAt: row.created_at,
  };
}

export async function listCenterQrFeedback(req, res, next) {
  try {
    const centerId = Number(req.params.id);
    if (!Number.isInteger(centerId) || centerId <= 0) return res.status(400).json({ message: "ID de centre invalide" });
    if (!(await canManageCenter(Number(req.user.id), centerId))) {
      return res.status(403).json({ message: "Acces reserve au centre concerne" });
    }
    const result = await pool.query(
      `SELECT id, kind, message, author_name, author_phone, is_read, read_at, created_at
       FROM center_qr_feedback
       WHERE center_id = $1
       ORDER BY created_at DESC
       LIMIT 500`,
      [centerId]
    );
    return res.json(result.rows.map(mapFeedbackRow));
  } catch (error) { next(error); }
}

export async function markQrFeedbackRead(req, res, next) {
  try {
    const centerId = Number(req.params.id);
    const feedbackId = Number(req.params.feedbackId);
    if (!Number.isInteger(centerId) || !Number.isInteger(feedbackId)) return res.status(400).json({ message: "Identifiant invalide" });
    if (!(await canManageCenter(Number(req.user.id), centerId))) {
      return res.status(403).json({ message: "Acces reserve au centre concerne" });
    }
    const result = await pool.query(
      `UPDATE center_qr_feedback SET is_read = TRUE, read_at = COALESCE(read_at, NOW())
       WHERE id = $1 AND center_id = $2
       RETURNING id, kind, message, author_name, author_phone, is_read, read_at, created_at`,
      [feedbackId, centerId]
    );
    if (!result.rowCount) return res.status(404).json({ message: "Message introuvable" });
    return res.json(mapFeedbackRow(result.rows[0]));
  } catch (error) { next(error); }
}
