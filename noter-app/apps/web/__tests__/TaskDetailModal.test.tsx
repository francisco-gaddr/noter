import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TaskDetailModal } from '../components/TaskDetailModal';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../stores/useStore', () => ({
  useStore: () => ({ notes: [] }),
}));

describe('TaskDetailModal', () => {
  it('enables reminder at due time by default when opened from calendar date', async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();

    render(
      <TaskDetailModal
        isOpen
        onClose={onClose}
        task={null}
        initialDate={new Date('2026-03-10T00:00:00.000Z')}
        defaultListId={null}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
        onCreate={onCreate}
      />
    );

    fireEvent.change(screen.getByLabelText('common.title'), { target: { value: 'Kalenderuppgift' } });
    fireEvent.click(screen.getByRole('button', { name: /common.save/i }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const payload = onCreate.mock.calls[0][0];
    expect(payload.reminderEnabled).toBe(true);
    expect(payload.reminderOffsetMinutes).toEqual([0]);
    expect(typeof payload.dueDate).toBe('string');
  });

  it('supports multiple reminder offsets including 30 minutes', async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined);

    render(
      <TaskDetailModal
        isOpen
        onClose={jest.fn()}
        task={null}
        initialDate={new Date('2026-03-10T10:00:00.000Z')}
        defaultListId={null}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
        onCreate={onCreate}
      />
    );

    fireEvent.change(screen.getByLabelText('common.title'), { target: { value: 'Flera påminnelser' } });
    fireEvent.click(screen.getByLabelText('30 minuter innan'));
    fireEvent.click(screen.getByLabelText('10 minuter innan'));
    fireEvent.click(screen.getByRole('button', { name: /common.save/i }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const payload = onCreate.mock.calls[0][0];
    expect(payload.reminderEnabled).toBe(true);
    expect(payload.reminderOffsetMinutes).toEqual([0, 10, 30]);
  });
});
