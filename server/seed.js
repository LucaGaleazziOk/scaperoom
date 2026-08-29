// Seed inicial de datos — v2 "Provincias".
// Carga 5 provincias reales (PBA, CABA, Formosa, Santa Fe, Chubut) como
// equipos, 5 salas temáticas (Economía, Desarrollo Social, Seguridad,
// Crisis Interna, Salud) con 75 opciones personalizadas (5 salas x 5
// provincias x 3 opciones), y 3 salas de crisis independientes.
// Es idempotente: si ya hay una jornada cargada, no vuelve a insertar.

const { v4: uuid } = require("uuid");
const bcrypt = require("bcryptjs");
const db = require("./db");
const { ejesIniciales } = require("./ejes");

function alreadySeeded() {
  const row = db.prepare("SELECT COUNT(*) as c FROM jornada").get();
  return row.c > 0;
}

function rotate(arr, n) {
  const i = n % arr.length;
  return arr.slice(i).concat(arr.slice(0, i));
}

const APERTURA_GENERICA = {
  A: "Llegan con fama de decisiones audaces y de impacto rápido: los esperan con expectativa, pero también con más exigencia.",
  B: "Llegan con fama de gestión cautelosa y negociadora: los reciben con calma, aunque algunos leen indecisión.",
  C: "Llegan con fama de mano firme y ortodoxa: los reciben con respeto, pero también con desconfianza de los sectores más golpeados.",
};

