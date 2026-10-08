(function () {
  "use strict";

  var ESTADOS = ["Pendiente", "En proceso", "Terminado"];
  var RESPONSABLES = ["Naty", "Mauri", "Naty / Mauri"];
  
  var FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSf_FP644YtLRl1_abTDKr4__p3CdIBGOSjZo6GvkKius5I1_g/viewform?embedded=true";

  function today() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function C(k, h, type, options, labels) { return { k: k, h: h, type: type || "text", options: options || null, optionLabels: labels || null }; }

  // Cada pestaña = una tabla de Supabase (ver supabase/schema.sql). Para sumar una columna: agregarla acá y en el schema.
  var TABLES = {
    seguimiento: { label: "Seguimiento", cols: [
      C("fecha", "Fecha", "date"), C("expediente", "N° Expediente"), C("dpto", "Dpto"), C("contacto", "Contacto"),
      C("observaciones", "Observaciones"), C("responsable", "Responsable", "select", RESPONSABLES),
      C("estado", "Estado", "select", ESTADOS), C("notas", "Notas / seguimiento")],
      filters: ["responsable", "estado"],
      // Al entrar a la pestaña se muestran solo estos valores (se pueden cambiar con el filtro). Si se quita esta línea, se muestra todo.
      filterDefaults: { estado: ["Pendiente", "En proceso"] },
      defaults: function () { return { fecha: today(), estado: "Pendiente" }; } },
    comision: { label: "Comisión", cols: [
      C("fecha", "Comisión", "date"),
      C("tipo", "Tipo", "select", ["para", "en"], { para: "Para comisión", en: "En comisión" }),
      C("categoria", "Categoría"), C("expediente", "Expte. / Proyecto"), C("observacion", "Observación"),
      C("estado", "Estado (comisión)")],
      filters: ["fecha", "tipo"], // columnas con desplegable de filtro
      defaults: function () { return { fecha: today(), tipo: "para" }; } },
    contactos_dptos: { label: "Departamentos", cols: [
      C("dpto", "Dpto"), C("director_titular", "Director titular"), C("email_titular", "Email"),
      C("director_adjunto", "Director adjunto"), C("email_adjunto", "Email"),
      C("administrativos", "Administrativos/as"), C("email_admin", "Email")],
      defaults: function () { return {}; } },
    personal: { label: "Secretaría", cols: [
      C("nombre", "Nombre"), C("funcion", "Función"), C("contacto", "Contacto"),
      C("horario", "Horario"), C("home", "Home"), C("vacaciones", "Vacaciones")],
      defaults: function () { return {}; } },
    cuentas_mail: { label: "Cuentas de mail", cols: [C("cuenta", "Cuenta"), C("acceso", "Acceso a")], defaults: function () { return {}; } },
    links: { label: "Links", cols: [C("nombre", "Nombre"), C("valor", "Valor")], defaults: function () { return {}; } }
  };

  var cfg = window.SEGUIMIENTO_CONFIG || {};
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  var root = document.getElementById("app");
  var S = { tab: "seguimiento", data: null, user: null, channel: null, timer: null, pending: false, sel: {} };
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, attrs) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (k === "class") e.className = v;
      else if (k.indexOf("on") === 0) e.addEventListener(k.slice(2), v);
      else if (v != null) e.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null) continue;
      if (Array.isArray(c)) { c.forEach(function (x) { e.append(x.nodeType ? x : document.createTextNode(String(x))); }); continue; }
      e.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return e;
  }
  function status(msg, err) { var s = $("status"); if (!s) return; s.textContent = msg || ""; s.className = "status" + (err ? " err" : ""); }
  function errMsg(e) { return (e && e.message) ? e.message : String(e); }
  function grow(t) { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }
  function inGrid() { var a = document.activeElement; return !!(a && a.closest && a.closest("#grid")); }
  function byText(r) { return r.updated_by ? r.updated_by + " · " + new Date(r.updated_at).toLocaleString("es-AR") : ""; }

  // ---------- Login ----------
  function showLogin(msg) {
    unsubscribe();
    S.data = null;
    root.replaceChildren(
      el("form", { class: "login", onsubmit: onLogin },
        el("h1", {}, "Gestión de Secretaría"),
        el("label", {}, "Email", el("input", { type: "email", name: "email", required: "", autocomplete: "username" })),
        el("label", {}, "Contraseña", el("input", { type: "password", name: "password", required: "", autocomplete: "current-password" })),
        el("button", { type: "submit" }, "Ingresar"),
        el("p", { class: "err", id: "login-err" }, msg || "")
      )
    );
  }
  async function onLogin(ev) {
    ev.preventDefault();
    var f = ev.target;
    var r = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    if (r.error) $("login-err").textContent = "Email o contraseña incorrectos.";
  }

  // ---------- Estructura ----------
  function showApp() {
    root.replaceChildren(
      el("header", { class: "bar" },
        el("h1", {}, "Gestión de Secretaría"),
        el("nav", { id: "tabs" }),
        el("span", { class: "who" }, S.user.email),
        el("button", { class: "ghost", onclick: function () { sb.auth.signOut(); } }, "Salir")
      ),
      el("section", { id: "tools" }),
      el("div", { id: "grid", class: "gridwrap" }),
      el("div", { id: "status", class: "status" })
    );
   $("tabs").replaceChildren.apply($("tabs"), Object.keys(TABLES).map(function (n) {
  return el("button", { class: "tab", "data-n": n, onclick: function () { open(n); } }, TABLES[n].label);
}).concat([
  el("button", { class: "tab", "data-n": "formulario", onclick: function () { openForm(); } }, "Formulario"),
  el("button", { class: "tab", "data-n": "borradores", onclick: function () { openBorradores(); } }, "Borradores"),
  el("button", { class: "tab", "data-n": "notas", onclick: function () { openNotas(); } }, "Notas / Proyectos")
]));
    return open(S.tab);
  }

  async function fetchTable(name) {
    var r = await sb.from(name).select("*").order("id", { ascending: true });
    if (r.error) throw r.error;
    var t = TABLES[name];
    return {
      name: name,
      cols: t.cols.map(function (c) { return { h: c.h, i: c.k, type: c.type, options: c.options, optionLabels: c.optionLabels }; }),
      rows: r.data.map(function (row) {
        return { id: String(row.id), by: byText(row), v: t.cols.map(function (c) { return row[c.k] == null ? "" : String(row[c.k]); }) };
      })
    };
  }

  async function open(name) {
    S.tab = name;
    document.querySelectorAll(".tab").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-n") === name); });
    return load(true);
  }

  function openForm() {
  S.tab = "formulario";

  document.querySelectorAll(".tab").forEach(function (b) {
    b.classList.toggle("on", b.getAttribute("data-n") === "formulario");
  });

  $("tools").replaceChildren();

  $("grid").replaceChildren(
    el("iframe", {
      src: FORM_URL,
      width: "100%",
      height: "800",
      frameborder: "0",
      marginheight: "0",
      marginwidth: "0"
    })
  );

  status("");
}

