# Estado de las prácticas y decisiones — octubre de 2026

**Corte de investigación: 22 de octubre de 2026.** Se han contrastado fuentes oficiales disponibles en esa fecha. Aquí «SOTA» significa prácticas actuales pertinentes para construir alarmaT; no una clasificación universal de frameworks ni evidencia de que el prototipo ya alcance determinados resultados. Las recomendaciones para este hackathon son decisiones del equipo derivadas de esas fuentes.

## Conclusiones aplicables

| Área | Evidencia y práctica actual | Decisión para alarmaT |
|---|---|---|
| App y desarrollo | Expo permite añadir integración nativa mediante módulos locales. [Expo Modules API](https://docs.expo.dev/modules/get-started/). | React Native + TypeScript + Expo Router; funcionalidades separadas y adaptador nativo acotado para alarmas. |
| Modularización | Las fronteras de módulos deben responder a necesidades y costes del proyecto. [Guía Android](https://developer.android.com/topic/modularization). | Seis propietarios de áreas dentro de un proyecto Expo y backend separado; no un paquete o módulo Gradle por persona. |
| Alarmas | AlarmManager programa eventos fuera del proceso, sujeto a permisos y restricciones. [Alarmas Android](https://developer.android.com/develop/background-work/services/alarms). | Persistir consentimiento y programación; implementar recepción, sonido y acciones; comprobar en dispositivos físicos. |
| Widgets | expo-widgets ofrece integración nativa con un entorno de ejecución propio. [Expo Widgets](https://docs.expo.dev/versions/latest/sdk/widgets/). | Development build, proyección pequeña y acciones que respeten los contratos. Abrir la app cuando sea necesario. |
| Firebase en Expo | Expo documenta Firebase JS SDK y React Native Firebase. [Integración Firebase](https://docs.expo.dev/guides/using-firebase/). | React Native Firebase por acceso a FCM nativo; no mezclar ambos SDK para las mismas operaciones. |
| Concurrencia | Las transacciones pueden reintentarse y los triggers repetirse o llegar fuera de orden. [Transacciones](https://firebase.google.com/docs/firestore/manage-data/transactions), [triggers](https://firebase.google.com/docs/functions/firestore-events). | Comandos con ID, versiones y outbox; efectos externos fuera de transacciones; deduplicación también en el móvil. |
| Offline | La caché de Firestore permite datos locales; no implementa automáticamente los acuerdos del producto. [Persistencia offline](https://firebase.google.com/docs/firestore/manage-data/enable-offline). | Firestore conserva estado compartido, expo-sqlite proyecciones y el módulo nativo su registro operativo. Nuevas aceptaciones requieren confirmación de versión; detener una alarma propia funciona localmente. |
| Autorización | Las bibliotecas servidor eluden Security Rules. [Bibliotecas cliente y servidor](https://firebase.google.com/docs/firestore/client/libraries). | Rules para lecturas cliente y autorización explícita en Functions. Solo el destinatario puede consentir; un miembro del grupo no puede leer cualquier propuesta privada. |
| Verificación | Emulator Suite permite pruebas locales de reglas y backend. [Pruebas de Rules](https://firebase.google.com/docs/firestore/security/test-rules-emulator). | Pruebas de contratos, permisos y concurrencia en CI; sonido, Doze, reinicio y widgets en Android real. |

## Organización del código elegida

La combinación para este plazo es **Expo/React Native + Firebase administrado + contratos pequeños + integración diaria**. Se prioriza la rapidez de un equipo React/TypeScript. El control nativo se concentra en el punto que define al producto: que una alarma aceptada se programe y pueda detenerse. No se plantea reescribir toda la app en Kotlin.

El [TDD](TDD.md) define interfaces, estados y datos. [TEAM_PLAN.md](TEAM_PLAN.md) asigna seis responsables y dependencias. [CONTRIBUTING.md](../CONTRIBUTING.md) concreta convenciones, revisión y uso de asistentes de código. Las carpetas indicadas en esos documentos son propuestas hasta que exista implementación.

No se introducirán microservicios, un agente permanente por persona, un framework genérico de plugins ni una segunda base compartida para el MVP. La IA se limita inicialmente a sugerir o aclarar; las decisiones de consentimiento, permisos y horarios siguen siendo explícitas y comprobables.

## Qué debe demostrar el prototipo

1. La propuesta entre dos personas conserva identidad, versión y decisión individual.
2. Rechazar no programa nada; aceptar sin permisos muestra el bloqueo; aceptar con permisos produce una alarma local comprobada.
3. Cambiar hora, reintentar y recibir eventos atrasados no duplica ni reactiva alarmas canceladas.
4. Una pérdida de conexión se representa como pendiente y no como éxito remoto.
5. La experiencia funciona sin consultar un modelo de IA.

Todavía no hay medidas de tamaño, memoria, batería ni precisión. Deben registrarse sobre una compilación de distribución y dispositivos identificados. Expo puede ahorrar tiempo de desarrollo, pero no demuestra por sí mismo que el APK sea más pequeño o consuma menos batería.

## Investigación detallada

- [Android: arquitectura, alarmas, widgets y matriz de pruebas](ANDROID_PRACTICES.md).
- [Firebase: datos, autorización, consistencia, mensajería, pruebas y despliegue](FIREBASE_PRACTICES.md).

Estos documentos contienen límites y fuentes adicionales. Antes de inicializar el proyecto se fijarán versiones compatibles de Expo, React Native, sus plugins, Firebase y Node; la fecha de una página no debe confundirse con la disponibilidad estable de una API.
