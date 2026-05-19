import { _filterInjector, _aggregateInjector } from '../../src/utils/softDeletePlugin';

describe('softDeletePlugin filter injection', () => {
  it('injects {deletedAt: null} when caller did not opt-in', () => {
    const out = _filterInjector({ userId: 'u1' }, false);
    expect(out).toEqual({ userId: 'u1', deletedAt: null });
  });

  it('does NOT inject when withDeleted=true', () => {
    const out = _filterInjector({ userId: 'u1' }, true);
    expect(out).toEqual({ userId: 'u1' });
  });

  it('preserves caller-supplied deletedAt filter (so findDeleted etc. work)', () => {
    const out = _filterInjector({ deletedAt: { $ne: null } }, false);
    expect(out).toEqual({ deletedAt: { $ne: null } });
  });

  it('keeps merging caller filter unchanged otherwise', () => {
    const out = _filterInjector({ userId: 'u1', priority: 'high' }, false);
    expect(out.userId).toBe('u1');
    expect(out.priority).toBe('high');
    expect(out.deletedAt).toBeNull();
  });
});

describe('softDeletePlugin aggregate injection', () => {
  it('prepends $match {deletedAt: null} to an empty pipeline', () => {
    const out = _aggregateInjector([], false);
    expect(out).toEqual([{ $match: { deletedAt: null } }]);
  });

  it('prepends $match when first stage is not $match', () => {
    const pipeline = [{ $group: { _id: '$tag' } }];
    expect(_aggregateInjector(pipeline, false)).toEqual([
      { $match: { deletedAt: null } },
      { $group: { _id: '$tag' } },
    ]);
  });

  it('prepends $match when first $match does not mention deletedAt', () => {
    const pipeline = [{ $match: { userId: 'u1' } }];
    expect(_aggregateInjector(pipeline, false)).toEqual([
      { $match: { deletedAt: null } },
      { $match: { userId: 'u1' } },
    ]);
  });

  it('leaves pipeline alone when first $match already filters deletedAt', () => {
    const pipeline = [{ $match: { deletedAt: { $ne: null } } }];
    expect(_aggregateInjector(pipeline, false)).toEqual(pipeline);
  });

  it('does NOT inject when withDeleted=true', () => {
    const pipeline = [{ $group: { _id: '$x' } }];
    expect(_aggregateInjector(pipeline, true)).toEqual(pipeline);
  });
});
