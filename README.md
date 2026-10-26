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

## Neue Nachrichten per Mail-Postfach (optional)

Kleinanzeigen schickt dir bei neuen Nachrichten eine E-Mail. Die App kann dein Postfach dafür **nur lesend**
per IMAP prüfen (alle 2 min; nichts wird als gelesen markiert, verschoben oder gelöscht) und zeigt Hinweise
an den passenden Anzeigen. Gespeichert werden nur Datum, Betreff, Anzeigen-ID/-Titel und Link
(`data/user/mail-index.json`). Antworten schreibst du weiterhin auf kleinanzeigen.de.

`.env` (Vorlage: `.env.example`):

```
MAIL_PROVIDER=gmx        # gmail | gmx | custom (dann MAIL_HOST / MAIL_PORT)
MAIL_USER=du@gmx.de
MAIL_PASS=app-passwort
MAIL_LOOKBACK_DAYS=30
```

**Gmail:** 2-Faktor-Authentifizierung im Google-Konto aktivieren (myaccount.google.com → Sicherheit), dann
unter https://myaccount.google.com/apppasswords ein App-Passwort erstellen (16 Zeichen, Leerzeichen weglassen)
und als `MAIL_PASS` eintragen. IMAP ist bei Gmail standardmäßig aktiv.

**GMX:** Im GMX-Postfach unter *Einstellungen → POP3/IMAP Abruf → „IMAP/POP3-Zugriff erlauben“* aktivieren.
Hast du 2FA eingeschaltet, unter *Einstellungen → Sicherheit* ein Anwendungspasswort anlegen und als
`MAIL_PASS` nutzen; sonst das normale Passwort.

Parser prüfen: `npm run mail:check` listet die gefundenen Kleinanzeigen-Mails (Datum, Betreff, erkannte
Anzeigen-ID/Titel, keine Inhalte). Das Mail-Format ist nicht öffentlich dokumentiert, siehe
`docs/research/mail-notifications.md`.

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

Optional kann pro Stopp ein Suchradius (5–50 km) gesetzt werden; Treffer innerhalb davon bleiben auch
außerhalb des Korridors erhalten (`nearStop`). Routen, die lokale Merkliste und Kontaktnotizen liegen in
`data/user/store.json` (nicht im Git); Endpunkte siehe `docs/API.md`.

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
