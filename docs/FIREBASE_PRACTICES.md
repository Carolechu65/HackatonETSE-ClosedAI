# Documento sustituido: backend SQLite en VPS

La decisión actual sustituye Firebase Auth, Firestore y Cloud Functions por una API propia con SQLite. La guía vigente es [SQLite y VPS: prácticas de implementación](SQLITE_VPS_PRACTICES.md), acompañada por [ADR 004](adr/004-vps-sqlite.md).

Este archivo solo mantiene los enlaces históricos. Los stubs de `functions/` y la configuración `firebase/` son legado pendiente de migrar; no demuestran que exista ya el nuevo servidor. Expo Push Service puede seguir usando FCM como transporte Android opcional, sin reintroducir Firebase como backend.
