# Android de producción

## APK actual · 24-10-2026 · 0.2.0 · 11bce03

La descarga pública [alarmat.apk](https://gex-dashboard.hopto.org/alarmat/downloads/alarmat.apk)
apunta al release ARM64 de AlarmaT 0.2.0, `versionCode=2`, construido desde
`11bce03`. Conserva el paquete `com.closedai.alarmat` y el certificado permanente,
por lo que permite actualizar la instalación anterior sin borrar sus datos.

Incluye «Conectar mi IA» con credenciales individuales y el flujo nativo de tickets:
cámara, selección de fotos o PDF y revisión del resultado OCR antes de guardar el
gasto. Mantiene alarmas, tareas, gastos, propuestas y los tres widgets del launcher.
El APK contiene el bundle Hermes de producción y funciona sin Metro. R8 y la
reducción de recursos están habilitados.

Artefacto: `alarmat-0.2.0-11bce03.apk`, 36.487.610 bytes (un 26 % menos que el
APK anterior de 49.365.390 bytes). SHA-256:
`5c4c4380886dc0f55f4a424a2d76797e8ad750a5ce47249f6eed057e21805708`.
La descarga HTTPS completa de la URL estable coincide con el artefacto firmado.

Pasaron 20 comprobaciones del APK, seis comprobaciones de presencia de funciones
y las ocho pruebas nativas de políticas de alarma y acciones del widget. Los 245
archivos del snapshot coinciden con el commit de origen. La firma permanente
coincide con el APK anterior; se comprobaron versión, permisos, backup desactivado,
ABI ARM64, bundle Hermes, API de producción, módulos de tickets, tres widgets y
alineación ZIP de 16 KiB. El análisis individual de las 15.974 cadenas de Hermes
no encontró el patrón de claves de proveedor; la búsqueda sobre bytes concatenados
daba cinco falsos positivos documentados. Esto no sustituye la revisión de claves
y secretos en el código y el servidor.

Evidencia de compilación y verificación:
`/srv/mail/alarmat-build/user-ai-android/artifacts/`, con `verification.json`,
`provider-key-scan.json`, resultados XML nativos y `mapping.txt.gz` de R8.

Los APK anteriores se retiran a petición del usuario para recuperar espacio. Se
mantiene la URL estable de descarga; los nombres y hashes históricos de esta guía
son referencias de auditoría, no enlaces de descarga vigentes.

La compilación se ejecutó aislada bajo `/srv/mail/alarmat-build/`, con un worker de
Gradle, un worker de Metro, Ninja limitado a `-j1` en el SDK privado de esta tarea,
heap Java de 1536 MiB para R8, metaspace de 384 MiB y límite total del grupo de
2300 MiB. Tras completar R8, el ensamblado final se reanudó incrementalmente con
un daemon nuevo y heap de 1024 MiB, conservando los resultados de minificación,
para dejar memoria al lint y al empaquetado.
Los intentos con heap de 1024 MiB agotaron la memoria de R8; el ajuste se aplicó al
comando privado de compilación y después se reflejó en la receta versionada. SDK, wrappers y caches temporales se eliminan tras
validar y publicar el artefacto; se conservan la evidencia y el mapping de R8 para
diagnóstico.

La verificación física está pendiente: cámara y selector en un dispositivo real,
sonido con pantalla bloqueada, permisos, launcher, reinicio y restricciones del
fabricante. Las comprobaciones del artefacto y las pruebas automatizadas no
sustituyen esas comprobaciones. La web permite gestionar la app, pero los widgets
y el sonido nativo con la app cerrada requieren el APK; Expo Go y añadir la web al
inicio no instalan esos componentes.

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
claves de los proveedores de IA. `ALARMAT_WEB_BASE_PATH` se elimina del entorno Android
para conservar rutas nativas independientes del prefijo web `/alarmat`.

El resultado esperado es `android/app/build/outputs/apk/release/app-release.apk`.
El bundle JavaScript está incluido y no requiere Metro. El script activa R8 y la
reducción de recursos, con heap de 1536 MiB y metaspace de 384 MiB. Se pueden ajustar
mediante `ALARMAT_ANDROID_JVMARGS`; bajo un límite total de 2300 MiB se necesitó
reanudar la fase posterior a R8 como se documenta arriba. No se debe repetir
`prebuild --clean` entre fases porque borraría los resultados incrementales.
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
- APK inicial retirado: `alarmat-14653a4.apk`.
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


## APK de widgets y asignaciones · 22-10-2026

Publicado por petición expresa del usuario en la descarga habitual: fuente local
`b236f0a`, ARM64, 49.365.390 bytes. La publicación inicial se hizo desde el VPS; el cierre posterior está versionado en main.
SHA-256: `b20742aaee4515fa82405975d8f54f288c858ad0b35f2da40be6947100667606`.
La descarga HTTPS se comparó byte a byte con el APK firmado. Pasaron las17
verificaciones del artefacto y7 comprobaciones de presencia de las funciones
nuevas. Evidencia: `/srv/mail/alarmat-build/artifacts/b236f0a/`.

Incluye los tres widgets, checklist, aceptación de asignaciones y creación conjunta
de alarma y tarea. Se conserva la web de tickets (schema8); el OCR de tickets no
forma parte de este APK. Las pruebas nativas `testDebugUnitTest` finalizaron correctamente
(`BUILD SUCCESSFUL`); su resultado queda en
`/srv/mail/alarmat-build/widgets-20261022/native-tests.log`. La prueba en teléfono
físico está pendiente. Los avisos con app cerrada usan sincronización periódica
(mínimo15min, sujeta a Android), no push instantáneo.
