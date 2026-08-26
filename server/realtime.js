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

module.exports = { setIo, emitAdmin, emitEquipo, emitPublico, emitTodos };
