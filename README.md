# Trödeltour

Persönliche Web-App: Route planen (z. B. Hamburg → München) und entlang der Strecke Kleinanzeigen-Angebote
finden – für Schnäppchen, die man auf dem Weg mitnehmen kann. Node 22, Express, kein Build-Schritt.

## Setup

```
npm install
npm run build:plz          # lädt GeoNames-PLZ-Tabelle → data/plz-de.json (liegt bereits bei)
```

Optionale `.env`:

```
PORT=3000
ORS_API_KEY=...          # OpenRouteService; ohne Key wird der OSRM-Demo-Server genutzt
CONTACT_EMAIL=du@example.org   # für den Nominatim-User-Agent
SAMPLE_KM=25             # Abstand der Suchpunkte entlang der Route (Standard 25)
```

## Starten

```
npm start      # http://localhost:3000
npm test
```

API-Vertrag: `docs/API.md`.

## Wie es funktioniert

Die Route wird alle ~25 km abgetastet; für jeden Punkt wird die nächste PLZ gesucht und die erste
Kleinanzeigen-Ergebnisseite (Umkreis 30 km) geholt. Die Treffer werden per lokaler PLZ-Tabelle verortet,
nach Abstand zur Route gefiltert und nach Position entlang der Route sortiert. Anfragen laufen
sequenziell mit 1,2–2 s Pause, 15 min Cache und Abbruch bei Captcha/403/429.

## Hinweise

- **Nur zur privaten Nutzung.** Die Nutzungsbedingungen von Kleinanzeigen untersagen automatisierten
  Zugriff. Die App ruft anonym und in geringem Umfang öffentliche Suchseiten ab; bitte nicht
  hochfahren, nicht öffentlich hosten. Das HTML kann sich jederzeit ändern (Parser: `server/kleinanzeigen/parse.js`).
- **Kein Login in der App.** Merken und Nachrichten schreiben passiert direkt auf Kleinanzeigen: „Anzeige
  öffnen" öffnet die Anzeige in einem neuen Tab, wo du in deinem eigenen Browser angemeldet bist. Der Link
  „Meine Merkliste ↗" im Header führt zu https://www.kleinanzeigen.de/m-merkliste.html.

## Quellen / Lizenzen

- Kartendaten, Geokodierung: © [OpenStreetMap](https://www.openstreetmap.org/copyright)-Mitwirkende (ODbL), Nominatim.
- Routing: [OSRM](https://project-osrm.org/) Demo-Server bzw. [OpenRouteService](https://openrouteservice.org/).
- Postleitzahlen-Koordinaten: [GeoNames](https://www.geonames.org/) postal codes, lizenziert unter
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
