const API = "";
let session = JSON.parse(localStorage.getItem("sep_admin_session") || "null");
let socket = null;
let lastOverview = null;

const $ = (id) => document.getElementById(id);

const NOMBRE_EJE = {
  imagen_positiva: "Imagen Positiva",
  intencion_voto: "Intención de Voto",
  gobernabilidad: "Gobernabilidad",
  salud_fiscal: "Salud Fiscal",
  orden_publico: "Orden Público",
};

function showMsg(text, type) {
  $("msg-area").innerHTML = `<div class="msg ${type}">${text}</div>`;
  setTimeout(() => { $("msg-area").innerHTML = ""; }, 5000);
}

function forzarLogout(motivo) {
  localStorage.removeItem("sep_admin_session");
  session = null;
  if (socket) { try { socket.disconnect(); } catch (e) {} }
  $("app-area").classList.add("hidden");
  $("login-card").classList.remove("hidden");
  $("btn-logout").style.display = "none";
  if (motivo) showMsg(motivo, "error");
}

async function api(path, opts = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
  if (session?.token) headers["Authorization"] = "Bearer " + session.token;
  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    forzarLogout("Tu sesión ya no es válida. Volvé a ingresar con usuario y contraseña.");
    throw new Error(data.error || "Sesión inválida.");
  }
  if (!res.ok) throw new Error(data.error || "Error de red");
  return data;
}

$("btn-login").addEventListener("click", async () => {
  const username = $("in-user").value.trim();
  const password = $("in-pass").value;
  try {
    const data = await api("/api/auth/staff/login", { method: "POST", body: JSON.stringify({ username, password }) });
    session = data;
    localStorage.setItem("sep_admin_session", JSON.stringify(session));
    iniciarApp();
  } catch (e) {
    showMsg(e.message, "error");
  }
});

$("btn-logout").addEventListener("click", () => {
  localStorage.removeItem("sep_admin_session");
  location.reload();
});

function iniciarApp() {
  $("login-card").classList.add("hidden");
  $("app-area").classList.remove("hidden");
  $("btn-logout").style.display = "inline-block";
  $("topbar-sub").textContent = `${session.usuario.nombre} — rol de staff: ${session.usuario.staff_rol}`;

  conectarSocket();
  cargarTodo();
}

function conectarSocket() {
  socket = io({ auth: { token: session.token } });
  [
    "paso:iniciado",
    "paso:cerrado",
    "crisis:iniciada",
    "crisis:cronometro_iniciado",
    "crisis:evaluada",
    "puntaje:ajustado",
    "equipo:rol_tomado",
    "escrutinio:guardado",
    "escrutinio:publicado",
    "escrutinio:despublicado",
  ].forEach((ev) => {
    socket.on(ev, () => cargarTodo());
  });
  // Tras un reinicio total (ver btn-reset-todo) los equipos/usuarios son
  // nuevos: la sesion actual (incluida la de quien disparo el reinicio) ya
  // no es valida, asi que la unica salida limpia es recargar la pagina.
  socket.on("app:reset", () => {
    showMsg("La jornada se reinició. Recargando…", "ok");
    setTimeout(() => location.reload(), 1000);
  });
}

async function resetearTodo() {
  const confirmado = confirm(
    "¿Reiniciar TODA la jornada?\n\nEsto borra el progreso de las 5 provincias, las decisiones tomadas, las salas de crisis disparadas/evaluadas y los ajustes manuales, y vuelve todo a cero.\n\nEsta acción no se puede deshacer."
  );
  if (!confirmado) return;
  try {
    await api("/api/admin/reiniciar", { method: "POST" });
    showMsg("Jornada reiniciada. Recargando todos los paneles…", "ok");
    setTimeout(() => location.reload(), 800);
  } catch (e) {
    showMsg(e.message, "error");
  }
}
$("btn-reset-todo").addEventListener("click", resetearTodo);

async function cargarTodo() {
  try {
    const overview = await api("/api/admin/overview");
    lastOverview = overview;
    renderCrisisControl(overview);
    renderOverview(overview);
    renderCrisisEval(overview);
    renderLeaderboard(overview.leaderboard);
    fillEquipoSelect(overview.equipos.map((e) => e.equipo));
    fillEjeSelect(overview.ejes);
  } catch (e) {
    showMsg(e.message, "error");
  }
  cargarEscrutinio();
}

