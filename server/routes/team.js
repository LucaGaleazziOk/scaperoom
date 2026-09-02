const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { requireAuth, requireJugador } = require("../auth");
const { emitAdmin, emitEquipo, emitPublico } = require("../realtime");
const {
  derivarCartelito,
  getEquipoCompleto,
  getPasosDeEquipo,
  getProblemaParaEquipo,
  getAperturaVariante,
  construirCasoCriticoParaEquipo,
  aplicarEfectos,
  construirLeaderboard,
} = require("../logic");

const router = express.Router();
router.use(requireAuth, requireJugador);

function basePasoPublico(paso) {
  return {
    paso_id: paso.id,
    orden_index: paso.orden_index,
    sala_slug: paso.sala_slug,
    sala_nombre: paso.sala_nombre,
    eje: paso.sala_eje,
    estado: paso.estado,
    cartelito_entrada: paso.cartelito_entrada,
    iniciado_en: paso.iniciado_en,
    cerrado_en: paso.cerrado_en,
  };
}

// GET /api/team/estado
// Devuelve el recorrido de las 5 salas tematicas (con el problema
// personalizado de la propia provincia una vez que la sala arranca, y las
// 3 opciones brevemente explicadas — nunca sus efectos ocultos), el estado
// de las 3 salas de crisis (globales, no rotan), y el objetivo secreto del
// unico rol logueado (Jefe/a de Gabinete).
router.get("/estado", (req, res) => {
  const equipo = getEquipoCompleto(req.user.equipo_id);
  if (!equipo) return res.status(404).json({ error: "Equipo no encontrado." });

  const rol = db.prepare("SELECT * FROM rol WHERE id = ?").get(req.user.rol_id);
  const pasos = getPasosDeEquipo(equipo.id);

  const pasosEnriquecidos = pasos.map((paso) => {
    const out = basePasoPublico(paso);
    if (paso.estado === "en_curso" || paso.estado === "cerrado") {
      const sala = db.prepare("SELECT * FROM sala WHERE id = ?").get(paso.sala_id);
      out.encuadre = sala.encuadre;
      if (paso.cartelito_entrada) {
        out.variante_apertura = getAperturaVariante(sala, paso.cartelito_entrada);
      }
      const problema = getProblemaParaEquipo(sala, equipo.codigo);
      if (problema) {
        out.enunciado = problema.enunciado;
        out.opciones = problema.opciones.map((o) => ({ codigo: o.codigo, etiqueta: o.etiqueta, texto: o.texto }));
      }
      const decision = db.prepare("SELECT * FROM decision WHERE paso_id = ?").get(paso.id);
      if (decision) {
        out.decision = { opcion_codigo: decision.opcion_codigo, opcion_etiqueta: decision.opcion_etiqueta };
      }
    }
    return out;
  });

  const salasCrisis = db.prepare("SELECT * FROM sala WHERE tipo = 'crisis' ORDER BY orden_crisis ASC").all();
  const crisis = salasCrisis.map((sala) => {
    const estado = db.prepare("SELECT * FROM crisis_estado WHERE sala_id = ?").get(sala.id);
    const evaluada = db
      .prepare("SELECT 1 FROM evaluacion_crisis WHERE equipo_id = ? AND sala_id = ?")
      .get(equipo.id, sala.id);
    return {
      sala_id: sala.id,
      slug: sala.slug,
      nombre: sala.nombre,
      disparada: !!estado?.disparada,
      // El caso_critico se arma "en vivo" enganchado con la ultima decision
      // que este equipo haya tomado hasta este momento (la crisis se puede
      // disparar en cualquier punto del recorrido): ver construirCasoCriticoParaEquipo.
      caso_critico: estado?.disparada ? construirCasoCriticoParaEquipo(sala, equipo.id) : null,
      evaluada: !!evaluada,
      // El cronometro de 8 minutos lo arranca el admin de forma remota,
      // separado del "disparar": hasta entonces el equipo ve la consigna
      // sin cuenta regresiva. Tambien puede pausarse o finalizarse antes de
      // tiempo, siempre desde el panel de administracion.
      cronometro_iniciado_en: estado?.cronometro_iniciado_en || null,
      duracion_segundos: estado?.duracion_segundos || 480,
      cronometro_pausado_en: estado?.cronometro_pausado_en || null,
      cronometro_finalizado_en: estado?.cronometro_finalizado_en || null,
    };
  });

  res.json({
    equipo: {
      id: equipo.id,
      codigo: equipo.codigo,
      nombre: equipo.nombre,
      contexto_arranque: equipo.contexto_arranque,
      objetivos_generales: equipo.objetivos_generales,
      tension_interna: equipo.tension_interna,
    },
    mi_rol: rol ? { slug: rol.slug, nombre: rol.nombre, objetivo_secreto: rol.objetivo_secreto } : null,
    pasos: pasosEnriquecidos,
    crisis,
  });
});

