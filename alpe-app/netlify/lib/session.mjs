// Sessie en Strava-toegang.
// De Strava-tokens staan versleuteld (AES-256-GCM) in een httpOnly-cookie in je eigen browser.
// Niemand anders kan ze lezen of aanpassen zonder SESSION_SECRET.
import crypto from "node:crypto";

const COOKIE = "alpe_s";
const MAX_AGE = 60 * 60 * 24 * 180; // 180 dagen

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) throw new Error("SESSION_SECRET ontbreekt of is te kort (minimaal 16 tekens).");
  return crypto.createHash("sha256").update(secret).digest();
}

export function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64url");
}

export function unseal(token) {
  try {
    const buf = Buffer.from(token, "base64url");
    const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), enc = buf.subarray(28);
    const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString("utf8"));
  } catch {
    return null;
  }
}

export function getCookie(req, name) {
  const raw = req.headers.get("cookie") || "";
  const m = raw.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}

export function readSession(req) {
  const t = getCookie(req, COOKIE);
  return t ? unseal(t) : null;
}

export function sessionCookie(sess) {
  return `${COOKIE}=${seal(sess)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function json(body, status = 200, cookies = []) {
  const h = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  cookies.forEach((c) => h.append("Set-Cookie", c));
  return new Response(JSON.stringify(body), { status, headers: h });
}

async function tokenRequest(params) {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      ...params
    })
  });
  if (!res.ok) throw Object.assign(new Error("Strava weigerde het token (" + res.status + ")."), { status: res.status });
  return res.json();
}

export async function exchangeCode(code) {
  const t = await tokenRequest({ code, grant_type: "authorization_code" });
  return { aid: t.athlete && t.athlete.id, rt: t.refresh_token, at: t.access_token, exp: t.expires_at, name: t.athlete && t.athlete.firstname };
}

// Geeft een geldig access token terug; ververst het als het binnen 2 minuten verloopt.
async function ensureAccess(sess) {
  const now = Math.floor(Date.now() / 1000);
  if (sess.at && sess.exp && sess.exp - 120 > now) return { sess, changed: false };
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: sess.rt });
  return { sess: { ...sess, at: t.access_token, rt: t.refresh_token || sess.rt, exp: t.expires_at }, changed: true };
}

// Roept de Strava API aan namens de ingelogde gebruiker.
// Geeft { data, cookies } terug; cookies bevat een vernieuwde sessie als het token is ververst.
export async function stravaGet(req, path) {
  const s0 = readSession(req);
  if (!s0 || !s0.rt) throw Object.assign(new Error("Niet gekoppeld met Strava."), { status: 401 });
  const { sess, changed } = await ensureAccess(s0);
  const res = await fetch("https://www.strava.com/api/v3" + path, { headers: { Authorization: "Bearer " + sess.at } });
  const cookies = changed ? [sessionCookie(sess)] : [];
  if (res.status === 401) throw Object.assign(new Error("Strava-toegang verlopen. Koppel Strava opnieuw."), { status: 401, cookies: [clearSessionCookie()] });
  if (res.status === 429) throw Object.assign(new Error("Strava-limiet bereikt. Probeer het over een kwartier opnieuw."), { status: 429, cookies });
  if (!res.ok) throw Object.assign(new Error("Strava gaf een fout (" + res.status + ")."), { status: 502, cookies });
  return { data: await res.json(), cookies, sess };
}

export function errorResponse(e) {
  return json({ error: e.message || "Onbekende fout" }, e.status || 500, e.cookies || []);
}
