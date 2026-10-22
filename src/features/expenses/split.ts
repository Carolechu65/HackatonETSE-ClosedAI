/** All accounting uses integer cents. Percentage inputs use basis points (100%=10000). */
export type ExpenseSplit = { mode:'equal'|'exact'|'percentage'; values?:Array<{uid:string;value:number}> };
export function allocateExpense(total:number,participants:string[],split:ExpenseSplit={mode:'equal'}):Array<{uid:string;amountCents:number}>{
  if(!Number.isSafeInteger(total)||total<1||!participants.length||new Set(participants).size!==participants.length)throw new Error('Selecciona participantes y un importe válido.');
  const ids=[...participants].sort();
  if(split.mode==='equal')return ids.map((uid,i)=>({uid,amountCents:Math.floor(total/ids.length)+(i<total%ids.length?1:0)}));
  if(!['exact','percentage'].includes(split.mode)||!Array.isArray(split.values)||split.values.length!==ids.length)throw new Error('Completa el reparto de todas las personas.');
  const values=new Map<string,number>();
  for(const item of split.values){if(!ids.includes(item.uid)||values.has(item.uid)||!Number.isSafeInteger(item.value)||item.value<0||item.value>100000000)throw new Error('El reparto contiene valores no válidos.');values.set(item.uid,item.value);}
  const sum=[...values.values()].reduce((a,b)=>a+b,0);
  if(split.mode==='exact'){if(sum!==total)throw new Error('Los importes deben sumar el total del gasto.');return ids.map(uid=>({uid,amountCents:values.get(uid)!}));}
  if(sum!==10000)throw new Error('Los porcentajes deben sumar 100 %.');
  const parts=ids.map(uid=>{const product=total*values.get(uid)!;return {uid,amountCents:Math.floor(product/10000),remainder:product%10000};});
  let remaining=total-parts.reduce((a,p)=>a+p.amountCents,0);
  for(const p of [...parts].sort((a,b)=>b.remainder-a.remainder||a.uid.localeCompare(b.uid))){if(remaining-->0)p.amountCents++;}
  return parts.map(({uid,amountCents})=>({uid,amountCents}));
}
