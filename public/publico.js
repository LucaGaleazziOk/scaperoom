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
        <td>${row.leyes_aprobadas}</td>
        <td>${row.puntaje_total}</td>
      </tr>`
    )
    .join("");

  document.getElementById("crisis-line").textContent = data.crisis_disparada
    ? "🚨 La Sala 6 (crisis de comunicación) ya fue convocada"
    : "Recorrido en curso por las salas temáticas";

  document.getElementById("progreso-linea").textContent =
    `Progreso global: ${data.progreso_global.completados} / ${data.progreso_global.total} salas temáticas cerradas`;
}

const socket = io({ auth: { canal: "publico" } });
socket.on("leaderboard:actualizado", cargar);
socket.on("crisis:iniciada", cargar);
socket.on("connect", cargar);

cargar();
setInterval(cargar, 15000); // respaldo por si se pierde el socket
