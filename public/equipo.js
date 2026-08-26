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
$("btn-buscar-roles").addEventListener("click", async () => {
  const codigo = $("in-codigo").value.trim();
  if (!codigo) return showMsg("Ingresá el código de equipo primero.", "error");
  try {
    const roles = await api(`/api/auth/roles-disponibles?codigo=${encodeURIComponent(codigo)}`);
    const sel = $("in-rol");
    sel.innerHTML = "";
    roles.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r.slug;
      opt.textContent = r.nombre + (r.tomado ? " (ya tomado — reingresar)" : "");
      sel.appendChild(opt);
    });
    showMsg("Roles cargados. Elegí el tuyo y presioná Entrar.", "ok");
  } catch (e) {
    showMsg(e.message, "error");
  }
});

$("btn-login").addEventListener("click", async () => {
  const codigo = $("in-codigo").value.trim();
  const pin = $("in-pin").value.trim();
  const rol_slug = $("in-rol").value;
  const nombre = $("in-nombre").value.trim();
  if (!codigo || !pin || !rol_slug) return showMsg("Completá código, PIN y rol.", "error");
  try {
    const data = await api("/api/auth/equipo/login", {
      method: "POST",
      body: JSON.stringify({ codigo, pin, rol_slug, nombre }),
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
  socket.on("crisis:iniciada", () => { showMsg("🚨 Se disparó la Sala 6 — convocatoria a los Presidentes.", "ok"); cargarEstado(); });
}

async function cargarEstado() {
  try {
    const data = await api("/api/team/estado");
    render(data);
  } catch (e) {
    showMsg(e.message, "error");
  }
}

function render(data) {
  $("equipo-nombre").textContent = `${data.equipo.codigo} — ${data.equipo.nombre}`;
  $("equipo-contexto").textContent = data.equipo.contexto_arranque;
  $("equipo-tension").textContent = data.equipo.tension_interna;
  $("equipo-objetivos").innerHTML = data.equipo.objetivos_generales.map((o) => `<li>${o}</li>`).join("");
  $("objetivo-secreto").textContent = data.mi_rol?.objetivo_secreto || "—";

  const pasos = data.pasos;
  const pasoTematico = pasos.find((p) => p.estado === "en_curso" && p.sala_tipo !== "crisis");
  const pasoCrisis = pasos.find((p) => p.sala_tipo === "crisis" && p.estado === "en_curso");

  // Crisis
  if (pasoCrisis) {
    $("crisis-card").style.display = "block";
    $("crisis-texto").innerHTML = `<strong>${pasoCrisis.encuadre || ""}</strong><br/><br/>${pasoCrisis.caso_critico || ""}`;
  } else {
    $("crisis-card").style.display = "none";
  }

  // Paso activo
  const cont = $("paso-activo-content");
  if (!pasoTematico) {
    const proximaPendiente = pasos.filter((p) => p.sala_tipo !== "crisis" && p.estado === "pendiente").sort((a,b)=>a.orden_index-b.orden_index)[0];
    if (proximaPendiente) {
      cont.innerHTML = `<p class="small-muted">Su próxima sala es <strong>${proximaPendiente.sala_nombre}</strong>. Esperando a que el facilitador la inicie.</p>`;
    } else {
      cont.innerHTML = `<p class="small-muted">El equipo completó todas las salas temáticas. Esperen la sesión de Congreso.</p>`;
    }
  } else {
    cont.innerHTML = renderPasoActivo(pasoTematico);
    const form = document.getElementById("form-entrega");
    if (form) form.addEventListener("submit", onEntregar);
  }

  // Historial
  const tbody = $("tabla-recorrido");
  tbody.innerHTML = pasos
    .filter((p) => !p.oculto)
    .sort((a, b) => a.orden_index - b.orden_index)
    .map((p) => {
      const cart = p.cartelito_entrada ? `<span class="badge cartelito-${p.cartelito_entrada}">${p.cartelito_entrada}</span>` : "—";
      const dec = p.decision ? p.decision.opcion_codigo : "—";
      const numLabel = p.sala_tipo === "crisis" ? "Sala 6" : (p.orden_index + 1);
      return `<tr><td>${numLabel}</td><td>${p.sala_nombre || "—"}</td><td><span class="badge ${p.estado}">${p.estado}</span></td><td>${cart}</td><td>${dec}</td></tr>`;
    })
    .join("");
}

function renderPasoActivo(paso) {
  const opciones = paso.opciones || [];
  const apertura = paso.variante_apertura
    ? `<div class="msg ok"><strong>Cómo llega el equipo (según su cartelito ${paso.cartelito_entrada}):</strong><br/>${paso.variante_apertura}</div>`
    : "";

  if (paso.decision) {
    // ya se entregó: mostrar resumen de solo lectura
    return `
      <h3>${paso.sala_nombre}</h3>
      ${apertura}
      <p>${paso.encuadre || ""}</p>
      <p>${paso.caso_critico || ""}</p>
      <div class="msg ok">
        <strong>Decisión registrada:</strong> ${paso.decision.opcion_codigo} → cartelito ${paso.decision.cartelito_resultante}<br/>
        <strong>Proyecto:</strong> ${paso.proyecto ? paso.proyecto.nombre_proyecto : "—"}<br/>
        ${paso.consecuencia_narrativa ? `<strong>Consecuencia:</strong> ${paso.consecuencia_narrativa}<br/>` : ""}
        ${paso.impacto_presupuestario ? `<strong>Impacto presupuestario:</strong> ${paso.impacto_presupuestario}` : ""}
      </div>
      <p class="small-muted">Esta sala ya fue cerrada. Esperen al facilitador de la siguiente estación.</p>
    `;
  }

  const opcionesHtml = opciones
    .map((o) => `<option value="${o.codigo}">${o.codigo} — ${o.etiqueta || ""}</option>`)
    .join("");

  return `
    <h3>${paso.sala_nombre}${paso.proyecto_ley_nombre ? " — Proyecto: " + paso.proyecto_ley_nombre : ""}</h3>
    ${apertura}
    <p>${paso.encuadre || ""}</p>
    <p>${paso.caso_critico || ""}</p>
    <form id="form-entrega">
      <input type="hidden" name="paso_id" value="${paso.paso_id}" />
      <label>Decisión del equipo</label>
      <select name="opcion_codigo" required>
        <option value="">— elegir —</option>
        ${opcionesHtml}
      </select>
      <label>Nombre del proyecto de ley</label>
      <input name="nombre_proyecto" required />
      <label>Alcance / fundamento (una línea, firmado por el Presidente)</label>
      <textarea name="alcance_texto" required></textarea>
      <label>Firmado por</label>
      <input name="firmado_por" placeholder="Nombre del/la Presidente/a" />
      <button type="submit">Entregar y cerrar sala</button>
    </form>
  `;
}

async function onEntregar(ev) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const body = Object.fromEntries(fd.entries());
  try {
    const r = await api("/api/team/entregar", { method: "POST", body: JSON.stringify(body) });
    showMsg(`Entregado. Cartelito resultante: ${r.cartelito_resultante}`, "ok");
    cargarEstado();
  } catch (e) {
    showMsg(e.message, "error");
  }
}

// ---------------- INIT ----------------
if (session?.token) iniciarApp();
