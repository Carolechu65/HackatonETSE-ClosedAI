import { Linking, Text, View } from 'react-native';
import { PrimaryAction, typography } from '../../ui/index.ts';
export type PickedReceipt={filename:string;base64:string;preview?:string};
export function ReceiptPicker({disabled}:{disabled:boolean;onPick:(file:PickedReceipt)=>Promise<void>}){
 return <View style={{gap:8}}><Text style={typography.support}>Puedes fotografiar el ticket desde la versión web de AlarmaT.</Text><PrimaryAction disabled={disabled} label="Abrir cámara en la web" onPress={()=>void Linking.openURL('https://gex-dashboard.hopto.org/alarmat/expenses')} /></View>;
}
