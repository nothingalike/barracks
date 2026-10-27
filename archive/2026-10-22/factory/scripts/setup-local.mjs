import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Create a separate ignored local overlay; preserve installer/provider credentials.
const state = resolve('.state');
mkdirSync(state, { recursive: true });
const overlay = resolve('.env.barracks');
if (!existsSync(overlay)) {
  writeFileSync(overlay, [
    'NODE_ENV=development',
    'PORT=4111',
    'MASTRACODE_PUBLIC_URL=http://localhost:4111',
    'BARRACKS_LOCAL_ACCESS=1',
    'FACTORY_SANDBOX_PROVIDER=local',
    `MASTRACODE_LOCAL_SANDBOX_ROOT=${resolve('.state/sandboxes').replaceAll('\\', '/')}`,
    `BARRACKS_FACTORY_DATABASE_URL=file:${resolve('.state/factory.db').replaceAll('\\', '/')}`,
    `FACTORY_CREDENTIAL_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,
    'MASTRACODE_DISPATCH_MAX_IN_FLIGHT=2',
    '',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
  console.log('Created ignored local Factory overlay and state directory. Credential values were not printed.');
} else console.log('Preserved existing local Factory overlay.');
