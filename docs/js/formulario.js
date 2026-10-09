// Solapa Formulario (Google Forms incrustado).

import { $, S, el, status } from "./core.js";
import { leaveGrid } from "./live.js";
import { FORM_URL } from "./tablas.js";

export function openForm() {
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
      marginwidth: "0",
    }),
  );

  status("");
}
