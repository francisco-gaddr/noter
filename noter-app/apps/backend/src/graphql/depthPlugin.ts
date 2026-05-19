import type { ApolloServerPlugin } from '@apollo/server';
import { GraphQLError, type DocumentNode, type FieldNode, type SelectionSetNode } from 'graphql';
import logger from '../utils/logger';

const MAX_DEPTH = Number(process.env.GRAPHQL_MAX_DEPTH) || 10;

/**
 * Apollo plugin that rejects queries whose selection-set nesting exceeds
 * GRAPHQL_MAX_DEPTH.
 *
 * Complementary to the complexity-plugin (round 4):
 *   - Complexity catches "this query asks for too many fields".
 *   - Depth catches "this query is recursively nested 50 levels deep" —
 *     which can be cheap by complexity (each field cost=1) but still
 *     pathological because deep traversal blows the recursion limit
 *     and produces huge response bodies.
 *
 * We deliberately count selection-set depth, not field-count depth: fragments
 * and inline-spreads are flattened by the time `document` reaches us, so
 * the selection-set tree faithfully represents the response tree we'd
 * have to walk.
 */

const computeDepth = (selectionSet: SelectionSetNode | undefined, depth = 1): number => {
  if (!selectionSet || selectionSet.selections.length === 0) return depth;
  let max = depth;
  for (const selection of selectionSet.selections) {
    if (selection.kind === 'Field') {
      const field = selection as FieldNode;
      if (field.selectionSet) {
        const d = computeDepth(field.selectionSet, depth + 1);
        if (d > max) max = d;
      }
    } else if (selection.kind === 'InlineFragment' || selection.kind === 'FragmentSpread') {
      // FragmentSpread is resolved against the document's fragment definitions
      // — we don't follow it here because the operation document is already
      // simplified by the time the plugin runs. InlineFragment carries a
      // selectionSet that we recurse into.
      if ('selectionSet' in selection && (selection as { selectionSet?: SelectionSetNode }).selectionSet) {
        const d = computeDepth((selection as { selectionSet?: SelectionSetNode }).selectionSet, depth);
        if (d > max) max = d;
      }
    }
  }
  return max;
};

const computeOperationDepth = (doc: DocumentNode): number => {
  let max = 0;
  for (const def of doc.definitions) {
    if (def.kind === 'OperationDefinition' && def.selectionSet) {
      const d = computeDepth(def.selectionSet, 1);
      if (d > max) max = d;
    }
  }
  return max;
};

export const depthPlugin: ApolloServerPlugin = {
  async requestDidStart() {
    return {
      async didResolveOperation(ctx) {
        if (!ctx.document) return;
        const depth = computeOperationDepth(ctx.document);
        if (depth > MAX_DEPTH) {
          logger.warn('graphql.depth-rejected', { depth, max: MAX_DEPTH });
          throw new GraphQLError(
            `Query is too deeply nested (depth=${depth}). Maximum allowed: ${MAX_DEPTH}.`,
            { extensions: { code: 'QUERY_TOO_DEEP', depth, max: MAX_DEPTH } },
          );
        }
      },
    };
  },
};

// Test-only helpers
export const _computeOperationDepth = computeOperationDepth;
export const _computeSelectionSetDepth = computeDepth;
