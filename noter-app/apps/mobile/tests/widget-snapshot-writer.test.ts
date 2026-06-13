import { writeWidgetSnapshot, deriveWidgetLists, createNativeWidgetBridge } from '../services/widgets/snapshotWriter';

const note = (over: any) => ({ _id: 'n', userId: 'u', title: 'T', content: '', createdAt: '', updatedAt: '', ...over });
const task = (over: any) => ({ _id: 't', userId: 'u', title: 'T', completed: false, createdAt: '', updatedAt: '', ...over });

describe('deriveWidgetLists', () => {
  it('returns only task_list notes as {id,name}', () => {
    const notes = [
      note({ _id: 'l1', title: 'Inbox', type: 'task_list' }),
      note({ _id: 'p1', title: 'Project', type: 'project' }),
      note({ _id: 'n1', title: 'A note', type: 'note' }),
    ] as any;
    expect(deriveWidgetLists(notes)).toEqual([{ id: 'l1', name: 'Inbox' }]);
  });
});

describe('writeWidgetSnapshot', () => {
  it('no-ops when the native bridge is unavailable', async () => {
    const writeSnapshot = jest.fn();
    const bridge = { isAvailable: () => false, writeSnapshot };
    const ok = await writeWidgetSnapshot([], [], bridge, '2026-06-13T00:00:00.000Z');
    expect(ok).toBe(false);
    expect(writeSnapshot).not.toHaveBeenCalled();
  });

  it('writes a serialised snapshot (titles only, sorted/filtered) when available', async () => {
    let written: any = null;
    const bridge = { isAvailable: () => true, writeSnapshot: async (j: string) => { written = JSON.parse(j); } };
    const notes = [note({ _id: 'l1', title: 'Inbox', type: 'task_list' })] as any;
    const tasks = [
      task({ _id: 'high', title: 'High', priority: 'high', parentNoteId: 'l1', description: 'secret' }),
      task({ _id: 'done', title: 'Done', completed: true, parentNoteId: 'l1' }),
    ] as any;

    const ok = await writeWidgetSnapshot(notes, tasks, bridge, '2026-06-13T00:00:00.000Z', { listId: 'l1' });
    expect(ok).toBe(true);
    expect(written.version).toBe(1);
    expect(written.lists).toEqual([{ id: 'l1', name: 'Inbox' }]);
    expect(written.tasks.map((t: any) => t.id)).toEqual(['high']); // completed hidden
    expect(written.tasks[0]).not.toHaveProperty('description'); // bodies never reach the widget
  });
});

describe('createNativeWidgetBridge', () => {
  it('is unavailable without a native module and available with one', async () => {
    expect(createNativeWidgetBridge(null).isAvailable()).toBe(false);
    expect(createNativeWidgetBridge({}).isAvailable()).toBe(false);
    const writeSnapshot = jest.fn(async () => {});
    const bridge = createNativeWidgetBridge({ writeSnapshot });
    expect(bridge.isAvailable()).toBe(true);
    await bridge.writeSnapshot('{}');
    expect(writeSnapshot).toHaveBeenCalledWith('{}');
  });
});
