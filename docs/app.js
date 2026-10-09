(function () {
  "use strict";

  var ESTADOS = ["Pendiente", "En proceso", "Terminado"];
  var RESPONSABLES = ["Naty", "Mauri", "Naty / Mauri"];
  
  var FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSf_FP644YtLRl1_abTDKr4__p3CdIBGOSjZo6GvkKius5I1_g/viewform?embedded=true";

  // Carpeta de proyectos en la nube de Exactas (botón en la solapa Notas / Proyectos)
  var NUBE_URL = "https://nube.exactas.uba.ar/index.php/f/26167782";

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
    liveOff();
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
        el("span", { class: "bk-info", id: "bk-info" }),
        el("button", { class: "ghost", title: "Descarga todos los datos en un archivo", onclick: copiaSeguridad }, "Copia de seguridad"),
        el("button", { class: "ghost", title: "Lo que se borró, para restaurarlo", onclick: abrirPapelera }, "Papelera"),
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
  el("button", { class: "tab", "data-n": "calendario", onclick: function () { openCalendario(); } }, "Calendario"),
  el("button", { class: "tab", "data-n": "notas", onclick: function () { openNotas(); } }, "Notas / Proyectos")
]));
    actualizarAvisoCopia();
    var pr = open(S.tab);
    pr.then(avisoCopiaInicial);
    return pr;
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
    liveOff();
    document.querySelectorAll(".tab").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-n") === name); });
    return load(true);
  }

  function openForm() {
  S.tab = "formulario";
  leaveGrid();

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

// ---------- Cambios en vivo para Borradores y Notas ----------
// Un solo canal a la vez: al cambiar de pestaña se cierra. Los cambios de la otra persona llegan con ~½ segundo de demora.
var live = { ch: null, timer: null };
function liveOff() {
  clearTimeout(live.timer);
  if (live.ch) { sb.removeChannel(live.ch); live.ch = null; }
}
function liveOn(tab, table, fn) {
  liveOff();
  live.ch = sb.channel("rt-live-" + table)
    .on("postgres_changes", { event: "*", schema: "public", table: table }, function () {
      if (S.tab !== tab) return;
      clearTimeout(live.timer);
      live.timer = setTimeout(fn, 400);
    }).subscribe();
}
// Deja la pestaña sin refresco de tabla (Borradores, Notas, Calendario, Formulario no usan la grilla).
function leaveGrid() { unsubscribe(); liveOff(); S.data = null; }

var draftRows = [];   // lo que se está mostrando
var draftSel = null;  // id del borrador abierto
var draftSaving = 0;  // guardados en curso
var draftSyncTimer = null;

function openBorradores() {
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

  var res = await sb
    .from("borradores")
    .select("*")
    .order("updated_at", { ascending: false });

  if (S.tab !== "borradores") return;

  if (res.error) {
    return status("Error: " + errMsg(res.error), true);
  }

  renderBorradores(res.data);
  liveOn("borradores", "borradores", refrescarBorradores);
  status("");
}

// Lo que escribís vos tiene prioridad: si hay algo sin guardar se espera y se reintenta.
async function refrescarBorradores() {
  if (S.tab !== "borradores" || !$("draft-list")) return;
  clearTimeout(draftSyncTimer);
  if (pendingDraft || draftSaving > 0) { draftSyncTimer = setTimeout(refrescarBorradores, 1500); return; }

  var res = await sb.from("borradores").select("*").order("updated_at", { ascending: false });
  if (res.error || S.tab !== "borradores" || !$("draft-list")) return;
  if (pendingDraft || draftSaving > 0) { draftSyncTimer = setTimeout(refrescarBorradores, 1500); return; }

  var rows = res.data;
  var cur = draftRows.find(function (x) { return x.id === draftSel; });
  var i = rows.findIndex(function (x) { return x.id === draftSel; });
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
    if (vis.length) renderBorradorEditor(draftRows, vis[0].id); else renderEmptyDraft();
    status("Ese borrador lo eliminó otra persona.", true);
  } else if (!cur) {
    var v2 = borradoresVisibles();
    if (v2.length) renderBorradorEditor(draftRows, v2[0].id);
  }
}

