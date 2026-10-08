(function () {
  "use strict";

  var ESTADOS = ["Pendiente", "En proceso", "Terminado"];
  var RESPONSABLES = ["Naty", "Mauri", "Naty / Mauri"];

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
  var S = { tab: "seguimiento", data: null, user: null, channel: null, timer: null, pending: false };
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
        el("h1", {}, "Seguimiento"),
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
        el("h1", {}, "Seguimiento"),
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
    }));
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
  setInterval(function () { if (!document.hidden && S.data) refresh(); }, 60000); // respaldo por si se corta la conexión en vivo

  // ---------- Tabla ----------
  function colIdx(h) { return S.data.cols.findIndex(function (c) { return c.h.toLowerCase() === h; }); }

  function tools() {
    var items = [el("input", { type: "search", id: "q", placeholder: "Buscar…", oninput: filter })];
    (TABLES[S.tab].filters || []).forEach(function (k) {
      var i = S.data.cols.findIndex(function (c) { return c.i === k; });
      if (i >= 0) items.push(el("select", { class: "ff", "data-i": i, onchange: filter }));
    });
    items.push(el("button", { onclick: add }, "+ Nueva fila"));
    items.push(el("button", { class: "ghost", onclick: function () { load(false); } }, "Recargar"));
    items.push(el("button", { class: "ghost", onclick: exportXlsx }, "Exportar a Excel"));
    $("tools").replaceChildren.apply($("tools"), items);
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

  // Completa los desplegables de filtro: las fechas salen de los datos (se actualizan solas), el resto de las opciones de la columna.
  function fillFilters() {
    document.querySelectorAll("#tools select.ff").forEach(function (sel) {
      var i = +sel.getAttribute("data-i"), c = S.data.cols[i], keep = sel.value, opts;
      if (c.type === "date") {
        var seen = {};
        S.data.rows.forEach(function (r) { if (r.v[i]) seen[r.v[i]] = 1; });
        opts = Object.keys(seen).sort().reverse().map(function (v) { return [v, fmtDate(v)]; });
      } else {
        opts = (c.options || []).map(function (o) { return [o, (c.optionLabels && c.optionLabels[o]) || o]; });
      }
      sel.replaceChildren.apply(sel, [el("option", { value: "" }, "Todos: " + c.h.toLowerCase())]
        .concat(opts.map(function (o) { return el("option", { value: o[0] }, o[1]); })));
      sel.value = opts.some(function (o) { return o[0] === keep; }) ? keep : "";
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
    var tr = document.querySelector('#grid tr[data-id="' + res.data.id + '"]');
    var f = tr && tr.querySelector("input,textarea,select"); if (f) f.focus();
  }

  async function del(r) {
    if (!confirm("¿Borrar esta fila? Esto no se puede deshacer.")) return;
    var res = await sb.from(S.tab).delete().eq("id", r.id);
    if (res.error) return status("No se pudo borrar: " + errMsg(res.error), true);
    await load(false);
  }

  function filter() {
    var q = ($("q") && $("q").value || "").toLowerCase();
    var active = [];
    document.querySelectorAll("#tools select.ff").forEach(function (s) { if (s.value) active.push({ i: +s.getAttribute("data-i"), v: s.value }); });
    var byId = {}; S.data.rows.forEach(function (r) { byId[r.id] = r; });
    document.querySelectorAll("#grid tbody tr").forEach(function (tr) {
      var r = byId[tr.getAttribute("data-id")]; if (!r) return;
      var ok = (!q || r.v.join(" ").toLowerCase().indexOf(q) >= 0) && active.every(function (f) { return r.v[f.i] === f.v; });
      tr.style.display = ok ? "" : "none";
    });
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
