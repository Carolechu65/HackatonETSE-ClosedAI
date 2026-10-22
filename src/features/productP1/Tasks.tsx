import { useRef,useState } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useProduct } from '../../composition/ProductProvider.tsx';
import { Checkbox, IconButton, Note, TextField, typography, colors } from '../../ui/index.ts';
import { Message,useAction } from '../../ui/Controls.tsx';
import { ProgressBar } from '../skeleton/components.tsx';
import { createIdGenerator } from '../../domain/ids.ts';
import { describeTaskDue,type HouseholdTask } from '../tasks/model.ts';
import { Frame } from './Frame.tsx';
import { ListPages, useListPages } from './ListPages.tsx';
const ids=createIdGenerator();
export function ProductTasks(){
 const {state,client,group}=useProduct();const [draft,setDraft]=useState('');const action=useAction();const operations=useRef<Record<string,string>>({});const tasks=state.tasks.filter(t=>t.groupId===state.groupId&&t.status!=='cancelled');const pending=tasks.filter(t=>t.status==='pending');const done=tasks.filter(t=>t.status==='completed').length;
 const pages=useListPages(tasks,`${state.session?.userId}:${state.groupId}`,4);
 const update=(task:HouseholdTask,status:'pending'|'completed'|'cancelled')=>{const key=`${state.groupId}:${task.id}:${task.version}:${status}`;operations.current[key]??=ids.next('op');void action.run(()=>client.updateTask(task,status,operations.current[key]!));};
 const submit=()=>void action.run(async()=>{if(!draft.trim()||!group)return;const key=`add:${group.id}:${draft.trim()}`;operations.current[key]??=ids.next('op');const id=await client.createTask({title:draft.trim(),assigneeUid:null,activateAtEpochMs:null,dueAtEpochMs:null},operations.current[key]!);pages.reveal(id);delete operations.current[key];setDraft('');});
 return <Frame title="Tareas" eyebrow="LO QUE TOCA HOY"><View style={styles.summary}><Text style={typography.bodyOnDoor}>{pending.length} pendientes · {done} hechas</Text><View style={{flex:1,maxWidth:132}}><ProgressBar value={done} total={tasks.length}/></View></View>
 <Note index={0} wide label={group?.name??'Tu piso'} title={pending.length?`${pending.length} por hacer`:'Todo hecho'}>
 {!tasks.length?<Text style={typography.support}>No queda nada. Añade la primera tarea del piso.</Text>:pages.items.map(task=><View style={styles.row} key={task.id}><Checkbox checked={task.status==='completed'} onToggle={()=>{if(!action.busy)update(task,task.status==='completed'?'pending':'completed');}} accessibilityLabel={task.status==='completed'?`Marcar ${task.title} como pendiente`:`Marcar ${task.title} como hecha`}/><Pressable accessibilityRole="link" onPress={()=>router.push(`/task/${task.id}`)} style={styles.rowText}><Text style={[typography.body,task.status==='completed'&&styles.done]} numberOfLines={2}>{task.title}</Text><Text style={typography.labelOnNote}>{describeTaskDue(task,Date.now(),group?.timeZone??'Europe/Madrid')}</Text></Pressable>{task.status==='pending'?<IconButton name="x" tone="plain" disabled={action.busy} onPress={()=>update(task,'cancelled')} accessibilityLabel={`Cancelar ${task.title}`}/>:null}</View>)}
 <ListPages page={pages.page} count={pages.count} total={tasks.length} label="tareas" onSelect={pages.select}/>
 <View style={styles.addRow}><TextField value={draft} onChangeText={setDraft} placeholder="Añadir tarea" maxLength={120} onSubmitEditing={()=>{if(!action.busy)submit();}} style={{flex:1,minWidth:0}}/><IconButton name="plus" disabled={action.busy||!draft.trim()||!group} onPress={submit} accessibilityLabel="Añadir tarea al piso"/></View></Note>
 <Message text={action.error} error/><View style={styles.summary}><IconButton name="sliders" tone="plain" onPress={()=>router.push('/task/new')} accessibilityLabel="Crear tarea con fecha y responsable"/><IconButton name="list" tone="plain" onPress={()=>router.push('/tasks-history')} accessibilityLabel="Ver historial y filtros"/></View>
 <Text style={[typography.label,{marginTop:'auto'}]}>La casilla marca la tarea como hecha o pendiente. La X la cancela y retira sus avisos.</Text></Frame>;
}
const styles=StyleSheet.create({summary:{flexDirection:'row',alignItems:'center',gap:12},row:{flexDirection:'row',alignItems:'center',gap:4,borderBottomWidth:1,borderBottomColor:colors.noteLine,paddingVertical:2},rowText:{flex:1,minHeight:48,justifyContent:'center',gap:2},done:{textDecorationLine:'line-through',color:colors.noteLabel},addRow:{flexDirection:'row',alignItems:'flex-end',gap:10,marginTop:10}});