// ---------------- ESCRUTINIO FINAL ----------------
async function cargarEscrutinio() {
  if (session.usuario.staff_rol !== "admin") {
    $("escrutinio-estado-msg").textContent = "Solo el admin puede cargar y publicar el resultado final.";
    $("escrutinio-form-area").innerHTML = "";
    return;
  }
  try {
    const data = await api("/api/admin/escrutinio");
    renderEscrutinio(data);
  } catch (e) {
    showMsg(e.message, "error");
  }
}

function renderEscrutinio(data) {
  const { equipos, estado } = data;

  $("escrutinio-estado-msg").textContent = estado.publicado
    ? `Resultado final publicado${estado.publicado_en ? " a las " + new Date(estado.publicado_en).toLocaleTimeString() : ""}. El panel público y las miniaturas de equipo ya lo están mostrando.`
    : estado.todo_cerrado
    ? "Todas las salas temáticas y de crisis están cerradas. Cargá los porcentajes y publicá cuando quieras."
    : "Todavía hay salas temáticas o de crisis sin cerrar. Podés dejar un borrador, pero no vas a poder publicar hasta que todo esté cerrado (mientras tanto el panel público sigue mostrando el tablero en vivo).";

  const filas = equipos
    .map(
      (e) => `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <strong style="min-width:230px">${e.codigo} — ${e.nombre}</strong>
        <input type="number" min="0" max="100" step="0.1" style="width:100px"
          data-equipo="${e.id}" class="escrutinio-input"
          value="${e.resultado_final_pct ?? ""}" ${estado.publicado ? "disabled" : ""} /> %
      </div>`
    )
    .join("");

  $("escrutinio-form-area").innerHTML = `
    ${filas}
    <p class="small-muted">Suma actual: <strong id="escrutinio-suma">0</strong>% (no hace falta que sea exactamente 100, pero suele ayudar)</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="secondary small" id="btn-escrutinio-guardar" ${estado.publicado ? "disabled" : ""}>Guardar borrador</button>
      <button class="danger" id="btn-escrutinio-publicar" ${estado.publicado || !estado.todo_cerrado ? "disabled" : ""}>🎉 Confirmar y publicar resultado final</button>
      ${estado.publicado ? '<button class="secondary small" id="btn-escrutinio-despublicar">Despublicar (corregir)</button>' : ""}
    </div>
  `;

  const inputs = Array.from(document.querySelectorAll(".escrutinio-input"));
  const actualizarSuma = () => {
    const suma = inputs.reduce((acc, inp) => acc + (Number(inp.value) || 0), 0);
    const sumaEl = $("escrutinio-suma");
    if (sumaEl) {
      sumaEl.textContent = suma.toFixed(1);
      sumaEl.style.color = Math.abs(suma - 100) < 0.5 ? "var(--blue-800)" : "#b23b3b";
    }
  };
  inputs.forEach((inp) => inp.addEventListener("input", actualizarSuma));
  actualizarSuma();

  const leerResultados = () => inputs.map((inp) => ({ equipo_id: inp.dataset.equipo, porcentaje: Number(inp.value) || 0 }));

  const btnGuardar = $("btn-escrutinio-guardar");
  if (btnGuardar) {
    btnGuardar.addEventListener("click", async () => {
      try {
        await api("/api/admin/escrutinio/guardar", { method: "POST", body: JSON.stringify({ resultados: leerResultados() }) });
        showMsg("Borrador guardado.", "ok");
      } catch (e) {
        showMsg(e.message, "error");
      }
    });
  }

  const btnPublicar = $("btn-escrutinio-publicar");
  if (btnPublicar) {
    btnPublicar.addEventListener("click", async () => {
      if (
        !confirm(
          "Esto va a mostrar el resultado final en la pantalla pública con la animación de conteo, y las provincias van a dejar de ver su marcador en vivo. ¿Confirmás?"
        )
      )
        return;
      try {
        await api("/api/admin/escrutinio/guardar", { method: "POST", body: JSON.stringify({ resultados: leerResultados() }) });
        await api("/api/admin/escrutinio/publicar", { method: "POST" });
        showMsg("Resultado final publicado.", "ok");
        cargarEscrutinio();
      } catch (e) {
        showMsg(e.message, "error");
      }
    });
  }

  const btnDespublicar = $("btn-escrutinio-despublicar");
  if (btnDespublicar) {
    btnDespublicar.addEventListener("click", async () => {
      if (!confirm("¿Volver a ocultar el resultado final para corregir algo?")) return;
      try {
        await api("/api/admin/escrutinio/despublicar", { method: "POST" });
        showMsg("Resultado despublicado. Podés corregir y volver a publicar.", "ok");
        cargarEscrutinio();
      } catch (e) {
        showMsg(e.message, "error");
      }
    });
  }
}

