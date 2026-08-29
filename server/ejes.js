// Ejes de desempeño provincial — reemplazan al viejo esquema "leyes aprobadas".
// Los 5 ejes usan la misma convención: un valor más alto es mejor para la provincia.
// IMAGEN_POSITIVA es el eje maestro: define el ranking final del leaderboard.
// Los otros 4 son secundarios, se muestran en el panel público/admin para
// dar contexto de gestión, pero no desempatan el primer puesto.

const EJES = [
  {
    slug: "imagen_positiva",
    nombre: "Imagen Positiva",
    descripcion: "Percepción pública general de la gestión provincial. Es el eje que define el ranking final.",
    inicial: 50,
    principal: true,
  },
  {
    slug: "intencion_voto",
    nombre: "Intención de Voto",
    descripcion: "Piso electoral proyectado del oficialismo provincial.",
    inicial: 42,
  },
  {
    slug: "gobernabilidad",
    nombre: "Gobernabilidad",
    descripcion: "Capacidad de sostener acuerdos, ejecutar decisiones y evitar bloqueos internos/externos.",
    inicial: 55,
  },
  {
    slug: "salud_fiscal",
    nombre: "Salud Fiscal",
    descripcion: "Sostenibilidad de las cuentas provinciales (equilibrio entre gasto, deuda y recursos propios/transferencias).",
    inicial: 50,
  },
  {
    slug: "orden_publico",
    nombre: "Orden Público",
    descripcion: "Nivel de conflictividad social y seguridad bajo control (más alto = más orden, menos conflicto).",
    inicial: 48,
  },
];

const EJE_SLUGS = EJES.map((e) => e.slug);
const EJE_PRINCIPAL = EJES.find((e) => e.principal).slug;

function ejesIniciales() {
  const obj = {};
  for (const e of EJES) obj[e.slug] = e.inicial;
  return obj;
}

function clamp(v) {
  return Math.max(0, Math.min(100, Math.round(v)));
}

module.exports = { EJES, EJE_SLUGS, EJE_PRINCIPAL, ejesIniciales, clamp };
