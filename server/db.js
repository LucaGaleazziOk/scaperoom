const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_PATH = path.join(__dirname, "..", "data", "scaperoom.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------------------------------------------------------------------------
// Esquema — mapea 1:1 el modelo de datos de la propuesta de arquitectura
// (pensado para portar sin cambios de forma a PostgreSQL/Supabase en producción)
// ---------------------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS jornada (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'planificada', -- planificada | en_curso | cerrada
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
  tipo TEXT NOT NULL, -- tematica | crisis
  proyecto_ley_nombre TEXT,
  encuadre TEXT,
  caso_critico TEXT,
  decision_tipo TEXT, -- binaria | tres_opciones | ninguna
  opciones_json TEXT, -- JSON: [{codigo, etiqueta, consecuencia, impacto_presupuestario}]
  apertura_json TEXT  -- JSON: {A: texto, B: texto, C: texto}
);

CREATE TABLE IF NOT EXISTS equipo (
  id TEXT PRIMARY KEY,
  jornada_id TEXT NOT NULL REFERENCES jornada(id),
  nombre TEXT NOT NULL,
  carpeta_numero INTEGER NOT NULL,
  codigo TEXT NOT NULL UNIQUE, -- ej GOB-3
  pin TEXT NOT NULL,
  contexto_arranque TEXT,
  objetivos_generales TEXT, -- JSON array de strings
  tension_interna TEXT,
  orden_rotacion_json TEXT NOT NULL -- JSON array de sala_slug en el orden que le toca a este equipo
);

CREATE TABLE IF NOT EXISTS usuario (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL, -- jugador | staff
  nombre TEXT NOT NULL,
  equipo_id TEXT REFERENCES equipo(id),
  rol_id TEXT REFERENCES rol(id),
  staff_rol TEXT, -- admin | facilitador | jurado (solo si tipo=staff)
  sala_asignada_id TEXT REFERENCES sala(id), -- solo facilitador
  username TEXT UNIQUE, -- solo staff
  password_hash TEXT, -- solo staff
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(equipo_id, rol_id)
);

CREATE TABLE IF NOT EXISTS paso_recorrido (
  id TEXT PRIMARY KEY,
  equipo_id TEXT NOT NULL REFERENCES equipo(id),
  sala_id TEXT NOT NULL REFERENCES sala(id),
  orden_index INTEGER NOT NULL, -- posicion del equipo en su propio recorrido (0..5)
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | en_curso | cerrado
  cartelito_entrada TEXT, -- A | B | C | NULL (primera sala del recorrido)
  facilitador_id TEXT REFERENCES usuario(id),
  iniciado_en TEXT,
  cerrado_en TEXT,
  UNIQUE(equipo_id, sala_id)
);

CREATE TABLE IF NOT EXISTS decision (
  id TEXT PRIMARY KEY,
  paso_id TEXT NOT NULL UNIQUE REFERENCES paso_recorrido(id),
  opcion_codigo TEXT NOT NULL, -- SI/NO o A/B/C segun la sala
  cartelito_resultante TEXT,   -- A | B | C, derivado de la tabla Parte IV
  registrado_por TEXT REFERENCES usuario(id),
  registrado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS proyecto_ley (
  id TEXT PRIMARY KEY,
  paso_id TEXT NOT NULL UNIQUE REFERENCES paso_recorrido(id),
  nombre_proyecto TEXT NOT NULL,
  alcance_texto TEXT NOT NULL,
  firmado_por TEXT, -- nombre del Presidente
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT
);

CREATE TABLE IF NOT EXISTS congreso_voto (
  id TEXT PRIMARY KEY,
  proyecto_ley_id TEXT NOT NULL UNIQUE REFERENCES proyecto_ley(id),
  resultado TEXT NOT NULL, -- aprobado | rechazado | modificado
  detalle TEXT,
  registrado_por TEXT REFERENCES usuario(id),
  registrado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS evaluacion_crisis (
  id TEXT PRIMARY KEY,
  equipo_id TEXT NOT NULL REFERENCES equipo(id),
  claridad INTEGER,
  manejo_incertidumbre INTEGER,
  coherencia INTEGER,
  control_presion INTEGER,
  comentario TEXT,
  jurado_id TEXT REFERENCES usuario(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(equipo_id)
);

CREATE TABLE IF NOT EXISTS puntaje_ajuste (
  id TEXT PRIMARY KEY,
  equipo_id TEXT NOT NULL REFERENCES equipo(id),
  puntos INTEGER NOT NULL,
  motivo TEXT NOT NULL,
  staff_id TEXT REFERENCES usuario(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crisis_estado (
  id TEXT PRIMARY KEY,
  jornada_id TEXT NOT NULL REFERENCES jornada(id),
  disparada INTEGER NOT NULL DEFAULT 0,
  disparada_en TEXT
);

CREATE TABLE IF NOT EXISTS evento_log (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  payload_json TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

module.exports = db;
