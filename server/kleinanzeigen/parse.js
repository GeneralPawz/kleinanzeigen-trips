import { load } from 'cheerio';

const BASE = 'https://www.kleinanzeigen.de';

/** @param {string} text */
export function parsePrice(text) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (/zu verschenken/i.test(t)) return { price: 0, vb: false };
  const m = t.match(/(\d{1,3}(?:\.\d{3})*|\d+)(?:,\d+)?\s*€/);
  const price = m ? parseInt(m[1].replace(/\./g, ''), 10) : null;
  return { price, vb: /\bVB\b/.test(t) };
}

/**
 * Parse a Kleinanzeigen search-result page. Anchors on article[data-adid], data-href,
 * h3 and span text — the Tailwind class names are unstable.
 * @param {string} html
 * @returns {{adid:string,title:string,priceText:string,price:number|null,vb:boolean,url:string,
 *   image:string|null,plz:string|null,city:string|null,date:string|null}[]}
 */
export function parseSearch(html) {
  const $ = load(html);
  const items = [];
  $('article[data-adid]').each((_, el) => {
    const a = $(el);
    const adid = a.attr('data-adid');
    const href = a.attr('data-href') || a.find('h3 a').attr('href');
    const title = a.find('h3').first().text().replace(/\s+/g, ' ').trim();
    if (!adid || !href || !title) return;

    let plz = null;
    let city = null;
    let date = null;
    a.find('span').each((__, s) => {
      const t = $(s).text().trim();
      const m = t.match(/^(\d{5})\s+(.+)$/);
      if (m && !plz) {
        plz = m[1];
        city = m[2];
      } else if (!date && /^(Heute|Gestern)\b|^\d{2}\.\d{2}\.\d{4}$/.test(t)) {
        date = t;
      }
    });

    const priceText =
      a
        .find('p')
        .map((__, p) => $(p).text().replace(/\s+/g, ' ').trim())
        .get()
        .find((t) => /€|zu verschenken/i.test(t) && t.length < 40) || '';
    const { price, vb } = parsePrice(priceText);

    const image =
      a.find('[data-image-container] img').attr('src') || a.find('img').attr('src') || null;

    items.push({
      adid,
      title,
      priceText,
      price,
      vb,
      url: href.startsWith('http') ? href : BASE + href,
      image,
      plz,
      city,
      date,
    });
  });
  return items;
}

/** True if the page looks like a captcha / bot wall. */
export function looksBlocked(html) {
  return /captcha|Access Denied|Zugriff verweigert|ist ungewöhnlich|unusual traffic/i.test(html);
}
