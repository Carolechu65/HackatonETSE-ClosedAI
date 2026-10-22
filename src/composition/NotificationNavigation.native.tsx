import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { isSafeLinkId } from '../widgets/links.ts';

/** A notification only opens a guarded detail; it never carries consent. */
export function NotificationNavigation() {
  useEffect(() => {
    let active = true; let lastId: string | undefined;
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!active || !response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const notification = response.notification.request;
      const requestId = notification.content.data?.requestId;
      if (notification.identifier === lastId || !isSafeLinkId(requestId)) return;
      lastId = notification.identifier;
      router.push({ pathname: '/alarm/[requestId]', params: { requestId } });
      void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);
    return () => { active = false; subscription.remove(); };
  }, []);
  return null;
}
