/* Seizoen, daglicht, weer en de extra trainingsdag.
   Puur rekenwerk, zonder DOM, zodat het ook in tests draait. */
(function (g) {
  "use strict";
  const P = g.AlpePlan, L = g.AlpeLogic;
  const DAY = P.DAY;
  const HOME = { name: "Nijverdal", lat: 52.366, lon: 6.468, tz: "Europe/Amsterdam" };
  const MARGIN = 15; // minuten na zonsopkomst en voor zonsondergang: schemer, maar nog geen lampen-rit

  // ---------- daglicht ----------
  // Zonsopkomst en -ondergang (standaard zonne-vergelijking, -0,833° voor refractie). Tijden in ms UTC.
  function sunTimes(dateMs, lat, lon) {
    const rad = Math.PI / 180;
    const J = dateMs / DAY + 2440587.5 + 0.5; // middag van die dag
    const n = Math.ceil(J - 2451545.0 + 0.0008);
    const Js = n - lon / 360;
    const M = (357.5291 + 0.98560028 * Js) % 360;
    const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
    const lam = (M + C + 180 + 102.9372) % 360;
    const Jt = 2451545.0 + Js + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lam * rad);
    const dec = Math.asin(Math.sin(lam * rad) * Math.sin(23.4397 * rad));
    const cosw = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec));
    const w = Math.acos(Math.max(-1, Math.min(1, cosw))) / rad;
    const toMs = function (j) { return (j - 2440587.5) * DAY; };
    return { rise: toMs(Jt - w / 360), set: toMs(Jt + w / 360) };
  }
  const fmtClock = (function () {
    let f = null;
    try { f = new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: HOME.tz }); } catch (e) {}
    return function (ms) {
      if (f) return f.format(new Date(ms));
      const d = new Date(ms + 3600000); return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
    };
  })();
  // Daglicht van een kalenderdag (dateMs = middernacht UTC van die datum).
  function daylight(dateMs) {
    const t = sunTimes(dateMs, HOME.lat, HOME.lon);
    const from = t.rise + MARGIN * 60000, to = t.set - MARGIN * 60000;
    return { rise: t.rise, set: t.set, from: from, to: to, usable: Math.max(0, Math.round((to - from) / 60000)),
      riseTxt: fmtClock(t.rise), setTxt: fmtClock(t.set), fromTxt: fmtClock(from), toTxt: fmtClock(to),
      latestStart: function (min) { return fmtClock(to - min * 60000); } };
  }

  // ---------- seizoen ----------
  // Winter: 1 december tot en met februari. Buiten lang rijden is dan onbetrouwbaar door kou, regen, gladheid en licht.
  function isWinter(dateMs) { const m = new Date(dateMs).getUTCMonth(); return m === 11 || m <= 1; }

  // ---------- weer (Open-Meteo, geen sleutel nodig) ----------
  const FORECAST_URL = "https://api.open-meteo.com/v1/forecast?latitude=" + HOME.lat + "&longitude=" + HOME.lon +
    "&daily=weather_code,temperature_2m_min,temperature_2m_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max" +
    "&timezone=" + encodeURIComponent(HOME.tz) + "&forecast_days=16";
  function parseForecast(j) {
    const d = j && j.daily, out = {};
    if (!d || !Array.isArray(d.time)) return out;
    d.time.forEach(function (day, i) {
      out[day] = { code: d.weather_code[i], tmin: d.temperature_2m_min[i], tmax: d.temperature_2m_max[i], rain: d.precipitation_sum[i],
        pop: d.precipitation_probability_max[i], wind: d.wind_speed_10m_max[i], gust: d.wind_gusts_10m_max[i] };
    });
    return out;
  }
  const ICY = [56, 57, 66, 67, 71, 73, 75, 77, 85, 86];
  // Oordeel voor een lange buitenrit: goed, matig (kan, met tips) of slecht (binnen).
  function weatherVerdict(f) {
    if (!f) return null;
    const r = f.rain || 0, pop = f.pop == null ? 0 : f.pop;
    if (ICY.indexOf(f.code) >= 0) return { level: "slecht", why: "sneeuw of ijzel" };
    if (f.tmin <= 0.5 && r > 0.2) return { level: "slecht", why: "kans op gladheid" };
    if (r >= 4 || (pop >= 70 && r >= 1.5)) return { level: "slecht", why: "regen" };
    if (f.gust >= 65 || f.wind >= 40) return { level: "slecht", why: "harde wind" };
    const tips = [];
    if (r >= 1 || pop >= 50) tips.push("buien: regenjack en spatborden");
    if (f.wind >= 28) tips.push("veel wind: eerst tegenwind, dan met de wind mee naar huis");
    if (f.tmax < 5) tips.push("koud: winterhandschoenen, overschoenen, warm drinken in de bidon");
    else if (f.tmin <= 1) tips.push("vroeg kans op gladde plekken: start pas na 10:00");
    return { level: tips.length ? "matig" : "goed", why: tips.join("; ") };
  }
  function weatherLine(f) {
    if (!f) return "";
    const n = function (x) { return String(Math.round(x * 10) / 10).replace(".", ","); };
    return Math.round(f.tmin) + "° tot " + Math.round(f.tmax) + "°, " + n(f.rain || 0) + " mm" + (f.pop != null ? " (" + f.pop + "%)" : "") +
      ", wind " + Math.round(f.wind) + " km/u" + (f.gust ? ", stoten " + Math.round(f.gust) : "");
  }

  // ---------- binnenversie ----------
  // Binnen trap je continu: geen stoplichten, afdalingen of wind in de rug. Een uur Zwift is ongeveer 1:15 tot 1:30 buiten.
  function indoorize(w, cap, day) {
    const total = P.minutes(w);
    if (total <= cap) return w;
    const a = L.adapt(w, cap, day);
    const steps = a.steps.map(function (s) {
      if (s[3] === "Zone 2" || s[3] === "Inrijden en zone 2") return [s[0], 68, 74, s[3], "Binnen: continu trappen, ventilator aan"];
      return s;
    });
    const out = Object.assign({}, a, { steps: steps });
    out.indoor = { from: total, to: P.minutes(out) };
    out.adapted = null;
    out.note = "Binnenversie: " + P.fmtH(out.indoor.to) + " op Zwift in plaats van " + P.fmtH(total) + " buiten. Binnen trap je continu, zonder freewheelen of stoplichten: een uur Zwift is ongeveer 1:15 tot 1:30 buiten. " +
      "Blokken blijven, zone 2 is korter en iets hoger. Ventilator vol aan, twee bidons met elektrolyten, en kies een groepsrit of route om de tijd te breken. " + (w.note || "");
    out.title = P.titleOf(out, day) + " · binnen";
    return out;
  }
  // Buiten, maar langer dan het daglicht: inkorten tot het licht.
  function fitDaylight(w, usable, day) {
    const total = P.minutes(w);
    const fit = Math.floor(usable / 15) * 15;
    if (total <= usable || fit < 45) return w;
    const a = L.adapt(w, fit, day);
    a.note = "Ingekort tot het daglicht (" + P.fmtH(fit) + "). " + a.note;
    return a;
  }

  // ---------- extra trainingsdag ----------
  const EXTRA_DAYS = {
    mon: { label: "maandag", offset: 0 }, tue: { label: "dinsdag", offset: 1 },
    thu: { label: "donderdag", offset: 3 }, sat: { label: "zaterdag", offset: 5 }
  };
  // Eerste week die mag: niet in herstel-, taper- of Alpe-week.
  function extraAllowed(wk) { return wk && !wk.rec && wk.n >= 1 && wk.n <= 28; }
  // Hoeveelste extra dag is dit (0 = eerste)? Voor de opbouw: eerste twee keer maximaal 60 minuten.
  function extraIndex(cfg, n) { let k = 0; for (let i = cfg.fromWeek; i < n; i++) if (extraAllowed(P.WEEKS[i])) k++; return k; }

  function extraSession(wk, cfg) {
    if (!cfg || !cfg.on || wk.n < cfg.fromWeek || !extraAllowed(wk) || !EXTRA_DAYS[cfg.day]) return null;
    const idx = extraIndex(cfg, wk.n);
    const max = idx < 2 ? Math.min(cfg.max, 60) : cfg.max;
    const climbPhase = wk.n >= 17;
    let w;
    if (cfg.day === "mon") {
      w = P.easy(Math.min(max, 60));
      w.note = "Extra dag na je lange zondag: alleen losrijden. Voelen je benen zwaar, sla hem dan over.";
    } else if (cfg.day === "tue") {
      w = P.z2(Math.min(max, 75), "Extra dag. Rustig zone 2: morgen is je harde dag, dus geen tempo en geen klimmetjes.");
    } else if (cfg.day === "thu") {
      w = max >= 60 ? P.drills(max, max >= 75 ? 5 : 4, 2) : P.z2(max);
      w.note = "Extra dag na je harde woensdag. Rustig zone 2 met hoge cadans: herstel en techniek tegelijk.";
    } else {
      if (climbPhase && max >= 75) {
        w = P.intervals(max, 1, Math.min(30, max - 40), 72, 76, 0, "Alpe-tempo", "80 tot 85 rpm", "duur",
          "Extra zaterdag in de klimfase: zaterdag en zondag samen vormen een blok. Zo leer je klimmen op vermoeide benen, net als klim 4, 5 en 6 op 3 juni. Rustig blijven: de zondag is belangrijker.");
      } else {
        w = P.z2(max, "Extra zaterdag: zone 2, niets meer. Doe hem buiten als het weer en licht het toelaten; anders op Zwift.");
      }
    }
    w.extra = true;
    const date = wk.mon + EXTRA_DAYS[cfg.day].offset * DAY;
    return { id: "w" + wk.n + "x", week: wk.n, day: cfg.day, date: date, w: w, title: P.titleOf(w, cfg.day) + " · extra", extra: true };
  }

  // ---------- advies ----------
  // ctx: { cur, cfg, indoorMax, freeRides: [{date, min}], avgHours }
  function sundayCap(n, indoorMax) {
    const s = P.WEEKS[n].sessions.find(function (x) { return x.day === "sun"; });
    return s ? Math.max(0, P.minutes(s.w) - indoorMax) : 0;
  }
  function recommendedStart(cur) {
    for (let n = Math.max(cur + 1, 1); n <= 28; n++) if (P.WEEKS[n - 1] && P.WEEKS[n - 1].rec && extraAllowed(P.WEEKS[n])) return n;
    for (let n = Math.max(cur + 1, 1); n <= 28; n++) if (extraAllowed(P.WEEKS[n])) return n;
    return 28;
  }
  function advice(ctx) {
    const out = [];
    const rec = recommendedStart(ctx.cur);
    const recWk = P.WEEKS[rec];
    const cfg = ctx.cfg;
    const dstr = function (t) { const d = new Date(t); return d.getUTCDate() + " " + P.MONTHS[d.getUTCMonth()]; };

    // wanneer
    let when = "Begin in week " + rec + " (vanaf " + dstr(recWk.mon) + "). Dat is het begin van een nieuw blok, direct na een herstelweek: je lichaam is dan fris en de extra belasting valt samen met de natuurlijke opbouw.";
    if (cfg.on && cfg.fromWeek < rec && cfg.fromWeek > ctx.cur) when += " Je hebt nu week " + cfg.fromWeek + " gekozen. Dat kan, maar dan stapel je de extra dag op een blok dat al loopt.";
    if (cfg.on && cfg.fromWeek <= ctx.cur) when = "De extra dag loopt al sinds week " + cfg.fromWeek + ". Herstelweken, de taperweek en de Alpe-week slaan hem automatisch over.";
    out.push({ title: "Wanneer beginnen", text: when, level: cfg.on && cfg.fromWeek < rec && cfg.fromWeek > ctx.cur ? "let" : "ok" });

    // winterverlies
    let lost = 0, cnt = 0;
    P.WEEKS.forEach(function (wk) { if (wk.rec || wk.n < ctx.cur || wk.n > 28) return; const s = wk.sessions.find(function (x) { return x.day === "sun"; }); if (s && isWinter(s.date)) { lost += sundayCap(wk.n, ctx.indoorMax); cnt++; } });
    if (cnt) {
      const avgLost = Math.round(lost / cnt);
      out.push({ title: "Waarom juist deze winter", level: "info",
        text: "Moet je zondag naar binnen, dan rijd je maximaal " + fmt(ctx.indoorMax) + ". Dat scheelt in december tot en met februari gemiddeld " + fmt(avgLost) + " per week ten opzichte van het plan. " +
          (avgLost > 0 ? "Een extra rit van " + fmt(Math.min(cfg.max || 60, ctx.indoorMax)) + " vangt daar ongeveer " + Math.min(100, Math.round(Math.min(cfg.max || 60, ctx.indoorMax) * 1.25 / Math.max(1, avgLost) * 100)) + "% van op, omdat een uur binnen zwaarder telt dan een uur buiten. Is het zaterdag droog, rijd hem dan buiten en langer." : "Met deze binnenlimiet verlies je weinig.") });
    }

    // welke dag
    const DAYTXT = {
      sat: ["Zaterdag is de beste keuze.", "In de winter heb je zo twee kansen per weekend op daglicht en droog weer. Vanaf maart vormen zaterdag en zondag samen een blok: klimmen op vermoeide benen, precies wat je op 3 juni nodig hebt.", "ok"],
      thu: ["Donderdag is een goede keuze.", "De dag na je harde woensdag rijd je rustig, met hoge cadans. Dat helpt herstel. Wel drie dagen achter elkaar (wo, do, vr): houd de donderdag echt rustig.", "ok"],
      tue: ["Dinsdag raad ik af.", "Het is de dag voor je enige harde training. Elke minuut te hard op dinsdag kost je kwaliteit op woensdag. Kies hem alleen als het niet anders kan, en dan kort en rustig.", "let"],
      mon: ["Maandag raad ik af.", "Na een lange zondag heb je herstel nodig. De app maakt er een korte herstelrit van; meer zit er niet in.", "let"]
    };
    const d = DAYTXT[cfg.day] || DAYTXT.sat;
    out.push({ title: "Welke dag", text: d[0] + " " + d[1], level: d[2] });

    // hoe lang en hoe zwaar
    out.push({ title: "Hoe lang en hoe zwaar", level: "ok",
      text: "Altijd zone 2: de extra dag is nooit een tweede harde dag. De eerste twee keer maximaal een uur, daarna tot " + fmt(cfg.max || 60) + ". Zo groeit je weekvolume met hooguit 10 tot 15% per stap. In herstelweken vervalt de extra dag." });

    // wat je nu al doet
    if (ctx.freeRides && ctx.freeRides.length) {
      const m = ctx.freeRides.reduce(function (a, r) { return a + r.min; }, 0);
      out.push({ title: "Wat je nu al doet", level: "info",
        text: "De afgelopen vier weken reed je " + ctx.freeRides.length + " keer op een dag zonder geplande training, samen " + fmt(Math.round(m)) + ". Die uren tellen nu nergens mee. Met een vaste extra dag worden ze onderdeel van het plan en houdt de app je zone 2 bewaakt." });
    }
    return out;
  }
  function fmt(m) { return P.fmtH(m) + " uur"; }

  g.AlpeSeason = { HOME, MARGIN, sunTimes, daylight, isWinter, FORECAST_URL, parseForecast, weatherVerdict, weatherLine,
    indoorize, fitDaylight, EXTRA_DAYS, extraAllowed, extraSession, recommendedStart, advice };
})(typeof window !== "undefined" ? window : globalThis);
