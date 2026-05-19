import Joi from 'joi';
import { validate, validateBody, validateQuery, validateParams, schemas } from '../../src/middleware/validate';
import { BadRequestError, isHttpError } from '../../src/utils/httpErrors';

const run = (mw: ReturnType<typeof validate>, req: any) => new Promise<Error | null>((resolve) => {
  mw(req, {} as any, (err?: unknown) => resolve((err as Error) || null));
});

describe('validate middleware', () => {
  it('passes through when body matches schema, strips unknown', async () => {
    const schema = Joi.object({ name: Joi.string().required() });
    const req: any = { body: { name: 'Alice', extra: 'should-be-stripped' } };
    const err = await run(validate(schema), req);
    expect(err).toBeNull();
    expect(req.body).toEqual({ name: 'Alice' });
  });

  it('returns typed BadRequestError on schema violation', async () => {
    const schema = Joi.object({ name: Joi.string().required() });
    const req: any = { body: { other: 'no name here' } };
    const err = await run(validate(schema), req);
    expect(err).toBeInstanceOf(BadRequestError);
    expect(isHttpError(err!)).toBe(true);
  });

  it('reports every validation issue (abortEarly false)', async () => {
    const schema = Joi.object({
      email: Joi.string().email().required(),
      age: Joi.number().min(0).required(),
    });
    const req: any = { body: { email: 'not-email', age: -1 } };
    const err = await run(validate(schema), req);
    expect(err).toBeInstanceOf(BadRequestError);
    const details = (err as BadRequestError).details?.issues as Array<{ path: string }>;
    expect(details.length).toBe(2);
    expect(details.map((d) => d.path).sort()).toEqual(['age', 'email']);
  });

  it('validateBody / validateQuery / validateParams write back to the right source', async () => {
    const schema = Joi.object({ limit: Joi.number().integer().min(1).default(10) });
    {
      const req: any = { query: {} };
      await run(validateQuery(schema), req);
      expect(req.query.limit).toBe(10);
    }
    {
      const req: any = { params: { limit: '5' } };
      await run(validateParams(schema), req);
      expect(req.params.limit).toBe(5); // Joi convert: true
    }
    {
      const req: any = { body: { limit: '7' } };
      await run(validateBody(schema), req);
      expect(req.body.limit).toBe(7);
    }
  });

  it('common ObjectId schema accepts 24-char hex', async () => {
    const schema = Joi.object({ id: schemas.objectId.required() });
    const req: any = { body: { id: '507f1f77bcf86cd799439011' } };
    expect(await run(validate(schema), req)).toBeNull();
  });

  it('common ObjectId rejects shorter/longer strings', async () => {
    const schema = Joi.object({ id: schemas.objectId.required() });
    const req: any = { body: { id: 'nope' } };
    expect(await run(validate(schema), req)).toBeInstanceOf(BadRequestError);
  });

  it('allowUnknown=true preserves extra fields', async () => {
    const schema = Joi.object({ name: Joi.string().required() });
    const req: any = { body: { name: 'A', extra: 'kept' } };
    await run(validate(schema, { allowUnknown: true }), req);
    expect(req.body.extra).toBe('kept');
  });
});
