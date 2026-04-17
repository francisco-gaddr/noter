import { createRequestContextMiddleware } from '../src/middleware/requestContext';

describe('request context middleware', () => {
  it('reuses provided request id and attaches a child logger', () => {
    const childLogger = { info: jest.fn() };
    const baseLogger = { child: jest.fn(() => childLogger) } as any;
    const middleware = createRequestContextMiddleware(baseLogger);
    const finishHandlers: Array<() => void> = [];
    const req: any = {
      headers: { 'x-request-id': 'req-123' },
      method: 'GET',
      originalUrl: '/api/health',
      user: { userId: 'user-1' },
    };
    const res: any = {
      statusCode: 200,
      setHeader: jest.fn(),
      on: jest.fn((event: string, handler: () => void) => {
        if (event === 'finish') finishHandlers.push(handler);
      }),
    };
    const next = jest.fn();

    middleware(req, res, next);
    finishHandlers.forEach((handler) => handler());

    expect(req.requestId).toBe('req-123');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'req-123');
    expect(baseLogger.child).toHaveBeenCalledWith({ requestId: 'req-123' });
    expect(childLogger.info).toHaveBeenCalledWith(
      'HTTP request completed',
      expect.objectContaining({
        method: 'GET',
        path: '/api/health',
        status: 200,
        userId: 'user-1',
      }),
    );
    expect(next).toHaveBeenCalled();
  });
});