function openBorradores() {
  S.tab = "borradores";

  document.querySelectorAll(".tab").forEach(function (b) {
    b.classList.toggle(
      "on",
      b.getAttribute("data-n") === "borradores"
    );
  });

  $("tools").replaceChildren();
  $("grid").replaceChildren();

  loadBorradores();
}

async function loadBorradores() {
  status("Cargando…");

  var res = await sb
    .from("borradores")
    .select("*")
    .order("updated_at", { ascending: false });

  if (res.error) {
    return status("Error: " + errMsg(res.error), true);
  }

  renderBorradores(res.data);
  status("");
}

function renderBorradores(rows) {
  var visible = rows.filter(function (r) {
    return !draftFilter || draftState(r) === draftFilter;
  });

  var selected = visible.length ? visible[0] : null;

  var list = el("div", { class: "draft-list" });

  visible.forEach(function (r) {
    list.append(
      el(
        "button",
        {
          class: "draft-item",
          "data-id": r.id,
          onclick: function () {
            switchBorrador(rows, r.id);
          }
        },
        el(
          "div",
          { class: "draft-row" },
          el("strong", {}, r.asunto || "(Sin asunto)"),
          el("small", { class: "st-badge st-" + draftState(r) }, draftState(r))
        ),
        el("span", {}, r.destinatario || "")
      )
    );
  });

  var layout = el(
    "div",
    { class: "draft-layout" },

    el(
      "aside",
      { class: "draft-sidebar" },

      el(
        "button",
        {
          class: "new-draft",
          onclick: newBorrador
        },
        "+ Nuevo borrador"
      ),

      el(
        "select",
        {
          class: "draft-filter",
          title: "Filtrar por estado",
          onchange: function () {
            draftFilter = this.value;
            renderBorradores(rows);
          }
        },
        el("option", { value: "" }, "Todos los estados"),
        DRAFT_STATES.map(function (s) {
          var o = el("option", { value: s }, s);
          if (s === draftFilter) o.selected = true;
          return o;
        })
      ),

      list
    ),

    el(
      "section",
      {
        id: "draft-editor",
        class: "draft-editor"
      }
    )
  );

  $("grid").replaceChildren(layout);

  if (selected) {
    renderBorradorEditor(rows, selected.id);
  } else {
    renderEmptyDraft();
  }
}

