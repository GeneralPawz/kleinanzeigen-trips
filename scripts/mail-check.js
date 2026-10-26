// Connects with .env credentials and lists the Kleinanzeigen mails the parser finds (metadata only, no bodies).
import 'dotenv/config';
import { mailConfig, fetchKleinanzeigenMails } from '../server/mail.js';

const cfg = mailConfig();
if (!cfg.configured) {
  console.error('Mail nicht konfiguriert: MAIL_PROVIDER (gmail|gmx|custom), MAIL_USER und MAIL_PASS in .env setzen.');
  process.exit(1);
}
try {
  const { items, keys } = await fetchKleinanzeigenMails(cfg);
  const mails = items.filter((m) => !m.skip).sort((a, b) => a.at.localeCompare(b.at));
  console.log(`${keys.length} Treffer für "kleinanzeigen" in den letzten ${cfg.lookbackDays} Tagen, ${mails.length} von Kleinanzeigen-Domains:`);
  for (const m of mails) {
    console.log(
      `${m.at.slice(0, 16)}  ${m.isMessage ? 'MSG  ' : 'other'}  adid=${m.adid ?? '-'}  title=${m.title ? `${m.title} (${m.titleFrom})` : '-'}  link=${m.link ? 'ja' : '-'}\n    ${m.subject}`,
    );
  }
  console.log(`\nOhne adid: ${mails.filter((m) => m.isMessage && !m.adid).length} Nachrichten-Mails (werden über den Titel zugeordnet).`);
} catch (e) {
  console.error(`Fehler: ${String(e.responseText || e.message).split(cfg.pass).join('***')}`);
  process.exit(1);
}