const SALAS_TEMATICAS = [
  {
    slug: "economia",
    nombre: "Economía",
    eje: "economia",
    encuadre:
      "El gabinete económico debe resolver, en minutos, un problema estructural de las cuentas provinciales. No hay tiempo para consultar a la Legislatura: la decisión la toma el gabinete presente en la sala.",
    problemas: {
      PBA: {
        enunciado:
          "La Nación anuncia una demora en el envío de fondos de coparticipación justo cuando vencen los salarios estatales del mes. La caja provincial no alcanza a cubrir el pago en término.",
        opciones: [
          { etiqueta: "Tomar deuda de corto plazo", texto: "Emitir Letras del Tesoro provincial para cubrir el bache y pagar los sueldos en término.", efectos: { salud_fiscal: -8, gobernabilidad: 6, imagen_positiva: 4, orden_publico: 2 } },
          { etiqueta: "Escalonar el pago", texto: "Pagar por franjas salariales (primero los sueldos más bajos) y renegociar plazos con los gremios.", efectos: { gobernabilidad: -4, orden_publico: -6, imagen_positiva: -2, salud_fiscal: 5 } },
          { etiqueta: "Confrontar con la Nación", texto: "Denunciar el recorte como \"ilegal\" ante la Justicia y la mesa de gobernadores, sin resolver el pago inmediato.", efectos: { imagen_positiva: 6, intencion_voto: 5, orden_publico: -8, salud_fiscal: -3 } },
        ],
      },
      CABA: {
        enunciado:
          "Crece fuertemente la cantidad de personas en situación de calle y se pide ampliar el presupuesto de asistencia, justo cuando el gobierno quiere mostrarle superávit a los inversores.",
        opciones: [
          { etiqueta: "Ampliar el gasto social", texto: "Aumentar la asistencia social recortando obra pública menor, sosteniendo el equilibrio fiscal general.", efectos: { imagen_positiva: 5, salud_fiscal: -3, gobernabilidad: 2, orden_publico: 3 } },
          { etiqueta: "Sostener el superávit", texto: "Mantener el superávit como bandera de gestión y derivar el problema a ONGs con fondos limitados.", efectos: { salud_fiscal: 6, imagen_positiva: -6, orden_publico: -4 } },
          { etiqueta: "Endeudarse para asistir", texto: "Aumentar subsidios de transporte y asistencia social financiándolo con deuda de corto plazo en dólares.", efectos: { imagen_positiva: 7, intencion_voto: 4, salud_fiscal: -9, gobernabilidad: -2 } },
        ],
      },
      FSA: {
        enunciado:
          "El Estado provincial no puede sostener el ritmo actual de incorporaciones al empleo público, y el sector privado no genera empleo formal suficiente para compensarlo.",
        opciones: [
          { etiqueta: "Congelar el empleo público", texto: "Frenar el ingreso de nuevos agentes y lanzar créditos para el agro (algodón, ganadería).", efectos: { salud_fiscal: 6, imagen_positiva: -3, gobernabilidad: -2, intencion_voto: -3 } },
          { etiqueta: "Sostener el empleo público", texto: "Mantener el ingreso al empleo público como amortiguador social, pidiendo más transferencias discrecionales a Nación.", efectos: { imagen_positiva: 5, gobernabilidad: 5, salud_fiscal: -6, intencion_voto: 3 } },
          { etiqueta: "Plan mixto", texto: "Congelamiento parcial del empleo público combinado con un programa de obra pública financiado por Nación.", efectos: { imagen_positiva: 3, gobernabilidad: 2, salud_fiscal: 1, orden_publico: 1 } },
        ],
      },
      SFE: {
        enunciado:
          "Una sequía golpea la cosecha de soja y cereales y cae la recaudación ligada al agro, justo cuando se necesita financiar el operativo de seguridad en Rosario.",
        opciones: [
          { etiqueta: "Priorizar seguridad", texto: "Recortar infraestructura rural para reforzar de inmediato el operativo de seguridad en Rosario.", efectos: { orden_publico: 7, imagen_positiva: 4, salud_fiscal: -2, gobernabilidad: -3 } },
          { etiqueta: "Auxiliar al agro", texto: "Lanzar créditos blandos y diferimiento impositivo para el sector agroindustrial, postergando el refuerzo de seguridad.", efectos: { gobernabilidad: 6, salud_fiscal: -4, orden_publico: -5, imagen_positiva: -2 } },
          { etiqueta: "Pedir auxilio a Nación", texto: "Solicitar ayuda financiera extraordinaria a la Nación a cambio de acompañamiento legislativo.", efectos: { salud_fiscal: 5, imagen_positiva: 2, intencion_voto: -2, gobernabilidad: 3 } },
        ],
      },
      CHU: {
        enunciado:
          "La condonación de deuda y la baja de retenciones petroleras dejan margen fiscal nuevo, y los gremios estatales exigen recomponer de una sola vez los salarios atrasados.",
        opciones: [
          { etiqueta: "Recomponer todo ya", texto: "Usar todo el margen fiscal nuevo para recomponer los salarios atrasados de una sola vez.", efectos: { imagen_positiva: 7, orden_publico: 5, gobernabilidad: 4, salud_fiscal: -6 } },
          { etiqueta: "Recomponer y ahorrar", texto: "Recomponer de forma escalonada y destinar parte del margen a un fondo anticíclico petrolero.", efectos: { salud_fiscal: 6, imagen_positiva: 1, orden_publico: -3, gobernabilidad: 1 } },
          { etiqueta: "Pagar deuda vieja", texto: "No recomponer salarios por ahora y usar el margen fiscal para cancelar deuda con la Nación.", efectos: { salud_fiscal: 8, imagen_positiva: -6, orden_publico: -7, intencion_voto: -5 } },
        ],
      },
    },
  },
  {
    slug: "desarrollo_social",
    nombre: "Desarrollo Social",
    eje: "desarrollo_social",
    encuadre:
      "El área social recibe un reclamo urgente que no puede esperar al próximo ciclo presupuestario. El gabinete debe decidir cómo (y a costa de qué) responde.",
    problemas: {
      PBA: {
        enunciado:
          "Un relevamiento social muestra un fuerte aumento de la pobreza infantil en el conurbano, y los intendentes piden un plan de emergencia alimentaria.",
        opciones: [
          { etiqueta: "Plan de emergencia con deuda", texto: "Lanzar un plan de emergencia alimentaria financiado con endeudamiento, en articulación con los intendentes.", efectos: { imagen_positiva: 6, gobernabilidad: 5, salud_fiscal: -5 } },
          { etiqueta: "Redirigir partidas", texto: "Redirigir partidas de obra pública hacia comedores y asistencia social, sin pedir deuda nueva.", efectos: { imagen_positiva: 3, salud_fiscal: 2, orden_publico: 2, gobernabilidad: -2 } },
          { etiqueta: "Delegar en el territorio", texto: "Delegar la respuesta en movimientos sociales y organizaciones territoriales, con fondos acotados.", efectos: { gobernabilidad: 3, imagen_positiva: -4, orden_publico: -3 } },
        ],
      },
      CABA: {
        enunciado:
          "ONGs y la Legislatura porteña reclaman un plan integral de vivienda transitoria para personas en situación de calle antes del invierno.",
        opciones: [
          { etiqueta: "Plan integral de paradores", texto: "Crear un plan integral de paradores y vivienda transitoria con presupuesto ampliado.", efectos: { imagen_positiva: 6, salud_fiscal: -5, gobernabilidad: 2 } },
          { etiqueta: "Solo emergencia", texto: "Reforzar únicamente los dispositivos de emergencia nocturnos, sin un plan estructural.", efectos: { imagen_positiva: 1, salud_fiscal: 2, orden_publico: -1 } },
          { etiqueta: "Endurecer el espacio público", texto: "Endurecer el código de convivencia urbana para desalentar el acampe, en lugar de ampliar asistencia.", efectos: { intencion_voto: 5, imagen_positiva: -5, orden_publico: -4 } },
        ],
      },
      FSA: {
        enunciado:
          "Comunidades wichí y qom reclaman acceso urgente a agua potable en parajes rurales, con cobertura de organismos de DD.HH. y prensa nacional.",
        opciones: [
          { etiqueta: "Respuesta de emergencia", texto: "Lanzar un programa de perforación de pozos y camiones cisterna de emergencia con fondos propios.", efectos: { imagen_positiva: 5, salud_fiscal: -4, gobernabilidad: 3 } },
          { etiqueta: "Pedir ayuda externa", texto: "Solicitar financiamiento nacional/internacional para un plan de agua estructural, de respuesta más lenta.", efectos: { salud_fiscal: 3, imagen_positiva: 1, gobernabilidad: -1 } },
          { etiqueta: "Minimizar el reclamo", texto: "Evitar el conflicto mediático sin asignar fondos nuevos al reclamo.", efectos: { salud_fiscal: 2, imagen_positiva: -7, orden_publico: -3 } },
        ],
      },
      SFE: {
        enunciado:
          "Organizaciones sociales de barrios populares de Rosario piden un plan de inclusión para jóvenes en riesgo, como respuesta social a la violencia.",
        opciones: [
          { etiqueta: "Plan de inclusión joven", texto: "Crear un programa de empleo joven y becas en los barrios más golpeados por la violencia.", efectos: { imagen_positiva: 5, salud_fiscal: -3, orden_publico: 3 } },
          { etiqueta: "Solo seguridad", texto: "Priorizar exclusivamente el gasto en seguridad y postergar el plan social.", efectos: { orden_publico: 2, imagen_positiva: -3, intencion_voto: -2 } },
          { etiqueta: "Gesto simbólico", texto: "Anunciar el plan social pero con presupuesto simbólico, más como gesto comunicacional.", efectos: { imagen_positiva: 2, gobernabilidad: 1, orden_publico: -2 } },
        ],
      },
      CHU: {
        enunciado:
          "Comunidades mapuche reclaman por tierras vinculadas a la explotación de recursos naturales, en tensión directa con el sector petrolero.",
        opciones: [
          { etiqueta: "Mesa de diálogo y pausa", texto: "Abrir una mesa de diálogo formal y pausar temporalmente la actividad extractiva en la zona en conflicto.", efectos: { imagen_positiva: 5, salud_fiscal: -3, gobernabilidad: -3 } },
          { etiqueta: "Sostener la extracción", texto: "Sostener la actividad extractiva y ofrecer compensaciones económicas puntuales a las comunidades.", efectos: { gobernabilidad: 4, salud_fiscal: 1, imagen_positiva: -3, orden_publico: -4 } },
          { etiqueta: "Judicializar", texto: "Derivar el reclamo a la Justicia y esperar una resolución de tribunales antes de actuar.", efectos: { gobernabilidad: 1, imagen_positiva: -5, orden_publico: -6 } },
        ],
      },
    },
  },
  {
    slug: "seguridad",
    nombre: "Seguridad",
    eje: "seguridad",
    encuadre:
      "La agenda de seguridad exige una respuesta pública inmediata. Cualquier decisión (o la falta de ella) va a leerse como una señal política.",
    problemas: {
      PBA: {
        enunciado:
          "Una ola de asaltos violentos en el conurbano genera un reclamo urgente de intendentes y vecinos por más policía en la calle.",
        opciones: [
          { etiqueta: "Despliegue inmediato", texto: "Anunciar el despliegue masivo e inmediato de policía adicional en los municipios más afectados.", efectos: { imagen_positiva: 6, orden_publico: 5, salud_fiscal: -4 } },
          { etiqueta: "Plan de mediano plazo", texto: "Lanzar un plan de cámaras e inteligencia criminal con Nación, sin anuncio de despliegue inmediato.", efectos: { gobernabilidad: 4, orden_publico: 2, imagen_positiva: -2 } },
          { etiqueta: "Delegar en municipios", texto: "Responder que la seguridad urbana es, en gran parte, un problema municipal.", efectos: { gobernabilidad: -5, imagen_positiva: -6, orden_publico: -3 } },
        ],
      },
      CABA: {
        enunciado:
          "Crece la percepción de inseguridad en zonas turísticas y comerciales; la oposición libertaria acusa al gobierno porteño de \"gestión prolija pero blanda\".",
        opciones: [
          { etiqueta: "Más policía y cámaras", texto: "Aumentar fuertemente la presencia de la Policía de la Ciudad y las cámaras en zonas comerciales.", efectos: { imagen_positiva: 5, orden_publico: 5, salud_fiscal: -3 } },
          { etiqueta: "Sostener el enfoque actual", texto: "Mantener la estrategia de \"gestión prolija\" vigente, sin cambios visibles de despliegue.", efectos: { gobernabilidad: 2, imagen_positiva: -3, intencion_voto: -4 } },
          { etiqueta: "Discurso de mano dura", texto: "Adoptar un discurso de mano dura más agresivo, alineado a la demanda libertaria.", efectos: { intencion_voto: 6, imagen_positiva: 2, salud_fiscal: -5, gobernabilidad: -2 } },
        ],
      },
      FSA: {
        enunciado:
          "Organismos de DD.HH. cuestionan el uso de las fuerzas de seguridad provinciales para desalentar protestas de la oposición minoritaria.",
        opciones: [
          { etiqueta: "Reformar protocolos", texto: "Reformar los protocolos de actuación policial y abrir el organismo a auditoría externa.", efectos: { imagen_positiva: 5, gobernabilidad: -3, orden_publico: -1 } },
          { etiqueta: "Sostener el esquema", texto: "Sostener el esquema actual de control territorial sin cambios.", efectos: { gobernabilidad: 5, imagen_positiva: -4, orden_publico: 2 } },
          { etiqueta: "Reforma cosmética", texto: "Anunciar una reforma de protocolos sin cambios reales de fondo.", efectos: { imagen_positiva: -1, gobernabilidad: 2, orden_publico: 1 } },
        ],
      },
      SFE: {
        enunciado:
          "Un hecho de violencia narco de alto impacto mediático en Rosario obliga a definir la estrategia de seguridad frente a la opinión pública nacional.",
        opciones: [
          { etiqueta: "Pedir fuerzas federales", texto: "Solicitar formalmente la intervención y refuerzo de fuerzas federales en Rosario.", efectos: { orden_publico: 6, imagen_positiva: 3, gobernabilidad: -2 } },
          { etiqueta: "Solo fuerzas provinciales", texto: "Reforzar exclusivamente con fuerzas provinciales para mostrar autosuficiencia.", efectos: { gobernabilidad: 4, imagen_positiva: -2, orden_publico: 1, salud_fiscal: -4 } },
          { etiqueta: "Refuerzo + mano dura", texto: "Combinar el pedido de refuerzo federal con un discurso público de mano dura total.", efectos: { imagen_positiva: 7, intencion_voto: 5, orden_publico: 3, salud_fiscal: -3, gobernabilidad: -3 } },
        ],
      },
      CHU: {
        enunciado:
          "Un corte de ruta prolongado por un reclamo gremial estatal empieza a afectar el traslado de crudo, y las petroleras presionan para que el gobierno intervenga.",
        opciones: [
          { etiqueta: "Negociar y ceder", texto: "Negociar directamente con el gremio y ceder parte del reclamo para liberar la ruta rápido.", efectos: { orden_publico: 5, gobernabilidad: 3, salud_fiscal: -4 } },
          { etiqueta: "Desalojo judicial", texto: "Pedir el desalojo judicial y policial del corte para garantizar la actividad petrolera.", efectos: { imagen_positiva: -4, intencion_voto: 3, orden_publico: -3, gobernabilidad: -2 } },
          { etiqueta: "Dejar correr el conflicto", texto: "Evitar una decisión firme mientras se busca una salida política de fondo.", efectos: { imagen_positiva: -6, orden_publico: -6, salud_fiscal: -2 } },
        ],
      },
    },
  },
  {
    slug: "crisis_interna",
    nombre: "Crisis Interna",
    eje: "crisis_interna",
    encuadre:
      "La amenaza no viene de afuera: es una tensión dentro del propio espacio político. El gabinete tiene que decidir hacia adentro sin que se note demasiado hacia afuera.",
    problemas: {
      PBA: {
        enunciado:
          "Un sector de intendentes del conurbano amenaza con romper el bloque legislativo propio si no se les garantiza más presupuesto municipal.",
        opciones: [
          { etiqueta: "Ceder presupuesto", texto: "Ceder presupuesto adicional a los intendentes díscolos para sostener la unidad del bloque.", efectos: { gobernabilidad: 6, salud_fiscal: -5, imagen_positiva: -1 } },
          { etiqueta: "Enfrentarlos", texto: "Enfrentar públicamente a los intendentes díscolos y sostener la distribución actual.", efectos: { imagen_positiva: 2, gobernabilidad: -6, orden_publico: -2 } },
          { etiqueta: "Mediación partidaria", texto: "Buscar un mediador partidario externo para recomponer el vínculo sin ceder presupuesto de inmediato.", efectos: { gobernabilidad: 2, imagen_positiva: 1, salud_fiscal: 1 } },
        ],
      },
      CABA: {
        enunciado:
          "Legisladores propios presionan para correr el discurso de gobierno hacia el electorado libertario, arriesgando el perfil moderado tradicional.",
        opciones: [
          { etiqueta: "Correrse a la derecha", texto: "Correr el discurso hacia el electorado libertario para no perder votos jóvenes.", efectos: { intencion_voto: 6, imagen_positiva: -3, gobernabilidad: -2 } },
          { etiqueta: "Sostener el centro", texto: "Sostener el perfil moderado tradicional de \"gestión prolija\" sin cambios de discurso.", efectos: { gobernabilidad: 4, imagen_positiva: 2, intencion_voto: -4 } },
          { etiqueta: "Acuerdo electoral", texto: "Buscar un acuerdo electoral explícito con el espacio libertario de cara a 2027.", efectos: { gobernabilidad: 3, intencion_voto: 4, imagen_positiva: -2 } },
        ],
      },
      FSA: {
        enunciado:
          "El bloque legislativo nacional propio debe definir su voto en una votación clave, presionado por gobernadores confrontativos y por un oficialismo nacional que ofrece más fondos a cambio de acompañamiento.",
        opciones: [
          { etiqueta: "Alinear con Nación", texto: "Alinear el bloque con el oficialismo nacional a cambio de mayores transferencias discrecionales.", efectos: { salud_fiscal: 6, gobernabilidad: 3, imagen_positiva: -2 } },
          { etiqueta: "Sostener a los confrontativos", texto: "Sostener la alianza con los gobernadores más confrontativos, aun a costo de menos fondos.", efectos: { imagen_positiva: 3, intencion_voto: 2, salud_fiscal: -5 } },
          { etiqueta: "Dividir el bloque", texto: "Dividir el bloque para no romper explícitamente con ninguno de los dos lados.", efectos: { gobernabilidad: -4, imagen_positiva: -3, salud_fiscal: 1 } },
        ],
      },
      SFE: {
        enunciado:
          "Los socios de la coalición de gobierno presionan por un ajuste fiscal más duro, mientras los sindicatos amenazan un paro si eso afecta los salarios estatales.",
        opciones: [
          { etiqueta: "Avanzar con el ajuste", texto: "Avanzar con el ajuste que piden los socios de la coalición, aceptando el conflicto sindical.", efectos: { salud_fiscal: 6, orden_publico: -5, gobernabilidad: 2 } },
          { etiqueta: "Frenar el ajuste", texto: "Frenar el ajuste para evitar el paro, a costa de tensionar con los socios de la coalición.", efectos: { orden_publico: 3, gobernabilidad: -4, salud_fiscal: -3 } },
          { etiqueta: "Ajuste negociado", texto: "Buscar un ajuste intermedio negociado con los sindicatos antes de anunciarlo.", efectos: { gobernabilidad: 3, salud_fiscal: 2, imagen_positiva: 2 } },
        ],
      },
      CHU: {
        enunciado:
          "Dentro del espacio \"Provincias Unidas\", un sector interno cuestiona el acercamiento cada vez más fluido del gobernador con la Casa Rosada.",
        opciones: [
          { etiqueta: "Profundizar el acercamiento", texto: "Profundizar el acercamiento con Nación, ya en curso por la condonación de deuda, pese al ruido interno.", efectos: { salud_fiscal: 5, gobernabilidad: -3, imagen_positiva: 2 } },
          { etiqueta: "Reforzar la autonomía", texto: "Frenar el acercamiento y reforzar el perfil autónomo de \"Provincias Unidas\".", efectos: { gobernabilidad: 4, imagen_positiva: 1, salud_fiscal: -4 } },
          { etiqueta: "Ambigüedad calculada", texto: "Mantener ambigüedad pública mientras se negocia en privado con ambos sectores.", efectos: { gobernabilidad: -2, imagen_positiva: -3, intencion_voto: -1 } },
        ],
      },
    },
  },
  {
    slug: "salud",
    nombre: "Salud",
    eje: "salud",
    encuadre:
      "El sistema de salud provincial atraviesa una situación límite. El gabinete tiene minutos para decidir una respuesta antes de que el tema escale en agenda pública.",
    problemas: {
      PBA: {
        enunciado:
          "El sindicato de salud pública amenaza un paro por paritarias, en pleno pico de demanda en hospitales del conurbano.",
        opciones: [
          { etiqueta: "Recomponer por encima", texto: "Cerrar una recomposición salarial por encima de lo presupuestado para evitar el paro.", efectos: { orden_publico: 5, gobernabilidad: 3, salud_fiscal: -6 } },
          { etiqueta: "Sostener la oferta", texto: "Sostener la oferta salarial original y afrontar el paro.", efectos: { salud_fiscal: 4, orden_publico: -6, imagen_positiva: -4 } },
          { etiqueta: "Recomposición parcial", texto: "Ofrecer una recomposición parcial, escalonada en el tiempo.", efectos: { gobernabilidad: 2, salud_fiscal: -2, orden_publico: 1, imagen_positiva: 1 } },
        ],
      },
      CABA: {
        enunciado:
          "Los profesionales de salud del sistema porteño reclaman equiparación salarial con otras jurisdicciones, en medio de un año electoral.",
        opciones: [
          { etiqueta: "Otorgar la equiparación", texto: "Otorgar la equiparación salarial reclamada, usando parte del superávit fiscal.", efectos: { imagen_positiva: 5, salud_fiscal: -5, gobernabilidad: 2 } },
          { etiqueta: "Rechazar el reclamo", texto: "Rechazar el reclamo para sostener el superávit como bandera de gestión.", efectos: { salud_fiscal: 6, imagen_positiva: -5, orden_publico: -3 } },
          { etiqueta: "Bono no remunerativo", texto: "Ofrecer un bono no remunerativo en lugar de un aumento de base.", efectos: { imagen_positiva: 1, salud_fiscal: 2, orden_publico: -1 } },
        ],
      },
      FSA: {
        enunciado:
          "Se conoce un caso de desabastecimiento de insumos básicos en un hospital del interior provincial, con repercusión en medios nacionales.",
        opciones: [
          { etiqueta: "Compra de urgencia", texto: "Comprar de urgencia los insumos con fondos de otras áreas y comunicar una respuesta inmediata.", efectos: { imagen_positiva: 5, salud_fiscal: -4, gobernabilidad: 1 } },
          { etiqueta: "Minimizar el hecho", texto: "Minimizar el hecho públicamente como \"un caso aislado\", sin anuncios de fondo.", efectos: { salud_fiscal: 2, imagen_positiva: -7, orden_publico: -2 } },
          { etiqueta: "Plan integral lento", texto: "Anunciar un plan integral de reequipamiento hospitalario financiado por Nación, de implementación lenta.", efectos: { imagen_positiva: 2, salud_fiscal: 1, gobernabilidad: 2 } },
        ],
      },
      SFE: {
        enunciado:
          "El aumento de heridos por hechos de violencia satura las guardias de los hospitales públicos de Rosario.",
        opciones: [
          { etiqueta: "Refuerzo de urgencia", texto: "Reforzar de urgencia personal y equipamiento de las guardias de Rosario con fondos extraordinarios.", efectos: { imagen_positiva: 5, salud_fiscal: -4, orden_publico: 2 } },
          { etiqueta: "Redistribuir recursos", texto: "Redistribuir recursos de hospitales del interior hacia Rosario, sin fondos nuevos.", efectos: { gobernabilidad: -3, salud_fiscal: 1, imagen_positiva: -1 } },
          { etiqueta: "Pedir ayuda a Nación", texto: "Pedir asistencia sanitaria de emergencia a Nación, en articulación con el pedido de seguridad.", efectos: { salud_fiscal: 4, imagen_positiva: 2, gobernabilidad: 2 } },
        ],
      },
      CHU: {
        enunciado:
          "Con el nuevo margen fiscal por la baja de retenciones petroleras, el sindicato de salud exige que la mejora se traduzca en insumos e infraestructura hospitalaria postergada por años.",
        opciones: [
          { etiqueta: "Invertir en salud", texto: "Destinar buena parte del nuevo margen fiscal a infraestructura y equipamiento hospitalario.", efectos: { imagen_positiva: 6, salud_fiscal: -5, gobernabilidad: 3 } },
          { etiqueta: "Priorizar deuda y salarios", texto: "Priorizar el pago de deuda y salarios atrasados generales antes que infraestructura de salud específica.", efectos: { salud_fiscal: 5, imagen_positiva: -3, orden_publico: -2 } },
          { etiqueta: "Obra a mediano plazo", texto: "Anunciar un plan de obra hospitalaria a mediano plazo, financiado con un crédito internacional.", efectos: { imagen_positiva: 3, salud_fiscal: -1, gobernabilidad: 1 } },
        ],
      },
    },
  },
];

