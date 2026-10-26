// Invented demo listings for the Play Store screenshots (scripts/play-graphics.js). None of these ads exists: titles,
// prices and adids are made up, the PLZ/city pairs are real places along Hamburg → Göttingen → München so they geocode
// from data/plz-de.json. Photos are CC0/public-domain files from Wikimedia Commons, see docs/play/demo-images/CREDITS.md.
import { distanceToRoute, cumulativeKm } from '../core/corridor.js';

export const IMAGE_BASE = 'https://demo-img.invalid/'; // intercepted by Playwright, never requested for real
export const AD_URL = 'https://www.kleinanzeigen.de/';

// [query, title, priceText, plz, city, date, image]
const RAW = [
  ['Fahrrad', 'Mountainbike 26 Zoll, gut gepflegt', '120 € VB', '22765', 'Hamburg Altona', 'Heute, 10:15', 'rad-2'],
  ['Plattenspieler', 'Technics SL-1200 MK5 Plattenspieler', '450 € VB', '22549', 'Hamburg Osdorf', 'Heute, 09:02', 'platte-1'],
  ['Fahrrad', 'Herren Mountainbike mit Federgabel', '95 €', '21073', 'Hamburg Harburg', 'Gestern, 18:40', 'rad-1'],
  ['Plattenspieler', 'Kofferplattenspieler Retro mit Lautsprechern', '60 € VB', '29614', 'Soltau', 'Heute, 08:30', 'platte-2'],
  ['Fahrrad', 'Rennrad Carbonrahmen 56 cm, Shimano', '780 € VB', '29683', 'Bad Fallingbostel', 'Gestern, 20:11', 'rad-3'],
  ['Plattenspieler', 'Plattenspieler in Kupfer, neuwertig', '85 €', '29664', 'Walsrode', '24.10.2026', 'platte-3'],
  ['Fahrrad', 'Vintage Rennrad Stahlrahmen, 10 Gänge', '140 € VB', '30853', 'Langenhagen', 'Heute, 11:48', 'rad-5'],
  ['Plattenspieler', 'Plattenspieler weiß, Riemenantrieb', '70 € VB', '30159', 'Hannover', 'Gestern, 15:22', 'platte-4'],
  ['Fahrrad', 'Jugend-Mountainbike 24 Zoll', '45 € VB', '37154', 'Northeim', '23.10.2026', 'rad-2'],
  ['Plattenspieler', 'Plattenspieler mit Radio, defekt', 'Zu verschenken', '37191', 'Katlenburg-Lindau', 'Heute, 07:55', 'platte-2'],
  ['Plattenspieler', 'Technics Plattenspieler mit Ortofon-Nadel', '380 € VB', '37081', 'Göttingen', 'Heute, 10:40', 'platte-1'],
  ['Fahrrad', 'Mountainbike Hardtail, Gabel gelb', '110 €', '37073', 'Göttingen', 'Gestern, 12:05', 'rad-1'],
  ['Plattenspieler', 'Plattenspieler weiß, Top Zustand', '120 € VB', '37124', 'Rosdorf', '22.10.2026', 'platte-4'],
  ['Fahrrad', 'Rennrad Rahmenhöhe 54, Shimano-Gruppe', '520 €', '34233', 'Fuldatal', 'Heute, 09:30', 'rad-3'],
  ['Fahrrad', 'Vintage Rennrad restauriert', '220 € VB', '34117', 'Kassel', 'Heute, 12:20', 'rad-5'],
  ['Plattenspieler', 'Kofferplattenspieler aus den 60ern', '55 € VB', '34117', 'Kassel', 'Gestern, 19:48', 'platte-2'],
  ['Fahrrad', 'Mountainbike Stahlrahmen, Federgabel', '80 € VB', '34212', 'Melsungen', '24.10.2026', 'rad-1'],
  ['Plattenspieler', 'Plattenspieler Kupfer-Optik, Top', '95 €', '36251', 'Bad Hersfeld', 'Heute, 08:10', 'platte-3'],
  ['Fahrrad', 'Dirtbike 26 Zoll, grau', '110 €', '36037', 'Fulda', 'Gestern, 16:35', 'rad-2'],
  ['Plattenspieler', 'Technics SL-1200 Direct Drive', '420 € VB', '36088', 'Hünfeld', 'Heute, 11:05', 'platte-1'],
  ['Fahrrad', 'Rennrad Carbon, kaum gefahren', '950 € VB', '97688', 'Bad Kissingen', '23.10.2026', 'rad-3'],
  ['Plattenspieler', 'Plattenspieler weiß mit Bluetooth', '65 €', '97070', 'Würzburg', 'Heute, 09:45', 'platte-4'],
  ['Fahrrad', 'Retro Rennrad 28 Zoll', '175 €', '97209', 'Veitshöchheim', 'Gestern, 14:12', 'rad-5'],
  ['Plattenspieler', 'Plattenspieler im Koffer, Retro', '40 € VB', '85051', 'Ingolstadt', '22.10.2026', 'platte-2'],
  ['Fahrrad', 'Mountainbike Herren, Shimano Schaltung', '130 € VB', '81369', 'München Sendling', 'Heute, 10:58', 'rad-1'],
  ['Plattenspieler', 'Plattenspieler in Kupfer, wie neu', '110 €', '80331', 'München', 'Gestern, 21:03', 'platte-3'],
  ['Fahrrad', 'Mountainbike grau, Jugendrad', '70 € VB', '85356', 'Freising', '24.10.2026', 'rad-2'],
];

export const DEMO_IMAGES = ['rad-1', 'rad-2', 'rad-3', 'rad-5', 'platte-1', 'platte-2', 'platte-3', 'platte-4'];

/** Results in the shape the search job returns, sorted along the route. */
export function demoResults(route, plzTable) {
  const coords = route.geometry.coordinates;
  const cum = cumulativeKm(coords);
  return RAW.map(([query, title, priceText, plz, city, date, img], i) => {
    const pos = plzTable.plz[plz];
    if (!pos) throw new Error(`PLZ ${plz} not in data/plz-de.json`);
    const { distKm, kmAlong } = distanceToRoute(pos[0], pos[1], coords, cum);
    if (distKm > 15) throw new Error(`${plz} ${city} is ${distKm.toFixed(1)} km off the route`);
    const m = priceText.match(/^(\d+)/);
    return {
      adid: String(9000000001 + i), title, priceText, price: m ? Number(m[1]) : 0, vb: /VB$/.test(priceText),
      url: AD_URL, image: `${IMAGE_BASE}${img}.jpg`, plz, city, date, query,
      lat: pos[0], lon: pos[1],
      distanceToRouteKm: Math.round(distKm * 10) / 10, kmAlongRoute: Math.round(kmAlong * 10) / 10,
      nearStop: null, distanceToStopKm: null,
    };
  }).sort((a, b) => a.kmAlongRoute - b.kmAlongRoute);
}

// scene picks: [title, status] — favourites are the first three
export const PICKS = [
  ['Plattenspieler weiß, Riemenantrieb', 'angeschrieben'],
  ['Vintage Rennrad restauriert', 'antwort'],
  ['Technics Plattenspieler mit Ortofon-Nadel', 'vereinbart'],
  ['Plattenspieler Kupfer-Optik, Top', 'abgeholt'],
];
