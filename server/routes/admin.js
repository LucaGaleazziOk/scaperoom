const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { requireAuth, requireStaff } = require("../auth");
const { emitAdmin, emitEquipo, emitPublico } = require("../realtime");
const { derivarCartelito, construirLeaderboard, getPasosDeEquipo } = require("../logic");

const router = express.Router();
router.use(requireAuth);

// -----------------------------------------------------------------------
// GET /api/admin/overview  (admin + facilitador + jurado, lectura)
// Vista general de los 5 equipos: en que sala estan, estado del paso,
// cartelito con el que llegaron, y si ya entregaron proyecto de ley.
// -----------------------------------------------------------------------
router.get("/overview", requireStaff("admin", "facilitador", "jurado"), (req, res) => {
  const equipos = db.prepare("SELECT * FROM equipo ORDER BY carpeta_numero ASC").all();
  const crisisEstado = db.prepare("SELECT * FROM crisis_estado LIMIT 1").get();

  const data = equipos.map((equipo) => {
    const pasos = getPasosDeEquipo(equipo.id).map((p) => {
      const decision = db.prepare("SELECT * FROM decision WHERE paso_id = ?").get(p.id);
      const proyecto = db.prepare("SELECT * FROM proyecto_ley WHERE paso_id = ?").get(p.id);
      return {
        paso_id: p.id,
        sala_slug: p.sala_slug,
        sala_nombre: p.sala_nombre,
        sala_tipo: p.sala_tipo,
        orden_index: p.orden_index,
        estado: p.estado,
        cartelito_entrada: p.cartelito_entrada,
        decision: decision ? decision.opcion_codigo : null,
        cartelito_resultante: decision ? decision.cartelito_resultante : null,
        proyecto_entregado: !!proyecto,
        proyecto_nombre: proyecto ? proyecto.nombre_proyecto : null,
      };
    });
    const jugadores = db
      .prepare(
        `SELECT u.id, u.nombre, r.slug as rol_slug, r.nombre as rol_nombre
         FROM usuario u JOIN rol r ON r.id = u.rol_id
         WHERE u.equipo_id = ? ORDER BY r.orden ASC`
      )
      .all(equipo.id);
    const evaluacionCrisis = db.prepare("SELECT * FROM evaluacion_crisis WHERE equipo_id = ?").get(equipo.id);

    return {
      equipo: { id: equipo.id, codigo: equipo.codigo, nombre: equipo.nombre, carpeta_numero: equipo.carpeta_numero },
      jugadores,
      pasos,
      evaluacion_crisis: evaluacionCrisis || null,
    };
  });

  res.json({
    equipos: data,
    crisis_disparada: !!crisisEstado?.disparada,
    leaderboard: construirLeaderboard(),
  });
});

// -----------------------------------------------------------------------
// POST /api/admin/paso/:id/iniciar  (admin + facilitador de esa sala)
// El facilitador marca que el equipo llego fisicamente a la sala y arranca
// el temporizador de esa estacion.
// -----------------------------------------------------------------------
router.post("/paso/:id/iniciar", requireStaff("admin", "facilitador"), (req, res) => {
  const paso = db.prepare("SELECT * FROM paso_recorrido WHERE id = ?").get(req.params.id);
  if (!paso) return res.status(404).json({ error: "Paso no encontrado." });
  const sala = db.prepare("SELECT * FROM sala WHERE id = ?").get(paso.sala_id);

  if (req.user.staff_rol === "facilitador" && req.user.sala_asignada_id !== sala.id) {
    return res.status(403).json({ error: "No sos el facilitador asignado a esta sala." });
  }
  if (paso.estado !== "pendiente") {
    return res.status(409).json({ error: `El paso ya esta en estado '${paso.estado}'.` });
  }

  const now = new Date().toISOString();
  db.prepare(`UPDATE paso_recorrido SET estado = 'en_curso', iniciado_en = ?, facilitador_id = ? WHERE id = ?`)
    .run(now, req.user.sub, paso.id);

  emitEquipo(paso.equipo_id, "estado:actualizado", { motivo: "paso_iniciado", sala_slug: sala.slug });
  emitAdmin("paso:iniciado", { equipo_id: paso.equipo_id, paso_id: paso.id, sala_slug: sala.slug });
  res.json({ ok: true });
});

