/* Coachlogica: sessies aanpassen aan beschikbare tijd, en Strava-ritten matchen met het plan. */
(function (g) {
  "use strict";
  const P = g.AlpePlan;
  const DAY = P.DAY;
  const MATCH_THRESHOLD = 0.7;

  // ---------- aanpassen ----------
  const isWarm = (s) => /^(Opwarmen|Inrijden)$/.test(s[3]);
  const isCool = (s) => /^(Uitrijden|Rustig naar huis)$/.test(s[3]);
  const isFiller = (s) => /^(Zone 2|Inrijden en zone 2|Hoge zone 2)$/.test(s[3]);
  const isOptional = (s) => /^(Afsluiter)$/.test(s[3]) || /^Hoge cadans/.test(s[3]);
  const isWork = (s) => s[1] != null && s[1] >= 70 && !isFiller(s) && !isOptional(s) && !isWarm(s) && !isCool(s) && !/^(Herstel|Zone 2|Rustig)/.test(s[3]);
  const sum = (steps) => steps.reduce((a, s) => a + s[0], 0);

  function hz2Steps(total) {
    const warm = total >= 60 ? 10 : 5, cool = total >= 60 ? 5 : 3;
    return [[warm, 50, 65, "Inrijden", ""], [total - warm - cool, 70, 75, "Hoge zone 2", "Bovenkant zone 2, praten kan nog net"], [cool, 45, 55, "Uitrijden", ""]];
  }

  // Past een training aan op `avail` minuten. Geeft een nieuw trainingsobject terug.
  function adapt(w, avail, day) {
    const total = P.minutes(w);
    if (!avail || avail >= total || w.kind === "event") return w;
    avail = Math.max(20, Math.round(avail));
    let steps = w.steps.map((s) => s.slice());
    const notes = [];
    let over = () => sum(steps) - avail;

    // 1. optionele onderdelen eruit (afsluiter, cadansblokjes worden zone 2)
    if (over() > 0) {
      steps = steps.map((s) => (isOptional(s) ? [s[0], 65, 72, "Zone 2", s[3].startsWith("Hoge cadans") ? "Wel met hoge cadans, 95 tot 100 rpm" : ""] : s));
    }
    // 2. zone 2-vulling inkorten, van achter naar voor
    for (let i = steps.length - 1; i >= 0 && over() > 0; i--) {
      const s = steps[i];
      if (!isFiller(s)) continue;
      const between = i > 0 && i < steps.length - 1 && isWork(steps[i - 1]) && steps.slice(i + 1).some(isWork);
      const min = between ? 5 : (s[3] === "Inrijden en zone 2" ? 15 : 0);
      const cut = Math.min(s[0] - min, over());
      s[0] -= cut;
    }
    steps = steps.filter((s) => s[0] > 0);
    // 3. opwarmen en uitrijden korter
    steps.forEach((s) => {
      if (over() <= 0) return;
      if (isWarm(s) && s[0] > 10) s[0] -= Math.min(s[0] - 10, over());
      else if (isCool(s) && s[0] > 5) s[0] -= Math.min(s[0] - 5, over());
    });
    // 4. werkblokken schrappen, van achter naar voor; de laatste eventueel inkorten
    let dropped = 0;
    while (over() > 0) {
      const idx = steps.map((s, i) => (isWork(s) ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) break;
      if (idx.length === 1) {
        const s = steps[idx[0]];
        const room = s[0] - over();
        if (room >= 10) { s[0] = room; s[3] = s[3].replace(/ \d+\/\d+$/, ""); notes.push("Het blok is ingekort tot " + room + " minuten."); break; }
        steps.splice(idx[0], 1); dropped++;
        break;
      }
      const last = idx[idx.length - 1];
      // verwijder het blok plus het herstel ervoor
      const prev = steps[last - 1];
      const removeFrom = prev && !isWork(prev) && (prev[3] === "Herstel" || isFiller(prev)) ? last - 1 : last;
      steps.splice(removeFrom, last - removeFrom + 1);
      dropped++;
    }
    // nummering van blokken herstellen
    const work = steps.filter(isWork);
    const base = work.length ? work[0][3].replace(/ \d+\/\d+$/, "") : "";
    if (work.length > 1) work.forEach((s, i) => { s[3] = base + " " + (i + 1) + "/" + work.length; });
    else if (work.length === 1) work[0][3] = base;

    let out;
    if (!work.length) {
      out = { kind: "duur", steps: hz2Steps(avail), rpm: "85 tot 90 rpm", title: "Hoge zone 2 · " + avail + "′",
        note: "Ingekort van " + P.fmtH(total) + " naar " + P.fmtH(avail) + ". Te kort voor de geplande opbouw, dus rij het als hoge zone 2: net onder je ademgrens, zoals San Millán dat voor kortere ritten aanraadt. Niet harder om het verschil goed te maken." };
    } else {
      // vul eventueel resterende tijd met zone 2 voor het uitrijden
      const rest = avail - sum(steps);
      if (rest >= 5) {
        const ci = steps.findIndex(isCool);
        steps.splice(ci >= 0 ? ci : steps.length, 0, [rest, 65, 72, "Zone 2", "Hartslag onder 145"]);
      }
      const kept = work.length;
      out = { kind: w.kind, steps, rpm: w.rpm,
        note: "Ingekort van " + P.fmtH(total) + " naar " + P.fmtH(sum(steps)) + ". " +
          (dropped ? "Kwaliteit gaat voor: " + kept + (kept === 1 ? " blok" : " blokken") + " behouden, " + dropped + " geschrapt, zone 2 korter. " : "Alle blokken behouden, alleen de zone 2 is korter. ") +
          (notes.length ? notes.join(" ") + " " : "") + (w.note || "") };
    }
    out.adapted = { from: total, to: P.minutes(out) };
    out.title = out.title || P.titleOf(out, day);
    return out;
  }

  // ---------- zones ----------
  // Z1 <56, Z2 56-75, Z3 76-90, Z4 91-105, Z5 106-120, Z6 >120 (% FTP)
  function zoneOf(pct) { return pct < 56 ? 0 : pct < 76 ? 1 : pct < 91 ? 2 : pct < 106 ? 3 : pct < 121 ? 4 : 5; }

  function plannedZones(w) {
    const z = [0, 0, 0, 0, 0, 0];
    w.steps.forEach((s) => { if (s[1] == null) return; z[zoneOf((s[1] + s[2]) / 2)] += s[0] * 60; });
    return z;
  }
  function plannedAvgPct(w) {
    let a = 0, t = 0;
    w.steps.forEach((s) => { if (s[1] == null) return; a += (s[1] + s[2]) / 2 * s[0]; t += s[0]; });
    return t ? a / t : null;
  }
  function actualZones(hist, ftp) {
    const z = [0, 0, 0, 0, 0, 0];
    Object.keys(hist.buckets || {}).forEach((b) => {
      const watts = (+b + 0.5) * (hist.size || 10);
      z[zoneOf(watts / ftp * 100)] += hist.buckets[b];
    });
    return z;
  }
  function overlap(a, b) {
    const sa = a.reduce((x, y) => x + y, 0), sb = b.reduce((x, y) => x + y, 0);
    if (!sa || !sb) return 0;
    let o = 0;
    for (let i = 0; i < a.length; i++) o += Math.min(a[i] / sa, b[i] / sb);
    return o;
  }

  // Overeenkomst tussen een geplande sessie en een rit (0 tot 1), met uitsplitsing.
  function score(w, act, hist, ftp) {
    const plannedSec = P.minutes(w) * 60;
    const dur = act.moving ? Math.min(plannedSec, act.moving) / Math.max(plannedSec, act.moving) : 0;
    if (hist && hist.watts && hist.pedaling > 120) {
      const zo = overlap(plannedZones(w), actualZones(hist, ftp));
      return { total: 0.4 * dur + 0.6 * zo, dur, zones: zo, basis: "zones" };
    }
    const pw = act.npW || act.avgW;
    const plan = plannedAvgPct(w);
    if (pw && plan) {
      const inten = Math.max(0, 1 - Math.abs(pw / ftp * 100 - plan) / 20);
      return { total: 0.4 * dur + 0.6 * inten, dur, inten, basis: "gemiddeld vermogen" };
    }
    return { total: 0.85 * dur, dur, basis: "alleen duur" };
  }

  // Koppelt ritten aan sessies.
  // sessions: [{id, date (ms UTC), w}] met effectieve datum en training; overgeslagen sessies niet meegeven.
  // acts: [{id, date 'YYYY-MM-DD', moving, avgW, npW, ...}]
  // opts: {hists: {actId: hist}, ftp, links: {sid: actId}, unlinks: {sid: actId}}
  function match(sessions, acts, opts) {
    const iso = (t) => new Date(t).toISOString().slice(0, 10);
    const weekOf = (t) => Math.floor((t - P.START) / (7 * DAY));
    const byId = {}; acts.forEach((a) => { byId[a.id] = a; });
    const sessionDates = {}; sessions.forEach((s) => { sessionDates[iso(s.date)] = true; });
    const result = {}; // sid -> {act, sc, manual} | {best, sc}
    const usedActs = {};

    // handmatige koppelingen eerst
    sessions.forEach((s) => {
      const aid = opts.links && opts.links[s.id];
      if (aid && byId[aid]) {
        result[s.id] = { act: byId[aid], sc: score(s.w, byId[aid], opts.hists[aid], opts.ftp), manual: true };
        usedActs[aid] = true;
      }
    });

    const pairs = [];
    sessions.forEach((s) => {
      if (result[s.id]) return;
      const d = iso(s.date), wk = weekOf(s.date);
      acts.forEach((a) => {
        if (usedActs[a.id]) return;
        if (opts.unlinks && opts.unlinks[s.id] === a.id) return;
        const t = Date.parse(a.date + "T00:00:00Z");
        let factor;
        if (a.date === d) factor = 1;
        else if (weekOf(t) === wk && !sessionDates[a.date]) factor = 0.9; // gereden op een vrije dag in dezelfde week
        else return;
        const sc = score(s.w, a, opts.hists[a.id], opts.ftp);
        sc.total *= factor;
        sc.otherDay = factor < 1;
        pairs.push({ s, a, sc });
      });
    });
    pairs.sort((x, y) => y.sc.total - x.sc.total);
    pairs.forEach((p) => {
      if (result[p.s.id] && result[p.s.id].act) return;
      if (usedActs[p.a.id]) return;
      if (p.sc.total >= MATCH_THRESHOLD) {
        result[p.s.id] = { act: p.a, sc: p.sc, manual: false };
        usedActs[p.a.id] = true;
      } else if (!result[p.s.id]) {
        result[p.s.id] = { best: p.a, sc: p.sc };
      }
    });
    return result;
  }

  g.AlpeLogic = { adapt, score, match, plannedZones, actualZones, overlap, zoneOf, MATCH_THRESHOLD };
})(typeof window !== "undefined" ? window : globalThis);
