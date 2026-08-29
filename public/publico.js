async function cargar() {
  try {
    const res = await fetch("/api/public/leaderboard");
    const data = await res.json();
    render(data);
  } catch (e) {
    console.error(e);
  }
}

function render(data) {
  document.getElementById("tabla-leaderboard").innerHTML = data.leaderboard
    .map(
      (row, i) => `<tr class="${i === 0 ? "leader-row-1" : ""}">
        <td class="rank">${i + 1}</td>
        <td>${row.nombre}</td>
        <td>${row.ejes.imagen_positiva}</td>
        <td>${row.ejes.intencion_voto}</td>
        <td>${row.ejes.gobernabilidad}</td>
        <td>${row.ejes.salud_fiscal}</td>
        <td>${row.ejes.orden_publico}</td>
      </tr>`
    )
    .join("");

  const crisisDisparadas = (data.crisis || []).filter((c) => c.disparada).map((c) => c.nombre);
  document.getElementById("crisis-line").textContent = crisisDisparadas.length
    ? `🚨 Disparadas: ${crisisDisparadas.join(" · ")}`
    : "Recorrido en curso por las salas temáticas";

  document.getElementById("progreso-linea").textContent =
    `Progreso global: ${data.progreso_global.completados} / ${data.progreso_global.total} salas temáticas cerradas — gana la provincia con mayor Imagen Positiva`;
}

const socket = io({ auth: { canal: "publico" } });
socket.on("leaderboard:actualizado", cargar);
socket.on("crisis:iniciada", cargar);
socket.on("connect", cargar);

cargar();
setInterval(cargar, 15000); // respaldo por si se pierde el socket
