import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { enforceQuota } from '../../src/services/quotaTracker';
import { TooManyRequestsError } from '../../src/utils/httpErrors';

// checkAndIncrement fails OPEN when mongo isn't ready, so the ENFORCEMENT only exists with a DB —
// this proves the quota actually blocks (the backend agent-run fair-use cap relies on it).
let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('enforceQuota (mongo-backed — actually enforces)', () => {
  it('allows up to the day limit, then throws TooManyRequestsError', async () => {
    const u = 'user-a';
    await expect(enforceQuota(u, 'be-runs', { dayLimit: 2 })).resolves.toBeUndefined();
    await expect(enforceQuota(u, 'be-runs', { dayLimit: 2 })).resolves.toBeUndefined();
    await expect(enforceQuota(u, 'be-runs', { dayLimit: 2 })).rejects.toBeInstanceOf(TooManyRequestsError);
  });

  it('is per-user — one user hitting the cap never blocks another', async () => {
    await enforceQuota('user-b', 'be-runs2', { dayLimit: 1 });
    await expect(enforceQuota('user-b', 'be-runs2', { dayLimit: 1 })).rejects.toBeInstanceOf(TooManyRequestsError);
    await expect(enforceQuota('user-c', 'be-runs2', { dayLimit: 1 })).resolves.toBeUndefined();
  });

  it('different quota keys are independent buckets', async () => {
    await enforceQuota('user-d', 'key-x', { dayLimit: 1 });
    await expect(enforceQuota('user-d', 'key-x', { dayLimit: 1 })).rejects.toBeInstanceOf(TooManyRequestsError);
    await expect(enforceQuota('user-d', 'key-y', { dayLimit: 1 })).resolves.toBeUndefined(); // separate key
  });
});
