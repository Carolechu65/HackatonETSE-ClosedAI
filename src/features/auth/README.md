# P2 · sesión

Crear pantalla de acceso contra el adaptador HTTP de P5; P3 implementa usuarios y sesiones en la API del VPS. El token opaco se guarda en SecureStore, no en componentes ni SQLite de proyecciones.
Primera entrega: dos usuarios de prueba con login real y cierre de sesión que revoque el token y limpie los datos locales.
No persistir contraseñas ni presentar una sesión ficticia como autenticada. Contrato y límites en [SQLite/VPS](../../../docs/SQLITE_VPS_PRACTICES.md).