function mismoBorrador(a, b) {
  return ["destinatario", "cc", "asunto", "cuerpo", "estado"].every(function (k) { return (a[k] || "") === (b[k] || ""); });
}

// Pone en pantalla los datos de r sin mover el cursor del campo que esté activo.
function pintarCamposBorrador(r) {
  [["draft-to", r.destinatario], ["draft-cc", r.cc], ["draft-subject", r.asunto], ["draft-body", r.cuerpo]].forEach(function (p) {
    var input = $(p[0]), v = p[1] || "";
    if (!input || input.value === v) return;
    var a = document.activeElement === input, s = input.selectionStart, e = input.selectionEnd;
    input.value = v;
    if (a) { try { input.setSelectionRange(Math.min(s, v.length), Math.min(e, v.length)); } catch (x) { /* ignorar */ } }
  });
  if ($("draft-state")) $("draft-state").value = draftState(r);
  actualizarBotonPlantilla(r);
  if ($("draft-info")) $("draft-info").textContent = r.updated_by ? "Última modificación: " + r.updated_by : "";
}

function borradoresVisibles() {
  return draftRows.filter(function (r) { return !draftFilter || draftState(r) === draftFilter; });
}

function pintarListaBorradores() {
  var list = $("draft-list");
  if (!list) return;
  list.replaceChildren.apply(list, borradoresVisibles().map(function (r) {
    return el(
      "button",
      {
        class: "draft-item" + (r.id === draftSel ? " on" : ""),
        "data-id": r.id,
        onclick: function () { switchBorrador(r.id); }
      },
      el("div", { class: "draft-row" },
        el("strong", {}, r.asunto || "(Sin asunto)"),
        el("small", { class: "st-badge st-" + draftState(r) }, draftState(r))
      ),
      el("span", {}, r.destinatario || "")
    );
  }));
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
          }
        },
        el("option", { value: "" }, "Todos los estados"),
        DRAFT_STATES.map(function (s) {
          var o = el("option", { value: s }, s);
          if (s === draftFilter) o.selected = true;
          return o;
        })
      ),

      el("div", { class: "draft-list", id: "draft-list" })
    ),

    el("section", { id: "draft-editor", class: "draft-editor" })
  );

  $("grid").replaceChildren(layout);

  var visible = borradoresVisibles();
  var selected = visible.find(function (r) { return r.id === draftSel; }) || visible[0] || null;
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

      el("button", { id: "draft-use-tpl", title: "Crea un borrador nuevo con este texto; la plantilla queda como está", onclick: function () { usarPlantilla(r); } }, "Usar plantilla"),

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
  actualizarBotonPlantilla(r);

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

  draftSaving++;
  var res;
  try {
    res = await sb
      .from("borradores")
      .update(patch)
      .eq("id", r.id)
      .select("updated_at, updated_by")
      .single();
  } finally {
    draftSaving--;
  }

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
    return status(
      "No se pudo eliminar: " + errMsg(res.error),
      true
    );
  }

  draftSel = null;
  await loadBorradores();
}

// ---------- Estado del borrador: Revisar / Enviado ----------
// "Plantilla" = mail precargado que se usa seguido. No se marca como enviado; con "Usar plantilla" se crea una copia para completar y mandar.
var DRAFT_STATES = ["Revisar", "Enviado", "Plantilla"];
var draftFilter = ""; // "" (todos) o uno de DRAFT_STATES

// Los borradores viejos (estado vacío o "Borrador") se muestran como "Revisar".
function draftState(r) {
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
  setTimeout(function () { if ($("status") && /Copia creada/.test($("status").textContent)) status(""); }, 3000);
  if ($("draft-to")) $("draft-to").focus();
}

