/**
 * Auto-derive an OpenAPI 3.1 document from the GraphQL schema + @noterRest bindings.
 *
 * Run: pnpm --filter backend run docs:openapi
 *
 * Strategy:
 *  - Read NOTER_REST_BINDINGS to determine which GraphQL fields surface as REST.
 *  - Walk the GraphQL schema and turn each named type into an OpenAPI component schema.
 *  - For each binding, derive parameters from {pathParam} placeholders + GraphQL args,
 *    derive request body from input types, derive responses from the field return type.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  type GraphQLSchema,
  type GraphQLField,
  type GraphQLInputType,
  type GraphQLOutputType,
  type GraphQLNamedType,
  type GraphQLObjectType,
  type GraphQLInputObjectType,
  isInputObjectType,
  isObjectType,
  isListType,
  isNonNullType,
  isScalarType,
  isEnumType,
} from 'graphql';
import { toolSchema } from '../graphql/schema';
import { NOTER_REST_BINDINGS, type NoterRestBinding } from '../graphql/noterRest';

type JsonSchema = Record<string, unknown>;

const scalarToJsonSchema = (name: string): JsonSchema => {
  switch (name) {
    case 'String': return { type: 'string' };
    case 'Int': return { type: 'integer', format: 'int32' };
    case 'Float': return { type: 'number' };
    case 'Boolean': return { type: 'boolean' };
    case 'ID': return { type: 'string' };
    default: return { type: 'string', description: `GraphQL scalar ${name}` };
  }
};

const typeRefName = (t: GraphQLOutputType | GraphQLInputType): string | undefined => {
  let cur: GraphQLOutputType | GraphQLInputType = t;
  while (isNonNullType(cur) || isListType(cur)) {
    cur = cur.ofType as any;
  }
  if (isObjectType(cur) || isInputObjectType(cur) || isScalarType(cur) || isEnumType(cur)) {
    return cur.name;
  }
  return undefined;
};

const typeToOpenApi = (
  t: GraphQLOutputType | GraphQLInputType,
  registerComponent: (named: GraphQLNamedType) => void,
): JsonSchema => {
  if (isNonNullType(t)) {
    const inner = typeToOpenApi(t.ofType as any, registerComponent);
    return inner;
  }
  if (isListType(t)) {
    return {
      type: 'array',
      items: typeToOpenApi(t.ofType as any, registerComponent),
    };
  }
  if (isScalarType(t)) {
    return scalarToJsonSchema(t.name);
  }
  if (isEnumType(t)) {
    return { type: 'string', enum: t.getValues().map((v) => v.name) };
  }
  if (isObjectType(t) || isInputObjectType(t)) {
    registerComponent(t);
    return { $ref: `#/components/schemas/${t.name}` };
  }
  return { type: 'string' };
};

const buildComponentSchema = (
  t: GraphQLObjectType | GraphQLInputObjectType,
  registerComponent: (named: GraphQLNamedType) => void,
): JsonSchema => {
  const fields = t.getFields();
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [name, field] of Object.entries(fields)) {
    const fieldType = (field as any).type as GraphQLOutputType | GraphQLInputType;
    properties[name] = typeToOpenApi(fieldType, registerComponent);
    if (isNonNullType(fieldType)) required.push(name);
  }
  const schema: JsonSchema = { type: 'object', properties };
  if (required.length > 0) schema.required = required;
  return schema;
};

const extractPathParams = (urlPath: string): string[] => {
  const matches = urlPath.match(/\{([^}]+)\}/g) || [];
  return matches.map((m) => m.slice(1, -1));
};

const resolveBindingField = (
  schema: GraphQLSchema,
  graphqlField: string,
): GraphQLField<any, any> | undefined => {
  const [root, name] = graphqlField.split('.');
  if (root === 'Query') return schema.getQueryType()?.getFields()[name];
  if (root === 'Mutation') return schema.getMutationType()?.getFields()[name];
  return undefined;
};

const defaultSuccessStatus = (method: string): number => {
  if (method === 'POST') return 201;
  if (method === 'DELETE') return 204;
  return 200;
};

const generate = (): JsonSchema => {
  const schema = toolSchema;
  const components: Record<string, JsonSchema> = {};
  const seen = new Set<string>();
  const queue: GraphQLNamedType[] = [];

  const registerComponent = (named: GraphQLNamedType): void => {
    if (seen.has(named.name)) return;
    if (!(isObjectType(named) || isInputObjectType(named))) return;
    seen.add(named.name);
    queue.push(named);
  };

  const paths: Record<string, Record<string, JsonSchema>> = {};

  for (const binding of NOTER_REST_BINDINGS) {
    const field = resolveBindingField(schema, binding.graphqlField);
    if (!field) {
      console.warn(`[openapi] binding refers to missing field: ${binding.graphqlField}`);
      continue;
    }
    const status = binding.successStatus ?? defaultSuccessStatus(binding.method);
    const pathParamNames = extractPathParams(binding.path);
    const parameters: JsonSchema[] = [];
    let requestBody: JsonSchema | undefined;

    for (const arg of field.args) {
      if (pathParamNames.includes(arg.name)) {
        parameters.push({
          name: arg.name,
          in: 'path',
          required: true,
          schema: typeToOpenApi(arg.type, registerComponent),
        });
      } else if (binding.method === 'GET' || binding.method === 'DELETE') {
        parameters.push({
          name: arg.name,
          in: 'query',
          required: isNonNullType(arg.type),
          schema: typeToOpenApi(arg.type, registerComponent),
        });
      } else {
        if (arg.name === 'input') {
          requestBody = {
            required: true,
            content: {
              'application/json': {
                schema: typeToOpenApi(arg.type, registerComponent),
              },
            },
          };
        } else {
          parameters.push({
            name: arg.name,
            in: 'query',
            required: isNonNullType(arg.type),
            schema: typeToOpenApi(arg.type, registerComponent),
          });
        }
      }
    }

    const responses: Record<string, JsonSchema> = {};
    if (status === 204) {
      responses['204'] = { description: 'No content' };
    } else {
      responses[String(status)] = {
        description: 'Success',
        content: {
          'application/json': {
            schema: typeToOpenApi(field.type, registerComponent),
          },
        },
      };
    }
    responses['401'] = { description: 'Unauthorized' };
    responses['400'] = { description: 'Bad request' };

    const op: JsonSchema = {
      summary: binding.summary,
      operationId: binding.graphqlField.replace('.', '_'),
      tags: [binding.graphqlField.split('.')[0]],
      security: binding.requiresAuth === false ? [] : [{ bearerAuth: [] }],
      responses,
    };
    if (parameters.length) op.parameters = parameters;
    if (requestBody) op.requestBody = requestBody;

    if (!paths[binding.path]) paths[binding.path] = {};
    paths[binding.path][binding.method.toLowerCase()] = op;
  }

  while (queue.length) {
    const t = queue.shift()!;
    if (isObjectType(t) || isInputObjectType(t)) {
      components[t.name] = buildComponentSchema(t, registerComponent);
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Noter Backend REST API',
      version: '1.0.0',
      description: 'Auto-derived from GraphQL schema via @noterRest bindings. Do not edit by hand.',
    },
    servers: [{ url: process.env.OPENAPI_SERVER_URL || 'http://localhost:3001' }],
    paths,
    components: {
      schemas: components,
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
  };
};

const main = (): void => {
  const doc = generate();
  const outDir = path.resolve(__dirname, '..', '..', 'docs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'openapi.json');
  fs.writeFileSync(outFile, JSON.stringify(doc, null, 2) + '\n');
  console.log(`[openapi] wrote ${outFile}`);
};

if (require.main === module) {
  main();
}

export { generate };
