// Solapa Notas / Proyectos: notas con autoguardado, descargas y cambios en vivo.

import { $, S, copiarTexto, descargarArchivo, el, errMsg, grow, sb, status } from "./core.js";
import { descargarDocx, descargarOdt } from "./exportar.js";
import { leaveGrid, liveOn } from "./live.js";
import { borrarFila } from "./papelera.js";
import { NUBE_URL } from "./tablas.js";

var notaSaveTimer = null;

var notaRows = [];

var notaSel = null;

var notaSaving = 0;

var pendingNota = null;
// { r, titulo, contenido }: lo último escrito que todavía no se guardó
var notaSyncTimer = null;

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
      ((cur.titulo || "") !== (nueva.titulo || "") || (cur.contenido || "") !== (nueva.contenido || "")) &&
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
    if (rows.length) renderNotaEditor(notaRows, rows[0].id);
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
  if ($("note-body")) grow($("note-body"));
}

function pintarListaNotas() {
  var list = $("nota-list");
  if (!list) return;
  list.replaceChildren.apply(
    list,
    notaRows.map(function (r) {
      return el(
        "button",
        {
          class: "draft-item" + (r.id === notaSel ? " on" : ""),
          "data-id": r.id,
          onclick: function () {
            cambiarNota(r.id);
          },
        },
        el("strong", {}, r.titulo || "(Sin título)"),
        el("span", {}, r.updated_at ? new Date(r.updated_at).toLocaleString("es-AR") : ""),
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
      { class: "draft-empty" },
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

  var layout = el("div", { class: "draft-layout" });

  var sidebar = el("aside", { class: "draft-sidebar" });

  sidebar.append(
    el(
      "div",
      { class: "draft-sidebar-head" },
      el("strong", {}, "Notas / Proyectos"),
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
  );

  sidebar.append(el("div", { class: "draft-list", id: "nota-list" }));

  var editor = el("section", {
    class: "draft-editor",
    id: "nota-editor",
  });

  layout.append(sidebar, editor);

  $("grid").replaceChildren(layout);

  var selected =
    rows.find(function (r) {
      return r.id === notaSel;
    }) ||
    rows[0] ||
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
    value: r.titulo || "",
  });

  var body = el("textarea", {
    id: "note-body",
    placeholder: "Escribí acá la nota, ideas, información del proyecto, etc.",
  });

  body.value = r.contenido || "";

  var saveInfo = el(
    "span",
    {
      class: "draft-save-info",
      id: "note-save-info",
    },
    "Guardado",
  );

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

  editor.replaceChildren(el("div", { class: "note-header" }, title, saveInfo), body, buttons);

  title.addEventListener("input", function () {
    programarGuardadoNota(r);
  });

  body.addEventListener("input", function () {
    grow(body);
    programarGuardadoNota(r);
  });

  grow(body);
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
