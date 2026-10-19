// Solapa Links: tarjetas con nombre y dirección (tabla "links": nombre, valor), buscador, alta/edición/baja
// y cambios en vivo. Si el valor es una dirección web, la tarjeta es clickeable; si es otro texto
// (un usuario, una clave, una nota), se muestra el texto con un botón para copiarlo.

import { $, S, abrirModal, cerrarModal, copiarTexto, el, errMsg, normalizar, sb, status } from "./core.js";
import { leaveGrid, liveOn } from "./live.js";
import { borrarFila } from "./papelera.js";

var linkRows = [];
var linkBusqueda = "";
var linkSyncTimer = null;

// Devuelve una dirección usable si el texto parece una (http://, https://, mailto: o www.), si no, "".
function urlDe(texto) {
  var t = String(texto || "").trim();
  if (/^www\./i.test(t)) t = "https://" + t;
  return /^(https?:\/\/|mailto:)\S+$/i.test(t) ? t : "";
}

function hostDe(u) {
  try {
    var x = new URL(u);
    return x.protocol === "mailto:" ? x.pathname : x.host.replace(/^www\./, "") || u;
  } catch (e) {
    return u;
  }
}

export async function openLinks() {
  S.tab = "links";
  leaveGrid();

  document.querySelectorAll(".tab").forEach(function (b) {
    b.classList.toggle("on", b.getAttribute("data-n") === "links");
  });

  $("tools").replaceChildren();

  var inNombre = el("input", {
    id: "link-nombre",
    placeholder: "Nombre",
    maxlength: "120",
    "aria-label": "Nombre del link",
  });
  var inValor = el("input", {
    id: "link-valor",
    placeholder: "https://… (o cualquier texto)",
    maxlength: "2000",
    "aria-label": "Dirección o texto",
  });

  var form = el(
    "form",
    {
      class: "lk-form",
      autocomplete: "off",
      onsubmit: function (ev) {
        ev.preventDefault();
        agregarLink(inNombre, inValor);
      },
    },
    inNombre,
    inValor,
    el("button", { type: "submit" }, "Agregar"),
  );

  var buscar = el("input", {
    id: "link-q",
    type: "search",
    placeholder: "Buscar…",
    "aria-label": "Buscar links",
    value: linkBusqueda,
    oninput: function () {
      linkBusqueda = this.value;
      pintarLinks();
    },
  });

  $("grid").replaceChildren(
    el(
      "div",
      { class: "lk-wrap" },
      form,
      el("div", { class: "lk-filters" }, buscar),
      el("div", { class: "lk-grid", id: "link-grid" }),
      el("p", { class: "lk-empty", id: "link-empty", hidden: "" }),
    ),
  );

  return loadLinks();
}

// Trae todas las filas (de a 1000, que es lo máximo por pedido).
async function traerLinks() {
  var todas = [],
    desde = 0;
  for (;;) {
    var res = await sb
      .from("links")
      .select("*")
      .order("id", { ascending: true })
      .range(desde, desde + 999);
    if (res.error) return { error: res.error };
    todas = todas.concat(res.data || []);
    if (!res.data || res.data.length < 1000) break;
    desde += 1000;
  }
  return { data: todas };
}

async function loadLinks() {
  status("Cargando links...");
  var res = await traerLinks();
  if (S.tab !== "links") return;
  if (res.error) {
    status(errMsg(res.error), true);
    return;
  }
  linkRows = res.data;
  pintarLinks();
  liveOn("links", "links", refrescarLinks);
  status("");
}

// Cambios de la otra persona: se actualizan las tarjetas sin tocar lo que estás escribiendo arriba.
async function refrescarLinks() {
  if (S.tab !== "links" || !$("link-grid")) return;
  clearTimeout(linkSyncTimer);
  if ($("cal-modal")) {
    linkSyncTimer = setTimeout(refrescarLinks, 1500); // hay una edición abierta: se espera
    return;
  }
  var res = await traerLinks();
  if (res.error || S.tab !== "links" || !$("link-grid")) return;
  if ($("cal-modal")) {
    linkSyncTimer = setTimeout(refrescarLinks, 1500);
    return;
  }
  linkRows = res.data;
  pintarLinks();
}

function linksVisibles() {
  var q = normalizar(linkBusqueda.trim());
  return linkRows
    .filter(function (r) {
      return !q || normalizar((r.nombre || "") + " " + (r.valor || "")).indexOf(q) >= 0;
    })
    .sort(function (a, b) {
      return (a.nombre || "").localeCompare(b.nombre || "", "es");
    });
}

