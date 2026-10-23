import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { PrimaryAction, typography } from '../../ui/index.ts';
import { prepareReceipt, type PickedReceipt } from './receiptFile.ts';
export type { PickedReceipt } from './receiptFile.ts';
export function ReceiptPicker({disabled,onPick}:{disabled:boolean;onPick:(file:PickedReceipt)=>Promise<void>}){
 const camera=useRef<HTMLInputElement>(null),file=useRef<HTMLInputElement>(null);const [error,setError]=useState<string|null>(null);const [busy,setBusy]=useState(false);const locked=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function pick(input:HTMLInputElement){const selected=input.files?.[0];input.value='';if(!selected||disabled||locked.current)return;locked.current=true;setBusy(true);setError(null);
 try{if(selected.size>20*1024*1024)throw new Error('La foto es demasiado grande. Máximo 20 MB antes de comprimir.');
  if(selected.type==='application/pdf'){if(selected.size>8*1024*1024)throw new Error('El PDF debe ocupar menos de 8 MB.');const data=await read(selected);if(alive.current)await onPick(prepareReceipt(selected.name,data.split(',')[1]!,'application/pdf'));return;}
  const source=await read(selected);const img=new globalThis.Image();img.src=source;await img.decode();
  const scale=Math.min(1,2000/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('No se pudo preparar la foto.');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
  let data=canvas.toDataURL('image/jpeg',.86);if(data.length>900000)data=canvas.toDataURL('image/jpeg',.65);
  if(alive.current)await onPick(prepareReceipt(selected.name,data.split(',')[1]!,'image/jpeg'));
 }catch(e){if(alive.current)setError(e instanceof Error?e.message:'No se pudo abrir la foto. Prueba con JPG o PNG.');}finally{locked.current=false;if(alive.current)setBusy(false);}}
 return <View style={{gap:10}}>
  <input ref={camera} type="file" accept="image/*" capture="environment" aria-label="Fotografiar ticket" style={{display:'none'}} onChange={e=>void pick(e.currentTarget)} />
  <input ref={file} type="file" accept="image/jpeg,image/png,application/pdf" aria-label="Seleccionar ticket" style={{display:'none'}} onChange={e=>void pick(e.currentTarget)} />
  <PrimaryAction label="Hacer foto del ticket" disabled={disabled||busy} onPress={()=>camera.current?.click()} />
  <PrimaryAction label="Subir foto o PDF" disabled={disabled||busy} onPress={()=>file.current?.click()} />
  {error?<Text accessibilityRole="alert" style={typography.support}>{error}</Text>:null}
 </View>;
}
function read(blob:Blob):Promise<string>{return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('No se pudo leer el archivo.'));reader.readAsDataURL(blob);});}
