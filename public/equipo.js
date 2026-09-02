const API = "";
let session = JSON.parse(localStorage.getItem("sep_equipo_session") || "null");
let socket = null;

const $ = (id) => document.getElementById(id);

function showMsg(text, type) {
  $("msg-area").innerHTML = `<div class="msg ${type}">${text}</div>`;
  setTimeout(() => { $("msg-area").innerHTML = ""; }, 5000);
}

function forzarLogout(motivo) {
  localStorage.removeItem("sep_equipo_session");
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
  if (res.status === 401 || (res.status === 404 && /equipo no encontrado/i.test(data.error || ""))) {
    forzarLogout("Tu sesión ya no es válida (se reinició la jornada). Volvé a ingresar con el código y PIN.");
    throw new Error(data.error || "Sesión inválida.");
  }
  if (!res.ok) throw new Error(data.error || "Error de red");
  return data;
}

// ---------------- LOGIN ----------------
// Acceso único por equipo (código + PIN), sin selección de rol: el token
// siempre queda a nombre del/la Jefe/a de Gabinete, que administra el panel.
$("btn-login").addEventListener("click", async () => {
  const codigo = $("in-codigo").value.trim();
  const pin = $("in-pin").value.trim();
  const nombre = $("in-nombre").value.trim();
  if (!codigo || !pin) return showMsg("Completá código de provincia y PIN.", "error");
  try {
    const data = await api("/api/auth/equipo/login", {
      method: "POST",
      body: JSON.stringify({ codigo, pin, nombre }),
    });
    session = data;
    localStorage.setItem("sep_equipo_session", JSON.stringify(session));
    iniciarApp();
  } catch (e) {
    showMsg(e.message, "error");
  }
});

$("btn-logout").addEventListener("click", () => {
  localStorage.removeItem("sep_equipo_session");
  location.reload();
});

// ---------------- APP ----------------
function iniciarApp() {
  $("login-card").classList.add("hidden");
  $("app-area").classList.remove("hidden");
  $("btn-logout").style.display = "inline-block";
  $("topbar-sub").textContent = `${session.equipo.nombre} — ${session.rol.nombre}`;
  conectarSocket();
  cargarEstado();
  cargarMiniTablero();
  setInterval(cargarMiniTablero, 15000); // respaldo por si se pierde el socket
}

function conectarSocket() {
  socket = io({ auth: { token: session.token } });
  socket.on("estado:actualizado", cargarEstado);
  socket.on("crisis:iniciada", (payload) => {
    showMsg(`🚨 ${payload?.mensaje || "Se disparó una sala de crisis."}`, "ok");
    cargarEstado();
  });
  // El cronometro de 8 minutos de la sala de crisis lo arranca el admin de
  // forma remota, aparte del disparo: hay que refrescar el estado para que
  // la pantalla completa empiece a contar.
  socket.on("crisis:cronometro_iniciado", cargarEstado);
  // Cuando el jurado evalúa esta sala de crisis para este equipo, hay que
  // refrescar el estado para que la pantalla completa no cerrable se oculte
  // sola (ver renderCrisisOverlay: se muestra mientras disparada && !evaluada).
  socket.on("crisis:evaluada", cargarEstado);
  // El equipo también recibe las actualizaciones del panel público para
  // mantener su propia miniatura del contador en vivo.
  socket.on("leaderboard:actualizado", cargarMiniTablero);
  socket.on("escrutinio:publicado", cargarMiniTablero);
  socket.on("escrutinio:despublicado", cargarMiniTablero);
  // Tras un reinicio total desde el panel de administracion, esta provincia
  // ya no existe con el mismo id: recargar vuelve a mostrar el login.
  socket.on("app:reset", () => {
    showMsg("La jornada se reinició. Recargando…", "ok");
    setTimeout(() => location.reload(), 1000);
  });
}

const NOMBRE_EJE_MINI = {
  imagen_positiva: "Imagen Positiva",
  intencion_voto: "Intención de Voto",
  gobernabilidad: "Gobernabilidad",
  salud_fiscal: "Salud Fiscal",
  orden_publico: "Orden Público",
};
const ORDEN_EJES = ["imagen_positiva", "intencion_voto", "gobernabilidad", "salud_fiscal", "orden_publico"];

