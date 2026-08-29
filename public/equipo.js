const API = "";
let session = JSON.parse(localStorage.getItem("sep_equipo_session") || "null");
let socket = null;

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
}

function conectarSocket() {
  socket = io({ auth: { token: session.token } });
  socket.on("estado:actualizado", cargarEstado);
  socket.on("crisis:iniciada", (payload) => {
    showMsg(`🚨 ${payload?.mensaje || "Se disparó una sala de crisis."}`, "ok");
    cargarEstado();
  });
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
