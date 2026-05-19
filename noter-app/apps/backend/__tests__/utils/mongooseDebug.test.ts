// We must mock both mongoose and our logger before requiring mongooseDebug.
const debugCalls: Array<{ level: string; meta: any }> = [];
let installedFn: ((coll: string, op: string, ...args: unknown[]) => void) | null = null;

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: {
    debug: (msg: string, meta: any) => debugCalls.push({ level: 'debug', meta }),
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}));

jest.mock('mongoose', () => {
  return {
    __esModule: true,
    default: {
      set: (key: string, value: unknown) => {
        if (key === 'debug' && typeof value === 'function') {
          installedFn = value as (coll: string, op: string, ...args: unknown[]) => void;
        }
      },
    },
  };
});

const reinstall = () => {
  installedFn = null;
  debugCalls.length = 0;
  jest.isolateModules(() => {
    const { installMongooseDebug } = require('../../src/utils/mongooseDebug');
    installMongooseDebug();
  });
};

describe('mongooseDebug redactor', () => {
  beforeEach(() => {
    installedFn = null;
    debugCalls.length = 0;
  });

  it('does not install in default node-env (production)', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.MONGOOSE_DEBUG;
    reinstall();
    expect(installedFn).toBeNull();
  });

  it('installs in staging', () => {
    process.env.NODE_ENV = 'staging';
    reinstall();
    expect(installedFn).not.toBeNull();
  });

  it('installs when MONGOOSE_DEBUG=true', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGOOSE_DEBUG = 'true';
    reinstall();
    delete process.env.MONGOOSE_DEBUG;
    expect(installedFn).not.toBeNull();
  });

  it('redacts password / token / secret / email PII keys, leaves non-PII alone', () => {
    process.env.NODE_ENV = 'staging';
    reinstall();
    installedFn!('users', 'findOne', {
      username: 'alice',           // non-PII: visible
      email: 'a@b.c',              // PII: redacted
      password: 'plain',           // redacted
      authorization: 'Bearer xyz', // redacted
    });
    expect(debugCalls).toHaveLength(1);
    const args = debugCalls[0].meta.args as any[];
    expect(args[0].username).toBe('alice');
    expect(args[0].email).toBe('[REDACTED]');
    expect(args[0].password).toBe('[REDACTED]');
    expect(args[0].authorization).toBe('[REDACTED]');
  });

  it('redacts encrypted column names by convention (title / content / iv)', () => {
    process.env.NODE_ENV = 'staging';
    reinstall();
    installedFn!('notes', 'updateOne', { _id: '1' }, { $set: { title: 'top-secret', content: 'body', iv: 'AAAA' } });
    expect(debugCalls).toHaveLength(1);
    const args = debugCalls[0].meta.args as any[];
    expect(args[1].$set.title).toBe('[REDACTED]');
    expect(args[1].$set.content).toBe('[REDACTED]');
    expect(args[1].$set.iv).toBe('[REDACTED]');
  });

  it('truncates long string values on non-sensitive keys', () => {
    process.env.NODE_ENV = 'staging';
    reinstall();
    const long = 'x'.repeat(200);
    installedFn!('notes', 'findOne', { slug: long });
    const args = debugCalls[0].meta.args as any[];
    expect(typeof args[0].slug).toBe('string');
    expect(args[0].slug.length).toBeLessThan(80);
    expect(args[0].slug).toContain('…');
  });
});
