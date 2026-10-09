// Papelera: toda fila borrada se copia antes a la tabla "papelera" y se puede restaurar desde el botón de la barra.

import { refrescarBorradores } from "./borradores.js";
import { loadCalendario } from "./calendario.js";
import { S, abrirModal, cerrarModal, el, errMsg, fmtDate, sb } from "./core.js";
import { refrescarNotas } from "./notas.js";
import { refresh } from "./planilla.js";
import { TABLES } from "./tablas.js";

// ---------- Papelera ----------
// Todo lo que se borra se copia antes en la tabla "papelera" (ver supabase/papelera.sql) y se puede restaurar desde el botón Papelera.
var NOMBRES_EXTRA = { borradores: "Borradores", notas: "Notas", eventos: "Calendario" };

function nombreTabla(t) {
  return (TABLES[t] && TABLES[t].label) || NOMBRES_EXTRA[t] || t;
}

export function tablaFaltante(e, nombre) {
  var m = errMsg(e);
  return !!e && (e.code === "42P01" || (m.indexOf(nombre) >= 0 && /exist|relation|schema cache/i.test(m)));
}

export async function borrarFila(tabla, id) {
  var g = await sb.from(tabla).select("*").eq("id", id).maybeSingle();
  if (g.error) return { error: g.error };
  if (g.data) {
    var p = await sb.from("papelera").insert({ tabla: tabla, datos: g.data });
    if (
      p.error &&
      !confirm(
        "No se pudo guardar una copia en la Papelera (" +
          errMsg(p.error) +
          ").\n\n¿Borrar igual? No se va a poder deshacer.",
      )
    ) {
      return { error: { message: "se canceló el borrado." } };
    }
  }
  return await sb.from(tabla).delete().eq("id", id);
}

function resumenPapelera(d) {
  var claves = [
      "titulo",
      "asunto",
      "expediente",
      "nombre",
      "dpto",
      "cuenta",
      "observaciones",
      "observacion",
      "destinatario",
    ],
    txt = "";
  for (var i = 0; i < claves.length && !txt; i++) if (d[claves[i]]) txt = String(d[claves[i]]);
  if (txt.length > 90) txt = txt.slice(0, 90) + "…";
  return (d.fecha ? fmtDate(d.fecha) + " · " : "") + (txt || "(vacío)");
}

export async function abrirPapelera() {
  var res = await sb.from("papelera").select("*").order("deleted_at", { ascending: false }).limit(100);
  var cuerpo;
  if (res.error) {
    cuerpo = el(
      "p",
      { class: "note" },
      tablaFaltante(res.error, "papelera")
        ? "Falta crear la tabla «papelera» en Supabase. Corré el archivo supabase/papelera.sql en el editor SQL de Supabase y recargá esta página."
        : "No se pudo abrir la papelera: " + errMsg(res.error),
    );
  } else if (!res.data.length) {
    cuerpo = el("p", { class: "note" }, "La papelera está vacía.");
  } else {
    cuerpo = el("div", { class: "trash-list" }, res.data.map(itemPapelera));
  }
  abrirModal(
    [
      el("h3", {}, "Papelera"),
      el("p", { class: "note" }, "Lo que se borra queda acá (se muestran los últimos 100)."),
      cuerpo,
      el("div", { class: "modal-actions" }, el("button", { class: "ghost", onclick: cerrarModal }, "Cerrar")),
    ],
    "wide",
  );
}

function itemPapelera(p) {
  var btn = el(
    "button",
    {
      onclick: function () {
        restaurarDePapelera(p, fila, btn);
      },
    },
    "Restaurar",
  );
  var fila = el(
    "div",
    { class: "trash-item" },
    el(
      "div",
      { class: "trash-txt" },
      el("strong", {}, nombreTabla(p.tabla)),
      el("span", {}, resumenPapelera(p.datos || {})),
      el(
        "small",
        {},
        "Borrado" +
          (p.deleted_by ? " por " + p.deleted_by : "") +
          (p.deleted_at ? " · " + new Date(p.deleted_at).toLocaleString("es-AR") : ""),
      ),
    ),
    btn,
  );
  return fila;
}

async function restaurarDePapelera(p, fila, btn) {
  btn.disabled = true;
  var d = Object.assign({}, p.datos);
  delete d.id;
  delete d.updated_at;
  delete d.updated_by; // se vuelve a crear con id nuevo
  var r = await sb.from(p.tabla).insert(d);
  if (r.error) {
    btn.disabled = false;
    fila.append(el("p", { class: "err" }, "No se pudo restaurar: " + errMsg(r.error)));
    return;
  }
  var q = await sb.from("papelera").delete().eq("id", p.id);
  fila.replaceChildren(
    el(
      "span",
      {},
      "✓ Restaurado en " + nombreTabla(p.tabla) + (q.error ? " (no se pudo sacar de la papelera)" : ""),
    ),
  );
  recargarPestana();
}

// Si estás mirando la pestaña a la que se restauró algo, se actualiza.
function recargarPestana() {
  if (S.tab === "borradores") refrescarBorradores();
  else if (S.tab === "notas") refrescarNotas();
  else if (S.tab === "calendario") loadCalendario(true);
  else if (S.data) refresh();
}
