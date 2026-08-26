const API = "";
let session = JSON.parse(localStorage.getItem("sep_admin_session") || "null");
let socket = null;
let lastOverview = null;

const $ = (id) => document.getElementById(id);

function showMsg(text, type) {
  $("msg-area").innerHTML = `<div class="msg ${type}">${text}</div>`;
  setTimeout(() => { $("msg-area").innerHTML = ""; }, 5000);
}

async function api(path, opts = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
  if (session?.token) headers["Authorization"] = "Bearer " + session.token;
  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
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

  if (session.usuario.staff_rol !== "admin") {
    $("btn-crisis").style.display = "none";
  }

  conectarSocket();
  cargarTodo();
}

function conectarSocket() {
  socket = io({ auth: { token: session.token } });
  ["paso:iniciado", "paso:cerrado", "crisis:iniciada", "crisis:evaluada", "congreso:actualizado", "puntaje:ajustado", "equipo:rol_tomado"].forEach((ev) => {
    socket.on(ev, () => cargarTodo());
  });
}

async function cargarTodo() {
  try {
    const overview = await api("/api/admin/overview");
    lastOverview = overview;
    renderOverview(overview);
    renderCrisisBadge(overview.crisis_disparada);
    renderCrisisEval(overview);
    renderLeaderboard(overview.leaderboard);
    fillEquipoSelect(overview.equipos.map((e) => e.equipo));
    if (overview.crisis_disparada || overview.equipos.some((e) => e.pasos.every((p) => p.sala_tipo === "crisis" || p.estado === "cerrado"))) {
      cargarCongreso();
    } else {
      $("congreso-area").innerHTML = `<p class="small-muted">Los proyectos de ley aparecen acá a medida que los equipos los van entregando.</p>`;
      cargarCongreso();
    }
  } catch (e) {
    showMsg(e.message, "error");
  }
}

function renderCrisisBadge(disparada) {
  $("crisis-estado-badge").innerHTML = disparada
    ? ` <span class="badge cerrado">Ya disparada</span>`
    : ` <span class="badge pendiente">Sin disparar</span>`;
  $("btn-crisis").disabled = disparada;
}

$("btn-crisis").addEventListener("click", async () => {
  if (!confirm("¿Confirmás disparar la Sala 6 para los 5 equipos ahora mismo?")) return;
  try {
    await api("/api/admin/crisis/disparar", { method: "POST" });
    showMsg("Sala 6 disparada para los 5 equipos.", "ok");
    cargarTodo();
  } catch (e) {
    showMsg(e.message, "error");
  }
});

function renderOverview(overview) {
  const cont = $("equipos-overview");
  const esFacilitador = session.usuario.staff_rol === "facilitador";
  const salaAsignada = session.usuario.sala_asignada_id;

  cont.innerHTML = overview.equipos
    .map((eq) => {
      const filas = eq.pasos
        .sort((a, b) => a.orden_index - b.orden_index)
        .map((p) => {
          const puedeOperar = !esFacilitador || p.sala_tipo === "crisis"; // facilitador: solo su sala (chequeo real en backend)
          const cart = p.cartelito_entrada ? `<span class="badge cartelito-${p.cartelito_entrada}">${p.cartelito_entrada}</span>` : "—";
          const label = p.sala_tipo === "crisis" ? "Sala 6" : p.orden_index + 1;
          let acciones = "";
          if (p.sala_tipo !== "crisis") {
            if (p.estado === "pendiente") {
              acciones = `<button class="small" onclick="iniciarPaso('${p.paso_id}')">Iniciar</button>`;
            } else if (p.estado === "en_curso") {
              acciones = `<button class="small secondary" onclick="cerrarPasoModerado('${p.paso_id}')">Forzar cierre</button>`;
            }
          }
          return `<tr>
            <td>${label}</td>
            <td>${p.sala_nombre}</td>
            <td><span class="badge ${p.estado}">${p.estado}</span></td>
            <td>${cart}</td>
            <td>${p.decision || "—"}</td>
            <td>${p.proyecto_entregado ? "✅ " + (p.proyecto_nombre || "") : "—"}</td>
            <td>${acciones}</td>
          </tr>`;
        })
        .join("");

      const jugadores = eq.jugadores.map((j) => `${j.rol_nombre}: ${j.nombre}`).join(" · ") || "sin jugadores logueados aún";

      return `
        <h3>${eq.equipo.codigo} — ${eq.equipo.nombre}</h3>
        <p class="small-muted">${jugadores}</p>
        <table>
          <thead><tr><th>#</th><th>Sala</th><th>Estado</th><th>Cartelito</th><th>Decisión</th><th>Proyecto</th><th>Acciones</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      `;
    })
    .join("<hr/>");
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
  if (!confirm("Esto fuerza el cierre de la sala sin pasar por el formulario del equipo. ¿Continuar?")) return;
  try {
    await api(`/api/admin/paso/${pasoId}/cerrar`, { method: "POST", body: JSON.stringify({}) });
    showMsg("Sala cerrada por moderación.", "ok");
    cargarTodo();
  } catch (e) {
    showMsg(e.message, "error");
  }
}