const SALAS_CRISIS = [
  {
    slug: "crisis_comunicacional",
    nombre: "Sala de Crisis 1 — Crisis de Comunicación",
    orden_crisis: 1,
    caso_critico:
      "Se filtra a la prensa nacional un audio interno del gabinete provincial discutiendo, en términos crudos, el costo político de una decisión reciente. El material se viraliza en minutos. El/la Jefe/a de Gabinete tiene que salir a dar la cara ante los medios (representados por el jurado) sin guion previo, sosteniendo un relato coherente con lo actuado en las salas anteriores y administrando la incertidumbre sobre qué más podría filtrarse.",
  },
  {
    slug: "crisis_seguridad",
    nombre: "Sala de Crisis 2 — Crisis de Orden Público",
    orden_crisis: 2,
    caso_critico:
      "Un episodio de violencia con repercusión nacional (una protesta que deriva en incidentes, o un hecho delictivo de alto impacto) pone al gobierno provincial bajo el foco de la opinión pública en tiempo real. El jurado, en el rol de prensa y organismos de control, interpela al equipo para que explique en el momento qué va a hacer y por qué, exigiendo definiciones concretas y no solo gestos.",
  },
  {
    slug: "crisis_fiscal",
    nombre: "Sala de Crisis 3 — Crisis Fiscal",
    orden_crisis: 3,
    caso_critico:
      "La Nación anuncia, sin previo aviso, un recorte extraordinario de transferencias a las provincias por un desequilibrio macroeconómico sobreviniente. El gabinete tiene que comunicar en el momento, ante el jurado (en el rol de acreedores, gremios estatales y prensa económica), cómo va a sostener el funcionamiento del Estado provincial sin entrar en default ni en un conflicto social inmanejable.",
  },
];

