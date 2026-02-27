import React from 'react';
import * as FaIcons from 'react-icons/fa';
import { useTranslation } from 'react-i18next';
import { ICON_LIST } from '@repo/shared';

interface IconPickerProps {
    onSelect: (iconName: string, color?: string) => void;
    onClose: () => void;
    currentColor?: string;
}

export const IconPicker: React.FC<IconPickerProps> = ({ onSelect, onClose, currentColor }) => {
    const { t } = useTranslation();
    const COLORS = ['#FF5252', '#FF9800', '#4CAF50', '#2196F3', '#9C27B0'];
    const defaultColor = COLORS[0] ?? '#2196F3';
    const [selectedColor, setSelectedColor] = React.useState<string>(currentColor ?? defaultColor);

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-xl w-96 max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-gray-100">{t('iconPicker.title')}</h3>
                <div className="flex items-center gap-2 mb-3">
                    {COLORS.map((c) => (
                        <button
                            key={c}
                            onClick={() => setSelectedColor(c)}
                            className="w-6 h-6 rounded-full border border-gray-300"
                            style={{ backgroundColor: c, outline: selectedColor === c ? '2px solid #000' : 'none' }}
                            title={c}
                        />
                    ))}
                </div>
                <div className="grid grid-cols-6 gap-2">
                    {ICON_LIST.map(key => {
                        const Icon = (FaIcons as any)[key];
                        if (!Icon) return null;
                        return (
                            <button
                                key={key}
                                onClick={() => onSelect(key, selectedColor)}
                                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded flex items-center justify-center text-gray-600 dark:text-gray-300"
                                title={key}
                            >
                                <Icon size={24} color={selectedColor} />
                            </button>
                        );
                    })}
                </div>
                <button 
                    onClick={() => onSelect('', selectedColor)}
                    className="mt-4 w-full p-2 bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-200 rounded hover:bg-red-200 dark:hover:bg-red-800"
                >
                    {t('iconPicker.removeIcon')}
                </button>
            </div>
        </div>
    );
};
