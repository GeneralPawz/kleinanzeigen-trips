# Kleinanzeigen notification emails (research)

Researched 2026-10-26 by web search. **Result: thin.** No public source (help centre, forum post, open-source project) quotes the exact sender, subject or body of Kleinanzeigen's "new message" email. Everything below marked *unverified* is an assumption the parser is built to tolerate, not a fact. Run `npm run mail:check` on real mail and adjust `server/mail.js` if it misses.

## What the sources do tell us
- Kleinanzeigen emails are controllable under *Einstellungen → Benachrichtigungen* in the account (eBay community answers). The user must have message mails switched on.
- Counterparty names appear as pseudonyms ("InteressentXY…") rather than real addresses (eBay community thread), so the mail is a relay and not a plain forward.
- Phishing mails imitating Kleinanzeigen are common, e.g. "Ein Interessent hat eine Anfrage zu Ihrer Anzeige", fake "Support" and fake "Verkaufsbestätigung" mails (mimikama.org). They use look-alike sender domains and links to fake login pages. So the parser must check the real `From` domain strictly and must never follow links.

## Assumptions (all unverified)
| Aspect | Assumption | How the parser copes |
|---|---|---|
| Sender | `*@kleinanzeigen.de`, possibly a subdomain such as `mail.kleinanzeigen.de` / `noreply@…`; legacy `ebay-kleinanzeigen.de` | From address domain must equal or be a subdomain of `kleinanzeigen.de` or `ebay-kleinanzeigen.de`. IMAP search uses the substring `kleinanzeigen`, then the domain is re-checked after parsing |
| Subject | Something like "Neue Nachricht zu …", "Du hast eine neue Nachricht", "Nachricht zu deiner Anzeige …", "Anfrage zu …" | A mail counts as a message notification if the subject matches `nachricht|anfrage|antwort|geschrieben` or the body has an `/m-nachrichten.html` link. Title is taken from quotes (" „ “ ' ») in the subject, or after "zu"/"zur Anzeige" |
| Ad link | `https://www.kleinanzeigen.de/s-anzeige/<title-slug>/<adid>-<cat>-<region>`; adid is 9–10 digits (matches the format the scraper sees in `data-adid` and `data-href`) | Regex on `/s-anzeige/…/<digits>-<digits>-<digits>` in text and HTML, also inside URL-encoded tracking redirect URLs (decoded first) |
| Ad id elsewhere | Possibly `adId=`, `adid=`, "Anzeigen-ID: …", "Anzeige-Nr." | Fallback patterns |
| Ad title | Likely in subject and/or body | Subject, else text of the ad link, else the de-hyphenated slug (approximate: umlauts and punctuation lost) |
| Conversation link | `https://www.kleinanzeigen.de/m-nachrichten.html?...` or `#conversation…`, possibly behind a tracking redirect | Regex on `m-nachrichten.html[...]`, after decoding |
| Authenticity | Real mails probably carry SPF/DKIM pass | Not checked (providers already filter); only the From domain is checked |

## Privacy
Bodies are parsed in memory and dropped. Only date, subject, adid, title and link are kept (`data/user/mail-index.json`). The mailbox is opened read-only; nothing is marked read, moved or deleted.
