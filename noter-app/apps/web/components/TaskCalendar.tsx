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
    const [currentTime, setCurrentTime] = React.useState(new Date());

    React.useEffect(() => {
        setIsMounted(true);
        // Update current time every minute
        const interval = setInterval(() => {
            setCurrentTime(new Date());
        }, 60000);
        return () => clearInterval(interval);
    }, []);

    const events = tasks
        .map(task => {
            if (!task.dueDate) return null;
            const date = new Date(task.dueDate);
            if (isNaN(date.getTime())) return null;
            
            // Default to 1 hour duration to make the box taller (double height)
            // React Big Calendar defaults to 30 mins if end is missing or same, so 60 mins should double it.
            const endDate = new Date(date.getTime() + 60 * 60 * 1000);

            return {
                id: task._id,
                title: task.title,
                start: date,
                end: endDate,
                allDay: false, // Force time slot rendering
                resource: task,
            };
        })
        .filter(Boolean) as any[];

    const [view, setView] = React.useState<View>('month');
    const [date, setDate] = React.useState(new Date());

    const components = React.useMemo(() => ({
      event: ({ event }: any) => {
          return (
              <div className="flex flex-col text-xs overflow-hidden h-full">
                  <div className="font-semibold truncate">{event.title}</div>
                  <div className="opacity-80 truncate">{format(event.start, 'HH:mm')}</div>
              </div>
          );
      },
      timeSlotWrapper: ({ children, value }: any) => {
        const now = currentTime;
        const isToday = value.getDate() === now.getDate() && 
                       value.getMonth() === now.getMonth() && 
                       value.getFullYear() === now.getFullYear();
        
        // Assuming 30 minute slots (default)
        const slotDuration = 30; 
        const slotStart = value.getHours() * 60 + value.getMinutes();
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const diff = nowMinutes - slotStart;

        const showLine = isToday && diff >= 0 && diff < slotDuration;
        const topPercent = (diff / slotDuration) * 100;

        return (
          <div className="rbc-time-slot" style={{ position: 'relative' }}>
            {children}
            {showLine && (
               <div 
                 className="absolute w-full h-0.5 bg-red-500 dark:bg-red-400 z-50 pointer-events-none"
                 style={{ 
                   top: `${topPercent}%`,
                   left: 0,
                   right: 0
                 }}
               >
                 <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-red-500 dark:bg-red-400" />
               </div>
            )}
          </div>
        );
      }
    }), [currentTime]);

    const handleSelectEvent = (event: any) => {
        onTaskClick(event.resource);
    };

    const handleSelectSlot = ({ start }: { start: Date }) => {
        if (onCreateTask) {
            // Check if start has specific time (not 00:00:00 which usually means "all day" or just date click in month view)
            // In week/day view, start includes time. In month view, it's 00:00:00.
            // We pass the full date object.
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
                
                /* Dark mode grid lines adjustment */
                .dark .rbc-time-content > * + * > * { border-left-color: rgba(107, 114, 128, 0.4); }
                .dark .rbc-time-view { border-color: rgba(107, 114, 128, 0.5); }
                .dark .rbc-timeslot-group { border-bottom-color: rgba(107, 114, 128, 0.4); } /* Half-hour lines */
                .dark .rbc-day-slot .rbc-time-slot { border-top-color: rgba(107, 114, 128, 0.2); }
                
                /* Stronger hour lines */
                .dark .rbc-timeslot-group { border-bottom: 1px solid rgba(107, 114, 128, 0.5); } 
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
                components={components}
                formats={{
                    eventTimeRangeFormat: () => '', // Hide default time range in header
                }}
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