function renderBorradorEditor(rows, id) {
  var r = rows.find(function (x) {
    return x.id === id;
  });

  if (!r) return;

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
          }
        },
        DRAFT_STATES.map(function (s) {
          return el("option", { value: s }, s);
        })
      )
    ),

    el("label", {}, "Destinatario"),

    el("input", {
      id: "draft-to",
      value: r.destinatario || "",
      placeholder: "correo@ejemplo.com"
    }),

    el("label", {}, "CC"),

    el("input", {
      id: "draft-cc",
      value: r.cc || "",
      placeholder: "correo@ejemplo.com"
    }),

    el("label", {}, "Asunto"),

    el("input", {
      id: "draft-subject",
      value: r.asunto || "",
      placeholder: "Asunto del mensaje"
    }),

    el("label", {}, "Mensaje"),

    el("textarea", {
      id: "draft-body",
      rows: "15",
      placeholder: "Escribí el mensaje..."
    }),

    el(
      "div",
      { class: "draft-actions" },

      el(
        "span",
        {
          id: "draft-info",
          class: "draft-info"
        },
        r.updated_by
          ? "Última modificación: " + r.updated_by
          : ""
      ),

      el("button", { class: "ghost", title: "Copia solo el texto del mensaje", onclick: copiarMensaje }, "Copiar mensaje"),

      el("button", { class: "ghost", title: "Abre un correo nuevo en tu programa de correo (Outlook, Mail, etc.)", onclick: function () { abrirEnProgramaCorreo(r); } }, "Programa de correo"),

      el("button", { title: "Abre un correo nuevo en Gmail, ya completo", onclick: function () { abrirEnGmail(r); } }, "Abrir en Gmail"),

      el(
        "button",
        {
          class: "ghost",
          onclick: function () {
            deleteBorrador(r);
          }
        },
        "Eliminar"
      )
    )
  );

  $("draft-body").value = r.cuerpo || "";
  $("draft-state").value = draftState(r);

  activarAutoGuardado(r);
}

var draftSaveTimer = null;
var pendingDraft = null; // { r, patch }: lo último escrito que todavía no se guardó

function leerCamposBorrador() {
  return {
    destinatario: $("draft-to").value,
    cc: $("draft-cc").value,
    asunto: $("draft-subject").value,
    cuerpo: $("draft-body").value
  };
}

