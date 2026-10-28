// Solapa Notas / Proyectos: editor Markdown con vista previa, etiquetas, buscador, autoguardado,
// descargas y cambios en vivo.

import { $, S, abrirModal, cerrarModal, copiarTexto, descargarArchivo, el, errMsg, normalizar, sb, status } from "./core.js";
import { pintarDiff } from "./diff.js";
import { descargarDocx, descargarOdt } from "./exportar.js";
import { leaveGrid, liveOn } from "./live.js";
import { renderMd } from "./markdown.js";
import { borrarFila } from "./papelera.js";
import { NUBE_URL } from "./tablas.js";

var notaSaveTimer = null;

var notaRows = [];

var notaSel = null;

var notaSaving = 0;

var pendingNota = null;
// { r, titulo, contenido }: lo último escrito que todavía no se guardó
var notaSyncTimer = null;

var ETIQUETAS = ["Mauri", "Naty"];
var notaFiltro = ""; // "" = todas, "Mauri", "Naty" o "__sin" (sin etiquetar)
var notaBusqueda = "";
var notaModo = "split"; // "edit" (solo texto) | "split" (texto y vista) | "view" (solo vista)
var previewTimer = null;

// Control de cambios: cada nota tiene un autor. El autor edita directo; los demás envían sugerencias que el autor acepta o rechaza.
var sugRows = []; // sugerencias pendientes (de todas las notas)
var sugDisponible = false; // false hasta que se corre notas_sugerencias.sql: sin eso todos editan directo, como antes
var sugBorradores = {}; // id de nota -> { titulo, contenido } que escribió quien no es autor y todavía no envió

function yo() {
  return String((S.user && S.user.email) || "").toLowerCase();
}

function mismo(a) {
  return String(a || "").toLowerCase() === yo();
}

// Dueña/o de la nota (o nota sin autor, o función todavía no activada): edita directo.
function esDueno(r) {
  return !sugDisponible || !r.autor || mismo(r.autor);
}

function nombreDe(email) {
  var n = String(email || "").split(/[@.]/)[0];
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : "Otra persona";
}

function sugDe(id) {
  return sugRows.filter(function (s) {
    return String(s.nota_id) === String(id);
  });
}

function miaSug(r) {
  return (
    sugDe(r.id).find(function (s) {
      return mismo(s.autor);
    }) || null
  );
}

function ajenas(r) {
  return sugDe(r.id).filter(function (s) {
    return !mismo(s.autor);
  });
}

async function cargarSugs() {
  var res = await sb
    .from("notas_sugerencias")
    .select("*")
    .eq("estado", "pendiente")
    .order("created_at", { ascending: true });
  if (res.error) {
    // Solo se desactiva si la tabla no existe; un corte de red pasajero no cambia el modo.
    if (res.error.code === "42P01" || /does not exist|schema cache|could not find/i.test(res.error.message || "")) {
      sugDisponible = false;
      sugRows = [];
    }
    return;
  }
  sugDisponible = true;
  sugRows = res.data || [];
}

function fechaCorta(iso) {
  return iso ? new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "";
}

// Notas que cumplen el filtro de etiqueta y el texto buscado (en título y contenido, sin distinguir tildes ni mayúsculas).
function notasVisibles() {
  var q = normalizar(notaBusqueda.trim());
  return notaRows.filter(function (r) {
    if (notaFiltro === "__sin" && r.etiqueta) return false;
    if (notaFiltro && notaFiltro !== "__sin" && r.etiqueta !== notaFiltro) return false;
    if (!q) return true;
    return normalizar((r.titulo || "") + "\n" + (r.contenido || "")).indexOf(q) >= 0;
  });
}

export async function openNotas() {
  S.tab = "notas";

  document.querySelectorAll(".tab").forEach(function (b) {
    b.classList.toggle("on", b.dataset.n === "notas");
  });

  leaveGrid();
  notaSel = null;

  // Acceso directo a la carpeta de proyectos en la nube de Exactas
  $("tools").replaceChildren(
    el(
      "a",
      {
        class: "btn",
        href: NUBE_URL,
        target: "_blank",
        rel: "noopener noreferrer",
        title: "Abre la carpeta de proyectos en la nube de Exactas (en una pestaña nueva)",
      },
      "📁 Abrir carpeta de proyectos",
    ),
  );
  $("grid").replaceChildren();

  return loadNotas();
}

