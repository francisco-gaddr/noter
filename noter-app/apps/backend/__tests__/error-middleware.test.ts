jest.mock('../src/utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
  },
}));

import type { NextFunction } from 'express';
import logger from '../src/utils/logger';
import { errorHandler } from '../src/middleware/errorMiddleware';

describe('error middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses 500 when statusCode is 200 and hides message in response', () => {
    const req: any = { method: 'GET', originalUrl: '/api/test?x=1' };
    const res: any = { statusCode: 200, status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next: NextFunction = jest.fn();

    errorHandler(new Error('boom'), req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Internal server error',
      stack: expect.any(String),
    });
    expect((logger as any).error).toHaveBeenCalledWith('Unhandled request error', expect.objectContaining({ path: '/api/test?x=1' }));
  });

  it('does not log for non-5xx responses and keeps client error message', () => {
    const req: any = { method: 'POST', path: '/api/test' };
    const res: any = { statusCode: 400, status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next: NextFunction = jest.fn();

    errorHandler(new Error('Bad request message'), req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Bad request message',
      stack: expect.any(String),
    });
    expect((logger as any).error).not.toHaveBeenCalled();
  });

  it('uses request-scoped logger when available', () => {
    const requestLogger = { error: jest.fn() };
    const req: any = { method: 'GET', originalUrl: '/api/test', log: requestLogger };
    const res: any = { statusCode: 200, status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next: NextFunction = jest.fn();

    errorHandler(new Error('boom'), req, res, next);

    expect(requestLogger.error).toHaveBeenCalled();
    expect((logger as any).error).not.toHaveBeenCalled();
  });

  it('nulls stack in production', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const req: any = { method: 'GET', originalUrl: '/api/test' };
    const res: any = { statusCode: 200, status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next: NextFunction = jest.fn();

    errorHandler(new Error('boom'), req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      message: 'Internal server error',
      stack: null,
    });

    process.env.NODE_ENV = previous;
  });
});
