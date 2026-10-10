// Piezas básicas que usan todos los módulos: conexión con Supabase, estado, ayudas para armar HTML, mensajes y ventanas.

export function today() {
  var d = new Date(),
    p = function (n) {
      return String(n).padStart(2, "0");
    };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

var cfg = window.SEGUIMIENTO_CONFIG || {};

export var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

export var root = document.getElementById("app");

export var S = {
  tab: "seguimiento",
  data: null,
  user: null,
  channel: null,
  timer: null,
  pending: false,
  sel: {},
};

export var $ = function (id) {
  return document.getElementById(id);
};

export function el(tag, attrs) {
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
    if (Array.isArray(c)) {
      c.forEach(function (x) {
        e.append(x.nodeType ? x : document.createTextNode(String(x)));
      });
      continue;
    }
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

export function status(msg, err) {
  var s = $("status");
  if (!s) return;
  s.textContent = msg || "";
  s.className = "status" + (err ? " err" : "");
}

export function errMsg(e) {
  return e && e.message ? e.message : String(e);
}

export function grow(t) {
  t.style.height = "auto";
  t.style.height = t.scrollHeight + "px";
}

export function byText(r) {
  return r.updated_by ? r.updated_by + " · " + new Date(r.updated_at).toLocaleString("es-AR") : "";
}

export function abrirModal(children, extra) {
  cerrarModal();
  var ov = el(
    "div",
    {
      class: "modal-ov",
      id: "cal-modal",
      onclick: function (ev) {
        if (ev.target === ov) cerrarModal();
      },
    },
    el("div", { class: "modal" + (extra ? " " + extra : "") }, children),
  );
  document.body.append(ov);
}

export function cerrarModal() {
  var m = $("cal-modal");
  if (m) m.remove();
}

document.addEventListener("keydown", function (ev) {
  if (ev.key === "Escape") cerrarModal();
});

export function descargarArchivo(filename, content, mime) {
  var blob = new Blob([content], { type: mime + ";charset=utf-8" });

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

export function fmtDate(v) {
  var m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(v);
  return m ? m[3] + "/" + m[2] + "/" + m[1] : v;
}

// Copia texto al portapapeles (con plan B para navegadores que lo bloquean).
export async function copiarTexto(t) {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch (e) {
    var ta = el("textarea", { style: "position:fixed;opacity:0" });
    ta.value = t;
    document.body.append(ta);
    ta.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e2) {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

// Minúsculas y sin tildes, para que el buscador no distinga "Comisión" de "comision".
export function normalizar(s) {
  return String(s == null ? "" : s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}