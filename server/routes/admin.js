const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { requireAuth, requireStaff } = require("../auth");
const { emitAdmin, emitEquipo, emitPublico } = require("../realtime");
const {
  derivarCartelito,
  construirLeaderboard,
  getPasosDeEquipo,
  getProblemaParaEquipo,
  aplicarEfectos,
  calcularPuntosCrisis,
} = require("../logic");
const { EJES } = require("../ejes");

const router = express.Router();
router.use(requireAuth);

// -----------------------------------------------------------------------
// GET /api/admin/overview  (admin + facilitador + jurado, lectura)
// Vista general de los 5 equipos: en que sala estan, estado del paso,
// cartelito con el que llegaron, y la decision tomada (con sus efectos,
// visibles solo para staff — nunca para los equipos).
// -----------------------------------------------------------------------
router.get("/overview", requireStaff("admin", "facilitador", "jurado"), (req, res) => {
  const equipos = db.prepare("SELECT * FROM equipo ORDER BY carpeta_numero ASC").all();
  const salasCrisis = db.prepare("SELECT * FROM sala WHERE tipo = 'crisis' ORDER BY orden_crisis ASC").all();
  const crisisEstados = salasCrisis.map((sala) => db.prepare("SELECT * FROM crisis_estado WHERE sala_id = ?").get(sala.id));

  const data = equipos.map((equipo) => {
    const pasos = getPasosDeEquipo(equipo.id).map((p) => {
      const sala = db.prepare("SELECT * FROM sala WHERE id = ?").get(p.sala_id);
      const decision = db.prepare("SELECT * FROM decision WHERE paso_id = ?").get(p.id);
      const problema = getProblemaParaEquipo(sala, equipo.codigo);
      return {
        paso_id: p.id,
        sala_slug: p.sala_slug,
        sala_nombre: p.sala_nombre,
        eje: p.sala_eje,
        orden_index: p.orden_index,
        estado: p.estado,
        cartelito_entrada: p.cartelito_entrada,
        enunciado: problema ? problema.enunciado : null,
        decision: decision
          ? {
              opcion_codigo: decision.opcion_codigo,
              opcion_etiqueta: decision.opcion_etiqueta,
              efectos: JSON.parse(decision.efectos_json || "{}"),
              cartelito_resultante: decision.cartelito_resultante,
            }
          : null,
      };
    });
    const jugadores = db
      .prepare(
        `SELECT u.id, u.nombre, r.slug as rol_slug, r.nombre as rol_nombre
         FROM usuario u JOIN rol r ON r.id = u.rol_id
         WHERE u.equipo_id = ? ORDER BY r.orden ASC`
      )
      .all(equipo.id);
    const evaluacionesCrisis = salasCrisis.map((sala) => ({
      sala_slug: sala.slug,
      sala_nombre: sala.nombre,
      evaluacion: db.prepare("SELECT * FROM evaluacion_crisis WHERE equipo_id = ? AND sala_id = ?").get(equipo.id, sala.id) || null,
    }));

    return {
      equipo: { id: equipo.id, codigo: equipo.codigo, nombre: equipo.nombre, carpeta_numero: equipo.carpeta_numero },
      jugadores,
      pasos,
      evaluaciones_crisis: evaluacionesCrisis,
    };
  });

  res.json({
    equipos: data,
    ejes: EJES,
    salas_crisis: salasCrisis.map((s, i) => ({
      sala_id: s.id,
      slug: s.slug,
      nombre: s.nombre,
      caso_critico: s.caso_critico,
      disparada: !!crisisEstados[i]?.disparada,
    })),
    leaderboard: construirLeaderboard(),
  });
});

// -----------------------------------------------------------------------
// POST /api/admin/paso/:id/iniciar  (admin + facilitador de esa sala)
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

