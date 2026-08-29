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

  conectarSocket();
  cargarTodo();
}

function conectarSocket() {
  socket = io({ auth: { token: session.token } });
  ["paso:iniciado", "paso:cerrado", "crisis:iniciada", "crisis:evaluada", "puntaje:ajustado", "equipo:rol_tomado"].forEach((ev) => {
    socket.on(ev, () => cargarTodo());
  });
}

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
}

function renderCrisisControl(overview) {
  const puedeDisparar = session.usuario.staff_rol === "admin";
  $("crisis-control-area").innerHTML = overview.salas_crisis
    .map((s) => {
      const badge = s.disparada ? `<span class="badge cerrado">Ya disparada</span>` : `<span class="badge pendiente">Sin disparar</span>`;
      const boton = puedeDisparar
        ? `<button class="danger small" ${s.disparada ? "disabled" : ""} onclick="dispararCrisis('${s.sala_id}','${s.nombre.replace(/'/g, "")}')">🚨 Disparar</button>`
        : "";
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <strong style="min-width:260px">${s.nombre}</strong> ${badge} ${boton}
      </div>`;
    })
    .join("");
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
