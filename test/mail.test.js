import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMail, matchNotification, buildNotifications, mailConfig, maskUser, titleSimilar, isKleinanzeigenSender } from '../server/mail.js';

const eml = (n) => readFileSync(fileURLToPath(new URL(`./fixtures/mail/${n}.eml`, import.meta.url)));

test('parses ad link, quoted subject title and conversation link', async () => {
  const m = await parseMail(eml('with-adlink'));
  assert.equal(m.adid, '3012345678');
  assert.equal(m.title, 'Fahrrad Kinderfahrrad 20 Zoll');
  assert.equal(m.titleFrom, 'subject');
  assert.equal(m.link, 'https://www.kleinanzeigen.de/m-nachrichten.html?conversationId=abc123&x=1');
  assert.equal(m.isMessage, true);
  assert.equal(m.at, '2026-10-24T08:15:00.000Z');
  assert.equal('text' in m || 'html' in m, false);
});

test('finds ids inside URL-encoded tracking redirects; falls back to slug title', async () => {
  const m = await parseMail(eml('tracking-redirect'));
  assert.equal(m.adid, '2999888777');
  assert.equal(m.title, 'gartentisch holz');
  assert.equal(m.titleFrom, 'slug');
  assert.match(m.link, /m-nachrichten\.html\?id=77$/);
  assert.equal(m.isMessage, true);
});

test('title from encoded subject without any link', async () => {
  const m = await parseMail(eml('title-only'));
  assert.equal(m.adid, null);
  assert.equal(m.title, 'Bücherregal Eiche massiv');
  assert.equal(m.link, null);
  assert.equal(m.isMessage, true);
});

test('rejects look-alike sender domains', async () => {
  assert.equal(await parseMail(eml('phishing')), null);
  assert.equal(isKleinanzeigenSender('a@kleinanzeigen.de'), true);
  assert.equal(isKleinanzeigenSender('a@mail.kleinanzeigen.de'), true);
  assert.equal(isKleinanzeigenSender('a@notkleinanzeigen.de'), false);
  assert.equal(isKleinanzeigenSender('a@kleinanzeigen.de.evil.example'), false);
});

test('title similarity', () => {
  assert.ok(titleSimilar('Bücherregal Eiche massiv', 'bücherregal eiche  MASSIV!'));
  assert.ok(titleSimilar('Bücherregal Eiche massiv', 'Bücherregal Eiche massiv, 2m'));
  assert.ok(!titleSimilar('Fahrrad 26 Zoll', 'Fahrrad Kinder 20 Zoll Rot'));
  assert.ok(!titleSimilar('Fahrrad', 'Fahrrad'.concat(' x')));
});

test('matching: adid first, then title, ambiguous stays unmatched', () => {
  const ads = [
    { adid: '1', title: 'Bücherregal Eiche massiv' },
    { adid: '2', title: 'Sofa grau 3-Sitzer' },
    { adid: '3', title: 'Sofa grau 3 Sitzer Cord' },
  ];
  assert.deepEqual(matchNotification({ adid: '999', title: 'x' }, ads), { adid: '999', match: 'adid' });
  assert.deepEqual(matchNotification({ adid: null, title: 'bücherregal eiche massiv' }, ads), { adid: '1', match: 'title' });
  assert.equal(matchNotification({ adid: null, title: 'Gartenstuhl' }, ads), null);
  assert.equal(matchNotification({ adid: null, title: 'Sofa grau 3 Sitzer' }, ads)?.adid, '2'); // exact normalized
  assert.equal(matchNotification({ adid: null, title: 'Sofa grau Sitzer' }, ads), null); // fuzzy hits both
});

test('buildNotifications groups, counts unseen and keeps unmatched apart', () => {
  const mk = (adid, title, at, subject = 'Neue Nachricht') => ({ adid, title, at, subject, link: `l-${at}`, isMessage: true });
  const items = [
    mk('1', null, '2026-10-24T10:00:00.000Z'),
    mk(null, 'Bücherregal Eiche massiv', '2026-10-25T10:00:00.000Z', 'zweite'),
    mk(null, 'Unbekannt', '2026-10-25T11:00:00.000Z'),
    { ...mk('1', null, '2026-10-26T10:00:00.000Z'), isMessage: false },
  ];
  const ads = [{ adid: '1', title: 'Bücherregal Eiche massiv' }];
  const r = buildNotifications(items, ads, { 1: '2026-10-24T12:00:00.000Z' });
  assert.deepEqual(r.byAd['1'], {
    count: 2, unseen: 1, lastAt: '2026-10-25T10:00:00.000Z', lastSubject: 'zweite', link: 'l-2026-10-25T10:00:00.000Z', match: 'adid',
  });
  assert.equal(r.unmatched.length, 1);
  assert.equal(r.unmatched[0].subject, 'Neue Nachricht');
});

test('config presets and masking', () => {
  assert.equal(mailConfig({}).configured, false);
  const c = mailConfig({ MAIL_PROVIDER: 'GMX', MAIL_USER: 'f@gmx.de', MAIL_PASS: 'x' });
  assert.deepEqual([c.configured, c.host, c.port, c.lookbackDays], [true, 'imap.gmx.net', 993, 30]);
  assert.equal(mailConfig({ MAIL_PROVIDER: 'gmail', MAIL_USER: 'a@b.c', MAIL_PASS: 'x' }).host, 'imap.gmail.com');
  assert.equal(mailConfig({ MAIL_PROVIDER: 'custom', MAIL_USER: 'a', MAIL_PASS: 'x' }).configured, false);
  assert.equal(mailConfig({ MAIL_PROVIDER: 'custom', MAIL_HOST: 'h', MAIL_PORT: '143', MAIL_USER: 'a', MAIL_PASS: 'x' }).port, 143);
  assert.equal(maskUser('friedrich@gmx.de'), 'f***@gmx.de');
});
