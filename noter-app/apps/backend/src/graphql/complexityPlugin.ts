import type { ApolloServerPlugin } from '@apollo/server';
import { getComplexity, simpleEstimator, fieldExtensionsEstimator } from 'graphql-query-complexity';
import { GraphQLError, type DocumentNode } from 'graphql';
import logger from '../utils/logger';
import { toolSchema } from './schema';

const MAX_COMPLEXITY = Number(process.env.GRAPHQL_MAX_COMPLEXITY) || 1000;

/**
 * Apollo plugin that rejects queries whose static complexity exceeds
 * `GRAPHQL_MAX_COMPLEXITY`. This is DoS protection: without a bound, a
 * malicious client can ask for deeply-nested fields whose combined
 * resolver cost would chew through the server.
 *
 * Scoring rules (defensive defaults):
 *   - Every field defaults to cost 1 (simpleEstimator)
 *   - Fields can override via `extensions: { complexity: <fn|number> }` in
 *     their GraphQL definition for more accurate scoring (fieldExtensionsEstimator).
 *
 * Limit can be overridden per-request by setting `extensions.maxComplexity`
 * on the request body (caps at the hard MAX). Useful for trusted internal
 * scripts that legitimately need richer queries.
 */
export const complexityPlugin: ApolloServerPlugin = {
  async requestDidStart() {
    return {
      async didResolveOperation(ctx) {
        if (!ctx.document) return;
        const requestedMax = Number((ctx.request.extensions as any)?.maxComplexity);
        const effectiveMax = Number.isFinite(requestedMax) && requestedMax > 0
          ? Math.min(requestedMax, MAX_COMPLEXITY)
          : MAX_COMPLEXITY;

        let complexity: number;
        try {
          complexity = getComplexity({
            schema: toolSchema,
            query: ctx.document as DocumentNode,
            variables: ctx.request.variables as Record<string, unknown> | undefined,
            estimators: [
              fieldExtensionsEstimator(),
              simpleEstimator({ defaultComplexity: 1 }),
            ],
          });
        } catch (err) {
          logger.warn('graphql.complexity-calc-failed', { error: (err as Error)?.message });
          return;
        }

        if (complexity > effectiveMax) {
          logger.warn('graphql.complexity-rejected', { complexity, max: effectiveMax });
          throw new GraphQLError(
            `Query is too complex (${complexity}). Maximum allowed: ${effectiveMax}.`,
            { extensions: { code: 'QUERY_TOO_COMPLEX', complexity, max: effectiveMax } },
          );
        }
      },
    };
  },
};