async function setBorradorEstado(r, value) {
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

// ---------- Calendario ----------
// Tabla "eventos" en Supabase (ver supabase/eventos.sql). Un evento = título + fecha + hora opcional + descripción.
var MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
var DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
var DIAS_LARGOS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
var cal = { y: 0, m: 0, start: null, weeks: 5, events: [], upcoming: [], channel: null, timer: null, tok: 0 };

function pad2(n) { return String(n).padStart(2, "0"); }
function isoDate(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); } // fecha local (no UTC)
function parseISO(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
function horaCorta(h) { return h ? String(h).slice(0, 5) : ""; }
function cmpEvento(a, b) {
  var ha = horaCorta(a.hora), hb = horaCorta(b.hora);
  return ha < hb ? -1 : ha > hb ? 1 : a.id - b.id; // primero los que no tienen hora
}
function textoEvento(e) { return (e.hora ? horaCorta(e.hora) + " " : "") + (e.titulo || "(Sin título)"); }

function openCalendario() {
  S.tab = "calendario";
  document.querySelectorAll(".tab").forEach(function (b) {
    b.classList.toggle("on", b.getAttribute("data-n") === "calendario");
  });
  leaveGrid(); // en esta pestaña no hay tabla de la planilla: se frena el refresco automático

  var hoy = new Date();
  cal.y = hoy.getFullYear();
  cal.m = hoy.getMonth();

  $("tools").replaceChildren();
  $("grid").replaceChildren(
    el("div", { class: "cal-layout" },
      el("section", { class: "cal-main", id: "cal-main" }),
      el("aside", { class: "cal-side", id: "cal-side" })
    )
  );

  loadCalendario();
  subscribeCalendario();
}

async function loadCalendario(quiet) {
  var tok = ++cal.tok;
  if (!quiet) status("Cargando…");

  var first = new Date(cal.y, cal.m, 1);
  var offset = (first.getDay() + 6) % 7; // la semana empieza el lunes
  var weeks = Math.ceil((offset + new Date(cal.y, cal.m + 1, 0).getDate()) / 7);
  var start = new Date(cal.y, cal.m, 1 - offset);
  var end = new Date(cal.y, cal.m, 1 - offset + weeks * 7 - 1);

  var res = await sb.from("eventos").select("*")
    .gte("fecha", isoDate(start)).lte("fecha", isoDate(end))
    .order("fecha", { ascending: true });
  var up = await sb.from("eventos").select("*")
    .gte("fecha", today())
    .order("fecha", { ascending: true }).limit(10);

  if (tok !== cal.tok || S.tab !== "calendario") return; // llegó una respuesta vieja o ya cambiaste de solapa

  if (res.error || up.error) {
    var er = res.error || up.error;
    status("");
    var falta = er.code === "42P01" || /eventos/.test(errMsg(er)) && /exist|relation|schema cache/i.test(errMsg(er));
    $("cal-main").replaceChildren(el("p", { class: "note" },
      falta
        ? "Falta crear la tabla «eventos» en Supabase. Corré el archivo supabase/eventos.sql en el editor SQL de Supabase y recargá esta página."
        : "No se pudieron cargar los eventos: " + errMsg(er)));
    $("cal-side").replaceChildren();
    return;
  }

  cal.start = start;
  cal.weeks = weeks;
  cal.events = res.data;
  cal.upcoming = up.data.slice().sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : cmpEvento(a, b); });
  renderCalendario();
  if (!quiet) status("");
}

function moverMes(delta) {
  var d = new Date(cal.y, cal.m + delta, 1);
  cal.y = d.getFullYear();
  cal.m = d.getMonth();
  loadCalendario();
}

function irAHoy() {
  var d = new Date();
  cal.y = d.getFullYear();
  cal.m = d.getMonth();
  loadCalendario();
}

