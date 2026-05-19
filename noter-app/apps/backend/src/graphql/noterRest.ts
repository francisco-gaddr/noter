/**
 * @noterRest directive equivalent for our programmatically-built GraphQL schema.
 *
 * SDL would let us write `@noterRest(method: "GET", path: "/api/notes")` on
 * Query/Mutation fields; graphql-js's `extensions` is the supported equivalent.
 *
 * Convention: every field that has a 1:1 REST sibling registers itself below.
 * The OpenAPI 3.1 generator walks `toolSchema` + this map to derive paths,
 * parameters and request/response shapes from the existing GraphQL types.
 */

export type NoterRestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface NoterRestBinding {
  method: NoterRestMethod;
  path: string;
  summary: string;
  /** GraphQL field key (e.g. "Query.notes" or "Mutation.createNote") that this REST endpoint mirrors. */
  graphqlField: string;
  /** Optional explicit success status; defaults to 200 / 201 (POST) / 204 (DELETE). */
  successStatus?: number;
  /** Whether the path is protected by authMiddleware (default: true). */
  requiresAuth?: boolean;
}

export const NOTER_REST_BINDINGS: NoterRestBinding[] = [
  {
    method: 'GET',
    path: '/api/notes',
    summary: 'List notes for current user',
    graphqlField: 'Query.notes',
  },
  {
    method: 'GET',
    path: '/api/notes/{id}',
    summary: 'Fetch a single note',
    graphqlField: 'Query.note',
  },
  {
    method: 'POST',
    path: '/api/notes',
    summary: 'Create a note',
    graphqlField: 'Mutation.createNote',
    successStatus: 201,
  },
  {
    method: 'PATCH',
    path: '/api/notes/{id}',
    summary: 'Update an existing note',
    graphqlField: 'Mutation.updateNote',
  },
  {
    method: 'DELETE',
    path: '/api/notes/{id}',
    summary: 'Delete a note',
    graphqlField: 'Mutation.deleteNote',
    successStatus: 204,
  },
  {
    method: 'GET',
    path: '/api/tasks',
    summary: 'List tasks for current user',
    graphqlField: 'Query.tasks',
  },
  {
    method: 'GET',
    path: '/api/tasks/{id}',
    summary: 'Fetch a single task',
    graphqlField: 'Query.task',
  },
  {
    method: 'POST',
    path: '/api/tasks',
    summary: 'Create a task',
    graphqlField: 'Mutation.createTask',
    successStatus: 201,
  },
  {
    method: 'PATCH',
    path: '/api/tasks/{id}',
    summary: 'Update an existing task',
    graphqlField: 'Mutation.updateTask',
  },
  {
    method: 'DELETE',
    path: '/api/tasks/{id}',
    summary: 'Delete a task',
    graphqlField: 'Mutation.deleteTask',
    successStatus: 204,
  },
];
