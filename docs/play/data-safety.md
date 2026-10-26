# Data safety form – answers

Source of truth: Play Console Help, "Provide information for Google Play's Data safety section"
(https://support.google.com/googleplay/android-developer/answer/10787469). Quoted definitions (checked 2026-10-26):

- **Collect**: "transmitting data from your app off a user's device" – including data sent by libraries/SDKs and by webviews your app controls.
- **Share**: "transferring user data collected from your app to a third party". Exempt from *sharing*: service providers acting on the developer's
  instructions; "a specific user-initiated action, where the user reasonably expects the data to be shared"; prominent disclosure + consent; legal purposes; anonymised data.
- **Not required to disclose as collection**: data processed only on device; end-to-end encrypted data; data accessed and used only in memory ("ephemeral processing" – still
  entered in the form, but not displayed).

## The honest position

The developer runs no backend and receives nothing. But Play's definition of "collect" is about data leaving the device, *to anyone*. The app sends
user-entered search terms and place/route coordinates straight from the device to kleinanzeigen.de, Nominatim, OSRM (and tile requests to OSM).
The sharing exemption ("specific user-initiated action") covers the *sharing* column, **not** the *collection* column, and Kleinanzeigen/OSM/OSRM are not the developer's service
providers (they don't act on the developer's instructions). Answering "No data collected" is therefore risky: it is arguably inaccurate under Play's own definition
and is the kind of mismatch that causes a review rejection. The conservative, defensible answers below declare it as collected and **not shared**.
If you prefer the minimal variant ("No data collected"), that is a judgement call you take on yourself; the text below is what I recommend.

## Answers

**Section 1 – Data collection and security**

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (all requests use HTTPS) |
| Do you provide a way for users to request that their data is deleted? | **No** – the developer holds no data. (Local data is deleted by uninstalling the app; third-party services' policies are in PRIVACY.md.) |

**Section 2 – Data types** (select only these; everything else: not collected)

1. **App activity → In-app search history**
   - Collected: **Yes** · Shared: **No** (user-initiated transfer to the search service the user asked to query – sharing exemption)
   - Processed ephemerally: **No** (the destination servers are third parties and may keep logs; do not claim ephemeral)
   - Required or optional: **Required** (the app cannot search without sending the term)
   - Purposes: **App functionality** only
2. **Location → Approximate location**
   - Collected: **Yes** · Shared: **No**
   - What it is: postcodes and the coordinates of start/destination/via points that *the user types or picks on the map* and that are sent to Nominatim/OSRM/OSM tiles and kleinanzeigen.de.
     It is **not** the device location (the app has no location permission). Declaring it is the conservative reading; if you decide that user-chosen route points are not "user location",
     you can omit this row – but keep In-app search history.
   - Processed ephemerally: No · Required · Purposes: **App functionality**

No other categories: no personal info, financial info, health, messages, photos/videos, audio, files, calendar, contacts, web browsing history, device or other IDs
(the app does not read advertising ID/Android ID; third-party servers see the IP address like in any web request, which Play does not list as a separate type to declare unless you
collect it yourself).

**Section 3 – Preview**: it should show "Data collected: In-app search history, Approximate location – not shared" and "Data is encrypted in transit".

## Other declarations that go with it

- Privacy policy URL: https://github.com/GeneralPawz/kleinanzeigen-trips/blob/main/PRIVACY.md
- Ads: **No ads**. Advertising ID declaration: **Not used** (the manifest has no `AD_ID` permission; Capacitor and the update plugin don't add it).
- Account creation: **none** → no account deletion URL needed.
- Third-party SDKs: Capacitor (no data collection), `@capawesome/capacitor-app-update` (uses Google Play Core; Google's SDK Index entry covers it).
- Permissions in the AAB: `INTERNET` only (printed by the CI run in the "Name and verify AAB" step).
