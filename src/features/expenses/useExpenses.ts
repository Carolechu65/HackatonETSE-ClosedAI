import { useCallback, useEffect, useRef, useState } from 'react';
import { useProduct } from '../../composition/ProductProvider.tsx';
import type { Expense } from './client.ts';
export function useExpenses(){
  const {client,state}=useProduct(); const [snapshot,setSnapshot]=useState<{scope:string;expenses:Expense[];error:string|null;loaded:boolean}>({scope:'',expenses:[],error:null,loaded:false});
  const scope=`${state.session?.userId}:${state.groupId}:${state.session?.mode}`;const current=useRef(scope);const sequence=useRef(0);if(current.current!==scope){current.current=scope;sequence.current++;}
  const reload=useCallback(async()=>{const request=++sequence.current;if(!state.groupId||state.session?.mode!=='live')return;try{const expenses=await client.finance.list(state.groupId);if(current.current===scope&&request===sequence.current)setSnapshot({scope,expenses,error:null,loaded:true});}catch(e){if(current.current===scope&&request===sequence.current)setSnapshot(old=>({scope,expenses:old.scope===scope?old.expenses:[],error:e instanceof Error?e.message:'No se pudieron cargar los gastos.',loaded:false}));}},[client,scope,state.groupId,state.session?.mode]);
  useEffect(()=>{void reload();},[reload,state.lastSync]);
  return {expenses:snapshot.scope===scope?snapshot.expenses:[],error:snapshot.scope===scope?snapshot.error:null,loaded:state.session?.mode==='live'&&snapshot.scope===scope&&snapshot.loaded,reload};
}
