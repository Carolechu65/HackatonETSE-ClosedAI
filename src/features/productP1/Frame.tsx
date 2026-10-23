import { DownloadAppButton } from '../../ui/DownloadAppButton';
import { useEffect, type ReactNode } from 'react';
import { router, usePathname } from 'expo-router';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProduct } from '../../composition/ProductProvider.tsx';
import { Screen, ScreenHeader, RetroTabBar, IconButton, colors, typography } from '../../ui/index.ts';
import { useTabSwipe, TAB_SWIPE_SURFACE } from '../../ui/useTabSwipe.ts';
import { Message } from '../../ui/Controls.tsx';
const tabs=[{key:'/',name:'index'},{key:'/expenses',name:'gastos'},{key:'/tasks',name:'tareas'},{key:'/group',name:'piso'}];
export function Frame({title,eyebrow,children}:{title:string;eyebrow:string;children:ReactNode}){
  const {state}=useProduct();const path=usePathname();const insets=useSafeAreaInsets();
  useEffect(()=>{if(state.ready&&!state.session)router.replace({pathname:'/login',params:{returnTo:path}});},[state.ready,state.session,path]);
  const swipeSurface = useTabSwipe(path, state.ready && !!state.session);
  if(!state.ready||!state.session)return <View style={styles.loading}><ActivityIndicator color={colors.tx}/></View>;
  return <View ref={swipeSurface} nativeID={TAB_SWIPE_SURFACE} style={styles.root}><KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={styles.root}>
    <Screen scroll contentStyle={styles.page}><View style={styles.header}><View style={{flex:1}}><ScreenHeader title={title} eyebrow={eyebrow} brand={path==='/'}/></View><View style={styles.actions}><IconButton name="calendar" tone="plain" onPress={()=>router.push('/calendar')} accessibilityLabel="Abrir calendario"/><IconButton name="settings" tone="plain" onPress={()=>router.push('/settings')} accessibilityLabel="Cuenta y permisos"/></View></View>
      {state.session.mode==='demo'?<Text style={typography.label}>DEMO · DATOS DE EJEMPLO</Text>:null}<Message text={state.error} error/>{children}{path==='/' ? <DownloadAppButton /> : null}
    </Screen>
    <View style={styles.nav}><RetroTabBar state={{index:tabs.findIndex(x=>x.key===path),routes:tabs}} descriptors={{}} emitter={{emit:()=>({defaultPrevented:false})}} navigateToTab={key=>router.push(key as '/')} insets={{bottom:insets.bottom}}/></View>
  </KeyboardAvoidingView></View>;
}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:colors.wall},loading:{flex:1,backgroundColor:colors.wall,justifyContent:'center',alignItems:'center'},page:{paddingTop:4,gap:12},header:{flexDirection:'row',alignItems:'flex-start'},actions:{flexDirection:'row',gap:4,marginTop:4},nav:{width:'100%',maxWidth:460,alignSelf:'center'}});
