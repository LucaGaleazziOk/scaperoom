const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { signToken } = require("../auth");
const { emitAdmin } = require("../realtime");

const router = express.Router();

// -----------------------------------------------------------------------
// POST /api/auth/equipo/login
// Login unico por equipo: codigo de equipo + PIN. No hay seleccion de rol:
// el unico acceso habilitado por equipo queda siempre a nombre del rol
// "Jefe/a de Gabinete de Ministros", que es quien administra el panel en
// representacion de todo el equipo (el resto de los roles se juegan de
// forma presencial con la carpeta fisica, pero no tienen login propio).
// Si es el primer ingreso de ese equipo, crea el Usuario; si ya existe,
// simplemente reautentica (permite reingresar desde otro dispositivo).
// -----------------------------------------------------------------------
const ROL_ADMINISTRADOR_SLUG = "jefe_gabinete";

router.post("/equipo/login", (req, res) => {
  const { codigo, pin, nombre } = req.body || {};
  if (!codigo || !pin) {
    return res.status(400).json({ error: "Faltan datos: codigo y pin son obligatorios." });
  }

  const equipo = db.prepare("SELECT * FROM equipo WHERE codigo = ?").get(codigo.trim().toUpperCase());
  if (!equipo || equipo.pin !== String(pin).trim()) {
    return res.status(401).json({ error: "Codigo de equipo o PIN incorrectos." });
  }

  const rol = db.prepare("SELECT * FROM rol WHERE slug = ?").get(ROL_ADMINISTRADOR_SLUG);
  if (!rol) return res.status(500).json({ error: "El rol de Jefe/a de Gabinete no esta configurado." });

  let usuario = db
    .prepare("SELECT * FROM usuario WHERE equipo_id = ? AND rol_id = ?")
    .get(equipo.id, rol.id);

  if (!usuario) {
    const id = uuid();
    db.prepare(
      `INSERT INTO usuario (id, tipo, nombre, equipo_id, rol_id) VALUES (?, 'jugador', ?, ?, ?)`
    ).run(id, nombre || rol.nombre, equipo.id, rol.id);
    usuario = db.prepare("SELECT * FROM usuario WHERE id = ?").get(id);
    emitAdmin("equipo:rol_tomado", { equipo_id: equipo.id, rol_slug: rol.slug });
  } else if (nombre && nombre.trim() && nombre.trim() !== usuario.nombre) {
    db.prepare("UPDATE usuario SET nombre = ? WHERE id = ?").run(nombre.trim(), usuario.id);
    usuario = db.prepare("SELECT * FROM usuario WHERE id = ?").get(usuario.id);
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
