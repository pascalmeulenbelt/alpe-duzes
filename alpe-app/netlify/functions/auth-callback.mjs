// Strava stuurt je hier terug na toestemming.
import { exchangeCode, getCookie, sessionCookie } from "../lib/session.mjs";

function back() {
  const h = new Headers({ Location: "/#week" });
  h.append("Set-Cookie", "alpe_st=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  return h;
}

export default async (req) => {
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  const scope = u.searchParams.get("scope") || "";
  const expected = getCookie(req, "alpe_st");

  if (u.searchParams.get("error")) {
    return new Response(null, { status: 302, headers: back() });
  }
  if (!code || !state || state !== expected) {
    return new Response("Koppelen mislukt: ongeldige of verlopen aanvraag. Ga terug naar de app en probeer opnieuw.", { status: 400 });
  }
  if (!/activity:read_all/.test(scope)) {
    return new Response("Geef de app toegang tot je activiteiten (vinkje bij 'Bekijk gegevens over je activiteiten'), anders kan hij je ritten niet koppelen. Ga terug en probeer opnieuw.", { status: 400 });
  }
  try {
    const sess = await exchangeCode(code);
    const h = back();
    h.append("Set-Cookie", sessionCookie(sess));
    return new Response(null, { status: 302, headers: h });
  } catch (e) {
    return new Response("Koppelen mislukt: " + e.message, { status: 502 });
  }
};

export const config = { path: "/api/auth/callback" };
