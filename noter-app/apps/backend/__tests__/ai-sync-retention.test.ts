/// <reference types="jest" />

describe('ai sync retention config', () => {
  const originalRetentionDays = process.env.AI_SYNC_RETENTION_DAYS;

  afterEach(() => {
    if (originalRetentionDays === undefined) {
      delete process.env.AI_SYNC_RETENTION_DAYS;
    } else {
      process.env.AI_SYNC_RETENTION_DAYS = originalRetentionDays;
    }
    jest.resetModules();
  });

  it('uses 180 days by default', () => {
    delete process.env.AI_SYNC_RETENTION_DAYS;
    const retention = require('../src/utils/aiSyncRetention');
    expect(retention.getAiSyncRetentionDays()).toBe(180);
    expect(retention.getAiSyncRetentionSeconds()).toBe(180 * 24 * 60 * 60);
  });

  it('accepts env override inside safe bounds', () => {
    process.env.AI_SYNC_RETENTION_DAYS = '30';
    const retention = require('../src/utils/aiSyncRetention');
    expect(retention.getAiSyncRetentionDays()).toBe(30);
    expect(retention.getAiSyncRetentionSeconds()).toBe(30 * 24 * 60 * 60);
  });

  it('clamps invalid low and high values', () => {
    process.env.AI_SYNC_RETENTION_DAYS = '0';
    let retention = require('../src/utils/aiSyncRetention');
    expect(retention.getAiSyncRetentionDays()).toBe(1);

    jest.resetModules();
    process.env.AI_SYNC_RETENTION_DAYS = '99999';
    retention = require('../src/utils/aiSyncRetention');
    expect(retention.getAiSyncRetentionDays()).toBe(3650);
  });
});
