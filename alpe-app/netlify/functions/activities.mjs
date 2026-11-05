// Je ritten sinds een datum, in een compact formaat.
// Strava geeft zonder `after` de nieuwste ritten eerst. Zo valt een rit van gisteren nooit weg
// door het paginalimiet, ook niet als er veel historie is.
import { stravaGet, json, errorResponse } from "../lib/session.mjs";

const RIDES = /Ride$/; // Ride, VirtualRide, GravelRide, MountainBikeRide, EBikeRide
const PER_PAGE = 200; // maximum van Strava
const MAX_PAGES = 5;

export default async (req) => {
  const u = new URL(req.url);
  const after = Math.max(0, parseInt(u.searchParams.get("after") || "0", 10) || 0);
  try {
    let all = [], cookies = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await stravaGet(req, `/athlete/activities?per_page=${PER_PAGE}&page=${page}`);
      cookies = r.cookies.length ? r.cookies : cookies;
      const list = Array.isArray(r.data) ? r.data : [];
      all = all.concat(list);
      if (list.length < PER_PAGE) break;
      const oldest = list[list.length - 1];
      if (oldest && Date.parse(oldest.start_date) / 1000 < after) break;
    }
    const out = all
      .filter((a) => Date.parse(a.start_date) / 1000 >= after)
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
        elev: Math.round(a.total_elevation_gain || 0),
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