// Guarda ya lo pendiente (si hay). Se usa antes de cambiar de borrador, crear o borrar.
async function flushDraftSave() {
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

  var res = await sb
    .from("borradores")
    .update(patch)
    .eq("id", r.id)
    .select("updated_at, updated_by")
    .single();

  if (res.error) {
    return status(
      "No se pudo guardar: " + errMsg(res.error),
      true
    );
  }

  r.destinatario = patch.destinatario;
  r.cc = patch.cc;
  r.asunto = patch.asunto;
  r.cuerpo = patch.cuerpo;
  r.updated_at = res.data.updated_at;
  r.updated_by = res.data.updated_by;

  status("Guardado ✓");

  setTimeout(function () {
    if (
      $("status") &&
      $("status").textContent === "Guardado ✓"
    ) {
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
      estado: "Revisar"
    })
    .select("*")
    .single();

  if (res.error) {
    return status(
      "No se pudo crear: " + errMsg(res.error),
      true
    );
  }

  await loadBorradores();

  setTimeout(function () {
    var input = $("draft-to");

    if (input) {
      input.focus();
    }
  }, 100);
}

async function deleteBorrador(r) {

  if (!confirm("¿Eliminar este borrador?")) {
    return;
  }

  clearTimeout(draftSaveTimer); // lo pendiente es de este borrador: no tiene sentido guardarlo
  draftSaveTimer = null;
  pendingDraft = null;

  var res = await sb
    .from("borradores")
    .delete()
    .eq("id", r.id);

  if (res.error) {
    return status(
      "No se pudo eliminar: " + errMsg(res.error),
      true
    );
  }

  await loadBorradores();
}

// ---------- Estado del borrador: Revisar / Enviado ----------
var DRAFT_STATES = ["Revisar", "Enviado"];
var draftFilter = ""; // "", "Revisar" o "Enviado"

// Los borradores viejos (estado vacío o "Borrador") se muestran como "Revisar".
function draftState(r) {
  return r.estado === "Enviado" ? "Enviado" : "Revisar";
}

async function switchBorrador(rows, id) {
  await flushDraftSave();
  renderBorradorEditor(rows, id);
}

async function setBorradorEstado(r, value) {
  await flushDraftSave();

  status("Guardando…");

  var res = await sb
    .from("borradores")
    .update({ estado: value })
    .eq("id", r.id)
    .select("updated_at, updated_by")
    .single();

  if (res.error) {
    if ($("draft-state")) $("draft-state").value = draftState(r);
    return status("No se pudo guardar el estado: " + errMsg(res.error), true);
  }

  r.estado = value;
  r.updated_at = res.data.updated_at;
  r.updated_by = res.data.updated_by;

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

// ---------- Abrir el borrador en el correo ----------
var MAX_URL_GMAIL = 7000;  // si el link supera esto, se abre sin el texto y el texto se copia al portapapeles
var MAX_URL_MAILTO = 2000; // los programas de correo aceptan links más cortos

function listaCorreos(s) {
  return (s || "").split(/[;,\s]+/).map(function (x) { return x.replace(/^[<"']+|[>"']+$/g, ""); }).filter(Boolean);
}

// Lee lo que hay en pantalla (aunque todavía no se haya guardado) y lo valida. Devuelve null si algo está mal.
function prepararEnvio() {
  var to = listaCorreos($("draft-to").value), cc = listaCorreos($("draft-cc").value);
  if (!to.length) { status("Falta el destinatario.", true); return null; }
  var malos = to.concat(cc).filter(function (x) { return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); });
  if (malos.length) { status("Revisá este correo, no parece válido: " + malos[0], true); return null; }
  return { to: to.join(","), cc: cc.join(","), subject: $("draft-subject").value, body: $("draft-body").value };
}

async function copiarTexto(t) {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch (e) {
    var ta = el("textarea", { style: "position:fixed;opacity:0" });
    ta.value = t;
    document.body.append(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
    ta.remove();
    return ok;
  }
}

async function copiarMensaje() {
  var ok = await copiarTexto($("draft-body").value);
  status(ok ? "Mensaje copiado ✓" : "No se pudo copiar el mensaje.", !ok);
  if (ok) setTimeout(function () { if ($("status") && $("status").textContent === "Mensaje copiado ✓") status(""); }, 1500);
}

async function abrirEnGmail(r) {
  var m = prepararEnvio();
  if (!m) return;

  function url(conTexto) {
    var p = { view: "cm", fs: "1", to: m.to, su: m.subject };
    if (m.cc) p.cc = m.cc;
    if (conTexto) p.body = m.body;
    return "https://mail.google.com/mail/?" + new URLSearchParams(p).toString();
  }

  var u = url(true);
  if (u.length > MAX_URL_GMAIL) {
    u = url(false);
    await copiarTexto(m.body);
    status("El mensaje es largo: lo copié. Pegalo en Gmail con Ctrl+V.");
  }
  var a = el("a", { href: u, target: "_blank", rel: "noopener noreferrer" }); // un enlace con clic no lo frena el bloqueador de ventanas
  document.body.append(a);
  a.click();
  a.remove();
  flushDraftSave();
  preguntarEnviado(r);
}

async function abrirEnProgramaCorreo(r) {
  var m = prepararEnvio();
  if (!m) return;

  function url(conTexto) {
    var q = [];
    if (m.cc) q.push("cc=" + encodeURIComponent(m.cc));
    q.push("subject=" + encodeURIComponent(m.subject));
    if (conTexto) q.push("body=" + encodeURIComponent(m.body.replace(/\r?\n/g, "\r\n")));
    return "mailto:" + m.to + "?" + q.join("&");
  }

  var u = url(true);
  if (u.length > MAX_URL_MAILTO) {
    u = url(false);
    await copiarTexto(m.body);
    status("El mensaje es largo: lo copié. Pegalo en el correo con Ctrl+V.");
  }
  var a = el("a", { href: u });
  document.body.append(a);
  a.click();
  a.remove();
  flushDraftSave();
  preguntarEnviado(r);
}

// Después de abrir el correo, se pregunta si se envió para marcarlo.
function preguntarEnviado(r) {
  var old = $("draft-sent-ask");
  if (old) old.remove();
  if (draftState(r) === "Enviado") return;

  var bar = el(
    "div",
    { id: "draft-sent-ask", class: "draft-ask" },
    el("span", {}, "¿Enviaste este mensaje?"),
    el("button", {
      onclick: function () {
        bar.remove();
        if ($("draft-state")) $("draft-state").value = "Enviado";
        setBorradorEstado(r, "Enviado");
      }
    }, "Sí, marcar como enviado"),
    el("button", { class: "ghost", onclick: function () { bar.remove(); } }, "Todavía no")
  );

  $("draft-editor").prepend(bar);
}

function renderEmptyDraft() {

  $("draft-editor").replaceChildren(
    el(
      "div",
      { class: "draft-empty" },
      "Seleccioná un borrador o creá uno nuevo."
    )
  );
}


  async function load(rebuildTools) {
    var name = S.tab;
    status("Cargando…");
    try {
      var d = await fetchTable(name);
      if (name !== S.tab) return;
      S.data = d;
      if (rebuildTools) tools();
      grid();
      status("");
      subscribe(name);
    } catch (e) { status("Error: " + errMsg(e), true); }
  }

// =========================
// Notas / Proyectos
// =========================

var notaSaveTimer = null;

async function openNotas() {
  S.tab = "notas";

  document.querySelectorAll(".tab").forEach(function (b) {
    b.classList.toggle("on", b.dataset.n === "notas");
  });

  $("tools").replaceChildren();
  $("grid").replaceChildren();

  return loadNotas();
}

async function loadNotas() {
  status("Cargando notas...");

  var res = await sb
    .from("notas")
    .select("*")
    .order("updated_at", { ascending: false });

  if (res.error) {
    status(errMsg(res.error), true);
    return;
  }

  renderNotas(res.data || []);
  status("");
}

function renderNotas(rows) {
  var selected = rows.length ? rows[0] : null;

  var layout = el("div", { class: "draft-layout" });

  var sidebar = el("aside", { class: "draft-sidebar" });

  sidebar.append(
    el("div", { class: "draft-sidebar-head" },
      el("strong", {}, "Notas / Proyectos"),
      el("button", {
        onclick: function () {
          nuevaNota();
        }
      }, "+ Nueva")
    )
  );

  var list = el("div", { class: "draft-list" });

  rows.forEach(function (r) {
    var item = el("button", {
      class: "draft-item",
      onclick: function () {
        renderNotaEditor(rows, r.id);
      }
    },
      el("strong", {}, r.titulo || "(Sin título)"),
      el("span", {},
        r.updated_at
          ? new Date(r.updated_at).toLocaleString("es-AR")
          : ""
      )
    );

    list.append(item);
  });

  sidebar.append(list);

  var editor = el("section", {
    class: "draft-editor",
    id: "nota-editor"
  });

  layout.append(sidebar, editor);

  $("grid").replaceChildren(layout);

  if (selected) {
    renderNotaEditor(rows, selected.id);
  } else {
    editor.replaceChildren(
      el("div", { class: "draft-empty" },
        "No hay notas todavía.",
        el("button", {
          onclick: function () {
            nuevaNota();
          }
        }, "Crear primera nota")
      )
    );
  }
}

function renderNotaEditor(rows, id) {
  var r = rows.find(function (x) {
    return String(x.id) === String(id);
  });

  if (!r) return;

  var editor = $("nota-editor");

  if (!editor) return;

  if (notaSaveTimer) {
    clearTimeout(notaSaveTimer);
    notaSaveTimer = null;
  }

  var title = el("input", {
    id: "note-title",
    type: "text",
    placeholder: "Título de la nota o proyecto",
    value: r.titulo || ""
  });

  var body = el("textarea", {
    id: "note-body",
    placeholder: "Escribí acá la nota, ideas, información del proyecto, etc."
  });

  body.value = r.contenido || "";

  var saveInfo = el("span", {
    class: "draft-save-info",
    id: "note-save-info"
  }, "Guardado");

  var buttons = el("div", {
    class: "note-buttons"
  },
    el("button", {
      class: "ghost",
      onclick: function () {
        descargarNota(r, "md");
      }
    }, "Descargar .md"),

    el("button", {
      class: "ghost",
      onclick: function () {
        descargarNota(r, "txt");
      }
    }, "Descargar .txt"),

    el("button", {
      class: "ghost",
      onclick: function () {
        eliminarNota(r);
      }
    }, "Eliminar")
  );

  editor.replaceChildren(
    el("div", { class: "note-header" },
      title,
      saveInfo
    ),
    body,
    buttons
  );

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

  notaSaveTimer = setTimeout(function () {
    guardarNota(r);
  }, 700);
}

async function guardarNota(r) {
  var title = $("note-title");
  var body = $("note-body");

  if (!title || !body) return;

  var res = await sb
    .from("notas")
    .update({
      titulo: title.value,
      contenido: body.value
    })
    .eq("id", r.id);

  if (res.error) {
    status(errMsg(res.error), true);

    var infoError = $("note-save-info");
    if (infoError) infoError.textContent = "Error al guardar";

    return;
  }

  r.titulo = title.value;
  r.contenido = body.value;

  var info = $("note-save-info");
  if (info) {
    info.textContent = "Guardado";
  }

  status("Nota guardada");
}

async function nuevaNota() {
  var res = await sb
    .from("notas")
    .insert({
      titulo: "Nueva nota",
      contenido: ""
    })
    .select()
    .single();

  if (res.error) {
    status(errMsg(res.error), true);
    return;
  }

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
  if (!confirm("¿Eliminar esta nota?")) {
    return;
  }

  var res = await sb
    .from("notas")
    .delete()
    .eq("id", r.id);

  if (res.error) {
    status(errMsg(res.error), true);
    return;
  }

  await loadNotas();
  status("Nota eliminada");
}

function safeFileName(name) {
  return (name || "nota")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim() || "nota";
}

function descargarArchivo(filename, content, mime) {
  var blob = new Blob(
    [content],
    { type: mime + ";charset=utf-8" }
  );

  var url = URL.createObjectURL(blob);

  var a = document.createElement("a");
  a.href = url;
  a.download = filename;

  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(function () {
    URL.revokeObjectURL(url);
  }, 1000);
}

function descargarNota(r, formato) {
  var title = $("note-title")
    ? $("note-title").value
    : (r.titulo || "nota");

  var content = $("note-body")
    ? $("note-body").value
    : (r.contenido || "");

  var base = safeFileName(title);

  if (formato === "md") {
    descargarArchivo(
      base + ".md",
      "# " + title + "\n\n" + content,
      "text/markdown"
    );
  }

  if (formato === "txt") {
    descargarArchivo(
      base + ".txt",
      title + "\n\n" + content,
      "text/plain"
    );
  }
}

  // ---------- Cambios en vivo ----------
  function unsubscribe() { if (S.channel) { sb.removeChannel(S.channel); S.channel = null; } }
  function subscribe(name) {
    if (S.channel && S.channel.__name === name) return;
    unsubscribe();
    S.channel = sb.channel("rt-" + name)
      .on("postgres_changes", { event: "*", schema: "public", table: name }, function () {
        clearTimeout(S.timer);
        S.timer = setTimeout(refresh, 400);
      }).subscribe();
    S.channel.__name = name;
  }
  async function refresh() {
    if (!S.data) return;
    if (inGrid()) { S.pending = true; return; } // no pisar lo que se está escribiendo
    var name = S.tab;
    try {
      var d = await fetchTable(name);
      if (name !== S.tab || inGrid()) { S.pending = true; return; }
      S.data = d; grid();
    } catch (e) { /* se reintenta en el próximo cambio */ }
  }
  document.addEventListener("focusout", function () {
    setTimeout(function () { if (S.pending && !inGrid()) { S.pending = false; refresh(); } }, 250);
  });
  
  //setInterval(function () { if (!document.hidden && S.data) refresh(); }, 60000); // respaldo por si se corta la conexión en vivo

setInterval(function () {
  if (
    !document.hidden &&
    S.data &&
    S.tab !== "formulario" &&
    S.tab !== "borradores" &&
    S.tab !== "notas"
  ) {
    refresh();
  }
}, 60000);
  // ---------- Tabla ----------
  function colIdx(h) { return S.data.cols.findIndex(function (c) { return c.h.toLowerCase() === h; }); }

  function tools() {
    var items = [el("input", { type: "search", id: "q", placeholder: "Buscar…", oninput: filter })];
    // Filtros de selección múltiple. Al entrar a la pestaña arrancan con los valores de filterDefaults (si los hay).
    var defs = TABLES[S.tab].filterDefaults || {};
    S.sel = {};
    (TABLES[S.tab].filters || []).forEach(function (k) {
      var i = S.data.cols.findIndex(function (c) { return c.i === k; });
      if (i < 0) return;
      if (defs[k]) S.sel[i] = defs[k].slice();
      items.push(el("div", { class: "mf", "data-i": i },
        el("button", { type: "button", class: "ghost mf-btn", onclick: function (ev) { toggleMF(ev.currentTarget.parentNode); } }),
        el("div", { class: "mf-pop", hidden: "" })));
    });
    items.push(el("button", { onclick: add }, "+ Nueva fila"));
    items.push(el("button", { class: "ghost", onclick: function () { load(false); } }, "Recargar"));
    items.push(el("button", { class: "ghost", onclick: exportXlsx }, "Exportar a Excel"));
    items.push(el("span", { class: "count", id: "count" }));
    $("tools").replaceChildren.apply($("tools"), items);
  }

  // ---------- Filtros de selección múltiple ----------
  function closeMFs() { document.querySelectorAll(".mf-pop").forEach(function (p) { p.hidden = true; }); }
  function toggleMF(mf) {
    var pop = mf.querySelector(".mf-pop"), wasHidden = pop.hidden;
    closeMFs();
    pop.hidden = !wasHidden;
  }
  document.addEventListener("click", function (ev) { if (!ev.target.closest || !ev.target.closest(".mf")) closeMFs(); });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") closeMFs(); });

  function optLabel(c, v) { return c.type === "date" ? fmtDate(v) : ((c.optionLabels && c.optionLabels[v]) || v); }

  function mfLabel(mf, i) {
    var c = S.data.cols[i], vals = S.sel[i] || [];
    var txt = !vals.length ? "todos" : vals.length <= 2 ? vals.map(function (v) { return optLabel(c, v); }).join(", ") : vals.length + " seleccionados";
    var btn = mf.querySelector(".mf-btn");
    btn.textContent = c.h + ": " + txt + " ▾";
    btn.classList.toggle("on", vals.length > 0);
  }

  function onMFChange(mf, i) {
    S.sel[i] = Array.prototype.map.call(mf.querySelectorAll(".mf-pop input:checked"), function (x) { return x.value; });
    mfLabel(mf, i);
    filter();
  }

  function clearMF(mf, i) {
    S.sel[i] = [];
    mf.querySelectorAll(".mf-pop input").forEach(function (x) { x.checked = false; });
    mfLabel(mf, i);
    filter();
  }

  function grid() {
    var d = S.data, rows = d.rows.slice();
    var di = d.cols.findIndex(function (c) { return c.type === "date"; });
    if (di >= 0) rows.reverse().sort(function (a, b) { return a.v[di] < b.v[di] ? 1 : a.v[di] > b.v[di] ? -1 : 0; }); // más nuevo arriba
    else rows.reverse();
    var tb = el("tbody");
    rows.forEach(function (r) { tb.append(rowEl(r)); });
    var head = el("tr");
    d.cols.forEach(function (c) { head.append(el("th", {}, c.h)); });
    head.append(el("th"));
    $("grid").replaceChildren(el("table", {}, el("thead", {}, head), tb));
    document.querySelectorAll("#grid textarea").forEach(grow);
    fillFilters();
    filter();
  }

  function fmtDate(v) { var m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(v); return m ? m[3] + "/" + m[2] + "/" + m[1] : v; }

  // Completa las casillas de cada filtro: las fechas salen de los datos (se actualizan solas), el resto de las opciones de la columna.
  function fillFilters() {
    document.querySelectorAll("#tools .mf").forEach(function (mf) {
      var i = +mf.getAttribute("data-i"), c = S.data.cols[i], opts;
      if (c.type === "date") {
        var seen = {};
        S.data.rows.forEach(function (r) { if (r.v[i]) seen[r.v[i]] = 1; });
        opts = Object.keys(seen).sort().reverse().map(function (v) { return [v, fmtDate(v)]; });
      } else {
        opts = (c.options || []).map(function (o) { return [o, (c.optionLabels && c.optionLabels[o]) || o]; });
      }
      // Se descartan selecciones que ya no existen (por ejemplo, una fecha que ya no tiene filas)
      S.sel[i] = (S.sel[i] || []).filter(function (v) { return opts.some(function (o) { return o[0] === v; }); });
      var pop = mf.querySelector(".mf-pop");
      if (pop.hidden) { // si el menú está abierto no se toca, para no cambiarlo mientras se usa
        var sel = S.sel[i];
        pop.replaceChildren.apply(pop, opts.map(function (o) {
          var cb = el("input", { type: "checkbox", value: o[0] });
          cb.checked = sel.indexOf(o[0]) >= 0;
          cb.addEventListener("change", function () { onMFChange(mf, i); });
          return el("label", { class: "mf-opt" }, cb, o[1]);
        }).concat([el("button", { type: "button", class: "mf-clear", onclick: function () { clearMF(mf, i); } }, "Mostrar todos")]));
      }
      mfLabel(mf, i);
    });
  }

  function rowEl(r) {
    var d = S.data, tr = el("tr", { "data-id": r.id, title: r.by ? "Editado por " + r.by : "" });
    var ei = colIdx("estado");
    if (ei >= 0 && r.v[ei]) tr.className = "st-" + r.v[ei].replace(/\s/g, "");
    d.cols.forEach(function (c, k) {
      var inp;
      if (c.type === "select") {
        inp = el("select", {}, el("option", { value: "" }, ""));
        c.options.forEach(function (o) { inp.append(el("option", { value: o }, (c.optionLabels && c.optionLabels[o]) || o)); });
        if (r.v[k] && c.options.indexOf(r.v[k]) < 0) inp.append(el("option", { value: r.v[k] }, r.v[k]));
      } else if (c.type === "date") inp = el("input", { type: "date" });
      else { inp = el("textarea", { rows: "1" }); inp.addEventListener("input", function () { grow(inp); }); }
      inp.value = r.v[k];
      inp.addEventListener("change", function () { save(r, k, c, inp, tr); });
      tr.append(el("td", {}, inp));
    });
    tr.append(el("td", { class: "act" }, el("button", { class: "del", title: "Borrar fila", onclick: function () { del(r); } }, "✕")));
    return tr;
  }

  // Se guarda solo la celda modificada: dos personas editando celdas distintas no se pisan.
  async function save(r, k, c, inp, tr) {
    status("Guardando…");
    var v = inp.value === "" ? null : inp.value, patch = {};
    patch[c.i] = v;
    var res = await sb.from(S.tab).update(patch).eq("id", r.id).select("updated_by,updated_at").single();
    if (res.error) return status("No se pudo guardar: " + errMsg(res.error), true);
    r.v[k] = inp.value; r.by = byText(res.data); tr.title = "Editado por " + r.by;
    if (c.h.toLowerCase() === "estado") tr.className = inp.value ? "st-" + inp.value.replace(/\s/g, "") : "";
    status("Guardado ✓");
    setTimeout(function () { if ($("status") && $("status").textContent === "Guardado ✓") status(""); }, 1500);
  }

  async function add() {
    status("Creando…");
    var res = await sb.from(S.tab).insert(TABLES[S.tab].defaults()).select("id").single();
    if (res.error) return status("No se pudo crear: " + errMsg(res.error), true);
    await load(false);
    revealRow(res.data.id);
    var tr = document.querySelector('#grid tr[data-id="' + res.data.id + '"]');
    var f = tr && tr.querySelector("input,textarea,select"); if (f) f.focus();
  }

  // Si algún filtro (o la búsqueda) oculta la fila recién creada, se quita ese filtro para que no desaparezca.
  function revealRow(id) {
    var r = S.data.rows.find(function (x) { return String(x.id) === String(id); });
    if (!r) return;
    var cleared = [];
    Object.keys(S.sel).forEach(function (i) {
      if (S.sel[i].length && S.sel[i].indexOf(r.v[i]) < 0) { S.sel[i] = []; cleared.push(S.data.cols[i].h); }
    });
    var q = $("q");
    if (q && q.value && r.v.join(" ").toLowerCase().indexOf(q.value.toLowerCase()) < 0) { q.value = ""; cleared.push("búsqueda"); }
    if (!cleared.length) return;
    fillFilters();
    filter();
    status("Se quitó el filtro de " + cleared.join(", ") + " para mostrar la fila nueva.");
    setTimeout(function () { if ($("status") && /para mostrar la fila nueva/.test($("status").textContent)) status(""); }, 4000);
  }

  async function del(r) {
    if (!confirm("¿Borrar esta fila? Esto no se puede deshacer.")) return;
    var res = await sb.from(S.tab).delete().eq("id", r.id);
    if (res.error) return status("No se pudo borrar: " + errMsg(res.error), true);
    await load(false);
  }

  function filter() {
    var q = ($("q") && $("q").value || "").toLowerCase();
    // Cada filtro es una lista de valores permitidos: la fila se muestra si su valor está en la lista (lista vacía = sin filtro)
    var active = Object.keys(S.sel).filter(function (i) { return S.sel[i].length; }).map(function (i) { return { i: +i, v: S.sel[i] }; });
    var byId = {}; S.data.rows.forEach(function (r) { byId[r.id] = r; });
    var shown = 0;
    document.querySelectorAll("#grid tbody tr").forEach(function (tr) {
      var r = byId[tr.getAttribute("data-id")]; if (!r) return;
      var ok = (!q || r.v.join(" ").toLowerCase().indexOf(q) >= 0) && active.every(function (f) { return f.v.indexOf(r.v[f.i]) >= 0; });
      tr.style.display = ok ? "" : "none";
      if (ok) shown++;
    });
    var cnt = $("count");
    if (cnt) cnt.textContent = "Mostrando " + shown + " de " + S.data.rows.length;
  }

  // ---------- Exportar a Excel (todas las pestañas) ----------
  async function exportXlsx() {
    if (!window.XLSX) return status("No se cargó la librería de Excel.", true);
    status("Exportando…");
    try {
      var wb = XLSX.utils.book_new();
      for (var name of Object.keys(TABLES)) {
        var d = await fetchTable(name);
        var aoa = [d.cols.map(function (c) { return c.h; }).concat(["Editado"])];
        d.rows.forEach(function (r) { aoa.push(r.v.concat([r.by])); });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), TABLES[name].label.slice(0, 31));
      }
      XLSX.writeFile(wb, "seguimiento-" + today() + ".xlsx");
      status("");
    } catch (e) { status("No se pudo exportar: " + errMsg(e), true); }
  }

  // ---------- Sesión ----------
  var current; // undefined hasta el primer evento
  sb.auth.onAuthStateChange(function (event, session) {
    var uid = session ? session.user.id : null;
    if (uid === current && event !== "SIGNED_OUT") return; // ignorar refrescos de token
    current = uid;
    if (session) { S.user = session.user; showApp(); } else { S.user = null; showLogin(); }
  });
})();