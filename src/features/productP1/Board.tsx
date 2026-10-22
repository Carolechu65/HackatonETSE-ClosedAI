import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useProduct } from '../../composition/ProductProvider.tsx';
import { alarmStatus } from '../../composition/product.ts';
import { AnimatedIn, Checkbox, Note, IconButton, typography, tabularNums } from '../../ui/index.ts';
import { Message, useAction } from '../../ui/Controls.tsx';
import { ProgressBar } from '../skeleton/components.tsx';
import { createIdGenerator } from '../../domain/ids.ts';
import { describeTaskDue } from '../tasks/model.ts';
import { useExpenses } from '../expenses/useExpenses.ts';
import { expenseBalance, formatEuros } from '../expenses/client.ts';
import { Frame } from './Frame.tsx';
const ids=createIdGenerator();
export function ProductBoard(){
 const {state,client,group,memberName}=useProduct();const action=useAction();const money=useExpenses();const tasks=state.tasks.filter(t=>t.groupId===state.groupId&&t.status!=='cancelled');const pending=tasks.filter(t=>t.status==='pending');const done=tasks.filter(t=>t.status==='completed').length;const next=pending[0];const uid=state.session?.userId??'';const balance=expenseBalance(money.expenses,uid);const alarm=state.alarms.find(a=>a.groupId===state.groupId&&a.request.status==='ACTIVE');
 return <Frame title="Tablón" eyebrow="LA PUERTA DE LA NEVERA">
  {!group?<Note index={1} title="Todo empieza con un piso" label="BIENVENIDO" onPress={()=>router.push('/group/manage')}><Text style={typography.support}>Crea vuestro espacio o entra con una invitación.</Text></Note>:<>
   <AnimatedIn><Note index={0} wide label={next?describeTaskDue(next,Date.now(),group.timeZone):'Todo al día'} title={next?.title??'No queda nada pendiente'}>{next?<View style={styles.nextRow}><Checkbox checked={false} onToggle={()=>{if(!action.busy)void action.run(()=>client.updateTask(next,'completed',ids.next('op')));}} accessibilityLabel={`Marcar ${next.title} como hecha`}/><View style={{flex:1,gap:2}}><Text style={typography.support}>La añadió {memberName(next.createdByUid)}</Text><Text style={typography.labelOnNote}>{next.assigneeUid?`Se ocupa ${memberName(next.assigneeUid)}`:'Sin asignar'}</Text></View><IconButton name="arrow-up-right" tone="plain" onPress={()=>router.push(`/task/${next.id}`)} accessibilityLabel="Ver próxima tarea"/></View>:<Text style={typography.support}>Buen trabajo. Añade otra en Tareas.</Text>}</Note></AnimatedIn>
   <View style={styles.board}><AnimatedIn delay={70} style={styles.column}><Note index={1} label="Tareas" title={`${done} de ${tasks.length} hechas`} onPress={()=>router.push('/tasks')}><Text style={typography.support}>{pending.length} pendientes</Text><ProgressBar value={done} total={tasks.length}/></Note></AnimatedIn><AnimatedIn delay={120} style={styles.column}><Note index={2} label="Gastos" title={money.loaded?formatEuros(balance.owes):'Ver cuentas'} onPress={()=>router.push('/expenses')} accessibilityLabel="Abrir gastos pendientes"><Text style={typography.support}>{money.loaded?'Tu parte pendiente':'Consulta los gastos del piso'}</Text></Note></AnimatedIn></View>
   <AnimatedIn delay={170}><Note index={3} label={alarm?'Aviso del piso':'Avisos'} title={alarm?.request.title??'Cada aviso empieza contigo'} onPress={()=>router.push(alarm?`/alarm/${alarm.requestId}`:'/alarm/new')} accessibilityLabel={alarm?'Ver aviso':'Proponer aviso'}><Text style={typography.support}>{alarm?alarmStatus(alarm,uid).title:'Propón una hora. Quien la recibe decide.'}</Text></Note></AnimatedIn>
  </>}
  <Message text={action.error} error/>
  <View style={styles.shortcuts}><IconButton name="bell" tone="plain" onPress={()=>router.push('/alarms')} accessibilityLabel="Ver todas las alarmas"/><IconButton name="plus" tone="plain" onPress={()=>router.push('/alarm/new')} accessibilityLabel="Proponer aviso"/><IconButton name="message-circle" tone="plain" onPress={()=>router.push('/assistant')} accessibilityLabel="Abrir asistente"/><IconButton name="refresh-cw" tone="plain" disabled={action.busy||state.syncing} onPress={()=>void action.run(()=>client.refresh())} accessibilityLabel="Actualizar tablón"/></View>
  <Text style={[styles.caption,tabularNums]}>{done} de {tasks.length} tareas{money.loaded?` · ${formatEuros(balance.owes)} pendientes`:''}</Text>
 </Frame>;
}
const styles=StyleSheet.create({nextRow:{flexDirection:'row',alignItems:'center',gap:4,marginTop:2},board:{flexDirection:'row',alignItems:'flex-start',gap:10},column:{flex:1},shortcuts:{flexDirection:'row',gap:8},caption:{...typography.label,marginTop:'auto',paddingTop:8}});
