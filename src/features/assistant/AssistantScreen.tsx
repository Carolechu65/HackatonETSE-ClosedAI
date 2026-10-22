import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useProduct } from '../../composition/ProductProvider.tsx';
import type { AssistantReply } from '../../composition/product.ts';
import { AppShell, BackLink } from '../../ui/AppShell.tsx';
import { Action, Field, Message, useAction } from '../../ui/Controls.tsx';
import { Sheet, PrimaryAction, typography, paper } from '../../ui/index.ts';
import { AlarmCreateScreen } from '../alarms/AlarmCreateScreen.tsx';

type Turn = { role: 'user' | 'assistant'; text: string };
export function AssistantScreen() {
  const { state, client } = useProduct();
  const [text, setText] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [reply, setReply] = useState<AssistantReply | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const scope = `${state.session?.userId ?? ''}:${state.groupId ?? ''}`;
  const [conversationGroup, setConversationGroup] = useState(scope);
  const locked = useRef(false);
  const action = useAction();
  const sameGroup = scope === conversationGroup;
  useEffect(() => { setTurns([]); setReply(null); setText(''); setReviewing(false); setConversationGroup(scope); }, [scope]);
  const send = () => {
    const message = text.trim();
    if (!message || locked.current || state.session?.mode !== 'live') return;
    locked.current = true;
    void action.run(async () => {
      if (!state.groupId) throw new Error('Elige tu piso antes de pedir una propuesta.');
      const answer = await client.askAssistant(message, sameGroup ? reply?.conversationId : undefined);
      setTurns(previous => [...(sameGroup ? previous : []), { role: 'user', text: message }, { role: 'assistant', text: answer.message }]);
      setConversationGroup(scope); setReply(answer); setText('');
    }).finally(() => { locked.current = false; });
  };
  if (reviewing && sameGroup && reply?.draft) return <AlarmCreateScreen initialDraft={reply.draft} onCancel={() => setReviewing(false)} />;
  return <AppShell title="Lo pensamos contigo." eyebrow="EL COMPAÑERO QUE RECUERDA">
    <BackLink />
    <View style={styles.column}>
      <Text style={typography.bodyOnDoor}>Cuéntanos qué necesitas recordar. Si falta un dato, te lo preguntaremos. Tú revisas y envías la propuesta; cada destinatario decide después.</Text>
      {state.session?.mode === 'demo' ? <Message text="El asistente necesita una cuenta conectada. En la demostración puedes crear propuestas manualmente; aquí no se generan respuestas de ejemplo." /> : null}
      {sameGroup ? turns.map((turn, index) => <View key={index} style={[styles.turn, { backgroundColor: turn.role === 'user' ? paper[1] : paper[4], alignSelf: turn.role === 'user' ? 'flex-end' : 'flex-start' }]}><Text style={typography.labelOnNote}>{turn.role === 'user' ? 'TÚ' : 'COMPAÑERO'}</Text><Text selectable style={typography.body}>{turn.text}</Text></View>) : <Message text="Has cambiado de piso. Tu próxima consulta iniciará una conversación nueva." />}
      {sameGroup && reply?.kind === 'draft' && reply.draft ? <Sheet><Text style={typography.labelOnNote}>BORRADOR · AÚN SIN ENVIAR</Text><Text style={typography.noteTitle}>{reply.draft.title}</Text><Text style={typography.support}>Revisa destinatarios, hora, modo y repetición antes de enviarlo. Preparar el borrador no programa alarmas.</Text><Action onPress={() => setReviewing(true)}>Revisar y editar propuesta →</Action></Sheet> : null}
      <Sheet><Field label={reply?.kind === 'needs_clarification' && sameGroup ? 'Completa el dato que falta' : '¿Qué quieres recordar?'} multiline value={text} onChangeText={setText} maxLength={2000} editable={!action.busy && state.session?.mode === 'live'} placeholder="Recuérdale a Ana sacar la basura mañana a las 21:00." hint="No se enviará ninguna propuesta hasta que la revises y confirmes." /></Sheet>
      <Message text={action.error} error />
      <PrimaryAction label={action.busy ? 'Preparando respuesta…' : 'Consultar al compañero'} disabled={action.busy || !text.trim() || !state.groupId || state.session?.mode !== 'live'} onPress={send} />
      {turns.length ? <Action disabled={action.busy} onPress={() => { setTurns([]); setReply(null); setText(''); setConversationGroup(scope); }}>Empezar otra conversación</Action> : null}
    </View>
  </AppShell>;
}
const styles = StyleSheet.create({ column: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: 20 }, turn: { maxWidth: '94%', padding: 18, gap: 10, borderRadius: 2 } });
