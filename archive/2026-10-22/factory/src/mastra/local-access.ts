import { SimpleAuth, getWebRequest, type MastraAuthRequest } from '@mastra/core/server';

const user = { id: 'barracks-local', name: 'Local operator', organizationId: 'barracks-local' };
const origins = new Set(['http://localhost:4111', 'http://127.0.0.1:4111']);

/** Single local operator identity for the loopback-only development server. */
export class LocalDevelopmentAccess extends SimpleAuth<typeof user> {
  constructor() {
    super({ name: 'barracks-local', tokens: {} });
    if (process.env.NODE_ENV !== 'development') {
      throw new Error('LocalDevelopmentAccess requires NODE_ENV=development and a loopback listener.');
    }
  }

  override async authenticateToken(_token: string, request: MastraAuthRequest) {
    const raw = getWebRequest(request);
    if (!raw || !origins.has(new URL(raw.url).origin)) return null;
    const origin = raw.headers.get('origin');
    if (origin && !origins.has(origin)) return null;
    if (raw.headers.get('sec-fetch-site') === 'cross-site') return null;
    return { ...user };
  }
}
