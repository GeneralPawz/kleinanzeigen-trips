import { parse } from 'node-html-parser';

const BASE = 'https://www.kleinanzeigen.de';
const clean = (s) => s.replace(/\s+/g, ' ').trim();

/** @param {string} text */
export function parsePrice(text) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (/zu verschenken/i.test(t)) return { price: 0, vb: false };
  const m = t.match(/(\d{1,3}(?:\.\d{3})*|\d+)(?:,\d+)?\s*€/);
  const price = m ? parseInt(m[1].replace(/\./g, ''), 10) : null;
  return { price, vb: /\bVB\b/.test(t) };
}

/**
 * Parse a Kleinanzeigen search-result page (node-html-parser: pure JS, runs in Node and WebViews).
 * Anchors on article[data-adid], data-href, h3 and span text — the Tailwind class names are unstable.
 * @param {string} html
 * @returns {{adid:string,title:string,priceText:string,price:number|null,vb:boolean,url:string,
 *   image:string|null,plz:string|null,city:string|null,date:string|null}[]}
 */
export function parseSearch(html) {
  const root = parse(html);
  const items = [];
  for (const a of root.querySelectorAll('article[data-adid]')) {
    const adid = a.getAttribute('data-adid');
    const href = a.getAttribute('data-href') || a.querySelector('h3 a')?.getAttribute('href');
    const title = clean(a.querySelector('h3')?.text ?? '');
    if (!adid || !href || !title) continue;

    let plz = null;
    let city = null;
    let date = null;
    for (const s of a.querySelectorAll('span')) {
      const t = s.text.trim();
      const m = t.match(/^(\d{5})\s+(.+)$/);
      if (m && !plz) {
        plz = m[1];
        city = m[2];
      } else if (!date && /^(Heute|Gestern)\b|^\d{2}\.\d{2}\.\d{4}$/.test(t)) {
        date = t;
      }
    }

    const priceText =
      a
        .querySelectorAll('p')
        .map((p) => clean(p.text))
        .find((t) => /€|zu verschenken/i.test(t) && t.length < 40) || '';
    const { price, vb } = parsePrice(priceText);

    const image =
      a.querySelector('[data-image-container] img')?.getAttribute('src') ||
      a.querySelector('img')?.getAttribute('src') ||
      null;

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
  }
  return items;
}

/** True if the page looks like a captcha / bot wall. */
export function looksBlocked(html) {
  return /captcha|Access Denied|Zugriff verweigert|ist ungewöhnlich|unusual traffic/i.test(html);
}
