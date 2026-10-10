// Configuración de las pestañas de la planilla. Para sumar una columna: agregarla en TABLES y en el schema de Supabase.

import { today } from "./core.js";

var ESTADOS = ["Pendiente", "En proceso", "Terminado"];

var RESPONSABLES = ["Naty", "Mauri", "Naty / Mauri"];

export var FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSf_FP644YtLRl1_abTDKr4__p3CdIBGOSjZo6GvkKius5I1_g/viewform?embedded=true";

// Carpeta de proyectos en la nube de Exactas (botón en la solapa Notas / Proyectos)
export var NUBE_URL = "https://nube.exactas.uba.ar/index.php/f/26167782";

function C(k, h, type, options, labels) {
  return { k: k, h: h, type: type || "text", options: options || null, optionLabels: labels || null };
}

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
      C("tipo", "Tipo", "select", ["para", "en"], { para: "Para comisión", en: "En comisión" }),
      C("categoria", "Categoría"),
      C("expediente", "Expte. / Proyecto"),
      C("observacion", "Observación"),
      C("estado", "Estado (comisión)"),
    ],
    filters: ["fecha", "tipo"], // columnas con desplegable de filtro
    defaults: function () {
      return { fecha: today(), tipo: "para" };
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
      C("home", "Home"),
      C("vacaciones", "Vacaciones"),
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
    cols: [C("nombre", "Nombre"), C("valor", "Valor")],
    defaults: function () {
      return {};
    },
  },
};
