# Android de producción

## APK actual · 22-10-2026 · 347d2a5

La descarga pública [alarmat.apk](https://gex-dashboard.hopto.org/alarmat/downloads/alarmat.apk)
apunta a `alarmat-347d2a5.apk`, que sustituye como versión actual a `14653a4`
(conservada para recuperación). Incluye alarmas propias, fichas de miembros,
reapertura de tareas, participantes/fecha de gastos y su historial plegable.
Las alarmas sonoras vinculadas a una tarea pendiente repiten a los diez minutos;
completar la tarea solicita su retirada y el móvil la aplica al sincronizar.

Build release ARM64 correcto; 17 verificaciones de APK correctas, firma permanente
coincidente y 220 archivos de fuente comparados con el snapshot previo al build.
También se comprobó la presencia en DEX de la política de repetición y del enlace
a tarea, y en el bundle de las nuevas pantallas. La descarga HTTPS es idéntica al
artefacto firmado. SHA-256:
`94c283038f1b5e061cadc185539a9b4de485d40641cfdaf2d56d1625ec011b75`.

Evidencia: `/srv/mail/alarmat-build/artifacts/347d2a5/` y
`/srv/mail/alarmat-build/member-details-20261022/`. Falta comprobación física de
sonido, pantalla bloqueada y comportamiento específico del fabricante. La web
no sustituye la instalación de este APK para la ejecución sonora en segundo plano.

La web pública permite gestionar el piso, propuestas, tareas y asistente. El sonido
local sin JavaScript y los widgets necesitan el APK Android; Expo Go y añadir la
web a inicio no instalan estos componentes.

## Compilar el APK

Requiere Node 22, JDK compatible con Gradle 9.4.1, Android SDK plataforma 37.0,
build-tools 37.0.0, NDK 27.1.12297006 y CMake 3.22.1. El script limita Gradle a un
worker y construye ARM64, la arquitectura de la mayoría de teléfonos actuales.
Un dispositivo exclusivamente de 32 bits necesita una compilación para su ABI.

La identidad de firma permanece fuera del repositorio. Mantener una copia segura
del keystore y sus contraseñas permite instalar futuras actualizaciones sin borrar
los datos. La configuración rechaza un release sin identidad propia, evitando la
firma de depuración de la plantilla Expo.

```sh
npm ci
export ANDROID_HOME=/ruta/al/android-sdk
# Este fichero privado exporta ALARMAT_ANDROID_KEYSTORE, STORE_PASSWORD,
# KEY_ALIAS y KEY_PASSWORD, todos con prefijo ALARMAT_ANDROID_.
source /ruta/privada/android-signing.env
./scripts/android-release.sh
```

El API predeterminado es `https://gex-dashboard.hopto.org/alarmat/api`. Puede
sobrescribirse con `EXPO_PUBLIC_API_URL` antes de compilar. El cliente no incluye
la clave de OpenRouter. `ALARMAT_WEB_BASE_PATH` se elimina del entorno Android
para conservar rutas nativas independientes del prefijo web `/alarmat`.

El resultado esperado es `android/app/build/outputs/apk/release/app-release.apk`.
El bundle JavaScript está incluido y no requiere Metro. El script deja R8
desactivado para reducir consumo de memoria; no cambia el modo release ni la firma.
No se publica un enlace a APK hasta que el ensamblado y su firma se hayan verificado.

## Uso en un teléfono

1. Descargar el APK publicado e instalarlo. Android puede pedir autorizar la
   instalación desde ese navegador; no es necesario habilitar depuración USB.
2. Iniciar sesión, crear o unirse al piso y seleccionar ese móvil como dispositivo
   principal desde los ajustes de la app.
3. Conceder notificaciones y alarmas exactas desde los controles de permisos.
   Conceder pantalla completa si se desea la presentación sobre el bloqueo.
4. Recibir una propuesta y aceptarla expresamente. Comprobar que aparece programada:
   recibirla o abrir el detalle no autoriza el sonido.
5. Mantener pulsado un hueco de la pantalla de inicio → Widgets → AlarmaT y arrastrar
   el widget. Sus botones abren la propuesta/detalle; no aceptan por sí mismos.
6. Hacer una primera prueba con unos minutos de margen y el móvil bloqueado.
   Detener o posponer una alarma no completa la tarea vinculada.

El widget muestra su última lectura, no promete datos recién sincronizados si la
app permanece cerrada. Cambiar de cuenta o cerrar sesión limpia la proyección.
Los registros nativos vinculados al dispositivo están excluidos de backup Android.

No existe evidencia física todavía. Seguir `docs/qa/ALARM_RUNTIME.md` y
`docs/qa/P6_WIDGET.md` en un teléfono real para verificar sonido, permisos, launcher,
reinicio y cierre normal del proceso. Android force-stop, teléfono apagado y antes
del primer desbloqueo quedan fuera de la garantía. La recurrencia futura requiere
que la sincronización materialice próximas ocurrencias; no hay generación nativa
indefinida mientras la app permanece detenida.

## Compilación externa cuando el VPS no tiene espacio

`.github/workflows/android-release.yml` se ejecuta manualmente o al cambiar los
archivos Android/app en `main`. No se ejecuta con secrets de pull requests ni
recibe la clave permanente de producción. Genera una identidad temporal del runner
para el **APK candidato**, verifica el ensamblado y conserva APK y SHA-256 como
artifact durante 14 días. Ese candidato no debe publicarse a usuarios: primero se
comprueba que el run corresponde al commit aprobado y se valida el checksum de la
descarga. Luego se vuelve a firmar en el VPS con la identidad permanente:

```sh
# Tras descargar y verificar el artifact del commit aprobado:
source /ruta/privada/android-signing.env
export ANDROID_HOME=/ruta/al/android-sdk
./scripts/android-sign-candidate.sh candidato/app-release.apk alarmat.apk
```

La firma final se comprueba con `apksigner` y se emite `alarmat.apk.sha256`.
El keystore permanente permanece fuera del repositorio y del runner. El archivo
candidato tiene una identidad diferente en cada ejecución y no sirve para instalar
actualizaciones sobre la aplicación final. Publicar únicamente el APK firmado en
el VPS, después de comprobar la huella del certificado y el paquete esperado.

En el primer intento local del 22-10-2026, el VPS llegó a la configuración CMake del release
ARM64, pero las extracciones de dependencias agotaban la reserva de disco. Se
terminó exclusivamente ese Gradle y se eliminó únicamente el NDK descargado para
el intento, recuperando la reserva. Ese intento no obtuvo APK. La integración SSH
permite activar el workflow al subir a main sin cargar claves ni necesitar una
sesión GitHub CLI. No confundir el workflow listo con un APK ya generado: consultar
el resultado real y verificar el artifact antes de publicar su enlace.


## Primer APK publicado y verificado · 22-10-2026

El segundo intento, aislado en `/srv/mail/alarmat-build/`, completó el release
ARM64 de `14653a4`: 49.281.373 bytes, firma permanente y ejecución autónoma sin
Metro. El tramo final D8 necesitó heap1024MB y metaspace512MB, manteniendo un
solo worker y límite de memoria del proceso2300MB. No se modificaron otros
servicios ni datos del volumen de correo.

- [Guía de instalación](https://gex-dashboard.hopto.org/alarmat/install/index.html).
- [Descarga Android actual](https://gex-dashboard.hopto.org/alarmat/downloads/alarmat.apk).
- [APK inicial14653a4](https://gex-dashboard.hopto.org/alarmat/downloads/alarmat-14653a4.apk).
- SHA-256 inicial: `652d372ecfec0d14e85f53c78002621fb23e91ad91d73796eecd0de5d460225d`.

La descarga HTTPS se comprobó byte a byte por checksum. Las16 verificaciones
incluyen paquete correcto, firma permanente, ausencia de depuración y claves de
servidor, API GEX, alineación16KB, icono nuevo, widget y receptor/servicio de alarma.
Se contrastaron217 archivos fuente con ese commit. Evidencia en
`/srv/mail/alarmat-build/artifacts/14653a4/verification.json`.

Este APK corresponde a14653a4, anterior a las funciones añadidas después en
`ae2290f`; esas funciones requieren el siguiente APK. El enlace de descarga actual
puede actualizarse cuando se verifique otro release. La prueba física de sonido,
permisos, reinicio y widgets en un teléfono sigue pendiente.

Los binarios se conservan en `/opt/alarmat/downloads`, con un enlace desde
`current/web/downloads`. Las siguientes publicaciones deben conservar ese enlace,
`web/install/` y `web/brand/`. La guía usa `install/index.html` explícito porque la
ruta de directorio `install/` cae en el fallback de la SPA.