function renderCalendario() {
  var main = $("cal-main"), side = $("cal-side");
  if (!main || !side) return;

  var tod = today();
  var byDay = {};
  cal.events.forEach(function (e) { (byDay[e.fecha] = byDay[e.fecha] || []).push(e); });
  Object.keys(byDay).forEach(function (k) { byDay[k].sort(cmpEvento); });

  var viendoHoy = tod.slice(0, 7) === cal.y + "-" + pad2(cal.m + 1);
  var fechaNueva = viendoHoy ? tod : cal.y + "-" + pad2(cal.m + 1) + "-01";

  var head = el("div", { class: "cal-head" },
    el("button", { class: "ghost", title: "Mes anterior", onclick: function () { moverMes(-1); } }, "‹"),
    el("h2", {}, MESES[cal.m] + " " + cal.y),
    el("button", { class: "ghost", title: "Mes siguiente", onclick: function () { moverMes(1); } }, "›"),
    el("button", { class: "ghost", onclick: irAHoy }, "Hoy"),
    el("button", { class: "cal-new", onclick: function () { editarEvento(null, fechaNueva); } }, "+ Nuevo evento")
  );

  var grid = el("div", { class: "cal-grid" });
  DIAS.forEach(function (d) { grid.append(el("div", { class: "cal-dow" }, d)); });

  function celda(d) {
    var iso = isoDate(d), list = byDay[iso] || [];
    var cell = el("div", {
      class: "cal-cell" + (d.getMonth() !== cal.m ? " out" : "") + (iso === tod ? " today" : ""),
      "data-fecha": iso,
      onclick: function () { editarEvento(null, iso); }
    }, el("div", { class: "cal-num" }, String(d.getDate())));

    list.slice(0, 3).forEach(function (e) {
      cell.append(el("button", {
        class: "cal-ev", title: textoEvento(e) + (e.descripcion ? "\n" + e.descripcion : ""),
        onclick: function (ev) { ev.stopPropagation(); editarEvento(e); }
      }, textoEvento(e)));
    });
    if (list.length > 3) {
      cell.append(el("button", {
        class: "cal-more",
        onclick: function (ev) { ev.stopPropagation(); verDia(iso); }
      }, "+" + (list.length - 3) + " más"));
    }
    return cell;
  }

  for (var i = 0; i < cal.weeks * 7; i++) {
    grid.append(celda(new Date(cal.start.getFullYear(), cal.start.getMonth(), cal.start.getDate() + i)));
  }

  main.replaceChildren(head, grid);

  // Próximos eventos
  side.replaceChildren(
    el("h3", {}, "Próximos eventos"),
    cal.upcoming.length
      ? el("div", { class: "cal-up" }, cal.upcoming.map(function (e) {
          var d = parseISO(e.fecha);
          return el("button", { class: "cal-up-item", onclick: function () { editarEvento(e); } },
            el("small", {}, DIAS[(d.getDay() + 6) % 7] + " " + pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + (e.hora ? " · " + horaCorta(e.hora) : "")),
            el("strong", {}, e.titulo || "(Sin título)"));
        }))
      : el("p", { class: "note" }, "No hay eventos próximos.")
  );
}

function abrirModal(children, extra) {
  cerrarModal();
  var ov = el("div", { class: "modal-ov", id: "cal-modal", onclick: function (ev) { if (ev.target === ov) cerrarModal(); } },
    el("div", { class: "modal" + (extra ? " " + extra : "") }, children));
  document.body.append(ov);
}
function cerrarModal() { var m = $("cal-modal"); if (m) m.remove(); }
document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") cerrarModal(); });

function verDia(iso) {
  var d = parseISO(iso);
  var list = cal.events.filter(function (e) { return e.fecha === iso; }).sort(cmpEvento);
  abrirModal([
    el("h3", {}, DIAS_LARGOS[(d.getDay() + 6) % 7] + " " + d.getDate() + " de " + MESES[d.getMonth()].toLowerCase()),
    el("div", { class: "cal-up" }, list.map(function (e) {
      return el("button", { class: "cal-up-item", onclick: function () { editarEvento(e); } }, el("strong", {}, textoEvento(e)));
    })),
    el("div", { class: "modal-actions" },
      el("button", { class: "ghost", onclick: cerrarModal }, "Cerrar"),
      el("button", { class: "cal-new", onclick: function () { editarEvento(null, iso); } }, "+ Nuevo evento este día"))
  ]);
}