// ---------------- MINIATURA DEL TABLERO PÚBLICO ----------------
async function cargarMiniTablero() {
  try {
    const res = await fetch("/api/public/leaderboard");
    const data = await res.json();
    const el = $("mini-tablero");
    if (!el) return;

    const escrutinio = data.escrutinio || { todo_cerrado: false, publicado: false };

    if (escrutinio.publicado) {
      const resultado = (escrutinio.resultados || []).find((r) => r.codigo === session.equipo.codigo);
      const pct = resultado?.porcentaje ?? 0;
      el.innerHTML = `
        <div class="eje-barra principal">
          <div class="eje-label"><span>Resultado final</span><span>${pct.toFixed(1)}%</span></div>
          <div class="eje-track"><div class="eje-fill" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>
        </div>`;
      return;
    }

    if (escrutinio.todo_cerrado) {
      el.innerHTML = `<p class="small-muted">🗳️ Todas las salas cerraron. Aguardando el escrutinio final de los organizadores…</p>`;
      return;
    }

    const propia = (data.leaderboard || []).find((row) => row.codigo === session.equipo.codigo);
    if (!propia) return;
    el.innerHTML = ORDEN_EJES.map((slug) => {
      const valor = propia.ejes[slug];
      const principal = slug === "imagen_positiva" ? " principal" : "";
      const v = Math.max(0, Math.min(100, valor));
      return `
        <div class="eje-barra${principal}">
          <div class="eje-label"><span>${NOMBRE_EJE_MINI[slug]}</span><span>${valor}</span></div>
          <div class="eje-track"><div class="eje-fill" style="width:${v}%"></div></div>
        </div>`;
    }).join("");
  } catch (e) {
    // Si falla, se deja el último valor renderizado; no interrumpe el resto del panel.
  }
}

async function cargarEstado() {
  try {
    const data = await api("/api/team/estado");
    render(data);
  } catch (e) {
    showMsg(e.message, "error");
  }
}

const NOMBRE_EJE = {
  imagen_positiva: "Imagen Positiva",
  intencion_voto: "Intención de Voto",
  gobernabilidad: "Gobernabilidad",
  salud_fiscal: "Salud Fiscal",
  orden_publico: "Orden Público",
};

function render(data) {
  $("equipo-nombre").textContent = `${data.equipo.codigo} — ${data.equipo.nombre}`;
  $("equipo-contexto").textContent = data.equipo.contexto_arranque;
  $("equipo-tension").textContent = data.equipo.tension_interna;
  $("equipo-objetivos").innerHTML = data.equipo.objetivos_generales.map((o) => `<li>${o}</li>`).join("");
  $("objetivo-secreto").textContent = data.mi_rol?.objetivo_secreto || "—";

  const pasos = data.pasos;

  // Salas de crisis disparadas y pendientes de jugar/evaluar
  const crisisDisparadas = (data.crisis || []).filter((c) => c.disparada);
  if (crisisDisparadas.length) {
    $("crisis-card").style.display = "block";
    $("crisis-texto").innerHTML = crisisDisparadas
      .map(
        (c) => `
        <div class="msg ${c.evaluada ? "ok" : "error"}" style="margin-bottom:10px">
          <strong>${c.nombre}</strong>${c.evaluada ? " — ya evaluada" : " — el jurado la va a evaluar en vivo"}<br/>
          ${c.caso_critico || ""}
        </div>`
      )
      .join("");
  } else {
    $("crisis-card").style.display = "none";
  }

  // Sala temática activa
  const pasoActivo = pasos.find((p) => p.estado === "en_curso");
  const cont = $("paso-activo-content");
  if (!pasoActivo) {
    const proximaPendiente = pasos.filter((p) => p.estado === "pendiente").sort((a, b) => a.orden_index - b.orden_index)[0];
    if (proximaPendiente) {
      cont.innerHTML = `<p class="small-muted">Su próxima sala es <strong>${proximaPendiente.sala_nombre}</strong>. Esperando a que el facilitador la inicie.</p>`;
    } else {
      cont.innerHTML = `<p class="small-muted">El equipo completó las 5 salas temáticas. Sigan atentos a las salas de crisis y al cierre de la jornada.</p>`;
    }
  } else {
    cont.innerHTML = renderPasoActivo(pasoActivo);
    const form = document.getElementById("form-entrega");
    if (form) form.addEventListener("submit", onEntregar);
  }

  // Historial
  const tbody = $("tabla-recorrido");
  tbody.innerHTML = pasos
    .sort((a, b) => a.orden_index - b.orden_index)
    .map((p) => {
      const cart = p.cartelito_entrada ? `<span class="badge cartelito-${p.cartelito_entrada}">${p.cartelito_entrada}</span>` : "—";
      const dec = p.decision ? `${p.decision.opcion_codigo} — ${p.decision.opcion_etiqueta || ""}` : "—";
      return `<tr><td>${p.orden_index + 1}</td><td>${p.sala_nombre || "—"}</td><td><span class="badge ${p.estado}">${p.estado}</span></td><td>${cart}</td><td>${dec}</td></tr>`;
    })
    .join("");

  manejarTimerSala(pasos);
  renderCrisisOverlay(data.crisis);
}

