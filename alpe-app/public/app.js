/* Alpe d'HuZes trainingsplan: interface, opslag en Strava-koppeling. */
(function () {
  "use strict";
  const P = window.AlpePlan, L = window.AlpeLogic, S = window.AlpeSeason;
  const { DAY, START, EVENT, MONTHS, DAYN, KIND, PHASES, FOCUS, WEEKS, ZWIFT_END } = P;
  const minutes = P.minutes, fmtH = P.fmtH;
  const WEEKDAYS = ["Zo", "Ma", "Di", "Wo", "Do", "Vr", "Za"];

  // ---------- opslag ----------
  const LS = "alpe-state-v1";
  let state = { v: 1, ftp: 237, kg: 80, done: {}, ov: {}, links: {}, unlinks: {}, icu: {}, updatedAt: 0 };
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function normalize(s) {
    const o = Object.assign({ v: 1, ftp: 237, kg: 80, done: {}, ov: {}, links: {}, unlinks: {}, icu: {}, updatedAt: 0 }, s || {});
    o.season = Object.assign({ indoorMax: 90 }, o.season || {});
    o.extra = Object.assign({ on: false, fromWeek: 0, day: "sat", max: 90 }, o.extra || {});
    return o;
  }
  state = normalize(state);
  try { const raw = lsGet(LS); if (raw) state = normalize(JSON.parse(raw)); } catch (e) {}

  let me = null;           // {connected, firstname, ftp, weight}
  let icu = { configured: false, busy: false }; // intervals.icu ingesteld op de server?
  let acts = [];           // ritten uit Strava
  let hists = {};          // vermogensverdeling per rit-id
  let matches = {};        // sessie-id -> resultaat
  let lastSync = null;
  let cachedSync = null;   // tijdstip van de gecachte ritten (nog niet ververst)
  const ACTS_LS = "alpe-acts-v1";
  const HIST_WEEKS = 52;   // historie vóór de start van het plan
  const HIST_START = START - HIST_WEEKS * 7 * DAY;
  function actTime(a) { return Date.parse(a.date + "T00:00:00Z"); }
  function weekIdx(t) { return Math.floor((t - START) / (7 * DAY)); }
  let saveTimer = null;
  let wx = {};             // weersverwachting per datum (Open-Meteo)
  let wxAt = 0;

  function save() {
    state.updatedAt = Date.now();
    lsSet(LS, JSON.stringify(state));
    if (!me || !me.connected) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      fetch("/api/state", { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(state) })
        .then(function (r) { if (!r.ok) throw new Error(); })
        .catch(function () { toast("Opslaan in de cloud lukte niet. Je wijzigingen staan wel op dit apparaat."); });
    }, 1000);
  }

  // ---------- helpers ----------
  const $ = function (id) { return document.getElementById(id); };
  function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { el.hidden = true; }, 3500); }
  function cssVar(v) { return "var(" + v + ")"; }
  function dstr(t) { const d = new Date(t); return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()]; }
  function dshort(t) { const d = new Date(t); return WEEKDAYS[d.getUTCDay()].toLowerCase() + " " + d.getUTCDate() + " " + MONTHS[d.getUTCMonth()].slice(0, 3); }
  function iso(t) { return new Date(t).toISOString().slice(0, 10); }
  function todayUTC() { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); }
  function currentWeek() { return Math.max(0, Math.min(30, Math.floor((todayUTC() - START) / (7 * DAY)))); }
  function watts(p) { return Math.round(state.ftp * p / 100); }
  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmtDur(m) { return m >= 60 ? fmtH(m) : m + "′"; }

  // Sessie met aanpassingen toegepast
  // Kan deze training buiten? Wo en vr tot en met maart zijn Zwift-dagen; de Alpe-dag zelf telt niet mee.
  function outdoorCandidate(s, date) { return s.w.kind !== "event" && !((s.day === "wed" || s.day === "fri") && date < ZWIFT_END); }
  // Buiten of binnen: jouw keuze, anders de weersverwachting, anders het seizoen.
  function placeOf(s, date, w) {
    if (!outdoorCandidate(s, date)) return { where: "zwift" };
    const o = state.ov[s.id] || {}, d = iso(date);
    const light = S.daylight(date), f = wx[d] || null, v = S.weatherVerdict(f);
    const res = { light: light, f: f, v: v, auto: !o.where };
    if (o.where) { res.where = o.where; res.why = "jouw keuze"; return res; }
    if (v) { res.where = v.level === "slecht" ? "binnen" : "buiten"; res.why = v.level === "slecht" ? v.why : "weersverwachting"; return res; }
    if (date < todayUTC()) { res.where = "buiten"; res.why = "voorbij"; return res; }
    if (S.isWinter(date) && minutes(w) > state.season.indoorMax) { res.where = "binnen"; res.why = "winter: gepland als binnenrit, weer volgt 16 dagen vooraf"; return res; }
    res.where = "buiten"; res.why = "seizoen"; return res;
  }
  function eff(s) {
    const o = state.ov[s.id] || {};
    let w = o.min ? L.adapt(s.w, o.min, s.day) : s.w;
    const date = o.date ? Date.parse(o.date + "T00:00:00Z") : s.date;
    const place = placeOf(s, date, w);
    if (place.where === "binnen") w = S.indoorize(w, state.season.indoorMax, s.day);
    else if (place.where === "buiten" && place.light && date >= todayUTC()) w = S.fitDaylight(w, place.light.usable, s.day);
    return { id: s.id, day: s.day, base: s, w: w, date: date, title: w === s.w ? s.title : w.title, skip: !!o.skip, ov: o, place: place, extra: !!s.extra, moved: !!o.date && o.date !== iso(s.date) };
  }
  // Alle trainingen van een week, inclusief de extra dag als die aan staat.
  function weekSessions(wk) {
    const x = S.extraSession(wk, state.extra);
    return x ? wk.sessions.concat([x]) : wk.sessions;
  }
  function weekEff(wk) { return weekSessions(wk).map(eff).sort(function (a, b) { return a.date - b.date; }); }
  function isDone(e) { return !e.skip && (!!state.done[e.id] || !!(matches[e.id] && matches[e.id].act)); }
  function weekMins(list) { return list.reduce(function (a, e) { return a + (e.skip ? 0 : minutes(e.w)); }, 0); }

  let selWeek = currentWeek();
  let openPanel = null;

  // ---------- strip ----------
  function renderStrip() {
    const bar = $("stripBar"), lab = $("stripLabels"), cur = currentWeek();
    bar.innerHTML = ""; lab.innerHTML = "";
    WEEKS.forEach(function (wk) {
      const list = weekEff(wk).filter(function (e) { return !e.skip; });
      const mins = weekMins(list);
      const b = document.createElement("button");
      b.type = "button";
      const done = list.filter(isDone).length, tot = list.length;
      b.title = "Week " + wk.n + " · " + wk.phase.name + " · " + dstr(wk.mon) + " · " + fmtH(mins) + " uur";
      b.setAttribute("aria-label", b.title);
      if (wk.rec) b.classList.add("rec");
      if (wk.n === cur) b.classList.add("cur");
      if (wk.n === selWeek) b.classList.add("sel");
      const f = document.createElement("span"); f.className = "fill";
      f.style.height = Math.max(10, Math.min(100, mins / 540 * 100)) + "%";
      f.style.opacity = tot ? (0.25 + 0.65 * (done / tot)) : 0.25;
      if (wk.n === 30) f.style.background = cssVar("--sign");
      b.appendChild(f);
      b.addEventListener("click", function () { selWeek = wk.n; openPanel = null; if (location.hash !== "#week") location.hash = "week"; else renderAll(); });
      bar.appendChild(b);
    });
    PHASES.forEach(function (p) {
      const s = document.createElement("span");
      s.style.gridColumn = (p.weeks[0] + 1) + " / span " + p.weeks.length;
      s.textContent = p.weeks.length >= 3 ? p.name : (p.weeks.length === 1 ? "" : p.name);
      s.title = p.name;
      lab.appendChild(s);
    });
    $("legend").innerHTML = "<span>Balkhoogte = geplande uren, kleur = hoeveel er gedaan is</span>" +
      ["duur", "tempo", "sst", "drempel"].map(function (k) { return '<span><i style="background:' + cssVar(KIND[k][1]) + '"></i>' + KIND[k][0] + "</span>"; }).join("");
  }

  // ---------- weekweergave ----------
  function renderWeek() {
    renderIcuBar();
    const wk = WEEKS[selWeek];
    const list = weekEff(wk);
    const active = list.filter(function (e) { return !e.skip; });
    const sun = wk.mon + 6 * DAY;
    $("wkMeta").textContent = "Week " + wk.n + " van 30 · " + wk.phase.name + (wk.rec ? " · herstelweek" : "");
    const m1 = new Date(wk.mon).getUTCMonth(), m2 = new Date(sun).getUTCMonth();
    $("wkTitle").textContent = new Date(wk.mon).getUTCDate() + (m1 === m2 ? "" : " " + MONTHS[m1]) + " tot " + dstr(sun);
    $("wkHours").textContent = fmtH(weekMins(active));
    const low = selWeek === 30 ? null : P.lowShare(active.map(function (e) { return e.w; }));
    $("wkLow").textContent = low == null ? "–" : low + "%";
    $("wkDone").textContent = active.filter(isDone).length + "/" + active.length;
    let ridden = 0, any = false;
    acts.forEach(function (a) { const t = Date.parse(a.date + "T00:00:00Z"); if (t >= wk.mon && t <= sun) { ridden += a.moving / 60; any = true; } });
    $("wkStrava").textContent = me && me.connected && lastSync ? (any ? fmtH(ridden) : "0:00") : "–";
    $("wkFocus").innerHTML = "<b>Focus van de week</b>" + esc(FOCUS[wk.n] || wk.phase.text);
    $("prevWk").disabled = selWeek === 0; $("nextWk").disabled = selWeek === 30;
    const box = $("sessions"); box.innerHTML = "";
    list.forEach(function (e) { box.appendChild(sessionCard(e, wk)); });
    renderLoose(wk, sun);
    renderHistory();
  }

  // Ritten in deze week die aan geen enkele training hangen
  function renderLoose(wk, sun) {
    const el = $("looseRides");
    if (!me || !me.connected || !lastSync) { el.hidden = true; return; }
    const used = {};
    Object.keys(matches).forEach(function (k) { if (matches[k] && matches[k].act) used[matches[k].act.id] = true; });
    const loose = acts.filter(function (a) { const t = actTime(a); return t >= wk.mon && t <= sun && !used[a.id]; })
      .sort(function (x, y) { return actTime(x) - actTime(y); });
    if (!loose.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = "<h3>Losse ritten deze week</h3><p>Gereden op een dag zonder training, dus niet automatisch gekoppeld. Ze tellen wel mee in je gereden uren.</p><ul>" +
      loose.map(function (a) {
        const parts = [fmtH(a.moving / 60), String(a.km).replace(".", ",") + " km"];
        if (a.npW || a.avgW) parts.push(Math.round(a.npW || a.avgW) + " W" + (a.npW ? " NP" : " gem."));
        return "<li><span class='d'>" + dshort(actTime(a)) + "</span><a href='https://www.strava.com/activities/" + esc(a.id) + "' target='_blank' rel='noopener'>" + esc(a.name) + "</a><span class='sub'>" + esc(parts.join(" · ")) + "</span></li>";
      }).join("") + "</ul>";
  }

  // ---------- historie ----------
  function renderHistory() {
    const el = $("history");
    if (!me || !me.connected || !lastSync) { el.hidden = true; return; }
    el.hidden = false;
    const cur = weekIdx(todayUTC());
    const first = -HIST_WEEKS, last = Math.min(30, cur);
    const n = last - first + 1;
    const hrs = new Array(n).fill(0), cnt = new Array(n).fill(0), km = new Array(n).fill(0);
    acts.forEach(function (a) {
      const i = weekIdx(actTime(a)) - first;
      if (i < 0 || i >= n) return;
      hrs[i] += (a.moving || 0) / 3600; cnt[i]++; km[i] += a.km || 0;
    });
    const curI = cur - first;
    // afgeronde weken: de lopende week telt nog niet mee in de gemiddelden
    const avg = function (k) { let s = 0, c = 0; for (let i = curI - k; i < curI; i++) if (i >= 0) { s += hrs[i]; c++; } return c ? s / c : 0; };
    const sumR = function (arr) { return arr.reduce(function (a, b) { return a + b; }, 0); };
    const longest = acts.reduce(function (m, a) { return actTime(a) >= HIST_START && (!m || a.moving > m.moving) ? a : m; }, null);
    const hm = function (h) { return fmtH(Math.round(h * 60)); };
    $("hStats").innerHTML =
      "<div class='stat'><span>Gem. laatste 4 wk</span><b>" + hm(avg(4)) + "</b></div>" +
      "<div class='stat'><span>Gem. laatste 12 wk</span><b>" + hm(avg(12)) + "</b></div>" +
      "<div class='stat'><span>Ritten, 12 mnd</span><b>" + sumR(cnt) + "</b></div>" +
      "<div class='stat'><span>Km, 12 mnd</span><b>" + Math.round(sumR(km)).toLocaleString("nl-NL") + "</b></div>" +
      "<div class='stat'><span>Langste rit</span><b>" + (longest ? fmtH(Math.round(longest.moving / 60)) : "–") + "</b></div>";

    // staafdiagram: uren per week
    const W = 640, H = 150, padL = 30, padR = 6, top = 10, bottom = 22, ch = H - top - bottom;
    const max = Math.max(4, Math.ceil(Math.max.apply(null, hrs.concat([0])) / 2) * 2);
    const bw = (W - padL - padR) / n, gap = Math.min(2, bw * 0.25);
    const y = function (v) { return top + ch - v / max * ch; };
    let svg = "<svg viewBox='0 0 " + W + " " + H + "' role='img' aria-label='Gereden uren per week, de afgelopen 12 maanden en de weken van het plan'>";
    for (let v = 0; v <= max; v += max > 8 ? 4 : 2) {
      svg += "<line x1='" + padL + "' x2='" + (W - padR) + "' y1='" + y(v).toFixed(1) + "' y2='" + y(v).toFixed(1) + "' stroke='var(--line)' stroke-width='1'/>";
      svg += "<text x='" + (padL - 5) + "' y='" + (y(v) + 3.5).toFixed(1) + "' text-anchor='end'>" + v + "u</text>";
    }
    const startX = padL + (0 - first) * bw;
    svg += "<rect x='" + startX.toFixed(1) + "' y='" + top + "' width='" + (W - padR - startX).toFixed(1) + "' height='" + ch + "' fill='var(--sign)' opacity='.12'/>";
    svg += "<text class='lbl' x='" + (startX + 4).toFixed(1) + "' y='" + (top + 10) + "'>Plan</text>";
    let lastMonth = -1;
    for (let i = 0; i < n; i++) {
      const wkn = i + first, mon = START + wkn * 7 * DAY, x = padL + i * bw;
      const month = new Date(mon + 3 * DAY).getUTCMonth();
      if (month !== lastMonth) {
        if (lastMonth !== -1 && (i > 1 && i < n - 1)) svg += "<text x='" + (x + bw / 2).toFixed(1) + "' y='" + (H - 6) + "' text-anchor='middle'>" + MONTHS[month].slice(0, 3) + "</text>";
        lastMonth = month;
      }
      const h = hrs[i];
      const sel = wkn === selWeek, isCur = wkn === cur;
      const tip = (wkn >= 0 ? "Week " + wkn + " · " : "") + dstr(mon) + " tot " + dstr(mon + 6 * DAY) + ": " + hm(h) + " uur, " + cnt[i] + (cnt[i] === 1 ? " rit" : " ritten") + ", " + Math.round(km[i]) + " km";
      const fill = isCur ? "var(--sign)" : (wkn >= 0 ? "var(--k-duur)" : "var(--accent)");
      svg += "<g class='hb" + (wkn >= 0 ? " pl" : "") + "'" + (wkn >= 0 ? " data-w='" + wkn + "'" : "") + "><title>" + esc(tip) + "</title>" +
        "<rect x='" + x.toFixed(1) + "' y='" + top + "' width='" + bw.toFixed(1) + "' height='" + ch + "' fill='transparent'/>" +
        (h > 0 ? "<rect x='" + (x + gap / 2).toFixed(1) + "' y='" + y(h).toFixed(1) + "' width='" + Math.max(1, bw - gap).toFixed(1) + "' height='" + Math.max(1, ch - (y(h) - top)).toFixed(1) + "' rx='1.5' fill='" + fill + "'" + (sel ? " stroke='var(--fg)' stroke-width='1.5'" : "") + "/>" : "") + "</g>";
    }
    svg += "</svg>";
    $("hChart").innerHTML = svg;
    $("hChart").querySelectorAll("g.pl").forEach(function (g) {
      g.addEventListener("click", function () { selWeek = +g.dataset.w; openPanel = null; renderAll(); });
    });
  }

  function stepRows(w) {
    return w.steps.map(function (st) {
      const kc = cssVar(KIND[P.stepKind(st[1])][1]);
      const wt = st[1] == null ? "max" : (st[1] === st[2] ? watts(st[1]) : watts(st[1]) + "–" + watts(st[2])) + " W";
      const pct = st[1] == null ? "" : st[1] + (st[1] === st[2] ? "" : "–" + st[2]) + "%";
      return "<tr><td class='t'>" + fmtDur(st[0]) + "</td><td><span class='bar' style='background:" + kc + "'></span>" + esc(st[3]) + (st[4] ? "<small>" + esc(st[4]) + "</small>" : "") + "</td><td class='w'>" + wt + "<small>" + pct + "</small></td></tr>";
    }).join("");
  }

  function matchBlock(e) {
    if (e.skip || !me || !me.connected || !lastSync) return "";
    const m = matches[e.id];
    const pct = function (x) { return Math.round(x * 100) + "%"; };
    if (m && m.act) {
      const a = m.act, sc = m.sc;
      const parts = [fmtH(a.moving / 60)];
      if (a.npW || a.avgW) parts.push(Math.round(a.npW || a.avgW) + " W" + (a.npW ? " NP" : " gem."));
      parts.push("overeenkomst " + pct(sc.total) + ": duur " + pct(sc.dur));
      if (sc.zones != null) parts.push("zones " + pct(sc.zones)); else if (sc.inten != null) parts.push("intensiteit " + pct(sc.inten));
      return "<div class='match ok'><div class='row'><b>✓ Gekoppeld aan Strava</b>" + (m.manual ? "<span class='sub'>handmatig</span>" : "") + "</div>" +
        "<div class='row'><a href='https://www.strava.com/activities/" + esc(a.id) + "' target='_blank' rel='noopener'>" + esc(a.name) + "</a><span class='sub'>Bekijk op Strava" + (a.date !== iso(e.date) ? " · gereden op " + dshort(Date.parse(a.date + "T00:00:00Z")) : "") + "</span></div>" +
        "<div class='row sub'>" + esc(parts.join(" · ")) + "</div>" +
        "<div class='row'><button class='linkbtn' data-act='unlink' data-sid='" + e.id + "' data-aid='" + esc(a.id) + "' type='button'>Ontkoppel</button></div></div>";
    }
    if (m && m.best) {
      return "<div class='match'><div class='row'><span>Rit op een andere dag: <b>" + esc(m.best.name) + "</b></span><span class='sub'>" + dshort(actTime(m.best)) + " · " + fmtH(m.best.moving / 60) + "</span><span class='score'>" + pct(m.sc.total) + "</span></div>" +
        "<div class='row sub'>Niet op de dag van deze training, dus niet automatisch gekoppeld. Was dit deze training? Koppel hem dan zelf, of verplaats de training via Lukt niet?.</div>" +
        "<div class='row'><button class='linkbtn' data-act='link' data-sid='" + e.id + "' data-aid='" + esc(m.best.id) + "' type='button'>Toch koppelen</button></div></div>";
    }
    if (e.date <= todayUTC()) return "<div class='match'><div class='row sub'>Geen rit op Strava op " + dshort(e.date) + ".</div></div>";
    return "";
  }

  // Daglicht, weer en de keuze buiten of binnen
  function placeBlock(e) {
    const pl = e.place;
    if (!pl || pl.where === "zwift" || e.skip || e.date < todayUTC() - DAY) return "";
    const li = pl.light, mins = minutes(e.w);
    let head, cls;
    if (pl.where === "binnen") { head = "Binnen op Zwift"; cls = "in"; }
    else { head = "Buiten"; cls = pl.v && pl.v.level === "matig" ? "maybe" : "out"; }
    const why = pl.auto ? (pl.f ? (pl.where === "binnen" ? "weer: " + pl.v.why : "weer is goed genoeg") : pl.why) : "jouw keuze";
    let rows = "<div class='row'><span class='pill " + cls + "'>" + head + "</span><span class='sub'>" + esc(why) + (pl.auto ? " · automatisch" : "") + "</span></div>";
    rows += "<div class='row sub'>Daglicht " + li.riseTxt + " tot " + li.setTxt + " · goed rijlicht " + li.fromTxt + " tot " + li.toTxt + " (" + fmtH(li.usable) + ")" +
      (pl.where === "buiten" && mins <= li.usable ? " · vertrek uiterlijk " + li.latestStart(mins) : "") + "</div>";
    if (pl.f) rows += "<div class='row sub'>Verwachting: " + esc(S.weatherLine(pl.f)) + "</div>";
    else if (e.date >= todayUTC()) rows += "<div class='row sub'>De weersverwachting verschijnt 16 dagen vooraf.</div>";
    if (pl.where === "buiten" && pl.v && pl.v.level === "matig") rows += "<div class='row sub'>Tip: " + esc(pl.v.why) + ".</div>";
    const alt = pl.where === "binnen" ? "buiten" : "binnen";
    rows += "<div class='row'><button class='linkbtn' type='button' data-act='where' data-where='" + alt + "' data-sid='" + e.id + "'>Toch " + alt + "</button>" +
      (pl.auto ? "" : "<button class='linkbtn' type='button' data-act='where' data-where='' data-sid='" + e.id + "'>Automatisch laten kiezen</button>") + "</div>";
    return "<div class='wx " + cls + "'>" + rows + "</div>";
  }

  function ovPanel(e, wk) {
    const total = minutes(e.base.w);
    let opts = "<option value=''>Zoals gepland (" + fmtH(total) + ")</option>";
    for (let m = 30; m < total; m += 15) opts += "<option value='" + m + "'" + (e.ov.min === m ? " selected" : "") + ">" + fmtH(m) + "</option>";
    let days = "";
    for (let d = 0; d < 7; d++) {
      const t = wk.mon + d * DAY, v = iso(t), planned = v === iso(e.base.date);
      const sel = e.ov.date ? e.ov.date === v : planned;
      days += "<option value='" + (planned ? "" : v) + "'" + (sel ? " selected" : "") + ">" + dshort(t) + (planned ? " (gepland)" : "") + "</option>";
    }
    const has = e.ov.min || e.ov.date || e.ov.skip || e.ov.where;
    const canOut = e.place && e.place.where !== "zwift";
    const whereSel = canOut ? "<label class='f' for='ovw-" + e.id + "'>Waar<select id='ovw-" + e.id + "'>" +
      [["", "Automatisch (weer en licht)"], ["buiten", "Buiten"], ["binnen", "Binnen op Zwift"]].map(function (o) { return "<option value='" + o[0] + "'" + ((e.ov.where || "") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>" : "";
    return "<div class='ovpanel'><div class='fields'>" +
      "<label class='f' for='ovm-" + e.id + "'>Beschikbare tijd<select id='ovm-" + e.id + "'>" + opts + "</select></label>" +
      "<label class='f' for='ovd-" + e.id + "'>Dag<select id='ovd-" + e.id + "'>" + days + "</select></label>" + whereSel +
      "<label class='check' for='ovs-" + e.id + "'><input type='checkbox' id='ovs-" + e.id + "'" + (e.ov.skip ? " checked" : "") + "> Overslaan</label></div>" +
      "<div class='hint'>Bij minder tijd past de coach de training aan: blokken gaan voor, zone 2 wordt korter. Overgeslagen is overgeslagen, niet dubbel inhalen.</div>" +
      "<div class='actions'><button class='btn primary' type='button' data-act='ovsave' data-sid='" + e.id + "'>Opslaan</button>" +
      (has ? "<button class='btn' type='button' data-act='ovreset' data-sid='" + e.id + "'>Terug naar plan</button>" : "") +
      "<button class='btn' type='button' data-act='ovclose' data-sid='" + e.id + "'>Annuleren</button></div></div>";
  }

  function sessionCard(e, wk) {
    const w = e.w, k = KIND[w.kind];
    const el = document.createElement("article");
    el.className = "session" + (isDone(e) ? " done" : "") + (e.skip ? " skipped" : "");
    el.style.setProperty("--kc", cssVar(k[1]));
    const d = new Date(e.date);
    const dayLabel = WEEKDAYS[d.getUTCDay()];
    let chips = "<span class='chip kind'>" + k[0] + "</span><span class='chip num'>" + fmtH(minutes(w)) + "</span>";
    if (e.skip) chips += "<span class='chip warn'>Overgeslagen</span>";
    if (e.extra) chips += "<span class='chip extra'>Extra dag</span>";
    if (w.indoor) chips += "<span class='chip warn'>Binnenversie, buiten " + fmtH(w.indoor.from) + "</span>";
    else if (w.adapted) chips += "<span class='chip warn'>Ingekort, was " + fmtH(w.adapted.from) + "</span>";
    if (e.moved) chips += "<span class='chip warn'>Verplaatst van " + DAYN[e.day][0].toLowerCase() + "</span>";
    if (w.rpm) chips += "<span class='chip'>" + esc(w.rpm) + "</span>";
    if (e.place && (e.place.where === "zwift" || e.place.where === "binnen")) chips += "<span class='chip'>Zwift · ERG</span>";
    else if (e.place && e.place.where === "buiten") chips += "<span class='chip out'>Buiten</span>";
    el.innerHTML =
      "<div class='s-head'><div class='s-day'>" + dayLabel + "<b class='num'>" + d.getUTCDate() + "</b>" + MONTHS[d.getUTCMonth()].slice(0, 3) + "</div>" +
      "<div class='s-title'><h3>" + esc(e.title) + "</h3><div class='chips'>" + chips + "</div></div></div>" +
      "<table class='steps'><tbody>" + stepRows(w) + "</tbody></table>" +
      "<div class='note'>" + esc(w.note) + "</div>" +
      placeBlock(e) +
      matchBlock(e) +
      (openPanel === e.id ? ovPanel(e, wk) : "") +
      "<div class='s-foot'>" + (e.skip ? "" : (matches[e.id] && matches[e.id].act && !state.done[e.id]) ? "<span class='check' style='color:var(--ok)'>✓ Gedaan via Strava</span>" : "<label class='check' for='c-" + e.id + "'><input type='checkbox' id='c-" + e.id + "'" + (state.done[e.id] ? " checked" : "") + "> Gedaan</label>") +
      (w.kind === "event" || e.skip ? "" : "<button class='btn' type='button' data-act='zwo' data-sid='" + e.id + "' style='margin-left:auto' title='Download als Zwift-training (.zwo)'>Naar Zwift</button>") +
      (w.kind === "event" ? "" : "<button class='btn' type='button' data-act='ovopen' data-sid='" + e.id + "'" + (e.skip ? " style='margin-left:auto'" : "") + ">" + (openPanel === e.id ? "Sluiten" : "Lukt niet?") + "</button>") + "</div>";
    const cb = el.querySelector("#c-" + e.id);
    if (cb) cb.addEventListener("change", function () {
      if (cb.checked) state.done[e.id] = true; else delete state.done[e.id];
      save(); renderAll();
    });
    return el;
  }

  // ---------- intervals.icu (en via intervals.icu naar Zwift) ----------
  function findEff(sid) {
    let e = null;
    WEEKS.some(function (wk) { e = weekEff(wk).find(function (x) { return x.id === sid; }) || null; return !!e; });
    return e;
  }
  function zwoName(e) {
    const d = new Date(e.date);
    const day = String(d.getUTCDate()).padStart(2, "0") + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
    return "Alpe " + day + " " + e.title + (e.w.adapted ? " (" + fmtH(minutes(e.w)) + ")" : "");
  }
  function zwoText(e) {
    return L.toZwo(e.w, { name: zwoName(e), description: e.w.note + " Gemaakt voor FTP " + state.ftp + " W; Zwift rekent met de FTP in je Zwift-profiel." });
  }
  // Wat er van een week naar intervals.icu gaat: alles vanaf vandaag, behalve overgeslagen en de Alpe-dag zelf.
  function icuWeek(wk) {
    const today = todayUTC(), put = [], remove = [];
    weekEff(wk).forEach(function (e) {
      if (e.date < today) return;
      if (e.skip || e.w.kind === "event") { if (state.icu[e.id]) remove.push(e.id); return; }
      put.push({ id: e.id, date: iso(e.date), name: zwoName(e), zwo: zwoText(e) });
    });
    return { put: put, remove: remove };
  }
  async function icuSend(wk, quiet) {
    const p = icuWeek(wk);
    if (!p.put.length && !p.remove.length) { if (!quiet) toast("Geen trainingen meer om te versturen in deze week."); return; }
    icu.busy = true; renderIcuBar();
    try {
      await api("/api/intervals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workouts: p.put, remove: p.remove }) });
      const now = Date.now();
      p.put.forEach(function (x) { state.icu[x.id] = now; });
      p.remove.forEach(function (id) { delete state.icu[id]; });
      save();
      toast(p.put.length + " training" + (p.put.length === 1 ? "" : "en") + " in intervals.icu gezet. Zwift haalt ze daar vandaan.");
    } catch (err) {
      toast("intervals.icu: " + err.message);
    }
    icu.busy = false; renderIcuBar();
  }
  // Na aanpassen of overslaan: stond de training al in intervals.icu, dan meteen bijwerken.
  function icuResync(sid) {
    if (!icu.configured || !state.icu[sid]) return;
    const m = /^w(\d+)/.exec(sid), wk = m ? WEEKS[+m[1]] : null;
    if (wk) icuSend(wk, true);
  }
  function renderIcuBar() {
    const el = $("icuBar");
    if (!icu.configured || !me || !me.connected) { el.hidden = true; return; }
    const wk = WEEKS[selWeek], p = icuWeek(wk);
    const sent = weekEff(wk).filter(function (e) { return state.icu[e.id]; });
    const last = sent.reduce(function (m, e) { return Math.max(m, state.icu[e.id]); }, 0);
    el.hidden = false;
    el.innerHTML = "<span><b>intervals.icu → Zwift</b>" +
      (last ? "Deze week verstuurd op " + new Date(last).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + "." : "Zet deze week in je intervals.icu-kalender; intervals.icu zet hem in Zwift.") + "</span>" +
      "<button class='btn primary' type='button' id='icuSend'" + (icu.busy || (!p.put.length && !p.remove.length) ? " disabled" : "") + ">" +
      (icu.busy ? "Versturen…" : (last ? "Opnieuw versturen" : "Week naar intervals.icu")) + "</button>";
    $("icuSend").addEventListener("click", function () { icuSend(WEEKS[selWeek]); });
  }
  api("/api/intervals").then(function (r) { icu.configured = !!(r && r.configured); renderIcuBar(); }).catch(function () {});

  // Training als Zwift-bestand. Gebruikt de training zoals hij nu staat (ook ingekort).
  function downloadZwo(sid) {
    const e = findEff(sid);
    if (!e) return;
    const xmlText = zwoText(e);
    const file = zwoName(e).replace(/[^\w\- ]+/g, "").replace(/\s+/g, "_") + ".zwo";
    const blob = new Blob([xmlText], { type: "application/xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = file;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    toast("Gedownload. Zet het bestand in Documenten/Zwift/Workouts/<je Zwift-id>, zie 'Trainingen naar Zwift'.");
  }

  // Klikken in kaarten (aanpassen, koppelen)
  $("sessions").addEventListener("click", function (ev) {
    const b = ev.target.closest("[data-act]");
    if (!b) return;
    const sid = b.dataset.sid, act = b.dataset.act;
    if (act === "zwo") { downloadZwo(sid); return; }
    if (act === "ovopen") { openPanel = openPanel === sid ? null : sid; renderWeek(); return; }
    if (act === "ovclose") { openPanel = null; renderWeek(); return; }
    if (act === "ovreset") { delete state.ov[sid]; openPanel = null; save(); rematch(); renderAll(); icuResync(sid); toast("Training staat weer zoals gepland."); return; }
    if (act === "ovsave") {
      const m = $("ovm-" + sid).value, d = $("ovd-" + sid).value, s = $("ovs-" + sid).checked;
      const wsel = $("ovw-" + sid), wh = wsel ? wsel.value : "";
      const o = {};
      if (wh) o.where = wh;
      if (m) o.min = +m;
      if (d) o.date = d;
      if (s) o.skip = true;
      if (Object.keys(o).length) state.ov[sid] = o; else delete state.ov[sid];
      if (s) delete state.done[sid];
      openPanel = null; save(); rematch(); renderAll(); icuResync(sid);
      toast(s ? "Overgeslagen. Volgende training gewoon volgens plan." : (m ? "Aangepast naar " + fmtH(+m) + "." : "Opgeslagen."));
      return;
    }
    if (act === "where") {
      const o = Object.assign({}, state.ov[sid] || {});
      if (b.dataset.where) o.where = b.dataset.where; else delete o.where;
      if (Object.keys(o).length) state.ov[sid] = o; else delete state.ov[sid];
      save(); rematch(); renderAll(); icuResync(sid);
      toast(b.dataset.where === "binnen" ? "Binnenversie op Zwift." : b.dataset.where === "buiten" ? "Buiten, ingekort tot het daglicht als dat nodig is." : "De app kiest weer zelf op basis van weer en licht.");
      return;
    }
    if (act === "link") { state.links[sid] = b.dataset.aid; delete state.unlinks[sid]; save(); rematch(); renderAll(); toast("Gekoppeld."); return; }
    if (act === "unlink") { delete state.links[sid]; state.unlinks[sid] = b.dataset.aid; save(); rematch(); renderAll(); toast("Ontkoppeld."); return; }
  });

  // ---------- schema ----------
  function renderSchema() {
    const cur = currentWeek();
    const out = PHASES.map(function (p) {
      const rows = p.weeks.map(function (n) {
        const wk = WEEKS[n];
        const list = weekEff(wk);
        const cell = function (d) {
          const e = list.find(function (x) { return x.day === d && !x.extra; });
          if (!e) return "<td></td>";
          const tag = e.skip ? " <span class='sub'>(overgeslagen)</span>" : (isDone(e) ? " <span class='ok'>✓</span>" : "");
          return "<td><div class='cell' style='--kc:" + cssVar(KIND[e.w.kind][1]) + "'><span class='dot'></span><span>" + esc(e.title) + tag + "</span></div></td>";
        };
        const mid = list.some(function (x) { return x.day === "thu" && !x.extra; }) ? cell("thu") : cell("fri");
        const xe = list.find(function (x) { return x.extra; });
        const xcell = state.extra.on ? (xe ? "<td><div class='cell' style='--kc:" + cssVar(KIND[xe.w.kind][1]) + "'><span class='dot'></span><span>" + esc(xe.title.replace(/ · extra$/, "")) + (xe.skip ? " <span class='sub'>(overgeslagen)</span>" : (isDone(xe) ? " <span class='ok'>✓</span>" : "")) + "</span></div></td>" : "<td class='sub'>–</td>") : "";
        const active = list.filter(function (e) { return !e.skip; });
        const low = n === 30 ? null : P.lowShare(active.map(function (e) { return e.w; }));
        return "<tr data-w='" + n + "' class='" + (n === cur ? "cur" : "") + "'><td class='wk'>" + n + (wk.rec ? " · H" : "") + "<br><small style='color:var(--muted)'>" + dstr(wk.mon) + "</small></td>" + cell("wed") + mid + cell("sun") + xcell +
          "<td class='num'>" + fmtH(weekMins(active)) + "</td><td class='num'>" + (low == null ? "–" : low + "%") + "</td></tr>";
      }).join("");
      const hrs = p.weeks.reduce(function (a, n) { return a + weekMins(weekEff(WEEKS[n]).filter(function (e) { return !e.skip; })); }, 0);
      return "<div class='phase'><h2>" + p.name + "<small>Week " + p.weeks[0] + (p.weeks.length > 1 ? " tot " + p.weeks[p.weeks.length - 1] : "") + " · " + fmtH(hrs) + " uur</small></h2><p>" + esc(p.text) + "</p>" +
        "<div class='tablewrap'><table class='sched'><thead><tr><th>Week</th><th>Woensdag</th><th>" + (p.id === "ev" ? "Donderdag" : "Vrijdag") + "</th><th>Zondag</th>" + (state.extra.on ? "<th>Extra (" + S.EXTRA_DAYS[state.extra.day].label.slice(0, 2) + ")</th>" : "") + "<th>Uren</th><th>Z1–2</th></tr></thead><tbody>" + rows + "</tbody></table></div></div>";
    }).join("");
    $("schemaList").innerHTML = out;
    $("schemaList").querySelectorAll("tr[data-w]").forEach(function (tr) {
      tr.addEventListener("click", function () { selWeek = +tr.dataset.w; openPanel = null; location.hash = "week"; });
    });
  }

  // ---------- indeling: winter, daglicht en extra dag ----------
  // Ritten op dagen zonder geplande training, de afgelopen 28 dagen
  function freeRides() {
    const today = todayUTC(), from = today - 28 * DAY, planned = {};
    WEEKS.forEach(function (wk) { weekEff(wk).forEach(function (e) { if (!e.skip) planned[iso(e.date)] = true; }); });
    const byDay = {};
    acts.forEach(function (a) { const t = actTime(a); if (t >= from && t < today && !planned[a.date]) byDay[a.date] = (byDay[a.date] || 0) + a.moving / 60; });
    return Object.keys(byDay).map(function (d) { return { date: d, min: byDay[d] }; });
  }
  function opt(v, label, cur) { return "<option value='" + v + "'" + (String(cur) === String(v) ? " selected" : "") + ">" + label + "</option>"; }

  function renderSetup() {
    const cur = currentWeek();
    // binnenlimiet
    $("inMax").innerHTML = [60, 75, 90, 120, 150].map(function (m) { return opt(m, fmtH(m) + " uur" + (m === 90 ? " (advies)" : ""), state.season.indoorMax); }).join("");
    // extra dag
    const ex = state.extra, rec = S.recommendedStart(cur);
    $("exOn").checked = !!ex.on;
    let wopts = "";
    for (let n = Math.max(1, cur); n <= 28; n++) {
      if (!S.extraAllowed(WEEKS[n])) continue;
      wopts += opt(n, "Week " + n + " · vanaf " + dstr(WEEKS[n].mon) + (n === rec ? " (advies)" : ""), ex.fromWeek || rec);
    }
    $("exFrom").innerHTML = wopts;
    $("exDay").innerHTML = ["sat", "thu", "tue", "mon"].map(function (d) { return opt(d, S.EXTRA_DAYS[d].label.charAt(0).toUpperCase() + S.EXTRA_DAYS[d].label.slice(1) + (d === "sat" ? " (advies)" : ""), ex.day); }).join("");
    $("exMax").innerHTML = [45, 60, 75, 90, 120].map(function (m) { return opt(m, fmtH(m) + " uur" + (m === 90 ? " (advies)" : ""), ex.max); }).join("");
    ["exFrom", "exDay", "exMax"].forEach(function (id) { $(id).disabled = !ex.on; });
    const cfg = Object.assign({}, ex, { fromWeek: ex.fromWeek || rec });
    const adv = S.advice({ cur: cur, cfg: cfg, indoorMax: state.season.indoorMax, freeRides: freeRides() });
    $("exAdvice").innerHTML = adv.map(function (a) {
      return "<li class='adv " + a.level + "'><b>" + esc(a.title) + "</b>" + esc(a.text) + "</li>";
    }).join("");
    renderImpact(cur);
    renderLight(cur);
    renderWxNext();
  }

  // Uren per fase: het oorspronkelijke plan tegenover jouw instellingen
  function renderImpact(cur) {
    const rows = PHASES.filter(function (p) { return p.weeks[p.weeks.length - 1] >= cur && p.id !== "ev"; }).map(function (p) {
      const ws = p.weeks.filter(function (n) { return n >= cur; });
      let base = 0, mine = 0;
      ws.forEach(function (n) {
        base += WEEKS[n].sessions.reduce(function (a, s) { return a + minutes(s.w); }, 0);
        mine += weekMins(weekEff(WEEKS[n]).filter(function (e) { return !e.skip; }));
      });
      const diff = mine - base, k = ws.length;
      return "<tr><td>" + p.name + "<br><small class='sub'>week " + ws[0] + (k > 1 ? " tot " + ws[k - 1] : "") + "</small></td><td class='num'>" + fmtH(Math.round(base / k)) + "</td><td class='num'>" + fmtH(Math.round(mine / k)) + "</td><td class='num " + (diff < -30 * k ? "neg" : diff > 0 ? "pos" : "") + "'>" + (diff >= 0 ? "+" : "−") + fmtH(Math.round(Math.abs(diff) / k)) + "</td></tr>";
    }).join("");
    $("exImpact").innerHTML = "<table class='sched'><thead><tr><th>Fase</th><th>Plan per week</th><th>Met jouw keuzes</th><th>Verschil</th></tr></thead><tbody>" + rows + "</tbody></table>";
  }

  // Daglicht op zondag tegenover de geplande lange rit
  function renderLight(cur) {
    const ws = WEEKS.filter(function (wk) { return wk.n >= cur && wk.n <= 29; });
    const W = 720, H = 220, l = 34, r = 10, t = 14, b = 30, cw = W - l - r, ch = H - t - b, max = 16 * 60;
    const step = cw / ws.length, y = function (m) { return t + ch - m / max * ch; };
    let svg = "<svg viewBox='0 0 " + W + " " + H + "' role='img' aria-label='Daglicht op zondag tegenover de lange rit'>";
    [0, 4, 8, 12, 16].forEach(function (h) { svg += "<line x1='" + l + "' x2='" + (W - r) + "' y1='" + y(h * 60) + "' y2='" + y(h * 60) + "' class='grid'/><text x='" + (l - 6) + "' y='" + (y(h * 60) + 4) + "' text-anchor='end'>" + h + "u</text>"; });
    let pts = [], lastM = -1;
    ws.forEach(function (wk, i) {
      const sunS = wk.sessions.find(function (x) { return x.day === "sun"; });
      if (!sunS) return;
      const e = eff(sunS), planned = minutes(sunS.w), li = S.daylight(e.date);
      const x = l + i * step + step * 0.18, bw = step * 0.64;
      const cls = e.place && e.place.where === "binnen" ? "bin" : "bui";
      svg += "<rect x='" + x.toFixed(1) + "' y='" + y(planned).toFixed(1) + "' width='" + bw.toFixed(1) + "' height='" + (y(0) - y(planned)).toFixed(1) + "' class='" + cls + "'><title>Week " + wk.n + ", zondag " + dstr(e.date) + ": gepland " + fmtH(planned) + ", " + (cls === "bin" ? "binnen " + fmtH(minutes(e.w)) : "buiten") + ", rijlicht " + fmtH(li.usable) + "</title></rect>";
      pts.push((l + i * step + step / 2).toFixed(1) + "," + y(li.usable).toFixed(1));
      const m = new Date(e.date).getUTCMonth();
      if (m !== lastM) { svg += "<text x='" + (l + i * step + 2).toFixed(1) + "' y='" + (H - 10) + "'>" + MONTHS[m].slice(0, 3) + "</text>"; lastM = m; }
    });
    svg += "<polyline points='" + pts.join(" ") + "' class='light'/>";
    svg += "</svg>";
    $("lightChart").innerHTML = svg;
  }

  function renderWxNext() {
    const el = $("wxNext");
    const days = Object.keys(wx).sort().filter(function (d) { return d >= iso(todayUTC()); }).slice(0, 14);
    if (!days.length) { el.innerHTML = "<p class='sub'>Weersverwachting laden… Lukt dat niet, dan kiest de app op basis van het seizoen.</p>"; return; }
    el.innerHTML = "<div class='wxgrid'>" + days.map(function (d) {
      const t = Date.parse(d + "T00:00:00Z"), v = S.weatherVerdict(wx[d]), f = wx[d];
      const lvl = v.level === "slecht" ? "in" : v.level === "matig" ? "maybe" : "out";
      return "<div class='wxday " + lvl + "' title='" + esc(S.weatherLine(f) + (v.why ? ". " + v.why : "")) + "'><b>" + dshort(t) + "</b><span class='num'>" + Math.round(f.tmin) + "°/" + Math.round(f.tmax) + "°</span><span class='num'>" + String(Math.round((f.rain || 0) * 10) / 10).replace(".", ",") + " mm</span><span>" + (v.level === "slecht" ? "binnen" : v.level === "matig" ? "kan" : "buiten") + "</span></div>";
    }).join("") + "</div><p class='sub'>Bron: Open-Meteo, voor " + S.HOME.name + ". Bijgewerkt " + new Date(wxAt).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" }) + ".</p>";
  }

  // Weersverwachting ophalen, hooguit eens per drie uur
  const WX_LS = "alpe-wx-v1";
  function loadWxCache() { try { const c = JSON.parse(lsGet(WX_LS) || "null"); if (c && c.data) { wx = c.data; wxAt = c.at; } } catch (e) {} }
  async function loadWx() {
    if (Date.now() - wxAt < 3 * 3600000 && Object.keys(wx).length) return;
    try {
      const r = await fetch(S.FORECAST_URL);
      if (!r.ok) throw new Error();
      wx = S.parseForecast(await r.json()); wxAt = Date.now();
      lsSet(WX_LS, JSON.stringify({ at: wxAt, data: wx }));
      rematch(); renderAll();
    } catch (e) { renderWxNext(); }
  }

  $("inMax").addEventListener("change", function (e) { state.season.indoorMax = +e.target.value; save(); rematch(); renderAll(); toast("Binnenritten maximaal " + fmtH(state.season.indoorMax) + "."); });
  $("exOn").addEventListener("change", function (e) {
    state.extra.on = e.target.checked;
    if (state.extra.on && !state.extra.fromWeek) state.extra.fromWeek = S.recommendedStart(currentWeek());
    save(); rematch(); renderAll();
    toast(state.extra.on ? "Extra " + S.EXTRA_DAYS[state.extra.day].label + " vanaf week " + state.extra.fromWeek + "." : "Extra dag uit.");
  });
  $("exFrom").addEventListener("change", function (e) { state.extra.fromWeek = +e.target.value; save(); rematch(); renderAll(); });
  $("exDay").addEventListener("change", function (e) { state.extra.day = e.target.value; save(); rematch(); renderAll(); });
  $("exMax").addEventListener("change", function (e) { state.extra.max = +e.target.value; save(); rematch(); renderAll(); });

  // ---------- Alpe-rekenmodel ----------
  function climbMinutes(Pw, m) {
    const g = 9.81, Lm = 13800, H = 1071, th = Math.atan(H / Lm), crr = 0.005, cda = 0.40, rho = 1.1, pw = Pw * 0.975;
    let lo = 0.3, hi = 12;
    for (let i = 0; i < 60; i++) { const v = (lo + hi) / 2; const p = m * g * v * (Math.sin(th) + crr * Math.cos(th)) + 0.5 * rho * cda * v * v * v; if (p > pw) hi = v; else lo = v; }
    return Lm / lo / 60;
  }
  let cwTouched = false;
  function renderCalc() {
    if (!cwTouched) $("cw").value = Math.round(state.ftp * 0.72);
    const Pw = +$("cw").value, bk = +$("bk").value, n = +$("nc").value, dz = +$("dz").value, m = state.kg + bk;
    const t = climbMinutes(Pw, m), pct = Math.round(Pw / state.ftp * 100);
    $("cwOut").textContent = Pw + " W"; $("bkOut").textContent = String(bk).replace(".", ",") + " kg"; $("ncOut").textContent = n; $("dzOut").textContent = dz + " min";
    $("cTime").textContent = fmtH(t); $("cPct").textContent = pct + "%";
    $("cWkg").textContent = (Pw / state.kg).toFixed(2).replace(".", ",");
    $("cVam").textContent = Math.round(1071 / (t / 60));
    $("cTotal").textContent = fmtH(t * n); $("cDay").textContent = fmtH(t * n + dz * n);
    const v = $("cVerdict");
    let kc, txt;
    if (pct <= 70) { kc = "--k-duur"; txt = "Veilig tempo voor zes keer. Je houdt reserve voor hitte en de laatste twee klimmen."; }
    else if (pct <= 75) { kc = "--k-tempo"; txt = "Het doeltempo voor zes keer. Klim 1 en 2 aan de onderkant hiervan rijden."; }
    else if (pct <= 82) { kc = "--k-sst"; txt = "Haalbaar voor twee of drie klimmen. Voor zes keer is dit te hoog: grote kans dat klim 5 en 6 instorten."; }
    else { kc = "--k-drempel"; txt = "Dit is een tempo voor één klim, niet voor zes. Zakken."; }
    v.style.setProperty("--kc", cssVar(kc)); v.textContent = txt;
    drawRoad(t);
  }
  function drawRoad(t) {
    const W = 640, pad = 30;
    let s = "<svg viewBox='0 0 640 120' role='img' aria-label='Doortijden per bocht'>";
    s += "<line x1='" + pad + "' y1='70' x2='" + (W - pad) + "' y2='70' stroke='var(--line)' stroke-width='6' stroke-linecap='round'/>";
    const km = [1.9, 2.8, 3.4, 3.9, 4.6, 5.2, 5.7, 6.2, 6.6, 7.0, 7.5, 7.9, 8.4, 8.9, 9.6, 10.1, 10.7, 11.3, 11.9, 12.4, 12.9];
    km.forEach(function (k, i) {
      const x = pad + (W - 2 * pad) * k / 13.8, bocht = 21 - i;
      s += "<circle cx='" + x.toFixed(1) + "' cy='70' r='3' fill='var(--muted)'/>";
      if (bocht === 21 || bocht === 16 || bocht === 11 || bocht === 6 || bocht === 1) {
        s += "<rect x='" + (x - 13).toFixed(1) + "' y='34' width='26' height='18' rx='3' fill='var(--sign)'/><text x='" + x.toFixed(1) + "' y='47' text-anchor='middle' style='fill:var(--sign-ink);font-weight:500'>" + bocht + "</text>";
        s += "<text x='" + x.toFixed(1) + "' y='96' text-anchor='middle'>" + fmtH(t * k / 13.8) + "</text>";
      }
    });
    s += "<text class='lbl' x='" + pad + "' y='20'>Bourg-d'Oisans</text><text class='lbl' x='" + (W - pad) + "' y='20' text-anchor='end'>Huez · " + fmtH(t) + "</text>";
    s += "<text x='" + pad + "' y='114'>0 km</text><text x='" + (W - pad) + "' y='114' text-anchor='end'>13,8 km</text></svg>";
    $("road").innerHTML = s;
  }

  // ---------- Strava ----------
  const inFrame = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();
  function renderStravaBar() {
    const st = $("stravaState");
    const cb = $("connectBtn"), on = !!(me && me.connected);
    cb.hidden = !me;
    cb.classList.toggle("connected", on);
    cb.classList.toggle("primary", !on);
    if (on) { cb.removeAttribute("href"); cb.setAttribute("aria-disabled", "true"); cb.textContent = "✓ Verbonden met Strava"; cb.title = "Strava is gekoppeld" + (me.firstname ? " (" + me.firstname + ")" : ""); }
    else {
      cb.setAttribute("href", "/api/auth/start"); cb.removeAttribute("aria-disabled"); cb.textContent = "Koppel Strava"; cb.title = "";
      // Strava laat zijn inlogpagina niet in een frame zien; open dan een nieuw tabblad.
      if (inFrame) { cb.target = "_blank"; cb.rel = "noopener"; } else { cb.removeAttribute("target"); cb.removeAttribute("rel"); }
    }
    $("syncBtn").hidden = !(me && me.connected);
    $("logoutBtn").hidden = !(me && me.connected);
    const ap = $("ftpApply");
    if (!me) { st.textContent = "Strava-status laden…"; ap.hidden = true; return; }
    if (!me.connected) {
      st.textContent = me.offline ? "Geen verbinding met de server. Je plan werkt gewoon; koppelen kan zodra je online bent." : "Koppel Strava, dan worden ritten automatisch gekoppeld aan de training van dezelfde dag.";
      ap.hidden = true; return;
    }
    const linked = Object.keys(matches).filter(function (k) { return matches[k] && matches[k].act; }).length;
    st.textContent = "Strava: " + (me.firstname || "gekoppeld") + (lastSync ? " · " + acts.length + " ritten (12 mnd historie), " + linked + " gekoppeld · " + String(lastSync.getHours()).padStart(2, "0") + ":" + String(lastSync.getMinutes()).padStart(2, "0") : " · ritten ophalen…");
    if (me.ftp && me.ftp !== state.ftp) { ap.hidden = false; ap.textContent = "FTP uit Strava overnemen (" + me.ftp + " W)"; }
    else ap.hidden = true;
  }

  function rematch() {
    const ses = [];
    WEEKS.forEach(function (wk) {
      weekSessions(wk).forEach(function (s) { const e = eff(s); if (!e.skip && e.w.kind !== "event") ses.push({ id: e.id, date: e.date, w: e.w }); });
    });
    matches = acts.length ? L.match(ses, acts, { hists: hists, ftp: state.ftp, links: state.links, unlinks: state.unlinks }) : {};
  }

  async function api(path, opts) {
    const r = await fetch(path, Object.assign({ credentials: "same-origin" }, opts || {}));
    let body = null; try { body = await r.json(); } catch (e) {}
    if (!r.ok) throw Object.assign(new Error((body && body.error) || "Serverfout " + r.status), { status: r.status });
    return body;
  }

  // Ritten uit de vorige synchronisatie, zodat historie en koppelingen direct zichtbaar zijn.
  function loadActsCache() {
    try {
      const raw = lsGet(ACTS_LS); if (!raw) return;
      const c = JSON.parse(raw);
      if (c && Array.isArray(c.acts)) { acts = c.acts; cachedSync = c.at ? new Date(c.at) : null; }
    } catch (e) {}
  }
  function loadHistCache() {
    try { const raw = lsGet("alpe-hists-v1"); if (raw) hists = JSON.parse(raw) || {}; } catch (e) { hists = {}; }
  }
  function saveHistCache() { lsSet("alpe-hists-v1", JSON.stringify(hists)); }

  async function syncStrava() {
    if (!me || !me.connected) return;
    $("syncBtn").disabled = true;
    try {
      const after = Math.floor((HIST_START - DAY) / 1000);
      const data = await api("/api/activities?after=" + after);
      acts = (data.activities || []).filter(function (a) { const t = actTime(a); return t >= HIST_START && t <= EVENT + 7 * DAY; });
      acts.sort(function (x, y) { return String(y.start || y.date).localeCompare(String(x.start || x.date)); });
      lastSync = new Date();
      lsSet(ACTS_LS, JSON.stringify({ at: lastSync.getTime(), acts: acts }));
      rematch(); renderAll();
      // vermogensverdeling ophalen voor ritten in de planperiode met vermogen (max 30 per keer, cache op dit apparaat)
      const todo = acts.filter(function (a) { return actTime(a) >= START && (a.power || a.avgW) && !hists[a.id]; }).slice(0, 30);
      for (let i = 0; i < todo.length; i++) {
        try { hists[todo[i].id] = await api("/api/streams?id=" + encodeURIComponent(todo[i].id)); }
        catch (e) { if (e.status === 429) { toast("Strava-limiet bereikt; de rest volgt later."); break; } }
      }
      if (todo.length) { saveHistCache(); rematch(); renderAll(); }
    } catch (e) {
      if (e.status === 401) { me = { connected: false }; toast("Strava-koppeling verlopen. Koppel opnieuw."); }
      else toast(e.message || "Ritten ophalen lukte niet.");
      renderStravaBar();
    } finally { $("syncBtn").disabled = false; }
  }

  async function loadCloudState() {
    try {
      const r = await api("/api/state");
      const remote = r && r.state;
      if (remote && (remote.updatedAt || 0) > (state.updatedAt || 0)) {
        state = normalize(remote);
        lsSet(LS, JSON.stringify(state));
        syncInputs(); rematch(); renderAll();
      } else if (!remote || (state.updatedAt || 0) > (remote.updatedAt || 0)) {
        save();
      }
    } catch (e) {}
  }

  // ---------- routing ----------
  function route() {
    const h = (location.hash || "#week").slice(1);
    const v = ["week", "schema", "indeling", "alpe"].indexOf(h) >= 0 ? h : "week";
    ["week", "schema", "indeling", "alpe"].forEach(function (x) { $("v-" + x).hidden = x !== v; });
    document.querySelectorAll("nav.tabs a").forEach(function (a) { if (a.dataset.view === v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    renderAll();
  }
  function renderAll() {
    $("daysLeft").textContent = Math.max(0, Math.round((EVENT - todayUTC()) / DAY));
    renderStrip(); renderWeek(); renderSchema(); renderSetup(); renderCalc(); renderStravaBar();
  }
  window.addEventListener("hashchange", function () { route(); window.scrollTo(0, 0); });

  // ---------- invoer ----------
  function syncInputs() { $("ftp").value = state.ftp; $("kg").value = state.kg; }
  $("ftp").addEventListener("change", function (e) {
    const v = Math.round(+e.target.value);
    if (v >= 120 && v <= 450) { state.ftp = v; save(); rematch(); renderAll(); toast("FTP " + v + " W: alle wattages zijn bijgewerkt."); }
    else { e.target.value = state.ftp; toast("Vul een FTP tussen 120 en 450 W in."); }
  });
  $("kg").addEventListener("change", function (e) { const v = +e.target.value; if (v >= 45 && v <= 140) { state.kg = v; save(); renderAll(); } else e.target.value = state.kg; });
  $("prevWk").addEventListener("click", function () { if (selWeek > 0) { selWeek--; openPanel = null; renderAll(); } });
  $("nextWk").addEventListener("click", function () { if (selWeek < 30) { selWeek++; openPanel = null; renderAll(); } });
  $("todayWk").addEventListener("click", function () { selWeek = currentWeek(); openPanel = null; renderAll(); });
  ["cw", "bk", "nc", "dz"].forEach(function (id) { $(id).addEventListener("input", function () { if (id === "cw") cwTouched = true; renderCalc(); }); });
  $("syncBtn").addEventListener("click", syncStrava);
  $("ftpApply").addEventListener("click", function () {
    if (!me || !me.ftp) return;
    state.ftp = me.ftp; syncInputs(); save(); rematch(); renderAll(); toast("FTP " + me.ftp + " W: alle wattages zijn bijgewerkt.");
  });
  $("logoutBtn").addEventListener("click", async function () {
    try { await api("/api/auth/logout", { method: "POST" }); } catch (e) {}
    me = { connected: false }; acts = []; matches = {}; lastSync = null; cachedSync = null;
    try { localStorage.removeItem(ACTS_LS); } catch (e) {}
    renderAll();
    toast("Strava ontkoppeld op dit apparaat.");
  });

  // ---------- start ----------
  loadHistCache();
  loadWxCache();
  syncInputs(); route();
  loadWx();
  (async function () {
    const qs = new URLSearchParams(location.search), back = qs.get("strava"), reason = qs.get("reason");
    if (back) { qs.delete("strava"); qs.delete("reason"); history.replaceState(null, "", location.pathname + (qs.toString() ? "?" + qs : "") + location.hash); }
    try { me = await api("/api/me"); }
    catch (e) { me = { connected: false, offline: true }; }
    renderStravaBar();
    if (back === "ok") toast(me.connected ? "Strava is gekoppeld" + (me.firstname ? ", " + me.firstname : "") + "." : "Koppelen is niet gelukt. Probeer het opnieuw.");
    else if (back === "denied") toast("Koppelen geannuleerd op Strava.");
    else if (back === "error") toast({
      state: "Koppelen verlopen of onderbroken. Klik opnieuw op Koppel Strava.",
      scope: "Zet het vinkje bij 'Bekijk gegevens over je activiteiten' aan en koppel opnieuw.",
      token: "Strava weigerde de koppeling. Controleer Client ID en Client Secret in Netlify."
    }[reason] || "Koppelen is niet gelukt. Probeer het opnieuw.");
    if (me.connected) {
      loadActsCache();
      if (acts.length) { lastSync = cachedSync; rematch(); renderAll(); }
      await loadCloudState();
      await syncStrava();
    }
  })();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); });
  }
})();