async function loadNotas() {
  status("Cargando notas...");

  var res = await sb.from("notas").select("*").order("updated_at", { ascending: false });

  if (S.tab !== "notas") return;

  if (res.error) {
    status(errMsg(res.error), true);
    return;
  }

  await cargarSugs();
  if (S.tab !== "notas") return;

  renderNotas(res.data || []);
  liveOn("notas", sugDisponible ? ["notas", "notas_sugerencias"] : "notas", refrescarNotas);
  status("");
}

// Igual que en Borradores: lo que escribís vos tiene prioridad; si hay algo sin guardar se espera y se reintenta.
export async function refrescarNotas() {
  if (S.tab !== "notas" || !$("nota-list")) return;
  clearTimeout(notaSyncTimer);
  if (pendingNota || notaSaving > 0) {
    notaSyncTimer = setTimeout(refrescarNotas, 1500);
    return;
  }

  var res = await sb.from("notas").select("*").order("updated_at", { ascending: false });
  if (res.error || S.tab !== "notas" || !$("nota-list")) return;
  if (pendingNota || notaSaving > 0) {
    notaSyncTimer = setTimeout(refrescarNotas, 1500);
    return;
  }

  await cargarSugs();
  if (S.tab !== "notas" || !$("nota-list")) return;

  var rows = res.data || [];
  var cur = notaRows.find(function (x) {
    return x.id === notaSel;
  });
  var i = rows.findIndex(function (x) {
    return x.id === notaSel;
  });
  var perdida = false;

  if (cur && i >= 0) {
    var nueva = rows[i];
    if (
      ((cur.titulo || "") !== (nueva.titulo || "") ||
        (cur.contenido || "") !== (nueva.contenido || "") ||
        (cur.etiqueta || "") !== (nueva.etiqueta || "")) &&
      new Date(nueva.updated_at) > new Date(cur.updated_at)
    ) {
      Object.assign(cur, nueva);
      // Si quien no es autor tiene cambios sin enviar, no se le pisa lo que escribió.
      if (esDueno(cur) || !(sugBorradores[cur.id] || miaSug(cur))) pintarCamposNota(cur);
    }
    rows[i] = cur;
  } else if (cur) {
    perdida = true; // la borró la otra persona
  }

  notaRows = rows;
  pintarListaNotas();
  if (cur && !perdida) {
    pintarPanelSug(cur);
    actualizarBannerSug(cur);
  }

  if (perdida || !cur) {
    notaSel = null;
    var vis = notasVisibles();
    if (vis.length) renderNotaEditor(notaRows, vis[0].id);
    else renderNotasVacio();
    if (perdida) status("Esa nota la eliminó otra persona.", true);
  }
}

function pintarCamposNota(r) {
  [
    ["note-title", r.titulo],
    ["note-body", r.contenido],
  ].forEach(function (p) {
    var input = $(p[0]),
      v = p[1] || "";
    if (!input || input.value === v) return;
    var a = document.activeElement === input,
      s = input.selectionStart,
      e = input.selectionEnd;
    input.value = v;
    if (a) {
      try {
        input.setSelectionRange(Math.min(s, v.length), Math.min(e, v.length));
      } catch (x) {
        /* ignorar */
      }
    }
  });
  pintarVistaPrevia();
  if ($("note-tag") && $("note-tag").value !== (r.etiqueta || "")) $("note-tag").value = r.etiqueta || "";
}

