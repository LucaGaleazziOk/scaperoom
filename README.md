# Sala de Escape Política — Plataforma

Implementación funcional de la arquitectura propuesta: Panel de Administración, Panel de Equipo y Leaderboard público, con RBAC y actualización en tiempo real, cargada con el contenido real del manual del facilitador (5 gobiernos/carpetas, 7 roles con objetivo secreto, 5 salas temáticas + Sala 6 de crisis).

Este es un **prototipo funcional autocontenido**: corre en un solo proceso Node.js con SQLite embebido, sin necesidad de contratar infraestructura externa, pensado para poder probarlo hoy mismo en una notebook o en un servidor liviano. El modelo de datos y la separación de capas están hechos para portar 1:1 a PostgreSQL (Supabase) el día que el evento necesite más de un servidor o alta disponibilidad — ver "De acá a producción" más abajo.

## Cómo correrlo

Requisitos: Node.js 18 o superior.

```bash
npm install
npm start
```

El servidor levanta en `http://localhost:3000` y siembra automáticamente, la primera vez, una Jornada demo con los 5 gobiernos, los 7 roles y las 6 salas del manual. Accesos:

- **Panel de Equipo**: `http://localhost:3000/equipo.html`
- **Panel de Administración**: `http://localhost:3000/admin.html`
- **Panel Público / Proyector**: `http://localhost:3000/publico.html`

### Credenciales de prueba

**Equipos** (código de equipo / PIN — acceso único por equipo, a cargo del/la Jefe/a de Gabinete de Ministros):

| Código | PIN | Gobierno |
|---|---|---|
| GOB-1 | 1001 | Coalición nacional-popular |
| GOB-2 | 1002 | Frente de organizaciones sociales |
| GOB-3 | 1003 | Reelección — orden y gestión |
| GOB-4 | 1004 | Outsider libertario |
| GOB-5 | 1005 | Provincia mediana — tradición institucional |

**Staff** (usuario / contraseña):

| Usuario | Contraseña | Rol |
|---|---|---|
| admin | admin123 | Administrador / organizador |
| facilitador1 … facilitador5 | facil123 | Facilitador de cada sala temática |
| jurado1 | jurado123 | Jurado de la Sala 6 |

Cambiá estas contraseñas (`server/seed.js`) antes de usar la plataforma con datos reales.

Para volver a sembrar desde cero: borrá el archivo `data/scaperoom.db` y reiniciá el servidor (o corré `npm run seed` con la base ya borrada).

## Cómo se juega, en la plataforma

1. El/la Jefe/a de Gabinete de Ministros de cada equipo entra a `equipo.html` con el código de equipo y el PIN (impresos en la carpeta física) — es el único login habilitado por equipo, y administra el panel en representación de todo el grupo. El resto de los roles (Presidente, ministros, diputados) se juegan de forma presencial con la carpeta física, sin login propio.
2. El facilitador de cada sala, desde `admin.html`, presiona **Iniciar** en el paso correspondiente cuando el equipo llega físicamente. Ahí el Panel de Equipo revela el caso, la variante de apertura (según el cartelito con el que llegaron) y el formulario de decisión.
3. El equipo elige una opción, redacta el proyecto de ley y lo entrega desde su panel. Eso cierra la sala, calcula el cartelito resultante (A/B/C) y lo propaga automáticamente a la siguiente sala de su recorrido — sin que nadie tenga que anotarlo a mano.
4. En cualquier momento del día, el admin dispara la **Sala 6** desde su panel: los 5 equipos reciben al instante, por WebSocket, el aviso de la crisis. El jurado carga la evaluación de cada Presidente desde `admin.html`.
5. Al cierre, el admin entra a la sección **Congreso** y marca cada proyecto como aprobado / rechazado / modificado. El leaderboard (10 puntos por ley aprobada + ajustes manuales) se actualiza solo, en vivo, en el proyector.
6. El Panel Público (`publico.html`) no requiere login: es de solo lectura y muestra únicamente datos agregados — nunca los objetivos secretos ni el contenido de una sala que un equipo todavía no atravesó.

## Cómo se implementó el RBAC

- **Equipos**: login por código de equipo + PIN, sin selección de rol ni contraseña personal — el servidor asigna siempre el rol de Jefe/a de Gabinete de Ministros, que es el único acceso habilitado por equipo. El JWT emitido lleva `equipo_id` y `rol_id`; todas las rutas de `/api/team/*` filtran por esos claims, así que un equipo nunca puede pedir el estado de otro equipo.
- **Staff**: login usuario/contraseña (`bcrypt`) con `staff_rol` (`admin` | `facilitador` | `jurado`) como claim. Los facilitadores solo pueden iniciar/cerrar pasos de la sala que tienen asignada (`sala_asignada_id`); el servidor lo valida en cada request, no solo en la interfaz.
- **Tiempo real segmentado**: al conectar el socket, el servidor decodifica el mismo JWT y suscribe al cliente solo a los canales que le corresponden (`equipo:<id>` para jugadores, `admin` para staff, `publico` para el proyector) — ver `server/index.js`.

## Estructura del proyecto

```
server/
  db.js            esquema SQLite (mapea 1:1 el modelo de datos de la propuesta)
  seed.js          carga el contenido real del manual (carpetas, roles, salas)
  auth.js          JWT + middlewares requireAuth / requireStaff / requireJugador
  logic.js         derivación de cartelito, cálculo de leaderboard
  realtime.js       helper para emitir eventos de Socket.io desde las rutas
  routes/
    auth.js        login de equipo y de staff
    team.js        estado del equipo propio + entrega de decisión/proyecto
    admin.js       overview, control de flujo, crisis, congreso, puntaje
    public.js       leaderboard público de solo lectura
  index.js         Express + Socket.io + servido de /public
public/
  equipo.html/js   Panel de Equipo
  admin.html/js    Panel de Administración
  publico.html/js  Panel Público / Proyector
  styles.css
```

## De acá a producción

Este prototipo prioriza que se pueda correr y probar sin dependencias externas. Para un evento real con requisitos de disponibilidad, backups automáticos o acceso remoto de varios facilitadores desde distintas redes, el mismo modelo de datos (`server/db.js`) porta directamente a PostgreSQL:

1. Reemplazar `better-sqlite3` por el cliente de Postgres (o migrar directamente a Supabase) manteniendo el mismo esquema de tablas.
2. Mover la emisión de eventos en tiempo real a Supabase Realtime (suscripción a cambios de tabla) en lugar de los `emit` manuales de `realtime.js`, o dejar Socket.io tal cual apuntando a una instancia de Node desplegada en un servicio administrado (Render, Fly.io, etc.).
3. Agregar Row Level Security en Postgres replicando las validaciones que hoy hacen `requireAuth`/`requireStaff` en el middleware — hoy la seguridad vive correctamente en la capa de aplicación porque es un único proceso de confianza, pero con múltiples instancias conviene bajarla también a la base.
4. Cambiar `JWT_SECRET` por un valor generado (no el placeholder del `.env.example`) y las contraseñas de staff seedeadas en `server/seed.js`.

Esto es exactamente la migración descripta en la Sección 1.2 de la propuesta de arquitectura ("Supabase en lugar de backend a medida") — se puede hacer sin rediseñar el modelo de datos ni las pantallas.
