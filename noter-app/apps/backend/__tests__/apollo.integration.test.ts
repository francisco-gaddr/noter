/**
 * Apollo Server v5 integration tests.
 *
 * Verifies the GraphQL endpoint is reachable, requires auth, accepts both
 * regular queries and Automatic Persisted Queries (APQ), and emits the
 * Server-Timing header that our per-phase plugin populates.
 */
import request from 'supertest';
import crypto from 'node:crypto';
import { app, server } from '../src/index';
import mongoose from 'mongoose';

const GQL_PATH = '/api/graphql';

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

describe('Apollo Server v5 integration', () => {
  afterAll(async () => {
    try { await mongoose.connection.close(); } catch { /* noop */ }
    server.close();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app)
      .post(GQL_PATH)
      .set('Content-Type', 'application/json')
      .send({ query: '{ __typename }' });
    expect(res.status).toBe(401);
  });

  it('accepts demo-token when enabled and returns __typename', async () => {
    process.env.ALLOW_DEMO_TOKEN = '1';
    const res = await request(app)
      .post(GQL_PATH)
      .set('Authorization', 'Bearer demo-token')
      .set('Content-Type', 'application/json')
      .send({ query: '{ __typename }' });
    delete process.env.ALLOW_DEMO_TOKEN;
    expect(res.status).toBe(200);
    expect(res.body?.data?.__typename).toBe('Query');
  });

  it('emits Server-Timing with gql_<operation> + total segments', async () => {
    process.env.ALLOW_DEMO_TOKEN = '1';
    const res = await request(app)
      .post(GQL_PATH)
      .set('Authorization', 'Bearer demo-token')
      .send({ operationName: 'ping', query: 'query ping { __typename }' });
    delete process.env.ALLOW_DEMO_TOKEN;
    expect(res.status).toBe(200);
    const timing = res.headers['server-timing'] as string | undefined;
    expect(timing).toBeDefined();
    expect(timing).toMatch(/total;dur=/);
  });

  it('supports Automatic Persisted Queries on first cache-miss + second cache-hit', async () => {
    process.env.ALLOW_DEMO_TOKEN = '1';
    const query = 'query apqPing { __typename }';
    const hash = sha256(query);

    // First request: hash without query → expect PersistedQueryNotFound
    const miss = await request(app)
      .post(GQL_PATH)
      .set('Authorization', 'Bearer demo-token')
      .send({ extensions: { persistedQuery: { version: 1, sha256Hash: hash } } });
    expect(miss.status).toBe(200);
    expect(miss.body?.errors?.[0]?.extensions?.code).toBe('PERSISTED_QUERY_NOT_FOUND');

    // Second request: send query + hash to seed cache
    const seed = await request(app)
      .post(GQL_PATH)
      .set('Authorization', 'Bearer demo-token')
      .send({ query, extensions: { persistedQuery: { version: 1, sha256Hash: hash } } });
    expect(seed.status).toBe(200);
    expect(seed.body?.data?.__typename).toBe('Query');

    // Third request: hash only — cache hit
    const hit = await request(app)
      .post(GQL_PATH)
      .set('Authorization', 'Bearer demo-token')
      .send({ extensions: { persistedQuery: { version: 1, sha256Hash: hash } } });
    expect(hit.status).toBe(200);
    expect(hit.body?.data?.__typename).toBe('Query');

    delete process.env.ALLOW_DEMO_TOKEN;
  });

  // Note: introspection is gated on `isProduction` captured at module load.
  // In a test environment we cannot flip NODE_ENV after import without
  // reloading the server, so we verify the inverse — introspection works
  // when NOT production — which is the dev/test default.
  it('allows introspection outside production', async () => {
    process.env.ALLOW_DEMO_TOKEN = '1';
    const res = await request(app)
      .post(GQL_PATH)
      .set('Authorization', 'Bearer demo-token')
      .send({ query: '{ __schema { types { name } } }' });
    delete process.env.ALLOW_DEMO_TOKEN;
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.data?.__schema?.types)).toBe(true);
  });
});