function pintarListaNotas() {
  var list = $("nota-list");
  if (!list) return;
  var visibles = notasVisibles();
  if (!visibles.length) {
    list.replaceChildren(
      el("div", { class: "nt-empty" }, notaRows.length ? "Ninguna nota coincide con la búsqueda." : ""),
    );
    return;
  }
  list.replaceChildren.apply(
    list,
    visibles.map(function (r) {
      var resumen = (r.contenido || "")
        .replace(/[#*`>\\-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 70);
      return el(
        "button",
        {
          class: "nt-item" + (r.id === notaSel ? " on" : ""),
          "data-id": r.id,
          title: r.updated_at ? "Modificada: " + new Date(r.updated_at).toLocaleString("es-AR") : "",
          onclick: function () {
            cambiarNota(r.id);
          },
        },
        el(
          "div",
          { class: "draft-row" },
          el("strong", { class: "nt-title" }, r.titulo || "(Sin título)"),
          r.etiqueta ? el("small", { class: "st-badge tag-" + r.etiqueta }, r.etiqueta) : null,
          sugDe(r.id).length
            ? el(
                "small",
                { class: "st-badge sug-badge", title: sugDe(r.id).length + " sugerencia(s) pendiente(s)" },
                "✎ " + sugDe(r.id).length,
              )
            : null,
        ),
        el("span", { class: "nt-snip" }, resumen || "Vacía"),
      );
    }),
  );
}

async function cambiarNota(id) {
  await flushNotaSave();
  renderNotaEditor(notaRows, id);
}

function renderNotasVacio() {
  var editor = $("nota-editor");
  if (!editor) return;
  editor.replaceChildren(
    el(
      "div",
      { class: "nt-empty" },
      "No hay notas todavía.",
      el(
        "button",
        {
          onclick: function () {
            nuevaNota();
          },
        },
        "Crear primera nota",
      ),
    ),
  );
}

function renderNotas(rows) {
  notaRows = rows;

  var layout = el("div", { class: "nt-layout" });

  var sidebar = el("aside", { class: "nt-side" });

  sidebar.append(
    el(
      "div",
      { class: "nt-side-top" },
      el("input", {
        id: "nota-q",
        type: "search",
        placeholder: "Buscar en notas...",
        "aria-label": "Buscar en notas",
        value: notaBusqueda,
        oninput: function () {
          notaBusqueda = this.value;
          pintarListaNotas();
        },
      }),
      el(
        "button",
        {
          onclick: function () {
            nuevaNota();
          },
        },
        "+ Nueva",
      ),
    ),
    el(
      "select",
      {
        id: "nota-filtro",
        class: "nt-filter",
        title: "Filtrar por etiqueta",
        onchange: function () {
          notaFiltro = this.value;
          pintarListaNotas();
        },
      },
      el("option", { value: "" }, "Todas las etiquetas"),
      ETIQUETAS.map(function (t) {
        return el("option", { value: t }, t);
      }),
      el("option", { value: "__sin" }, "Sin etiquetar"),
    ),
    el("div", { class: "nt-list", id: "nota-list" }),
  );

  var editor = el("section", {
    class: "nt-main",
    id: "nota-editor",
  });

  layout.append(sidebar, editor);

  $("grid").replaceChildren(layout);
  $("nota-filtro").value = notaFiltro;

  var visibles = notasVisibles();
  var selected =
    visibles.find(function (r) {
      return r.id === notaSel;
    }) ||
    visibles[0] ||
    null;
  notaSel = selected ? selected.id : null;
  pintarListaNotas();

  if (selected) {
    renderNotaEditor(notaRows, selected.id);
  } else {
    renderNotasVacio();
  }
}

function renderNotaEditor(rows, id) {
  var r = rows.find(function (x) {
    return String(x.id) === String(id);
  });

  if (!r) return;

  var editor = $("nota-editor");

  if (!editor) return;

  notaSel = r.id;
  pintarListaNotas();

  var dueno = esDueno(r);
  var mia = dueno ? null : miaSug(r);
  // Quien no es autor ve lo último que escribió (sin enviar) o su sugerencia pendiente; si no, la nota tal cual.
  var base = !dueno && (sugBorradores[r.id] || (mia && { titulo: mia.titulo, contenido: mia.contenido })) || r;

  var title = el("input", {
    id: "note-title",
    type: "text",
    placeholder: "Título de la nota o proyecto",
    "aria-label": "Título",
    value: base.titulo || "",
  });

  var body = el("textarea", {
    id: "note-body",
    class: "nt-editor",
    spellcheck: "false",
    "aria-label": "Contenido de la nota",
    placeholder:
      "Escribí en Markdown… (# títulos, **negrita**, *cursiva*, listas, `código`, [texto](https://…))",
  });

  body.value = base.contenido || "";

  var vista = el("article", { id: "note-preview", class: "md nt-preview" });

  var saveInfo = el(
    "span",
    {
      class: "draft-save-info",
      id: "note-save-info",
    },
    "Guardado",
  );

  var modos = el(
    "div",
    { class: "seg", id: "note-mode", role: "group", "aria-label": "Modo" },
    [
      ["edit", "Editar"],
      ["split", "Ambos"],
      ["view", "Vista"],
    ].map(function (m) {
      return el(
        "button",
        {
          type: "button",
          "data-v": m[0],
          onclick: function () {
            notaModo = m[0];
            aplicarModo();
          },
        },
        m[1],
      );
    }),
  );

  var herramientas = el(
    "div",
    { class: "md-tools", id: "md-tools", role: "toolbar", "aria-label": "Formato" },
    [
      ["**", "**", "negrita", "Negrita", el("b", {}, "B")],
      ["*", "*", "cursiva", "Cursiva", el("i", {}, "I")],
      ["`", "`", "código", "Código en línea", "</>"],
    ]
      .map(function (h) {
        return el(
          "button",
          {
            type: "button",
            title: h[3],
            onclick: function () {
              envolverSeleccion(h[0], h[1], h[2]);
            },
          },
          h[4],
        );
      })
  );

  var cuerpo = el("div", { class: "nt-body", id: "note-cols" }, body, vista);

  var buttons = el(
    "div",
    {
      class: "note-buttons",
    },
    el(
      "button",
      {
        class: "ghost",
        onclick: function () {
          copiarNota(r);
        },
      },
      "Copiar nota",
    ),

    el(
      "button",
      {
        class: "ghost",
        onclick: function () {
          descargarNota(r, "md");
        },
      },
      "Descargar .md",
    ),

    el(
      "button",
      {
        class: "ghost",
        onclick: function () {
          descargarNota(r, "txt");
        },
      },
      "Descargar .txt",
    ),

    el(
      "button",
      {
        class: "ghost",
        onclick: function () {
          descargarNota(r, "docx");
        },
      },
      "Descargar .docx",
    ),

    el(
      "button",
      {
        class: "ghost",
        onclick: function () {
          descargarNota(r, "odt");
        },
      },
      "Descargar .odt",
    ),

    sugDisponible
      ? el(
          "button",
          {
            class: "ghost",
            onclick: function () {
              abrirHistorial(r);
            },
          },
          "Historial",
        )
      : null,

    el(
      "button",
      {
        class: "ghost",
        onclick: function () {
          eliminarNota(r);
        },
      },
      "Eliminar",
    ),
  );

  var etiqueta = el(
    "select",
    {
      id: "note-tag",
      title: "Etiqueta",
      onchange: function () {
        cambiarEtiqueta(r, this.value);
      },
    },
    el("option", { value: "" }, "Sin etiquetar"),
    ETIQUETAS.map(function (t) {
      return el("option", { value: t }, t);
    }),
  );
  etiqueta.value = r.etiqueta || "";

  editor.replaceChildren(
    el("div", { class: "note-header" }, title, etiqueta, modos, saveInfo),
    dueno ? el("div", { id: "sug-panel", class: "sug-panel", hidden: true }) : crearBannerSug(r, mia),
    herramientas,
    cuerpo,
    buttons,
  );
  aplicarModo();
  pintarVistaPrevia();
  if (dueno) pintarPanelSug(r);
  else {
    actualizarBannerSug(r);
    saveInfo.textContent = "Sin enviar";
  }

  title.addEventListener("input", function () {
    programarGuardadoNota(r);
  });

  body.addEventListener("input", function () {
    programarGuardadoNota(r);
    clearTimeout(previewTimer);
    previewTimer = setTimeout(pintarVistaPrevia, 120);
  });

  // Tab escribe 2 espacios (Shift+Tab sigue moviendo el foco)
  body.addEventListener("keydown", function (ev) {
    if (ev.key === "Tab" && !ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      ev.preventDefault();
      body.setRangeText("  ", body.selectionStart, body.selectionEnd, "end");
      body.dispatchEvent(new Event("input"));
    }
  });
}

function aplicarModo() {
  var c = $("note-cols");
  if (c) c.dataset.mode = notaModo;
  var h = $("md-tools");
  if (h) h.hidden = notaModo === "view";
  document.querySelectorAll("#note-mode button").forEach(function (b) {
    b.classList.toggle("on", b.dataset.v === notaModo);
  });
}

function pintarVistaPrevia() {
  var v = $("note-preview"),
    b = $("note-body");
  if (v && b) renderMd(b.value, v);
}

// Pone el texto marcado entre `pre` y `post` (o `ph` si no hay nada marcado).
function envolverSeleccion(pre, post, ph) {
  var ta = $("note-body");
  if (!ta) return;
  var s = ta.selectionStart,
    e = ta.selectionEnd;
  var sel = ta.value.slice(s, e) || ph;
  ta.setRangeText(pre + sel + post, s, e, "end");
  ta.focus();
  ta.setSelectionRange(s + pre.length, s + pre.length + sel.length);
  ta.dispatchEvent(new Event("input"));
}

// La etiqueta se guarda al instante (no espera el autoguardado del texto).
async function cambiarEtiqueta(r, valor) {
  var anterior = r.etiqueta || "";
  var res = await sb
    .from("notas")
    .update({ etiqueta: valor || null })
    .eq("id", r.id)
    .select("updated_at, updated_by")
    .single();
  if (res.error) {
    status(errMsg(res.error), true);
    if ($("note-tag")) $("note-tag").value = anterior;
    return;
  }
  r.etiqueta = valor || null;
  r.updated_at = res.data.updated_at;
  r.updated_by = res.data.updated_by;
  pintarListaNotas();
  status("Etiqueta guardada");
}

function programarGuardadoNota(r) {
  var info = $("note-save-info");

  // Nota de otra persona: nada se guarda en la nota; queda como borrador hasta enviarlo como sugerencia.
  if (!esDueno(r)) {
    sugBorradores[r.id] = { titulo: $("note-title").value, contenido: $("note-body").value };
    if (info) info.textContent = "Sin enviar";
    actualizarBannerSug(r);
    return;
  }

  if (info) {
    info.textContent = "Guardando...";
  }

  if (notaSaveTimer) {
    clearTimeout(notaSaveTimer);
  }

  // Se copia lo escrito ahora: si cambiás de nota o de solapa antes de que se guarde, no se pierde ni se mezcla.
  pendingNota = { r: r, titulo: $("note-title").value, contenido: $("note-body").value };
  notaSaveTimer = setTimeout(flushNotaSave, 700);
}

// Guarda ya lo pendiente (si hay). Se usa antes de cambiar de nota, crear o borrar.
async function flushNotaSave() {
  clearTimeout(notaSaveTimer);
  notaSaveTimer = null;
  var p = pendingNota;
  pendingNota = null;
  if (p) await guardarNota(p.r, p);
}

async function guardarNota(r, p) {
  notaSaving++;
  var res;
  try {
    res = await sb
      .from("notas")
      .update({ titulo: p.titulo, contenido: p.contenido })
      .eq("id", r.id)
      .select("updated_at, updated_by")
      .single();
  } finally {
    notaSaving--;
  }

  if (res.error) {
    status(errMsg(res.error), true);

    var infoError = $("note-save-info");
    if (infoError) infoError.textContent = "Error al guardar";

    return;
  }

  r.titulo = p.titulo;
  r.contenido = p.contenido;
  r.updated_at = res.data.updated_at;
  r.updated_by = res.data.updated_by;

  var info = $("note-save-info");
  if (info && !pendingNota) {
    info.textContent = "Guardado";
  }

  status("Nota guardada");
}

async function nuevaNota() {
  await flushNotaSave();
  notaFiltro = ""; // para que la nota nueva no quede oculta por un filtro o una búsqueda
  notaBusqueda = "";

  var res = await sb
    .from("notas")
    .insert(
      sugDisponible && S.user
        ? { titulo: "Nueva nota", contenido: "", autor: S.user.email }
        : { titulo: "Nueva nota", contenido: "" },
    )
    .select()
    .single();

  if (res.error) {
    status(errMsg(res.error), true);
    return;
  }

  notaSel = res.data.id;
  await loadNotas();

  setTimeout(function () {
    var title = $("note-title");
    if (title) {
      title.focus();
      title.select();
    }
  }, 50);
}

async function eliminarNota(r) {
  var aviso = esDueno(r) ? "" : "Esta nota es de " + nombreDe(r.autor) + ". ";
  if (!confirm(aviso + "¿Eliminar esta nota? Va a la Papelera y se puede restaurar desde ahí.")) {
    return;
  }

  // Lo pendiente de esta nota no tiene sentido guardarlo; si es de otra, se guarda.
  if (pendingNota && pendingNota.r.id === r.id) {
    clearTimeout(notaSaveTimer);
    notaSaveTimer = null;
    pendingNota = null;
  } else {
    await flushNotaSave();
  }

  var res = await borrarFila("notas", r.id);

  if (res.error) {
    status(errMsg(res.error), true);
    return;
  }

  notaSel = null;
  await loadNotas();
  status("Nota eliminada");
}

// ---------- Sugerencias (control de cambios) ----------

// Cartel de quien edita una nota ajena: lo que escriba se envía como sugerencia.
function crearBannerSug(r, mia) {
  return el(
    "div",
    { id: "sug-banner", class: "sug-banner" },
    el(
      "div",
      { class: "sug-txt" },
      el("strong", {}, "Nota de " + nombreDe(r.autor) + ". "),
      "Tus cambios no modifican la nota: se envían como sugerencia y " + nombreDe(r.autor) + " decide si los acepta. ",
      el("span", { id: "sug-estado" }),
    ),
    el("input", {
      id: "sug-com",
      type: "text",
      placeholder: "Comentario para quien revisa (opcional)",
      "aria-label": "Comentario de la sugerencia",
      value: (mia && mia.comentario) || "",
    }),
    el(
      "div",
      { class: "sug-acts" },
      el(
        "button",
        {
          id: "sug-enviar",
          type: "button",
          onclick: function () {
            enviarSug(r);
          },
        },
        "Enviar sugerencia",
      ),
      el(
        "button",
        {
          id: "sug-descartar",
          type: "button",
          class: "ghost",
          onclick: function () {
            descartarSug(r);
          },
        },
        "Descartar mis cambios",
      ),
    ),
  );
}

function actualizarBannerSug(r) {
  var b = $("sug-banner");
  if (!b || !$("note-title")) return;
  var t = $("note-title").value,
    c = $("note-body").value;
  var cambios = t !== (r.titulo || "") || c !== (r.contenido || "");
  var mia = miaSug(r);
  var igual = !!mia && t === (mia.titulo || "") && c === (mia.contenido || "");
  var txt;
  if (cambios && mia && igual) txt = "Tu sugerencia está pendiente de revisión.";
  else if (cambios && mia) txt = "Tenés cambios sin enviar; al enviarlos reemplazan tu sugerencia pendiente.";
  else if (cambios) txt = "Tenés cambios sin enviar.";
  else if (mia) txt = "Tenés una sugerencia pendiente; cambiá el texto para reemplazarla o descartala.";
  else txt = "Escribí los cambios y enviá la sugerencia.";
  $("sug-estado").textContent = txt;
  $("sug-enviar").disabled = !cambios || igual;
  $("sug-descartar").hidden = !(mia || sugBorradores[r.id]);
}

async function enviarSug(r) {
  var t = $("note-title").value,
    c = $("note-body").value;
  if (t === (r.titulo || "") && c === (r.contenido || "")) return;
  var datos = {
    titulo: t,
    contenido: c,
    comentario: $("sug-com").value.trim() || null,
    base_titulo: r.titulo || "",
    base_contenido: r.contenido || "",
  };
  var mia = miaSug(r);
  var res = mia
    ? await sb
        .from("notas_sugerencias")
        .update(Object.assign({ actualizada_at: new Date().toISOString() }, datos))
        .eq("id", mia.id)
    : await sb
        .from("notas_sugerencias")
        .insert(Object.assign({ nota_id: r.id, autor: S.user.email, estado: "pendiente" }, datos));
  if (res.error) {
    status(errMsg(res.error), true);
    return;
  }
  delete sugBorradores[r.id];
  await cargarSugs();
  pintarListaNotas();
  actualizarBannerSug(r);
  var info = $("note-save-info");
  if (info) info.textContent = "Sugerencia enviada";
  status("Sugerencia enviada ✓");
}

async function descartarSug(r) {
  if (!confirm("¿Descartar tus cambios" + (miaSug(r) ? " y tu sugerencia pendiente" : "") + "?")) return;
  var mia = miaSug(r);
  if (mia) {
    var res = await sb.from("notas_sugerencias").delete().eq("id", mia.id);
    if (res.error) {
      status(errMsg(res.error), true);
      return;
    }
  }
  delete sugBorradores[r.id];
  await cargarSugs();
  $("note-title").value = r.titulo || "";
  $("note-body").value = r.contenido || "";
  $("sug-com").value = "";
  pintarVistaPrevia();
  pintarListaNotas();
  actualizarBannerSug(r);
  var info = $("note-save-info");
  if (info) info.textContent = "Sin enviar";
  status("Cambios descartados");
}

// Panel de quien es autor: sugerencias de otras personas, comparadas con el texto actual.
function pintarPanelSug(r) {
  var p = $("sug-panel");
  if (!p) return;
  var lista = ajenas(r);
  if (!lista.length) {
    p.replaceChildren();
    p.hidden = true;
    return;
  }
  p.hidden = false;
  p.replaceChildren.apply(
    p,
    [
      el(
        "h4",
        {},
        "✎ " + lista.length + (lista.length === 1 ? " sugerencia pendiente" : " sugerencias pendientes"),
      ),
    ].concat(
      lista.map(function (s) {
        var cambioT = (s.titulo || "") !== (r.titulo || ""),
          cambioC = (s.contenido || "") !== (r.contenido || "");
        var notaCambio = (s.base_titulo || "") !== (r.titulo || "") || (s.base_contenido || "") !== (r.contenido || "");
        return el(
          "div",
          { class: "sug-card" },
          el(
            "div",
            { class: "sug-head" },
            el("strong", {}, nombreDe(s.autor) + " sugiere cambios"),
            el("small", {}, fechaCorta(s.actualizada_at || s.created_at)),
          ),
          s.comentario ? el("div", { class: "sug-com" }, "“" + s.comentario + "”") : null,
          notaCambio
            ? el(
                "div",
                { class: "sug-aviso" },
                "La nota cambió después de esta sugerencia: si la aceptás, se reemplaza el texto actual.",
              )
            : null,
          cambioT ? el("div", { class: "sug-lbl" }, "Título") : null,
          cambioT ? pintarDiff(r.titulo, s.titulo) : null,
          cambioC ? el("div", { class: "sug-lbl" }, "Texto") : null,
          cambioC ? pintarDiff(r.contenido, s.contenido) : null,
          !cambioT && !cambioC ? el("div", { class: "sug-lbl" }, "Es igual al texto actual.") : null,
          el(
            "div",
            { class: "sug-acts" },
            el(
              "button",
              {
                type: "button",
                onclick: function () {
                  this.disabled = true;
                  aceptarSug(r, s);
                },
              },
              "Aceptar",
            ),
            el(
              "button",
              {
                type: "button",
                class: "ghost",
                onclick: function () {
                  this.disabled = true;
                  rechazarSug(r, s);
                },
              },
              "Rechazar",
            ),
          ),
        );
      }),
    ),
  );
}

// Pone en la nota título y texto dados (se usa al aceptar y al restaurar). Devuelve el error, si hay.
async function aplicarANota(r, titulo, contenido) {
  await flushNotaSave(); // primero se guarda lo que el autor estaba escribiendo
  notaSaving++;
  var res;
  try {
    res = await sb
      .from("notas")
      .update({ titulo: titulo, contenido: contenido })
      .eq("id", r.id)
      .select("updated_at, updated_by")
      .single();
  } finally {
    notaSaving--;
  }
  if (res.error) return res.error;
  r.titulo = titulo;
  r.contenido = contenido;
  r.updated_at = res.data.updated_at;
  r.updated_by = res.data.updated_by;
  pintarCamposNota(r);
  var info = $("note-save-info");
  if (info) info.textContent = "Guardado";
  return null;
}

async function aceptarSug(r, s) {
  await flushNotaSave();
  var previo = { titulo: r.titulo || "", contenido: r.contenido || "" };
  var err = await aplicarANota(r, s.titulo || "", s.contenido || "");
  if (err) {
    status(errMsg(err), true);
    pintarPanelSug(r);
    return;
  }
  var res = await sb
    .from("notas_sugerencias")
    .update({
      estado: "aceptada",
      previo_titulo: previo.titulo,
      previo_contenido: previo.contenido,
      resuelta_por: S.user.email,
      resuelta_at: new Date().toISOString(),
    })
    .eq("id", s.id);
  if (res.error) status(errMsg(res.error), true);
  else status("Sugerencia aceptada ✓ (queda en el Historial)");
  await cargarSugs();
  pintarListaNotas();
  pintarPanelSug(r);
}

async function rechazarSug(r, s) {
  var res = await sb
    .from("notas_sugerencias")
    .update({ estado: "rechazada", resuelta_por: S.user.email, resuelta_at: new Date().toISOString() })
    .eq("id", s.id);
  if (res.error) status(errMsg(res.error), true);
  else status("Sugerencia rechazada");
  await cargarSugs();
  pintarListaNotas();
  pintarPanelSug(r);
}

var ETIQ_HIST = { aceptada: "aceptada", rechazada: "rechazada", restaurada: "restauración" };

async function abrirHistorial(r) {
  var res = await sb
    .from("notas_sugerencias")
    .select("*")
    .eq("nota_id", r.id)
    .neq("estado", "pendiente")
    .order("resuelta_at", { ascending: false })
    .limit(30);
  if (res.error) {
    status(errMsg(res.error), true);
    return;
  }
  var filas = res.data || [];
  var cuerpo = filas.length
    ? filas.map(function (s) {
        var cambia = s.estado === "aceptada" || s.estado === "restaurada";
        var antes = cambia ? s.previo_contenido : s.base_contenido;
        var antesT = cambia ? s.previo_titulo : s.base_titulo;
        return el(
          "div",
          { class: "sug-card" },
          el(
            "div",
            { class: "sug-head" },
            el("strong", {}, nombreDe(s.autor) + " · " + (ETIQ_HIST[s.estado] || s.estado)),
            el(
              "small",
              {},
              fechaCorta(s.resuelta_at) + (s.resuelta_por && s.estado !== "restaurada" ? " · por " + nombreDe(s.resuelta_por) : ""),
            ),
          ),
          s.comentario ? el("div", { class: "sug-com" }, "“" + s.comentario + "”") : null,
          el(
            "details",
            {},
            el("summary", {}, "Ver cambios"),
            (antesT || "") !== (s.titulo || "") ? el("div", { class: "sug-lbl" }, "Título") : null,
            (antesT || "") !== (s.titulo || "") ? pintarDiff(antesT, s.titulo) : null,
            el("div", { class: "sug-lbl" }, "Texto"),
            pintarDiff(antes, s.contenido),
          ),
          cambia && esDueno(r)
            ? el(
                "button",
                {
                  type: "button",
                  class: "ghost",
                  onclick: function () {
                    restaurarVersion(r, s);
                  },
                },
                "Volver a la versión anterior",
              )
            : null,
        );
      })
    : [el("p", { class: "nt-empty" }, "Todavía no hay sugerencias resueltas en esta nota.")];
  abrirModal(
    [
      el("h3", {}, "Historial de sugerencias"),
      el("p", { class: "feed-nota" }, "Muestra las sugerencias aceptadas, rechazadas y las restauraciones de esta nota."),
    ]
      .concat(cuerpo)
      .concat([
        el(
          "div",
          { class: "modal-actions" },
          el("button", { type: "button", class: "ghost", onclick: cerrarModal }, "Cerrar"),
        ),
      ]),
    "wide",
  );
}

async function restaurarVersion(r, s) {
  if (!confirm("¿Volver la nota a como estaba antes de este cambio? El texto actual se reemplaza (queda en el Historial).")) return;
  var actual = { titulo: r.titulo || "", contenido: r.contenido || "" };
  await flushNotaSave();
  actual = { titulo: r.titulo || "", contenido: r.contenido || "" };
  var err = await aplicarANota(r, s.previo_titulo || "", s.previo_contenido || "");
  if (err) {
    status(errMsg(err), true);
    return;
  }
  var res = await sb.from("notas_sugerencias").insert({
    nota_id: r.id,
    autor: S.user.email,
    estado: "restaurada",
    titulo: s.previo_titulo || "",
    contenido: s.previo_contenido || "",
    base_titulo: actual.titulo,
    base_contenido: actual.contenido,
    previo_titulo: actual.titulo,
    previo_contenido: actual.contenido,
    resuelta_por: S.user.email,
    resuelta_at: new Date().toISOString(),
  });
  if (res.error) status(errMsg(res.error), true);
  else status("Nota restaurada ✓");
  cerrarModal();
  await cargarSugs();
  pintarListaNotas();
  pintarPanelSug(r);
}

function safeFileName(name) {
  return (name || "nota").replace(/[\\/:*?"<>|]/g, "_").trim() || "nota";
}

function textoNota(r) {
  return {
    title: $("note-title") ? $("note-title").value : r.titulo || "nota",
    content: $("note-body") ? $("note-body").value : r.contenido || "",
  };
}

async function copiarNota(r) {
  var n = textoNota(r);
  var ok = await copiarTexto(n.title + "\n\n" + n.content);
  status(ok ? "Nota copiada ✓" : "No se pudo copiar la nota.", !ok);
  if (ok)
    setTimeout(function () {
      if ($("status") && $("status").textContent === "Nota copiada ✓") status("");
    }, 1500);
}

function descargarNota(r, formato) {
  var n = textoNota(r);
  var title = n.title;
  var content = n.content;

  var base = safeFileName(title);

  if (formato === "md") {
    descargarArchivo(base + ".md", "# " + title + "\n\n" + content, "text/markdown");
  }

  if (formato === "docx") descargarDocx(base, title, content);

  if (formato === "odt") descargarOdt(base, title, content);

  if (formato === "txt") {
    descargarArchivo(base + ".txt", title + "\n\n" + content, "text/plain");
  }
}
