declare module 'graphql-http/lib/use/express' {
  import { GraphQLSchema } from 'graphql';
  import { RequestHandler } from 'express';

  type HandlerOptions = {
    schema: GraphQLSchema;
    context?: (req: unknown, res: unknown) => any;
  };

  export function createHandler(options: HandlerOptions): RequestHandler;
}
