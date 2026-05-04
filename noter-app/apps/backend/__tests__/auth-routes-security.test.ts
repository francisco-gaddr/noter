import request from 'supertest';

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(async ({ username }: { username: string }) => {
      if (username === 'user') {
        return { _id: 'u1', username: 'user', passwordHash: '$2b$12$90hPdzA7y6QAYnltj7LjY.BM7rjOADfVv8BfS7kqkQxB7MlMijH7e' };
      }
      return null;
    }),
  },
}));

import { app, server } from '../src/index';

describe('Auth route security', () => {
  afterAll(() => {
    server.close();
  });

  it('rejects short password on register', async () => {
    const res = await request(app).post('/api/auth/register').send({
      username: 'newuser',
      password: '1234567',
    });
    expect(res.status).toBe(400);
  });

  it('validates required fields on login', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'user' });
    expect(res.status).toBe(400);
  });

  it('rejects non-alphanumeric username on login', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'user!', password: 'password123' });
    expect(res.status).toBe(400);
  });

  it('rejects overly long username and password on login', async () => {
    const res = await request(app).post('/api/auth/login').send({
      username: 'a'.repeat(31),
      password: 'a'.repeat(129),
    });
    expect(res.status).toBe(400);
  });
});
