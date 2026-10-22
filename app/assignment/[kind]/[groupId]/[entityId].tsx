import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useProduct } from '../../../../src/composition/ProductProvider.tsx';
import { assignmentDestination, prepareAssignmentNavigation } from '../../../../src/platform/notifications/navigation.ts';
import { PrimaryAction, Screen, typography } from '../../../../src/ui/index.ts';

export default function AssignmentRoute() {
  const params = useLocalSearchParams<{ kind: string; groupId: string; entityId: string }>();
  const { client, state } = useProduct();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!state.ready) return;
    let active = true;
    const destination = assignmentDestination(params);
    if (!destination) { setError('Este aviso no tiene un enlace válido.'); return; }
    if (state.session?.mode !== 'live') { setError('Inicia sesión para consultar este aviso.'); return; }
    void prepareAssignmentNavigation(client, destination).then(path => { if (active) router.replace(path); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'No se pudo abrir el aviso.'); });
    return () => { active = false; };
  }, [client, state.ready, state.session?.userId, state.session?.mode, params.kind, params.groupId, params.entityId]);
  return <Screen><Text style={typography.body}>{error ?? 'Abriendo el piso y el detalle del aviso…'}</Text>
    {error ? <PrimaryAction label="Abrir AlarmaT" onPress={() => router.replace('/')} /> : null}</Screen>;
}