// POST /api/admin/paso/:id/cerrar  — cierre forzado por moderacion (sin pasar por el equipo)
router.post("/paso/:id/cerrar", requireStaff("admin", "facilitador"), (req, res) => {
  const { opcion_codigo, nombre_proyecto, alcance_texto, firmado_por } = req.body || {};
  const paso = db.prepare("SELECT * FROM paso_recorrido WHERE id = ?").get(req.params.id);
  if (!paso) return res.status(404).json({ error: "Paso no encontrado." });
  const sala = db.prepare("SELECT * FROM sala WHERE id = ?").get(paso.sala_id);

  if (req.user.staff_rol === "facilitador" && req.user.sala_asignada_id !== sala.id) {
    return res.status(403).json({ error: "No sos el facilitador asignado a esta sala." });
  }
  if (paso.estado === "cerrado") return res.status(409).json({ error: "El paso ya estaba cerrado." });

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    if (sala.tipo !== "crisis" && opcion_codigo) {
      const existente = db.prepare("SELECT * FROM decision WHERE paso_id = ?").get(paso.id);
      const cartelito = derivarCartelito(sala.decision_tipo, opcion_codigo);
      if (!existente) {
        db.prepare(`INSERT INTO decision (id, paso_id, opcion_codigo, cartelito_resultante, registrado_por) VALUES (?, ?, ?, ?, ?)`)
          .run(uuid(), paso.id, opcion_codigo, cartelito, req.user.sub);
      }
      if (nombre_proyecto && alcance_texto) {
        const proyectoExistente = db.prepare("SELECT * FROM proyecto_ley WHERE paso_id = ?").get(paso.id);
        if (!proyectoExistente) {
          db.prepare(`INSERT INTO proyecto_ley (id, paso_id, nombre_proyecto, alcance_texto, firmado_por) VALUES (?, ?, ?, ?, ?)`)
            .run(uuid(), paso.id, nombre_proyecto, alcance_texto, firmado_por || null);
        }
      }
      const siguiente = db
        .prepare(
          `SELECT pr.* FROM paso_recorrido pr JOIN sala s ON s.id = pr.sala_id
           WHERE pr.equipo_id = ? AND pr.orden_index = ? AND pr.estado = 'pendiente' AND s.tipo != 'crisis'`
        )
        .get(paso.equipo_id, paso.orden_index + 1);
      if (siguiente) db.prepare(`UPDATE paso_recorrido SET cartelito_entrada = ? WHERE id = ?`).run(cartelito, siguiente.id);
    }
    db.prepare(`UPDATE paso_recorrido SET estado = 'cerrado', cerrado_en = ? WHERE id = ?`).run(now, paso.id);
  });
  tx();

  emitEquipo(paso.equipo_id, "estado:actualizado", { motivo: "cierre_moderado" });
  emitAdmin("paso:cerrado", { equipo_id: paso.equipo_id, paso_id: paso.id, sala_slug: sala.slug });
  emitPublico("leaderboard:actualizado", construirLeaderboard());
  res.json({ ok: true });
});

// -----------------------------------------------------------------------
// POST /api/admin/crisis/disparar  (solo admin)
// Dispara la Sala 6 para los 5 equipos en simultaneo, en el momento no
// anunciado que el organizador decida.
// -----------------------------------------------------------------------
router.post("/crisis/disparar", requireStaff("admin"), (req, res) => {
  const crisisEstado = db.prepare("SELECT * FROM crisis_estado LIMIT 1").get();
  if (crisisEstado?.disparada) return res.status(409).json({ error: "La crisis ya fue disparada." });

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE crisis_estado SET disparada = 1, disparada_en = ? WHERE id = ?`).run(now, crisisEstado.id);
    const pasosCrisis = db
      .prepare(`SELECT pr.* FROM paso_recorrido pr JOIN sala s ON s.id = pr.sala_id WHERE s.tipo = 'crisis'`)
      .all();
    pasosCrisis.forEach((p) => {
      db.prepare(`UPDATE paso_recorrido SET estado = 'en_curso', iniciado_en = ? WHERE id = ?`).run(now, p.id);
    });
  });
  tx();

  const equipos = db.prepare("SELECT id FROM equipo").all();
  equipos.forEach((e) => emitEquipo(e.id, "crisis:iniciada", { mensaje: "Se disparo la Sala 6 — convocatoria a los Presidentes." }));
  emitAdmin("crisis:iniciada", {});
  emitPublico("crisis:iniciada", {});
  res.json({ ok: true });
});

// POST /api/admin/crisis/evaluar  (solo jurado o admin)
router.post("/crisis/evaluar", requireStaff("admin", "jurado"), (req, res) => {
  const { equipo_id, claridad, manejo_incertidumbre, coherencia, control_presion, comentario } = req.body || {};
  if (!equipo_id) return res.status(400).json({ error: "Falta equipo_id." });

  const existente = db.prepare("SELECT * FROM evaluacion_crisis WHERE equipo_id = ?").get(equipo_id);
  if (existente) {
    db.prepare(
      `UPDATE evaluacion_crisis SET claridad=?, manejo_incertidumbre=?, coherencia=?, control_presion=?, comentario=?, jurado_id=? WHERE equipo_id=?`
    ).run(claridad, manejo_incertidumbre, coherencia, control_presion, comentario || "", req.user.sub, equipo_id);
  } else {
    db.prepare(
      `INSERT INTO evaluacion_crisis (id, equipo_id, claridad, manejo_incertidumbre, coherencia, control_presion, comentario, jurado_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(uuid(), equipo_id, claridad, manejo_incertidumbre, coherencia, control_presion, comentario || "", req.user.sub);
  }
  emitAdmin("crisis:evaluada", { equipo_id });
  res.json({ ok: true });
});

