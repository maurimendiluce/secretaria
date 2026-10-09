// Solapa Borradores: lista, editor con autoguardado, estados Revisar / Enviado / Plantilla y cambios en vivo.

import { $, S, el, errMsg, sb, status } from "./core.js";
import { abrirEnGmail, abrirEnProgramaCorreo, copiarMensaje } from "./correo.js";
import { leaveGrid, liveOn } from "./live.js";
import { borrarFila } from "./papelera.js";

var draftRows = [];
// lo que se está mostrando
var draftSel = null;
// id del borrador abierto
var draftSaving = 0;
// guardados en curso
var draftSyncTimer = null;

export function openBorradores() {
  S.tab = "borradores";

  document.querySelectorAll(".tab").forEach(function (b) {
    b.classList.toggle("on", b.getAttribute("data-n") === "borradores");
  });

  leaveGrid();
  draftSel = null;
  $("tools").replaceChildren();
  $("grid").replaceChildren();

  loadBorradores();
}

async function loadBorradores() {
  status("Cargando…");

  var res = await sb.from("borradores").select("*").order("updated_at", { ascending: false });

  if (S.tab !== "borradores") return;

  if (res.error) {
    return status("Error: " + errMsg(res.error), true);
  }

  renderBorradores(res.data);
  liveOn("borradores", "borradores", refrescarBorradores);
  status("");
}

// Lo que escribís vos tiene prioridad: si hay algo sin guardar se espera y se reintenta.
export async function refrescarBorradores() {
  if (S.tab !== "borradores" || !$("draft-list")) return;
  clearTimeout(draftSyncTimer);
  if (pendingDraft || draftSaving > 0) {
    draftSyncTimer = setTimeout(refrescarBorradores, 1500);
    return;
  }

  var res = await sb.from("borradores").select("*").order("updated_at", { ascending: false });
  if (res.error || S.tab !== "borradores" || !$("draft-list")) return;
  if (pendingDraft || draftSaving > 0) {
    draftSyncTimer = setTimeout(refrescarBorradores, 1500);
    return;
  }

  var rows = res.data;
  var cur = draftRows.find(function (x) {
    return x.id === draftSel;
  });
  var i = rows.findIndex(function (x) {
    return x.id === draftSel;
  });
  var perdido = false;

  if (cur && i >= 0) {
    var nuevo = rows[i];
    // Se conserva el mismo objeto (lo usan los botones del editor). Solo se pisa si lo de la base es más nuevo y distinto.
    if (!mismoBorrador(cur, nuevo) && new Date(nuevo.updated_at) > new Date(cur.updated_at)) {
      Object.assign(cur, nuevo);
      pintarCamposBorrador(cur);
    }
    rows[i] = cur;
  } else if (cur) {
    perdido = true; // lo borró la otra persona
  }

  draftRows = rows;
  pintarListaBorradores();

  if (perdido) {
    draftSel = null;
    var vis = borradoresVisibles();
    if (vis.length) renderBorradorEditor(draftRows, vis[0].id);
    else renderEmptyDraft();
    status("Ese borrador lo eliminó otra persona.", true);
  } else if (!cur) {
    var v2 = borradoresVisibles();
    if (v2.length) renderBorradorEditor(draftRows, v2[0].id);
  }
}

function mismoBorrador(a, b) {
  return ["destinatario", "cc", "asunto", "cuerpo", "estado"].every(function (k) {
    return (a[k] || "") === (b[k] || "");
  });
}

