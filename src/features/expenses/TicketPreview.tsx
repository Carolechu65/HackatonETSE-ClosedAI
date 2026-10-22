import { useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { useProduct } from '../../composition/ProductProvider.tsx';
import { typography } from '../../ui/index.ts';
export function TicketPreview({groupId,receiptId}:{groupId:string;receiptId:string}){
 const {client}=useProduct();const [open,setOpen]=useState(false),[image,setImage]=useState<string|null>(null),[text,setText]=useState(''),[error,setError]=useState(false);
 useEffect(()=>{if(!open)return;let active=true;setError(false);void Promise.all([client.finance.previewReceipt(groupId,receiptId),client.finance.receipt(groupId,receiptId)]).then(([p,r])=>{if(active){setImage(p);setText(r.result?.text??'');}}).catch(()=>{if(active)setError(true);});return()=>{active=false;};},[open,client,groupId,receiptId]);
 return <View><Pressable accessibilityRole="button" accessibilityState={{expanded:open}} onPress={()=>setOpen(!open)} style={{paddingVertical:10}}><Text style={typography.body}>{open?'Ocultar ticket':'Ver ticket adjunto'}</Text></Pressable>{open?<View style={{gap:8}}>{image?<Image source={{uri:image}} accessibilityLabel="Ticket adjunto al gasto" resizeMode="contain" style={{width:'100%',height:300}}/>:null}{error?<Text style={typography.support}>No se pudo cargar el ticket. Vuelve a abrirlo para reintentar.</Text>:!image&&!text?<Text style={typography.support}>Vista previa no disponible.</Text>:null}{text?<Text selectable style={typography.support}>{text}</Text>:null}</View>:null}</View>;
}
