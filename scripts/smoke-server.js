// Starts the desktop server on PORT 3400, requests / and /api/routes, stops it.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: '3400' }, stdio: 'inherit' });
try {
  await sleep(2500);
  for (const path of ['/', '/api/routes']) {
    const res = await fetch(`http://localhost:3400${path}`);
    console.log(path, res.status, (await res.text()).slice(0, 60).replace(/\s+/g, ' '));
    if (!res.ok) process.exitCode = 1;
  }
} finally {
  child.kill();
}
