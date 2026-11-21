/** Starts the compose stack from scratch and waits until both realms answer. */
import { execFileSync } from 'node:child_process';

const cwd = new URL('..', import.meta.url).pathname;
execFileSync('docker', ['compose', 'down', '-v'], { cwd, stdio: 'inherit' });
execFileSync('docker', ['compose', 'up', '-d'], { cwd, stdio: 'inherit' });
const deadline = Date.now() + 240_000;
for (;;) {
  try {
    const ok = await Promise.all(['naive', 'fixed'].map((r) => fetch(`http://localhost:18080/realms/${r}/.well-known/openid-configuration`).then((x) => x.ok)));
    if (ok.every(Boolean)) break;
  } catch {}
  if (Date.now() > deadline) throw new Error('keycloak did not start in 240 s; see docker compose logs keycloak');
  await new Promise((r) => setTimeout(r, 2000));
}
console.log('stack is up');
