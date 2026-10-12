// Solapa Formulario (Google Forms incrustado).
// El formulario vive en su propio panel (#form-pane), fuera de la grilla: al cambiar de solapa
// solo se oculta, no se destruye, así lo que estabas completando no se pierde.

import { $, S, el, status } from "./core.js";
import { leaveGrid } from "./live.js";
import { FORM_URL } from "./tablas.js";

// Se llama al ir a cualquier otra solapa.
export function ocultarForm() {
  var p = $("form-pane");
  if (p) p.hidden = true;
}

export function openForm() {
  S.tab = "formulario";
  leaveGrid();

  document.querySelectorAll(".tab").forEach(function (b) {
    b.classList.toggle("on", b.getAttribute("data-n") === "formulario");
  });

  $("tools").replaceChildren();
  $("grid").replaceChildren();

  var pane = $("form-pane");
  if (!pane) return;
  if (!pane.firstChild) {
    // Se crea una sola vez; recién ahí se carga el formulario.
    pane.append(
      el("iframe", {
        src: FORM_URL,
        width: "100%",
        height: "800",
        frameborder: "0",
        marginheight: "0",
        marginwidth: "0",
      }),
    );
  }
  pane.hidden = false;

  status("");
}