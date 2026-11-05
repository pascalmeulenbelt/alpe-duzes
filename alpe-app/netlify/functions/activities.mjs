// Je ritten sinds een datum, in een compact formaat.
import { stravaGet, json, errorResponse } from "../lib/session.mjs";

const RIDES = /Ride$/; // Ride, VirtualRide, GravelRide, MountainBikeRide, EBikeRide

export default async (req) => {
  const u = new URL(req.url);
  const after = Math.max(0, parseInt(u.searchParams.get("after") || "0", 10) || 0);
  try {
    let all = [], cookies = [];
    for (let page = 1; page <= 4; page++) {
      const r = await stravaGet(req, `/athlete/activities?after=${after}&per_page=100&page=${page}`);
      cookies = r.cookies.length ? r.cookies : cookies;
      all = all.concat(r.data);
      if (r.data.length < 100) break;
    }
    const out = all
      .filter((a) => RIDES.test(a.sport_type || a.type || ""))
      .map((a) => ({
        id: String(a.id),
        name: a.name,
        sport: a.sport_type || a.type,
        date: String(a.start_date_local || "").slice(0, 10),
        start: a.start_date_local,
        moving: a.moving_time,
        elapsed: a.elapsed_time,
        km: Math.round((a.distance || 0) / 100) / 10,
        avgW: a.average_watts || null,
        npW: a.weighted_average_watts || null,
        power: !!a.device_watts,
        avgHr: a.average_heartrate || null
      }));
    return json({ activities: out, fetched: new Date().toISOString() }, 200, cookies);
  } catch (e) {
    return errorResponse(e);
  }
};

export const config = { path: "/api/activities" };