// POST /api/team/entregar
// El equipo elige una de las 3 opciones del problema de su propia provincia
// para el paso que tiene en curso. El efecto sobre los ejes de desempeño se
// aplica automaticamente y en silencio (nunca se le muestra al equipo), y el
// cartelito resultante (= la opcion elegida) se propaga a la siguiente sala
// pendiente del recorrido.
router.post("/entregar", (req, res) => {
  const { paso_id, opcion_codigo } = req.body || {};
  if (!paso_id || !opcion_codigo) {
    return res.status(400).json({ error: "Faltan datos: paso_id y opcion_codigo son obligatorios." });
  }

  const paso = db.prepare("SELECT * FROM paso_recorrido WHERE id = ? AND equipo_id = ?").get(paso_id, req.user.equipo_id);
  if (!paso) return res.status(404).json({ error: "Paso no encontrado para este equipo." });
  if (paso.estado !== "en_curso") {
    return res.status(409).json({ error: `Este paso esta en estado '${paso.estado}', no se puede entregar (debe estar 'en_curso').` });
  }
  const sala = db.prepare("SELECT * FROM sala WHERE id = ?").get(paso.sala_id);
  const equipo = db.prepare("SELECT * FROM equipo WHERE id = ?").get(req.user.equipo_id);
  const problema = getProblemaParaEquipo(sala, equipo.codigo);
  if (!problema) return res.status(400).json({ error: "Esta sala no tiene un problema cargado para esta provincia." });

  const opcion = problema.opciones.find((o) => o.codigo === opcion_codigo);
  if (!opcion) {
    return res.status(400).json({ error: `Opcion invalida. Validas: ${problema.opciones.map((o) => o.codigo).join(", ")}` });
  }
  const existente = db.prepare("SELECT 1 FROM decision WHERE paso_id = ?").get(paso.id);
  if (existente) return res.status(409).json({ error: "Este paso ya tiene una decision registrada." });

  const cartelito = derivarCartelito(opcion.codigo);
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    const efectosAplicados = aplicarEfectos(equipo.id, opcion.efectos || {});

    db.prepare(
      `INSERT INTO decision (id, paso_id, opcion_codigo, opcion_etiqueta, opcion_texto, efectos_json, cartelito_resultante, registrado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(uuid(), paso.id, opcion.codigo, opcion.etiqueta, opcion.texto || null, JSON.stringify(efectosAplicados), cartelito, req.user.sub);

    db.prepare(`UPDATE paso_recorrido SET estado = 'cerrado', cerrado_en = ? WHERE id = ?`).run(now, paso.id);

    const siguiente = db
      .prepare(`SELECT * FROM paso_recorrido WHERE equipo_id = ? AND orden_index = ? AND estado = 'pendiente'`)
      .get(req.user.equipo_id, paso.orden_index + 1);
    if (siguiente) {
      db.prepare(`UPDATE paso_recorrido SET cartelito_entrada = ? WHERE id = ?`).run(cartelito, siguiente.id);
    }
  });
  tx();

  const leaderboard = construirLeaderboard();
  emitAdmin("paso:cerrado", { equipo_id: req.user.equipo_id, paso_id: paso.id, sala_slug: sala.slug });
  emitEquipo(req.user.equipo_id, "estado:actualizado", { motivo: "entrega_registrada" });
  emitPublico("leaderboard:actualizado", leaderboard);

  // No se revelan los efectos al equipo: solo confirmamos que se registro.
  res.json({ ok: true });
});

module.exports = router;
