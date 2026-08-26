const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { signToken } = require("../auth");
const { emitAdmin } = require("../realtime");

const router = express.Router();

// -----------------------------------------------------------------------
// POST /api/auth/equipo/login
// Login simplificado de jugadores: codigo de equipo + PIN + rol elegido.
// Si el rol todavia no fue tomado por nadie en ese equipo, crea el Usuario;
// si ya existe, simplemente reautentica (permite reingresar desde otro
// dispositivo si alguien perdio el celular durante el evento).
// -----------------------------------------------------------------------
router.post("/equipo/login", (req, res) => {
  const { codigo, pin, rol_slug, nombre } = req.body || {};
  if (!codigo || !pin || !rol_slug) {
    return res.status(400).json({ error: "Faltan datos: codigo, pin y rol_slug son obligatorios." });
  }

  const equipo = db.prepare("SELECT * FROM equipo WHERE codigo = ?").get(codigo.trim().toUpperCase());
  if (!equipo || equipo.pin !== String(pin).trim()) {
    return res.status(401).json({ error: "Codigo de equipo o PIN incorrectos." });
  }

  const rol = db.prepare("SELECT * FROM rol WHERE slug = ?").get(rol_slug);
  if (!rol) return res.status(400).json({ error: "Rol invalido." });

  let usuario = db
    .prepare("SELECT * FROM usuario WHERE equipo_id = ? AND rol_id = ?")
    .get(equipo.id, rol.id);

  if (!usuario) {
    const id = uuid();
    db.prepare(
      `INSERT INTO usuario (id, tipo, nombre, equipo_id, rol_id) VALUES (?, 'jugador', ?, ?, ?)`
    ).run(id, nombre || rol.nombre, equipo.id, rol.id);
    usuario = db.prepare("SELECT * FROM usuario WHERE id = ?").get(id);
    emitAdmin("equipo:rol_tomado", { equipo_id: equipo.id, rol_slug });
  }

  const token = signToken({
    sub: usuario.id,
    tipo: "jugador",
    equipo_id: equipo.id,
    equipo_codigo: equipo.codigo,
    rol_id: rol.id,
    rol_slug: rol.slug,
    nombre: usuario.nombre,
  });

  res.json({
    token,
    usuario: { id: usuario.id, nombre: usuario.nombre },
    equipo: { id: equipo.id, codigo: equipo.codigo, nombre: equipo.nombre },
    rol: { id: rol.id, slug: rol.slug, nombre: rol.nombre },
  });
});

// GET /api/auth/roles-disponibles?codigo=GOB-1  -> que roles ya fueron tomados (para la UI de login)
router.get("/roles-disponibles", (req, res) => {
  const { codigo } = req.query;
  const equipo = db.prepare("SELECT * FROM equipo WHERE codigo = ?").get((codigo || "").trim().toUpperCase());
  if (!equipo) return res.status(404).json({ error: "Equipo no encontrado." });
  const roles = db.prepare("SELECT id, slug, nombre, orden FROM rol ORDER BY orden ASC").all();
  const tomados = db
    .prepare("SELECT rol_id FROM usuario WHERE equipo_id = ?")
    .all(equipo.id)
    .map((r) => r.rol_id);
  res.json(roles.map((r) => ({ ...r, tomado: tomados.includes(r.id) })));
});

// -----------------------------------------------------------------------
// POST /api/auth/staff/login  (Admin / Facilitador / Jurado)
// -----------------------------------------------------------------------
router.post("/staff/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Faltan credenciales." });
  }
  const usuario = db
    .prepare("SELECT * FROM usuario WHERE username = ? AND tipo = 'staff'")
    .get(username.trim());
  if (!usuario || !bcrypt.compareSync(password, usuario.password_hash || "")) {
    return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
  }
  const token = signToken({
    sub: usuario.id,
    tipo: "staff",
    staff_rol: usuario.staff_rol,
    sala_asignada_id: usuario.sala_asignada_id,
    nombre: usuario.nombre,
  });
  res.json({
    token,
    usuario: { id: usuario.id, nombre: usuario.nombre, staff_rol: usuario.staff_rol, sala_asignada_id: usuario.sala_asignada_id },
  });
});

module.exports = router;
