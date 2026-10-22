import { AppState } from 'react-native';
import * as Network from 'expo-network';
import * as Notifications from 'expo-notifications';
import type { BootstrapSources } from './controller.ts';

/** Does not ask permissions or set a notification handler; presentation is owned by P4. */
export function createExpoBootstrapSources(options: { enablePush?: boolean } = {}): BootstrapSources {
  let online = false;
  return {
    appState: {
      getSnapshot: () => AppState.currentState ?? 'unknown',
      subscribe(listener) {
        const subscription = AppState.addEventListener('change', listener);
        return () => subscription.remove();
      },
    },
    network: {
      getSnapshot: () => online,
      subscribe(listener) {
        let disposed = false;
        let receivedEvent = false;
        const update = (state: Network.NetworkState) => {
          if (disposed) return;
          online = state.isConnected === true && state.isInternetReachable !== false;
          listener(online);
        };
        const subscription = Network.addNetworkStateListener(state => { receivedEvent = true; update(state); });
        void Network.getNetworkStateAsync().then(state => {
          if (!receivedEvent) update(state);
        }).catch(() => { if (!disposed && !receivedEvent) { online = false; listener(false); } });
        return () => { disposed = true; subscription.remove(); };
      },
    },
    ...(options.enablePush ? {
      push: {
        subscribe(listener: (data: unknown) => void) {
          const received = Notifications.addNotificationReceivedListener(notification => listener(notification.request.content.data));
          const response = Notifications.addNotificationResponseReceivedListener(event => listener(event.notification.request.content.data));
          return () => { received.remove(); response.remove(); };
        },
      },
    } : {}),
  };
}
