import React from 'react';
import { Calendar, dateFnsLocalizer, View } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enUS, sv } from 'date-fns/locale';
import { Task } from '@repo/shared';
import { useTranslation } from 'react-i18next';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import { useStore } from '../stores/useStore';

const locales = {
  'en': enUS,
  'sv': sv,
};

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: any, options: any) => startOfWeek(date, { ...options, weekStartsOn: 1 }), // Monday start
  getDay,
  locales,
});

interface TaskCalendarProps {
    tasks: Task[];
    onTaskClick: (task: Task) => void;
    onCreateTask?: (date: Date) => void;
}

export default function TaskCalendar({ tasks, onTaskClick, onCreateTask }: TaskCalendarProps) {
    const { t, i18n } = useTranslation();
    const currentLocale = i18n.language?.startsWith('sv') ? 'sv' : 'en';
    const { updateTask } = useStore();
    const DnDCalendar = withDragAndDrop(Calendar as any);
    const [isMounted, setIsMounted] = React.useState(false);

    React.useEffect(() => {
        setIsMounted(true);
    }, []);

    const events = tasks
        .filter(task => task.dueDate)
        .map(task => ({
            id: task._id,
            title: task.title,
            start: new Date(task.dueDate!),
            end: new Date(task.dueDate!),
            allDay: (() => {
              const d = new Date(task.dueDate!);
              return d.getHours() === 0 && d.getMinutes() === 0;
            })(),
            resource: task,
        }));

    const [view, setView] = React.useState<View>('month');
    const [date, setDate] = React.useState(new Date());

    const handleSelectEvent = (event: any) => {
        onTaskClick(event.resource);
    };

    const handleSelectSlot = ({ start }: { start: Date }) => {
        if (onCreateTask) {
            onCreateTask(start);
        }
    };
    
    const handleEventDrop = async ({ event, start }: any) => {
        const task = event.resource as Task;
        try {
            await updateTask(task._id, { dueDate: start.toISOString() });
        } catch (e) {
            
        }
    };
    
    const handleEventResize = async ({ event, start }: any) => {
        const task = event.resource as Task;
        try {
            await updateTask(task._id, { dueDate: start.toISOString() });
        } catch (e) {
            
        }
    };

    if (!isMounted) {
        return <div className="h-full p-2 bg-white dark:bg-gray-900 rounded-lg shadow-sm flex items-center justify-center">Loading...</div>;
    }

    return (
        <div className="h-full p-2 bg-white dark:bg-gray-900 rounded-lg shadow-sm flex flex-col">
             <style>{`
                .rbc-calendar { color: inherit; min-height: 500px; }
                .rbc-off-range-bg { bg-gray-100 dark:bg-gray-800; }
                .rbc-today { background-color: rgba(59, 130, 246, 0.1); }
                .rbc-event { background-color: #3b82f6; border-radius: 4px; }
                .rbc-event.completed { background-color: #10b981; text-decoration: line-through; opacity: 0.7; }
                .dark .rbc-toolbar button { color: #e5e7eb; }
                .dark .rbc-toolbar button:hover { bg-gray-700; }
                .dark .rbc-header { color: #e5e7eb; }
                .dark .rbc-month-view { border-color: #374151; }
                .dark .rbc-header { border-bottom-color: #374151; }
                .dark .rbc-day-bg + .rbc-day-bg { border-left-color: #374151; }
                .dark .rbc-month-row + .rbc-month-row { border-top-color: #374151; }
                .dark .rbc-off-range-bg { background-color: #1f2937; }
            `}</style>
            <div className="flex-1">
            <DnDCalendar
                localizer={localizer}
                events={events}
                startAccessor="start"
                endAccessor="end"
                style={{ height: '100%' }}
                onSelectEvent={handleSelectEvent}
                culture={currentLocale}
                view={view}
                onView={setView}
                date={date}
                onNavigate={setDate}
                onEventDrop={handleEventDrop}
                onEventResize={handleEventResize}
                selectable
                onSelectSlot={handleSelectSlot}
                eventPropGetter={(event) => {
                    const task = event.resource as Task;
                    return {
                        className: task.completed ? 'completed' : '',
                        style: {
                            backgroundColor: task.completed ? '#10b981' : 
                                            task.priority === 'high' ? '#ef4444' : 
                                            task.priority === 'medium' ? '#eab308' : '#3b82f6'
                        }
                    };
                }}
                views={['month', 'week', 'day', 'agenda']}
            />
            </div>
        </div>
    );
}
