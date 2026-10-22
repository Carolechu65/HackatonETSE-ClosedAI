# OCR de tickets de AlarmaT

El adaptador `ocr/alarmat_ocr.py` reutiliza el motor de ingestión y extracción por
esquema de la imagen **ya desplegada** de Trace-it, fijada al identificador
`sha256:3f8c4e369c0dc3723d78151378582f6ced28d041a4c4d75d41e861c9b6d1aa84`.
No accede a la base de datos, volúmenes ni sesiones de Trace-it.

Desde este checkout, como root:

```sh
python3 deploy/ocr/provision.py
curl --fail http://127.0.0.1:18788/health
```

El script copia exclusivamente la configuración de proveedores OCR permitida desde
el contenedor origen a `/etc/alarmat/ocr-provider.env` (0600), genera una clave
independiente y preserva esa clave al repetir la instalación. No imprime secretos.
El proceso usa UID 10001, filesystem de solo lectura, memoria limitada y su propio
almacenamiento `/var/lib/alarmat/ocr`. El código del adaptador queda en
`/opt/alarmat/ocr`; no se ejecuta desde el checkout compartido. El puerto 18788
solo se publica en loopback. Docker reinicia `alarmat-ocr` tras reiniciar el host.

`/etc/alarmat/ocr.env` proporciona `ALARMAT_OCR_URL` y `ALARMAT_OCR_TOKEN` a
`alarmat.service` mediante `/etc/systemd/system/alarmat.service.d/ocr.conf`.
**El script no cambia el release activo ni reinicia la API**: esas operaciones se
hacen en el despliegue habitual después de las comprobaciones y copia de seguridad.
El script recrea exclusivamente el contenedor `alarmat-ocr`.

`POST /extract` recibe los bytes de JPG, PNG o PDF, con `Authorization: Bearer …`
y `X-Filename`. Devuelve los campos `merchant`, `purchased_on`, `total`, `currency`,
`tax_amount` y `receipt_number`, su estado de verificación, evidencia, texto OCR,
advertencias y una miniatura JPEG de la primera página. Límite 8 MB y cuatro
páginas. Solo se procesa una lectura a la vez; otra recibe HTTP 429. Los resultados
con dudas conservan el estado de revisión del motor y nunca crean gastos solos.
La API de AlarmaT aplica autenticación de usuario, permisos de grupo y validación
antes de llamar a este endpoint interno. La clave del sidecar no va al navegador.

Los originales, cachés y resultados pertenecen exclusivamente a AlarmaT en
`/var/lib/alarmat/ocr`; no hay eliminación automática de ese archivo actualmente.
La copia diaria de SQLite de AlarmaT no incluye este directorio OCR. Para restaurar
la caché OCR, detener solo `alarmat-ocr` antes de copiar sus datos.

Comprobación de funcionamiento: ticket sintético en español con comercio,
fecha, IVA e importe final; se envía al proveedor real sin datos personales.
Guardar la evidencia de despliegue fuera del repositorio, en
`/srv/mail/alarmat-build/ocr-evidence/`.

Dos adaptaciones pequeñas del contrato de tickets mantienen la revisión humana:
los separadores de recibo formados solo por guiones u otros delimitadores no
activan el detector de repetición del modelo; las fechas con hora se convierten
a fecha ISO únicamente si coinciden por completo y son válidas en el calendario.
Ambas mantienen los valores como propuestas sin verificar. Si no se puede leer
ninguno de comercio, fecha o total, el endpoint devuelve 503 para permitir
reintento o captura manual en AlarmaT.

Validación local del adaptador en la imagen en ejecución:

```sh
docker exec -i alarmat-ocr python < ocr/test_adapter.py
```
