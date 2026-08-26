// Seed inicial de datos — carga el contenido real del manual del facilitador
// (Carpetas de gobierno, objetivos por rol, y las 5 salas tematicas + Sala 6 de crisis).
// Es idempotente: si ya hay una jornada cargada, no vuelve a insertar.

const { v4: uuid } = require("uuid");
const bcrypt = require("bcryptjs");
const db = require("./db");

function alreadySeeded() {
  const row = db.prepare("SELECT COUNT(*) as c FROM jornada").get();
  return row.c > 0;
}

function run() {
  if (alreadySeeded()) {
    console.log("[seed] Ya existe una jornada cargada. No se vuelve a sembrar.");
    return;
  }

  const insertMany = db.transaction(() => {
    // ---------------------------------------------------------------
    // Jornada
    // ---------------------------------------------------------------
    const jornadaId = uuid();
    db.prepare(
      `INSERT INTO jornada (id, nombre, estado) VALUES (?, ?, 'planificada')`
    ).run(jornadaId, "Jornada Demo — Sala de Escape Política");

    db.prepare(
      `INSERT INTO crisis_estado (id, jornada_id, disparada) VALUES (?, ?, 0)`
    ).run(uuid(), jornadaId);

    // ---------------------------------------------------------------
    // Roles (Parte II del manual — objetivo individual y secreto)
    // ---------------------------------------------------------------
    const roles = [
      {
        slug: "presidente",
        nombre: "Presidente/a",
        objetivo:
          "Tu objetivo: que ninguna decisión resuelva el problema de hoy generando uno mayor el día de mañana.",
      },
      {
        slug: "jefe_gabinete",
        nombre: "Jefe/a de Gabinete de Ministros",
        objetivo:
          "Tu objetivo: que ninguna decisión se cierre sin haber dado lugar a la posición más incómoda del equipo, aunque cueste más tiempo.",
      },
      {
        slug: "min_economia",
        nombre: "Ministro/a de Economía",
        objetivo:
          "Tu objetivo: medir el costo real de una decisión antes de acompañarla, aunque el resto del equipo la vea como innegociable.",
      },
      {
        slug: "min_desarrollo_social",
        nombre: "Ministro/a de Desarrollo Social",
        objetivo:
          "Tu objetivo: que la voz de quienes tienen menos poder sea tenida en cuenta cuando se discuta el funcionamiento del poder mismo.",
      },
      {
        slug: "min_seguridad",
        nombre: "Ministro/a de Seguridad",
        objetivo:
          "Tu objetivo: evaluar si una decisión puede generar una reacción social organizada, capaz de sostenerse en el tiempo.",
      },
      {
        slug: "diputado_1",
        nombre: "Diputado/a 1",
        objetivo:
          "Tu objetivo: identificar qué gobiernos podrían resistirse a una concentración de poder, y por qué.",
      },
      {
        slug: "diputado_2",
        nombre: "Diputado/a 2",
        objetivo:
          "Tu objetivo: detectar con qué gobiernos rivales se podría compartir una postura sobre la apertura o el cierre de la economía.",
      },
    ];
    const rolIns = db.prepare(
      `INSERT INTO rol (id, slug, nombre, objetivo_secreto, orden) VALUES (?, ?, ?, ?, ?)`
    );
    const rolIds = {};
    roles.forEach((r, i) => {
      const id = uuid();
      rolIds[r.slug] = id;
      rolIns.run(id, r.slug, r.nombre, r.objetivo, i);
    });

    // ---------------------------------------------------------------
    // Salas (Parte IV del manual)
    // ---------------------------------------------------------------
    const salaIns = db.prepare(`
      INSERT INTO sala (id, slug, nombre, tipo, proyecto_ley_nombre, encuadre, caso_critico, decision_tipo, opciones_json, apertura_json)
      VALUES (@id, @slug, @nombre, @tipo, @proyecto_ley_nombre, @encuadre, @caso_critico, @decision_tipo, @opciones_json, @apertura_json)
    `);

    const salas = [
      {
        slug: "constitucional",
        nombre: "Sala 1 — Constitucional",
        tipo: "tematica",
        proyecto_ley_nombre: "Reforma para la Gobernabilidad (régimen de reelección)",
        encuadre:
          "Faltan seis meses para el cierre del período legislativo. El propio bloque de gobierno cuenta con los votos necesarios en ambas cámaras para avanzar, si así lo decide, con una reforma constitucional.",
        caso_critico:
          "Un legislador propio de peso territorial presentó un proyecto que habilita la reelección indefinida del Jefe de Gobierno o Presidente. La noticia se filtró antes de lo previsto: un sondeo interno llegó a la prensa esta mañana y muestra a la militancia propia dividida (54% a favor, 46% en contra). Los principales bloques opositores ya convocaron una conferencia de prensa conjunta para esta tarde bajo el título \"Alerta institucional: vocación hegemónica\". El equipo tiene que fijar una postura oficial antes de que el proyecto se trate mañana en comisión.",
        decision_tipo: "binaria",
        opciones: [
          {
            codigo: "SI",
            etiqueta: "SÍ, habilitar la reelección indefinida",
            consecuencia:
              "Se consolida una herramienta de poder real a futuro, pero la oposición y los organismos de control ganan un argumento permanente contra el gobierno, que va a reaparecer en cada sala siguiente y en el recinto final.",
            impacto_presupuestario:
              "Se abre una partida extraordinaria para financiar el proceso de reforma (convención, campaña de difusión institucional) y crece el gasto en aparato político-electoral de cara a los meses siguientes.",
          },
          {
            codigo: "NO",
            etiqueta: "NO, rechazar el proyecto y sostener el límite constitucional",
            consecuencia:
              "Se resigna esa herramienta, pero se suma crédito institucional que se puede capitalizar más adelante — especialmente útil de cara a la sesión legislativa de cierre.",
            impacto_presupuestario:
              "Se redirigen recursos hacia el fortalecimiento de organismos de control (Consejo de la Magistratura, auditoría interna) como gesto institucional — incremento moderado de esas partidas.",
          },
        ],
        apertura: {
          A: "La prensa ya instaló que \"este gobierno no se guarda nada\". El proyecto de reelección se lee como una confirmación más de ese estilo, y la oposición lo usa para reforzar la denuncia de autoritarismo incluso antes de que el equipo diga una palabra.",
          B: "Un cronista pregunta con sorpresa si \"el gobierno dialoguista\" ahora quiere eternizarse en el poder. El contraste con la imagen previa genera más ruido mediático del que generaría la misma medida en un gobierno de mano firme.",
        },
      },
      {
        slug: "economia",
        nombre: "Sala 2 — Economía",
        tipo: "tematica",
        proyecto_ley_nombre: "Ley de Régimen de Importaciones",
        encuadre:
          "La inflación interanual del país-ficción es del 35%. Tres actores presionan al mismo tiempo, con demandas incompatibles entre sí.",
        caso_critico:
          "La Cámara Argentina de la Mediana Industria (CAMI) advierte que una apertura de importaciones sin gradualidad puede costar 40.000 empleos directos en menos de un año. El mismo día, una organización de consumidores presenta un petitorio con 80.000 firmas exigiendo bajar aranceles para bajar la suba de precios de alimentos y electrodomésticos. La principal entidad del agro condiciona su apoyo político al gobierno a que cualquier apertura venga acompañada de una baja de retenciones a las exportaciones. El equipo tiene que resolver antes de que se anuncie, ya comprometido públicamente, el paquete de medidas económicas del mes.",
        decision_tipo: "tres_opciones",
        opciones: [
          {
            codigo: "A",
            etiqueta: "Apertura total e inmediata de importaciones",
            consecuencia:
              "Baja de precios inmediata y buena repercusión en consumidores, pero un sindicato industrial de peso anuncia un paro parcial para la semana siguiente.",
            impacto_presupuestario:
              "Caída inmediata de la recaudación por aranceles de importación — se resigna una fuente de ingreso fiscal que hay que cubrir recortando o reasignando en otra área del presupuesto.",
          },
          {
            codigo: "B",
            etiqueta: "Mantener la protección actual y negociar productividad a cambio",
            consecuencia:
              "Conformidad de industriales y sindicatos, pero la inflación no cede y los medios instalan la idea de \"un gobierno que no ataca el problema de fondo\".",
            impacto_presupuestario:
              "Se crea o amplía una línea de crédito subsidiado para la industria a cambio del compromiso de productividad — nueva partida de gasto en el Ministerio de Producción.",
          },
          {
            codigo: "C",
            etiqueta: "Apertura gradual y sectorial, con cronograma y cláusulas de salvaguarda",
            consecuencia:
              "Nadie festeja con entusiasmo, pero tampoco nadie se moviliza en contra — a cambio, el gobierno queda expuesto a la crítica de \"no define nada con claridad\".",
            impacto_presupuestario:
              "Se crea un fondo de compensación/salvaguarda para los sectores afectados durante la transición, financiado en parte por los aranceles que todavía se cobran mientras dura el cronograma.",
          },
        ],
        apertura: {
          A: "La cámara industrial ya da por hecho que este equipo va a abrir importaciones \"porque así gobierna\" y organiza una movilización preventiva frente al Ministerio, antes de que se anuncie nada.",
          B: "El sector agroexportador presiona con expectativa alta de lograr una mesa de diálogo con concesiones reales — decepcionarlos ahora cuesta más caro que si esa expectativa nunca hubiese existido.",
          C: "Los tres sectores (industriales, consumidores, agroexportadores) piden por igual \"previsibilidad, no sorpresas\". Esperan un cambio medido, y cualquier gesto brusco —hacia cualquier lado— los toma desprevenidos y genera más ruido del esperado.",
        },
      },
      {
        slug: "educacion",
        nombre: "Sala 3 — Educación",
        tipo: "tematica",
        proyecto_ley_nombre: "Ley de ESI y Financiamiento Educativo",
        encuadre: "Dos temas llegan atados a la misma sesión y el equipo tiene que resolver ambos con una sola decisión de fondo.",
        caso_critico:
          "Una federación que agrupa a escuelas de gestión privada confesional presentó un amparo judicial contra la aplicación obligatoria de los nuevos contenidos de Educación Sexual Integral en sus establecimientos, invocando objeción de conciencia institucional. El mismo día, el sindicato docente mayoritario anuncia que evalúa un paro si el próximo presupuesto no garantiza que no se recorten fondos a la escuela pública para sostener el subsidio a la privada. El Ministerio de Educación tiene una respuesta pública comprometida para dentro de 15 minutos, y el fallo judicial sobre el amparo puede conocerse en cualquier momento si el gobierno no se adelanta a fijar postura.",
        decision_tipo: "tres_opciones",
        opciones: [
          {
            codigo: "A",
            etiqueta: "ESI obligatoria sin excepciones institucionales, y redirección de presupuesto hacia la escuela pública",
            consecuencia:
              "Gremios docentes y organizaciones de género conformes, pero un bloque de escuelas confesionales judicializa la medida y un sector de clase media que envía a sus hijos a la escuela privada se siente desatendido.",
            impacto_presupuestario:
              "Se reduce o elimina el incremento del subsidio a la privada; esos fondos se redirigen a infraestructura y salarios de la escuela pública.",
          },
          {
            codigo: "B",
            etiqueta: "ESI con objeción de conciencia institucional limitada, y sostenimiento o aumento del subsidio a la privada",
            consecuencia:
              "Tranquilidad en sectores religiosos y de clase media, pero el sindicato y organizaciones de género denuncian públicamente \"un gobierno que cede ante presiones religiosas\".",
            impacto_presupuestario:
              "Aumenta la partida de subsidio a la educación privada, sin una nueva fuente de financiamiento identificada — se resigna margen en otra área del presupuesto educativo.",
          },
          {
            codigo: "C",
            etiqueta: "ESI obligatoria con contenidos mínimos comunes fijados por norma técnica, sin modificar el esquema de financiamiento vigente",
            consecuencia:
              "Ni el amparo prospera ni el sindicato para, pero ambos sectores acusan al gobierno de \"querer quedar bien con todos sin definir nada\".",
            impacto_presupuestario:
              "Costo administrativo menor por la comisión técnica que redacta los contenidos mínimos comunes; no se modifica ninguna partida de financiamiento existente.",
          },
        ],
        apertura: {
          A: "Las escuelas confesionales ya presentaron el amparo dando por hecho que este gobierno va a imponer ESI sin escuchar a nadie. Llegan con la estrategia judicial ya armada, no con un pedido de diálogo.",
          B: "El sindicato docente pide una mesa de diálogo, confiando en que un gobierno negociador va a blindar el presupuesto de la escuela pública sin necesidad de llegar a una medida de fuerza.",
          C: "Ambos sectores —confesionales y sindicato docente— piden por igual una reunión técnica antes de cualquier anuncio, esperando una solución \"de manual\" antes que una señal política fuerte hacia cualquier lado.",
        },
      },
      {
        slug: "desarrollo_social",
        nombre: "Sala 4 — Desarrollo Social",
        tipo: "tematica",
        proyecto_ley_nombre: "Ley de Emergencia en Situación de Calle y Régimen de Asistencia",
        encuadre: "Las personas en situación de calle en la ciudad-ficción aumentaron 30% en el último año.",
        caso_critico:
          "Una organización social ocupa simbólicamente una plaza céntrica, pidiendo freno a los desalojos y ampliación de vivienda transitoria para las familias que hoy pernoctan ahí. En simultáneo, una cámara de comercio de la misma zona presenta un reclamo formal por \"pérdida de seguridad y actividad comercial\" y exige que se libere el espacio público antes del fin de semana, cuando se espera mayor afluencia. Un informe de auditoría interna —filtrado esa misma mañana a un canal de noticias— revela que un porcentaje de los beneficiarios de planes sociales no cumple la contraprestación laboral exigida por la normativa vigente; la oposición ya está usando el dato para instalar la idea de \"curros\" en los planes sociales. El equipo tiene que responder antes de que el conflicto en la plaza escale a un operativo de desalojo con la policía ya movilizada en el lugar.",
        decision_tipo: "tres_opciones",
        opciones: [
          {
            codigo: "A",
            etiqueta: "Desalojar el espacio ocupado y endurecer la contraprestación exigida a los beneficiarios de planes sociales",
            consecuencia:
              "La cámara de comercio y los vecinos celebran la medida, pero se producen incidentes con la organización social que escalan a los noticieros nacionales esa misma noche.",
            impacto_presupuestario:
              "Gasto extraordinario en el operativo de seguridad (horas extra, logística), compensado en parte por el ahorro fiscal de dar de baja a los beneficiarios que no cumplen la contraprestación.",
          },
          {
            codigo: "B",
            etiqueta: "Negociar con la organización social, ampliar asistencia directa y habilitar vivienda transitoria",
            consecuencia:
              "La organización social y sectores vulnerables celebran, pero comerciantes y oposición acusan al gobierno de \"ceder ante la ocupación\" y lo instalan como bandera de campaña.",
            impacto_presupuestario:
              "Aumento significativo de la partida de asistencia social directa y apertura de una nueva línea presupuestaria para vivienda transitoria.",
          },
          {
            codigo: "C",
            etiqueta: "Regularizar la ocupación con un plazo definido, combinado con una auditoría de planes sociales, sin desalojo inmediato",
            consecuencia:
              "Se evita el conflicto inmediato, pero ninguno de los dos sectores queda del todo conforme, y la solución \"a plazo\" puede volver a estallar en las salas o instancias siguientes si el gobierno no cumple el cronograma.",
            impacto_presupuestario:
              "Gasto moderado y acotado en la auditoría de planes y en infraestructura temporal, sin ampliar de forma permanente las partidas de asistencia.",
          },
        ],
        apertura: {
          A: "La policía ya está en la plaza ocupada, a la espera de una orden — todos asumen que un gobierno de mano firme va a desalojar, y la organización social se prepara para resistir activamente si eso ocurre.",
          B: "La organización social pidió explícitamente reunirse con el equipo antes de cualquier decisión, confiando en que un gobierno negociador va a evitar el desalojo — desalojar de todas formas tendría, para este perfil de gobierno, un costo político mucho más alto.",
          C: "Ambas partes —comerciantes y organización social— piden un protocolo claro y objetivo, sin favoritismos. Esperan una solución de gestión, no un gesto político hacia ningún lado.",
        },
      },
      {
        slug: "natalidad",
        nombre: "Sala 5 — Natalidad y Sistema Previsional",
        tipo: "tematica",
        proyecto_ley_nombre: "Ley de Sostenibilidad Previsional y Régimen Familiar",
        encuadre:
          "La tasa de natalidad del país-ficción cayó a mínimos históricos y la relación entre aportantes activos y jubilados se deteriora año a año.",
        caso_critico:
          "El organismo previsional presenta, con carácter de urgente, un informe técnico que advierte insolvencia del sistema en un plazo de ocho años si no se adopta una reforma. Un bloque legislativo del propio oficialismo impulsa, como salida rápida de recaudación, un \"aporte solidario adicional\" a cargo de las personas sin hijos —medida hipotética a los fines del ejercicio—. Un sector de jubilados y sus sindicatos ya anticipó una movilización si se toca la edad jubilatoria. En paralelo, organizaciones de familia y de la sociedad civil piden ampliar las asignaciones familiares y crear incentivos concretos a la maternidad y paternidad. El equipo tiene que resolver antes de que el informe técnico se haga público mañana y la agenda del tema quede instalada por otros actores.",
        decision_tipo: "tres_opciones",
        opciones: [
          {
            codigo: "A",
            etiqueta: "Suba de la edad jubilatoria (ajuste estructural inmediato)",
            consecuencia:
              "Mejora la sostenibilidad de fondo del sistema, pero jubilados y sindicatos anuncian una movilización para la semana siguiente.",
            impacto_presupuestario:
              "Reduce el déficit previsional proyectado en el mediano plazo (menor gasto futuro), sin impacto en el presupuesto del año en curso.",
          },
          {
            codigo: "B",
            etiqueta: "Ampliar asignaciones familiares e incentivos a la natalidad, sin tocar la edad jubilatoria",
            consecuencia:
              "Buena recepción social inmediata, pero el organismo previsional advierte públicamente que \"esto no resuelve el problema de fondo\", dejando al gobierno expuesto a esa crítica técnica en el recinto final.",
            impacto_presupuestario:
              "Aumento inmediato de la partida de asignaciones familiares, sin una fuente de financiamiento genuina identificada — presiona sobre el resto del presupuesto social.",
          },
          {
            codigo: "C",
            etiqueta: "Reforma gradual y escalonada de la edad jubilatoria combinada con incentivos menores a la natalidad, con cronograma a diez años",
            consecuencia:
              "Ni los jubilados se movilizan de inmediato ni el organismo técnico objeta el rumbo, pero el gobierno queda expuesto a la crítica de \"pan para hoy, hambre para mañana\" si el cronograma no se sostiene en el tiempo.",
            impacto_presupuestario:
              "Impacto presupuestario moderado y escalonado: un leve incremento en asignaciones combinado con un ahorro previsional que recién se nota en gestiones futuras.",
          },
        ],
        apertura: {
          A: "El organismo previsional presenta su informe asumiendo que este equipo va a tocar la edad jubilatoria sin anestesia. Los sindicatos de jubilados ya empezaron a organizarse antes de que se anuncie nada.",
          B: "Organizaciones de familia y sindicatos piden una mesa de diálogo, confiando en que un gobierno negociador va a optar por incentivos antes que por ajustar el sistema previsional de forma unilateral.",
          C: "El organismo previsional y los sindicatos piden por igual un plan técnico \"a diez años\", desconfiando tanto de un ajuste brusco como de una promesa sin financiamiento genuino detrás.",
        },
      },
      {
        slug: "crisis",
        nombre: "Sala 6 — Crisis de Comunicación",
        tipo: "crisis",
        proyecto_ley_nombre: null,
        encuadre:
          "Sin proyecto de ley — instancia formativa, no legislativa. Los cinco Presidentes/Jefes de Gobierno son convocados en simultáneo, sin sus equipos, en un momento no anunciado del día.",
        caso_critico:
          "Se conoció hace 20 minutos que un funcionario de segunda línea de tu gobierno está señalado en una causa por presunto uso irregular de fondos públicos. Los medios ya lo tienen y te piden declaraciones en una conferencia de prensa en 10 minutos. Todavía no tenés confirmación judicial, solo la denuncia mediática. Tenés 8 minutos a solas para preparar una declaración de máximo 90 segundos, que vas a dar ante los otros cuatro Presidentes y el jurado, que actúa como prensa.",
        decision_tipo: "ninguna",
        opciones: [],
        apertura: {},
      },
    ];

    const salaIds = {};
    salas.forEach((s) => {
      const id = uuid();
      salaIds[s.slug] = id;
      salaIns.run({
        id,
        slug: s.slug,
        nombre: s.nombre,
        tipo: s.tipo,
        proyecto_ley_nombre: s.proyecto_ley_nombre,
        encuadre: s.encuadre,
        caso_critico: s.caso_critico,
        decision_tipo: s.decision_tipo,
        opciones_json: JSON.stringify(s.opciones),
        apertura_json: JSON.stringify(s.apertura),
      });
    });

    // ---------------------------------------------------------------
    // Equipos / Gobiernos (Parte I del manual — Carpetas 1 a 5)
    // Sistema de rueda: cada equipo recorre las 5 salas tematicas en un
    // orden distinto. La Sala 6 (crisis) no forma parte de la rueda: se
    // dispara para los 5 equipos a la vez desde el Panel de Administracion.
    // ---------------------------------------------------------------
    const salaOrder = ["constitucional", "economia", "educacion", "desarrollo_social", "natalidad"];
    function rotate(arr, n) {
      return arr.slice(n).concat(arr.slice(0, n));
    }

    const equipos = [
      {
        nombre: "Gobierno 1 — Coalición nacional-popular (42% de los votos)",
        carpeta_numero: 1,
        codigo: "GOB-1",
        pin: "1001",
        contexto_arranque:
          "Asumen tras ganar una elección con el 42% de los votos, en un escenario de fragmentación opositora. Reciben una economía que viene de dos años de ajuste fiscal del gobierno anterior: la actividad se estancó, el desempleo subió al 9%, pero la inflación está relativamente controlada (18% anual). Los sindicatos, que fueron parte activa de la campaña, esperan gestos rápidos: recomposición salarial y freno a la reforma laboral que dejó el gobierno saliente a mitad de camino. En el Congreso tienen mayoría propia en Diputados pero no en Senado, donde necesitan negociar con bloques provinciales. La CGT ya anunció que \"acompaña pero no da cheques en blanco\": si no hay señales en los primeros 100 días, amenaza con un paro general.",
        objetivos_generales: [
          "Sostener y ampliar el poder adquisitivo del salario y las jubilaciones (revertir la caída de los últimos 2 años).",
          "Preservar y generar empleo mediante intervención estatal activa (créditos a PyMEs, obra pública).",
          "Fortalecer la negociación colectiva: reabrir paritarias congeladas, frenar la reforma laboral pendiente.",
          "Ampliar derechos sociales sin comprometer el frente fiscal más allá de lo sostenible (evitar volver al escenario de crisis de 2001 o 2018/19).",
        ],
        tension_interna:
          "El peronismo real hoy no es monolítico: hay una tensión entre un ala más ortodoxa/fiscalista (gobernadores del interior que priorizan equilibrio de cuentas provinciales) y un ala más heterodoxa/redistributiva (que exige gestos inmediatos a la CGT y a los movimientos sociales). El equipo tiene que decidir, sala a sala, hacia qué lado se inclina.",
      },
      {
        nombre: "Gobierno 2 — Frente de organizaciones sociales y sindicatos combativos",
        carpeta_numero: 2,
        codigo: "GOB-2",
        pin: "1002",
        contexto_arranque:
          "No ganan una elección presidencial (eso no es realista para el ejercicio), pero sí conquistan el gobierno en un distrito relevante —puede jugarse como una intendencia grande o una provincia— apoyados en un frente de organizaciones sociales, sindicatos combativos y partidos de izquierda unificados para la ocasión, algo inédito. Llegan con un mandato claro: no repetir \"más de lo mismo\". El distrito que reciben tiene alto desempleo estructural, barrios populares con servicios deficientes y una deuda heredada con la Nación (que gobierna un espacio distinto, lo cual genera fricción constante por recursos). Los movimientos sociales que los llevaron al poder exigen resultados rápidos y concretos; el establishment económico local retira inversión ante la incertidumbre.",
        objetivos_generales: [
          "Que el ajuste no lo paguen los trabajadores: aumentar el salario mínimo local y sostener el empleo público antes que recortar.",
          "Recuperar para el Estado o el control social sectores estratégicos del distrito (transporte, servicios).",
          "Renegociar la deuda o los envíos de coparticipación con la Nación en términos más favorables al distrito.",
          "Garantizar como política de Estado vivienda, salud y educación públicas, con foco en los barrios postergados.",
        ],
        tension_interna:
          "¿Se gobierna negociando con la Nación y el empresariado local para sostener gobernabilidad, o se sostiene la confrontación aunque implique menos recursos? Sectores más duros presionan contra cualquier \"pacto con el poder\".",
      },
      {
        nombre: "Gobierno 3 — Reelección con perfil de orden y gestión",
        carpeta_numero: 3,
        codigo: "GOB-3",
        pin: "1003",
        contexto_arranque:
          "Ganan la reelección (o retienen el distrito) tras dos gestiones previas del mismo espacio, con el argumento de \"orden y gestión\" frente a una alternativa peronista que generaba desconfianza en su electorado. Reciben una ciudad/distrito con cuentas relativamente ordenadas pero con desgaste de imagen por temas puntuales: aumento de personas en situación de calle, tensión con sindicatos docentes y de salud por paritarias, y una competencia electoral cada vez más dura desde su derecha (LLA le disputa buena parte de su electorado joven y de clase media). El desafío no es gestionar una crisis heredada, sino sostener resultados sin perder base propia.",
        objetivos_generales: [
          "Mantener el orden fiscal logrado en gestiones anteriores, sin shocks pero sin resignar superávit.",
          "Sostener previsibilidad para la inversión privada y la obra pública con financiamiento propio.",
          "Reforzar seguridad y presencia estatal en el espacio público (incluida la gestión de personas en situación de calle, tema con fuerte exposición mediática).",
          "Defender la autonomía del distrito frente a avances del gobierno nacional (sea del signo que sea).",
        ],
        tension_interna:
          "Ala gradualista/institucional (prioriza consensos, cuidar la imagen de \"gestión seria\") vs. ala que quiere correrse a la derecha para no perder votantes frente a LLA, con un discurso más duro en seguridad y ajuste.",
      },
      {
        nombre: "Gobierno 4 — Outsider libertario, shock de ajuste",
        carpeta_numero: 4,
        codigo: "GOB-4",
        pin: "1004",
        contexto_arranque:
          "Ganan una elección con un discurso outsider y anti-casta, capitalizando el hartazgo con la política tradicional. Heredan una economía en crisis abierta: inflación alta, déficit fiscal elevado, reservas del Banco Central en niveles críticos. Tienen legitimidad electoral fuerte pero prácticamente sin estructura propia de gobierno (pocos cuadros con experiencia de gestión) y sin mayoría parlamentaria, por lo que cada ley depende de negociar voto por voto. Los mercados esperan señales rápidas de ajuste; al mismo tiempo, los primeros meses de shock generan caída del salario real y protestas sociales crecientes.",
        objetivos_generales: [
          "Alcanzar déficit cero en el primer año de gestión, sin excepciones.",
          "Reducir drásticamente el gasto público: fusión o cierre de ministerios, freno a la obra pública estatal.",
          "Desregular la economía y avanzar hacia mayor apertura comercial y libre competencia de monedas.",
          "Reducir la intervención estatal en la vida cotidiana (recortar subsidios, licencias y regulaciones).",
        ],
        tension_interna:
          "Núcleo libertario \"duro\" (no negocia nada, prefiere gobernar por decreto o veto antes que ceder) vs. sector más pragmático que se sumó por conveniencia electoral y presiona para negociar con gobernadores y sostener algo de asistencia social focalizada para no perder gobernabilidad.",
      },
      {
        nombre: "Gobierno 5 — Provincia mediana, tradición institucional",
        carpeta_numero: 5,
        codigo: "GOB-5",
        pin: "1005",
        contexto_arranque:
          "Retienen o ganan una provincia mediana con una gestión propia, por fuera de una gran coalición nacional. Es una provincia con cuentas ordenadas pero bajo perfil económico, fuerte tradición institucional y una clase media consolidada que valora la gestión \"seria y sin sobresaltos\". El desafío central no es una crisis de gestión sino la relevancia política: la Nación (gobernada por otro espacio) y el resto de los distritos definen buena parte de la agenda, y el gobierno debe decidir cuánto se acerca a alianzas nacionales para no quedar aislado, sin resignar su identidad ni el capital institucional que los distingue.",
        objetivos_generales: [
          "Fortalecer la calidad institucional local: independencia judicial provincial, rol pleno de la Legislatura, límites claros al uso de decretos de necesidad y urgencia.",
          "Sostener el equilibrio fiscal con gradualismo, cuidando especialmente a la clase media y a los empleados públicos provinciales.",
          "Defender activamente el reclamo por una coparticipación federal más equilibrada para las provincias medianas.",
          "Priorizar la educación pública provincial como política de Estado, con inversión sostenida en infraestructura escolar.",
        ],
        tension_interna:
          "Sector que impulsa una alianza formal con el PRO o LLA a nivel nacional para no perder relevancia y conseguir recursos/cargos, vs. sector que defiende la identidad e independencia del radicalismo (\"no ser furgón de cola de nadie\"), aun a costa de menor peso político inmediato.",
      },
    ];

    const equipoIns = db.prepare(`
      INSERT INTO equipo (id, jornada_id, nombre, carpeta_numero, codigo, pin, contexto_arranque, objetivos_generales, tension_interna, orden_rotacion_json)
      VALUES (@id, @jornada_id, @nombre, @carpeta_numero, @codigo, @pin, @contexto_arranque, @objetivos_generales, @tension_interna, @orden_rotacion_json)
    `);
    const pasoIns = db.prepare(`
      INSERT INTO paso_recorrido (id, equipo_id, sala_id, orden_index, estado, cartelito_entrada)
      VALUES (?, ?, ?, ?, 'pendiente', NULL)
    `);

    const equipoIds = {};
    equipos.forEach((e, idx) => {
      const id = uuid();
      equipoIds[e.codigo] = id;
      const rotacion = rotate(salaOrder, idx); // sistema de rueda
      equipoIns.run({
        id,
        jornada_id: jornadaId,
        nombre: e.nombre,
        carpeta_numero: e.carpeta_numero,
        codigo: e.codigo,
        pin: e.pin,
        contexto_arranque: e.contexto_arranque,
        objetivos_generales: JSON.stringify(e.objetivos_generales),
        tension_interna: e.tension_interna,
        orden_rotacion_json: JSON.stringify(rotacion),
      });

      // Crea los 5 pasos tematicos en el orden de la rueda de este equipo
      rotacion.forEach((slug, i) => {
        pasoIns.run(uuid(), id, salaIds[slug], i);
      });
      // Y el paso de Sala 6 (crisis), fuera de la rueda, orden_index 99
      pasoIns.run(uuid(), id, salaIds["crisis"], 99);
    });

    // ---------------------------------------------------------------
    // Staff (Admin / Facilitadores / Jurado) — credenciales demo
    // ---------------------------------------------------------------
    const staffIns = db.prepare(`
      INSERT INTO usuario (id, tipo, nombre, staff_rol, sala_asignada_id, username, password_hash)
      VALUES (?, 'staff', ?, ?, ?, ?, ?)
    `);
    const staffUsers = [
      { nombre: "Organizador/a General", staff_rol: "admin", sala: null, username: "admin", password: "admin123" },
      { nombre: "Facilitador Sala Constitucional", staff_rol: "facilitador", sala: "constitucional", username: "facilitador1", password: "facil123" },
      { nombre: "Facilitador Sala Economía", staff_rol: "facilitador", sala: "economia", username: "facilitador2", password: "facil123" },
      { nombre: "Facilitador Sala Educación", staff_rol: "facilitador", sala: "educacion", username: "facilitador3", password: "facil123" },
      { nombre: "Facilitador Sala Desarrollo Social", staff_rol: "facilitador", sala: "desarrollo_social", username: "facilitador4", password: "facil123" },
      { nombre: "Facilitador Sala Natalidad", staff_rol: "facilitador", sala: "natalidad", username: "facilitador5", password: "facil123" },
      { nombre: "Jurado Sala 6 (Crisis)", staff_rol: "jurado", sala: "crisis", username: "jurado1", password: "jurado123" },
    ];
    staffUsers.forEach((s) => {
      staffIns.run(
        uuid(),
        s.nombre,
        s.staff_rol,
        s.sala ? salaIds[s.sala] : null,
        s.username,
        bcrypt.hashSync(s.password, 8)
      );
    });

    console.log("[seed] Jornada, roles, salas, equipos y staff cargados correctamente.");
    console.log("[seed] Credenciales de staff (usuario / contraseña):");
    staffUsers.forEach((s) => console.log(`         ${s.username} / ${s.password}  (${s.staff_rol})`));
    console.log("[seed] Codigos de equipo (codigo / PIN):");
    equipos.forEach((e) => console.log(`         ${e.codigo} / ${e.pin}  — ${e.nombre}`));
  });

  insertMany();
}

if (require.main === module) {
  run();
  process.exit(0);
}

module.exports = { run };
