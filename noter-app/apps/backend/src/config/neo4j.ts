/**
 * Selective Neo4j sync config + a thin HTTP relay to a SELF-HOSTED Neo4j (its built-in
 * transactional Cypher HTTP API — no driver dependency). Opt-in and off by default.
 *
 * Security model (see Doc/nextcloud-ingestion.md + ADR 0011):
 *   - Neo4j lives on the internal Docker network only (never published).
 *   - The DEVICE computes the lock-safe selection + parameterized Cypher on-device and POSTs
 *     it here; this relay only enforces the authenticated userId on every statement and
 *     forwards an allowlisted set of statement shapes — a client can NEVER inject arbitrary
 *     Cypher or write to another user's nodes.
 *   - NEO4J_ENABLED!=1 → the channel is hard-off (route returns 404).
 */

const isOn = (v: string | undefined): boolean => {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'on' || s === 'yes';
};

export const isNeo4jEnabled = (): boolean => isOn(process.env.NEO4J_ENABLED);

export const neo4jHttpUrl = (): string =>
  (process.env.NEO4J_HTTP_URL || 'http://neo4j:7474').replace(/\/+$/, '');

export const neo4jDatabase = (): string => process.env.NEO4J_DATABASE || 'neo4j';
const neo4jUser = (): string => process.env.NEO4J_USER || 'neo4j';
const neo4jPassword = (): string => process.env.NEO4J_PASSWORD || '';

export const neo4jStatus = () => ({ enabled: isNeo4jEnabled(), database: neo4jDatabase() });

/**
 * Allowlist of the exact statement shapes our shared neo4jSync module emits. Anything else
 * is rejected — the relay will never forward arbitrary Cypher.
 */
const ALLOWED_STATEMENTS: RegExp[] = [
  // Node upsert — fully anchored to the exact shape neo4jSync.buildCypherSync emits, so no
  // trailing clause (e.g. `WITH n MATCH (m) DETACH DELETE m`) can ride along after the SET.
  /^MERGE \(n:NoterNode \{uid:\$uid\}\) SET n\.kind=\$kind, n\.title=\$title, n\.userId=\$userId(, n\.body=\$body)?$/,
  /^MATCH \(a:NoterNode \{uid:\$s\}\), \(b:NoterNode \{uid:\$t\}\) MERGE \(a\)-\[r:[A-Z_]+\]->\(b\)$/,
  /^MATCH \(n:NoterNode \{userId:\$userId\}\) WHERE NOT n\.uid IN \$keep DETACH DELETE n$/,
];

export interface RelayStatement {
  text: string;
  params: Record<string, unknown>;
}

export const isAllowedStatement = (text: string): boolean =>
  ALLOWED_STATEMENTS.some((re) => re.test(text));

export interface RelayResult {
  ok: boolean;
  applied: number;
  error?: string;
}

/**
 * Forward validated statements to Neo4j's transactional HTTP endpoint in one commit.
 * `userId` is injected authoritatively on every statement (tenant isolation) — the client's
 * own userId param is ignored.
 */
export const relayToNeo4j = async (
  userId: string,
  statements: RelayStatement[],
): Promise<RelayResult> => {
  if (!isNeo4jEnabled()) return { ok: false, applied: 0, error: 'Neo4j-sync är avstängd' };

  const safe = statements.filter((s) => s && typeof s.text === 'string' && isAllowedStatement(s.text));
  if (safe.length === 0) return { ok: true, applied: 0 };

  const body = {
    statements: safe.map((s) => ({
      statement: s.text,
      parameters: { ...(s.params || {}), userId }, // authoritative userId overrides client
    })),
  };

  const auth = Buffer.from(`${neo4jUser()}:${neo4jPassword()}`).toString('base64');
  const url = `${neo4jHttpUrl()}/db/${encodeURIComponent(neo4jDatabase())}/tx/commit`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return { ok: false, applied: 0, error: `Neo4j HTTP ${res.status}` };
  }
  const json: any = await res.json().catch(() => ({}));
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    return { ok: false, applied: 0, error: json.errors[0]?.message || 'Neo4j-fel' };
  }
  return { ok: true, applied: safe.length };
};
