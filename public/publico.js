const NOMBRE_EJE = {
  imagen_positiva: "Imagen Positiva",
  intencion_voto: "Intención de Voto",
  gobernabilidad: "Gobernabilidad",
  salud_fiscal: "Salud Fiscal",
  orden_publico: "Orden Público",
};
const ORDEN_EJES = ["imagen_positiva", "intencion_voto", "gobernabilidad", "salud_fiscal", "orden_publico"];

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
  // Cada provincia es una caja aislada e independiente: no hay ranking,
  // no hay número de puesto ni resaltado de "líder". El orden que llega
  // del servidor ya es fijo (por alta), no por puntaje.
  document.getElementById("grid-provincias").innerHTML = (data.leaderboard || [])
    .map(
      (row) => `
      <div class="provincia-card">
        <h2>${row.nombre}</h2>
        ${ORDEN_EJES.map((slug) => barraEje(slug, row.ejes[slug])).join("")}
      </div>`
    )
    .join("");

  const crisisDisparadas = (data.crisis || []).filter((c) => c.disparada).map((c) => c.nombre);
  document.getElementById("crisis-line").textContent = crisisDisparadas.length
    ? `🚨 Disparadas: ${crisisDisparadas.join(" · ")}`
    : "Recorrido en curso por las salas temáticas";

  document.getElementById("progreso-linea").textContent =
    `Progreso global: ${data.progreso_global.completados} / ${data.progreso_global.total} salas temáticas cerradas`;
}

const socket = io({ auth: { canal: "publico" } });
socket.on("leaderboard:actualizado", cargar);
socket.on("crisis:iniciada", cargar);
socket.on("connect", cargar);
socket.on("app:reset", () => setTimeout(() => location.reload(), 1000));

cargar();
setInterval(cargar, 15000); // respaldo por si se pierde el socket
