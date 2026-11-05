// Trainingen naar intervals.icu. intervals.icu zet geplande trainingen via de officiële
// Zwift-koppeling in je Zwift-account (Workouts → Custom → Intervals.icu).
// De API-sleutel staat als omgevingsvariabele op de server en komt nooit in de browser.
import { readSession, json } from "../lib/session.mjs";

const BASE = "https://intervals.icu/api/v1/athlete/0";
const PREFIX = "alpe-";
const MAX = 40;

function auth() {
  const key = process.env.INTERVALS_API_KEY;
  if (!key) return null;
  return "Basic " + Buffer.from("API_KEY:" + key).toString("base64");
}

async function icu(path, method, body, a) {
  const r = await fetch(BASE + path, {
    method,
    headers: { Authorization: a, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body)
  });
  const text = await r.text();
  if (!r.ok) {
    const msg = r.status === 401 || r.status === 403 ? "intervals.icu weigerde de API-sleutel." : "intervals.icu gaf een fout (" + r.status + ").";
    throw Object.assign(new Error(msg), { status: 502 });
  }
  try { return JSON.parse(text); } catch { return null; }
}

const idOk = (s) => typeof s === "string" && /^w\d{1,2}[a-z]{3}$/.test(s);
const dateOk = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async (req) => {
  const a = auth();
  if (req.method === "GET") return json({ configured: !!a });
  if (req.method !== "POST") return json({ error: "Methode niet toegestaan." }, 405);

  const sess = readSession(req);
  if (!sess || !sess.aid) return json({ error: "Koppel eerst Strava." }, 401);
  if (!a) return json({ error: "intervals.icu is nog niet ingesteld op de server." }, 503);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Ongeldige JSON." }, 400); }
  const put = Array.isArray(body && body.workouts) ? body.workouts : [];
  const del = Array.isArray(body && body.remove) ? body.remove.filter(idOk) : [];
  if (put.length + del.length > MAX) return json({ error: "Te veel trainingen tegelijk." }, 413);

  const events = [];
  for (const w of put) {
    if (!w || !idOk(w.id) || !dateOk(w.date) || typeof w.zwo !== "string" || w.zwo.length > 50000) {
      return json({ error: "Ongeldige training." }, 400);
    }
    events.push({
      category: "WORKOUT",
      type: "Ride",
      start_date_local: w.date + "T00:00:00",
      name: String(w.name || "Training").slice(0, 120),
      external_id: PREFIX + w.id,
      filename: w.id + ".zwo",
      file_contents: w.zwo
    });
  }

  try {
    const saved = events.length ? await icu("/events/bulk?upsert=true", "POST", events, a) : [];
    if (del.length) await icu("/events/bulk-delete", "PUT", del.map((id) => ({ external_id: PREFIX + id })), a);
    return json({ ok: true, sent: events.length, removed: del.length, count: Array.isArray(saved) ? saved.length : events.length });
  } catch (e) {
    return json({ error: e.message }, e.status || 500);
  }
};

export const config = { path: "/api/intervals" };
