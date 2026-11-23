// Configuración de las pestañas de la planilla. Para sumar una columna: agregarla en TABLES y en el schema de Supabase.

import { today } from "./core.js";

var ESTADOS = ["Pendiente", "En proceso", "Terminado"];

export var RESPONSABLES = ["Naty", "Mauri", "Naty / Mauri"];

// Estados de los temas de la solapa Comisión (la solapa está en comision.js; acá solo se usan para Excel y copias).
export var ESTADOS_COMISION = ["Pendiente", "Tratado", "Pasa a la próxima"];

export var FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSf_FP644YtLRl1_abTDKr4__p3CdIBGOSjZo6GvkKius5I1_g/viewform?embedded=true";

// Carpeta de proyectos en la nube de Exactas (botón en la solapa Notas / Proyectos)
export var NUBE_URL = "https://nube.exactas.uba.ar/index.php/f/26167782";
export var GCAL_URL = "https://calendar.google.com/calendar/u/0/r";

function C(k, h, type, options, labels) {
  return { k: k, h: h, type: type || "text", options: options || null, optionLabels: labels || null };
}

// Columna de fecha cuyo filtro ofrece solo años (más «Sin fecha» si alguna fila no la tiene).
function Y(k, h) {
  var c = C(k, h, "date");
  c.yearFilter = true;
  return c;
}

// Columna cuyo contenido, si es una dirección web, se muestra con un botón para abrirla.
function L(k, h) {
  var c = C(k, h);
  c.link = true;
  return c;
}

// Solapa Sustanciaciones. Para agregar un departamento, un responsable, etc.: sumarlo en la lista que corresponda.
var DPTOS_SUST = ["DM", "DC", "DF", "IC", "DG", "DFBMC", "DQO", "DQB", "DQIAQF", "DBBE", "DEGE", "DI", "DCAO", "CCPEMS"];
var RESPONSABLES_SUST = ["Eduardo", "Valentín", "Milena"];
var ESTADOS_SUST = ["En comisión", "Para sustanciar", "Sustanciado", "En Consejo Superior", "Demorado"];

