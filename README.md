# Sala de Escape Política — Plataforma (Gabinetes Provinciales)

Implementación funcional de la arquitectura propuesta: Panel de Administración, Panel de Equipo y Leaderboard público, con RBAC y actualización en tiempo real. Cada equipo es el gabinete de una provincia real (Provincia de Buenos Aires, CABA, Formosa, Santa Fe y Chubut). No hay Congreso ni votación de leyes: cada una de las 5 salas temáticas (Economía, Desarrollo Social, Seguridad, Crisis Interna y Salud) plantea un problema personalizado por provincia, con 3 opciones brevemente explicadas y de efecto oculto sobre 5 ejes de desempeño (Imagen Positiva, Intención de Voto, Gobernabilidad, Salud Fiscal y Orden Público). Gana la provincia con mayor Imagen Positiva al cierre de la jornada. Además del recorrido temático hay 3 salas de crisis independientes, evaluadas por un jurado, que también suman o restan puntos.

Este es un **prototipo funcional autocontenido**: corre en un solo proceso Node.js con SQLite embebido, sin necesidad de contratar infraestructura externa, pensado para poder probarlo hoy mismo en una notebook o en un servidor liviano. El modelo de datos y la separación de capas están hechos para portar 1:1 a PostgreSQL (Supabase) el día que el evento necesite más de un servidor o alta disponibilidad — ver "De acá a producción" más abajo.

## Cómo correrlo

Requisitos: Node.js 18 o superior.

```bash
npm install
npm start
```

El servidor levanta en `http://localhost:3000` y siembra automáticamente, la primera vez, una Jornada demo con las 5 provincias, el rol único de Jefe/a de Gabinete, las 5 salas temáticas (75 opciones en total) y las 3 salas de crisis. Accesos:

- **Panel de Equipo**: `http://localhost:3000/equipo.html`
- **Panel de Administración**: `http://localhost:3000/admin.html`
- **Panel Público / Proyector**: `http://localhost:3000/publico.html`

### Credenciales de prueba

**Equipos** (código de provincia / PIN — acceso único por equipo, a cargo del/la Jefe/a de Gabinete de Ministros):

| Código | PIN | Provincia |
|---|---|---|
| PBA | 2001 | Provincia de Buenos Aires |
| CABA | 2002 | Ciudad Autónoma de Buenos Aires |
| FSA | 2003 | Provincia de Formosa |
| SFE | 2004 | Provincia de Santa Fe |
| CHU | 2005 | Provincia de Chubut |

**Staff** (usuario / contraseña):

| Usuario | Contraseña | Rol |
|---|---|---|
| admin | admin123 | Administrador / organizador |
| facilitador1 … facilitador5 | facil123 | Facilitador de cada sala temática |
| jurado1 | jurado123 | Jurado de las 3 salas de crisis |

Cambiá estas contraseñas (`server/seed.js`) antes de usar la plataforma con datos reales.

Para volver a sembrar desde cero: borrá el archivo `data/scaperoom.db` y reiniciá el servidor (o corré `npm run seed` con la base ya borrada).

## Cómo se juega, en la plataforma

1. El/la Jefe/a de Gabinete de Ministros de cada provincia entra a `equipo.html` con el código de provincia y el PIN (impresos en la carpeta física) — es el único login habilitado por equipo, y administra el panel en representación de todo el gabinete.
2. El facilitador de cada sala, desde `admin.html`, presiona **Iniciar** en el paso correspondiente cuando el equipo llega físicamente. Ahí el Panel de Equipo revela el problema personalizado de esa provincia para esa sala, la variante de apertura (según el cartelito con el que llegaron) y las 3 opciones de respuesta, brevemente explicadas.
3. El equipo elige una opción y la confirma desde su panel. Ninguna opción muestra de antemano su efecto: al confirmar, el servidor ajusta automáticamente (y en silencio) los 5 ejes de desempeño de la provincia, cierra la sala y propaga el cartelito resultante (= la opción elegida) como consecuencia narrativa a la siguiente sala de su recorrido — sin que nadie tenga que anotarlo a mano.
4. En cualquier momento del día, el admin dispara, una por una, cada una de las **3 salas de crisis** (independientes del recorrido temático) desde su panel: las 5 provincias reciben al instante, por WebSocket, el aviso. El jurado carga la evaluación (4 criterios de 1 a 5) de cada provincia desde `admin.html`, y eso ajusta automáticamente Imagen Positiva (y, en las crisis de Orden Público y Fiscal, también Orden Público o Salud Fiscal).
5. El leaderboard —ordenado por **Imagen Positiva**, el eje que define a la provincia ganadora— se actualiza solo, en vivo, en el proyector. El admin puede además cargar ajustes manuales puntuales sobre cualquiera de los 5 ejes.
6. El Panel Público (`publico.html`) no requiere login: es de solo lectura y muestra únicamente los 5 ejes agregados de cada provincia — nunca los objetivos secretos, los problemas/opciones de una sala que un equipo todavía no atravesó, ni los efectos ocultos de cada opción.

## Los 5 ejes de desempeño

Cada provincia arranca con un valor inicial en 5 ejes (0 a 100, ver `server/ejes.js`). Cada opción elegida en las salas temáticas, y cada evaluación de jurado en las salas de crisis, suma o resta puntos de forma automática:

- **Imagen Positiva** (eje principal — define el ranking final)
- **Intención de Voto**
- **Gobernabilidad**
- **Salud Fiscal**
- **Orden Público**

## Cómo se implementó el RBAC

- **Equipos**: login por código de provincia + PIN, sin selección de rol ni contraseña personal — el servidor asigna siempre el rol de Jefe/a de Gabinete de Ministros, que es el único acceso habilitado por equipo. El JWT emitido lleva `equipo_id` y `rol_id`; todas las rutas de `/api/team/*` filtran por esos claims, así que un equipo nunca puede pedir el estado de otro equipo.
- **Staff**: login usuario/contraseña (`bcrypt`) con `staff_rol` (`admin` | `facilitador` | `jurado`) como claim. Los facilitadores solo pueden iniciar/cerrar pasos de la sala que tienen asignada (`sala_asignada_id`); el servidor lo valida en cada request, no solo en la interfaz.
- **Tiempo real segmentado**: al conectar el socket, el servidor decodifica el mismo JWT y suscribe al cliente solo a los canales que le corresponden (`equipo:<id>` para jugadores, `admin` para staff, `publico` para el proyector) — ver `server/index.js`.

## Estructura del proyecto

```
server/
  db.js            esquema SQLite v2 — provincias, salas con problemas por provincia, ejes
  ejes.js          definicion de los 5 ejes de desempeño (Imagen Positiva y 4 secundarios)
  seed.js          carga las 5 provincias reales, 5 salas tematicas (75 opciones) y 3 salas de crisis
  auth.js          JWT + middlewares requireAuth / requireStaff / requireJugador
  logic.js         aplicacion de efectos, calculo de leaderboard por eje
  realtime.js       helper para emitir eventos de Socket.io desde las rutas
  routes/
    auth.js        login de equipo y de staff
    team.js        estado del equipo propio + entrega de decision (opcion A/B/C)
    admin.js       overview, control de flujo, salas de crisis, ajuste de ejes
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
