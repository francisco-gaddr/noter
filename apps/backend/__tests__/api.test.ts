import request from 'supertest';
import { app, server } from '../src/index';
import mongoose from 'mongoose';

describe('Backend API Tests', () => {
  afterAll(async () => {
    await mongoose.connection.close();
    server.close();
  });

  it('GET / should return running status', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toBe('Noter Backend Running');
  });

  // Add more tests here
});
