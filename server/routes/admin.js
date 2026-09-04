const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { requireAuth, requireStaff } = require("../auth");
const { emitAdmin, emitEquipo, emitPublico, emitGlobal } = require("../realtime");
const {
  derivarCartelito,
  construirLeaderboard,
  construirLeaderboardStaff,
  construirEstadoEscrutinio,
  getPasosDeEquipo,
  getProblemaParaEquipo,
  aplicarEfectos,
  normalizarUrlTransmision,
  getEstadoTransmision,
  CRISIS_TIPOS,
  getEvaluacionesTematicas,
  getEvaluacionesCrisis,
} = require("../logic");
const { EJES } = require("../ejes");
const { resetAndReseed } = require("../seed");

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

    const evalTematicas = {};
    for (const t of getEvaluacionesTematicas(equipo.id)) evalTematicas[t.sala_slug] = t.puntaje;
    const evalCrisis = {};
    for (const c of getEvaluacionesCrisis(equipo.id)) {
      evalCrisis[c.crisis_slug] = { coherencia: c.coherencia, oratoria: c.oratoria, manejo_nervios: c.manejo_nervios };
    }

    return {
      equipo: { id: equipo.id, codigo: equipo.codigo, nombre: equipo.nombre, carpeta_numero: equipo.carpeta_numero },
      jugadores,
      pasos,
      evaluaciones_tematicas: evalTematicas,
      evaluaciones_crisis: evalCrisis,
    };
  });

  res.json({
    equipos: data,
    ejes: EJES,
    crisis_tipos: CRISIS_TIPOS,
    leaderboard: construirLeaderboardStaff(),
    transmision: getEstadoTransmision(),
  });
});

// -----------------------------------------------------------------------
// POST /api/admin/evaluacion/tematica  (admin, o el facilitador asignado a
// esa sala) — carga/actualiza el puntaje de desempeño (1 a 5) de un equipo
// en una sala temática puntual.
// -----------------------------------------------------------------------
router.post("/evaluacion/tematica", requireStaff("admin", "facilitador"), (req, res) => {
  const { equipo_id, sala_slug, puntaje, comentario } = req.body || {};
  const p = Number(puntaje);
  if (!equipo_id || !sala_slug || !Number.isInteger(p) || p < 1 || p > 5) {
    return res.status(400).json({ error: "Faltan datos: equipo_id, sala_slug y puntaje (entero 1 a 5)." });
  }
  const sala = db.prepare("SELECT * FROM sala WHERE slug = ?").get(sala_slug);
  if (!sala) return res.status(404).json({ error: "Sala temática no encontrada." });
  if (req.user.staff_rol === "facilitador" && req.user.sala_asignada_id !== sala.id) {
    return res.status(403).json({ error: "No sos el facilitador asignado a esta sala." });
  }
  db.prepare(
    `INSERT INTO evaluacion_tematica (id, equipo_id, sala_id, puntaje, comentario, staff_id)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(equipo_id, sala_id) DO UPDATE SET puntaje = excluded.puntaje, comentario = excluded.comentario, staff_id = excluded.staff_id`
  ).run(uuid(), equipo_id, sala.id, p, comentario || null, req.user.sub);

  const leaderboard = construirLeaderboardStaff();
  emitAdmin("evaluacion:actualizada", { tipo: "tematica", equipo_id, sala_slug });
  res.json({ ok: true, leaderboard });
});

