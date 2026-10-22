import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { useProduct } from '../../composition/ProductProvider.tsx';
import { PrimaryAction, TextField, typography } from '../../ui/index.ts';
import { createIdGenerator } from '../../domain/ids.ts';
import { parseLocalDate } from '../../domain/time.ts';
import { formatEuros, parseEuros, type Expense, type ExpenseDraft, type Receipt } from './client.ts';
import { allocateExpense, type ExpenseSplit } from './split.ts';
import { ReceiptPicker, type PickedReceipt } from './ReceiptPicker';
const ids=createIdGenerator();
export function ExpenseForm({expense,onSaved,onCancel}:{expense?:Expense;onSaved:(expense:Expense)=>Promise<void>;onCancel:()=>void}){
 const {state,client}=useProduct();const groupId=state.groupId!,uid=state.session?.userId??'';
 const [title,setTitle]=useState(expense?.title??''),[amount,setAmount]=useState(expense?String(expense.amountCents/100):'');
 const [merchant,setMerchant]=useState(expense?.merchant??''),[date,setDate]=useState(expense?.purchasedOn??'');
 const [category,setCategory]=useState(expense?.category??''),[notes,setNotes]=useState(expense?.notes??''),[dueDate,setDueDate]=useState(expense?.dueDate??'');
 const [participants,setParticipants]=useState(expense?.participantUids??state.members.map(m=>m.userId));
 const [mode,setMode]=useState<ExpenseSplit['mode']>(expense?.split?.mode??'equal');
 const [values,setValues]=useState<Record<string,string>>(Object.fromEntries((expense?.split?.values??[]).map(v=>[v.uid,String(v.value/100)])));
 const [receipt,setReceipt]=useState<Receipt|null>(null),[preview,setPreview]=useState<string|null>(null),[pending,setPending]=useState<Receipt[]>([]);
 const [reviewed,setReviewed]=useState(!!expense),[showText,setShowText]=useState(false),[saving,setSaving]=useState(false),[uploading,setUploading]=useState(false),[error,setError]=useState<string|null>(null);
 const alive=useRef(true),sequence=useRef(0),applied=useRef<string|null>(null),operation=useRef<{key:string;id:string}|null>(null);
 const receiptId=expense?.receiptId??receipt?.id;
 const reading=receipt?.status==='queued'||receipt?.status==='reading';const busy=saving||uploading||reading;
 const live=state.session?.mode==='live'&&!!groupId;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;sequence.current++;};},[]);
 useEffect(()=>{if(!live)return;let active=true;void client.finance.receipts(groupId).then(rows=>{if(active)setPending(rows);}).catch(()=>{});
  if(expense?.receiptId){void client.finance.receipt(groupId,expense.receiptId).then(r=>{if(active){applied.current=r.id;setReceipt(r);}}).catch(()=>{});void client.finance.previewReceipt(groupId,expense.receiptId).then(p=>{if(active)setPreview(p);}).catch(()=>{});}
 return()=>{active=false;};},[client,groupId,live,expense?.receiptId]);
 useEffect(()=>{if(!reading||!receipt)return;let active=true;let timer:ReturnType<typeof setTimeout>;async function poll(){try{const r=await client.finance.receipt(groupId,receipt!.id);if(active){setReceipt(r);if(r.status==='queued'||r.status==='reading')timer=setTimeout(()=>void poll(),2000);}}catch{if(active)timer=setTimeout(()=>void poll(),5000);}}timer=setTimeout(()=>void poll(),1000);return()=>{active=false;clearTimeout(timer);};},[client,groupId,reading,receipt?.id]);
 useEffect(()=>{if(receipt?.status!=='ready'||applied.current===receipt.id)return;applied.current=receipt.id;
  const fields=receipt.result?.fields??{};const value=(name:string)=>fields[name]?.value??'';
  setMerchant(value('merchant').slice(0,120));setTitle(value('merchant')?`Compra en ${value('merchant')}`.slice(0,120):'Compra con ticket');
  const currency=value('currency').trim().toUpperCase();const euros=!currency||currency==='EUR'||currency==='€'||currency.includes('EURO');
  const raw=value('total');setAmount(euros&&parseEuros(raw)!==null?raw:'');setDate(parseLocalDate(value('purchased_on'))?value('purchased_on'):'');setReviewed(false);
  if(!euros)setError(`El ticket indica ${currency}. Introduce el importe en euros antes de guardar.`);
  const previewSequence=sequence.current;void client.finance.previewReceipt(groupId,receipt.id).then(p=>{if(alive.current&&previewSequence===sequence.current&&p)setPreview(p);}).catch(()=>{});
 },[receipt,client,groupId]);
 async function upload(file:PickedReceipt){if(!alive.current)return;const seq=++sequence.current;setUploading(true);setError(null);setReviewed(false);setPreview(file.preview??null);
  try{const r=await client.finance.uploadReceipt(groupId,{filename:file.filename,base64:file.base64});if(alive.current&&seq===sequence.current){applied.current=null;setReceipt(r);}}
  catch(e){if(alive.current&&seq===sequence.current){setPreview(null);setError(e instanceof Error?e.message:'No se pudo subir el ticket.');}}
  finally{if(alive.current&&seq===sequence.current)setUploading(false);}}
 function choose(r:Receipt){const seq=++sequence.current;applied.current=null;setReceipt(r);setReviewed(false);setPreview(null);setError(null);void client.finance.previewReceipt(groupId,r.id).then(p=>{if(alive.current&&seq===sequence.current)setPreview(p);}).catch(()=>{});}
 const cents=parseEuros(amount);let shares:Array<{uid:string;amountCents:number}>=[],splitError:string|null=null;
 const split:ExpenseSplit={mode,...(mode!=='equal'?{values:participants.map(id=>({uid:id,value:parseShare(values[id]??'')}))}:{})};
 try{if(cents!==null)shares=allocateExpense(cents,participants,split);}catch(e){splitError=e instanceof Error?e.message:'Revisa el reparto.';}
 const validDates=(!date||!!parseLocalDate(date))&&(!dueDate||!!parseLocalDate(dueDate));
 const canSave=live&&!busy&&!!title.trim()&&cents!==null&&participants.length>0&&!splitError&&validDates&&(!receiptId||reviewed);
 async function save(){if(!canSave||cents===null)return;setSaving(true);setError(null);
  const draft:Omit<ExpenseDraft,'operationId'>={title:title.trim(),amountCents:cents,participantUids:participants,split,...(receiptId?{receiptId}:{}),...(merchant.trim()?{merchant:merchant.trim()}:{}),...(date?{purchasedOn:date}:{}),...(category.trim()?{category:category.trim()}:{}),...(notes.trim()?{notes:notes.trim()}:{}),...(dueDate?{dueDate}: {})};
  const key=JSON.stringify({draft,id:expense?.id,version:expense?.version});if(operation.current?.key!==key)operation.current={key,id:ids.next('op')};
  try{const saved=expense?await client.finance.update(groupId,expense.id,{...draft,operationId:operation.current.id,expectedVersion:expense.version}):await client.finance.create(groupId,{...draft,operationId:operation.current.id});if(alive.current)await onSaved(saved);}
  catch(e){if(alive.current)setError(e instanceof Error?e.message:'No se pudo guardar el gasto.');}
  finally{if(alive.current)setSaving(false);}}
 return <View style={{gap:12}}>
  {!expense?<><Text style={typography.bodyStrong}>Empieza con una foto o introduce el gasto a mano</Text><ReceiptPicker disabled={!live||busy} onPick={upload}/></>:null}
  {!live?<Text style={typography.support}>Conecta tu cuenta y selecciona un piso para guardar gastos.</Text>:null}
  {!expense&&!receipt&&pending.length?<View style={{gap:6}}><Text style={typography.bodyStrong}>Tickets pendientes de revisar</Text>{pending.slice(0,5).map(r=><Pressable key={r.id} disabled={busy} onPress={()=>choose(r)} accessibilityRole="button" style={{paddingVertical:10}}><Text style={typography.body}>{r.filename} · {r.status==='ready'?'Revisar':r.status==='failed'?'Completar a mano':'Leyendo…'}</Text></Pressable>)}</View>:null}
  {uploading||reading?<Text accessibilityRole="alert" style={typography.support}>{uploading?'Subiendo ticket…':'Leyendo el ticket. Puedes volver más tarde: quedará en tus tickets pendientes.'}</Text>:null}
  {preview?<Image source={{uri:preview}} accessibilityLabel="Foto del ticket" resizeMode="contain" style={{height:260,width:'100%'}}/>:null}
  {receipt?.status==='ready'?<Text style={typography.support}>Datos sugeridos del ticket. Revisa especialmente el total y la fecha antes de confirmar.</Text>:null}
  {receipt?.status==='failed'?<><Text accessibilityRole="alert" style={typography.support}>No se pudo completar la lectura. El ticket está guardado: puedes rellenar el gasto a mano o volver a intentarlo.</Text><PrimaryAction label="Reintentar lectura" disabled={busy} onPress={()=>{void client.finance.retryReceipt(groupId,receipt.id).then(r=>{if(alive.current)setReceipt(r);}).catch(()=>{if(alive.current)setError('La lectura sigue sin estar disponible. Puedes completar el gasto a mano.');});}}/></>:null}
  {receipt&&!expense?<Pressable disabled={busy} accessibilityRole="button" onPress={()=>{sequence.current++;setReceipt(null);setPreview(null);setReviewed(false);}}><Text style={typography.support}>Usar otro ticket o continuar sin adjunto</Text></Pressable>:null}
  <Text style={typography.bodyStrong}>Concepto</Text><TextField value={title} onChangeText={setTitle} editable={!busy} accessibilityLabel="Concepto del gasto" placeholder="Compra semanal" maxLength={120}/>
  <Text style={typography.bodyStrong}>Importe total en euros</Text><TextField value={amount} onChangeText={setAmount} editable={!busy} accessibilityLabel="Importe total en euros" placeholder="0,00" keyboardType="decimal-pad" maxLength={10}/>
  <Text style={typography.bodyStrong}>Comercio</Text><TextField value={merchant} onChangeText={setMerchant} editable={!busy} accessibilityLabel="Comercio" placeholder="Nombre del comercio (opcional)" maxLength={120}/>
  <Text style={typography.bodyStrong}>Fecha de compra</Text><TextField value={date} onChangeText={setDate} editable={!busy} accessibilityLabel="Fecha de compra" placeholder="AAAA-MM-DD (opcional)" maxLength={10}/>
  <Text style={typography.bodyStrong}>Categoría</Text><TextField value={category} onChangeText={setCategory} editable={!busy} accessibilityLabel="Categoría del gasto" placeholder="Supermercado, comida, hogar…" maxLength={60}/>
  <Text style={typography.bodyStrong}>¿Quién comparte este gasto?</Text>
  <Text style={typography.support}>Figurarás como la persona que lo pagó. Para un gasto personal, selecciónate solo a ti.</Text>
  <Pressable disabled={busy} accessibilityRole="button" onPress={()=>{setParticipants([uid]);setMode('equal');}} style={{paddingVertical:8}}><Text style={typography.body}>Solo para mí</Text></Pressable>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:12}}>{(['equal','exact','percentage'] as const).map(m=><Pressable disabled={busy} accessibilityRole="radio" accessibilityState={{selected:mode===m}} key={m} onPress={()=>setMode(m)} style={{paddingVertical:10}}><Text style={typography.body}>{mode===m?'●':'○'} {m==='equal'?'A partes iguales':m==='exact'?'Por importes':'Por porcentajes'}</Text></Pressable>)}</View>
  {state.members.map(member=>{const selected=participants.includes(member.userId);const share=shares.find(s=>s.uid===member.userId);return <View key={member.userId} style={{gap:4}}><Pressable disabled={busy} accessibilityRole="checkbox" accessibilityState={{checked:selected}} onPress={()=>setParticipants(old=>selected?old.filter(id=>id!==member.userId):[...old,member.userId])} style={{flexDirection:'row',gap:8,paddingVertical:10}}><Text style={typography.body}>{selected?'☑':'☐'} {member.displayName}{member.userId===uid?' · Tú':''}</Text>{share?<Text style={typography.support}>{formatEuros(share.amountCents)}</Text>:null}</Pressable>{selected&&mode!=='equal'?<TextField editable={!busy} value={values[member.userId]??''} onChangeText={v=>setValues(old=>({...old,[member.userId]:v}))} accessibilityLabel={`${mode==='exact'?'Importe':'Porcentaje'} de ${member.displayName}`} placeholder={mode==='exact'?'0,00 €':'0,00 %'} keyboardType="decimal-pad" maxLength={10}/>:null}</View>;})}
  {splitError?<Text accessibilityRole="alert" style={typography.support}>{splitError}</Text>:null}
  <Text style={typography.bodyStrong}>Fecha límite de pago (opcional)</Text><TextField value={dueDate} onChangeText={setDueDate} editable={!busy} accessibilityLabel="Fecha límite de pago" placeholder="AAAA-MM-DD" maxLength={10}/>
  {!validDates?<Text style={typography.support}>Revisa las fechas. Usa AAAA-MM-DD.</Text>:null}
  <Text style={typography.bodyStrong}>Notas</Text><TextField value={notes} onChangeText={setNotes} editable={!busy} accessibilityLabel="Notas del gasto" placeholder="Añade detalles (opcional)" multiline maxLength={2000}/>
  {receipt?.result?<><Pressable accessibilityRole="button" onPress={()=>setShowText(!showText)} style={{paddingVertical:10}}><Text style={typography.support}>{showText?'Ocultar':'Ver'} lectura del ticket</Text></Pressable>{showText?<View style={{gap:8}}>{Object.entries(receipt.result.fields).map(([key,f])=><Text key={key} style={typography.support}>{({merchant:'Comercio',purchased_on:'Fecha',total:'Total',currency:'Moneda',tax_amount:'IVA',receipt_number:'Número de ticket'} as Record<string,string>)[key]??key}: {f.value??'No identificado'}{f.verification!=='verified'?' · revisar':''}</Text>)}<Text selectable style={typography.support}>{receipt.result.text}</Text></View>:null}</>:null}
  {receiptId?<Pressable disabled={busy} accessibilityRole="checkbox" accessibilityState={{checked:reviewed}} onPress={()=>setReviewed(!reviewed)} style={{paddingVertical:12}}><Text style={typography.body}>{reviewed?'☑':'☐'} He revisado el ticket, el importe en euros y el reparto.</Text></Pressable>:null}
  {error?<Text accessibilityRole="alert" style={typography.support}>{error}</Text>:null}
  <PrimaryAction label={saving?'Guardando…':expense?'Guardar cambios':'Confirmar y guardar gasto'} disabled={!canSave} onPress={()=>void save()}/>
  {expense?<PrimaryAction label="Cancelar edición" disabled={saving} onPress={onCancel}/>:null}
 </View>;
}
function parseShare(raw:string){const value=raw.trim();if(!/^\d{1,7}([.,]\d{1,2})?$/.test(value))return NaN;const [whole,fraction='']=value.replace(',','.').split('.');return Number(whole)*100+Number(fraction.padEnd(2,'0'));}
