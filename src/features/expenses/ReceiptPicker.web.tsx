import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { PrimaryAction, typography } from '../../ui/index.ts';
export type PickedReceipt={filename:string;base64:string;preview?:string};
export function ReceiptPicker({disabled,onPick}:{disabled:boolean;onPick:(file:PickedReceipt)=>Promise<void>}){
 const camera=useRef<HTMLInputElement>(null),file=useRef<HTMLInputElement>(null);const [error,setError]=useState<string|null>(null);
 async function pick(input:HTMLInputElement){const selected=input.files?.[0];input.value='';if(!selected)return;setError(null);
 try{if(selected.size>20*1024*1024)throw new Error('La foto es demasiado grande. Máximo 20 MB antes de comprimir.');
  if(selected.type==='application/pdf'){if(selected.size>8*1024*1024)throw new Error('El PDF debe ocupar menos de 8 MB.');const data=await read(selected);await onPick({filename:selected.name,base64:data.split(',')[1]!});return;}
  const source=await read(selected);const img=new globalThis.Image();img.src=source;await img.decode();
  const scale=Math.min(1,2000/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('No se pudo preparar la foto.');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
  let data=canvas.toDataURL('image/jpeg',.86);if(data.length>900000)data=canvas.toDataURL('image/jpeg',.65);
  await onPick({filename:selected.name.replace(/\.[^.]+$/,'')+'.jpg',base64:data.split(',')[1]!,preview:data});
 }catch(e){setError(e instanceof Error?e.message:'No se pudo abrir la foto. Prueba con JPG o PNG.');}}
 return <View style={{gap:10}}>
  <input ref={camera} type="file" accept="image/*" capture="environment" aria-label="Fotografiar ticket" style={{display:'none'}} onChange={e=>void pick(e.currentTarget)} />
  <input ref={file} type="file" accept="image/jpeg,image/png,application/pdf" aria-label="Seleccionar ticket" style={{display:'none'}} onChange={e=>void pick(e.currentTarget)} />
  <PrimaryAction label="Hacer foto del ticket" disabled={disabled} onPress={()=>camera.current?.click()} />
  <PrimaryAction label="Subir foto o PDF" disabled={disabled} onPress={()=>file.current?.click()} />
  {error?<Text accessibilityRole="alert" style={typography.support}>{error}</Text>:null}
 </View>;
}
function read(blob:Blob):Promise<string>{return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('No se pudo leer el archivo.'));reader.readAsDataURL(blob);});}
