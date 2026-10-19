// Markdown para Notas / Proyectos. Usa marked (dibuja) y DOMPurify (limpia el HTML); se cargan en index.html.

import { el } from "./core.js";

// Dibuja el markdown `md` dentro del elemento `destino`.
export function renderMd(md, destino) {
  if (!window.marked || !window.DOMPurify) {
    // si no cargaron las librerías, se muestra el texto tal cual
    destino.replaceChildren(el("pre", {}, md || ""));
    return;
  }
  var html = window.DOMPurify.sanitize(window.marked.parse(md || "", { gfm: true, breaks: false }), {
    ADD_ATTR: ["target"],
  });
  destino.innerHTML = html;

  destino.querySelectorAll("a[href]").forEach(function (a) {
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  });

  // botón "Copiar" en cada bloque de código
  destino.querySelectorAll("pre").forEach(function (pre) {
    var b = el("button", { type: "button", class: "copy-btn" }, "Copiar");
    b.addEventListener("click", async function () {
      var code = pre.querySelector("code");
      try {
        await navigator.clipboard.writeText(code ? code.innerText : pre.innerText);
        b.textContent = "¡Copiado!";
      } catch (e) {
        b.textContent = "No se pudo";
      }
      setTimeout(function () {
        b.textContent = "Copiar";
      }, 1400);
    });
    pre.appendChild(b);
  });
}
