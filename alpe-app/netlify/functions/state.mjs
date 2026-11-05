// Je voortgang (afgevinkt, aanpassingen, koppelingen, FTP) bewaard per Strava-account,
// zodat telefoon en laptop hetzelfde laten zien.
import { getStore } from "@netlify/blobs";
import { readSession, json } from "../lib/session.mjs";

export default async (req) => {
  const sess = readSession(req);
  if (!sess || !sess.aid) return json({ error: "Niet gekoppeld met Strava." }, 401);
  const store = getStore({ name: "alpe-state", consistency: "strong" });
  const key = "athlete-" + sess.aid;

  if (req.method === "GET") {
    const data = await store.get(key, { type: "json" });
    return json({ state: data || null });
  }
  if (req.method === "PUT") {
    const text = await req.text();
    if (text.length > 200000) return json({ error: "Te veel data." }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: "Ongeldige JSON." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Ongeldige status." }, 400);
    body.savedAt = new Date().toISOString();
    await store.setJSON(key, body);
    return json({ ok: true, savedAt: body.savedAt });
  }
  return json({ error: "Methode niet toegestaan." }, 405);
};

export const config = { path: "/api/state" };
