import { createWidget } from 'expo-widgets';
import { WidgetLayout, initialWidgetProps } from './WidgetLayout.tsx';

export default createWidget('AlarmaTAlarmsWidget', WidgetLayout, { ...initialWidgetProps, variant: 'alarms' });
