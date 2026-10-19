// Markdown + LaTeX para Notas / Proyectos. Usa marked, DOMPurify y KaTeX (se cargan en index.html).
// Las fórmulas se sacan ANTES de pasar por markdown (para que _ * \\ no se interpreten),
// se dejan marcadores y se vuelven a insertar ya renderizadas, después de limpiar el HTML.

import { el } from "./core.js";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function extraerMath(md) {
  var maths = [];
  function guardar(raw, tex, display) {
    maths.push({ raw: raw, tex: tex, display: display });
    return "zzmathzz" + (maths.length - 1) + "zz";
  }
  // no tocar bloques de código ni código en línea
  var partes = md.split(/(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]+`)/g);
  var salida = partes.map(function (seg, i) {
    if (i % 2) return seg;
    return seg
      .replace(/\$\$([\s\S]+?)\$\$/g, function (m, t) {
        return guardar(m, t.trim(), true);
      })
      .replace(/\\\[([\s\S]+?)\\\]/g, function (m, t) {
        return guardar(m, t.trim(), true);
      })
      .replace(/\\\(([\s\S]+?)\\\)/g, function (m, t) {
        return guardar(m, t.trim(), false);
      })
      .replace(/\\begin\{(equation|align|gather|multline)(\*?)\}[\s\S]+?\\end\{\1\2\}/g, function (m) {
        return guardar(m, m, true);
      })
      // $...$ en línea: sin espacios pegados a los $, y el cierre no seguido de un dígito ("$5 y $10" no es fórmula)
      .replace(/(?<![\\$])\$(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$(?!\d)/g, function (m, t) {
        return guardar(m, t, false);
      });
  });
  return { text: salida.join(""), maths: maths };
}

// Dibuja el markdown `md` dentro del elemento `destino`.
export function renderMd(md, destino) {
  if (!window.marked || !window.DOMPurify) {
    // si no cargaron las librerías, se muestra el texto tal cual
    destino.replaceChildren(el("pre", {}, md || ""));
    return;
  }
  var r = extraerMath(md || "");
  var html = window.DOMPurify.sanitize(window.marked.parse(r.text, { gfm: true, breaks: false }), {
    ADD_ATTR: ["target"],
  });
  html = html.replace(/zzmathzz(\d+)zz/g, function (m, i) {
    var x = r.maths[+i];
    if (!x) return m;
    if (!window.katex) return esc(x.raw);
    try {
      return window.katex.renderToString(x.tex, {
        displayMode: x.display,
        throwOnError: false,
        output: "htmlAndMathml",
      });
    } catch (e) {
      return esc(x.raw);
    }
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
