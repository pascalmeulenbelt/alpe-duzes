// Ontkoppelt Strava in deze browser.
import { clearSessionCookie, json } from "../lib/session.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Gebruik POST." }, 405);
  return json({ ok: true }, 200, [clearSessionCookie()]);
};

export const config = { path: "/api/auth/logout" };
