// Columna "Vacaciones" de la solapa Secretaría: períodos elegidos con calendario, guardados como texto
// ("2026-12-10/2026-12-20; 2027-01-05/2027-01-15"). Un texto escrito a mano antes de este cambio se conserva tal cual.

import { el, today } from "./core.js";

var RE = /^(\d{4}-\d\d-\d\d)\s*\/\s*(\d{4}-\d\d-\d\d)$/;

function valida(iso) {
  var m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(iso);
  if (!m) return false;
  var d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
}

// { periodos: [{ d, h }], otros: [texto que no es un período] }
export function parseVac(v) {
  var out = { periodos: [], otros: [] };
  String(v || "")
    .split(/[;\n]+/)
    .forEach(function (t) {
      t = t.trim();
      if (!t) return;
      var m = RE.exec(t);
      if (m && valida(m[1]) && valida(m[2]) && m[1] <= m[2]) out.periodos.push({ d: m[1], h: m[2] });
      else out.otros.push(t);
    });
  out.periodos.sort(function (a, b) {
    return a.d < b.d ? -1 : a.d > b.d ? 1 : a.h < b.h ? -1 : a.h > b.h ? 1 : 0;
  });
  return out;
}

export function serVac(p) {
  return p.periodos
    .map(function (x) {
      return x.d + "/" + x.h;
    })
    .concat(p.otros)
    .join("; ");
}

// Período en curso (el que cubre `hoy`, hasta su último día) o null.
export function vacHoy(v, hoy) {
  hoy = hoy || today();
  var cubre = parseVac(v).periodos.filter(function (x) {
    return x.d <= hoy && hoy <= x.h;
  });
  if (!cubre.length) return null;
  return cubre.reduce(function (a, b) {
    return b.h > a.h ? b : a;
  });
}

function larga(iso) {
  return iso.slice(8) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4);
}

// dd/mm, y /aa si no es de este año
function corta(iso) {
  var s = iso.slice(8) + "/" + iso.slice(5, 7);
  return iso.slice(0, 4) === today().slice(0, 4) ? s : s + "/" + iso.slice(2, 4);
}

function rango(x) {
  return x.d === x.h ? corta(x.d) : corta(x.d) + " – " + corta(x.h);
}

// Texto legible (para el Excel).
export function vacTexto(v) {
  var p = parseVac(v);
  return p.periodos
    .map(function (x) {
      return x.d === x.h ? larga(x.d) : larga(x.d) + " al " + larga(x.h);
    })
    .concat(p.otros)
    .join("; ");
}

// Celda con los períodos como etiquetas y un botón para agregar otro. alCambiar(textoNuevo) guarda; set(texto) vuelve a dibujar.
export function crearVacaciones(valor, alCambiar) {
  var actual = valor || "";
  var ocupado = false;
  var box = el("div", { class: "vac" });
  var lista = el("div", { class: "vac-list" });
  var etiqueta = el("div", { class: "vac-ahora-tag", hidden: true });
  var desde = el("input", { type: "date", "aria-label": "Desde" });
  var hasta = el("input", { type: "date", "aria-label": "Hasta" });
  var err = el("div", { class: "vac-err" });
  var form = el(
    "div",
    { class: "vac-form", hidden: true },
    el("label", {}, "Desde", desde),
    el("label", {}, "Hasta", hasta),
    err,
    el(
      "div",
      { class: "vac-acts" },
      el(
        "button",
        {
          type: "button",
          class: "vac-ok",
          onclick: function () {
            agregar();
          },
        },
        "Agregar",
      ),
      el(
        "button",
        {
          type: "button",
          class: "ghost vac-cancel",
          onclick: function () {
            cerrar();
          },
        },
        "Cancelar",
      ),
    ),
  );
  var abrirBtn = el(
    "button",
    {
      type: "button",
      class: "ghost vac-add",
      title: "Elegir fechas de vacaciones",
      onclick: function () {
        form.hidden = !form.hidden;
        err.textContent = "";
        if (!form.hidden) desde.focus();
      },
    },
    "+ Agregar",
  );
  box.append(lista, etiqueta, abrirBtn, form);

  desde.addEventListener("change", function () {
    hasta.min = desde.value || "";
    if (desde.value && (!hasta.value || hasta.value < desde.value)) hasta.value = desde.value;
  });

  function cerrar() {
    form.hidden = true;
    err.textContent = "";
    desde.value = "";
    hasta.value = "";
    hasta.min = "";
  }

  async function guardar(p) {
    if (ocupado) return;
    ocupado = true;
    box.classList.add("vac-ocupado");
    try {
      await alCambiar(serVac(p));
    } finally {
      ocupado = false;
      box.classList.remove("vac-ocupado");
    }
  }

  function agregar() {
    if (!desde.value || !hasta.value) {
      err.textContent = "Elegí las dos fechas.";
      return;
    }
    if (hasta.value < desde.value) {
      err.textContent = "La fecha final no puede ser anterior a la inicial.";
      return;
    }
    var p = parseVac(actual);
    if (
      p.periodos.some(function (x) {
        return x.d === desde.value && x.h === hasta.value;
      })
    ) {
      err.textContent = "Ese período ya está cargado.";
      return;
    }
    p.periodos.push({ d: desde.value, h: hasta.value });
    cerrar();
    guardar(parseVac(serVac(p)));
  }

  function quitarPeriodo(i) {
    var p = parseVac(actual);
    p.periodos.splice(i, 1);
    guardar(p);
  }

  function quitarOtro(i) {
    var p = parseVac(actual);
    p.otros.splice(i, 1);
    guardar(p);
  }

  function chip(texto, clase, titulo, alQuitar) {
    return el(
      "span",
      { class: "vac-chip " + clase, title: titulo },
      texto,
      el("button", { type: "button", class: "vac-x", title: "Quitar", "aria-label": "Quitar", onclick: alQuitar }, "✕"),
    );
  }

  function pintar() {
    var hoy = today();
    var p = parseVac(actual);
    var chips = p.periodos.map(function (x, i) {
      var clase = x.d <= hoy && hoy <= x.h ? "vac-activa" : x.h < hoy ? "vac-pasada" : "";
      return chip(rango(x), clase, x.d === x.h ? larga(x.d) : larga(x.d) + " al " + larga(x.h), function () {
        quitarPeriodo(i);
      });
    });
    p.otros.forEach(function (t, i) {
      chips.push(
        chip(t, "vac-old", "Texto cargado antes de usar fechas: " + t, function () {
          quitarOtro(i);
        }),
      );
    });
    lista.replaceChildren.apply(lista, chips);
    var ya = vacHoy(actual, hoy);
    etiqueta.hidden = !ya;
    etiqueta.textContent = ya ? "Ausente hasta el " + corta(ya.h) : "";
  }

  pintar();
  return {
    el: box,
    set: function (v) {
      actual = v || "";
      pintar();
    },
  };
}
