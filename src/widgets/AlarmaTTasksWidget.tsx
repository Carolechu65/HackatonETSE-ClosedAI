import { createWidget } from 'expo-widgets';
import { WidgetLayout, initialWidgetProps } from './WidgetLayout.tsx';

export default createWidget('AlarmaTTasksWidget', WidgetLayout, { ...initialWidgetProps, variant: 'tasks' });