// ---------------- CRONÓMETRO FIJO DE LA SALA TEMÁTICA (5 minutos) ----------------
const DURACION_SALA_SEGUNDOS = 5 * 60;
let salaEnCursoAvisada = null;
let timerFijoInterval = null;

// Cuando el facilitador inicia una sala, avisamos una sola vez (toast) y
// arrancamos el cronómetro fijo anclado a la esquina de la pantalla, que
// se mantiene visible aunque el equipo scrollee el resto del panel.
function manejarTimerSala(pasos) {
  const activo = (pasos || []).find((p) => p.estado === "en_curso");
  if (!activo) {
    salaEnCursoAvisada = null;
    detenerTimerFijo();
    return;
  }
  if (activo.paso_id !== salaEnCursoAvisada) {
    salaEnCursoAvisada = activo.paso_id;
    mostrarAlertaInicio(activo.sala_nombre);
  }
  iniciarTimerFijo(activo);
}

function iniciarTimerFijo(paso) {
  clearInterval(timerFijoInterval);
  const el = $("timer-fijo");
  const valEl = $("timer-fijo-valor");
  const labelEl = $("timer-fijo-label");
  if (!el || !paso.iniciado_en) return;

  el.classList.remove("hidden");
  labelEl.textContent = paso.sala_nombre;
  const iniciado = new Date(paso.iniciado_en).getTime();
  const duracionMs = DURACION_SALA_SEGUNDOS * 1000;

  function tick() {
    const restanteMs = Math.max(0, iniciado + duracionMs - Date.now());
    const totalSeg = Math.ceil(restanteMs / 1000);
    const mm = String(Math.floor(totalSeg / 60)).padStart(2, "0");
    const ss = String(totalSeg % 60).padStart(2, "0");
    valEl.textContent = `${mm}:${ss}`;
    el.classList.toggle("timer-urgente", totalSeg > 0 && totalSeg <= 60);
    el.classList.toggle("timer-agotado", totalSeg === 0);
  }
  tick();
  timerFijoInterval = setInterval(tick, 1000);
}

function detenerTimerFijo() {
  clearInterval(timerFijoInterval);
  timerFijoInterval = null;
  const el = $("timer-fijo");
  if (el) el.classList.add("hidden");
}

function mostrarAlertaInicio(nombreSala) {
  const el = document.createElement("div");
  el.className = "toast-alerta";
  el.innerHTML = `⏱️ <strong>¡Arranca ${nombreSala}!</strong> Tenés 5 minutos.`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("visible"));
  setTimeout(() => {
    el.classList.remove("visible");
    setTimeout(() => el.remove(), 400);
  }, 4200);
}

// ---------------- PANTALLA COMPLETA DE SALA DE CRISIS (8 minutos) ----------------
let crisisTimerInterval = null;

