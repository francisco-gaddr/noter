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
  const [dueDate, setDueDate] = useState('');
  const [completed, setCompleted] = useState(false);
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
        if (task) {
            setTitle(task.title);
            setDescription(task.description || '');
            setPriority(task.priority);
            const formattedDate = task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 16) : '';
            setDueDate(formattedDate || '');
            setCompleted(task.completed);
            setSelectedListId(task.parentNoteId || '');
        } else {
            // Reset for new task
            setTitle('');
            setDescription('');
            setPriority('low');
            // Use initialDate if provided, otherwise empty
            if (initialDate) {
                // Format for datetime-local input: YYYY-MM-DDTHH:mm
                const formattedInitial = new Date(initialDate).toISOString().slice(0, 16);
                setDueDate(formattedInitial);
            } else {
                setDueDate('');
            }
            setCompleted(false);
            setSelectedListId('');
        }
    }
  }, [task, isOpen, initialDate]);

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
        await onUpdate(task._id, {
            title,
            description,
            priority,
            completed,
            dueDate: dueDate ? new Date(dueDate).toISOString() : null,
            parentNoteId: selectedListId || null
        });
      } else if (onCreate) {
         await onCreate({
            title,
            description,
            priority,
            completed,
            dueDate: dueDate ? new Date(dueDate).toISOString() : null,
            parentNoteId: selectedListId || null
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" htmlFor="due-date-input">{t('common.dueDate')}</label>
                <input
                  id="due-date-input"
                  type="datetime-local"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
             </div>
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
