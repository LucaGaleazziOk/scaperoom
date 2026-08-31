require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const { verifyToken } = require("./auth");
const { setIo } = require("./realtime");
const { run: seed } = require("./seed");

const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const teamRoutes = require("./routes/team");
const publicRoutes = require("./routes/public");

// Carga los datos de la Jornada Demo la primera vez que se levanta el servidor
seed();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/team", teamRoutes);
app.use("/api/public", publicRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true, hora: new Date().toISOString() }));

// Frontend estatico (Panel Admin / Panel de Equipo / Panel Publico)
app.use(express.static(path.join(__dirname, "..", "public")));

// Manejador de errores global: sin esto, cualquier excepcion no capturada en
// una ruta (por ejemplo una violacion de FOREIGN KEY) hace que Express
// devuelva su pagina de error por defecto en HTML — el frontend, que espera
// JSON, la interpreta como "Error de red" sin ninguna pista de que paso.
// Con este handler, cualquier fallo similar se ve en el panel con un mensaje
// claro (y queda logueado en la consola del servidor para diagnosticar).
app.use((err, req, res, next) => {
  console.error("[error]", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Error interno del servidor. Probá de nuevo en unos segundos." });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
setIo(io);

// ---------------------------------------------------------------------
// Autorizacion de canales de tiempo real: cada cliente se autentica con el
// mismo JWT que usa contra la API REST, y el servidor decide a que "rooms"
// de Socket.io lo suscribe. Esto reproduce, para el canal en vivo, la misma
// segmentacion de datos que las rutas REST hacen via requireAuth/requireStaff.
// ---------------------------------------------------------------------
io.on("connection", (socket) => {
  const { token, canal } = socket.handshake.auth || {};

  if (canal === "publico") {
    socket.join("publico");
    return;
  }

  if (!token) {
    socket.disconnect(true);
    return;
  }

  let user;
  try {
    user = verifyToken(token);
  } catch (err) {
    socket.disconnect(true);
    return;
  }

  if (user.tipo === "staff") {
    socket.join("admin");
    socket.join("publico");
  } else if (user.tipo === "jugador") {
    socket.join(`equipo:${user.equipo_id}`);
    // También se suma a "publico" para recibir en vivo la miniatura de su
    // propio contador en el panel de equipo (mismos datos que ya son públicos).
    socket.join("publico");
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\nSala de Escape Politica — servidor escuchando en http://localhost:${PORT}`);
  console.log(`  Panel de Equipo:  http://localhost:${PORT}/equipo.html`);
  console.log(`  Panel Admin:      http://localhost:${PORT}/admin.html`);
  console.log(`  Panel Publico:    http://localhost:${PORT}/publico.html\n`);
});
