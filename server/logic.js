const db = require("./db");
const { EJE_SLUGS, EJE_PRINCIPAL, clamp } = require("./ejes");

// Las 3 crisis presenciales (en papel). No tienen fila en la tabla "sala":
// se identifican por este slug fijo. "rol" es el rol al que se saca de su
// sala temática para entregarle el sobre (ver documento de sobres).
const CRISIS_TIPOS = [
  { slug: "comunicacion", nombre: "Crisis de Comunicación", rol: "Gobernador/a" },
  { slug: "orden_publico", nombre: "Crisis de Orden Público", rol: "Jefe/a de Gabinete" },
  { slug: "fiscal", nombre: "Crisis Fiscal", rol: "Ministro/a de Economía" },
];

// Orden de prioridad (de más a menos importante) que usa el % sugerido:
// pesos tipo "suma de rangos" (6,5,4,3,2,1 sobre 21) — el primero pesa 6
// veces más que el último, con una escala pareja entre medio.
const PESOS_SUGERIDO = [
  ["intencion_voto", 6],
  ["imagen_positiva", 5],
  ["desempeno", 4],
  ["gobernabilidad", 3],
  ["salud_fiscal", 2],
  ["orden_publico", 1],
];

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

// ---------------------------------------------------------------------
// Desempeño: promedio de todas las notas de 1 a 5 que cargó el staff para
// un equipo — una por cada una de las 5 salas temáticas (facilitador) y
// una por cada una de las 3 crisis presenciales (jurado, promediando sus
// 3 criterios: coherencia, oratoria, manejo de los nervios). Se escala a
// 0-100 igual que los demás ejes (1 -> 0, 3 -> 50, 5 -> 100). Si todavía
// no se cargó ninguna nota devuelve null (no castiga al equipo por
// evaluaciones pendientes).
// ---------------------------------------------------------------------
function getEvaluacionesTematicas(equipoId) {
  return db
    .prepare(
      `SELECT et.*, s.slug as sala_slug, s.nombre as sala_nombre
       FROM evaluacion_tematica et JOIN sala s ON s.id = et.sala_id
       WHERE et.equipo_id = ?`
    )
    .all(equipoId);
}

function getEvaluacionesCrisis(equipoId) {
  return db.prepare(`SELECT * FROM evaluacion_crisis WHERE equipo_id = ?`).all(equipoId);
}