// POST /api/admin/paso/:id/cerrar — cierre forzado por moderacion (elige la opcion en nombre del equipo)
router.post("/paso/:id/cerrar", requireStaff("admin", "facilitador"), (req, res) => {
  const { opcion_codigo } = req.body || {};
  const paso = db.prepare("SELECT * FROM paso_recorrido WHERE id = ?").get(req.params.id);
  if (!paso) return res.status(404).json({ error: "Paso no encontrado." });
  const sala = db.prepare("SELECT * FROM sala WHERE id = ?").get(paso.sala_id);
  const equipo = db.prepare("SELECT * FROM equipo WHERE id = ?").get(paso.equipo_id);

  if (req.user.staff_rol === "facilitador" && req.user.sala_asignada_id !== sala.id) {
    return res.status(403).json({ error: "No sos el facilitador asignado a esta sala." });
  }
  if (paso.estado === "cerrado") return res.status(409).json({ error: "El paso ya estaba cerrado." });

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    if (opcion_codigo) {
      const problema = getProblemaParaEquipo(sala, equipo.codigo);
      const opcion = problema?.opciones.find((o) => o.codigo === opcion_codigo);
      const existente = db.prepare("SELECT * FROM decision WHERE paso_id = ?").get(paso.id);
      if (!existente && opcion) {
        const efectosAplicados = aplicarEfectos(equipo.id, opcion.efectos || {});
        const cartelito = derivarCartelito(opcion.codigo);
        db.prepare(
          `INSERT INTO decision (id, paso_id, opcion_codigo, opcion_etiqueta, efectos_json, cartelito_resultante, registrado_por)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(uuid(), paso.id, opcion.codigo, opcion.etiqueta, JSON.stringify(efectosAplicados), cartelito, req.user.sub);

        const siguiente = db
          .prepare(`SELECT * FROM paso_recorrido WHERE equipo_id = ? AND orden_index = ? AND estado = 'pendiente'`)
          .get(paso.equipo_id, paso.orden_index + 1);
        if (siguiente) db.prepare(`UPDATE paso_recorrido SET cartelito_entrada = ? WHERE id = ?`).run(cartelito, siguiente.id);
      }
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
// POST /api/admin/crisis/disparar  (solo admin) — dispara UNA sala de crisis
// especifica (body: { sala_id }) para los 5 equipos en simultaneo.
// -----------------------------------------------------------------------
router.post("/crisis/disparar", requireStaff("admin"), (req, res) => {
  const { sala_id } = req.body || {};
  const sala = db.prepare("SELECT * FROM sala WHERE id = ? AND tipo = 'crisis'").get(sala_id);
  if (!sala) return res.status(404).json({ error: "Sala de crisis no encontrada." });

  const crisisEstado = db.prepare("SELECT * FROM crisis_estado WHERE sala_id = ?").get(sala.id);
  if (crisisEstado?.disparada) return res.status(409).json({ error: "Esa sala de crisis ya fue disparada." });

  const now = new Date().toISOString();
  db.prepare(`UPDATE crisis_estado SET disparada = 1, disparada_en = ? WHERE id = ?`).run(now, crisisEstado.id);

  const equipos = db.prepare("SELECT id FROM equipo").all();
  equipos.forEach((e) =>
    emitEquipo(e.id, "crisis:iniciada", { sala_id: sala.id, sala_nombre: sala.nombre, mensaje: `Se disparó: ${sala.nombre}` })
  );
  emitAdmin("crisis:iniciada", { sala_id: sala.id });
  emitPublico("crisis:iniciada", { sala_nombre: sala.nombre });
  res.json({ ok: true });
});

// POST /api/admin/crisis/evaluar  (solo jurado o admin) — body: { equipo_id, sala_id, claridad, manejo_incertidumbre, coherencia, control_presion, comentario }
router.post("/crisis/evaluar", requireStaff("admin", "jurado"), (req, res) => {
  const { equipo_id, sala_id, claridad, manejo_incertidumbre, coherencia, control_presion, comentario } = req.body || {};
  if (!equipo_id || !sala_id) return res.status(400).json({ error: "Faltan equipo_id y sala_id." });
  const sala = db.prepare("SELECT * FROM sala WHERE id = ? AND tipo = 'crisis'").get(sala_id);
  if (!sala) return res.status(404).json({ error: "Sala de crisis no encontrada." });

  const yaEvaluado = db.prepare("SELECT * FROM evaluacion_crisis WHERE equipo_id = ? AND sala_id = ?").get(equipo_id, sala_id);
  if (yaEvaluado) return res.status(409).json({ error: "Esta provincia ya fue evaluada en esta sala de crisis." });

  const evaluacion = { claridad, manejo_incertidumbre, coherencia, control_presion };
  const puntos = calcularPuntosCrisis(evaluacion);

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO evaluacion_crisis (id, equipo_id, sala_id, claridad, manejo_incertidumbre, coherencia, control_presion, comentario, jurado_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(uuid(), equipo_id, sala_id, claridad, manejo_incertidumbre, coherencia, control_presion, comentario || "", req.user.sub);

    const efectos = { imagen_positiva: puntos };
    if (sala.slug === "crisis_seguridad") efectos.orden_publico = Math.round(puntos / 2);
    if (sala.slug === "crisis_fiscal") efectos.salud_fiscal = Math.round(puntos / 2);
    aplicarEfectos(equipo_id, efectos);
  });
  tx();

  const leaderboard = construirLeaderboard();
  emitAdmin("crisis:evaluada", { equipo_id, sala_id, puntos });
  emitPublico("leaderboard:actualizado", leaderboard);
  res.json({ ok: true, puntos, leaderboard });
});

// -----------------------------------------------------------------------
// POST /api/admin/puntaje/ajustar  (solo admin) — ajuste manual de un eje en vivo
// -----------------------------------------------------------------------
router.post("/puntaje/ajustar", requireStaff("admin"), (req, res) => {
  const { equipo_id, eje, puntos, motivo } = req.body || {};
  const ejeFinal = eje || "imagen_positiva";
  if (!equipo_id || typeof puntos !== "number" || !motivo) {
    return res.status(400).json({ error: "Faltan datos: equipo_id, puntos (numero) y motivo." });
  }
  if (!EJES.some((e) => e.slug === ejeFinal)) {
    return res.status(400).json({ error: `Eje invalido. Validos: ${EJES.map((e) => e.slug).join(", ")}` });
  }
  db.prepare(`INSERT INTO puntaje_ajuste (id, equipo_id, eje, puntos, motivo, staff_id) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(uuid(), equipo_id, ejeFinal, puntos, motivo, req.user.sub);

  const leaderboard = construirLeaderboard();
  emitAdmin("puntaje:ajustado", { equipo_id, eje: ejeFinal, puntos, motivo });
  emitPublico("leaderboard:actualizado", leaderboard);
  res.json({ ok: true, leaderboard });
});

// GET /api/admin/leaderboard
router.get("/leaderboard", requireStaff("admin", "facilitador", "jurado"), (req, res) => {
  res.json(construirLeaderboard());
});

module.exports = router;
