// Dev helper: poll a search job until it finishes. Usage: node scripts/wait-job.js <jobId> [port]
const [id, port = '3000'] = process.argv.slice(2);
for (;;) {
  const j = await (await fetch(`http://localhost:${port}/api/search/${id}`)).json();
  if (j.status !== 'running') {
    console.log(j.status, JSON.stringify(j.progress), j.error, 'results:', j.results.length);
    console.log(
      j.results
        .slice(0, 8)
        .map((r) => `${r.kmAlongRoute}km +${r.distanceToRouteKm}km ${r.plz} ${r.city} | ${r.priceText} | ${r.title.slice(0, 40)}`)
        .join('\n'),
    );
    break;
  }
  await new Promise((r) => setTimeout(r, 4000));
}