function renderCrisisControl(overview) {
  const puedeDisparar = session.usuario.staff_rol === "admin";
  $("crisis-control-area").innerHTML = overview.salas_crisis
    .map((s) => {
      const badge = s.disparada ? `<span class="badge cerrado">Ya disparada</span>` : `<span class="badge pendiente">Sin disparar</span>`;
      const boton = puedeDisparar
        ? `<button class="danger small" ${s.disparada ? "disabled" : ""} onclick="dispararCrisis('${s.sala_id}','${s.nombre.replace(/'/g, "")}')">🚨 Disparar</button>`
        : "";

      // El cronometro de 8 minutos de la pantalla completa del equipo se
      // arranca aparte del disparo, cuando el admin decida que arranca el
      // tiempo real (ver caso_critico leido en vivo).
      let cronometroHtml = "";
      if (puedeDisparar && s.disparada) {
        cronometroHtml = s.cronometro_iniciado_en
          ? `<span class="badge cerrado" id="cronometro-badge-${s.sala_id}">⏱️ ${formatCronometroRestante(s.cronometro_iniciado_en, s.duracion_segundos)}</span>`
          : `<button class="secondary small" onclick="iniciarCronometroCrisis('${s.sala_id}','${s.nombre.replace(/'/g, "")}')">⏱️ Iniciar cronómetro (8 min)</button>`;
      }

      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
        <strong style="min-width:260px">${s.nombre}</strong> ${badge} ${boton} ${cronometroHtml}
      </div>`;
    })
    .join("");

  iniciarTicksCronometrosAdmin(overview.salas_crisis);
}

function formatCronometroRestante(iniciadoEn, duracionSegundos) {
  const iniciado = new Date(iniciadoEn).getTime();
  const restanteMs = Math.max(0, iniciado + (duracionSegundos || 480) * 1000 - Date.now());
  const totalSeg = Math.ceil(restanteMs / 1000);
  const mm = String(Math.floor(totalSeg / 60)).padStart(2, "0");
  const ss = String(totalSeg % 60).padStart(2, "0");
  return totalSeg > 0 ? `${mm}:${ss} restantes` : "Tiempo agotado";
}

let cronometrosAdminInterval = null;
function iniciarTicksCronometrosAdmin(salasCrisis) {
  clearInterval(cronometrosAdminInterval);
  const activas = (salasCrisis || []).filter((s) => s.cronometro_iniciado_en);
  if (!activas.length) return;
  cronometrosAdminInterval = setInterval(() => {
    activas.forEach((s) => {
      const el = $(`cronometro-badge-${s.sala_id}`);
      if (el) el.textContent = `⏱️ ${formatCronometroRestante(s.cronometro_iniciado_en, s.duracion_segundos)}`;
    });
  }, 1000);
}

async function dispararCrisis(salaId, nombre) {
  if (!confirm(`¿Confirmás disparar "${nombre}" para las 5 provincias ahora mismo?`)) return;
  try {
    await api("/api/admin/crisis/disparar", { method: "POST", body: JSON.stringify({ sala_id: salaId }) });
    showMsg(`"${nombre}" disparada para las 5 provincias.`, "ok");
    cargarTodo();
  } catch (e) {
    showMsg(e.message, "error");
  }
}

async function iniciarCronometroCrisis(salaId, nombre) {
  if (
    !confirm(
      `¿Arrancar ahora el cronómetro de 8 minutos de "${nombre}"? Va a aparecer en la pantalla completa de cada equipo, que no pueden cerrar.`
    )
  )
    return;
  try {
    await api(`/api/admin/crisis/${salaId}/iniciar-cronometro`, { method: "POST" });
    showMsg(`Cronómetro de "${nombre}" iniciado.`, "ok");
    cargarTodo();
  } catch (e) {
    showMsg(e.message, "error");
  }
}

function renderOverview(overview) {
  const cont = $("equipos-overview");
  const esFacilitador = session.usuario.staff_rol === "facilitador";

  cont.innerHTML = overview.equipos
    .map((eq) => {
      const filas = eq.pasos
        .sort((a, b) => a.orden_index - b.orden_index)
        .map((p) => {
          const cart = p.cartelito_entrada ? `<span class="badge cartelito-${p.cartelito_entrada}">${p.cartelito_entrada}</span>` : "—";
          let acciones = "";
          if (p.estado === "pendiente") {
            acciones = `<button class="small" onclick="iniciarPaso('${p.paso_id}')">Iniciar</button>`;
          } else if (p.estado === "en_curso") {
            acciones = `<button class="small secondary" onclick="cerrarPasoModerado('${p.paso_id}')">Forzar cierre</button>`;
          }
          const decisionTxt = p.decision
            ? `${p.decision.opcion_codigo} — ${p.decision.opcion_etiqueta || ""}<br/><span class="small-muted">${formatEfectos(p.decision.efectos)}</span>`
            : "—";
          return `<tr>
            <td>${p.orden_index + 1}</td>
            <td>${p.sala_nombre}</td>
            <td><span class="badge ${p.estado}">${p.estado}</span></td>
            <td>${cart}</td>
            <td>${decisionTxt}</td>
            <td>${acciones}</td>
          </tr>`;
        })
        .join("");

      const jugadores = eq.jugadores.map((j) => `${j.rol_nombre}: ${j.nombre}`).join(" · ") || "acceso aún no utilizado";

      return `
        <h3>${eq.equipo.codigo} — ${eq.equipo.nombre}</h3>
        <p class="small-muted">${jugadores}</p>
        <table>
          <thead><tr><th>#</th><th>Sala</th><th>Estado</th><th>Cartelito</th><th>Decisión (efectos)</th><th>Acciones</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      `;
    })
    .join("<hr/>");
}

