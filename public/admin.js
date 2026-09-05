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
  desempeno: "Desempeño",
};

const NOMBRE_SALA_TEMATICA = {
  economia: "Economía",
  desarrollo_social: "Desarrollo Social",
  seguridad: "Seguridad",
  crisis_interna: "Crisis Interna",
  salud: "Salud",
};
const ORDEN_SALAS_TEMATICAS = ["economia", "desarrollo_social", "seguridad", "crisis_interna", "salud"];

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
    "rotacion:iniciada_todos",
    "puntaje:ajustado",
    "equipo:rol_tomado",
    "escrutinio:guardado",
    "escrutinio:publicado",
    "escrutinio:despublicado",
    "transmision:actualizada",
    "evaluacion:actualizada",
    "equipo:conexion_cambio",
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
    "¿Reiniciar TODA la jornada?\n\nEsto borra el progreso de las 5 provincias, las decisiones tomadas y los ajustes manuales, y vuelve todo a cero.\n\nEsta acción no se puede deshacer."
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
    renderRotacionControl(overview);
    renderTransmisionControl(overview);
    renderOverview(overview);
    renderLeaderboard(overview.leaderboard);
    renderSugerido(overview.leaderboard);
    fillEquipoSelect(overview.equipos.map((e) => e.equipo));
    fillEjeSelect(overview.ejes);
    fillEvaluacionEquipoSelect(overview.equipos.map((e) => e.equipo));
    renderEvaluacionForm();
  } catch (e) {
    showMsg(e.message, "error");
  }
  cargarEscrutinio();
}

// ---------------- EVALUACIÓN DE DESEMPEÑO (1 a 5) ----------------
function fillEvaluacionEquipoSelect(equipos) {
  const sel = $("evaluacion-equipo");
  if (sel.dataset.filled === "1") return;
  sel.innerHTML = equipos.map((e) => `<option value="${e.id}">${e.codigo} — ${e.nombre}</option>`).join("");
  sel.dataset.filled = "1";
  sel.addEventListener("change", renderEvaluacionForm);
}

function selectNota(name, valorActual) {
  const opciones = ["", "1", "2", "3", "4", "5"]
    .map((v) => `<option value="${v}" ${String(valorActual ?? "") === v ? "selected" : ""}>${v === "" ? "— sin nota —" : v}</option>`)
    .join("");
  return `<select data-nota="${name}" style="width:110px;display:inline-block">${opciones}</select>`;
}

