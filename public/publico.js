const NOMBRE_EJE = {
  imagen_positiva: "Imagen Positiva",
  intencion_voto: "Intención de Voto",
  gobernabilidad: "Gobernabilidad",
  salud_fiscal: "Salud Fiscal",
  orden_publico: "Orden Público",
};
const ORDEN_EJES = ["imagen_positiva", "intencion_voto", "gobernabilidad", "salud_fiscal", "orden_publico"];

// Una vez que arranca la animación de conteo del resultado final, no se
// vuelve a repetir en cada refresh (socket o polling) — solo se re-pinta
// el resultado ya asentado.
let escrutinioAnimado = false;

async function cargar() {
  try {
    const res = await fetch("/api/public/leaderboard");
    const data = await res.json();
    render(data);
  } catch (e) {
    console.error(e);
  }
}

function barraEje(slug, valor) {
  const principal = slug === "imagen_positiva" ? " principal" : "";
  const v = Math.max(0, Math.min(100, valor));
  return `
    <div class="eje-barra${principal}">
      <div class="eje-label"><span>${NOMBRE_EJE[slug]}</span><span>${valor}</span></div>
      <div class="eje-track"><div class="eje-fill" style="width:${v}%"></div></div>
    </div>`;
}

function render(data) {
  const escrutinio = data.escrutinio || { todo_cerrado: false, publicado: false };

  if (escrutinio.publicado) {
    renderResultadoFinal(escrutinio.resultados || []);
  } else if (escrutinio.todo_cerrado) {
    escrutinioAnimado = false; // por si se despublica despues, que vuelva a animar la proxima vez
    renderAguardandoEscrutinio();
  } else {
    escrutinioAnimado = false;
    renderCajasEnVivo(data);
  }

  const crisisDisparadas = (data.crisis || []).filter((c) => c.disparada).map((c) => c.nombre);
  document.getElementById("crisis-line").textContent = escrutinio.publicado
    ? "Resultado final"
    : escrutinio.todo_cerrado
    ? "Escrutinio en curso"
    : crisisDisparadas.length
    ? `🚨 Disparadas: ${crisisDisparadas.join(" · ")}`
    : "Recorrido en curso por las salas temáticas";

  document.getElementById("progreso-linea").textContent = escrutinio.publicado
    ? ""
    : `Progreso global: ${data.progreso_global.completados} / ${data.progreso_global.total} salas temáticas cerradas`;
}

// ---------------- ESTADO 1: tablero en vivo (cajas aisladas, sin ranking) ----------------
function renderCajasEnVivo(data) {
  document.getElementById("grid-provincias").innerHTML = (data.leaderboard || [])
    .map(
      (row) => `
      <div class="provincia-card">
        <h2>${row.nombre}</h2>
        ${ORDEN_EJES.map((slug) => barraEje(slug, row.ejes[slug])).join("")}
      </div>`
    )
    .join("");
}

// ---------------- ESTADO 2: todas las salas cerradas, esperando publicación ----------------
function renderAguardandoEscrutinio() {
  document.getElementById("grid-provincias").innerHTML = `
    <div class="escrutinio-espera">
      <div class="escrutinio-icono">🗳️</div>
      <h2>Aguardando escrutinio</h2>
      <p>Todas las salas cerraron. Los organizadores están definiendo el resultado final.</p>
    </div>`;
}

// ---------------- ESTADO 3: resultado final publicado ----------------
function renderResultadoFinal(resultados) {
  const ordenados = [...resultados].sort((a, b) => (b.porcentaje ?? 0) - (a.porcentaje ?? 0));
  const grid = document.getElementById("grid-provincias");

  if (!escrutinioAnimado) {
    escrutinioAnimado = true;
    animarConteo(ordenados, grid);
  } else {
    pintarResultadoFinal(ordenados, grid, false);
  }
}

function pintarResultadoFinal(ordenados, grid, revelado) {
  grid.innerHTML = ordenados
    .map(
      (r, i) => `
      <div class="provincia-card resultado-final ${i === 0 ? "ganador" : ""} ${revelado ? "revelado" : ""}">
        ${i === 0 ? '<div class="medalla">🏆 Ganador</div>' : ""}
        <h2>${r.nombre}</h2>
        <div class="resultado-pct">${(r.porcentaje ?? 0).toFixed(1)}%</div>
        <div class="eje-track"><div class="eje-fill" style="width:${Math.max(0, Math.min(100, r.porcentaje ?? 0))}%"></div></div>
      </div>`
    )
    .join("");
}

// Cuenta con suspenso: primero los números "tiran" al azar (efecto tómbola)
// y en el tramo final convergen suavemente al valor real, los cinco al
// mismo tiempo, hasta asentarse juntos.
function animarConteo(ordenados, grid) {
  grid.innerHTML = ordenados
    .map(
      (r) => `
      <div class="provincia-card resultado-final" data-codigo="${r.codigo}">
        <h2>${r.nombre}</h2>
        <div class="resultado-pct" id="pct-${r.codigo}">0.0%</div>
        <div class="eje-track"><div class="eje-fill" id="fill-${r.codigo}" style="width:0%"></div></div>
      </div>`
    )
    .join("");

  const inicio = performance.now();
  const duracionFlicker = 3000;
  const duracionTotal = 5200;

  function frame(ahora) {
    const t = ahora - inicio;
    ordenados.forEach((r) => {
      const pctEl = document.getElementById(`pct-${r.codigo}`);
      const fillEl = document.getElementById(`fill-${r.codigo}`);
      if (!pctEl || !fillEl) return;
      let valor;
      if (t < duracionFlicker) {
        valor = Math.random() * 60;
      } else {
        const p = Math.min(1, (t - duracionFlicker) / (duracionTotal - duracionFlicker));
        const ease = 1 - Math.pow(1 - p, 3);
        valor = (r.porcentaje ?? 0) * ease;
      }
      pctEl.textContent = valor.toFixed(1) + "%";
      fillEl.style.width = Math.max(0, Math.min(100, valor)) + "%";
    });

    if (t < duracionTotal) {
      requestAnimationFrame(frame);
    } else {
      pintarResultadoFinal(ordenados, grid, true);
    }
  }
  requestAnimationFrame(frame);
}

const socket = io({ auth: { canal: "publico" } });
socket.on("leaderboard:actualizado", cargar);
socket.on("crisis:iniciada", cargar);
socket.on("escrutinio:publicado", cargar);
socket.on("escrutinio:despublicado", cargar);
socket.on("connect", cargar);
socket.on("app:reset", () => setTimeout(() => location.reload(), 1000));

cargar();
setInterval(cargar, 15000); // respaldo por si se pierde el socket
