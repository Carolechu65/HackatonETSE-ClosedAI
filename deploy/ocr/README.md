# OCR de tickets de AlarmaT

El lector predeterminado es local: Tesseract (español e inglés), PyMuPDF y un
parser conservador de tickets. No necesita API keys ni envía documentos a otro
proveedor. El contenedor y su almacenamiento son exclusivos de AlarmaT.

## Imagen y despliegue

La imagen derivada reutiliza las bibliotecas del motor ya instalado, fijado al
identificador `sha256:3f8c4e369c0dc3723d78151378582f6ced28d041a4c4d75d41e861c9b6d1aa84`,
sin acceder al contenedor ni a los volúmenes de Trace-it. El tag de base es una
referencia local; comprobar su ID antes de compilar:

```sh
docker tag sha256:3f8c4e369c0dc3723d78151378582f6ced28d041a4c4d75d41e861c9b6d1aa84 alarmat-ocr-base:3f8c4e369c0d
docker image inspect alarmat-ocr-base:3f8c4e369c0d --format '{{.Id}}'
docker build --pull=false -t alarmat-ocr-local:20261024 -f ocr/Dockerfile ocr
python3 deploy/ocr/provision.py
curl --fail http://127.0.0.1:18788/health
```

`ALARMAT_OCR_IMAGE` permite fijar el ID de la imagen derivada verificada en vez del
tag. `provision.py` preserva el token interno existente, los originales y la caché
`/var/lib/alarmat/ocr`; solo recrea `alarmat-ocr`. No copia credenciales de ninguna
otra aplicación. El adaptador se instala en `/opt/alarmat/ocr`, fuera del checkout.

El proceso usa UID 10001, filesystem de solo lectura, memoria de 1500 MB, dos CPU,
128 procesos y `/tmp` temporal limitado a 128 MB. El puerto 18788 se publica solo
en loopback. `/etc/alarmat/ocr.env` entrega URL y token a `alarmat.service` mediante
su drop-in. El script no cambia el release activo ni reinicia la API.

## Lectura y límites

`POST /extract` recibe los bytes de JPEG, PNG o PDF y exige `Authorization: Bearer …`
y `X-Filename`. Admite hasta 8 MB y cuatro páginas; rechaza PDFs cifrados, archivos
inválidos y tipos de documento diferentes. Solo lee un ticket a la vez (429 si el
lector está ocupado). Los PDFs con texto conservan el texto observado; las páginas
escaneadas se renderizan hasta 2000 píxeles por lado y se leen con Tesseract, con
hasta 12 segundos por página y un presupuesto OCR de 40 segundos por documento.

Devuelve comercio, fecha, total, moneda y, cuando aparecen con claridad, número de
ticket/cuota de IVA. Todos los valores son propuestas `unverified`. El parser no
usa subtotal, efectivo entregado ni cambio como total, no elige entre totales o
fechas contradictorios y no inventa monedas ausentes. Un símbolo de dólar ambiguo
o monedas contradictorias se marcan `UNKNOWN` para exigir revisión del importe en
EUR. Devuelve texto y una miniatura; nunca crea gastos automáticamente.

Los originales de cada ticket siguen en SQLite de AlarmaT y entran en su copia de
seguridad. El modo local trabaja en memoria y no duplica los nuevos originales en
la caché del motor. La caché histórica se conserva y no se borra al actualizar.

## Pruebas

```sh
python3 ocr/test_local_receipt.py
docker exec -i alarmat-ocr python < ocr/test_adapter.py
docker exec -i alarmat-ocr python < ocr/test_local_receipt.py
```

Antes de publicar, probar JPEG, PNG y PDF con un ticket sintético, además de exceso
de tamaño/páginas y peticiones sin token. La prueba del 24-10-2026 leyó comercio,
fecha, EUR y 28,60 € en PNG/JPEG/PDF sin claves externas. Evidencia de ese despliegue:
`/srv/mail/alarmat-build/user-ai-ocr-evidence/`. La calidad de una foto real depende
de luz, enfoque y orientación; la revisión y la entrada manual siguen disponibles.

## Modo remoto opcional

`ALARMAT_OCR_READER=remote` conserva el adaptador anterior. Requiere configurar
credenciales propias de AlarmaT en `/etc/alarmat/ocr-provider.env` (0600) antes de
provisionar. Solo entonces se pasa ese fichero al contenedor. No hay fallback
silencioso entre lectores ni préstamo de claves. En modo local ese fichero no se
lee ni se pasa al proceso, aunque se conserve para recuperación.

La sintaxis del ejecutable local sigue la [documentación de Tesseract](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html).
