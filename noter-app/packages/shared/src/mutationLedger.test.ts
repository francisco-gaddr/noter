import { createAppliedLedger, applyMutationsOnce, DEFAULT_LEDGER_SIZE, POISON_MUTATION_MAX_ATTEMPTS } from './mutationLedger';

describe('createAppliedLedger', () => {
  it('tracks added ids and ignores empty/duplicate adds', () => {
    const l = createAppliedLedger();
    expect(l.has('a')).toBe(false);
    l.add('a');
    l.add('a'); // duplicate — no double count
    l.add(''); // empty — ignored
    expect(l.has('a')).toBe(true);
    expect(l.size()).toBe(1);
  });

  it('evicts the oldest id once over capacity (bounded FIFO)', () => {
    const l = createAppliedLedger(3);
    l.add('a'); l.add('b'); l.add('c');
    expect(l.size()).toBe(3);
    l.add('d'); // pushes out 'a'
    expect(l.has('a')).toBe(false);
    expect(l.has('d')).toBe(true);
    expect(l.size()).toBe(3);
  });

  it('defaults to a sane replay horizon', () => {
    expect(DEFAULT_LEDGER_SIZE).toBeGreaterThanOrEqual(100);
  });
});

describe('applyMutationsOnce', () => {
  const m = (id: string) => ({ id });

  it('applies each new mutation once and returns its id to ack', async () => {
    const l = createAppliedLedger();
    const applied: string[] = [];
    const ack = await applyMutationsOnce([m('1'), m('2')], l, async (x) => { applied.push(x.id); });
    expect(applied).toEqual(['1', '2']);
    expect(ack).toEqual(['1', '2']);
  });

  it('does NOT re-apply a redelivered mutation but still re-acks it (no duplicates)', async () => {
    const l = createAppliedLedger();
    const applied: string[] = [];
    await applyMutationsOnce([m('1')], l, async (x) => { applied.push(x.id); });
    // Same mutation comes back (a lost ACK): it must be re-acked but NOT applied again.
    const ack = await applyMutationsOnce([m('1'), m('2')], l, async (x) => { applied.push(x.id); });
    expect(applied).toEqual(['1', '2']); // '1' applied once, '2' applied once
    expect(ack).toEqual(['1', '2']); // both acked (so the server drops them)
  });

  it('leaves a failed mutation un-acked + un-recorded so it retries next drain', async () => {
    const l = createAppliedLedger();
    const ack = await applyMutationsOnce([m('1'), m('2')], l, async (x) => {
      if (x.id === '1') throw new Error('apply failed');
    });
    expect(ack).toEqual(['2']); // only the successful one is acked
    expect(l.has('1')).toBe(false); // failed one is not recorded → will retry
    expect(l.has('2')).toBe(true);
  });

  it('skips malformed mutations without an id and never throws', async () => {
    const l = createAppliedLedger();
    const ack = await applyMutationsOnce(
      [m('1'), {} as any, { id: '' } as any, null as any],
      l,
      async () => {},
    );
    expect(ack).toEqual(['1']);
  });
});

describe('poison-mutation quarantine', () => {
  const m = (id: string) => ({ id, kind: 'noop' });
  it('acks-and-drops a mutation after POISON_MUTATION_MAX_ATTEMPTS failures, and reports it', async () => {
    const l = createAppliedLedger();
    const quarantined: string[] = [];
    const alwaysFails = async () => { throw new Error('permanent 4xx'); };
    for (let i = 0; i < POISON_MUTATION_MAX_ATTEMPTS - 1; i += 1) {
      const ack = await applyMutationsOnce([m('poison')], l, alwaysFails, (mu) => quarantined.push(mu.id));
      expect(ack).toEqual([]); // still retrying
    }
    const finalAck = await applyMutationsOnce([m('poison')], l, alwaysFails, (mu) => quarantined.push(mu.id));
    expect(finalAck).toEqual(['poison']);      // quarantined: acked so the server drops it
    expect(quarantined).toEqual(['poison']);   // and the caller was told
    expect(l.has('poison')).toBe(true);        // never re-applied
  });

  it('a success resets the failure count (no false quarantine after recovery)', async () => {
    const l = createAppliedLedger();
    let fail = true;
    const flaky = async () => { if (fail) throw new Error('transient'); };
    await applyMutationsOnce([m('x')], l, flaky);
    fail = false;
    const ack = await applyMutationsOnce([m('x')], l, flaky);
    expect(ack).toEqual(['x']);
    expect(l.has('x')).toBe(true);
  });
});
