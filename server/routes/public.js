const express = require("express");
const db = require("../db");
const { construirLeaderboard, construirEstadoEscrutinio } = require("../logic");
const { EJES } = require("../ejes");

const router = express.Router();

// Sin autenticacion: es la pantalla de proyector, de solo lectura y con
// datos agregados unicamente (nunca problemas/opciones/efectos de una sala
// que un equipo todavia no atravesó, ni objetivos secretos).
router.get("/leaderboard", (req, res) => {
  // No es un ranking: se muestra un orden fijo (por número de carpeta física,
  // el mismo con el que se sembraron las provincias) para que la pantalla
  // pública sean 5 cajas independientes y no una tabla ordenada por puntaje.
  const leaderboard = construirLeaderboard().sort((a, b) => a.carpeta_numero - b.carpeta_numero);
  const salasCrisis = db.prepare("SELECT * FROM sala WHERE tipo = 'crisis' ORDER BY orden_crisis ASC").all();
  const crisis = salasCrisis.map((sala) => {
    const estado = db.prepare("SELECT * FROM crisis_estado WHERE sala_id = ?").get(sala.id);
    return { nombre: sala.nombre, disparada: !!estado?.disparada };
  });
  const totalPasos = db.prepare("SELECT COUNT(*) as c FROM paso_recorrido").get().c;
  const pasosCerrados = db.prepare("SELECT COUNT(*) as c FROM paso_recorrido WHERE estado = 'cerrado'").get().c;

  const estado = construirEstadoEscrutinio();
  const escrutinio = {
    todo_cerrado: estado.todo_cerrado,
    publicado: estado.publicado,
    publicado_en: estado.publicado_en,
    // Los porcentajes finales solo se exponen una vez publicados: antes de
    // eso son un borrador interno del admin, no un dato publico.
    resultados: estado.publicado
      ? leaderboard.map((r) => ({
          equipo_id: r.equipo_id,
          codigo: r.codigo,
          nombre: r.nombre,
          porcentaje: r.resultado_final_pct ?? 0,
        }))
      : null,
  };

  res.json({
    leaderboard,
    ejes: EJES,
    crisis,
    progreso_global: { completados: pasosCerrados, total: totalPasos },
    escrutinio,
  });
});

module.exports = router;