function renderEvaluacionForm() {
  if (!lastOverview) return;
  const equipoId = $("evaluacion-equipo").value;
  const eq = lastOverview.equipos.find((e) => e.equipo.id === equipoId);
  const area = $("evaluacion-form-area");
  if (!eq) {
    area.innerHTML = "";
    return;
  }
  const puedeTematica = session.usuario.staff_rol === "admin" || session.usuario.staff_rol === "facilitador";
  const puedeCrisis = session.usuario.staff_rol === "admin" || session.usuario.staff_rol === "jurado";

  const filasTematicas = ORDEN_SALAS_TEMATICAS.map((slug) => {
    const val = eq.evaluaciones_tematicas ? eq.evaluaciones_tematicas[slug] : null;
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <strong style="min-width:180px">${NOMBRE_SALA_TEMATICA[slug]}</strong>
      ${selectNota(`tematica:${slug}`, val)}
    </div>`;
  }).join("");

  const filasCrisis = (lastOverview.crisis_tipos || [])
    .map((c) => {
      const val = (eq.evaluaciones_crisis && eq.evaluaciones_crisis[c.slug]) || {};
      return `<div style="margin-bottom:12px">
        <strong>${c.nombre}</strong> <span class="small-muted">(se convoca a: ${c.rol})</span>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:6px">
          <label style="margin:0">Coherencia ${selectNota(`crisis:${c.slug}:coherencia`, val.coherencia)}</label>
          <label style="margin:0">Oratoria ${selectNota(`crisis:${c.slug}:oratoria`, val.oratoria)}</label>
          <label style="margin:0">Manejo de los nervios ${selectNota(`crisis:${c.slug}:manejo_nervios`, val.manejo_nervios)}</label>
        </div>
      </div>`;
    })
    .join("");

  area.innerHTML = `
    <h3>Salas temáticas</h3>
    ${puedeTematica ? filasTematicas : '<p class="small-muted">Solo el admin o el facilitador de cada sala pueden cargar esta nota.</p>'}
    <h3 style="margin-top:16px">Crisis presenciales (jurado)</h3>
    ${puedeCrisis ? filasCrisis : '<p class="small-muted">Solo el admin o el jurado pueden cargar esta nota.</p>'}
  `;

  area.querySelectorAll("select[data-nota]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const [tipo, a, b] = sel.dataset.nota.split(":");
      const valor = sel.value ? Number(sel.value) : null;
      try {
        if (tipo === "tematica") {
          if (valor == null) return; // no hay endpoint para "borrar" una nota; solo se puede cargar 1-5
          await api("/api/admin/evaluacion/tematica", {
            method: "POST",
            body: JSON.stringify({ equipo_id: equipoId, sala_slug: a, puntaje: valor }),
          });
        } else {
          const crisisSlug = a;
          const criterio = b;
          const actual = (eq.evaluaciones_crisis && eq.evaluaciones_crisis[crisisSlug]) || {};
          const payload = { equipo_id: equipoId, crisis_slug: crisisSlug, ...actual };
          payload[criterio] = valor;
          await api("/api/admin/evaluacion/crisis", { method: "POST", body: JSON.stringify(payload) });
        }
        showMsg("Nota guardada.", "ok");
        cargarTodo();
      } catch (e) {
        showMsg(e.message, "error");
      }
    });
  });
}

function renderSugerido(tabla) {
  const el = $("tabla-sugerido");
  if (!el) return;
  el.innerHTML = tabla
    .map(
      (row) => `<tr>
        <td>${row.codigo} — ${row.nombre}</td>
        <td>${row.desempeno == null ? '<span class="small-muted">sin evaluar</span>' : row.desempeno}</td>
        <td>${row.porcentaje_sugerido == null ? "—" : `<span class="chip-sugerido">${row.porcentaje_sugerido}%</span>`}</td>
      </tr>`
    )
    .join("");
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
    ? "Todas las salas temáticas están cerradas. Cargá los porcentajes y publicá cuando quieras."
    : "Todavía hay salas temáticas sin cerrar. Podés dejar un borrador, pero no vas a poder publicar hasta que todo esté cerrado (mientras tanto el panel público sigue mostrando el tablero en vivo).";

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

// ---------------- DISPARO MASIVO POR POSICIÓN DE SALA (rotación) ----------------
// Un botón por posición (Sala 1 a Sala 5): inicia, para las 5 provincias a
// la vez, la sala que le toca a cada una en esa posición de SU recorrido
// (que está rotado, así que puede ser una sala temática distinta por
// provincia). El control individual por provincia sigue disponible en la
// tabla de "Estado de los equipos" más abajo.
function renderRotacionControl(overview) {
  const puedeDisparar = session.usuario.staff_rol === "admin";
  if (!puedeDisparar) {
    $("rotacion-control-area").innerHTML = `<p class="small-muted">Solo el admin puede disparar salas para todas las provincias a la vez.</p>`;
    return;
  }
  const botones = [0, 1, 2, 3, 4]
    .map((i) => `<button onclick="dispararRotacion(${i})">🚀 Disparar Sala ${i + 1} (todas las provincias)</button>`)
    .join("");
  $("rotacion-control-area").innerHTML = botones;
}

async function dispararRotacion(ordenIndex) {
  if (!confirm(`¿Iniciar la Sala ${ordenIndex + 1} para las 5 provincias al mismo tiempo?`)) return;
  try {
    const r = await api(`/api/admin/rotacion/${ordenIndex}/iniciar-todos`, { method: "POST" });
    const saltadosTxt = r.saltados.length ? ` (${r.saltados.length} ya estaban iniciadas o cerradas)` : "";
    showMsg(`Sala ${ordenIndex + 1} iniciada para ${r.iniciados} provincia(s)${saltadosTxt}.`, "ok");
    cargarTodo();
  } catch (e) {
    showMsg(e.message, "error");
  }
}

// ---------------- TRANSMISIÓN EN VIVO DE LA SALA DE CRISIS ----------------
// Una única señal (una cámara, un orador a la vez) que se publica/corta a
// mano desde acá: no hay detección automática de "quién está hablando".
function renderTransmisionControl(overview) {
  const t = overview.transmision || { activa: false, url: null };
  const input = $("in-transmision-url");
  // Solo se precarga el input si está vacío, para no pisar lo que el admin
  // esté escribiendo en ese momento (por ejemplo, el próximo link a pegar).
  if (input && !input.value && t.url) input.value = t.url;

  $("transmision-estado-msg").innerHTML = t.activa
    ? `<span class="badge cerrado">🔴 EN VIVO</span> se está viendo en los 5 equipos y en la pantalla pública.`
    : t.url
    ? `<span class="badge pendiente">Cortada</span> el último link sigue guardado, listo para republicar.`
    : `<span class="badge pendiente">Sin transmisión</span> todavía no se publicó ningún link.`;
}

async function publicarTransmision() {
  const url = $("in-transmision-url").value.trim();
  if (!url) return showMsg("Pegá primero el link de la transmisión.", "error");
  try {
    await api("/api/admin/transmision/publicar", { method: "POST", body: JSON.stringify({ url }) });
    showMsg("Transmisión publicada para los 5 equipos y la pantalla pública.", "ok");
    cargarTodo();
  } catch (e) {
    showMsg(e.message, "error");
  }
}
$("btn-transmision-publicar").addEventListener("click", publicarTransmision);

async function cortarTransmision() {
  try {
    await api("/api/admin/transmision/cortar", { method: "POST" });
    showMsg("Transmisión cortada.", "ok");
    cargarTodo();
  } catch (e) {
    showMsg(e.message, "error");
  }
}
$("btn-transmision-cortar").addEventListener("click", cortarTransmision);

function renderOverview(overview) {
  const cont = $("equipos-overview");
  const esFacilitador = session.usuario.staff_rol === "facilitador";

  const conectadas = overview.equipos.filter((eq) => eq.conectado).length;
  const resumenConexion = `<p class="small-muted" style="margin-bottom:14px">
    <strong>${conectadas} / ${overview.equipos.length}</strong> provincias con el panel de equipo conectado ahora mismo.
  </p>`;

  cont.innerHTML = resumenConexion + overview.equipos
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
      const badgeConexion = eq.conectado
        ? `<span class="badge conectado">🟢 conectada</span>`
        : `<span class="badge desconectado">⚪ sin conectar</span>`;

      return `
        <h3>${eq.equipo.codigo} — ${eq.equipo.nombre} ${badgeConexion}</h3>
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
        <td>${row.desempeno == null ? "—" : row.desempeno}</td>
        <td>${row.ejes.gobernabilidad}</td>
        <td>${row.ejes.salud_fiscal}</td>
        <td>${row.ejes.orden_publico}</td>
        <td>${row.salas_completadas} / 5</td>
      </tr>`
    )
    .join("");
}

if (session?.token) iniciarApp();
