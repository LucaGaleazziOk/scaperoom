const jwt = require("jsonwebtoken");
const db = require("./db");

const JWT_SECRET = process.env.JWT_SECRET || "cambiar-este-secreto-antes-de-produccion";
const TOKEN_TTL = "12h"; // dura toda la jornada del evento

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// Middleware: exige un JWT valido y lo deja en req.user
// Ademas de validar la firma, confirma que el usuario que emitio el token
// TODAVIA exista en la base: si se reinicio la jornada (ver /admin/reiniciar)
// se generan usuarios nuevos con otros ids, y un token viejo -aunque su firma
// siga siendo valida- ya no debe poder operar (evita, entre otras cosas, que
// se rompa una FOREIGN KEY al usar ese id vencido como facilitador_id/etc).
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No autenticado. Falta el token." });
  try {
    const payload = verifyToken(token);
    const existe = db.prepare("SELECT 1 FROM usuario WHERE id = ?").get(payload.sub);
    if (!existe) {
      return res.status(401).json({ error: "Tu sesión ya no es válida (se reinició la jornada). Volvé a ingresar." });
    }
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token invalido o expirado." });
  }
}

// Middleware: exige ademas que el usuario sea staff con alguno de los staff_rol indicados
function requireStaff(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || req.user.tipo !== "staff") {
      return res.status(403).json({ error: "Requiere una cuenta de staff." });
    }
    if (allowedRoles.length && !allowedRoles.includes(req.user.staff_rol)) {
      return res.status(403).json({ error: `Tu rol de staff (${req.user.staff_rol}) no tiene permiso para esta accion.` });
    }
    next();
  };
}

// Middleware: exige que el usuario sea un jugador (miembro de equipo)
function requireJugador(req, res, next) {
  if (!req.user || req.user.tipo !== "jugador") {
    return res.status(403).json({ error: "Requiere una sesion de jugador." });
  }
  next();
}

module.exports = { signToken, verifyToken, requireAuth, requireStaff, requireJugador, JWT_SECRET };
