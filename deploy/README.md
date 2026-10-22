# Producción de AlarmaT en el VPS

URL: **https://gex-dashboard.hopto.org/alarmat/**. API: `/alarmat/api`.
La instalación usa exclusivamente ese prefijo del vhost existente; los demás
hosts conservan su configuración original.

## Aislamiento

- `/opt/alarmat/releases/<fecha>/`: API compilada, dependencias propias y web exportada.
- `/opt/alarmat/current`: enlace al release activo; no apunta a un checkout compartido.
- `/opt/alarmat/runtime/node`: Node 22 para este servicio.
- `alarmat.service`, usuario de sistema `alarmat`, escucha solo `127.0.0.1:18787`.
- `/etc/alarmat/alarmat.env`: configuración y clave del proveedor, modo0600.
- `/var/lib/alarmat/alarmat.db`: SQLite persistente del servicio, directorio0700.
- `/etc/caddy/alarmat.caddy`: importado exclusivamente dentro de `gex-dashboard.hopto.org`.

No copiar una base de desarrollo sobre la base de producción. No ejecutar
servicios desde el checkout donde trabajan otros agentes. No detener otros
servicios ni reutilizar sus puertos.

## Compilar una actualización

Con Node22, instalar las dependencias raíz y de `server` desde sus lockfiles y
pasar `npm run check`. Para la web:

```sh
ALARMAT_WEB_BASE_PATH=/alarmat \
EXPO_PUBLIC_API_URL=https://gex-dashboard.hopto.org/alarmat/api \
node node_modules/expo/bin/cli export --platform web --max-workers 1 --output-dir dist-web
```

Crear otro directorio de release. Copiar `server/dist`, `server/migrations`,
`server/scripts`, ambos manifiestos de servidor, `deploy` y la exportación web.
En el servidor usar `npm ci --omit=dev` con Node22 y una versión compatible de npm.
Si npm13 bloquea scripts de instalación, usar npm10 para instalar/compilar
`better-sqlite3`; verificar la apertura de SQLite como usuario `alarmat`.
Las claves no se copian al release ni se incluyen en la exportación web.

Antes de cambiar `current`, ejecutar `systemctl start alarmat-backup.service`.
Conservar el destino anterior para rollback. Cambiar el enlace de forma atómica
y reiniciar **solo** `alarmat.service`: su `ExecStartPre` aplica las migraciones.
Comprobar `/alarmat/api/health` y los flujos reales tras cada actualización.
Las migraciones nuevas deben conservar datos y no modificar SQL ya aplicado.

## Caddy y convivencia

Guardar la configuración previa. Validar el candidato con `caddy validate` y
comparar su adaptación JSON: solo puede cambiar el host autorizado, y dentro de
él el prefijo de AlarmaT. Recargar Caddy con `systemctl reload caddy`.
No reemplazar toda la configuración por un ejemplo de este repositorio.

`check-existing-sites.py <baseline.json>` compara códigos HTTP y redirecciones
con una muestra tomada antes de publicar. Además, comprobar que se conservan los
puertos y servicios existentes. La evidencia local de la primera publicación está
en `/home/kripta/.local/share/alarmat/deployment-20261022/`.

## Copias y restauración

`alarmat-backup.timer` ejecuta una copia diaria por SQLite Online Backup API,
comprueba `integrity_check` y conserva catorce copias. Archivos privados en
`/var/lib/alarmat/backups/`. La primera copia se restauró en una base temporal y
se comprobó su esquema y lectura. Estas copias están en el mismo VPS; no son un
backup externo.

Para restaurar datos, detener **solo** AlarmaT, conservar la base y sus WAL/SHM
actuales, restaurar una copia íntegra compatible con el release y volver a
iniciar el servicio. No sustituir un archivo SQLite mientras está abierto.

## Android

Ver [compilación e instalación](../docs/ANDROID_RELEASE.md). El APK requiere
su firma permanente externa, y no es equivalente a la consola web.
Por instrucción del usuario, herramientas, cachés y compilación locales usan
**solo `/srv/mail/alarmat-build/`**; no modificar ni eliminar otros datos de
`/srv/mail/`. El directorio está en un volumen distinto al disco del sistema.
