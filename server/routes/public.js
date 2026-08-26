const express = require("express");
const db = require("../db");
const { construirLeaderboard } = require("../logic");

const router = express.Router();

// Sin autenticacion: es la pantalla de proyector, de solo lectura y con
// datos agregados unicamente (nunca objetivos secretos ni contenido interno
// de las salas que un equipo todavia no atravesó).
router.get("/leaderboard", (req, res) => {
  const leaderboard = construirLeaderboard();
  const crisisEstado = db.prepare("SELECT * FROM crisis_estado LIMIT 1").get();
  const totalPasosTematicos = db
    .prepare("SELECT COUNT(*) as c FROM paso_recorrido WHERE orden_index < 99")
    .get().c;
  const pasosCerrados = db
    .prepare("SELECT COUNT(*) as c FROM paso_recorrido WHERE orden_index < 99 AND estado = 'cerrado'")
    .get().c;

  res.json({
    leaderboard,
    crisis_disparada: !!crisisEstado?.disparada,
    progreso_global: { completados: pasosCerrados, total: totalPasosTematicos },
  });
});

module.exports = router;
