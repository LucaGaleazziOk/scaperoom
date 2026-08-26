const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { requireAuth, requireJugador } = require("../auth");
const { emitAdmin, emitEquipo, emitPublico } = require("../realtime");
const { derivarCartelito, getEquipoCompleto, getPasosDeEquipo, construirLeaderboard } = require("../logic");

const router = express.Router();
router.use(requireAuth, requireJugador);

// GET /api/team/estado
// Devuelve el estado completo del equipo del usuario autenticado: paso activo
// (con el caso y la variante de apertura segun el cartelito recibido),
// historial de salas ya cerradas, y el objetivo secreto — pero SOLO el del
// propio rol del usuario autenticado, nunca el de sus compañeros de equipo.
router.get("/estado", (req, res) => {
  const equipo = getEquipoCompleto(req.user.equipo_id);
  if (!equipo) return res.status(404).json({ error: "Equipo no encontrado." });

  const rol = db.prepare("SELECT * FROM rol WHERE id = ?").get(req.user.rol_id);
  const pasos = getPasosDeEquipo(equipo.id);

  const crisisEstado = db.prepare("SELECT * FROM crisis_estado LIMIT 1").get();

  const pasosEnriquecidos = pasos.map((paso) => {
    const esCrisis = paso.orden_index === 99;
    if (esCrisis && !crisisEstado?.disparada) {
      // No se revela nada de la Sala 6 hasta que el admin la dispare
      return { ...basePasoPublico(paso), oculto: true };
    }

    const sala = db.prepare("SELECT * FROM sala WHERE id = ?").get(paso.sala_id);
    const opciones = JSON.parse(sala.opciones_json || "[]");
    const aperturaMap = JSON.parse(sala.apertura_json || "{}");

    const decision = db.prepare("SELECT * FROM decision WHERE paso_id = ?").get(paso.id);
    const proyecto = db.prepare("SELECT * FROM proyecto_ley WHERE paso_id = ?").get(paso.id);

    const out = {
      ...basePasoPublico(paso),
      sala_slug: sala.slug,
      sala_nombre: sala.nombre,
      sala_tipo: sala.tipo,
      proyecto_ley_nombre: sala.proyecto_ley_nombre,
      decision_tipo: sala.decision_tipo,
    };

    if (paso.estado === "en_curso" || paso.estado === "cerrado") {
      out.encuadre = sala.encuadre;
      out.caso_critico = sala.caso_critico;
      out.opciones = sala.decision_tipo === "binaria"
        ? [{ codigo: "SI", etiqueta: "SÍ" }, { codigo: "NO", etiqueta: "NO" }]
        : opciones.map((o) => ({ codigo: o.codigo, etiqueta: o.etiqueta }));
      if (paso.cartelito_entrada) {
        out.variante_apertura = aperturaMap[paso.cartelito_entrada] || null;
      }
    }
    if (decision) {
      out.decision = { opcion_codigo: decision.opcion_codigo, cartelito_resultante: decision.cartelito_resultante };
      // Consecuencia narrativa + impacto presupuestario, solo visibles una vez decidido
      const opcionInfo = sala.decision_tipo === "binaria"
        ? { consecuencia: opciones.length ? null : null }
        : opciones.find((o) => o.codigo === decision.opcion_codigo);
      // Para binaria buscamos en un arreglo especial guardado en opciones_json tambien
      const opcionData = opciones.find((o) => o.codigo === decision.opcion_codigo);
      if (opcionData) {
        out.consecuencia_narrativa = opcionData.consecuencia;
        out.impacto_presupuestario = opcionData.impacto_presupuestario;
      }
    }
    if (proyecto) {
      out.proyecto = {
        nombre_proyecto: proyecto.nombre_proyecto,
        alcance_texto: proyecto.alcance_texto,
        firmado_por: proyecto.firmado_por,
      };
    }
    return out;
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
    crisis_disparada: !!crisisEstado?.disparada,
    pasos: pasosEnriquecidos,
  });
});

