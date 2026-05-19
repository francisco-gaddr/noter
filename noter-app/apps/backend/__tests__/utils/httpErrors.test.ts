import {
  HttpError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UnprocessableEntityError,
  TooManyRequestsError,
  ServiceUnavailableError,
  isHttpError,
} from '../../src/utils/httpErrors';

describe('HttpError hierarchy', () => {
  it('BadRequestError carries 400 + BAD_REQUEST code', () => {
    const e = new BadRequestError('nope');
    expect(e.status).toBe(400);
    expect(e.code).toBe('BAD_REQUEST');
    expect(e.expose).toBe(true);
  });

  it('UnauthorizedError carries 401 + UNAUTHORIZED', () => {
    expect(new UnauthorizedError().status).toBe(401);
    expect(new UnauthorizedError().code).toBe('UNAUTHORIZED');
  });

  it('ForbiddenError, NotFoundError, ConflictError', () => {
    expect(new ForbiddenError().status).toBe(403);
    expect(new NotFoundError().status).toBe(404);
    expect(new ConflictError().status).toBe(409);
  });

  it('UnprocessableEntity + TooManyRequests + ServiceUnavailable', () => {
    expect(new UnprocessableEntityError().status).toBe(422);
    expect(new TooManyRequestsError().status).toBe(429);
    expect(new ServiceUnavailableError().status).toBe(503);
  });

  it('expose defaults: 4xx → true, 5xx → false', () => {
    expect(new BadRequestError().expose).toBe(true);
    expect(new ServiceUnavailableError().expose).toBe(false);
  });

  it('expose can be overridden', () => {
    expect(new ServiceUnavailableError('m', { expose: true }).expose).toBe(true);
    expect(new BadRequestError('m', { expose: false }).expose).toBe(false);
  });

  it('custom code overrides the default', () => {
    expect(new BadRequestError('m', { code: 'CUSTOM_CODE' }).code).toBe('CUSTOM_CODE');
  });

  it('toClientJSON includes details when exposed', () => {
    const e = new BadRequestError('bad input', { details: { field: 'email' } });
    expect(e.toClientJSON()).toEqual({
      message: 'bad input',
      code: 'BAD_REQUEST',
      details: { field: 'email' },
    });
  });

  it('toClientJSON sanitises message for non-exposed errors', () => {
    const e = new HttpError(500, 'database password is wrong', { expose: false });
    expect(e.toClientJSON()).toEqual({
      message: 'Internal server error',
      code: 'INTERNAL',
    });
  });

  it('isHttpError type guard', () => {
    expect(isHttpError(new BadRequestError())).toBe(true);
    expect(isHttpError(new Error('plain'))).toBe(false);
    expect(isHttpError('string')).toBe(false);
    expect(isHttpError(null)).toBe(false);
  });

  it('preserves cause chain', () => {
    const inner = new Error('inner');
    const e = new BadRequestError('outer', { cause: inner });
    expect((e as Error & { cause?: Error }).cause).toBe(inner);
  });

  it('instanceof works correctly (subclass relations)', () => {
    const e = new NotFoundError();
    expect(e instanceof NotFoundError).toBe(true);
    expect(e instanceof HttpError).toBe(true);
    expect(e instanceof Error).toBe(true);
  });
});
