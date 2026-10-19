// Solapa Notas / Proyectos: editor Markdown con vista previa (y LaTeX), etiquetas, buscador, autoguardado,
// descargas y cambios en vivo.

import { $, S, copiarTexto, descargarArchivo, el, errMsg, normalizar, sb, status } from "./core.js";
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

  renderNotas(res.data || []);
  liveOn("notas", "notas", refrescarNotas);
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
      pintarCamposNota(cur);
    }
    rows[i] = cur;
  } else if (cur) {
    perdida = true; // la borró la otra persona
  }

  notaRows = rows;
  pintarListaNotas();

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
        .replace(/[#*`>$\\-]+/g, " ")
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

  var title = el("input", {
    id: "note-title",
    type: "text",
    placeholder: "Título de la nota o proyecto",
    "aria-label": "Título",
    value: r.titulo || "",
  });

  var body = el("textarea", {
    id: "note-body",
    class: "nt-editor",
    spellcheck: "false",
    "aria-label": "Contenido de la nota",
    placeholder:
      "Escribí en Markdown… (# títulos, **negrita**, listas, `código`) y LaTeX: $\\nabla u = f$ o $$\\int_\\Omega u\\,v\\,dx$$",
  });

  body.value = r.contenido || "";

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
      ["$", "$", "x^2", "Fórmula en línea: $…$", "$x$"],
      ["\n$$\n", "\n$$\n", "\\int_0^1 f(x)\\,dx", "Fórmula en bloque: $$…$$", "$$"],
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
      .concat([
        el("span", { class: "nt-hint" }, [
          "LaTeX: ",
          el("code", {}, "$x^2$"),
          " en línea, ",
          el("code", {}, "$$…$$"),
          " en bloque",
        ]),
      ]),
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
    herramientas,
    cuerpo,
    buttons,
  );
  aplicarModo();
  pintarVistaPrevia();

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
    .insert({
      titulo: "Nueva nota",
      contenido: "",
    })
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
  if (!confirm("¿Eliminar esta nota? Va a la Papelera y se puede restaurar desde ahí.")) {
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
