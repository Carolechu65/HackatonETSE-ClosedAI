import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { assignmentDestination } from '../platform/notifications/navigation.ts';
import { isSafeLinkId } from '../widgets/links.ts';

/** A notification only opens a guarded detail; it never carries consent. */
export function NotificationNavigation() {
  useEffect(() => {
    let active = true; let lastId: string | undefined;
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!active || !response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const notification = response.notification.request;
      const destination = assignmentDestination(notification.content.data);
      const requestId = notification.content.data?.requestId;
      if (notification.identifier === lastId || (!destination && !isSafeLinkId(requestId))) return;
      lastId = notification.identifier;
      if (destination) router.push(`/assignment/${destination.kind}/${destination.groupId}/${destination.entityId}`);
      else if (isSafeLinkId(requestId)) router.push({ pathname: '/alarm/[requestId]', params: { requestId } });
      void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);
    return () => { active = false; subscription.remove(); };
  }, []);
  return null;
}
