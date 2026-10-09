// Copia de seguridad (descarga un .json con todas las tablas) y aviso de la última copia.

import { $, S, descargarArchivo, errMsg, sb, status, today } from "./core.js";
import { tablaFaltante } from "./papelera.js";
import { TABLES } from "./tablas.js";

// ---------- Copia de seguridad ----------
// Descarga un archivo .json con TODAS las tablas. Para volver a cargarlo: scripts/restaurar_copia.py (genera el SQL).
var CLAVE_COPIA = "seguimiento_ultima_copia";

async function leerTodo(tabla) {
  var out = [],
    desde = 0;
  for (;;) {
    // Supabase devuelve como máximo 1000 filas por consulta: se pide por tandas
    var r = await sb
      .from(tabla)
      .select("*")
      .order("id", { ascending: true })
      .range(desde, desde + 999);
    if (r.error) throw r.error;
    out = out.concat(r.data);
    if (r.data.length < 1000) break;
    desde += 1000;
  }
  return out;
}

export async function copiaSeguridad() {
  status("Preparando la copia…");
  var nombres = Object.keys(TABLES).concat(["borradores", "notas", "eventos"]);
  var tablas = {},
    faltan = [],
    filas = 0;
  try {
    for (var n of nombres) {
      try {
        tablas[n] = await leerTodo(n);
        filas += tablas[n].length;
      } catch (e) {
        if (tablaFaltante(e, n)) faltan.push(n);
        else throw e;
      }
    }
  } catch (e) {
    return status("No se pudo hacer la copia: " + errMsg(e), true);
  }

  descargarArchivo(
    "copia-seguridad-" + today() + ".json",
    JSON.stringify(
      { app: "seguimiento", version: 1, creado: new Date().toISOString(), por: S.user.email, tablas: tablas },
      null,
      1,
    ),
    "application/json",
  );
  try {
    localStorage.setItem(CLAVE_COPIA, new Date().toISOString());
  } catch (e) {
    /* sin almacenamiento: solo no se recuerda la fecha */
  }
  actualizarAvisoCopia();
  status(
    "Copia descargada ✓ (" +
      filas +
      " filas)" +
      (faltan.length ? ". No se incluyó: " + faltan.join(", ") + " (tabla sin crear)" : ""),
  );
}

function diasDesdeCopia() {
  var t = null;
  try {
    t = localStorage.getItem(CLAVE_COPIA);
  } catch (e) {
    t = null;
  }
  var d = t ? Math.floor((Date.now() - new Date(t).getTime()) / 86400000) : NaN;
  return isNaN(d) ? null : Math.max(0, d);
}

// Muestra en la barra cuándo fue la última copia hecha desde este equipo; se pone en rojo si pasó una semana.
export function actualizarAvisoCopia() {
  var s = $("bk-info");
  if (!s) return;
  var d = diasDesdeCopia();
  s.textContent =
    d == null
      ? "Sin copias en este equipo"
      : d === 0
        ? "Última copia: hoy"
        : "Última copia: hace " + d + (d === 1 ? " día" : " días");
  s.className = "bk-info" + (d == null || d >= 7 ? " warn" : "");
  s.title = "La fecha se guarda en este navegador: cada persona ve la de su propio equipo.";
}

export function avisoCopiaInicial() {
  var d = diasDesdeCopia();
  if (d != null && d < 7) return;
  var msg = "Hace más de una semana que no hacés una copia de seguridad (botón de arriba).";
  status(msg);
  setTimeout(function () {
    if ($("status") && $("status").textContent === msg) status("");
  }, 8000);
}
