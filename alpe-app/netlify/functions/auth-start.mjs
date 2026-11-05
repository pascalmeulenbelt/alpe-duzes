// Stuurt je naar Strava om toestemming te geven.
import crypto from "node:crypto";

export default async (req) => {
  const origin = new URL(req.url).origin;
  if (!process.env.STRAVA_CLIENT_ID) {
    return new Response("STRAVA_CLIENT_ID ontbreekt. Zie README.", { status: 500 });
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