function formatEfectos(efectos) {
  if (!efectos || !Object.keys(efectos).length) return "";
  return Object.entries(efectos)
    .map(([k, v]) => `${NOMBRE_EJE[k] || k} ${v > 0 ? "+" : ""}${v}`)
    .join(" · ");
}

async function iniciarPaso(pasoId) {
  try {
    await api(`/api/admin/paso/${pasoId}/iniciar`, { method: "POST" });
    showMsg("Sala iniciada.", "ok");
    cargarTodo();
  } catch (e) {
    showMsg(e.message, "error");
  }
}

async function cerrarPasoModerado(pasoId) {
  const opcion = prompt("Cierre forzado: ingresá el código de opción elegida en nombre del equipo (A, B o C). Dejalo vacío para cerrar sin decisión.");
  if (opcion === null) return;
  try {
    await api(`/api/admin/paso/${pasoId}/cerrar`, { method: "POST", body: JSON.stringify({ opcion_codigo: opcion.trim().toUpperCase() || undefined }) });
    showMsg("Sala cerrada por moderación.", "ok");
    cargarTodo();
  } catch (e) {
    showMsg(e.message, "error");
  }
}

function renderCrisisEval(overview) {
  const puedeEvaluar = session.usuario.staff_rol === "admin" || session.usuario.staff_rol === "jurado";
  const salasDisparadas = overview.salas_crisis.filter((s) => s.disparada);
  if (!salasDisparadas.length) {
    $("crisis-eval-area").innerHTML = `<p class="small-muted">Se dispara una sala de crisis para cargar evaluaciones.</p>`;
    return;
  }
  if (!puedeEvaluar) {
    $("crisis-eval-area").innerHTML = `<p class="small-muted">Solo el jurado o el admin pueden cargar esta evaluación.</p>`;
    return;
  }
  $("crisis-eval-area").innerHTML = salasDisparadas
    .map((sala) => {
      const filas = overview.equipos
        .map((eq) => {
          const evalRow = eq.evaluaciones_crisis.find((c) => c.sala_slug === sala.slug);
          const ev = evalRow?.evaluacion || {};
          const yaEvaluado = !!evalRow?.evaluacion;
          return `
          <h4>${eq.equipo.codigo} — ${eq.equipo.nombre}</h4>
          <form class="grid" style="grid-template-columns: repeat(5, 1fr); align-items:end" onsubmit="return guardarEvalCrisis(event, '${eq.equipo.id}', '${sala.sala_id}')">
            <div><label>Claridad (1-5)</label><input type="number" min="1" max="5" name="claridad" value="${ev.claridad ?? ""}" ${yaEvaluado ? "disabled" : ""} required /></div>
            <div><label>Manejo incertidumbre</label><input type="number" min="1" max="5" name="manejo_incertidumbre" value="${ev.manejo_incertidumbre ?? ""}" ${yaEvaluado ? "disabled" : ""} required /></div>
            <div><label>Coherencia</label><input type="number" min="1" max="5" name="coherencia" value="${ev.coherencia ?? ""}" ${yaEvaluado ? "disabled" : ""} required /></div>
            <div><label>Control bajo presión</label><input type="number" min="1" max="5" name="control_presion" value="${ev.control_presion ?? ""}" ${yaEvaluado ? "disabled" : ""} required /></div>
            <div>${yaEvaluado ? '<span class="badge cerrado">Evaluada</span>' : '<button type="submit" class="small">Guardar</button>'}</div>
            <div style="grid-column: 1 / -1"><label>Comentario</label><input name="comentario" value="${ev.comentario ?? ""}" ${yaEvaluado ? "disabled" : ""} /></div>
          </form>`;
        })
        .join("<hr/>");
      return `<h3>${sala.nombre}</h3>${filas}`;
    })
    .join("<hr/>");
}

