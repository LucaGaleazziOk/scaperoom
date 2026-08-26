const db = require("./db");

// Deriva el cartelito de salida a partir de la opcion elegida.
// Coincide con la tabla de la Parte IV del manual: la opcion A siempre
// corresponde al estilo "mano firme", B a "negociador" y C a "tecnico/gradualista".
// En la Sala Constitucional (binaria) SI->A, NO->B (no existe cartelito C ahi).
function derivarCartelito(salaDecisionTipo, opcionCodigo) {
  if (salaDecisionTipo === "binaria") {
    return opcionCodigo === "SI" ? "A" : "B";
  }
  return opcionCodigo; // A | B | C
}

function getEquipoCompleto(equipoId) {
  const equipo = db.prepare("SELECT * FROM equipo WHERE id = ?").get(equipoId);
  if (!equipo) return null;
  equipo.objetivos_generales = JSON.parse(equipo.objetivos_generales || "[]");
  equipo.orden_rotacion = JSON.parse(equipo.orden_rotacion_json || "[]");
  return equipo;
}

function getPasosDeEquipo(equipoId) {
  const rows = db
    .prepare(
      `SELECT pr.*, s.slug as sala_slug, s.nombre as sala_nombre, s.tipo as sala_tipo, s.proyecto_ley_nombre
       FROM paso_recorrido pr JOIN sala s ON s.id = pr.sala_id
       WHERE pr.equipo_id = ?
       ORDER BY pr.orden_index ASC`
    )
    .all(equipoId);
  return rows;
}

// Cuenta leyes aprobadas en el Congreso para un equipo (criterio de victoria oficial)
function contarLeyesAprobadas(equipoId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) as c
       FROM congreso_voto cv
       JOIN proyecto_ley pl ON pl.id = cv.proyecto_ley_id
       JOIN paso_recorrido pr ON pr.id = pl.paso_id
       WHERE pr.equipo_id = ? AND cv.resultado = 'aprobado'`
    )
    .get(equipoId);
  return row.c;
}

function sumaAjustesManuales(equipoId) {
  const row = db
    .prepare(`SELECT COALESCE(SUM(puntos), 0) as s FROM puntaje_ajuste WHERE equipo_id = ?`)
    .get(equipoId);
  return row.s;
}

function salasCompletadas(equipoId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) as c FROM paso_recorrido WHERE equipo_id = ? AND estado = 'cerrado' AND orden_index < 99`
    )
    .get(equipoId);
  return row.c;
}

function construirLeaderboard() {
  const equipos = db.prepare("SELECT * FROM equipo").all();
  const tabla = equipos.map((e) => {
    const leyesAprobadas = contarLeyesAprobadas(e.id);
    const ajustes = sumaAjustesManuales(e.id);
    return {
      equipo_id: e.id,
      codigo: e.codigo,
      nombre: e.nombre,
      leyes_aprobadas: leyesAprobadas,
      ajustes_manuales: ajustes,
      puntaje_total: leyesAprobadas * 10 + ajustes, // 10 pts por ley aprobada + ajustes del staff
      salas_completadas: salasCompletadas(e.id),
    };
  });
  tabla.sort((a, b) => b.puntaje_total - a.puntaje_total || b.leyes_aprobadas - a.leyes_aprobadas);
  return tabla;
}

module.exports = {
  derivarCartelito,
  getEquipoCompleto,
  getPasosDeEquipo,
  contarLeyesAprobadas,
  sumaAjustesManuales,
  salasCompletadas,
  construirLeaderboard,
};
