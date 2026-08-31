const db = require("./db");
const { EJE_SLUGS, EJE_PRINCIPAL, clamp } = require("./ejes");

// El cartelito de salida ES la opcion elegida (A/B/C): cada sala tiene 3
// opciones de efecto oculto y la que se elige queda registrada como
// consecuencia/variante de apertura para la proxima sala del recorrido.
function derivarCartelito(opcionCodigo) {
  return opcionCodigo; // A | B | C
}

function getEquipoCompleto(equipoId) {
  const equipo = db.prepare("SELECT * FROM equipo WHERE id = ?").get(equipoId);
  if (!equipo) return null;
  equipo.objetivos_generales = JSON.parse(equipo.objetivos_generales || "[]");
  equipo.orden_rotacion = JSON.parse(equipo.orden_rotacion_json || "[]");
  equipo.ejes = JSON.parse(equipo.ejes_json || "{}");
  return equipo;
}

function getPasosDeEquipo(equipoId) {
  const rows = db
    .prepare(
      `SELECT pr.*, s.slug as sala_slug, s.nombre as sala_nombre, s.tipo as sala_tipo, s.eje as sala_eje
       FROM paso_recorrido pr JOIN sala s ON s.id = pr.sala_id
       WHERE pr.equipo_id = ?
       ORDER BY pr.orden_index ASC`
    )
    .all(equipoId);
  return rows;
}

// Obtiene el problema personalizado (enunciado + 3 opciones) de una sala
// tematica para el codigo de equipo (= provincia) dado.
function getProblemaParaEquipo(sala, codigoEquipo) {
  const problemas = JSON.parse(sala.problemas_json || "{}");
  return problemas[codigoEquipo] || null;
}

function getAperturaVariante(sala, cartelitoEntrada) {
  const apertura = JSON.parse(sala.apertura_json || "{}");
  if (!cartelitoEntrada) return null;
  return apertura[cartelitoEntrada] || null;
}

// Aplica un objeto de deltas {eje_slug: delta} al equipo, clampeando cada
// eje entre 0 y 100. Devuelve los efectos realmente aplicados (post-clamp).
function aplicarEfectos(equipoId, efectos) {
  const equipo = db.prepare("SELECT ejes_json FROM equipo WHERE id = ?").get(equipoId);
  const ejes = JSON.parse(equipo.ejes_json || "{}");
  const aplicados = {};
  for (const slug of EJE_SLUGS) {
    const delta = efectos[slug] || 0;
    if (delta === 0) continue;
    const antes = ejes[slug] ?? 0;
    const despues = clamp(antes + delta);
    aplicados[slug] = despues - antes;
    ejes[slug] = despues;
  }
  db.prepare("UPDATE equipo SET ejes_json = ? WHERE id = ?").run(JSON.stringify(ejes), equipoId);
  return aplicados;
}

function sumaAjustesManualesPorEje(equipoId) {
  const rows = db
    .prepare(`SELECT eje, COALESCE(SUM(puntos), 0) as s FROM puntaje_ajuste WHERE equipo_id = ? GROUP BY eje`)
    .all(equipoId);
  const out = {};
  for (const r of rows) out[r.eje] = r.s;
  return out;
}

function salasCompletadas(equipoId) {
  const row = db
    .prepare(`SELECT COUNT(*) as c FROM paso_recorrido WHERE equipo_id = ? AND estado = 'cerrado'`)
    .get(equipoId);
  return row.c;
}

// Convierte una evaluacion de jurado (4 criterios de 1 a 5) en puntos de
// Imagen Positiva: el promedio neutro (3 por criterio = 12 en total) no
// suma ni resta; por encima o por debajo, mueve el eje hasta +/-8.
function calcularPuntosCrisis(evaluacion) {
  const suma =
    (evaluacion.claridad || 0) +
    (evaluacion.manejo_incertidumbre || 0) +
    (evaluacion.coherencia || 0) +
    (evaluacion.control_presion || 0);
  return suma - 12;
}

function construirLeaderboard() {
  const equipos = db.prepare("SELECT * FROM equipo").all();
  const tabla = equipos.map((e) => {
    const ejes = JSON.parse(e.ejes_json || "{}");
    const ajustes = sumaAjustesManualesPorEje(e.id);
    const ejesFinales = {};
    for (const slug of EJE_SLUGS) {
      ejesFinales[slug] = clamp((ejes[slug] ?? 0) + (ajustes[slug] ?? 0));
    }
    return {
      equipo_id: e.id,
      codigo: e.codigo,
      nombre: e.nombre,
      carpeta_numero: e.carpeta_numero,
      ejes: ejesFinales,
      puntaje_total: ejesFinales[EJE_PRINCIPAL],
      salas_completadas: salasCompletadas(e.id),
      resultado_final_pct: e.resultado_final_pct,
    };
  });
  tabla.sort((a, b) => b.puntaje_total - a.puntaje_total);
  return tabla;
}

// Estado del "escrutinio final": si ya cerraron todas las salas tematicas
// para las 5 provincias y, de las salas de crisis que se llegaron a
// disparar, todas tienen evaluacion cargada para las 5 provincias. Mientras
// no este todoCerrado, el panel publico sigue mostrando el tablero en vivo;
// una vez que lo esta, deja de mostrarlo y espera a que el admin publique
// el resultado final (ver server/routes/admin.js, /escrutinio/publicar).
function construirEstadoEscrutinio() {
  const jornada = db.prepare("SELECT * FROM jornada ORDER BY creado_en DESC LIMIT 1").get();
  const totalPasos = db.prepare("SELECT COUNT(*) as c FROM paso_recorrido").get().c;
  const pasosCerrados = db.prepare("SELECT COUNT(*) as c FROM paso_recorrido WHERE estado = 'cerrado'").get().c;
  const totalEquipos = db.prepare("SELECT COUNT(*) as c FROM equipo").get().c;

  const salasCrisisDisparadas = db
    .prepare("SELECT s.id FROM sala s JOIN crisis_estado ce ON ce.sala_id = s.id WHERE ce.disparada = 1")
    .all();
  const crisisPendientes = salasCrisisDisparadas.filter((s) => {
    const evaluadas = db.prepare("SELECT COUNT(*) as c FROM evaluacion_crisis WHERE sala_id = ?").get(s.id).c;
    return evaluadas < totalEquipos;
  }).length;

  const todoCerrado = totalPasos > 0 && pasosCerrados === totalPasos && crisisPendientes === 0;

  return {
    todo_cerrado: todoCerrado,
    publicado: !!jornada?.resultados_publicados,
    publicado_en: jornada?.resultados_publicados_en || null,
    jornada_id: jornada?.id || null,
  };
}

module.exports = {
  derivarCartelito,
  getEquipoCompleto,
  getPasosDeEquipo,
  getProblemaParaEquipo,
  getAperturaVariante,
  aplicarEfectos,
  sumaAjustesManualesPorEje,
  salasCompletadas,
  calcularPuntosCrisis,
  construirLeaderboard,
  construirEstadoEscrutinio,
};
