import React, { useEffect, useState } from 'react';
import { Task } from '@repo/shared';
import { FaTimes, FaSave, FaTrash } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';
import { useStore } from '../stores/useStore';

interface TaskDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
  initialDate?: Date | null;
  onUpdate: (id: string, updates: Partial<Task>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCreate?: (task: Omit<Task, '_id' | 'createdAt' | 'updatedAt' | 'userId'>) => Promise<void>;
}

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
  isOpen,
  onClose,
  task,
  initialDate,
  onUpdate,
  onDelete,
  onCreate
}) => {
  const { t } = useTranslation();
  const { notes } = useStore();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('low');
  const [dueDateValue, setDueDateValue] = useState('');
  const [dueTimeValue, setDueTimeValue] = useState('');
  const [completed, setCompleted] = useState(false);
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [recurrenceType, setRecurrenceType] = useState<'none' | 'daily' | 'weekly'>('none');
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderOffsetMinutes, setReminderOffsetMinutes] = useState<0 | 10>(0);
  const [isSaving, setIsSaving] = useState(false);
  const recurrenceOptions = [
    { value: 'none', label: 'Ingen' },
    { value: 'daily', label: 'Dagligen' },
    { value: 'weekly', label: 'Veckovis' },
  ];
  const weekDays = [
    { value: 1, label: 'Mån' },
    { value: 2, label: 'Tis' },
    { value: 3, label: 'Ons' },
    { value: 4, label: 'Tor' },
    { value: 5, label: 'Fre' },
    { value: 6, label: 'Lör' },
    { value: 0, label: 'Sön' },
  ];
  const toLocalDateInput = (date: Date) => {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  };
  const toLocalTimeInput = (date: Date) => {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(11, 16);
  };
  const applyQuickDate = (target: Date) => {
    setDueDateValue(toLocalDateInput(target));
    setDueTimeValue('00:00');
  };

  useEffect(() => {
    if (isOpen) {
      if (task) {
        setTitle(task.title);
        setDescription(task.description || '');
        setPriority(task.priority || 'medium');
        if (task.dueDate) {
          const d = new Date(task.dueDate);
          if (!isNaN(d.getTime())) {
            // Local date string YYYY-MM-DD
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            setDueDateValue(`${y}-${m}-${day}`);
            
            // Local time string HH:mm
            const h = String(d.getHours()).padStart(2, '0');
            const min = String(d.getMinutes()).padStart(2, '0');
            setDueTimeValue(`${h}:${min}`);
          }
        } else {
          setDueDateValue('');
          setDueTimeValue('');
        }
        setCompleted(task.completed);
        setSelectedListId(task.parentNoteId || '');
        setRecurrenceType(task.recurrenceType || 'none');
        setRecurrenceDays(task.recurrenceDays || []);
        setReminderEnabled(task.reminderEnabled || false);
        setReminderOffsetMinutes(task.reminderOffsetMinutes === 10 ? 10 : 0);
      } else {
        // Reset for new task
        setTitle('');
        setDescription('');
        setPriority('medium');
        
        if (initialDate) {
          const d = new Date(initialDate);
          if (!isNaN(d.getTime())) {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            setDueDateValue(`${y}-${m}-${day}`);

            // Only set time if it's not 00:00:00 (which implies full day or month view click)
            // But user asked for specific time. Calendar click usually sends time.
            const h = String(d.getHours()).padStart(2, '0');
            const min = String(d.getMinutes()).padStart(2, '0');
            if (h !== '00' || min !== '00') {
               setDueTimeValue(`${h}:${min}`);
            } else {
               // If exactly midnight, maybe default to empty or specific time?
               // Let's keep empty for now unless user clicked specific time slot.
               // React Big Calendar sends 00:00 for month view clicks.
               setDueTimeValue('');
            }
          }
        } else {
          setDueDateValue('');
          setDueTimeValue('');
        }
        setCompleted(false);
        setSelectedListId('');
        setRecurrenceType('none');
        setRecurrenceDays([]);
        setReminderEnabled(false);
        setReminderOffsetMinutes(0);
      }
    }
  }, [isOpen, task, initialDate]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
        window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      if (task) {
        const dueIso = dueDateValue
          ? (() => {
              const d = new Date(`${dueDateValue}T${dueTimeValue || '00:00'}`);
              return isNaN(d.getTime()) ? null : d.toISOString();
            })()
          : null;
        await onUpdate(task._id, {
            title,
            description,
            priority,
            completed,
            dueDate: dueIso,
            parentNoteId: selectedListId || null,
            recurrenceType,
            recurrenceDays: recurrenceType === 'weekly' ? recurrenceDays : [],
            reminderEnabled,
            reminderOffsetMinutes: reminderEnabled ? reminderOffsetMinutes : 0
        });
      } else if (onCreate) {
         const dueIso = dueDateValue
           ? (() => {
               const d = new Date(`${dueDateValue}T${dueTimeValue || '00:00'}`);
               return isNaN(d.getTime()) ? null : d.toISOString();
             })()
           : null;
         await onCreate({
            title,
            description,
            priority,
            completed,
            dueDate: dueIso,
            parentNoteId: selectedListId || null,
            recurrenceType,
            recurrenceDays: recurrenceType === 'weekly' ? recurrenceDays : [],
            reminderEnabled,
            reminderOffsetMinutes: reminderEnabled ? reminderOffsetMinutes : 0
         });
      }
      onClose();
    } catch (error) {
      console.error('Failed to update task', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (task && confirm(t('confirm.deleteTask'))) {
        await onDelete(task._id);
        onClose();
    }
  }

  return (
    <div 
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={onClose}
    >
      <div 
        className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-lg"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 id="modal-title" className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {task ? t('tasks.editTitle') : t('tasks.createTitle') || 'Create Task'}
          </h3>
          <button 
            onClick={onClose} 
            className="text-gray-600 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            aria-label={t('common.close')}
          >
            <FaTimes size={20} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="task-title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('common.title')}</label>
            <input
              id="task-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              className="w-full bg-transparent text-xl font-bold border-none focus:ring-0 p-0 text-gray-900 dark:text-gray-100 placeholder-gray-400"
              required
            />
          </div>

          <div>
            <label htmlFor="task-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('common.description')}</label>
            <textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white min-h-[100px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
             <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" htmlFor="priority-select">{t('common.priority')}</label>
                <select
                  id="priority-select"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                  className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                >
                  <option value="low">{t('tasks.priority.low')}</option>
                  <option value="medium">{t('tasks.priority.medium')}</option>
                  <option value="high">{t('tasks.priority.high')}</option>
                </select>
             </div>
             <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('common.dueDate')}</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => applyQuickDate(new Date())}
                    className="px-2 py-1 text-xs border rounded dark:border-gray-600 dark:text-white"
                  >
                    Idag
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setDate(d.getDate() + 1);
                      applyQuickDate(d);
                    }}
                    className="px-2 py-1 text-xs border rounded dark:border-gray-600 dark:text-white"
                  >
                    Imorgon
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      const day = d.getDay();
                      const daysUntilSunday = (7 - day) % 7;
                      d.setDate(d.getDate() + daysUntilSunday);
                      applyQuickDate(d);
                    }}
                    className="px-2 py-1 text-xs border rounded dark:border-gray-600 dark:text-white"
                  >
                    Slutet av veckan
                  </button>
                </div>
                <input
                  id="due-date-input"
                  type="date"
                  value={dueDateValue}
                  onChange={(e) => setDueDateValue(e.target.value)}
                  className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
                <input
                  id="due-time-input"
                  type="time"
                  value={dueTimeValue}
                  onChange={(e) => setDueTimeValue(e.target.value)}
                  className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white mt-2"
                />
                {dueDateValue && (
                  <button
                    type="button"
                    onClick={() => {
                      setDueDateValue('');
                      setDueTimeValue('');
                    }}
                    className="mt-2 text-xs text-gray-600 dark:text-gray-300"
                  >
                    Rensa datum
                  </button>
                )}
             </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Återkommande</label>
            <select
              value={recurrenceType}
              onChange={(e) => {
                const next = e.target.value as 'none' | 'daily' | 'weekly';
                setRecurrenceType(next);
                if (next !== 'weekly') {
                  setRecurrenceDays([]);
                }
              }}
              className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            >
              {recurrenceOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {recurrenceType === 'weekly' && (
            <div className="flex flex-wrap gap-2">
              {weekDays.map(day => (
                <label key={day.value} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={recurrenceDays.includes(day.value)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setRecurrenceDays(prev => checked ? [...prev, day.value] : prev.filter(d => d !== day.value));
                    }}
                    className="w-4 h-4"
                  />
                  {day.label}
                </label>
              ))}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Påminnelse</label>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={reminderEnabled}
                onChange={(e) => setReminderEnabled(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Aktivera påminnelse</span>
            </div>
            {reminderEnabled && (
              <select
                value={reminderOffsetMinutes}
                onChange={(e) => setReminderOffsetMinutes(Number(e.target.value) === 10 ? 10 : 0)}
                className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white mt-2"
              >
                <option value={0}>Vid förfallotid</option>
                <option value={10}>10 minuter innan</option>
              </select>
            )}
          </div>
          
           <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="completed"
                  checked={completed}
                  onChange={(e) => setCompleted(e.target.checked)}
                  className="w-4 h-4"
                />
                <label htmlFor="completed" className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('common.completed')}</label>
           </div>
          
          <div className="pt-2">
            <label htmlFor="list-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('tasks.listLabel')}</label>
            <select
              id="list-select"
              value={selectedListId}
              onChange={(e) => setSelectedListId(e.target.value)}
              className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            >
              <option value="">{t('tasks.noList')}</option>
              {notes.filter(n => (n as any).type === 'task_list').map(list => (
                <option key={list._id} value={list._id}>
                  {list.title || t('common.untitled')}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-between pt-4 border-t border-gray-200 dark:border-gray-700 mt-4">
            {task ? (
              <button
                type="button"
                onClick={handleDelete}
                className="px-4 py-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded flex items-center gap-2"
              >
                <FaTrash /> {t('common.delete')}
              </button>
            ) : <div />}
            <div className="flex gap-2">
                <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                >
                {t('common.cancel')}
                </button>
                <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 flex items-center gap-2"
                >
                <FaSave /> {t('common.save')}
                </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
