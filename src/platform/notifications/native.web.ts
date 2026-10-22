import { unavailableAlarmRuntime } from '../alarms/unavailable.ts';
import { unavailableNotifications } from './index.ts';

/** Browser UI remains usable; it cannot claim Android notification delivery. */
export const createNotifications = () => unavailableNotifications;
export const createNotificationRuntime = () => unavailableAlarmRuntime;
export const requestNotificationPermission = async () => false;
