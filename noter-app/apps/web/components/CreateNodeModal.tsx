import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPicker } from './IconPicker';
import * as FaIcons from 'react-icons/fa';
import { FaFolder } from 'react-icons/fa';

interface CreateNodeModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (title: string, icon: string) => void;
    onDelete?: () => void;
    type: 'note' | 'task_list' | 'project';
    mode?: 'create' | 'edit';
    initialTitle?: string;
    initialIcon?: string;
}

export const CreateNodeModal: React.FC<CreateNodeModalProps> = ({ 
    isOpen, 
    onClose, 
    onConfirm, 
    onDelete,
    type, 
    mode = 'create',
    initialTitle = '',
    initialIcon = ''
}) => {
    const { t } = useTranslation();
    const [title, setTitle] = useState(initialTitle);
    const [icon, setIcon] = useState<string>(initialIcon);
    const [showIconPicker, setShowIconPicker] = useState(false);

    React.useEffect(() => {
        if (isOpen) {
            setTitle(initialTitle);
            setIcon(initialIcon);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onConfirm(title || t('common.untitled'), icon);
        setTitle('');
        setIcon('');
        onClose();
    };

    const Icon = icon && (FaIcons as any)[icon] ? (FaIcons as any)[icon] : FaFolder;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-xl w-96 z-50">
                <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-gray-100">
                    {mode === 'edit' 
                        ? (type === 'project' ? (t('project.rename') || 'Edit Project') : type === 'task_list' ? t('actions.editList') : t('actions.editNote'))
                        : (type === 'project' ? (t('project.create') || 'New Project') : type === 'task_list' ? t('actions.newList') : t('actions.newNote'))
                    }
                </h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            {t('common.title')}
                        </label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder={t('common.untitled')}
                            className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            autoFocus
                        />
                    </div>
                    
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            {t('iconPicker.title')}
                        </label>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setShowIconPicker(true)}
                                className="p-2 border rounded dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
                            >
                                <Icon size={24} />
                            </button>
                            {icon && (
                                <button
                                    type="button"
                                    onClick={() => setIcon('')}
                                    className="text-sm text-red-500 hover:underline"
                                >
                                    {t('iconPicker.removeIcon')}
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="flex justify-between items-center mt-6">
                        {mode === 'edit' && onDelete && (
                            <button
                                type="button"
                                onClick={onDelete}
                                className="px-4 py-2 text-white bg-red-500 rounded hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500"
                            >
                                {t('actions.delete') || 'Delete'}
                            </button>
                        )}
                        <div className="flex gap-2 ml-auto">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                            >
                                {t('common.cancel')}
                            </button>
                            <button
                                type="submit"
                                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                            >
                                {t('common.save')}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
            
            {showIconPicker && (
                <IconPicker
                    onSelect={(selected) => {
                        setIcon(selected);
                        setShowIconPicker(false);
                    }}
                    onClose={() => setShowIconPicker(false)}
                />
            )}
        </div>
    );
};
