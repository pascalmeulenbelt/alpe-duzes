// Wie is er gekoppeld? Geeft naam, FTP en gewicht uit je Strava-profiel.
import { readSession, stravaGet, json, errorResponse } from "../lib/session.mjs";

export default async (req) => {
  if (!readSession(req)) return json({ connected: false });
  try {
    const { data, cookies } = await stravaGet(req, "/athlete");
    return json({
      connected: true,
      id: data.id,
      firstname: data.firstname || "",
      ftp: typeof data.ftp === "number" ? data.ftp : null,
      weight: typeof data.weight === "number" ? data.weight : null
    }, 200, cookies);
  } catch (e) {
    if (e.status === 401) return json({ connected: false, error: e.message }, 200, e.cookies || []);
    return errorResponse(e);
  }
};

export const config = { path: "/api/me" };