const ORDEN_TEMATICAS = ["economia", "desarrollo_social", "seguridad", "crisis_interna", "salud"];

const EQUIPOS = [
  {
    codigo: "PBA",
    pin: "2001",
    nombre: "Provincia de Buenos Aires",
    contexto_arranque:
      "Partido dominante estructuralmente competitivo aunque no monolítico: fuerte en el conurbano (intendentes con poder territorial propio, sindicatos, movimientos sociales) y más disputado en el interior, donde compite con fuerzas de derecha ligadas al agro. Relación estructuralmente tensa con la Nación por la coparticipación, más allá del signo político que la gobierne.",
    objetivos_generales: [
      "Sostener el equilibrio entre los intendentes del conurbano y el interior productivo",
      "Disputar más recursos de coparticipación a la Nación",
      "Contener la conflictividad social y sindical sin perder gobernabilidad",
    ],
    tension_interna:
      "Interna partidaria visible que resta consenso puertas adentro; la gobernabilidad depende en gran medida de sostener el equilibrio entre intendentes.",
  },
  {
    codigo: "CABA",
    pin: "2002",
    nombre: "Ciudad Autónoma de Buenos Aires",
    contexto_arranque:
      "Electorado urbano de ingresos medios y medios-altos, con alta polarización entre un núcleo tradicional de centroderecha (identificado con la gestión \"prolija\") y un electorado más joven y golpeado que se corrió hacia opciones libertarias. Cuentas fiscales relativamente ordenadas con superávit primario como bandera, y un acercamiento explícito a la Nación de cara a 2027.",
    objetivos_generales: [
      "Sostener el superávit fiscal como sello de gestión",
      "Contener el crecimiento del gasto social urgente sin resignar el equilibrio de las cuentas",
      "Administrar la competencia electoral creciente por la derecha del espectro",
    ],
    tension_interna:
      "Tensión entre el ala tradicional de centroderecha y el electorado libertario más joven y golpeado de bolsillo.",
  },
  {
    codigo: "FSA",
    pin: "2003",
    nombre: "Provincia de Formosa",
    contexto_arranque:
      "Estructura político-partidaria provincial fuertemente consolidada, con baja alternancia histórica en el Poder Ejecutivo y una oposición institucional minoritaria. Alta dependencia de las transferencias discrecionales y de la coparticipación federal por baja recaudación propia. Economía postergada, con el empleo público como principal empleador formal.",
    objetivos_generales: [
      "Sostener el flujo de transferencias y coparticipación desde la Nación",
      "Administrar el empleo público como amortiguador social sin quebrar las cuentas",
      "Responder a los señalamientos de organismos de DD.HH. y prensa nacional sin ceder gobernabilidad interna",
    ],
    tension_interna:
      "Fuertes desigualdades socioeconómicas y reclamos históricos de comunidades indígenas conviven con alta gobernabilidad interna y bajo nivel de conflictividad social visible en el corto plazo.",
  },
  {
    codigo: "SFE",
    pin: "2004",
    nombre: "Provincia de Santa Fe",
    contexto_arranque:
      "Base electoral urbana concentrada en Rosario, con un peso relevante del interior agroindustrial. Una coalición de centro y centroderecha llegó a la gobernación apoyada en el reclamo de mayor seguridad y gestión. Motor agroexportador de primer orden (soja, cereales, complejo oleaginoso) con alta sensibilidad a sequías y precios internacionales.",
    objetivos_generales: [
      "Resolver la agenda de seguridad ligada al narcotráfico en Rosario",
      "Sostener la previsibilidad para la inversión agroindustrial y portuaria",
      "Mantener la cohesión de la coalición de gobierno frente a la agenda de ajuste fiscal",
    ],
    tension_interna:
      "La violencia asociada al narcotráfico en Rosario es el problema de agenda dominante, con fuerte exposición mediática nacional.",
  },
  {
    codigo: "CHU",
    pin: "2005",
    nombre: "Provincia de Chubut",
    contexto_arranque:
      "Base electoral pequeña y territorialmente dispersa, con fuerte peso de empleados públicos y de trabajadores del sector hidrocarburífero y pesquero. Fuerte dependencia de la renta petrolera y de las transferencias nacionales; hoy en un momento favorable por la condonación de deuda y la baja de retenciones petroleras, tras un historial de conflicto por regalías y atrasos salariales.",
    objetivos_generales: [
      "Sostener el pago en término de los sueldos estatales sin profundizar el endeudamiento",
      "Aprovechar el nuevo margen fiscal sin perder el vínculo pragmático con la Nación",
      "Administrar la tensión entre la actividad extractiva y los reclamos territoriales mapuche",
    ],
    tension_interna:
      "Historial de paros docentes prolongados, cortes de ruta por atraso salarial y conflictos territoriales vinculados a la actividad extractiva.",
  },
];

