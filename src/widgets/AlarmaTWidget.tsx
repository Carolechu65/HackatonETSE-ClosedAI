import { createWidget } from 'expo-widgets';
import { WidgetLayout, initialWidgetProps } from './WidgetLayout.tsx';

/** Retains the existing provider name so installed widgets become the board. */
export default createWidget('AlarmaTWidget', WidgetLayout, { ...initialWidgetProps, variant: 'board' });
