// Abrir un borrador en Gmail o en el programa de correo, y preguntar si se envió.

import { draftState, flushDraftSave, setBorradorEstado } from "./borradores.js";
import { $, copiarTexto, el, status } from "./core.js";

// ---------- Abrir el borrador en el correo ----------
var MAX_URL_GMAIL = 7000;
// si el link supera esto, se abre sin el texto y el texto se copia al portapapeles
var MAX_URL_MAILTO = 2000;
// los programas de correo aceptan links más cortos

function listaCorreos(s) {
  return (s || "")
    .split(/[;,\s]+/)
    .map(function (x) {
      return x.replace(/^[<"']+|[>"']+$/g, "");
    })
    .filter(Boolean);
}

// Lee lo que hay en pantalla (aunque todavía no se haya guardado) y lo valida. Devuelve null si algo está mal.
function prepararEnvio() {
  var to = listaCorreos($("draft-to").value),
    cc = listaCorreos($("draft-cc").value);
  if (!to.length) {
    status("Falta el destinatario.", true);
    return null;
  }
  var malos = to.concat(cc).filter(function (x) {
    return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x);
  });
  if (malos.length) {
    status("Revisá este correo, no parece válido: " + malos[0], true);
    return null;
  }
  return {
    to: to.join(","),
    cc: cc.join(","),
    subject: $("draft-subject").value,
    body: $("draft-body").value,
  };
}

export async function copiarMensaje() {
  var ok = await copiarTexto($("draft-body").value);
  status(ok ? "Mensaje copiado ✓" : "No se pudo copiar el mensaje.", !ok);
  if (ok)
    setTimeout(function () {
      if ($("status") && $("status").textContent === "Mensaje copiado ✓") status("");
    }, 1500);
}

export async function abrirEnGmail(r) {
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

export async function abrirEnProgramaCorreo(r) {
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
    el(
      "button",
      {
        onclick: function () {
          bar.remove();
          if ($("draft-state")) $("draft-state").value = "Enviado";
          setBorradorEstado(r, "Enviado");
        },
      },
      "Sí, marcar como enviado",
    ),
    el(
      "button",
      {
        class: "ghost",
        onclick: function () {
          bar.remove();
        },
      },
      "Todavía no",
    ),
  );

  $("draft-editor").prepend(bar);
}
