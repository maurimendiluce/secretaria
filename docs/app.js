// Punto de entrada: inicio de sesión, barra de pestañas y arranque.

import { openBorradores } from "./js/borradores.js";
import { openCalendario } from "./js/calendario.js";
import { actualizarAvisoCopia, avisoCopiaInicial, copiaSeguridad } from "./js/copia.js";
import { $, S, el, root, sb } from "./js/core.js";
import { ocultarForm, openForm } from "./js/formulario.js";
import { openLinks } from "./js/links.js";
import { liveOff, unsubscribe } from "./js/live.js";
import { openNotas } from "./js/notas.js";
import { abrirPapelera } from "./js/papelera.js";
import { open } from "./js/planilla.js";
import { TABLES } from "./js/tablas.js";

// ---------- Login ----------
function showLogin(msg) {
  unsubscribe();
  liveOff();
  S.data = null;
  root.replaceChildren(
    el(
      "form",
      { class: "login", onsubmit: onLogin },
      el("img", { class: "logo-login", src: "logo.png", alt: "Secretaría de Concursos" }),
      //el("h1", {}, "Secretaría de Concursos"),
      el(
        "label",
        {},
        "Email",
        el("input", { type: "email", name: "email", required: "", autocomplete: "username" }),
      ),
      el(
        "label",
        {},
        "Contraseña",
        el("input", { type: "password", name: "password", required: "", autocomplete: "current-password" }),
      ),
      el("button", { type: "submit" }, "Ingresar"),
      el("p", { class: "err", id: "login-err" }, msg || ""),
    ),
  );
}

async function onLogin(ev) {
  ev.preventDefault();
  var f = ev.target;
  var err = $("login-err");
  var btn = f.querySelector("button[type=submit], button:not([type])");
  err.textContent = "";
  if (btn) { btn.disabled = true; btn.dataset.txt = btn.textContent; btn.textContent = "Entrando…"; }
  try {
    var r = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    if (r.error) {
      var e = r.error, msg = String(e.message || "");
      if (e.code === "invalid_credentials" || /invalid login credentials/i.test(msg)) {
        err.textContent = "Email o contraseña incorrectos.";
      } else if (e.name === "AuthRetryableFetchError" || e.status === 0 || /fetch|network|timeout/i.test(msg)) {
        err.textContent = "No se pudo conectar con el servidor. Revisá tu conexión o probá desde otra red.";
      } else {
        err.textContent = "No se pudo iniciar sesión: " + msg;
      }
    }
  } catch (x) {
    err.textContent = "No se pudo conectar con el servidor. Revisá tu conexión o probá desde otra red.";
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.txt || "Entrar"; }
  }
}

// ---------- Estructura ----------
function showApp() {
  root.replaceChildren(
    el(
      "header",
      { class: "bar" },
      el("img", { class: "logo-bar", src: "logo.png", alt: "Secretaría de Concursos", title: "Secretaría de Concursos" }),
      el("nav", { id: "tabs" }),
      el("span", { class: "bk-info", id: "bk-info" }),
      el(
        "button",
        { class: "ghost", title: "Descarga todos los datos en un archivo", onclick: copiaSeguridad },
        "Copia de seguridad",
      ),
      el(
        "button",
        { class: "ghost", title: "Lo que se borró, para restaurarlo", onclick: abrirPapelera },
        "Papelera",
      ),
      el("span", { class: "who" }, S.user.email),
      el(
        "button",
        {
          class: "ghost",
          onclick: function () {
            sb.auth.signOut();
          },
        },
        "Salir",
      ),
    ),
    el("section", { id: "tools" }),
    el("div", { id: "grid", class: "gridwrap" }),
    el("div", { id: "form-pane", hidden: "" }),
    el("div", { id: "status", class: "status" }),
  );
  $("tabs").replaceChildren.apply(
    $("tabs"),
    Object.keys(TABLES)
      .map(function (n) {
        return el(
          "button",
          {
            class: "tab",
            "data-n": n,
            onclick: function () {
              ocultarForm();
              if (n === "links") openLinks();
              else open(n);
            },
          },
          TABLES[n].label,
        );
      })
      .concat([
        el(
          "button",
          {
            class: "tab",
            "data-n": "formulario",
            onclick: function () {
              openForm();
            },
          },
          "Formulario",
        ),
        el(
          "button",
          {
            class: "tab",
            "data-n": "borradores",
            onclick: function () {
              ocultarForm();
              openBorradores();
            },
          },
          "Borradores",
        ),
        el(
          "button",
          {
            class: "tab",
            "data-n": "notas",
            onclick: function () {
              ocultarForm();
              openNotas();
            },
          },
          "Notas / Proyectos",
        ),
        el(
          "button",
          {
            class: "tab",
            "data-n": "calendario",
            onclick: function () {
              ocultarForm();
              openCalendario();
            },
          },
          "Calendario",
        ),
      ]),
  );
  actualizarAvisoCopia();
  var pr = S.tab === "links" ? openLinks() : open(S.tab);
  pr.then(avisoCopiaInicial);
  return pr;
}

// ---------- Sesión ----------
var current;
// undefined hasta el primer evento
sb.auth.onAuthStateChange(function (event, session) {
  var uid = session ? session.user.id : null;
  if (uid === current && event !== "SIGNED_OUT") return; // ignorar refrescos de token
  current = uid;
  if (session) {
    S.user = session.user;
    showApp();
  } else {
    S.user = null;
    showLogin();
  }
});