// Pone en pantalla los datos de r sin mover el cursor del campo que esté activo.
function pintarCamposBorrador(r) {
  [
    ["draft-to", r.destinatario],
    ["draft-cc", r.cc],
    ["draft-subject", r.asunto],
    ["draft-body", r.cuerpo],
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
  if ($("draft-state")) $("draft-state").value = draftState(r);
  actualizarBotonPlantilla(r);
  if ($("draft-info"))
    $("draft-info").textContent = r.updated_by ? "Última modificación: " + r.updated_by : "";
}

function borradoresVisibles() {
  return draftRows.filter(function (r) {
    return !draftFilter || draftState(r) === draftFilter;
  });
}

function pintarListaBorradores() {
  var list = $("draft-list");
  if (!list) return;
  list.replaceChildren.apply(
    list,
    borradoresVisibles().map(function (r) {
      return el(
        "button",
        {
          class: "draft-item" + (r.id === draftSel ? " on" : ""),
          "data-id": r.id,
          onclick: function () {
            switchBorrador(r.id);
          },
        },
        el(
          "div",
          { class: "draft-row" },
          el("strong", {}, r.asunto || "(Sin asunto)"),
          el("small", { class: "st-badge st-" + draftState(r) }, draftState(r)),
        ),
        el("span", {}, r.destinatario || ""),
      );
    }),
  );
}

function renderBorradores(rows) {
  draftRows = rows;

  var layout = el(
    "div",
    { class: "draft-layout" },

    el(
      "aside",
      { class: "draft-sidebar" },

      el("button", { class: "new-draft", onclick: newBorrador }, "+ Nuevo borrador"),

      el(
        "select",
        {
          class: "draft-filter",
          title: "Filtrar por estado",
          onchange: function () {
            draftFilter = this.value;
            renderBorradores(draftRows);
          },
        },
        el("option", { value: "" }, "Todos los estados"),
        DRAFT_STATES.map(function (s) {
          var o = el("option", { value: s }, s);
          if (s === draftFilter) o.selected = true;
          return o;
        }),
      ),

      el("div", { class: "draft-list", id: "draft-list" }),
    ),

    el("section", { id: "draft-editor", class: "draft-editor" }),
  );

  $("grid").replaceChildren(layout);

  var visible = borradoresVisibles();
  var selected =
    visible.find(function (r) {
      return r.id === draftSel;
    }) ||
    visible[0] ||
    null;
  draftSel = selected ? selected.id : null;
  pintarListaBorradores();

  if (selected) {
    renderBorradorEditor(draftRows, selected.id);
  } else {
    renderEmptyDraft();
  }
}

function renderBorradorEditor(rows, id) {
  var r = rows.find(function (x) {
    return x.id === id;
  });

  if (!r) return;

  draftSel = r.id;
  pintarListaBorradores();

  $("draft-editor").replaceChildren(
    el(
      "div",
      { class: "draft-state-row" },
      el("label", {}, "Estado"),
      el(
        "select",
        {
          id: "draft-state",
          onchange: function () {
            setBorradorEstado(r, this.value);
          },
        },
        DRAFT_STATES.map(function (s) {
          return el("option", { value: s }, s);
        }),
      ),
    ),

    el("label", {}, "Destinatario"),

    el("input", {
      id: "draft-to",
      value: r.destinatario || "",
      placeholder: "correo@ejemplo.com",
    }),

    el("label", {}, "CC"),

    el("input", {
      id: "draft-cc",
      value: r.cc || "",
      placeholder: "correo@ejemplo.com",
    }),

    el("label", {}, "Asunto"),

    el("input", {
      id: "draft-subject",
      value: r.asunto || "",
      placeholder: "Asunto del mensaje",
    }),

    el("label", {}, "Mensaje"),

    el("textarea", {
      id: "draft-body",
      rows: "15",
      placeholder: "Escribí el mensaje...",
    }),

    el(
      "div",
      { class: "draft-actions" },

      el(
        "span",
        {
          id: "draft-info",
          class: "draft-info",
        },
        r.updated_by ? "Última modificación: " + r.updated_by : "",
      ),

      el(
        "button",
        {
          id: "draft-use-tpl",
          title: "Crea un borrador nuevo con este texto; la plantilla queda como está",
          onclick: function () {
            usarPlantilla(r);
          },
        },
        "Usar plantilla",
      ),

      el(
        "button",
        { class: "ghost", title: "Copia solo el texto del mensaje", onclick: copiarMensaje },
        "Copiar mensaje",
      ),

      el(
        "button",
        {
          class: "ghost",
          title: "Abre un correo nuevo en tu programa de correo (Outlook, Mail, etc.)",
          onclick: function () {
            abrirEnProgramaCorreo(r);
          },
        },
        "Programa de correo",
      ),

      el(
        "button",
        {
          title: "Abre un correo nuevo en Gmail, ya completo",
          onclick: function () {
            abrirEnGmail(r);
          },
        },
        "Abrir en Gmail",
      ),

      el(
        "button",
        {
          class: "ghost",
          onclick: function () {
            deleteBorrador(r);
          },
        },
        "Eliminar",
      ),
    ),
  );

  $("draft-body").value = r.cuerpo || "";
  $("draft-state").value = draftState(r);
  actualizarBotonPlantilla(r);

  activarAutoGuardado(r);
}

var draftSaveTimer = null;

var pendingDraft = null;
// { r, patch }: lo último escrito que todavía no se guardó

function leerCamposBorrador() {
  return {
    destinatario: $("draft-to").value,
    cc: $("draft-cc").value,
    asunto: $("draft-subject").value,
    cuerpo: $("draft-body").value,
  };
}

// Guarda ya lo pendiente (si hay). Se usa antes de cambiar de borrador, crear o borrar.
export async function flushDraftSave() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = null;
  var p = pendingDraft;
  pendingDraft = null;
  if (p) await saveBorrador(p.r, p.patch);
}

function activarAutoGuardado(r) {
  ["draft-to", "draft-cc", "draft-subject", "draft-body"].forEach(function (id) {
    var input = $(id);

    if (!input) return;

    input.addEventListener("input", function () {
      clearTimeout(draftSaveTimer);

      status("Cambios pendientes…");

      // Se copia lo escrito en este momento: si cambiás de borrador o de solapa antes de que se guarde,
      // se guarda en el borrador correcto y no se mezcla con los campos de otro.
      pendingDraft = { r: r, patch: leerCamposBorrador() };
      draftSaveTimer = setTimeout(flushDraftSave, 1000);
    });
  });
}