const STAFF = [
  { username: "admin", password: "admin123", staff_rol: "admin", nombre: "Organización general", sala: null },
  { username: "facilitador1", password: "facil123", staff_rol: "facilitador", nombre: "Facilitador — Economía", sala: "economia" },
  { username: "facilitador2", password: "facil123", staff_rol: "facilitador", nombre: "Facilitador — Desarrollo Social", sala: "desarrollo_social" },
  { username: "facilitador3", password: "facil123", staff_rol: "facilitador", nombre: "Facilitador — Seguridad", sala: "seguridad" },
  { username: "facilitador4", password: "facil123", staff_rol: "facilitador", nombre: "Facilitador — Crisis Interna", sala: "crisis_interna" },
  { username: "facilitador5", password: "facil123", staff_rol: "facilitador", nombre: "Facilitador — Salud", sala: "salud" },
  { username: "jurado1", password: "jurado123", staff_rol: "jurado", nombre: "Jurado — Salas de Crisis", sala: null },
];

function run() {
  if (alreadySeeded()) {
    console.log("[seed] Ya existe una jornada cargada. No se vuelve a sembrar.");
    return;
  }

  const insertMany = db.transaction(() => {
    const jornadaId = uuid();
    db.prepare(
      `INSERT INTO jornada (id, nombre, estado) VALUES (?, ?, 'en_curso')`
    ).run(jornadaId, "Jornada Demo — Gabinetes Provinciales");

    const rolId = uuid();
    db.prepare(
      `INSERT INTO rol (id, slug, nombre, objetivo_secreto, orden) VALUES (?, ?, ?, ?, 1)`
    ).run(
      rolId,
      "jefe_gabinete",
      "Jefe/a de Gabinete de Ministros",
      "Sostener la gobernabilidad del equipo sin resignar más de lo necesario en Imagen Positiva: coordiná al gabinete para que cada decisión tenga un relato defendible puertas afuera, incluso cuando el resultado interno sea incómodo."
    );

    const salaIdBySlug = {};

    for (const s of SALAS_TEMATICAS) {
      const id = uuid();
      salaIdBySlug[s.slug] = id;
      const problemasNormalizados = {};
      for (const [codigoEquipo, problema] of Object.entries(s.problemas)) {
        problemasNormalizados[codigoEquipo] = {
          enunciado: problema.enunciado,
          opciones: problema.opciones.map((op, idx) => ({
            codigo: ["A", "B", "C"][idx],
            etiqueta: op.etiqueta,
            texto: op.texto,
            efectos: op.efectos,
            cartelito: ["A", "B", "C"][idx],
          })),
        };
      }
      db.prepare(
        `INSERT INTO sala (id, slug, nombre, eje, tipo, encuadre, problemas_json, apertura_json)
         VALUES (?, ?, ?, ?, 'tematica', ?, ?, ?)`
      ).run(
        id,
        s.slug,
        s.nombre,
        s.eje,
        s.encuadre,
        JSON.stringify(problemasNormalizados),
        JSON.stringify(APERTURA_GENERICA)
      );
    }

    for (const c of SALAS_CRISIS) {
      const id = uuid();
      salaIdBySlug[c.slug] = id;
      db.prepare(
        `INSERT INTO sala (id, slug, nombre, tipo, orden_crisis, caso_critico)
         VALUES (?, ?, ?, 'crisis', ?, ?)`
      ).run(id, c.slug, c.nombre, c.orden_crisis, c.caso_critico);

      db.prepare(
        `INSERT INTO crisis_estado (id, jornada_id, sala_id, disparada) VALUES (?, ?, ?, 0)`
      ).run(uuid(), jornadaId, id);
    }

    EQUIPOS.forEach((eq, idx) => {
      const equipoId = uuid();
      const orden = rotate(ORDEN_TEMATICAS, idx);
      db.prepare(
        `INSERT INTO equipo
          (id, jornada_id, nombre, carpeta_numero, codigo, pin, contexto_arranque, objetivos_generales, tension_interna, ejes_json, orden_rotacion_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        equipoId,
        jornadaId,
        eq.nombre,
        idx + 1,
        eq.codigo,
        eq.pin,
        eq.contexto_arranque,
        JSON.stringify(eq.objetivos_generales),
        eq.tension_interna,
        JSON.stringify(ejesIniciales()),
        JSON.stringify(orden)
      );

      orden.forEach((salaSlug, ordenIndex) => {
        db.prepare(
          `INSERT INTO paso_recorrido (id, equipo_id, sala_id, orden_index, estado)
           VALUES (?, ?, ?, ?, 'pendiente')`
        ).run(uuid(), equipoId, salaIdBySlug[salaSlug], ordenIndex);
      });
    });

    for (const s of STAFF) {
      db.prepare(
        `INSERT INTO usuario (id, tipo, nombre, staff_rol, sala_asignada_id, username, password_hash)
         VALUES (?, 'staff', ?, ?, ?, ?, ?)`
      ).run(
        uuid(),
        s.nombre,
        s.staff_rol,
        s.sala ? salaIdBySlug[s.sala] : null,
        s.username,
        bcrypt.hashSync(s.password, 10)
      );
    }

    console.log("[seed] Listo: 5 provincias, 5 salas tematicas (75 opciones), 3 salas de crisis.");
    console.log("[seed] Codigos de equipo (codigo / PIN):");
    EQUIPOS.forEach((e) => console.log(`         ${e.codigo} / ${e.pin}  — ${e.nombre}`));
    console.log("[seed] Credenciales de staff (usuario / contraseña):");
    STAFF.forEach((s) => console.log(`         ${s.username} / ${s.password}  (${s.staff_rol})`));
  });

  insertMany();
}

// Borra TODO el estado de juego (equipos, decisiones, crisis, ajustes,
// staff) y vuelve a sembrar desde cero, con los mismos codigos/PIN y
// credenciales de siempre. Usado por el boton "Reiniciar jornada" del panel
// de administracion (server/routes/admin.js) para volver todo a cero sin
// tener que borrar el archivo de base de datos ni reiniciar el proceso.
const TABLAS_A_LIMPIAR = [
  "decision",
  "evaluacion_crisis",
  "puntaje_ajuste",
  "paso_recorrido",
  "crisis_estado",
  "usuario",
  "equipo",
  "sala",
  "rol",
  "jornada",
  "evento_log",
];

function limpiarTodo() {
  const tx = db.transaction(() => {
    for (const tabla of TABLAS_A_LIMPIAR) db.prepare(`DELETE FROM ${tabla}`).run();
  });
  tx();
}

function resetAndReseed() {
  limpiarTodo();
  run();
}

if (require.main === module) {
  run();
  process.exit(0);
}

module.exports = { run, resetAndReseed };
