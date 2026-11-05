# Alpe d'HuZes Trainingsplan

Persoonlijke trainingsapp naar 6× Alpe d'Huez op 3 juni 2027. Draait op Netlify, koppelt met Strava en is op je telefoon te installeren als app.

## Wat de app doet

- 30 weken plan met wattages op basis van je FTP (bovenin aan te passen).
- **Lukt niet?** per training: minder tijd, andere dag in dezelfde week, of overslaan. Bij minder tijd past de app de training aan: werkblokken gaan voor, zone 2 wordt korter. Is de tijd te kort voor de opbouw, dan wordt het een rit op hoge zone 2.
- **Strava-koppeling**: ritten worden automatisch aan een training gekoppeld als ze minimaal 70% overeenkomen.
- Voortgang wordt per Strava-account opgeslagen, dus telefoon en laptop tonen hetzelfde.

### Hoe de 70% wordt berekend

Per training en rit uit dezelfde week:

| Onderdeel | Weging | Wat het meet |
|---|---|---|
| Duur | 40% | Rijtijd van de rit tegenover de geplande duur |
| Zones | 60% | Hoeveel van je trapseconden in dezelfde vermogenszones vallen als gepland (zones op basis van je FTP; freewheelen telt niet mee) |

- Geen vermogensdata in de rit? Dan telt het gemiddelde vermogen tegenover de geplande gemiddelde intensiteit.
- Geen vermogen bekend? Dan alleen de duur, met maximaal 85% score.
- Rit op een andere dag in dezelfde week (waarop geen training gepland stond)? Score × 0,9.
- Elke rit wordt maar aan één training gekoppeld; de beste combinaties gaan voor.
- Onder 70% zie je de beste kandidaat met de knop **Toch koppelen**. Een automatische koppeling kun je ongedaan maken met **Ontkoppel**.

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
| `SESSION_SECRET` | Een lange willekeurige tekst, minimaal 32 tekens. Bijvoorbeeld uit `openssl rand -hex 32` |

Deploy daarna opnieuw (*Deploys* → *Trigger deploy*), zodat de functies de variabelen zien.

### 4. Koppelen en installeren op je telefoon

1. Open de site en klik op **Koppel Strava**. Geef toegang tot je activiteiten.
2. Op iPhone: deel-knop → *Zet op beginscherm*. Op Android: menu → *App installeren*.

## Opbouw

```
public/                  de app zelf
  index.html, app.css    interface
  plan.js                het trainingsplan (weken, sessies, coachteksten)
  logic.js               inkorten van trainingen en Strava-matching
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
