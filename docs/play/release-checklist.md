# Release checklist – first manual upload to Google Play

Package: `de.generalpawz.troedeltour` (can never be changed after creation). Version 0.2.0 → versionCode 200.

## 0. Get the .aab

1. GitHub → repo → **Actions** → workflow *Android App Bundle* → pick the run for your tag (or run it manually: *Run workflow*, branch `main`).
2. Scroll to **Artifacts** → download `troedeltour-vX.Y.Z.aab` (a zip containing the .aab – unzip it).
3. In the run log, step "Name and verify AAB" prints the signing certificate and the merged-manifest permissions (should be `INTERNET` only).

The AAB is signed with your existing keystore: that is the **upload key**.

## 1. Create the app

Play Console → **Create app**: name `Trödeltour`, default language German (Deutschland) – de-DE, App (not game), **Free**, accept the declarations.
If your developer account is a *personal* account created after Nov 2023, Play requires a **closed test with ≥ 12 testers opted in for 14 continuous days** before you can apply for production access. Internal testing works immediately and has no such requirement.

## 2. Play App Signing

On the first upload Play asks to enrol in **Play App Signing** → accept the default "**Google-managed key**". Your keystore then only acts as the upload key
(if it is ever lost, you can request an upload-key reset from Play; the app-signing key stays with Google).

## 3. Upload the first build to Internal testing

1. **Test and release → Testing → Internal testing → Create new release**.
2. Upload the `.aab`. Release name defaults to the version; paste the release notes (≤ 500 chars, de-DE):
   `<de-DE> … </de-DE>` tags if Play asks for them.
3. **Save → Review release → Start rollout to Internal testing**.
4. **Testers** tab: create an email list (Google accounts of testers, including yours), save, then copy the **opt-in link** and open it on the phone with that account → "Become a tester" → install from Play.

## 4. Required declarations (Policy → App content) – all before production, most before testing review

| Item | What to enter |
| --- | --- |
| Privacy policy | https://github.com/GeneralPawz/kleinanzeigen-trips/blob/main/PRIVACY.md |
| App access | All functionality available without special access |
| Ads | No, the app contains no ads |
| Content rating | see `content-rating.md` |
| Target audience | 18+ (see `content-rating.md`); not designed for children |
| Data safety | see `data-safety.md` |
| News / Government / Health / Financial features | No / No / No / none |
| Advertising ID | Not used |

Store listing (Grow → Store presence → Main store listing): texts from `listing.md`; app icon `graphics/icon-512.png`, feature graphic `graphics/feature-1024x500.png`,
phone screenshots `graphics/screenshot-1..4.png`. Add a contact email (public) and, optionally, the website. Category: Travel & Local.
Repeat translations: en-US from `listing.md` (optional).

Because the app shows third-party marketplace listings and names "Kleinanzeigen", keep the disclaimer in the description (it is already there) and do not add the Kleinanzeigen logo anywhere in the listing.

## 5. Later releases

- Bump `version` in `package.json`, commit, push an **annotated** tag: `git tag -a v0.2.1 -m "Release notes (≤500 chars)" && git push origin v0.2.1`.
- CI builds the AAB, creates a GitHub release with the notes (no binaries) and, once step 6 is done, uploads it to Internal testing automatically.
- Promote in the Console: Internal testing → **Promote release** → Closed/Open/Production.
- The in-app update check ("Nach Updates suchen") only finds versions that are live on the track of the installing user (internal testers see internal builds).

## 6. Automatic uploads: service account for CI

1. Play Console → **Setup → API access** (in newer consoles: **Users and permissions → Invite new users** is used for the grant, see below). Link/create a Google Cloud project if asked.
2. Google Cloud Console (same project) → **IAM & Admin → Service accounts → Create service account** (name e.g. `play-upload`; no project roles needed).
   Open it → **Keys → Add key → Create new key → JSON** → a `.json` file is downloaded. Keep it private.
3. Google Cloud: enable the **Google Play Android Developer API** for that project (APIs & Services → Library).
4. Play Console → **Users and permissions → Invite new users** → email = the service account's address (`play-upload@<project>.iam.gserviceaccount.com`) →
   permissions: **App access → add Trödeltour** with **Release to testing tracks** (and, if you want, "Release apps to production" later); no admin rights needed → Invite.
5. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**: name `PLAY_SERVICE_ACCOUNT_JSON`, value = the complete JSON file content.
6. Push a tag. The step "Upload to Play (internal track)" now runs (status `completed`, release notes from the tag message). Without the secret the step is skipped.

Notes: the very first upload must be done by hand (step 3) – the API refuses to create releases on an app that has never had a release. A new service-account grant can take a few hours to be effective.
versionCode must increase with every upload; the build derives it from `package.json` (major·10000 + minor·100 + patch).