function pintarLinks() {
  var grid = $("link-grid");
  if (!grid) return;
  var lista = linksVisibles();

  grid.replaceChildren.apply(
    grid,
    lista.map(function (r) {
      var u = urlDe(r.valor);
      var titulo = r.nombre || "(Sin nombre)";
      var principal = u
        ? el(
            "a",
            { class: "lk-main", href: u, target: "_blank", rel: "noopener noreferrer", title: u },
            el("span", { class: "lk-title" }, titulo),
            el("span", { class: "lk-host" }, hostDe(u)),
          )
        : el(
            "div",
            { class: "lk-main" },
            el("span", { class: "lk-title" }, titulo),
            el("span", { class: "lk-text" }, r.valor || ""),
          );
      return el(
        "div",
        { class: "lk-card", "data-id": r.id },
        principal,
        el(
          "div",
          { class: "lk-foot" },
          el(
            "button",
            {
              class: "ghost",
              title: "Copiar " + (u ? "la dirección" : "el texto"),
              onclick: function () {
                copiarValor(r);
              },
            },
            "Copiar",
          ),
          el(
            "button",
            {
              class: "ghost",
              title: "Editar",
              "aria-label": "Editar link",
              onclick: function () {
                editarLink(r);
              },
            },
            "✎",
          ),
        ),
      );
    }),
  );

  var vacio = $("link-empty");
  vacio.hidden = lista.length > 0;
  vacio.textContent = linkRows.length
    ? "Ningún link coincide con la búsqueda."
    : "Todavía no hay links. Agregá el primero arriba.";
}

async function copiarValor(r) {
  var ok = await copiarTexto(r.valor || "");
  status(ok ? "Copiado ✓" : "No se pudo copiar.", !ok);
  if (ok)
    setTimeout(function () {
      if ($("status") && $("status").textContent === "Copiado ✓") status("");
    }, 1500);
}

async function agregarLink(inNombre, inValor) {
  var nombre = inNombre.value.trim(),
    valor = inValor.value.trim();
  if (!nombre && !valor) return;
  var res = await sb.from("links").insert({ nombre: nombre || null, valor: valor || null }).select().single();
  if (res.error) {
    status(errMsg(res.error), true);
    return;
  }
  linkRows.push(res.data);
  linkBusqueda = ""; // para que el link nuevo no quede oculto por una búsqueda
  if ($("link-q")) $("link-q").value = "";
  inNombre.value = "";
  inValor.value = "";
  inNombre.focus();
  pintarLinks();
  status("Link agregado ✓");
  setTimeout(function () {
    if ($("status") && $("status").textContent === "Link agregado ✓") status("");
  }, 1500);
}

function editarLink(r) {
  var inN = el("input", { value: r.nombre || "", maxlength: "120", placeholder: "Nombre" });
  var inV = el("textarea", { rows: "4", maxlength: "2000", placeholder: "https://… (o cualquier texto)" });
  inV.value = r.valor || "";
  var err = el("p", { class: "err" }, "");
  var btnG = el("button", {}, "Guardar");

  async function guardar() {
    btnG.disabled = true;
    var patch = { nombre: inN.value.trim() || null, valor: inV.value.trim() || null };
    var res = await sb.from("links").update(patch).eq("id", r.id).select("updated_at, updated_by").single();
    btnG.disabled = false;
    if (res.error) {
      err.textContent = errMsg(res.error);
      return;
    }
    Object.assign(r, patch, { updated_at: res.data.updated_at, updated_by: res.data.updated_by });
    cerrarModal();
    pintarLinks();
    status("Link guardado ✓");
    setTimeout(function () {
      if ($("status") && $("status").textContent === "Link guardado ✓") status("");
    }, 1500);
  }
  btnG.addEventListener("click", guardar);

  async function borrar() {
    if (!confirm("¿Eliminar este link? Va a la Papelera y se puede restaurar desde ahí.")) return;
    var res = await borrarFila("links", r.id);
    if (res.error) {
      err.textContent = errMsg(res.error);
      return;
    }
    linkRows = linkRows.filter(function (x) {
      return x.id !== r.id;
    });
    cerrarModal();
    pintarLinks();
    status("Link eliminado");
  }

  abrirModal([
    el("h3", {}, "Editar link"),
    el("label", {}, "Nombre"),
    inN,
    el("label", {}, "Dirección o texto"),
    inV,
    err,
    el(
      "div",
      { class: "modal-actions" },
      r.updated_by
        ? el("span", { class: "draft-info" }, "Última modificación: " + r.updated_by)
        : el("span", { class: "spacer" }),
      el("button", { class: "ghost", onclick: borrar }, "Eliminar"),
      el("button", { class: "ghost", onclick: cerrarModal }, "Cancelar"),
      btnG,
    ),
  ]);
  inN.focus();
}