function renderCrisisEval(overview) {
  const puedeEvaluar = session.usuario.staff_rol === "admin" || session.usuario.staff_rol === "jurado";
  if (!overview.crisis_disparada) {
    $("crisis-eval-area").innerHTML = `<p class="small-muted">Se dispara la Sala 6 para cargar evaluaciones.</p>`;
    return;
  }
  if (!puedeEvaluar) {
    $("crisis-eval-area").innerHTML = `<p class="small-muted">Solo el jurado o el admin pueden cargar esta evaluación.</p>`;
    return;
  }
  $("crisis-eval-area").innerHTML = overview.equipos
    .map((eq) => {
      const ev = eq.evaluacion_crisis || {};
      return `
      <h3>${eq.equipo.codigo} — ${eq.equipo.nombre}</h3>
      <form class="grid" style="grid-template-columns: repeat(5, 1fr); align-items:end" onsubmit="return guardarEvalCrisis(event, '${eq.equipo.id}')">
        <div><label>Claridad (1-5)</label><input type="number" min="1" max="5" name="claridad" value="${ev.claridad ?? ""}" /></div>
        <div><label>Manejo incertidumbre</label><input type="number" min="1" max="5" name="manejo_incertidumbre" value="${ev.manejo_incertidumbre ?? ""}" /></div>
        <div><label>Coherencia</label><input type="number" min="1" max="5" name="coherencia" value="${ev.coherencia ?? ""}" /></div>
        <div><label>Control bajo presión</label><input type="number" min="1" max="5" name="control_presion" value="${ev.control_presion ?? ""}" /></div>
        <div><button type="submit" class="small">Guardar</button></div>
        <div style="grid-column: 1 / -1"><label>Comentario</label><input name="comentario" value="${ev.comentario ?? ""}" /></div>
      </form>`;
    })
    .join("<hr/>");
}

async function guardarEvalCrisis(ev, equipoId) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const body = { equipo_id: equipoId };
  for (const [k, v] of fd.entries()) body[k] = ["claridad","manejo_incertidumbre","coherencia","control_presion"].includes(k) ? Number(v) : v;
  try {
    await api("/api/admin/crisis/evaluar", { method: "POST", body: JSON.stringify(body) });
    showMsg("Evaluación guardada.", "ok");
  } catch (e) {
    showMsg(e.message, "error");
  }
  return false;
}

async function cargarCongreso() {
  try {
    const proyectos = await api("/api/admin/congreso/proyectos");
    const esAdmin = session.usuario.staff_rol === "admin";
    if (!proyectos.length) {
      $("congreso-area").innerHTML = `<p class="small-muted">Todavía no hay proyectos de ley entregados.</p>`;
      return;
    }
    $("congreso-area").innerHTML = `
      <table>
        <thead><tr><th>Equipo</th><th>Sala</th><th>Proyecto</th><th>Resultado</th>${esAdmin ? "<th>Acción</th>" : ""}</tr></thead>
        <tbody>
          ${proyectos
            .map(
              (p) => `<tr>
                <td>${p.equipo_codigo}</td>
                <td>${p.sala_nombre}</td>
                <td><strong>${p.nombre_proyecto}</strong><br/><span class="small-muted">${p.alcance_texto}</span></td>
                <td>${p.resultado_congreso ? `<span class="badge cerrado">${p.resultado_congreso}</span>` : `<span class="badge pendiente">pendiente</span>`}</td>
                ${
                  esAdmin
                    ? `<td>
                        <button class="small" onclick="votarProyecto('${p.proyecto_ley_id}','aprobado')">Aprobar</button>
                        <button class="small secondary" onclick="votarProyecto('${p.proyecto_ley_id}','modificado')">Modificado</button>
                        <button class="small danger" onclick="votarProyecto('${p.proyecto_ley_id}','rechazado')">Rechazar</button>
                      </td>`
                    : ""
                }
              </tr>`
            )
            .join("")}
        </tbody>
      </table>`;
  } catch (e) {
    showMsg(e.message, "error");
  }
}

async function votarProyecto(proyectoId, resultado) {
  try {
    await api("/api/admin/congreso/votar", { method: "POST", body: JSON.stringify({ proyecto_ley_id: proyectoId, resultado }) });
    showMsg(`Proyecto marcado como ${resultado}.`, "ok");
    cargarTodo();
  } catch (e) {
    showMsg(e.message, "error");
  }
}

function fillEquipoSelect(equipos) {
  const sel = $("ajuste-equipo");
  if (sel.dataset.filled === "1") return;
  sel.innerHTML = equipos.map((e) => `<option value="${e.id}">${e.codigo} — ${e.nombre}</option>`).join("");
  sel.dataset.filled = "1";
}

$("form-puntaje").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const equipo_id = $("ajuste-equipo").value;
  const puntos = Number($("ajuste-puntos").value);
  const motivo = $("ajuste-motivo").value;
  try {
    await api("/api/admin/puntaje/ajustar", { method: "POST", body: JSON.stringify({ equipo_id, puntos, motivo }) });
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
        <td>${row.leyes_aprobadas}</td>
        <td>${row.ajustes_manuales}</td>
        <td>${row.puntaje_total}</td>
        <td>${row.salas_completadas} / 5</td>
      </tr>`
    )
    .join("");
}

if (session?.token) iniciarApp();