// -----------------------------------------------------------------------
// POST /api/admin/congreso/votar  (solo admin — registra el resultado del debate final)
// -----------------------------------------------------------------------
router.post("/congreso/votar", requireStaff("admin"), (req, res) => {
  const { proyecto_ley_id, resultado, detalle } = req.body || {};
  if (!proyecto_ley_id || !["aprobado", "rechazado", "modificado"].includes(resultado)) {
    return res.status(400).json({ error: "Datos invalidos. resultado debe ser aprobado | rechazado | modificado." });
  }
  const existente = db.prepare("SELECT * FROM congreso_voto WHERE proyecto_ley_id = ?").get(proyecto_ley_id);
  if (existente) {
    db.prepare(`UPDATE congreso_voto SET resultado=?, detalle=?, registrado_por=? WHERE proyecto_ley_id=?`)
      .run(resultado, detalle || "", req.user.sub, proyecto_ley_id);
  } else {
    db.prepare(`INSERT INTO congreso_voto (id, proyecto_ley_id, resultado, detalle, registrado_por) VALUES (?, ?, ?, ?, ?)`)
      .run(uuid(), proyecto_ley_id, resultado, detalle || "", req.user.sub);
  }
  const leaderboard = construirLeaderboard();
  emitAdmin("congreso:actualizado", {});
  emitPublico("leaderboard:actualizado", leaderboard);
  res.json({ ok: true, leaderboard });
});

// GET /api/admin/congreso/proyectos  — lista los 5 (o menos) proyectos de ley listos para el debate final
router.get("/congreso/proyectos", requireStaff("admin", "facilitador", "jurado"), (req, res) => {
  const rows = db
    .prepare(
      `SELECT pl.id as proyecto_ley_id, pl.nombre_proyecto, pl.alcance_texto, pl.firmado_por,
              s.nombre as sala_nombre, e.codigo as equipo_codigo, e.nombre as equipo_nombre,
              cv.resultado as resultado_congreso
       FROM proyecto_ley pl
       JOIN paso_recorrido pr ON pr.id = pl.paso_id
       JOIN sala s ON s.id = pr.sala_id
       JOIN equipo e ON e.id = pr.equipo_id
       LEFT JOIN congreso_voto cv ON cv.proyecto_ley_id = pl.id
       ORDER BY e.carpeta_numero ASC, s.slug ASC`
    )
    .all();
  res.json(rows);
});

// -----------------------------------------------------------------------
// POST /api/admin/puntaje/ajustar  (solo admin) — carga y ajuste manual de puntaje en vivo
// -----------------------------------------------------------------------
router.post("/puntaje/ajustar", requireStaff("admin"), (req, res) => {
  const { equipo_id, puntos, motivo } = req.body || {};
  if (!equipo_id || typeof puntos !== "number" || !motivo) {
    return res.status(400).json({ error: "Faltan datos: equipo_id, puntos (numero) y motivo." });
  }
  db.prepare(`INSERT INTO puntaje_ajuste (id, equipo_id, puntos, motivo, staff_id) VALUES (?, ?, ?, ?, ?)`)
    .run(uuid(), equipo_id, puntos, motivo, req.user.sub);

  const leaderboard = construirLeaderboard();
  emitAdmin("puntaje:ajustado", { equipo_id, puntos, motivo });
  emitPublico("leaderboard:actualizado", leaderboard);
  res.json({ ok: true, leaderboard });
});

// GET /api/admin/leaderboard
router.get("/leaderboard", requireStaff("admin", "facilitador", "jurado"), (req, res) => {
  res.json(construirLeaderboard());
});

module.exports = router;