// Cada pestaña = una tabla de Supabase (ver supabase/schema.sql). Para sumar una columna: agregarla acá y en el schema.
export var TABLES = {
  seguimiento: {
    label: "Seguimiento",
    cols: [
      C("fecha", "Fecha", "date"),
      C("expediente", "N° Expediente"),
      C("dpto", "Dpto"),
      C("contacto", "Contacto"),
      C("observaciones", "Observaciones"),
      C("responsable", "Responsable", "select", RESPONSABLES),
      C("estado", "Estado", "select", ESTADOS),
      C("notas", "Notas / seguimiento"),
    ],
    filters: ["responsable", "estado"],
    // Al entrar a la pestaña se muestran solo estos valores (se pueden cambiar con el filtro). Si se quita esta línea, se muestra todo.
    filterDefaults: { estado: ["Pendiente", "En proceso"] },
    // Contadores arriba de la tabla (cuentan todas las filas, aunque haya filtros). Al hacer clic filtran por ese valor.
    counters: [
      { col: "estado", value: "Pendiente", label: "Pendientes" },
      { col: "estado", value: "En proceso", label: "En proceso" },
    ],
    // Etiqueta "hace N días" en las filas abiertas con más de `dias` días desde su fecha (en rojo desde `urgente`).
    antiguedad: { fecha: "fecha", estado: "estado", valores: ["Pendiente", "En proceso"], dias: 7, urgente: 15 },
    defaults: function () {
      return { fecha: today(), estado: "Pendiente" };
    },
  },
  comision: {
    label: "Comisión",
    cols: [
      C("fecha", "Comisión", "date"),
      C("tipo", "Tipo", "select", ["para", "en"], { para: "Para tratar", en: "En comisión" }),
      C("categoria", "Categoría"),
      C("expediente", "Expte. / Proyecto"),
      C("observacion", "Observación"),
      C("estado", "Estado (comisión)", "select", ESTADOS_COMISION),
    ],
    // La solapa Comisión se dibuja en comision.js (no usa la grilla genérica); esta definición sirve para Excel, copias y Papelera.
    filters: ["fecha", "tipo"], // columnas con desplegable de filtro
    defaults: function () {
      return { fecha: today(), tipo: "para" };
    },
  },
  sustanciaciones: {
    label: "Sustanciaciones",
    cols: [
      C("expediente", "N° de expediente"),
      Y("fecha_llamado", "Fecha de llamado"),
      C("dpto", "Departamento", "select", DPTOS_SUST),
      C("tipo", "Renovación / Nuevo", "select", ["Renovación", "Nuevo"]),
      C("categoria", "Categoría", "select", ["Adjunto", "Asociado", "Titular"]),
      C("dedicacion", "Dedicación", "select", ["Parcial", "Semi exclusiva", "Exclusiva"]),
      C("area", "Área"),
      C("titular", "Titular del cargo"),
      C("postulantes", "Postulantes"),
      C("jurados", "Jurados"),
      C("responsable", "Responsable", "select", RESPONSABLES_SUST),
      C("estado", "Estado", "select", ESTADOS_SUST),
      Y("fecha_sust", "Fecha de sustanciación"),
      C("ganador", "Ganador/a del concurso"),
      C("promociono", "Promoción", "select", ["Sí", "No"]),
      C("observaciones", "Observaciones"),
    ],
    // Filtros (uno por columna, salvo expediente, área, titular, postulantes, jurados y ganador/a). Las fechas filtran solo por año.
    filters: ["fecha_llamado", "dpto", "tipo", "categoria", "dedicacion", "responsable", "estado", "fecha_sust", "promociono"],
    buscar: "Buscar en toda la planilla (nombre, expediente, área…)",
    // Panel «Estadísticas»: se calcula sobre las filas que se ven (según búsqueda y filtros). Ver estadisticas.js.
    stats: {
      // Tarjetas de resumen: cuántas filas tienen alguno de esos valores
      resumen: [
        { titulo: "En trámite", col: "estado", valores: ["En comisión", "Para sustanciar"] },
        { titulo: "Demorados", col: "estado", valores: ["Demorado"] },
        { titulo: "Sustanciados", col: "estado", valores: ["Sustanciado", "En Consejo Superior"] },
        // sobreRespondidas: el porcentaje se calcula sobre las filas que tienen dato en esa columna, no sobre todas
        { titulo: "Promocionaron", col: "promociono", valores: ["Sí"], sobreRespondidas: true },
      ],
      // Gráficos de barras: filas por valor de una columna (ceros: mostrar también los valores en 0)
      cuentas: [
        { col: "estado", titulo: "Por estado", ceros: true },
        { col: "dpto", titulo: "Por departamento" },
        { col: "responsable", titulo: "Por responsable" },
        { col: "tipo", titulo: "Renovación o nuevo" },
        { col: "categoria", titulo: "Por categoría" },
        { col: "dedicacion", titulo: "Por dedicación" },
        { col: "promociono", titulo: "Promoción de categoría" },
      ],
      // Filas por año de una fecha
      anios: [
        { col: "fecha_llamado", titulo: "Llamados por año" },
        { col: "fecha_sust", titulo: "Sustanciaciones por año" },
      ],
      // Tiempo entre dos fechas
      duracion: { desde: "fecha_llamado", hasta: "fecha_sust", titulo: "Del llamado a la sustanciación" },
      // Cómo evoluciona ese promedio: un punto por año de la fecha «hasta» (sube o baja)
      progresion: { desde: "fecha_llamado", hasta: "fecha_sust", titulo: "Evolución del promedio (del llamado a la sustanciación)" },
    },
    // La fila nueva arranca totalmente en blanco; mientras no tenga fecha de llamado se muestra arriba de todo.
    vaciasArriba: true,
    defaults: function () {
      return {};
    },
  },
  contactos_dptos: {
    label: "Departamentos",
    cols: [
      C("dpto", "Dpto"),
      C("director_titular", "Director titular"),
      C("email_titular", "Email"),
      C("director_adjunto", "Director adjunto"),
      C("email_adjunto", "Email"),
      C("administrativos", "Administrativos/as"),
      C("email_admin", "Email"),
    ],
    defaults: function () {
      return {};
    },
  },
  personal: {
    label: "Secretaría",
    cols: [
      C("nombre", "Nombre"),
      C("funcion", "Función"),
      C("contacto", "Contacto"),
      C("horario", "Horario"),
      C("home", "Home", "select", ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"]),
      C("vacaciones", "Vacaciones/licencia", "vacaciones"),
    ],
    defaults: function () {
      return {};
    },
  },
  cuentas_mail: {
    label: "Cuentas de mail",
    cols: [C("cuenta", "Cuenta"), C("acceso", "Acceso a")],
    defaults: function () {
      return {};
    },
  },
  links: {
    label: "Links",
    cols: [C("nombre", "Nombre"), L("valor", "Valor")],
    defaults: function () {
      return {};
    },
  },
};
