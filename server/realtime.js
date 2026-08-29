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

module.exports = { setIo, emitAdmin, emitEquipo, emitPublico, emitTodos, emitGlobal };