function basePasoPublico(paso) {
  return {
    paso_id: paso.id,
    orden_index: paso.orden_index,
    estado: paso.estado,
    cartelito_entrada: paso.cartelito_entrada,
    iniciado_en: paso.iniciado_en,
    cerrado_en: paso.cerrado_en,
  };
}

// POST /api/team/entregar
// El equipo registra su decision + el proyecto de ley del paso que tiene
// actualmente en curso, y cierra ese paso. El cartelito resultante se
// propaga automaticamente al siguiente paso pendiente del recorrido.
router.post("/entregar", (req, res) => {
  const { paso_id, opcion_codigo, nombre_proyecto, alcance_texto, firmado_por } = req.body || {};
  if (!paso_id || !opcion_codigo || !nombre_proyecto || !alcance_texto) {
    return res.status(400).json({ error: "Faltan datos: paso_id, opcion_codigo, nombre_proyecto y alcance_texto son obligatorios." });
  }

  const paso = db.prepare("SELECT * FROM paso_recorrido WHERE id = ? AND equipo_id = ?").get(paso_id, req.user.equipo_id);
  if (!paso) return res.status(404).json({ error: "Paso no encontrado para este equipo." });
  if (paso.estado !== "en_curso") {
    return res.status(409).json({ error: `Este paso esta en estado '${paso.estado}', no se puede entregar (debe estar 'en_curso').` });
  }
  const sala = db.prepare("SELECT * FROM sala WHERE id = ?").get(paso.sala_id);
  if (sala.tipo === "crisis") {
    return res.status(400).json({ error: "La Sala 6 no tiene proyecto de ley: es una instancia formativa." });
  }

  const opciones = JSON.parse(sala.opciones_json || "[]");
  const codigosValidos = sala.decision_tipo === "binaria" ? ["SI", "NO"] : opciones.map((o) => o.codigo);
  if (!codigosValidos.includes(opcion_codigo)) {
    return res.status(400).json({ error: `Opcion invalida para esta sala. Validas: ${codigosValidos.join(", ")}` });
  }

  const cartelito = derivarCartelito(sala.decision_tipo, opcion_codigo);
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO decision (id, paso_id, opcion_codigo, cartelito_resultante, registrado_por) VALUES (?, ?, ?, ?, ?)`
    ).run(uuid(), paso.id, opcion_codigo, cartelito, req.user.sub);

    db.prepare(
      `INSERT INTO proyecto_ley (id, paso_id, nombre_proyecto, alcance_texto, firmado_por) VALUES (?, ?, ?, ?, ?)`
    ).run(uuid(), paso.id, nombre_proyecto, alcance_texto, firmado_por || null);

    db.prepare(`UPDATE paso_recorrido SET estado = 'cerrado', cerrado_en = ? WHERE id = ?`).run(now, paso.id);

    // Propaga el cartelito al siguiente paso tematico pendiente del recorrido (no a la Sala 6)
    const siguiente = db
      .prepare(
        `SELECT pr.* FROM paso_recorrido pr JOIN sala s ON s.id = pr.sala_id
         WHERE pr.equipo_id = ? AND pr.orden_index = ? AND pr.estado = 'pendiente' AND s.tipo != 'crisis'`
      )
      .get(req.user.equipo_id, paso.orden_index + 1);
    if (siguiente) {
      db.prepare(`UPDATE paso_recorrido SET cartelito_entrada = ? WHERE id = ?`).run(cartelito, siguiente.id);
    }
  });
  tx();

  const leaderboard = construirLeaderboard();
  emitAdmin("paso:cerrado", { equipo_id: req.user.equipo_id, paso_id: paso.id, sala_slug: sala.slug, cartelito });
  emitEquipo(req.user.equipo_id, "estado:actualizado", { motivo: "entrega_registrada" });
  emitPublico("leaderboard:actualizado", leaderboard);

  res.json({ ok: true, cartelito_resultante: cartelito });
});

module.exports = router;
