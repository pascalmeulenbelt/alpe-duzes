# Alpe d'HuZes Trainingsplan

Persoonlijke trainingsapp naar 6× Alpe d'Huez op 3 juni 2027. Draait op Netlify, koppelt met Strava en is op je telefoon te installeren als app.

## Wat de app doet

- 30 weken plan met wattages op basis van je FTP (bovenin aan te passen).
- **Lukt niet?** per training: minder tijd, andere dag in dezelfde week, of overslaan. Bij minder tijd past de app de training aan: werkblokken gaan voor, zone 2 wordt korter. Is de tijd te kort voor de opbouw, dan wordt het een rit op hoge zone 2.
- **Strava-koppeling**: een rit wordt automatisch gekoppeld aan de training van dezelfde datum (de geplande dag, of de dag waarnaar je de training verplaatst hebt).
- **Naar Zwift**: elke training is te downloaden als Zwift-trainingsbestand (.zwo), zoals hij op dat moment staat (ook ingekort). Zet het in `Documenten/Zwift/Workouts/<je Zwift-id>/` en hij staat in Zwift onder *Custom Workouts*. Zwift heeft geen openbare API, dus rechtstreeks in je profiel zetten kan niet.
- **intervals.icu → Zwift**: met de knop **Week naar intervals.icu** zet de app de trainingen van die week (vanaf vandaag) in je intervals.icu-kalender. intervals.icu zet ze via de officiële Zwift-koppeling in Zwift onder *Workouts → Custom → Intervals.icu*. Pas je een verstuurde training aan of sla je hem over, dan werkt de app intervals.icu meteen bij. Polarized.cc heeft geen openbare API, daarom loopt dit via intervals.icu.
- **Historie**: de app haalt de ritten van de 12 maanden vóór het plan op en toont per week je gereden uren, naast de weken van het plan.
- Voortgang wordt per Strava-account opgeslagen, dus telefoon en laptop tonen hetzelfde.

### Koppelen en overeenkomst

- Alleen ritten op **dezelfde datum** als een training worden automatisch gekoppeld. Meerdere ritten op die dag? Dan gaat de best passende voor.
- Een rit op een vrije dag in dezelfde week verschijnt als suggestie met de knop **Toch koppelen**, en onder *Losse ritten deze week*. Hij telt wel mee in je gereden uren.
- Elke rit wordt maar aan één training gekoppeld. Een koppeling kun je ongedaan maken met **Ontkoppel**.

Bij elke koppeling staat hoe goed de rit overeenkomt met de training:

| Onderdeel | Weging | Wat het meet |
|---|---|---|
| Duur | 40% | Rijtijd van de rit tegenover de geplande duur |
| Zones | 60% | Hoeveel van je trapseconden in dezelfde vermogenszones vallen als gepland (zones op basis van je FTP; freewheelen telt niet mee) |

- Geen vermogensdata in de rit? Dan telt het gemiddelde vermogen tegenover de geplande gemiddelde intensiteit.
- Geen vermogen bekend? Dan alleen de duur, met maximaal 85% score.

## Installeren

### 1. Strava API-app aanmaken

1. Ga naar <https://www.strava.com/settings/api> en maak een app aan.
2. Vul in:
   - **Application Name**: bijvoorbeeld *Alpe Plan*
   - **Category**: Training
   - **Website**: je Netlify-adres (mag je later aanpassen)
   - **Authorization Callback Domain**: alleen het domein, zonder `https://`, bijvoorbeeld `alpe-pascal.netlify.app`
3. Noteer de **Client ID** en het **Client Secret**.

### 2. Op Netlify zetten

De app gebruikt serverfuncties, dus **slepen naar Netlify Drop werkt niet**. Kies één van deze twee manieren.

**Via GitHub (aanbevolen)**
1. Zet deze map in een (privé) GitHub-repository.
2. Netlify → *Add new site* → *Import an existing project* → kies de repository.
3. Build-instellingen laat je leeg; `netlify.toml` regelt alles.

**Via de Netlify CLI**
```bash
npm install
npx netlify-cli login
npx netlify-cli init        # nieuwe site aanmaken
npx netlify-cli deploy --prod
```

### 3. Omgevingsvariabelen instellen

Netlify → je site → *Site configuration* → *Environment variables*:

| Variabele | Waarde |
|---|---|
| `STRAVA_CLIENT_ID` | Client ID uit stap 1 |
| `STRAVA_CLIENT_SECRET` | Client Secret uit stap 1 |
| `INTERVALS_API_KEY` | API-sleutel uit intervals.icu → *Settings* → *Developer Settings* (optioneel, voor de koppeling met intervals.icu en Zwift) |
| `SESSION_SECRET` | Een lange willekeurige tekst, minimaal 32 tekens. Bijvoorbeeld uit `openssl rand -hex 32` |

Deploy daarna opnieuw (*Deploys* → *Trigger deploy*), zodat de functies de variabelen zien.

### 4. intervals.icu en Zwift (optioneel)

1. Maak een gratis account op <https://intervals.icu> en zet in *Settings* je FTP gelijk aan die in Zwift.
2. Kies in *Settings* bij **Zwift** de knop *Connect* en log in met je Zwift-account.
3. Zet de API-sleutel (*Settings* → *Developer Settings*) als `INTERVALS_API_KEY` in Netlify en deploy opnieuw.

### 5. Koppelen en installeren op je telefoon

1. Open de site en klik op **Koppel Strava**. Geef toegang tot je activiteiten.
2. Op iPhone: deel-knop → *Zet op beginscherm*. Op Android: menu → *App installeren*.

## Opbouw

```
public/                  de app zelf
  index.html, app.css    interface
  plan.js                het trainingsplan (weken, sessies, coachteksten)
  logic.js               inkorten van trainingen, Strava-matching en Zwift-export
  app.js                 interface, opslag, Strava-synchronisatie
  sw.js, manifest        installeerbaar en offline bruikbaar
netlify/functions/       serverfuncties (Strava-login, ritten, opslag)
netlify/lib/session.mjs  versleutelde sessie en Strava-tokens
```

## Privacy

- Je Strava-tokens staan versleuteld in een cookie in je eigen browser, niet in een database.
- Je voortgang staat in Netlify Blobs, gekoppeld aan je Strava-account-id.
- Iedereen die de site opent moet zijn eigen Strava koppelen en ziet alleen zijn eigen gegevens. Wil je dat alleen jij de app kunt gebruiken? Laat je Strava-app dan op *single player*-modus staan (de standaard voor nieuwe Strava-apps): dan kan alleen jouw account koppelen.

## Plan aanpassen

Het schema staat in `public/plan.js` in het object `PLAN`. Per week een `wed`, `fri` en `sun` met hulpfuncties zoals `THR(90, 3, 12, 3, 94, 98)` (totaal 90 min, 3 blokken van 12 min, 3 min herstel, 94 tot 98% FTP). Verhoog na een wijziging `VERSION` in `public/sw.js`, zodat telefoons de nieuwe versie ophalen.
