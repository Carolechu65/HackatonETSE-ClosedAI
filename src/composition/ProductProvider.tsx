import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { ProductClient } from './product.ts';

const ProductContext = createContext<ProductClient | null>(null);
export function ProductProvider({ client, children }: { client: ProductClient; children: ReactNode }) {
  useEffect(() => {
    void client.initialize();
    const refresh = () => { if (AppState.currentState !== 'background' && client.getSnapshot().session?.mode === 'live') void client.refresh().catch(() => undefined); };
    const timer = setInterval(refresh, 15_000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [client]);
  return <ProductContext.Provider value={client}>{children}</ProductContext.Provider>;
}
export function useProduct() {
  const client = useContext(ProductContext);
  if (!client) throw new Error('Falta la composición de alarmaT.');
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  return { state, client, group: state.groups.find(group => group.id === state.groupId), memberName: (id: string) => state.members.find(m => m.userId === id)?.displayName ?? 'Miembro del piso' };
}
