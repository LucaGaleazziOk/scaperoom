const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_PATH = path.join(__dirname, "..", "data", "scaperoom.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------------------------------------------------------------------------
// Esquema v2 — "Provincias" (reemplaza al esquema de gobiernos/congreso).
// Cada equipo es el gobierno de una provincia real. No hay Congreso ni
// proyectos de ley: cada sala plantea un problema con 3 opciones de
// respuesta de efecto oculto, que ajustan automáticamente un set de ejes
// de desempeño y dejan un cartelito de consecuencia para la siguiente sala.
// ---------------------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS jornada (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'planificada',
  resultados_publicados INTEGER NOT NULL DEFAULT 0,
  resultados_publicados_en TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rol (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  objetivo_secreto TEXT NOT NULL,
  orden INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sala (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  eje TEXT,                    -- economia | desarrollo_social | seguridad | crisis_interna | salud (solo tematicas)
  tipo TEXT NOT NULL,          -- tematica | crisis
  orden_crisis INTEGER,        -- 1 | 2 | 3 para las salas de crisis (orden sugerido de disparo)
  encuadre TEXT,               -- bajada general de la sala (no depende de la provincia)
  problemas_json TEXT,         -- JSON: { [equipo_codigo]: { enunciado, opciones:[{codigo,etiqueta,texto,efectos,cartelito}] } }
  apertura_json TEXT,          -- JSON: {A: texto, B: texto, C: texto} variante segun cartelito de entrada
  caso_critico TEXT            -- solo salas de tipo crisis: consigna que lee el facilitador/jurado
);

CREATE TABLE IF NOT EXISTS equipo (
  id TEXT PRIMARY KEY,
  jornada_id TEXT NOT NULL REFERENCES jornada(id),
  nombre TEXT NOT NULL,        -- ej "Provincia de Buenos Aires"
  carpeta_numero INTEGER NOT NULL,
  codigo TEXT NOT NULL UNIQUE, -- ej PBA, CABA, FSA, SFE, CHU
  pin TEXT NOT NULL,
  contexto_arranque TEXT,
  objetivos_generales TEXT,    -- JSON array de strings
  tension_interna TEXT,
  ejes_json TEXT NOT NULL,     -- JSON: valores iniciales/actuales de los 5 ejes de desempeño
  orden_rotacion_json TEXT NOT NULL, -- JSON array de sala_slug (solo tematicas) en el orden de este equipo
  resultado_final_pct REAL     -- % de "votos" que le asignan los organizadores en el escrutinio final (no se toca solo)
);

CREATE TABLE IF NOT EXISTS usuario (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL, -- jugador | staff
  nombre TEXT NOT NULL,
  equipo_id TEXT REFERENCES equipo(id),
  rol_id TEXT REFERENCES rol(id),
  staff_rol TEXT, -- admin | facilitador | jurado
  sala_asignada_id TEXT REFERENCES sala(id),
  username TEXT UNIQUE,
  password_hash TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(equipo_id, rol_id)
);

CREATE TABLE IF NOT EXISTS paso_recorrido (
  id TEXT PRIMARY KEY,
  equipo_id TEXT NOT NULL REFERENCES equipo(id),
  sala_id TEXT NOT NULL REFERENCES sala(id),
  orden_index INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | en_curso | cerrado
  cartelito_entrada TEXT,
  facilitador_id TEXT REFERENCES usuario(id),
  iniciado_en TEXT,
  cerrado_en TEXT,
  UNIQUE(equipo_id, sala_id)
);

CREATE TABLE IF NOT EXISTS decision (
  id TEXT PRIMARY KEY,
  paso_id TEXT NOT NULL UNIQUE REFERENCES paso_recorrido(id),
  opcion_codigo TEXT NOT NULL,      -- A | B | C
  opcion_etiqueta TEXT,
  opcion_texto TEXT,                 -- texto completo de la opcion elegida (para las crisis "inteligentes")
  efectos_json TEXT,                -- JSON: {eje_slug: delta, ...} realmente aplicado
  cartelito_resultante TEXT,        -- A | B | C para la siguiente sala
  registrado_por TEXT REFERENCES usuario(id),
  registrado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Evaluación de desempeño en las 3 salas de crisis (ahora presenciales, en
-- papel: no hay una fila en la tabla "sala" para cada una, así que se
-- identifican por un slug fijo — ver CRISIS_TIPOS en server/logic.js — en
-- lugar de una sala_id. El jurado carga 3 criterios de 1 a 5 (coherencia,
-- oratoria, manejo de los nervios) por equipo y por crisis.
CREATE TABLE IF NOT EXISTS evaluacion_crisis (
  id TEXT PRIMARY KEY,
  equipo_id TEXT NOT NULL REFERENCES equipo(id),
  crisis_slug TEXT NOT NULL,
  coherencia INTEGER,
  oratoria INTEGER,
  manejo_nervios INTEGER,
  comentario TEXT,
  jurado_id TEXT REFERENCES usuario(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(equipo_id, crisis_slug)
);

-- Evaluación de desempeño en cada una de las 5 salas temáticas: el
-- facilitador (o el admin) carga un puntaje de 1 a 5 por equipo y por sala.
CREATE TABLE IF NOT EXISTS evaluacion_tematica (
  id TEXT PRIMARY KEY,
  equipo_id TEXT NOT NULL REFERENCES equipo(id),
  sala_id TEXT NOT NULL REFERENCES sala(id),
  puntaje INTEGER,
  comentario TEXT,
  staff_id TEXT REFERENCES usuario(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(equipo_id, sala_id)
);

CREATE TABLE IF NOT EXISTS puntaje_ajuste (
  id TEXT PRIMARY KEY,
  equipo_id TEXT NOT NULL REFERENCES equipo(id),
  eje TEXT NOT NULL DEFAULT 'imagen_positiva',
  puntos INTEGER NOT NULL,
  motivo TEXT NOT NULL,
  staff_id TEXT REFERENCES usuario(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crisis_estado (
  id TEXT PRIMARY KEY,
  jornada_id TEXT NOT NULL REFERENCES jornada(id),
  sala_id TEXT NOT NULL REFERENCES sala(id),
  disparada INTEGER NOT NULL DEFAULT 0,
  disparada_en TEXT,
  cronometro_iniciado_en TEXT,                     -- el admin lo arranca de forma remota, aparte de "disparar"
  duracion_segundos INTEGER NOT NULL DEFAULT 480,  -- 8 minutos
  cronometro_pausado_en TEXT,        -- si esta pausado, el momento en que se pauso (null = corriendo o no arrancado)
  cronometro_finalizado_en TEXT,     -- si el admin lo corta manualmente antes de tiempo
  UNIQUE(jornada_id, sala_id)
);

CREATE TABLE IF NOT EXISTS evento_log (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  payload_json TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Migracion idempotente: si la base ya existia sin estas columnas (por
// ejemplo en desarrollo local, sin borrar el archivo .db), las agrega sin
// perder los datos existentes. En Render, sin disco persistente, cada
// redeploy resiembra desde cero y esto no llega a ejecutarse nunca.
function ensureColumn(tabla, columna, definicion) {
  const columnas = db.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name);
  if (!columnas.includes(columna)) {
    db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
  }
}
ensureColumn("jornada", "resultados_publicados", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("jornada", "resultados_publicados_en", "TEXT");
ensureColumn("equipo", "resultado_final_pct", "REAL");
ensureColumn("crisis_estado", "cronometro_iniciado_en", "TEXT");
ensureColumn("crisis_estado", "duracion_segundos", "INTEGER NOT NULL DEFAULT 480");
ensureColumn("crisis_estado", "cronometro_pausado_en", "TEXT");
ensureColumn("crisis_estado", "cronometro_finalizado_en", "TEXT");
ensureColumn("decision", "opcion_texto", "TEXT");
ensureColumn("jornada", "transmision_url", "TEXT");
ensureColumn("jornada", "transmision_activa", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("evaluacion_crisis", "crisis_slug", "TEXT");
ensureColumn("evaluacion_crisis", "oratoria", "INTEGER");
ensureColumn("evaluacion_crisis", "manejo_nervios", "INTEGER");

module.exports = db;