function editarEvento(e, fecha) {
  var esNuevo = !e;

  var inT = el("input", { id: "ev-titulo", type: "text", placeholder: "Título del evento", maxlength: "200" });
  var inF = el("input", { id: "ev-fecha", type: "date" });
  var inH = el("input", { id: "ev-hora", type: "time" });
  var inD = el("textarea", { id: "ev-desc", rows: "4", placeholder: "Detalles (opcional)" });
  inT.value = e ? e.titulo || "" : "";
  inF.value = e ? e.fecha : fecha;
  inH.value = e ? horaCorta(e.hora) : "";
  inD.value = e ? e.descripcion || "" : "";

  var err = el("p", { class: "err", id: "ev-err" });
  var btnG = el("button", { onclick: guardar }, "Guardar");

  async function guardar() {
    var titulo = inT.value.trim();
    if (!titulo) { err.textContent = "Falta el título."; inT.focus(); return; }
    if (!inF.value) { err.textContent = "Falta la fecha."; return; }

    var row = { titulo: titulo, fecha: inF.value, hora: inH.value || null, descripcion: inD.value.trim() || null };
    btnG.disabled = true;
    err.textContent = "";

    var res = esNuevo
      ? await sb.from("eventos").insert(row)
      : await sb.from("eventos").update(row).eq("id", e.id);

    if (res.error) {
      btnG.disabled = false;
      err.textContent = "No se pudo guardar: " + errMsg(res.error);
      return;
    }

    cerrarModal();
    var d = parseISO(row.fecha);
    cal.y = d.getFullYear(); // si el evento cae en otro mes, se va a ese mes para verlo
    cal.m = d.getMonth();
    loadCalendario();
  }

  async function borrar() {
    if (!confirm("¿Eliminar este evento? Va a la Papelera y se puede restaurar desde ahí.")) return;
    var res = await borrarFila("eventos", e.id);
    if (res.error) { err.textContent = "No se pudo eliminar: " + errMsg(res.error); return; }
    cerrarModal();
    loadCalendario();
  }

  [inT, inF, inH].forEach(function (i) {
    i.addEventListener("keydown", function (ev) { if (ev.key === "Enter") guardar(); });
  });

  abrirModal([
    el("h3", {}, esNuevo ? "Nuevo evento" : "Editar evento"),
    el("label", {}, "Título"), inT,
    el("label", {}, "Fecha"), inF,
    el("label", {}, "Hora (opcional)"), inH,
    el("label", {}, "Descripción"), inD,
    err,
    el("div", { class: "modal-actions" },
      !esNuevo && e.updated_by ? el("span", { class: "draft-info" }, "Última modificación: " + e.updated_by) : el("span", { class: "spacer" }),
      !esNuevo ? el("button", { class: "ghost", onclick: borrar }, "Eliminar") : null,
      el("button", { class: "ghost", onclick: cerrarModal }, "Cancelar"),
      btnG)
  ]);

  inT.focus();
}