// -----------------------------------------------------------------------
// POST /api/admin/evaluacion/crisis  (admin o jurado) — carga/actualiza los
// 3 criterios (coherencia, oratoria, manejo de los nervios; 1 a 5 cada uno)
// de un equipo en una de las 3 crisis presenciales.
// -----------------------------------------------------------------------
router.post("/evaluacion/crisis", requireStaff("admin", "jurado"), (req, res) => {
  const { equipo_id, crisis_slug, coherencia, oratoria, manejo_nervios, comentario } = req.body || {};
  if (!equipo_id || !CRISIS_TIPOS.some((c) => c.slug === crisis_slug)) {
    return res.status(400).json({ error: "Faltan datos: equipo_id y crisis_slug válido." });
  }
  const criterios = { coherencia, oratoria, manejo_nervios };
  for (const [k, v] of Object.entries(criterios)) {
    if (v == null || v === "") continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      return res.status(400).json({ error: `${k} debe ser un entero de 1 a 5.` });
    }
    criterios[k] = n;
  }
  db.prepare(
    `INSERT INTO evaluacion_crisis (id, equipo_id, crisis_slug, coherencia, oratoria, manejo_nervios, comentario, jurado_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(equipo_id, crisis_slug) DO UPDATE SET
       coherencia = excluded.coherencia, oratoria = excluded.oratoria, manejo_nervios = excluded.manejo_nervios,
       comentario = excluded.comentario, jurado_id = excluded.jurado_id`
  ).run(
    uuid(),
    equipo_id,
    crisis_slug,
    criterios.coherencia ?? null,
    criterios.oratoria ?? null,
    criterios.manejo_nervios ?? null,
    comentario || null,
    req.user.sub
  );

  const leaderboard = construirLeaderboardStaff();
  emitAdmin("evaluacion:actualizada", { tipo: "crisis", equipo_id, crisis_slug });
  res.json({ ok: true, leaderboard });
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
          `INSERT INTO decision (id, paso_id, opcion_codigo, opcion_etiqueta, opcion_texto, efectos_json, cartelito_resultante, registrado_por)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(uuid(), paso.id, opcion.codigo, opcion.etiqueta, opcion.texto || null, JSON.stringify(efectosAplicados), cartelito, req.user.sub);

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
// POST /api/admin/rotacion/:orden_index/iniciar-todos  (solo admin) —
// inicia, para las 5 provincias en simultáneo, el paso que cada una tiene
// en la posición :orden_index de SU PROPIO recorrido (0 = "Sala 1", 1 =
// "Sala 2", etc.). Como el recorrido de cada provincia está rotado, la
// posición N puede ser una sala temática distinta para cada una — no
// importa: lo que se dispara es "la sala que le toca ahora a cada equipo",
// no una sala temática puntual. Los pasos que ya estén en curso o cerrados
// se saltean sin error (útil para volver a apretar el botón si algún
// facilitador ya inició manualmente su sala).
// -----------------------------------------------------------------------
router.post("/rotacion/:orden_index/iniciar-todos", requireStaff("admin"), (req, res) => {
  const ordenIndex = Number(req.params.orden_index);
  if (!Number.isInteger(ordenIndex) || ordenIndex < 0) {
    return res.status(400).json({ error: "Posición de sala inválida." });
  }

  const pasos = db
    .prepare(
      `SELECT pr.*, s.slug as sala_slug, s.nombre as sala_nombre
       FROM paso_recorrido pr JOIN sala s ON s.id = pr.sala_id
       WHERE pr.orden_index = ?`
    )
    .all(ordenIndex);

  if (!pasos.length) return res.status(404).json({ error: "No hay ninguna sala en esa posición del recorrido." });

  const now = new Date().toISOString();
  let iniciados = 0;
  const saltados = [];
  const tx = db.transaction(() => {
    for (const paso of pasos) {
      if (paso.estado !== "pendiente") {
        saltados.push({ equipo_id: paso.equipo_id, sala_nombre: paso.sala_nombre, motivo: paso.estado });
        continue;
      }
      db.prepare(`UPDATE paso_recorrido SET estado = 'en_curso', iniciado_en = ?, facilitador_id = ? WHERE id = ?`)
        .run(now, req.user.sub, paso.id);
      iniciados++;
      emitEquipo(paso.equipo_id, "estado:actualizado", { motivo: "paso_iniciado", sala_slug: paso.sala_slug });
    }
  });
  tx();

  emitAdmin("rotacion:iniciada_todos", { orden_index: ordenIndex, iniciados, saltados });
  res.json({ ok: true, iniciados, saltados });
});

// -----------------------------------------------------------------------
// POST /api/admin/transmision/publicar  (solo admin) — pone en vivo, para
// los 5 equipos y la pantalla pública, el video/audio de quien esté
// hablando en ese momento en la sala de crisis. No depende de una sala en
// particular: es una única señal (una sola cámara, un solo representante
// a la vez) que se actualiza con este mismo link cada vez que le toca
// hablar a otro equipo, o se corta con /transmision/cortar cuando termine.
// -----------------------------------------------------------------------
router.post("/transmision/publicar", requireStaff("admin"), (req, res) => {
  const { url } = req.body || {};
  if (!url || !url.trim()) return res.status(400).json({ error: "Falta el link de la transmisión." });

  const jornada = db.prepare("SELECT * FROM jornada ORDER BY creado_en DESC LIMIT 1").get();
  if (!jornada) return res.status(404).json({ error: "No hay jornada activa." });

  const normalizada = normalizarUrlTransmision(url);
  db.prepare("UPDATE jornada SET transmision_url = ?, transmision_activa = 1 WHERE id = ?").run(normalizada, jornada.id);

  const payload = { activa: true, url: normalizada };
  const equipos = db.prepare("SELECT id FROM equipo").all();
  equipos.forEach((e) => emitEquipo(e.id, "transmision:actualizada", payload));
  emitAdmin("transmision:actualizada", payload);
  emitPublico("transmision:actualizada", payload);
  res.json({ ok: true, ...payload });
});

// POST /api/admin/transmision/cortar  (solo admin) — oculta la transmisión
// en las 5 pantallas de equipo y en la pública. El link queda guardado
// para poder republicarlo con un click cuando le toque hablar al próximo.
router.post("/transmision/cortar", requireStaff("admin"), (req, res) => {
  const jornada = db.prepare("SELECT * FROM jornada ORDER BY creado_en DESC LIMIT 1").get();
  if (!jornada) return res.status(404).json({ error: "No hay jornada activa." });
  db.prepare("UPDATE jornada SET transmision_activa = 0 WHERE id = ?").run(jornada.id);

  const payload = { activa: false, url: jornada.transmision_url || null };
  const equipos = db.prepare("SELECT id FROM equipo").all();
  equipos.forEach((e) => emitEquipo(e.id, "transmision:actualizada", payload));
  emitAdmin("transmision:actualizada", payload);
  emitPublico("transmision:actualizada", payload);
  res.json({ ok: true, ...payload });
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
  res.json(construirLeaderboardStaff());
});

// -----------------------------------------------------------------------
// Escrutinio final: los organizadores le asignan manualmente a cada
// provincia un % de "votos" final (no se deriva automaticamente de Imagen
// Positiva) y lo publican cuando quieran. El panel publico y las miniaturas
// de equipo dejan de mostrar el tablero en vivo apenas se cierran todas las
// salas tematicas y esperan a esta publicacion para revelar el resultado
// con la animacion de conteo.
// -----------------------------------------------------------------------

// GET /api/admin/escrutinio  (solo admin) — trae el borrador actual + estado
router.get("/escrutinio", requireStaff("admin"), (req, res) => {
  const equipos = db
    .prepare("SELECT id, codigo, nombre, carpeta_numero, resultado_final_pct FROM equipo ORDER BY carpeta_numero ASC")
    .all();
  res.json({ equipos, estado: construirEstadoEscrutinio() });
});

// POST /api/admin/escrutinio/guardar  (solo admin) — guarda el borrador sin publicar.
// body: { resultados: [{ equipo_id, porcentaje }, ...] }
router.post("/escrutinio/guardar", requireStaff("admin"), (req, res) => {
  const { resultados } = req.body || {};
  if (!Array.isArray(resultados)) return res.status(400).json({ error: "Falta el array 'resultados'." });

  const tx = db.transaction(() => {
    for (const r of resultados) {
      if (!r || !r.equipo_id) continue;
      const pct = Number(r.porcentaje);
      db.prepare("UPDATE equipo SET resultado_final_pct = ? WHERE id = ?").run(Number.isFinite(pct) ? pct : null, r.equipo_id);
    }
  });
  tx();

  emitAdmin("escrutinio:guardado", {});
  res.json({ ok: true });
});

// POST /api/admin/escrutinio/publicar  (solo admin) — revela el resultado
// final en el panel publico y en las miniaturas de equipo. Requiere que
// todas las salas tematicas esten cerradas.
router.post("/escrutinio/publicar", requireStaff("admin"), (req, res) => {
  const estado = construirEstadoEscrutinio();
  if (!estado.todo_cerrado) {
    return res.status(409).json({ error: "Todavía hay salas temáticas sin cerrar." });
  }
  const jornada = db.prepare("SELECT * FROM jornada ORDER BY creado_en DESC LIMIT 1").get();
  if (!jornada) return res.status(404).json({ error: "No hay jornada activa." });

  const now = new Date().toISOString();
  db.prepare("UPDATE jornada SET resultados_publicados = 1, resultados_publicados_en = ? WHERE id = ?").run(now, jornada.id);

  const leaderboard = construirLeaderboard();
  const resultados = leaderboard.map((r) => ({
    equipo_id: r.equipo_id,
    codigo: r.codigo,
    nombre: r.nombre,
    porcentaje: r.resultado_final_pct ?? 0,
  }));

  emitAdmin("escrutinio:publicado", { resultados });
  emitPublico("escrutinio:publicado", { resultados });
  res.json({ ok: true, resultados });
});

// POST /api/admin/escrutinio/despublicar  (solo admin) — por si hay que
// corregir un valor despues de haber revelado el resultado.
router.post("/escrutinio/despublicar", requireStaff("admin"), (req, res) => {
  const jornada = db.prepare("SELECT * FROM jornada ORDER BY creado_en DESC LIMIT 1").get();
  if (!jornada) return res.status(404).json({ error: "No hay jornada activa." });
  db.prepare("UPDATE jornada SET resultados_publicados = 0, resultados_publicados_en = NULL WHERE id = ?").run(jornada.id);

  emitAdmin("escrutinio:despublicado", {});
  emitPublico("escrutinio:despublicado", {});
  res.json({ ok: true });
});

// -----------------------------------------------------------------------
// POST /api/admin/reiniciar  (solo admin) — vuelve TODA la jornada a cero:
// borra el progreso de las 5 provincias, las decisiones tomadas y los
// ajustes manuales, y vuelve a sembrar los mismos codigos/PIN de equipo y
// credenciales de staff de siempre.
// Como esto genera equipos y usuarios nuevos (otros ids), avisa a TODOS los
// paneles conectados (equipo, admin, publico) para que se recarguen solos:
// cualquier sesion vieja (incluida la del admin que ejecuta el reinicio)
// queda invalida y vuelve a pedir login.
// -----------------------------------------------------------------------
router.post("/reiniciar", requireStaff("admin"), (req, res) => {
  resetAndReseed();
  emitGlobal("app:reset", { mensaje: "La jornada fue reiniciada por el administrador." });
  res.json({ ok: true });
});

module.exports = router;
