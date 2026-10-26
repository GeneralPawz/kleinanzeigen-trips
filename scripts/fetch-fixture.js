// Fetches one real search page into test/fixtures (used to refresh the parser fixture).
// Usage: node scripts/fetch-fixture.js <url> <outfile>
import { writeFileSync } from 'node:fs';

const [url, out] = process.argv.slice(2);
const res = await fetch(url, {
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Accept-Language': 'de-DE,de;q=0.9',
    Accept: 'text/html,application/xhtml+xml',
  },
});
const html = await res.text();
console.log(res.status, res.url, html.length, 'articles:', (html.match(/<article/g) || []).length);
if (out) writeFileSync(out, html);
