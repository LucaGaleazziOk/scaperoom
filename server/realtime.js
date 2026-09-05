// Wrapper minimo para poder emitir eventos de Socket.io desde cualquier ruta
// sin pasar la instancia `io` de mano en mano por todos los archivos.

let ioInstance = null;

function setIo(io) {
  ioInstance = io;
}

function emitAdmin(event, payload) {
  if (ioInstance) ioInstance.to("admin").emit(event, payload);
}

function emitEquipo(equipoId, event, payload) {
  if (ioInstance) ioInstance.to(`equipo:${equipoId}`).emit(event, payload);
}

function emitPublico(event, payload) {
  if (ioInstance) ioInstance.to("publico").emit(event, payload);
}

function emitTodos(event, payload) {
  emitAdmin(event, payload);
  emitPublico(event, payload);
}

// Broadcast real a TODOS los sockets conectados, sin importar su room
// (jugadores incluidos). Se usa para "app:reset": tras un reinicio total de
// la jornada las rooms `equipo:<id>` quedan obsoletas (los equipos son
// nuevos), asi que hace falta llegar a todo el mundo por igual.
function emitGlobal(event, payload) {
  if (ioInstance) ioInstance.emit(event, payload);
}

// ---------------------------------------------------------------------
// Presencia en vivo de los equipos: cuenta cuantos sockets de una misma
// provincia estan conectados en este momento (puede tener mas de una
// pestaña/dispositivo abierto a la vez), asi el panel de admin puede
// mostrar "conectada" mientras el conteo sea mayor a cero. No persiste en
// disco a proposito: es un estado de "ahora mismo", no un historial.
// ---------------------------------------------------------------------
const conteoConexionesPorEquipo = new Map();

function marcarEquipoConectado(equipoId) {
  const actual = conteoConexionesPorEquipo.get(equipoId) || 0;
  conteoConexionesPorEquipo.set(equipoId, actual + 1);
  if (actual === 0) emitAdmin("equipo:conexion_cambio", { equipo_id: equipoId, conectado: true });
}

function marcarEquipoDesconectado(equipoId) {
  const actual = conteoConexionesPorEquipo.get(equipoId) || 0;
  if (actual <= 1) {
    conteoConexionesPorEquipo.delete(equipoId);
    emitAdmin("equipo:conexion_cambio", { equipo_id: equipoId, conectado: false });
  } else {
    conteoConexionesPorEquipo.set(equipoId, actual - 1);
  }
}

function estaEquipoConectado(equipoId) {
  return (conteoConexionesPorEquipo.get(equipoId) || 0) > 0;
}

module.exports = {
  setIo,
  emitAdmin,
  emitEquipo,
  emitPublico,
  emitTodos,
  emitGlobal,
  marcarEquipoConectado,
  marcarEquipoDesconectado,
  estaEquipoConectado,
};