async function guardarEvalCrisis(ev, equipoId, salaId) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const body = { equipo_id: equipoId, sala_id: salaId };
  for (const [k, v] of fd.entries()) body[k] = ["claridad", "manejo_incertidumbre", "coherencia", "control_presion"].includes(k) ? Number(v) : v;
  try {
    const r = await api("/api/admin/crisis/evaluar", { method: "POST", body: JSON.stringify(body) });
    showMsg(`Evaluación guardada. Impacto en Imagen Positiva: ${r.puntos > 0 ? "+" : ""}${r.puntos}.`, "ok");
    cargarTodo();
  } catch (e) {
    showMsg(e.message, "error");
  }
  return false;
}

function fillEquipoSelect(equipos) {
  const sel = $("ajuste-equipo");
  if (sel.dataset.filled === "1") return;
  sel.innerHTML = equipos.map((e) => `<option value="${e.id}">${e.codigo} — ${e.nombre}</option>`).join("");
  sel.dataset.filled = "1";
}

function fillEjeSelect(ejes) {
  const sel = $("ajuste-eje");
  if (sel.dataset.filled === "1") return;
  sel.innerHTML = (ejes || []).map((e) => `<option value="${e.slug}">${e.nombre}</option>`).join("");
  sel.dataset.filled = "1";
}

$("form-puntaje").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const equipo_id = $("ajuste-equipo").value;
  const eje = $("ajuste-eje").value;
  const puntos = Number($("ajuste-puntos").value);
  const motivo = $("ajuste-motivo").value;
  try {
    await api("/api/admin/puntaje/ajustar", { method: "POST", body: JSON.stringify({ equipo_id, eje, puntos, motivo }) });
    showMsg("Ajuste aplicado.", "ok");
    $("ajuste-motivo").value = "";
    $("ajuste-puntos").value = "";
    cargarTodo();
  } catch (e) {
    showMsg(e.message, "error");
  }
});

function renderLeaderboard(tabla) {
  $("tabla-leaderboard").innerHTML = tabla
    .map(
      (row, i) => `<tr class="${i === 0 ? "leader-row-1" : ""}">
        <td>${i + 1}</td>
        <td>${row.codigo} — ${row.nombre}</td>
        <td><strong>${row.ejes.imagen_positiva}</strong></td>
        <td>${row.ejes.intencion_voto}</td>
        <td>${row.ejes.gobernabilidad}</td>
        <td>${row.ejes.salud_fiscal}</td>
        <td>${row.ejes.orden_publico}</td>
        <td>${row.salas_completadas} / 5</td>
      </tr>`
    )
    .join("");
}

if (session?.token) iniciarApp();
