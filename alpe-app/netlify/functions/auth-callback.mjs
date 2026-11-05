// Strava stuurt je hier terug na toestemming.
import { exchangeCode, getCookie, sessionCookie } from "../lib/session.mjs";

// Terug naar de app, met de uitkomst in de URL zodat de app een melding kan tonen.
function back(result, reason) {
  const q = new URLSearchParams({ strava: result });
  if (reason) q.set("reason", reason);
  const h = new Headers({ Location: "/?" + q + "#week" });
  h.append("Set-Cookie", "alpe_st=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  return new Response(null, { status: 302, headers: h });
}

export default async (req) => {
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  const scope = u.searchParams.get("scope") || "";
  const expected = getCookie(req, "alpe_st");

  if (u.searchParams.get("error")) {
    console.warn("Strava-koppeling geweigerd:", u.searchParams.get("error"));
    return back("denied");
  }
  if (!code || !state || state !== expected) {
    console.warn("Strava-koppeling: state ontbreekt of klopt niet", { hasCode: !!code, hasState: !!state, hasCookie: !!expected });
    return back("error", "state");
  }
  if (!/activity:read_all/.test(scope)) {
    console.warn("Strava-koppeling: te weinig rechten, scope =", scope);
    return back("error", "scope");
  }
  try {
    const sess = await exchangeCode(code);
    const res = back("ok");
    res.headers.append("Set-Cookie", sessionCookie(sess));
    return res;
  } catch (e) {
    console.error("Strava-koppeling: token ophalen mislukt:", e.message);
    return back("error", "token");
  }
};

export const config = { path: "/api/auth/callback" };
