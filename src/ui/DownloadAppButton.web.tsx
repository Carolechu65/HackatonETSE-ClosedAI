import { View, Text } from 'react-native';
import { colors, typography, layout } from './theme.ts';
import { fontFamily } from './fonts.ts';

/** A normal same-origin download, deliberately outside the SPA router. */
export function DownloadAppButton() {
  return <View style={{ marginTop: 16, paddingTop: 16, gap: 8, borderTopWidth: 1, borderColor: colors.ln }}>
    <a href="/alarmat/downloads/alarmat.apk" download="alarmat.apk" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
      width: '100%', minHeight: layout.minTouchTarget, padding: '13px 12px',
      backgroundColor: colors.ac, color: colors.onAvatar, border: `1px solid ${colors.ln}`,
      borderRadius: layout.radius, fontFamily: fontFamily.body, fontSize: 16, lineHeight: '24px',
      textAlign: 'center', textDecoration: 'none',
    }}>Descargar app para móvil</a>
    <Text style={typography.support}>Para Android · Descarga el APK e instálalo en tu móvil.</Text>
  </View>;
}
