// Stuurt je naar Strava om toestemming te geven.
import crypto from "node:crypto";

// Strava accepteert alleen terugkeer naar het domein dat in je Strava API-app staat
// (Authorization Callback Domain). Daarom loopt koppelen altijd via het hoofdadres van de site,
// ook als je de app opent via een deploy preview of een ander Netlify-adres.
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function canonicalOrigin(req) {
  const here = new URL(req.url).origin;
  if (LOCAL.test(here)) return here; // lokaal testen met netlify dev
  const fixed = process.env.STRAVA_REDIRECT_ORIGIN || process.env.URL;
  try {
    if (fixed) { const u = new URL(fixed); u.protocol = "https:"; return u.origin; }
  } catch {}
  return here;
}

export default async (req) => {
  const here = new URL(req.url).origin;
  const origin = canonicalOrigin(req);
  if (!process.env.STRAVA_CLIENT_ID || !process.env.STRAVA_CLIENT_SECRET || !process.env.SESSION_SECRET) {
    return new Response("Strava-instellingen ontbreken (STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET of SESSION_SECRET). Zie README.", { status: 500 });
  }
  if (here !== origin) {
    return new Response(null, { status: 302, headers: { Location: origin + "/api/auth/start" } });
  }
  const state = crypto.randomBytes(16).toString("hex");
  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id", process.env.STRAVA_CLIENT_ID);
  url.searchParams.set("redirect_uri", origin + "/api/auth/callback");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope", "read,profile:read_all,activity:read_all");
  url.searchParams.set("state", state);
  const h = new Headers({ Location: url.toString() });
  h.append("Set-Cookie", `alpe_st=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  return new Response(null, { status: 302, headers: h });
};

export const config = { path: "/api/auth/start" };