// Se muestra apenas la crisis esta disparada y todavia no fue evaluada.
// No tiene boton de cierre: el equipo la ve hasta que el jurado la evalua.
// El cronometro de 8 minutos recien arranca cuando el admin lo inicia de
// forma remota (crisis.cronometro_iniciado_en); hasta entonces se ve la
// consigna con un cartel de "esperando inicio".
function renderCrisisOverlay(crisisList) {
  const overlay = $("crisis-overlay");
  if (!overlay) return;

  const activa = (crisisList || []).find((c) => c.disparada && !c.evaluada);
  if (!activa) {
    overlay.classList.add("hidden");
    document.body.classList.remove("crisis-lock");
    clearInterval(crisisTimerInterval);
    crisisTimerInterval = null;
    return;
  }

  overlay.classList.remove("hidden");
  document.body.classList.add("crisis-lock");
  $("crisis-overlay-nombre").textContent = activa.nombre;
  $("crisis-overlay-texto").textContent = activa.caso_critico || "";

  clearInterval(crisisTimerInterval);
  crisisTimerInterval = null;
  const timerEl = $("crisis-overlay-timer");
  const esperaEl = $("crisis-overlay-espera");

  if (!activa.cronometro_iniciado_en) {
    timerEl.textContent = "--:--";
    timerEl.classList.remove("timer-urgente");
    esperaEl.textContent = "Esperando que el equipo organizador inicie el cronómetro de 8 minutos.";
    return;
  }

  esperaEl.textContent = "";
  const iniciado = new Date(activa.cronometro_iniciado_en).getTime();
  const duracionMs = (activa.duracion_segundos || 480) * 1000;

  function tick() {
    const restanteMs = Math.max(0, iniciado + duracionMs - Date.now());
    const totalSeg = Math.ceil(restanteMs / 1000);
    const mm = String(Math.floor(totalSeg / 60)).padStart(2, "0");
    const ss = String(totalSeg % 60).padStart(2, "0");
    timerEl.textContent = `${mm}:${ss}`;
    timerEl.classList.toggle("timer-urgente", totalSeg > 0 && totalSeg <= 60);
  }
  tick();
  crisisTimerInterval = setInterval(tick, 1000);
}

function renderPasoActivo(paso) {
  const opciones = paso.opciones || [];
  const apertura = paso.variante_apertura
    ? `<div class="msg ok"><strong>Cómo llega el equipo (según su cartelito ${paso.cartelito_entrada}):</strong><br/>${paso.variante_apertura}</div>`
    : "";

  if (paso.decision) {
    return `
      <h3>${paso.sala_nombre}</h3>
      ${apertura}
      <p>${paso.encuadre || ""}</p>
      <p><strong>Problema:</strong> ${paso.enunciado || ""}</p>
      <div class="msg ok">
        <strong>Decisión registrada:</strong> ${paso.decision.opcion_codigo} — ${paso.decision.opcion_etiqueta || ""}
      </div>
      <p class="small-muted">El efecto de esta decisión sobre los indicadores de la provincia no se revela: se verá reflejado en el leaderboard público. Esperen al facilitador de la siguiente estación.</p>
    `;
  }

  const opcionesHtml = opciones
    .map(
      (o) => `
      <label class="opcion-radio">
        <input type="radio" name="opcion_codigo" value="${o.codigo}" required />
        <strong>${o.codigo}) ${o.etiqueta}</strong> — ${o.texto}
      </label>`
    )
    .join("");

  return `
    <h3>${paso.sala_nombre}</h3>
    ${apertura}
    <p>${paso.encuadre || ""}</p>
    <p><strong>Problema:</strong> ${paso.enunciado || ""}</p>
    <form id="form-entrega">
      <input type="hidden" name="paso_id" value="${paso.paso_id}" />
      <label>Elijan una de las 3 opciones. No van a ver de antemano su efecto sobre los indicadores de la provincia.</label>
      <div class="opciones-lista">${opcionesHtml}</div>
      <button type="submit">Confirmar decisión y cerrar sala</button>
    </form>
  `;
}

async function onEntregar(ev) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const body = Object.fromEntries(fd.entries());
  if (!body.opcion_codigo) return showMsg("Elegí una opción antes de confirmar.", "error");
  try {
    await api("/api/team/entregar", { method: "POST", body: JSON.stringify(body) });
    showMsg("Decisión registrada. La sala queda cerrada.", "ok");
    cargarEstado();
  } catch (e) {
    showMsg(e.message, "error");
  }
}

// ---------------- INIT ----------------
if (session?.token) iniciarApp();