// Cambios que hace la otra persona: se recarga el mes (sin tocar un evento que se esté editando).
function subscribeCalendario() {
  if (cal.channel) { sb.removeChannel(cal.channel); cal.channel = null; }
  cal.channel = sb.channel("rt-eventos")
    .on("postgres_changes", { event: "*", schema: "public", table: "eventos" }, function () {
      if (S.tab !== "calendario") { sb.removeChannel(cal.channel); cal.channel = null; return; }
      clearTimeout(cal.timer);
      cal.timer = setTimeout(function () { loadCalendario(true); }, 400);
    }).subscribe();
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
  if (draftState(r) !== "Revisar") return; // una plantilla no se marca como enviada

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
var notaRows = [];
var notaSel = null;
var notaSaving = 0;
var pendingNota = null; // { r, titulo, contenido }: lo último escrito que todavía no se guardó
var notaSyncTimer = null;

async function openNotas() {
  S.tab = "notas";

  document.querySelectorAll(".tab").forEach(function (b) {
    b.classList.toggle("on", b.dataset.n === "notas");
  });

  leaveGrid();
  notaSel = null;

  // Acceso directo a la carpeta de proyectos en la nube de Exactas
  $("tools").replaceChildren(
    el("a", {
      class: "btn",
      href: NUBE_URL,
      target: "_blank",
      rel: "noopener noreferrer",
      title: "Abre la carpeta de proyectos en la nube de Exactas (en una pestaña nueva)"
    }, "📁 Abrir carpeta de proyectos")
  );
  $("grid").replaceChildren();

  return loadNotas();
}

async function loadNotas() {
  status("Cargando notas...");

  var res = await sb
    .from("notas")
    .select("*")
    .order("updated_at", { ascending: false });

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
async function refrescarNotas() {
  if (S.tab !== "notas" || !$("nota-list")) return;
  clearTimeout(notaSyncTimer);
  if (pendingNota || notaSaving > 0) { notaSyncTimer = setTimeout(refrescarNotas, 1500); return; }

  var res = await sb.from("notas").select("*").order("updated_at", { ascending: false });
  if (res.error || S.tab !== "notas" || !$("nota-list")) return;
  if (pendingNota || notaSaving > 0) { notaSyncTimer = setTimeout(refrescarNotas, 1500); return; }

  var rows = res.data || [];
  var cur = notaRows.find(function (x) { return x.id === notaSel; });
  var i = rows.findIndex(function (x) { return x.id === notaSel; });
  var perdida = false;

  if (cur && i >= 0) {
    var nueva = rows[i];
    if (((cur.titulo || "") !== (nueva.titulo || "") || (cur.contenido || "") !== (nueva.contenido || "")) &&
        new Date(nueva.updated_at) > new Date(cur.updated_at)) {
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
    if (rows.length) renderNotaEditor(notaRows, rows[0].id); else renderNotasVacio();
    if (perdida) status("Esa nota la eliminó otra persona.", true);
  }
}

function pintarCamposNota(r) {
  [["note-title", r.titulo], ["note-body", r.contenido]].forEach(function (p) {
    var input = $(p[0]), v = p[1] || "";
    if (!input || input.value === v) return;
    var a = document.activeElement === input, s = input.selectionStart, e = input.selectionEnd;
    input.value = v;
    if (a) { try { input.setSelectionRange(Math.min(s, v.length), Math.min(e, v.length)); } catch (x) { /* ignorar */ } }
  });
  if ($("note-body")) grow($("note-body"));
}

function pintarListaNotas() {
  var list = $("nota-list");
  if (!list) return;
  list.replaceChildren.apply(list, notaRows.map(function (r) {
    return el("button", {
      class: "draft-item" + (r.id === notaSel ? " on" : ""),
      "data-id": r.id,
      onclick: function () { cambiarNota(r.id); }
    },
      el("strong", {}, r.titulo || "(Sin título)"),
      el("span", {}, r.updated_at ? new Date(r.updated_at).toLocaleString("es-AR") : "")
    );
  }));
}

async function cambiarNota(id) {
  await flushNotaSave();
  renderNotaEditor(notaRows, id);
}

function renderNotasVacio() {
  var editor = $("nota-editor");
  if (!editor) return;
  editor.replaceChildren(
    el("div", { class: "draft-empty" },
      "No hay notas todavía.",
      el("button", { onclick: function () { nuevaNota(); } }, "Crear primera nota")
    )
  );
}

function renderNotas(rows) {
  notaRows = rows;

  var layout = el("div", { class: "draft-layout" });

  var sidebar = el("aside", { class: "draft-sidebar" });

  sidebar.append(
    el("div", { class: "draft-sidebar-head" },
      el("strong", {}, "Notas / Proyectos"),
      el("button", { onclick: function () { nuevaNota(); } }, "+ Nueva")
    )
  );

  sidebar.append(el("div", { class: "draft-list", id: "nota-list" }));

  var editor = el("section", {
    class: "draft-editor",
    id: "nota-editor"
  });

  layout.append(sidebar, editor);

  $("grid").replaceChildren(layout);

  var selected = rows.find(function (r) { return r.id === notaSel; }) || rows[0] || null;
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
      contenido: ""
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
    if (!confirm("¿Borrar esta fila? Va a la Papelera y se puede restaurar desde ahí.")) return;
    var res = await borrarFila(S.tab, r.id);
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

  // ---------- Papelera ----------
  // Todo lo que se borra se copia antes en la tabla "papelera" (ver supabase/papelera.sql) y se puede restaurar desde el botón Papelera.
  var NOMBRES_EXTRA = { borradores: "Borradores", notas: "Notas", eventos: "Calendario" };
  function nombreTabla(t) { return (TABLES[t] && TABLES[t].label) || NOMBRES_EXTRA[t] || t; }
  function tablaFaltante(e, nombre) {
    var m = errMsg(e);
    return !!e && (e.code === "42P01" || (m.indexOf(nombre) >= 0 && /exist|relation|schema cache/i.test(m)));
  }

  async function borrarFila(tabla, id) {
    var g = await sb.from(tabla).select("*").eq("id", id).maybeSingle();
    if (g.error) return { error: g.error };
    if (g.data) {
      var p = await sb.from("papelera").insert({ tabla: tabla, datos: g.data });
      if (p.error && !confirm("No se pudo guardar una copia en la Papelera (" + errMsg(p.error) + ").\n\n¿Borrar igual? No se va a poder deshacer.")) {
        return { error: { message: "se canceló el borrado." } };
      }
    }
    return await sb.from(tabla).delete().eq("id", id);
  }

  function resumenPapelera(d) {
    var claves = ["titulo", "asunto", "expediente", "nombre", "dpto", "cuenta", "observaciones", "observacion", "destinatario"], txt = "";
    for (var i = 0; i < claves.length && !txt; i++) if (d[claves[i]]) txt = String(d[claves[i]]);
    if (txt.length > 90) txt = txt.slice(0, 90) + "…";
    return (d.fecha ? fmtDate(d.fecha) + " · " : "") + (txt || "(vacío)");
  }

  async function abrirPapelera() {
    var res = await sb.from("papelera").select("*").order("deleted_at", { ascending: false }).limit(100);
    var cuerpo;
    if (res.error) {
      cuerpo = el("p", { class: "note" }, tablaFaltante(res.error, "papelera")
        ? "Falta crear la tabla «papelera» en Supabase. Corré el archivo supabase/papelera.sql en el editor SQL de Supabase y recargá esta página."
        : "No se pudo abrir la papelera: " + errMsg(res.error));
    } else if (!res.data.length) {
      cuerpo = el("p", { class: "note" }, "La papelera está vacía.");
    } else {
      cuerpo = el("div", { class: "trash-list" }, res.data.map(itemPapelera));
    }
    abrirModal([
      el("h3", {}, "Papelera"),
      el("p", { class: "note" }, "Lo que se borra queda acá (se muestran los últimos 100)."),
      cuerpo,
      el("div", { class: "modal-actions" }, el("button", { class: "ghost", onclick: cerrarModal }, "Cerrar"))
    ], "wide");
  }

  function itemPapelera(p) {
    var btn = el("button", { onclick: function () { restaurarDePapelera(p, fila, btn); } }, "Restaurar");
    var fila = el("div", { class: "trash-item" },
      el("div", { class: "trash-txt" },
        el("strong", {}, nombreTabla(p.tabla)),
        el("span", {}, resumenPapelera(p.datos || {})),
        el("small", {}, "Borrado" + (p.deleted_by ? " por " + p.deleted_by : "") + (p.deleted_at ? " · " + new Date(p.deleted_at).toLocaleString("es-AR") : ""))),
      btn);
    return fila;
  }

  async function restaurarDePapelera(p, fila, btn) {
    btn.disabled = true;
    var d = Object.assign({}, p.datos);
    delete d.id; delete d.updated_at; delete d.updated_by; // se vuelve a crear con id nuevo
    var r = await sb.from(p.tabla).insert(d);
    if (r.error) {
      btn.disabled = false;
      fila.append(el("p", { class: "err" }, "No se pudo restaurar: " + errMsg(r.error)));
      return;
    }
    var q = await sb.from("papelera").delete().eq("id", p.id);
    fila.replaceChildren(el("span", {}, "✓ Restaurado en " + nombreTabla(p.tabla) + (q.error ? " (no se pudo sacar de la papelera)" : "")));
    recargarPestana();
  }

  // Si estás mirando la pestaña a la que se restauró algo, se actualiza.
  function recargarPestana() {
    if (S.tab === "borradores") refrescarBorradores();
    else if (S.tab === "notas") refrescarNotas();
    else if (S.tab === "calendario") loadCalendario(true);
    else if (S.data) refresh();
  }

  // ---------- Copia de seguridad ----------
  // Descarga un archivo .json con TODAS las tablas. Para volver a cargarlo: scripts/restaurar_copia.py (genera el SQL).
  var CLAVE_COPIA = "seguimiento_ultima_copia";

  async function leerTodo(tabla) {
    var out = [], desde = 0;
    for (;;) { // Supabase devuelve como máximo 1000 filas por consulta: se pide por tandas
      var r = await sb.from(tabla).select("*").order("id", { ascending: true }).range(desde, desde + 999);
      if (r.error) throw r.error;
      out = out.concat(r.data);
      if (r.data.length < 1000) break;
      desde += 1000;
    }
    return out;
  }

  async function copiaSeguridad() {
    status("Preparando la copia…");
    var nombres = Object.keys(TABLES).concat(["borradores", "notas", "eventos"]);
    var tablas = {}, faltan = [], filas = 0;
    try {
      for (var n of nombres) {
        try { tablas[n] = await leerTodo(n); filas += tablas[n].length; }
        catch (e) { if (tablaFaltante(e, n)) faltan.push(n); else throw e; }
      }
    } catch (e) { return status("No se pudo hacer la copia: " + errMsg(e), true); }

    descargarArchivo("copia-seguridad-" + today() + ".json",
      JSON.stringify({ app: "seguimiento", version: 1, creado: new Date().toISOString(), por: S.user.email, tablas: tablas }, null, 1),
      "application/json");
    try { localStorage.setItem(CLAVE_COPIA, new Date().toISOString()); } catch (e) { /* sin almacenamiento: solo no se recuerda la fecha */ }
    actualizarAvisoCopia();
    status("Copia descargada ✓ (" + filas + " filas)" + (faltan.length ? ". No se incluyó: " + faltan.join(", ") + " (tabla sin crear)" : ""));
  }

  function diasDesdeCopia() {
    var t = null;
    try { t = localStorage.getItem(CLAVE_COPIA); } catch (e) { t = null; }
    var d = t ? Math.floor((Date.now() - new Date(t).getTime()) / 86400000) : NaN;
    return isNaN(d) ? null : Math.max(0, d);
  }

  // Muestra en la barra cuándo fue la última copia hecha desde este equipo; se pone en rojo si pasó una semana.
  function actualizarAvisoCopia() {
    var s = $("bk-info");
    if (!s) return;
    var d = diasDesdeCopia();
    s.textContent = d == null ? "Sin copias en este equipo" : d === 0 ? "Última copia: hoy" : "Última copia: hace " + d + (d === 1 ? " día" : " días");
    s.className = "bk-info" + (d == null || d >= 7 ? " warn" : "");
    s.title = "La fecha se guarda en este navegador: cada persona ve la de su propio equipo.";
  }

  function avisoCopiaInicial() {
    var d = diasDesdeCopia();
    if (d != null && d < 7) return;
    var msg = "Hace más de una semana que no hacés una copia de seguridad (botón de arriba).";
    status(msg);
    setTimeout(function () { if ($("status") && $("status").textContent === msg) status(""); }, 8000);
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