async function saveBorrador(r, patch) {
  draftSaving++;
  var res;
  try {
    res = await sb.from("borradores").update(patch).eq("id", r.id).select("updated_at, updated_by").single();
  } finally {
    draftSaving--;
  }

  if (res.error) {
    return status("No se pudo guardar: " + errMsg(res.error), true);
  }

  r.destinatario = patch.destinatario;
  r.cc = patch.cc;
  r.asunto = patch.asunto;
  r.cuerpo = patch.cuerpo;
  r.updated_at = res.data.updated_at;
  r.updated_by = res.data.updated_by;

  status("Guardado ✓");

  setTimeout(function () {
    if ($("status") && $("status").textContent === "Guardado ✓") {
      status("");
    }
  }, 1200);
}

async function newBorrador() {
  await flushDraftSave();
  draftFilter = ""; // para que el borrador nuevo no quede oculto por un filtro

  status("Creando…");

  var res = await sb
    .from("borradores")
    .insert({
      estado: "Revisar",
    })
    .select("*")
    .single();

  if (res.error) {
    return status("No se pudo crear: " + errMsg(res.error), true);
  }

  draftSel = res.data.id;
  await loadBorradores();

  setTimeout(function () {
    var input = $("draft-to");

    if (input) {
      input.focus();
    }
  }, 100);
}

async function deleteBorrador(r) {
  if (!confirm("¿Eliminar este borrador? Va a la Papelera y se puede restaurar desde ahí.")) {
    return;
  }

  clearTimeout(draftSaveTimer); // lo pendiente es de este borrador: no tiene sentido guardarlo
  draftSaveTimer = null;
  pendingDraft = null;

  var res = await borrarFila("borradores", r.id);

  if (res.error) {
    return status("No se pudo eliminar: " + errMsg(res.error), true);
  }

  draftSel = null;
  await loadBorradores();
}

// ---------- Estado del borrador: Revisar / Enviado ----------
// "Plantilla" = mail precargado que se usa seguido. No se marca como enviado; con "Usar plantilla" se crea una copia para completar y mandar.
var DRAFT_STATES = ["Revisar", "Enviado", "Plantilla"];

var draftFilter = "";
// "" (todos) o uno de DRAFT_STATES

// Los borradores viejos (estado vacío o "Borrador") se muestran como "Revisar".
export function draftState(r) {
  return r.estado === "Enviado" || r.estado === "Plantilla" ? r.estado : "Revisar";
}

async function switchBorrador(id) {
  await flushDraftSave();
  renderBorradorEditor(draftRows, id);
}

function actualizarBotonPlantilla(r) {
  var b = $("draft-use-tpl");
  if (b) b.hidden = draftState(r) !== "Plantilla";
}

async function usarPlantilla(r) {
  await flushDraftSave();
  status("Creando copia…");

  var res = await sb
    .from("borradores")
    .insert({ destinatario: r.destinatario, cc: r.cc, asunto: r.asunto, cuerpo: r.cuerpo, estado: "Revisar" })
    .select("*")
    .single();

  if (res.error) {
    return status("No se pudo crear la copia: " + errMsg(res.error), true);
  }

  draftFilter = ""; // para que la copia no quede oculta por un filtro
  draftSel = res.data.id;
  await loadBorradores();
  status("Copia creada. La plantilla quedó como estaba.");
  setTimeout(function () {
    if ($("status") && /Copia creada/.test($("status").textContent)) status("");
  }, 3000);
  if ($("draft-to")) $("draft-to").focus();
}

export async function setBorradorEstado(r, value) {
  await flushDraftSave();

  status("Guardando…");

  draftSaving++;
  var res;
  try {
    res = await sb
      .from("borradores")
      .update({ estado: value })
      .eq("id", r.id)
      .select("updated_at, updated_by")
      .single();
  } finally {
    draftSaving--;
  }

  if (res.error) {
    if ($("draft-state")) $("draft-state").value = draftState(r);
    return status("No se pudo guardar el estado: " + errMsg(res.error), true);
  }

  r.estado = value;
  r.updated_at = res.data.updated_at;
  r.updated_by = res.data.updated_by;
  actualizarBotonPlantilla(r);

  // Se actualiza la etiqueta de la lista sin recargarla
  var badge = document.querySelector('.draft-item[data-id="' + r.id + '"] .st-badge');
  if (badge) {
    badge.textContent = value;
    badge.className = "st-badge st-" + value;
  }

  status("Guardado ✓");
  setTimeout(function () {
    if ($("status") && $("status").textContent === "Guardado ✓") status("");
  }, 1200);
}

function renderEmptyDraft() {
  $("draft-editor").replaceChildren(
    el("div", { class: "draft-empty" }, "Seleccioná un borrador o creá uno nuevo."),
  );
}