function calcularDesempeno(equipoId) {
  const notas = [];
  for (const t of getEvaluacionesTematicas(equipoId)) {
    if (t.puntaje != null) notas.push(t.puntaje);
  }
  for (const c of getEvaluacionesCrisis(equipoId)) {
    const vals = [c.coherencia, c.oratoria, c.manejo_nervios].filter((v) => v != null);
    if (vals.length) notas.push(vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  if (!notas.length) return null;
  const promedio = notas.reduce((a, b) => a + b, 0) / notas.length; // 1..5
  return clamp(((promedio - 1) / 4) * 100);
}

// Puntaje ponderado (0-100) de una provincia: promedio de los 6 ejes (los 5
// de siempre + Desempeño) según PESOS_SUGERIDO. Es un valor absoluto, previo
// a repartir el 100% entre las 5 provincias (ver construirLeaderboardStaff).
// Si un eje no tiene valor (típicamente Desempeño, mientras no haya notas
// cargadas) se excluye del promedio en lugar de contar como 0, redistribuyendo
// su peso entre el resto.
function calcularPuntajeSugeridoBruto(ejesFinales, desempeno) {
  const valores = { ...ejesFinales, desempeno };
  const entradas = PESOS_SUGERIDO.filter(([slug]) => valores[slug] != null);
  const sumaPesos = entradas.reduce((acc, [, peso]) => acc + peso, 0);
  if (!sumaPesos) return null;
  const sumaPonderada = entradas.reduce((acc, [slug, peso]) => acc + peso * valores[slug], 0);
  return sumaPonderada / sumaPesos;
}

// Agrega desempeño + % sugerido a las filas de construirLeaderboard(). Se
// usa solo en las vistas de staff (nunca en /api/public/leaderboard): son
// datos internos de organización, no algo que vea el público ni los equipos.
//
// El % sugerido NO es el puntaje ponderado de cada provincia en términos
// absolutos: es la porción que le tocaría del 100% total, en proporción a su
// puntaje ponderado frente al de las otras 4. Así imita un resultado
// electoral real (las 5 provincias siempre suman 100%) en vez de dar 5
// números sueltos que casualmente puedan coincidir entre sí. El redondeo usa
// el método del "mayor resto" para que, aun redondeando cada fila a 1
// decimal, la columna siga sumando exactamente 100.0.
function construirLeaderboardStaff() {
  const base = construirLeaderboard().map((row) => {
    const desempeno = calcularDesempeno(row.equipo_id);
    const bruto = calcularPuntajeSugeridoBruto(row.ejes, desempeno);
    return { ...row, desempeno, _bruto: bruto ?? 0 };
  });

  const sumaBruta = base.reduce((acc, r) => acc + r._bruto, 0);

  if (!sumaBruta) {
    // Ningún puntaje ponderado disponible todavía: reparte 100% en partes
    // iguales en vez de dividir por cero.
    const partesIguales = Math.round((100 / base.length) * 10) / 10;
    return base.map(({ _bruto, ...row }) => ({ ...row, porcentaje_sugerido: partesIguales }));
  }

  const crudos = base.map((row) => (row._bruto / sumaBruta) * 100);
  const pisos = crudos.map((v) => Math.floor(v * 10) / 10);
  const sumaPisos = Math.round(pisos.reduce((a, b) => a + b, 0) * 10) / 10;
  const decimasARepartir = Math.round((100 - sumaPisos) * 10);

  const ordenPorResiduo = crudos
    .map((v, i) => ({ i, residuo: v * 10 - Math.floor(v * 10) }))
    .sort((a, b) => b.residuo - a.residuo);

  const ajustes = new Array(base.length).fill(0);
  for (let k = 0; k < decimasARepartir && k < ordenPorResiduo.length; k++) {
    ajustes[ordenPorResiduo[k].i] += 0.1;
  }

  return base.map(({ _bruto, ...row }, i) => ({
    ...row,
    porcentaje_sugerido: Math.round((pisos[i] + ajustes[i]) * 10) / 10,
  }));
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

// Convierte un link "para humanos" (por ejemplo el que se copia al mirar un
// video de YouTube, o el de un live de YouTube) en la URL embebible que
// hace falta para insertarla en un <iframe>. Los links de Whereby, Daily.co
// u otros servicios pensados para embeber ya vienen listos y se devuelven
// tal cual — solo YouTube necesita esta conversión.
function normalizarUrlTransmision(url) {
  if (!url) return url;
  const limpio = url.trim();
  try {
    const u = new URL(limpio);
    const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.slice(1);
      if (id) return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1`;
    }
    if (host === "youtube.com") {
      if (u.pathname === "/watch") {
        const id = u.searchParams.get("v");
        if (id) return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1`;
      }
      if (u.pathname.startsWith("/live/")) {
        const id = u.pathname.split("/")[2];
        if (id) return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1`;
      }
      // Ya viene en formato /embed/... u otro: se usa tal cual.
    }
    return limpio;
  } catch {
    // No es una URL valida: se devuelve tal cual para que la valide el que la pega.
    return limpio;
  }
}

// Estado actual de la transmision en vivo de la sala de crisis, guardado a
// nivel jornada (no depende de ningun equipo/sala en particular: es una
// unica señal que ve todo el mundo a la vez).
function getEstadoTransmision() {
  const jornada = db.prepare("SELECT * FROM jornada ORDER BY creado_en DESC LIMIT 1").get();
  return {
    activa: !!jornada?.transmision_activa,
    url: jornada?.transmision_url || null,
  };
}

// Estado del "escrutinio final": si ya cerraron todas las salas tematicas
// para las 5 provincias. Mientras no este todoCerrado, el panel publico
// sigue mostrando el tablero en vivo; una vez que lo esta, deja de
// mostrarlo y espera a que el admin publique el resultado final (ver
// server/routes/admin.js, /escrutinio/publicar).
function construirEstadoEscrutinio() {
  const jornada = db.prepare("SELECT * FROM jornada ORDER BY creado_en DESC LIMIT 1").get();
  const totalPasos = db.prepare("SELECT COUNT(*) as c FROM paso_recorrido").get().c;
  const pasosCerrados = db.prepare("SELECT COUNT(*) as c FROM paso_recorrido WHERE estado = 'cerrado'").get().c;

  const todoCerrado = totalPasos > 0 && pasosCerrados === totalPasos;

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
  construirLeaderboard,
  construirLeaderboardStaff,
  construirEstadoEscrutinio,
  normalizarUrlTransmision,
  getEstadoTransmision,
  CRISIS_TIPOS,
  getEvaluacionesTematicas,
  getEvaluacionesCrisis,
  calcularDesempeno,
  calcularPuntajeSugeridoBruto,
};
