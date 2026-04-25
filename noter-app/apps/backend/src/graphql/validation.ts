import {
  type ASTNode,
  type DefinitionNode,
  type FieldNode,
  GraphQLError,
  Kind,
  type OperationDefinitionNode,
  type SelectionNode,
  type ValidationContext,
} from 'graphql';

const DEFAULT_GRAPHQL_MAX_DEPTH = 6;
const DEFAULT_GRAPHQL_MAX_FIELDS = 80;
const DEFAULT_GRAPHQL_MAX_COMPLEXITY = 120;

const parsePositiveInt = (raw: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(String(raw || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const getGraphqlMaxDepth = () =>
  parsePositiveInt(process.env.GRAPHQL_MAX_DEPTH, DEFAULT_GRAPHQL_MAX_DEPTH);

export const getGraphqlMaxFields = () =>
  parsePositiveInt(process.env.GRAPHQL_MAX_FIELDS, DEFAULT_GRAPHQL_MAX_FIELDS);

export const getGraphqlMaxComplexity = () =>
  parsePositiveInt(process.env.GRAPHQL_MAX_COMPLEXITY, DEFAULT_GRAPHQL_MAX_COMPLEXITY);

type OperationStats = {
  maxDepth: number;
  fieldCount: number;
  complexity: number;
};

const ROOT_FIELD_WEIGHTS: Record<string, number> = {
  notes: 24,
  tasks: 24,
  note: 6,
  task: 6,
  createNote: 10,
  updateNote: 10,
  deleteNote: 4,
  createTask: 10,
  updateTask: 10,
  deleteTask: 4,
};

const getFieldComplexity = (fieldName: string, depth: number) => {
  if (depth === 1) return ROOT_FIELD_WEIGHTS[fieldName] ?? 3;
  return 1;
};

const buildFragmentMap = (definitions: readonly DefinitionNode[]) => {
  const fragments = new Map<string, ASTNode>();
  definitions.forEach((definition) => {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      fragments.set(definition.name.value, definition);
    }
  });
  return fragments;
};

const visitSelection = (
  selection: SelectionNode,
  currentDepth: number,
  stats: OperationStats,
  fragments: Map<string, ASTNode>,
  activeFragments: Set<string>,
): void => {
  if (selection.kind === Kind.FIELD) {
    const field = selection as FieldNode;
    const nextDepth = currentDepth + 1;
    stats.fieldCount += 1;
    stats.maxDepth = Math.max(stats.maxDepth, nextDepth);
    stats.complexity += getFieldComplexity(field.name.value, nextDepth);
    if (!field.selectionSet) return;
    field.selectionSet.selections.forEach((child) => {
      visitSelection(child, nextDepth, stats, fragments, activeFragments);
    });
    return;
  }

  if (selection.kind === Kind.INLINE_FRAGMENT) {
    selection.selectionSet.selections.forEach((child) => {
      visitSelection(child, currentDepth, stats, fragments, activeFragments);
    });
    return;
  }

  if (selection.kind === Kind.FRAGMENT_SPREAD) {
    const name = selection.name.value;
    if (activeFragments.has(name)) return;
    const fragment = fragments.get(name);
    if (!fragment || fragment.kind !== Kind.FRAGMENT_DEFINITION) return;
    activeFragments.add(name);
    fragment.selectionSet.selections.forEach((child) => {
      visitSelection(child, currentDepth, stats, fragments, activeFragments);
    });
    activeFragments.delete(name);
  }
};

const computeOperationStats = (operation: OperationDefinitionNode, definitions: readonly DefinitionNode[]) => {
  const stats: OperationStats = { maxDepth: 0, fieldCount: 0, complexity: 0 };
  const fragments = buildFragmentMap(definitions);
  operation.selectionSet.selections.forEach((selection) => {
    visitSelection(selection, 0, stats, fragments, new Set<string>());
  });
  return stats;
};

export const graphqlOperationLimitRule = (context: ValidationContext) => {
  return {
    OperationDefinition(node: OperationDefinitionNode) {
      const stats = computeOperationStats(node, context.getDocument().definitions);
      const maxDepth = getGraphqlMaxDepth();
      const maxFields = getGraphqlMaxFields();
      const maxComplexity = getGraphqlMaxComplexity();

      if (stats.maxDepth > maxDepth) {
        context.reportError(new GraphQLError(`GraphQL query depth ${stats.maxDepth} exceeds limit ${maxDepth}`, { nodes: node }));
      }

      if (stats.fieldCount > maxFields) {
        context.reportError(new GraphQLError(`GraphQL field count ${stats.fieldCount} exceeds limit ${maxFields}`, { nodes: node }));
      }

      if (stats.complexity > maxComplexity) {
        context.reportError(new GraphQLError(`GraphQL query complexity ${stats.complexity} exceeds limit ${maxComplexity}`, { nodes: node }));
      }
    },
  };
};
