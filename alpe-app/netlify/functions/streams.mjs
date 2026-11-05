// Vermogensverdeling van één rit: seconden per 10 W, zonder freewheelen.
// De app rekent daar zelf de zones uit met je actuele FTP.
import { stravaGet, json, errorResponse } from "../lib/session.mjs";

export default async (req) => {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^\d+$/.test(id)) return json({ error: "Ongeldig activiteit-id." }, 400);
  try {
    const { data, cookies } = await stravaGet(req, `/activities/${id}/streams?keys=watts,time&key_by_type=true`);
    const w = data.watts && data.watts.data;
    const t = data.time && data.time.data;
    if (!Array.isArray(w) || !w.length) return json({ id, watts: false }, 200, cookies);
    const buckets = {};
    let pedaling = 0, coasting = 0;
    for (let i = 0; i < w.length; i++) {
      let dt = t && i > 0 ? t[i] - t[i - 1] : 1;
      if (!(dt > 0) || dt > 5) dt = 1; // pauzes niet meetellen
      const p = w[i] || 0;
      if (p < 10) { coasting += dt; continue; }
      const b = Math.floor(p / 10);
      buckets[b] = (buckets[b] || 0) + dt;
      pedaling += dt;
    }
    return json({ id, watts: true, size: 10, buckets, pedaling, coasting }, 200, cookies);
  } catch (e) {
    return errorResponse(e);
  }
};

export const config = { path: "/api/streams" };
