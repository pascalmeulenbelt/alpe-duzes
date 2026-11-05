/* Alpe d'HuZes trainingsplan: plandefinitie, gedeeld door app en tests */
(function (g) {
  "use strict";
  // ---------- plan definition ----------
  const DAY = 86400000;
  const START = Date.UTC(2026, 10, 2); // maandag 2 nov 2026 = week 0
  const EVENT = Date.UTC(2027, 5, 3);
  const MONTHS = ["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"];
  const DAYN = { wed: ["Wo", 2], fri: ["Vr", 4], sun: ["Zo", 6], thu: ["Do", 3] };
  const KIND = {
    herstel: ["Herstel", "--k-herstel"], duur: ["Duur", "--k-duur"], tempo: ["Tempo", "--k-tempo"],
    sst: ["Sweet spot", "--k-sst"], drempel: ["Drempel", "--k-drempel"], vo2: ["VO2max", "--k-vo2"],
    test: ["Test", "--k-test"], event: ["Alpe d'HuZes", "--k-event"]
  };
  function stepKind(lo) { if (lo == null) return "test"; if (lo < 56) return "herstel"; if (lo < 76) return "duur"; if (lo < 86) return "tempo"; if (lo < 94) return "sst"; if (lo < 106) return "drempel"; return "vo2"; }

  // step: [min, lo%, hi%, label, sub]
  const WU = (m) => [m || 15, 50, 68, "Opwarmen", "Laatste 3 min oplopen naar tempo"];
  const CD = (m) => [m || 10, 45, 55, "Uitrijden", ""];
  function intervals(total, n, on, lo, hi, off, label, rpm, kind, note) {
    const s = [WU()];
    for (let i = 0; i < n; i++) { s.push([on, lo, hi, n > 1 ? label + " " + (i + 1) + "/" + n : label, rpm]); if (i < n - 1 && off) s.push([off, 50, 60, "Herstel", "Licht doortrappen"]); }
    const used = s.reduce((a, x) => a + x[0], 0) + 10;
    if (total - used >= 5) s.push([total - used, 65, 72, "Zone 2", "Rustig, cadans 85+"]);
    s.push(CD());
    return { kind, steps: s, note, rpm };
  }
  function z2(total, note, lo, hi) {
    return { kind: "duur", steps: [[10, 50, 62, "Inrijden", ""], [total - 15, lo || 65, hi || 72, "Zone 2", "Hartslag onder 145"], [5, 45, 55, "Uitrijden", ""]], note: note || "Echte zone 2. Als het te makkelijk voelt, doe je het goed." };
  }
  function easy(total) { return { kind: "herstel", steps: [[total, 45, 58, "Herstelrit", "Lichte versnelling, 90 rpm"]], note: "Alleen bloed laten stromen. Geen klimmetjes, geen tempo." }; }
  function hz2(total) {
    return { kind: "duur", steps: [[10, 50, 65, "Inrijden", ""], [total - 25, 70, 75, "Hoge zone 2", "Net onder je ademgrens, praten kan nog. 85 tot 90 rpm"], [10, 76, 80, "Afsluiter", "Iets steviger, nog steeds gecontroleerd"], [5, 45, 55, "Uitrijden", ""]],
      note: "Zone 2 zoals San Millán het Pogačar laat rijden: lang aan de bovenkant van zone 2, en pas aan het eind iets steviger. Op Zwift in ERG-modus, ventilator aan, geen groepsrit." };
  }
  function drills(total, n, m) {
    const s = [[10, 50, 65, "Inrijden", ""]];
    for (let i = 0; i < n; i++) { s.push([m, 68, 75, "Hoge cadans " + (i + 1) + "/" + n, "100 tot 105 rpm, rustig bovenlijf"]); s.push([3, 62, 70, "Zone 2", "Normale cadans"]); }
    const used = s.reduce((a, x) => a + x[0], 0) + 5;
    if (total - used > 0) s.push([total - used, 65, 72, "Zone 2", "85 tot 90 rpm"]);
    s.push([5, 45, 55, "Uitrijden", ""]);
    return { kind: "duur", steps: s, note: "Cadanswerk. Trap rond, niet stampen. Dit is de basis voor soepel klimmen in juni." };
  }
  function test20() {
    return { kind: "test", steps: [[15, 50, 70, "Opwarmen", ""], [5, 105, 110, "Openen", "Hard maar niet stuk"], [10, 50, 60, "Rustig", ""], [20, null, null, "20 minuten maximaal", "Start iets voorzichtig, laatste 5 min alles"], [15, 45, 55, "Uitrijden", ""]],
      note: "Nieuwe FTP = 95% van je gemiddelde over de 20 minuten. Vul hem bovenin in. Liefst indoor of op een vlakke, rustige weg." };
  }
  function long(hours, blocks, note) {
    const total = Math.round(hours * 60);
    const s = [[45, 60, 70, "Inrijden en zone 2", ""]];
    (blocks || []).forEach(function (b) {
      for (let i = 0; i < b[0]; i++) { s.push([b[1], b[2], b[3], b[4] + (b[0] > 1 ? " " + (i + 1) + "/" + b[0] : ""), b[5] || ""]); s.push([15, 62, 70, "Zone 2", "Eten en drinken"]); }
    });
    const used = s.reduce((a, x) => a + x[0], 0) + 15;
    if (total - used > 0) s.push([total - used, 65, 72, "Zone 2", "Hartslag onder 145"]);
    s.push([15, 50, 60, "Rustig naar huis", ""]);
    return { kind: blocks && blocks.length ? (blocks[0][2] >= 76 ? "tempo" : "duur") : "duur", steps: s, note: note || "Lange duurrit. Elke 20 minuten eten, elk kwartier drinken." };
  }
  const SST = (t, n, on, off, lo, hi) => intervals(t, n, on, lo || 88, hi || 92, off, "Sweet spot", "85 tot 90 rpm", "sst", "Lange blokken net onder je drempel met kort herstel, zoals Van der Poel ze opbouwde. Comfortabel zwaar, gelijkmatig, geen pieken.");
  const THR = (t, n, on, off, lo, hi, note) => intervals(t, n, on, lo || 94, hi || 98, off, "Drempel", "85 tot 90 rpm", "drempel", note || "Op je randje, maar onder controle. Laatste blok even sterk als het eerste.");
  const TMP = (t, n, on, off, lo, hi, rpm) => intervals(t, n, on, lo || 76, hi || 85, off, "Tempo", rpm || "80 tot 85 rpm", "tempo", "Stevig doorrijden. Dit is het tempo waar je straks lang op moet kunnen leven.");
  const CLIMB = (t, n, on, off, lo, hi, label) => intervals(t, n, on, lo, hi, off, label || "Klimblok", "80 tot 85 rpm, zittend", "sst", "Klimsimulatie. Indoor: zet Zwift op een helling van 6 tot 8% of gebruik ERG. Zittend, rustig bovenlijf, hoge cadans.");

  const PHASES = [
    { id: "instap", name: "Instap", weeks: [0], text: "Twee ritten om je zones te leren voelen voordat het plan begint." },
    { id: "b1", name: "Basis 1", weeks: [1, 2, 3, 4], text: "Je basis staat al: sinds augustus rijd je 4 à 5 uur per week, met drempelwerk en zondagen van 2,5 uur. We beginnen op dat niveau. Drempelblokken naar 2×20, zondag naar 3,5 uur, de rest strikt zone 2." },
    { id: "b2", name: "Basis 2", weeks: [5, 6, 7, 8], text: "Drempelblokken verlengen naar 2×30 met kort herstel. Zondag naar 4 uur. Al het andere is zone 2." },
    { id: "o1", name: "Opbouw 1", weeks: [9, 10, 11, 12], text: "Eén lange drempelsessie per week duwt je FTP omhoog. Vrijdag en zondag zone 2. Voeding trainen op de lange rit." },
    { id: "o2", name: "Opbouw 2", weeks: [13, 14, 15, 16], text: "Blokken van 20 tot 25 minuten net onder je drempel, Van der Poel-stijl. Zondag naar 4,5 uur, eerste Alpe-tempo." },
    { id: "k1", name: "Klimkracht 1", weeks: [17, 18, 19, 20], text: "Lange blokken op klimtempo met hoge cadans. Woensdag op Zwift, zondag heuvels (Holterberg, Lemelerberg) of Alpe du Zwift." },
    { id: "k2", name: "Klimkracht 2", weeks: [21, 22, 23, 24], text: "Een uur aan een stuk onder spanning. Zondag naar 5,5 uur met meerdere klimblokken." },
    { id: "sp", name: "Specifiek", weeks: [25, 26, 27, 28], text: "Alpe-tempo oefenen, generale repetitie van 6,5 uur met volledige voeding." },
    { id: "tp", name: "Taper", weeks: [29], text: "Volume omlaag, prikkel blijft. Fris aan de start komen." },
    { id: "ev", name: "Alpe", weeks: [30], text: "De week van de waarheid." }
  ];
  const REC = { 4: 1, 8: 1, 12: 1, 16: 1, 20: 1, 24: 1 };
  const FOCUS = {
    0: "Laat zien dat je rustig kunt rijden. Twee ritten, hartslag onder 145. Dat is de hele opdracht.",
    1: "Je instapniveau: 3×12 op je drempel, net als je 2×12 en 4×8 van de afgelopen weken. Nieuw is dat de rest echt zone 2 wordt.",
    4: "Herstelweek. Minder is meer. Slaap goed.",
    7: "Kerstweek. Pak de lange zondag als cadeau, maar niet harder dan zone 2.",
    8: "Herstelweek. Laat de basis landen.",
    9: "Nieuw blok: drempelwerk. Vanaf nu eet je 60 g koolhydraten per uur op de lange rit. Haal je FTP even op uit Strava.",
    12: "Herstelweek.",
    14: "Twee keer 25 minuten net onder je drempel. Dit is de kern van het blok.",
    16: "Herstelweek. Check je fiets: cassette 32 of 34 achter bestellen als dat nog niet is gebeurd.",
    17: "De bergen in. Zoek de Holterberg en Lemelerberg op of rij Alpe du Zwift. Haal je FTP even op uit Strava.",
    20: "Herstelweek.",
    22: "Woensdag een uur aan een stuk. Precies zo voelt een Alpe-klim.",
    24: "Herstelweek. De zwaarste weken komen eraan.",
    25: "Laatste blok. Je FTP van nu bepaalt je klimtempo in juni, dus haal hem op uit Strava en check het rekenmodel.",
    27: "Generale repetitie. Zondag alles zoals op 3 juni: kleding, voeding, tempo.",
    28: "Iets minder volume, scherpte houden.",
    29: "Taper. Je voelt je misschien traag; dat is normaal. Niets extra doen.",
    30: "Klim 1 en 2 voelen te makkelijk. Precies goed. Rij op vermogen, niet op gevoel."
  };

  const PLAN = {
    0: { fri: z2(60, "Inrijrit op Zwift. Kijk alleen naar hartslag en vermogen, niet naar snelheid."), sun: long(2.5, null, "Tweeënhalf uur strikt zone 2. Lukt dat zonder boven 145 te komen, dan is het plan klaar om te beginnen.") },
    1: { wed: THR(90, 3, 12, 3, 94, 98), fri: drills(80, 5, 2), sun: long(3) },
    2: { wed: THR(90, 3, 15, 3, 93, 97), fri: hz2(85), sun: long(3.25) },
    3: { wed: THR(90, 2, 20, 4, 95, 99), fri: drills(90, 6, 3), sun: long(3.5) },
    4: { wed: z2(60), fri: easy(45), sun: long(2.5) },
    5: { wed: THR(90, 3, 15, 3, 96, 100), fri: hz2(90), sun: long(3.5) },
    6: { wed: SST(90, 2, 30, 5, 90, 94), fri: drills(90, 5, 3), sun: long(3.75) },
    7: { wed: THR(90, 4, 12, 3, 96, 100), fri: hz2(90), sun: long(4, null, "Kerstweek. Lange rit puur zone 2. Dit is waar Pogačar zijn winter mee vult.") },
    8: { wed: z2(60), fri: easy(45), sun: long(2.5) },
    9: { wed: THR(90, 2, 25, 4, 95, 99), fri: hz2(90), sun: long(4, null, "Eerste rit met voedingsdoel: 60 g koolhydraten per uur. Noteer wat je at en hoe het ging.") },
    10: { wed: THR(90, 3, 20, 3, 94, 98), fri: hz2(90), sun: long(4.25) },
    11: { wed: THR(90, 4, 12, 3, 98, 102), fri: hz2(90), sun: long(4.5) },
    12: { wed: z2(60), fri: easy(45), sun: long(3) },
    13: { wed: THR(90, 2, 30, 5, 93, 97), fri: hz2(90), sun: long(4.5) },
    14: { wed: THR(90, 3, 20, 3, 96, 100, "Van der Poel-stijl: lang en op je drempel, kort herstel. Laatste blok even sterk als het eerste."), fri: hz2(90), sun: long(4.75) },
    15: { wed: SST(90, 1, 50, 0, 90, 93), fri: hz2(90), sun: long(5, [[2, 30, 72, 76, "Alpe-tempo", "80 tot 85 rpm"]], "Eerste kennismaking met Alpe-tempo: bovenkant zone 2, cadans omhoog.") },
    16: { wed: z2(60), fri: easy(45), sun: long(3) },
    17: { wed: CLIMB(90, 2, 30, 5, 90, 94), fri: hz2(90), sun: long(5, [[3, 20, 74, 78, "Klimwerk", "80 tot 85 rpm, zittend"]], "Zoek de heuvels op: herhalingen Holterberg en Lemelerberg tellen als klimwerk.") },
    18: { wed: CLIMB(90, 3, 20, 3, 94, 98), fri: hz2(90), sun: long(5, [[1, 75, 72, 76, "Lange klim op Alpe-tempo", "80 tot 85 rpm, zittend"]], "Eén volledige klim van ruim een uur. Alpe du Zwift is ideaal: 12 km aan 8,5%.") },
    19: { wed: CLIMB(90, 1, 60, 0, 86, 90, "Uurblok"), fri: hz2(90), sun: long(5.25, [[2, 40, 72, 77, "Alpe-tempo", "80 tot 85 rpm"]]) },
    20: { wed: z2(60), fri: easy(45), sun: long(3) },
    21: { wed: CLIMB(90, 2, 30, 5, 92, 96), fri: hz2(90), sun: long(5.25, [[2, 45, 72, 77, "Alpe-tempo", "80 tot 85 rpm"]]) },
    22: { wed: CLIMB(90, 1, 60, 0, 88, 92, "Uurblok"), fri: hz2(90), sun: long(5.5, [[2, 60, 72, 77, "Alpe-tempo", "80 tot 85 rpm"]], "Twee keer een uur op Alpe-tempo, met voeding zoals op de dag zelf: 80 g per uur.") },
    23: { wed: CLIMB(90, 3, 20, 3, 95, 99), fri: hz2(90), sun: long(5.75, [[3, 40, 72, 77, "Alpe-tempo", "80 tot 85 rpm"]]) },
    24: { wed: z2(60), fri: easy(45), sun: long(3) },
    25: { wed: CLIMB(90, 3, 20, 3, 90, 94), fri: intervals(90, 1, 65, 72, 76, 0, "Alpe-tempo", "80 tot 85 rpm", "duur", "Precies het vermogen van 3 juni. Leer hoe het voelt, en hoe het voelt na een uur."), sun: long(5.5, [[3, 45, 72, 76, "Alpe-tempo", "80 tot 85 rpm"]]) },
    26: { wed: CLIMB(90, 2, 30, 5, 90, 94), fri: intervals(90, 1, 65, 72, 76, 0, "Alpe-tempo", "80 tot 85 rpm", "duur", "Alpe-tempo, gelijkmatig."), sun: long(6, [[4, 45, 72, 76, "Alpe-tempo", "80 tot 85 rpm"]], "Zes uur met vier Alpe-blokken. Voeding 80 tot 90 g per uur.") },
    27: { wed: CLIMB(90, 1, 65, 0, 80, 84, "Klimsimulatie"), fri: z2(75), sun: long(6.5, [[5, 45, 72, 76, "Alpe-tempo", "80 tot 85 rpm"]], "Generale repetitie. Zelfde ontbijt, kleding, bidons en voeding als op 3 juni. Evalueer na afloop: wat moet anders?") },
    28: { wed: CLIMB(90, 2, 20, 5, 90, 94), fri: z2(75), sun: long(4, [[2, 30, 72, 76, "Alpe-tempo", "80 tot 85 rpm"]]) },
    29: { wed: SST(75, 3, 10, 3), fri: drills(60, 3, 1), sun: long(2, [[3, 5, 85, 88, "Prikkel", "85 tot 90 rpm"]], "Kort en fris. Ben je moe, rij dan alleen zone 2.") },
    30: {
      wed: { kind: "herstel", steps: [[10, 50, 60, "Inrijden", ""], [3, 85, 90, "Prikkel 1/3", "90 rpm"], [3, 50, 60, "Rustig", ""], [3, 85, 90, "Prikkel 2/3", ""], [3, 50, 60, "Rustig", ""], [3, 85, 90, "Prikkel 3/3", ""], [10, 45, 55, "Uitrijden", ""]], note: "Benen losmaken in Bourg-d'Oisans. Niet de Alpe op. Vroeg eten, vroeg slapen." },
      thu: { kind: "event", steps: [[100, 68, 72, "Klim 1 en 2", "Bewust rustig, hartslag max 150"], [100, 70, 74, "Klim 3 en 4", "Zelfde tempo blijven rijden"], [100, 70, 76, "Klim 5 en 6", "Wat over is mag eruit"]], note: "In warmte en op hoogte haal je op dezelfde hartslag tot 10% minder vermogen. Valt je wattage weg terwijl je hartslag oploopt, ga dan op hartslag rijden en accepteer het lagere getal. Per klim eten op de afdaling en in Bourg: 80 tot 90 g koolhydraten en 500 tot 750 ml drinken per uur. Jas aan bij elke afdaling. Rij voor wie je rijdt.", title: "6× Alpe d'Huez", fixedMin: 13 * 60 }
    }
  };
  const TITLES = { test: "FTP-test", herstel: "Herstelrit", duur: "Duurrit", tempo: "Tempo", sst: "Sweet spot", drempel: "Drempel", vo2: "VO2max", event: "Alpe d'HuZes" };
  function titleOf(w, day) {
    if (w.title) return w.title;
    const main = w.steps.filter(function (s) { return s[3] !== "Opwarmen" && s[3] !== "Uitrijden" && !/Herstel$|^Zone 2$|^Inrijden|^Rustig/.test(s[3]); });
    if (day === "sun") {
      const h = minutes(w) / 60; const hh = fmtH(minutes(w));
      const bl = main.filter(function (s) { return s[1] >= 70 && s[0] < 100; });
      if (!bl.length) return "Lange rit " + hh;
      const n = bl.length, m = bl[0][0], lbl = bl[0][3].replace(/ \d+\/\d+$/, "");
      return "Lange rit " + hh + " · " + (n > 1 ? n + "×" : "") + m + "′ " + lbl.toLowerCase();
    }
    if (w.kind === "test") return "FTP-test 20 min";
    if (w.kind === "herstel") return "Herstelrit " + minutes(w) + "′";
    if (w.steps.some(function (x) { return x[3] === "Hoge zone 2"; })) return "Hoge zone 2 · " + minutes(w) + "′";
    const bl = main.filter(function (s) { return /\d+\/\d+$|blok|Uurblok|simulatie|Alpe-tempo|Klimtempo|Tempo|Sweet|Drempel|VO2/.test(s[3]) && !/Hoge cadans/.test(s[3]); });
    if (/Hoge cadans/.test(JSON.stringify(w.steps))) { const c = w.steps.filter(function (s) { return /Hoge cadans/.test(s[3]); }); return "Duur + " + c.length + "×" + c[0][0] + "′ hoge cadans"; }
    if (!bl.length) return "Duurrit " + minutes(w) + "′";
    const lbl = bl[0][3].replace(/ \d+\/\d+$/, "");
    return (bl.length > 1 ? bl.length + "×" : "") + bl[0][0] + "′ " + lbl.toLowerCase();
  }
  const ZWIFT_END = Date.UTC(2027, 3, 1);
  function lowShare(list) {
    let lo = 0, all = 0;
    list.forEach(function (w) { if (w.kind === "event") return; w.steps.forEach(function (st) { all += st[0]; if (st[1] != null && st[1] < 76) lo += st[0]; }); });
    return all ? Math.round(lo / all * 100) : null;
  }
  function minutes(w) { return w.fixedMin || w.steps.reduce(function (a, s) { return a + s[0]; }, 0); }
  function fmtH(m) { return Math.floor(m / 60) + ":" + String(Math.round(m % 60)).padStart(2, "0"); }

  const WEEKS = [];
  for (let i = 0; i <= 30; i++) {
    const mon = START + i * 7 * DAY;
    const phase = PHASES.find(function (p) { return p.weeks.indexOf(i) >= 0; });
    const sessions = [];
    ["wed", "thu", "fri", "sun"].forEach(function (d) {
      const w = PLAN[i][d]; if (!w) return;
      sessions.push({ id: "w" + i + d, week: i, day: d, date: mon + DAYN[d][1] * DAY, w: w, title: titleOf(w, d) });
    });
    WEEKS.push({ n: i, mon: mon, phase: phase, rec: !!REC[i], sessions: sessions, low: i === 30 ? null : lowShare(sessions.map(function (x) { return x.w; })), mins: sessions.reduce(function (a, s) { return a + minutes(s.w); }, 0) });
  }


  g.AlpePlan = { DAY, START, EVENT, MONTHS, DAYN, KIND, TITLES, stepKind, PHASES, REC, FOCUS, PLAN, WEEKS, ZWIFT_END,
    minutes, fmtH, titleOf, hz2, z2, lowShare, intervals };
})(typeof window !== "undefined" ? window : globalThis);
