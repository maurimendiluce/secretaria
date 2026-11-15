// Solapa Comisión: los temas se agrupan por reunión (tablas "comisiones_fechas" y "comision").
//  - Carga rápida arriba: se escribe una categoría y/o un tema, Enter, y queda en la comisión elegida (por defecto la próxima).
//  - Categorías prefijadas (tabla "comision_categorias"): se eligen de la lista, se crean escribiéndolas o con «Nueva categoría…»
//    y se renombran o borran desde el botón «Categorías».
//  - Cada comisión es un bloque: "Para tratar" (tipo para) y "Anotado en la comisión" (tipo en).
//  - Estados: Pendiente / Tratado / Pasa a la próxima. "Pasa a la próxima" copia el tema a la comisión siguiente.
//  - Archivo: las comisiones (o anotaciones sueltas) ya resueltas se archivan; salen de la vista y se ven en «Ver archivo».
//  - Los acuerdos anotados en comisión se pueden convertir en una tarea de Seguimiento.
// Cambios en vivo entre usuarios, igual que las demás solapas.

import { $, S, abrirModal, byText, cerrarModal, el, errMsg, fmtDate, grow, normalizar, sb, status, today } from "./core.js";
import { leaveGrid, liveOn } from "./live.js";
import { borrarFila, tablaFaltante } from "./papelera.js";
import { open as abrirPlanilla } from "./planilla.js";
import { ESTADOS_COMISION, RESPONSABLES } from "./tablas.js";

var PASA = "Pasa a la próxima";
var NUEVA = "__nueva__";
var ESTADOS_EN = ["Pendiente", "Tratado"]; // para lo anotado en comisión no tiene sentido "Pasa a la próxima"

var notas = []; // filas de "comision"
var fechas = []; // filas de "comisiones_fechas"
var categorias = []; // filas de "comision_categorias"
var busqueda = "";
var filtroEstado = null;
var verArchivo = false; // false: comisiones activas; true: el archivo
var abiertos = {}; // bloque -> abierto o cerrado, según lo que eligió la persona
var pendiente = false;
var selTipo, selSesion, inCat, inExpte, inObs, listaCats, btnArchivo, btnPasadas;

// ---------- Fechas ----------
function diaSemana(f) {
  var p = f.split("-");
  var d = new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString("es-AR", { weekday: "long" });
  return d.charAt(0).toUpperCase() + d.slice(1);
}

function dias(f) {
  var p = f.split("-"),
    h = today().split("-");
  return Math.round((new Date(+p[0], +p[1] - 1, +p[2]) - new Date(+h[0], +h[1] - 1, +h[2])) / 86400000);
}

// Comisiones del calendario, más las fechas que tengan temas aunque no estén en el calendario (así nada desaparece).
function listaSesiones() {
  var m = {};
  fechas.forEach(function (f) {
    m[f.fecha] = { fecha: f.fecha, id: f.id, nota: f.nota || "", archivada: !!f.archivada };
  });
  notas.forEach(function (n) {
    if (n.fecha && !m[n.fecha]) m[n.fecha] = { fecha: n.fecha, id: null, nota: "", virtual: true, archivada: false };
  });
  return Object.keys(m)
    .sort()
    .map(function (k) {
      return m[k];
    });
}

// Solo las comisiones no archivadas: a ellas van los temas nuevos, los copiados y la «próxima».
function sesionesActivas() {
  return listaSesiones().filter(function (s) {
    return !s.archivada;
  });
}

function sesionArchivada(f) {
  var s = fechas.find(function (x) {
    return x.fecha === f;
  });
  return !!(s && s.archivada);
}

// Una anotación está archivada si lo está ella o la comisión a la que pertenece.
function archivada(n) {
  return !!n.archivada || !!(n.fecha && sesionArchivada(n.fecha));
}

function proximaFecha(ses) {
  var hoy = today();
  var s = ses.find(function (x) {
    return x.fecha >= hoy;
  });
  return s ? s.fecha : null;
}

// Fecha de la comisión (activa) que sigue a `f` (si no hay fecha, la próxima).
function siguienteFecha(f) {
  var ses = sesionesActivas();
  if (!f) return proximaFecha(ses);
  var s = ses.find(function (x) {
    return x.fecha > f;
  });
  return s ? s.fecha : null;
}

// Para temas a tratar: la próxima comisión. Para lo anotado en comisión: la reunión más cercana a hoy.
function sesionPorDefecto(tipo, ses) {
  if (tipo === "en" && ses.length) {
    var mejor = null;
    ses.forEach(function (s) {
      var d = Math.abs(dias(s.fecha));
      if (!mejor || d < mejor.d || (d === mejor.d && s.fecha > mejor.f)) mejor = { d: d, f: s.fecha };
    });
    return mejor.f;
  }
  return proximaFecha(ses) || "";
}

// ---------- Categorías ----------
function nombresCategorias() {
  return categorias
    .map(function (c) {
      return c.nombre;
    })
    .sort(function (a, b) {
      return a.localeCompare(b, "es");
    });
}

function categoriaExistente(txt) {
  var t = normalizar(txt.trim());
  var c = categorias.find(function (x) {
    return normalizar(x.nombre) === t;
  });
  return c ? c.nombre : null;
}

// Devuelve el nombre de la categoría (creándola si no existe). Distingue mayúsculas y tildes solo para guardar: "jurados" y "Jurados" son la misma.
async function asegurarCategoria(txt) {
  var t = String(txt || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!t) return { nombre: null };
  var ex = categoriaExistente(t);
  if (ex) return { nombre: ex };
  var r = await sb.from("comision_categorias").insert({ nombre: t }).select("*").single();
  if (r.error) return { error: r.error };
  categorias.push(r.data);
  return { nombre: t, creada: true };
}

// Sugerencias de la carga rápida.
function llenarCategorias() {
  if (!listaCats) return;
  listaCats.replaceChildren.apply(
    listaCats,
    nombresCategorias().map(function (n) {
      return el("option", { value: n });
    }),
  );
}

function modalNuevaCategoria(alCrear) {
  var inp = el("input", { type: "text", maxlength: "80", placeholder: "Nombre de la categoría" });
  var err = el("p", { class: "err" });
  async function crear() {
    err.textContent = "";
    var r = await asegurarCategoria(inp.value);
    if (r.error) return (err.textContent = "No se pudo crear: " + errMsg(r.error));
    if (!r.nombre) return (err.textContent = "Escribí un nombre.");
    cerrarModal();
    llenarCategorias();
    await alCrear(r.nombre);
  }
  inp.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") {
      ev.preventDefault();
      crear();
    }
  });
  abrirModal([
    el("h3", {}, "Nueva categoría"),
    inp,
    err,
    el(
      "div",
      { class: "modal-actions" },
      el("button", { type: "button", onclick: crear }, "Crear"),
      el("button", { type: "button", class: "ghost", onclick: cerrarModal }, "Cancelar"),
    ),
  ]);
  inp.focus();
}

// Administrar: agregar, renombrar (se actualizan las anotaciones que la usan) y borrar.
function modalCategorias() {
  var lista = el("div", { class: "cm-cats" });
  var err = el("p", { class: "err" });
  var nuevo = el("input", { type: "text", maxlength: "80", placeholder: "Nueva categoría…" });

  function usos(nombre) {
    return notas.filter(function (n) {
      return n.categoria === nombre;
    }).length;
  }

  function dibujar() {
    var filas = categorias
      .slice()
      .sort(function (a, b) {
        return a.nombre.localeCompare(b.nombre, "es");
      })
      .map(function (c) {
        var inp = el("input", { type: "text", maxlength: "80", value: c.nombre, "aria-label": "Nombre de la categoría" });
        inp.addEventListener("change", function () {
          renombrar(c, inp);
        });
        var u = usos(c.nombre);
        return el(
          "div",
          { class: "cm-cat-row" },
          inp,
          el("small", { class: "note" }, u + (u === 1 ? " uso" : " usos")),
          el(
            "button",
            {
              type: "button",
              class: "del",
              title: "Borrar categoría",
              onclick: function () {
                borrarCategoria(c);
              },
            },
            "✕",
          ),
        );
      });
    if (!filas.length) filas = [el("p", { class: "note" }, "Todavía no hay categorías.")];
    lista.replaceChildren.apply(lista, filas);
  }

  async function renombrar(c, inp) {
    err.textContent = "";
    var t = inp.value.trim().replace(/\s+/g, " ");
    if (!t || t === c.nombre) return (inp.value = c.nombre);
    var otra = categorias.some(function (x) {
      return x.id !== c.id && normalizar(x.nombre) === normalizar(t);
    });
    if (otra) {
      inp.value = c.nombre;
      return (err.textContent = "Ya existe una categoría con ese nombre.");
    }
    var r = await sb.from("comision_categorias").update({ nombre: t }).eq("id", c.id);
    if (r.error) {
      inp.value = c.nombre;
      return (err.textContent = "No se pudo renombrar: " + errMsg(r.error));
    }
    // siempre se actualiza en la base (otra persona pudo haber usado esta categoría hace un momento)
    var u = await sb.from("comision").update({ categoria: t }).eq("categoria", c.nombre);
    if (u.error) err.textContent = "Se renombró la categoría, pero no todas las anotaciones: " + errMsg(u.error);
    notas.forEach(function (n) {
      if (n.categoria === c.nombre) n.categoria = t;
    });
    c.nombre = t;
    dibujar();
    llenarCategorias();
    pintar();
  }

  async function borrarCategoria(c) {
    err.textContent = "";
    var u = usos(c.nombre);
    var msg = u
      ? "¿Borrar la categoría «" + c.nombre + "»?\n\n" + u + (u === 1 ? " anotación la usa" : " anotaciones la usan") + ": conservan el nombre, pero ya no va a estar en la lista."
      : "¿Borrar la categoría «" + c.nombre + "»?";
    if (!confirm(msg)) return;
    var r = await borrarFila("comision_categorias", c.id);
    if (r.error) return (err.textContent = "No se pudo borrar: " + errMsg(r.error));
    categorias = categorias.filter(function (x) {
      return x.id !== c.id;
    });
    dibujar();
    llenarCategorias();
    pintar();
  }

  async function agregar() {
    err.textContent = "";
    var r = await asegurarCategoria(nuevo.value);
    if (r.error) return (err.textContent = "No se pudo crear: " + errMsg(r.error));
    if (!r.nombre) return nuevo.focus();
    if (!r.creada) err.textContent = "Esa categoría ya existe.";
    nuevo.value = "";
    dibujar();
    llenarCategorias();
    nuevo.focus();
  }
  nuevo.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") {
      ev.preventDefault();
      agregar();
    }
  });

  dibujar();
  abrirModal(
    [
      el("h3", {}, "Categorías"),
      el("p", { class: "note" }, "Se eligen al anotar un tema. Para renombrar, editá el nombre; para quitarla de la lista, la ✕."),
      lista,
      el("div", { class: "cm-cat-add" }, nuevo, el("button", { type: "button", onclick: agregar }, "Agregar")),
      err,
      el("div", { class: "modal-actions" }, el("button", { type: "button", class: "ghost", onclick: cerrarModal }, "Cerrar")),
    ],
    "wide",
  );
}

// ---------- Carga ----------
async function traer(tabla) {
  var todas = [],
    desde = 0;
  for (;;) {
    var r = await sb
      .from(tabla)
      .select("*")
      .order("id", { ascending: true })
      .range(desde, desde + 999);
    if (r.error) return { error: r.error };
    todas = todas.concat(r.data || []);
    if (!r.data || r.data.length < 1000) break;
    desde += 1000;
  }
  return { data: todas };
}

async function traerTodo() {
  return { a: await traer("comision"), b: await traer("comisiones_fechas"), c: await traer("comision_categorias") };
}

function aplicar(t) {
  notas = t.a.data;
  fechas = t.b.data;
  categorias = t.c.data;
}

export async function openComision() {
  S.tab = "comision";
  leaveGrid();
  document.querySelectorAll(".tab").forEach(function (b) {
    b.classList.toggle("on", b.getAttribute("data-n") === "comision");
  });
  armarHerramientas();
  $("grid").replaceChildren(el("div", { class: "cm-wrap", id: "cm-wrap" }));
  return cargar();
}

async function cargar() {
  status("Cargando…");
  var t = await traerTodo();
  if (S.tab !== "comision") return;
  if (t.a.error) return status("Error: " + errMsg(t.a.error), true);
  var falta = null;
  if (t.b.error && tablaFaltante(t.b.error, "comisiones_fechas"))
    falta = "Falta crear la tabla «comisiones_fechas» en Supabase. Corré el archivo supabase/comision.sql en el SQL Editor y recargá esta página.";
  else if (t.c.error && tablaFaltante(t.c.error, "comision_categorias"))
    falta = "Falta crear la tabla «comision_categorias» (y las columnas de archivo) en Supabase. Corré el archivo supabase/comision_categorias_archivo.sql en el SQL Editor y recargá esta página.";
  if (falta) {
    $("cm-wrap").replaceChildren(el("p", { class: "note" }, falta));
    return status("");
  }
  if (t.b.error || t.c.error) return status("Error: " + errMsg(t.b.error || t.c.error), true);
  aplicar(t);
  llenarSesiones(true);
  llenarCategorias();
  pintar();
  liveOn("comision", ["comision", "comisiones_fechas", "comision_categorias"], refrescar);
  status("");
}

// Vuelve a pedir los datos y redibuja, sin preguntar nada.
async function recargar() {
  var t = await traerTodo();
  if (S.tab !== "comision" || !$("cm-wrap") || t.a.error || t.b.error || t.c.error) return;
  aplicar(t);
  llenarSesiones(false);
  llenarCategorias();
  pintar();
}

export function refrescarComision() {
  return refrescar();
}

// Cambios de la otra persona: no se pisa lo que se está escribiendo.
async function refrescar() {
  if (S.tab !== "comision" || !$("cm-wrap")) return;
  if (hayEdicion()) {
    pendiente = true;
    return;
  }
  var t = await traerTodo();
  if (S.tab !== "comision" || !$("cm-wrap") || t.a.error || t.b.error || t.c.error) return;
  if (hayEdicion()) {
    pendiente = true;
    return;
  }
  aplicar(t);
  llenarSesiones(false);
  llenarCategorias();
  pintar();
}

function hayEdicion() {
  var a = document.activeElement;
  return !!$("cal-modal") || !!(a && a.closest && a.closest("#cm-wrap"));
}

document.addEventListener("focusout", function () {
  setTimeout(function () {
    if (pendiente && S.tab === "comision" && !hayEdicion()) {
      pendiente = false;
      refrescar();
    }
  }, 250);
});

setInterval(function () {
  if (!document.hidden && S.tab === "comision" && $("cm-wrap")) refrescar();
}, 60000);

// ---------- Barra de herramientas: carga rápida ----------
function armarHerramientas() {
  selTipo = el(
    "select",
    {
      "aria-label": "Tipo de anotación",
      onchange: function () {
        selSesion.dataset.manual = "";
        llenarSesiones(true);
      },
    },
    el("option", { value: "para" }, "Para comisión"),
    el("option", { value: "en" }, "En comisión"),
  );
  selSesion = el("select", {
    "aria-label": "Comisión",
    title: "En qué comisión queda anotado",
    onchange: function () {
      selSesion.dataset.manual = "1";
    },
  });
  listaCats = el("datalist", { id: "cm-cats" });
  inCat = el("input", {
    placeholder: "Categoría…",
    maxlength: "80",
    "aria-label": "Categoría",
    title: "Elegí una de la lista o escribí una nueva (se agrega a la lista)",
    class: "cm-cat-in",
    list: "cm-cats",
  });
  inExpte = el("input", { placeholder: "Expte.", maxlength: "200", "aria-label": "Expediente", class: "cm-expte" });
  inObs = el("input", {
    placeholder: "Tema u observación (Enter para agregar)",
    maxlength: "2000",
    "aria-label": "Tema u observación",
    class: "cm-obs-in",
  });
  var form = el(
    "form",
    { class: "cm-quick", autocomplete: "off", onsubmit: agregarRapida },
    selTipo,
    selSesion,
    inCat,
    listaCats,
    inExpte,
    inObs,
    el("button", { type: "submit" }, "Agregar"),
  );
  var buscar = el("input", {
    type: "search",
    placeholder: "Buscar…",
    "aria-label": "Buscar",
    value: busqueda,
    oninput: function () {
      busqueda = this.value;
      pintar();
    },
  });
  btnPasadas = el("button", {
    type: "button",
    class: "ghost",
    title: "Archiva todas las comisiones cuya fecha ya pasó",
    onclick: archivarPasadas,
  });
  btnArchivo = el("button", {
    type: "button",
    class: "ghost",
    onclick: function () {
      verArchivo = !verArchivo;
      filtroEstado = null;
      pintar();
    },
  });
  $("tools").replaceChildren(
    form,
    el("div", { class: "counters", id: "cm-counters" }),
    buscar,
    el("button", { type: "button", onclick: function () { modalFecha(null); } }, "+ Fecha de comisión"),
    el("button", { type: "button", class: "ghost", onclick: modalCategorias }, "Categorías"),
    btnPasadas,
    btnArchivo,
    el("button", { type: "button", class: "ghost", onclick: recargar }, "Recargar"),
    el("button", { type: "button", class: "ghost", onclick: exportarXlsx }, "Exportar a Excel"),
  );
}

// Completa las comisiones del desplegable de la carga rápida. `reset`: volver a elegir la sugerida.
function llenarSesiones(reset) {
  if (!selSesion) return;
  var ses = sesionesActivas(),
    prox = proximaFecha(ses),
    previa = selSesion.value,
    manual = selSesion.dataset.manual === "1";
  var opts = ses.map(function (s) {
    return el(
      "option",
      { value: s.fecha },
      fmtDate(s.fecha) + " (" + diaSemana(s.fecha) + ")" + (s.fecha === prox ? " · próxima" : ""),
    );
  });
  opts.push(el("option", { value: "" }, "Sin comisión"));
  selSesion.replaceChildren.apply(selSesion, opts);
  var elegida =
    !reset && manual && Array.prototype.some.call(selSesion.options, function (o) { return o.value === previa; })
      ? previa
      : sesionPorDefecto(selTipo.value, ses);
  selSesion.value = elegida;
}

async function agregarRapida(ev) {
  ev.preventDefault();
  var cat = inCat.value.trim(),
    obs = inObs.value.trim();
  if (!cat && !obs) return inCat.focus();
  var categoria = null;
  if (cat) {
    var c = await asegurarCategoria(cat);
    if (c.error) return status("No se pudo crear la categoría: " + errMsg(c.error), true);
    categoria = c.nombre;
    if (c.creada) llenarCategorias();
  }
  var tipo = selTipo.value,
    fila = {
      fecha: selSesion.value || null,
      tipo: tipo,
      categoria: categoria,
      expediente: inExpte.value.trim() || null,
      observacion: obs || null,
      estado: tipo === "para" ? "Pendiente" : null,
    };
  status("Agregando…");
  var r = await sb.from("comision").insert(fila).select("*").single();
  if (r.error) return status("No se pudo agregar: " + errMsg(r.error), true);
  notas.push(r.data);
  inCat.value = "";
  inExpte.value = "";
  inObs.value = "";
  abiertos[fila.fecha || "sin"] = true;
  pintar();
  avisar("Agregado ✓" + (categoria ? " en " + categoria : ""));
  if (!obs) {
    // solo se escribió la categoría: el cursor pasa a la observación de la fila nueva
    var ta = document.querySelector('tr[data-id="' + r.data.id + '"] td.cm-obs textarea');
    if (ta) return ta.focus();
  }
  inCat.focus();
}

function avisar(msg) {
  status(msg);
  setTimeout(function () {
    if ($("status") && $("status").textContent === msg) status("");
  }, 1800);
}

// ---------- Contadores y botones del archivo ----------
function enModo(n) {
  return verArchivo ? archivada(n) : !archivada(n);
}

function pintarContadores() {
  var box = $("cm-counters");
  if (!box) return;
  var base = notas.filter(enModo);
  box.replaceChildren.apply(
    box,
    ESTADOS_COMISION.map(function (e) {
      var total = base.filter(function (n) {
        return n.estado === e;
      }).length;
      return el(
        "button",
        {
          type: "button",
          class: "counter st-" + e.replace(/\s/g, "") + (filtroEstado === e ? " on" : ""),
          title: filtroEstado === e ? "Quitar el filtro" : "Mostrar solo: " + e,
          onclick: function () {
            filtroEstado = filtroEstado === e ? null : e;
            pintar();
          },
        },
        e + " ",
        el("b", {}, String(total)),
      );
    }),
  );
}

function pasadasActivas() {
  var hoy = today();
  return sesionesActivas().filter(function (s) {
    return s.fecha < hoy;
  });
}

function pintarBotonesArchivo() {
  if (!btnArchivo) return;
  var enArchivo = notas.filter(archivada).length;
  btnArchivo.textContent = verArchivo ? "← Volver a las comisiones" : "Ver archivo (" + enArchivo + ")";
  btnArchivo.classList.toggle("on", verArchivo);
  var p = pasadasActivas().length;
  btnPasadas.hidden = verArchivo || !p;
  btnPasadas.textContent = "Archivar pasadas (" + p + ")";
}

// ---------- Bloques por comisión ----------
function visible(n) {
  if (filtroEstado && (n.estado || "") !== filtroEstado) return false;
  var q = normalizar(busqueda.trim());
  if (!q) return true;
  return normalizar([n.categoria, n.expediente, n.observacion, n.estado].join(" ")).indexOf(q) >= 0;
}

function pintar() {
  var wrap = $("cm-wrap");
  if (!wrap) return;
  pintarContadores();
  pintarBotonesArchivo();
  var ses = listaSesiones(),
    hoy = today(),
    prox = proximaFecha(sesionesActivas()),
    filtrando = !!(busqueda.trim() || filtroEstado);
  var bloques = [];

  if (!verArchivo) {
    var porFecha = {},
      sin = [];
    notas.forEach(function (n) {
      if (n.archivada) return;
      if (!n.fecha) sin.push(n);
      else if (!sesionArchivada(n.fecha)) (porFecha[n.fecha] = porFecha[n.fecha] || []).push(n);
    });
    var activas = ses.filter(function (s) {
      return !s.archivada;
    });
    var futuras = activas.filter(function (s) {
        return s.fecha >= hoy;
      }),
      pasadas = activas
        .filter(function (s) {
          return s.fecha < hoy;
        })
        .reverse();
    if (sin.length) bloques.push(bloque({ key: "sin", titulo: "Sin comisión asignada", s: null, lista: sin, filtrando: filtrando }));
    futuras.concat(pasadas).forEach(function (s) {
      bloques.push(
        bloque({ key: s.fecha, s: s, lista: porFecha[s.fecha] || [], esProxima: s.fecha === prox, filtrando: filtrando }),
      );
    });
  } else {
    bloques.push(el("p", { class: "note" }, "Archivo: lo archivado no aparece en las comisiones. Desarchivá lo que necesites."));
    ses
      .filter(function (s) {
        return s.archivada;
      })
      .reverse()
      .forEach(function (s) {
        bloques.push(
          bloque({
            key: "a" + s.fecha,
            s: s,
            lista: notas.filter(function (n) {
              return n.fecha === s.fecha;
            }),
            filtrando: filtrando,
            archivo: true,
          }),
        );
      });
    var sueltas = notas.filter(function (n) {
      return n.archivada && !(n.fecha && sesionArchivada(n.fecha));
    });
    if (sueltas.length)
      bloques.push(bloque({ key: "asueltas", titulo: "Anotaciones archivadas", s: null, lista: sueltas, filtrando: filtrando, archivo: true }));
  }

  bloques = bloques.filter(Boolean);
  var hayBloques = bloques.some(function (b) {
    return b.tagName === "DETAILS";
  });
  if (!hayBloques) {
    bloques.push(
      el(
        "p",
        { class: "note" },
        filtrando
          ? "No hay temas que coincidan con la búsqueda o el filtro."
          : verArchivo
            ? "El archivo está vacío."
            : "Todavía no hay comisiones. Agregá la primera con «+ Fecha de comisión».",
      ),
    );
  }
  wrap.replaceChildren.apply(wrap, bloques);
  crecer(wrap);
}

// Los textarea de un bloque cerrado no tienen tamaño todavía: se ajustan al abrirlo.
function crecer(raiz) {
  raiz.querySelectorAll("details[open] textarea").forEach(grow);
}

function resumen(lista) {
  var para = lista.filter(function (n) {
      return n.tipo !== "en";
    }),
    en = lista.length - para.length,
    pend = para.filter(function (n) {
      return n.estado === "Pendiente";
    }).length,
    partes = [para.length + (para.length === 1 ? " tema" : " temas")];
  if (pend) partes.push(pend + (pend === 1 ? " pendiente" : " pendientes"));
  if (en) partes.push(en + (en === 1 ? " anotación en comisión" : " anotaciones en comisión"));
  return partes.join(" · ");
}

// o: { key, s (comisión o null), titulo, lista, esProxima, filtrando, archivo }
function bloque(o) {
  var s = o.s,
    lista = o.lista,
    vis = lista.filter(visible);
  if (o.filtrando && !vis.length) return null;
  var hoy = today();
  var abierto = o.filtrando ? true : o.key in abiertos ? abiertos[o.key] : o.key === "sin" || !!o.esProxima;

  var titulo = o.titulo || "Comisión del " + diaSemana(s.fecha) + " " + fmtDate(s.fecha);
  var acciones = el("span", { class: "cm-actions" });

  if (o.archivo) {
    if (s && s.id) {
      acciones.append(
        el(
          "button",
          {
            type: "button",
            class: "ghost",
            title: "Vuelve a mostrar esta comisión entre las activas",
            onclick: function () {
              desarchivarSesion(s);
            },
          },
          "Desarchivar",
        ),
      );
    }
  } else {
    var pend = lista.filter(function (n) {
      return n.tipo !== "en" && n.estado === "Pendiente";
    });
    var dest = siguienteFecha(s ? s.fecha : null);
    if (pend.length && dest) {
      acciones.append(
        el(
          "button",
          {
            type: "button",
            class: "ghost",
            title: "Copia los temas pendientes a la comisión del " + fmtDate(dest) + " y los marca «" + PASA + "»",
            onclick: function () {
              pasarPendientes(s, pend, dest);
            },
          },
          "Pasar " + pend.length + (pend.length === 1 ? " pendiente" : " pendientes") + " → " + fmtDate(dest).slice(0, 5),
        ),
      );
    }
    if (s) {
      if (s.id) {
        acciones.append(
          el(
            "button",
            {
              type: "button",
              class: "ghost",
              title: "Cambiar la fecha o la nota de esta comisión",
              onclick: function () {
                modalFecha(s);
              },
            },
            "Editar",
          ),
        );
      }
      acciones.append(
        el(
          "button",
          {
            type: "button",
            class: "ghost",
            title: "Saca esta comisión de la vista; se puede recuperar desde «Ver archivo»",
            onclick: function () {
              archivarSesion(s, lista);
            },
          },
          "Archivar",
        ),
      );
      if (s.id) {
        acciones.append(
          el(
            "button",
            {
              type: "button",
              class: "del",
              title: lista.length ? "No se puede borrar: tiene temas anotados (archivala en su lugar)" : "Borrar esta comisión",
              disabled: lista.length ? "" : null,
              onclick: function () {
                borrarSesion(s);
              },
            },
            "✕",
          ),
        );
      }
    } else if (o.key === "sin") {
      acciones.append(
        el(
          "button",
          {
            type: "button",
            class: "ghost",
            title: "Archiva todas las anotaciones sin comisión",
            onclick: function () {
              archivarSueltas(lista);
            },
          },
          "Archivar todo",
        ),
      );
    }
  }

  var badge = null;
  if (!o.archivo && s && s.fecha === hoy) badge = el("span", { class: "cm-badge hoy" }, "Hoy");
  else if (!o.archivo && o.esProxima) badge = el("span", { class: "cm-badge prox" }, "Próxima");

  var cuerpo = el("div", { class: "cm-body" });
  var para = vis.filter(function (n) {
      return n.tipo !== "en";
    }),
    en = vis.filter(function (n) {
      return n.tipo === "en";
    }),
    ctx = { sesionArchivada: !!(s && s.archivada), archivo: !!o.archivo };
  if (s && s.nota) cuerpo.append(el("p", { class: "note cm-nota" }, s.nota));
  if (para.length || (!o.filtrando && !o.archivo)) {
    cuerpo.append(el("h4", {}, "Para tratar"));
    cuerpo.append(
      para.length ? tabla(para, false, ctx) : el("p", { class: "note" }, "Sin temas todavía. Anotá uno arriba y Enter."),
    );
  }
  if (en.length) {
    cuerpo.append(el("h4", {}, "Anotado en la comisión"));
    cuerpo.append(tabla(en, true, ctx));
  }

  var d = el(
    "details",
    { class: "cm-block" + (o.esProxima ? " cm-next" : "") + (s && s.fecha < hoy ? " cm-past" : "") + (o.archivo ? " cm-arch" : "") },
    el(
      "summary",
      {},
      el("span", { class: "cm-title" }, titulo),
      badge,
      el("span", { class: "cm-sum" }, resumen(lista)),
      acciones,
    ),
    cuerpo,
  );
  if (abierto) d.setAttribute("open", "");
  d.addEventListener("toggle", function () {
    if (o.filtrando) return;
    abiertos[o.key] = d.open;
    if (d.open) crecer(d);
  });
  return d;
}

// ---------- Tabla de temas ----------
function tabla(lista, esEn, ctx) {
  var head = el("tr");
  ["Categoría", "Expte. / Proyecto", "Observación", "Estado", "Comisión"].forEach(function (h) {
    head.append(el("th", {}, h));
  });
  head.append(el("th"));
  var tb = el("tbody");
  lista.forEach(function (n) {
    tb.append(fila(n, esEn, ctx));
  });
  return el("div", { class: "cm-tablewrap" }, el("table", {}, el("thead", {}, head), tb));
}

function campo(n, k, tr, tipo, extra) {
  var inp;
  if (tipo === "input") inp = el("input", { type: "text" });
  else {
    inp = el("textarea", { rows: "1" });
    inp.addEventListener("input", function () {
      grow(inp);
    });
  }
  inp.value = n[k] == null ? "" : n[k];
  inp.addEventListener("change", function () {
    guardar(n, k, inp.value, tr);
  });
  return el("td", { class: extra || "" }, inp);
}

// Categoría: se elige de la lista; «Nueva categoría…» abre un cuadro para crearla.
function celdaCategoria(n, tr) {
  var sel = el("select", { "aria-label": "Categoría" }, el("option", { value: "" }, ""));
  var nombres = nombresCategorias();
  nombres.forEach(function (c) {
    sel.append(el("option", { value: c }, c));
  });
  if (n.categoria && nombres.indexOf(n.categoria) < 0) sel.append(el("option", { value: n.categoria }, n.categoria)); // valor viejo: se conserva
  sel.append(el("option", { value: NUEVA }, "➕ Nueva categoría…"));
  sel.value = n.categoria || "";
  sel.addEventListener("change", async function () {
    if (sel.value === NUEVA) {
      sel.value = n.categoria || "";
      return modalNuevaCategoria(async function (nombre) {
        if (await guardar(n, "categoria", nombre, tr)) pintar();
      });
    }
    var viejo = n.categoria || "";
    if (!(await guardar(n, "categoria", sel.value, tr))) sel.value = viejo;
  });
  return el("td", { class: "cm-cat" }, sel);
}

function fila(n, esEn, ctx) {
  var tr = el("tr", {
    "data-id": n.id,
    class: (n.estado ? "st-" + n.estado.replace(/\s/g, "") : "") + (n.archivada ? " cm-arch-row" : ""),
    title: n.updated_by ? "Editado por " + byText(n) : "",
  });
  tr.append(celdaCategoria(n, tr), campo(n, "expediente", tr, "area"), campo(n, "observacion", tr, "area", "cm-obs"));

  // Estado
  var opciones = esEn ? ESTADOS_EN : ESTADOS_COMISION;
  var sel = el("select", {}, el("option", { value: "" }, ""));
  opciones.forEach(function (o) {
    sel.append(el("option", { value: o }, o));
  });
  if (n.estado && opciones.indexOf(n.estado) < 0) sel.append(el("option", { value: n.estado }, n.estado)); // valor viejo: se conserva
  sel.value = n.estado || "";
  sel.addEventListener("change", function () {
    cambiarEstado(n, sel, tr);
  });
  tr.append(el("td", {}, sel));

  // Comisión (para mover el tema a otra reunión): solo las activas, más la actual
  var sc = el("select", {});
  listaSesiones().forEach(function (s) {
    if (s.archivada && s.fecha !== n.fecha) return;
    sc.append(el("option", { value: s.fecha }, fmtDate(s.fecha) + (s.archivada ? " (archivada)" : "")));
  });
  sc.append(el("option", { value: "" }, "Sin comisión"));
  sc.value = n.fecha || "";
  sc.addEventListener("change", async function () {
    var ok = await guardar(n, "fecha", sc.value, tr);
    if (!ok) return (sc.value = n.fecha || "");
    abiertos[n.fecha || "sin"] = true;
    pintar();
  });
  tr.append(el("td", { class: "cm-com" }, sc));

  // Acciones
  var act = el("td", { class: "act cm-act" });
  if (esEn) {
    if (n.tarea_id != null) {
      act.append(
        el(
          "button",
          {
            type: "button",
            class: "ghost cm-tarea-ok",
            title: "Ya hay una tarea en Seguimiento (N° " + n.tarea_id + "). Clic para ir a Seguimiento.",
            onclick: function () {
              document.querySelectorAll(".tab").forEach(function (b) {
                b.classList.toggle("on", b.getAttribute("data-n") === "seguimiento");
              });
              abrirPlanilla("seguimiento");
            },
          },
          "✓ Tarea",
        ),
      );
    } else {
      act.append(
        el(
          "button",
          {
            type: "button",
            class: "ghost",
            title: "Crear una tarea en Seguimiento a partir de esta anotación",
            onclick: function () {
              modalTarea(n);
            },
          },
          "Crear tarea",
        ),
      );
    }
  }
  if (!ctx.sesionArchivada) {
    act.append(
      el(
        "button",
        {
          type: "button",
          class: "ghost",
          title: n.archivada ? "Vuelve a mostrar esta anotación" : "Saca esta anotación de la vista (se recupera desde «Ver archivo»)",
          onclick: async function () {
            if (await guardar(n, "archivada", !n.archivada, tr)) pintar();
          },
        },
        n.archivada ? "Desarchivar" : "Archivar",
      ),
    );
  }
  act.append(
    el(
      "button",
      {
        type: "button",
        class: "del",
        title: "Borrar (va a la Papelera)",
        onclick: function () {
          borrar(n);
        },
      },
      "✕",
    ),
  );
  tr.append(act);
  return tr;
}

// Se guarda solo la celda modificada: dos personas editando celdas distintas no se pisan.
async function guardar(n, k, valor, tr) {
  status("Guardando…");
  var patch = {};
  patch[k] = valor === "" ? null : valor;
  var res = await sb.from("comision").update(patch).eq("id", n.id).select("updated_by,updated_at").single();
  if (res.error) {
    status("No se pudo guardar: " + errMsg(res.error), true);
    return false;
  }
  n[k] = patch[k];
  n.updated_by = res.data.updated_by;
  n.updated_at = res.data.updated_at;
  if (tr) tr.title = "Editado por " + byText(n);
  avisar("Guardado ✓");
  return true;
}

async function cambiarEstado(n, sel, tr) {
  var nuevo = sel.value,
    viejo = n.estado || "";
  if (nuevo === PASA && n.tipo !== "en") {
    var dest = siguienteFecha(n.fecha);
    if (!dest) {
      sel.value = viejo;
      return status("No hay una comisión posterior: agregá su fecha con «+ Fecha de comisión» y volvé a intentar.", true);
    }
    if (!(await guardar(n, "estado", nuevo, tr))) return (sel.value = viejo);
    var c = await copiarA([n], dest);
    if (c.error) status("Quedó marcado, pero no se pudo copiar: " + errMsg(c.error), true);
    else avisar(c.copiadas ? "Copiado a la comisión del " + fmtDate(dest) + " ✓" : "Ya estaba en la comisión del " + fmtDate(dest));
    return pintar();
  }
  if (!(await guardar(n, "estado", nuevo, tr))) return (sel.value = viejo);
  pintar();
}

// Copia temas como "Pendiente" a la comisión `dest`; no duplica los que ya están ahí.
async function copiarA(lista, dest) {
  var nuevas = lista
    .filter(function (n) {
      return !notas.some(function (x) {
        return (
          x.fecha === dest &&
          x.tipo !== "en" &&
          (x.observacion || "") === (n.observacion || "") &&
          (x.expediente || "") === (n.expediente || "")
        );
      });
    })
    .map(function (n) {
      return {
        fecha: dest,
        tipo: "para",
        categoria: n.categoria,
        expediente: n.expediente,
        observacion: n.observacion,
        estado: "Pendiente",
      };
    });
  if (!nuevas.length) return { copiadas: 0 };
  var r = await sb.from("comision").insert(nuevas).select("*");
  if (r.error) return { error: r.error };
  notas = notas.concat(r.data);
  return { copiadas: r.data.length };
}

async function pasarPendientes(s, lista, dest) {
  if (
    !confirm(
      "¿Pasar " +
        lista.length +
        (lista.length === 1 ? " tema pendiente" : " temas pendientes") +
        " a la comisión del " +
        fmtDate(dest) +
        "?\n\nAcá quedan marcados «" +
        PASA +
        "» y allá se crean como Pendiente.",
    )
  )
    return;
  status("Pasando…");
  var c = await copiarA(lista, dest);
  if (c.error) return status("No se pudo copiar: " + errMsg(c.error), true);
  var u = await sb
    .from("comision")
    .update({ estado: PASA })
    .in(
      "id",
      lista.map(function (n) {
        return n.id;
      }),
    );
  if (u.error) return status("Se copiaron, pero no se pudieron marcar los originales: " + errMsg(u.error), true);
  lista.forEach(function (n) {
    n.estado = PASA;
  });
  abiertos[dest] = true;
  pintar();
  avisar("Pasaron " + lista.length + " a la comisión del " + fmtDate(dest) + " ✓");
}

async function borrar(n) {
  if (!confirm("¿Borrar esta anotación? Va a la Papelera y se puede restaurar desde ahí.")) return;
  var res = await borrarFila("comision", n.id);
  if (res.error) return status("No se pudo borrar: " + errMsg(res.error), true);
  notas = notas.filter(function (x) {
    return x.id !== n.id;
  });
  pintar();
}

// ---------- Archivo ----------
async function archivarSesion(s, lista) {
  var pend = lista.filter(function (n) {
    return n.tipo !== "en" && n.estado === "Pendiente";
  }).length;
  var msg =
    "¿Archivar la comisión del " +
    fmtDate(s.fecha) +
    " con sus " +
    lista.length +
    (lista.length === 1 ? " anotación" : " anotaciones") +
    "?" +
    (pend
      ? "\n\nTiene " + pend + (pend === 1 ? " tema" : " temas") + " Pendiente" + (pend === 1 ? "" : "s") + ". Si querés conservarlos a la vista, pasalos antes a la próxima."
      : "") +
    "\n\nSe puede recuperar desde «Ver archivo».";
  if (!confirm(msg)) return;
  status("Archivando…");
  var r = s.id
    ? await sb.from("comisiones_fechas").update({ archivada: true }).eq("id", s.id)
    : await sb.from("comisiones_fechas").insert({ fecha: s.fecha, archivada: true });
  if (r.error) return status("No se pudo archivar: " + errMsg(r.error), true);
  await recargar();
  avisar("Comisión archivada ✓");
}

async function desarchivarSesion(s) {
  var r = await sb.from("comisiones_fechas").update({ archivada: false }).eq("id", s.id);
  if (r.error) return status("No se pudo desarchivar: " + errMsg(r.error), true);
  abiertos[s.fecha] = true;
  await recargar();
  avisar("Comisión desarchivada ✓");
}

async function archivarSueltas(lista) {
  if (!confirm("¿Archivar las " + lista.length + " anotaciones sin comisión?\n\nSe pueden recuperar desde «Ver archivo».")) return;
  var r = await sb
    .from("comision")
    .update({ archivada: true })
    .in(
      "id",
      lista.map(function (n) {
        return n.id;
      }),
    );
  if (r.error) return status("No se pudo archivar: " + errMsg(r.error), true);
  await recargar();
  avisar("Archivadas ✓");
}

// Archiva de una vez todas las comisiones cuya fecha ya pasó.
async function archivarPasadas() {
  var ps = pasadasActivas();
  if (!ps.length) return;
  var temas = notas.filter(function (n) {
    return !n.archivada && ps.some(function (s) {
      return s.fecha === n.fecha;
    });
  }).length;
  var pend = notas.filter(function (n) {
    return !n.archivada && n.tipo !== "en" && n.estado === "Pendiente" && ps.some(function (s) {
      return s.fecha === n.fecha;
    });
  }).length;
  var msg =
    "¿Archivar las " + ps.length + (ps.length === 1 ? " comisión pasada" : " comisiones pasadas") + " (" + temas + " anotaciones)?" +
    (pend ? "\n\nHay " + pend + " temas Pendientes en ellas: si querés conservarlos a la vista, pasalos antes a la próxima." : "") +
    "\n\nSe pueden recuperar desde «Ver archivo».";
  if (!confirm(msg)) return;
  status("Archivando…");
  var conId = ps
      .filter(function (s) {
        return s.id;
      })
      .map(function (s) {
        return s.id;
      }),
    virtuales = ps.filter(function (s) {
      return !s.id;
    });
  if (conId.length) {
    var r = await sb.from("comisiones_fechas").update({ archivada: true }).in("id", conId);
    if (r.error) return status("No se pudo archivar: " + errMsg(r.error), true);
  }
  if (virtuales.length) {
    var v = await sb.from("comisiones_fechas").insert(
      virtuales.map(function (s) {
        return { fecha: s.fecha, archivada: true };
      }),
    );
    if (v.error) return status("No se pudo archivar: " + errMsg(v.error), true);
  }
  await recargar();
  avisar(ps.length + (ps.length === 1 ? " comisión archivada ✓" : " comisiones archivadas ✓"));
}

// ---------- Fechas de comisión (alta / edición / baja) ----------
function modalFecha(s) {
  var inF = el("input", { type: "date", value: s ? s.fecha : "" });
  var inN = el("input", { type: "text", maxlength: "200", placeholder: "Sala, horario, virtual…", value: s ? s.nota : "" });
  var err = el("p", { class: "err" });
  async function guardarFecha() {
    err.textContent = "";
    var f = inF.value,
      nota = inN.value.trim() || null;
    if (!f) return (err.textContent = "Elegí una fecha.");
    var existe = fechas.some(function (x) {
      return x.fecha === f && (!s || x.id !== s.id);
    });
    if (existe) return (err.textContent = "Ya existe una comisión con esa fecha.");
    var r;
    if (!s) r = await sb.from("comisiones_fechas").insert({ fecha: f, nota: nota });
    else {
      r = await sb.from("comisiones_fechas").update({ fecha: f, nota: nota }).eq("id", s.id);
      if (!r.error && f !== s.fecha) {
        // los temas de esa comisión se mudan con ella
        r = await sb.from("comision").update({ fecha: f }).eq("fecha", s.fecha);
      }
    }
    if (r.error) return (err.textContent = "No se pudo guardar: " + errMsg(r.error));
    cerrarModal();
    abiertos[f] = true;
    await recargar();
    llenarSesiones(true);
  }
  var hijos = [el("h3", {}, s ? "Editar comisión" : "Nueva fecha de comisión"), el("label", {}, "Fecha"), inF, el("label", {}, "Nota (opcional)"), inN];
  if (s) hijos.push(el("p", { class: "note" }, "Si cambiás la fecha, los temas de esta comisión se pasan a la fecha nueva."));
  hijos.push(
    err,
    el(
      "div",
      { class: "modal-actions" },
      el("button", { type: "button", onclick: guardarFecha }, "Guardar"),
      el("button", { type: "button", class: "ghost", onclick: cerrarModal }, "Cancelar"),
    ),
  );
  abrirModal(hijos);
  inF.focus();
}

async function borrarSesion(s) {
  if (!confirm("¿Borrar la comisión del " + fmtDate(s.fecha) + "? Va a la Papelera.")) return;
  var res = await borrarFila("comisiones_fechas", s.id);
  if (res.error) return status("No se pudo borrar: " + errMsg(res.error), true);
  await recargar();
  llenarSesiones(true);
}

// ---------- Del acuerdo a la tarea (Seguimiento) ----------
function modalTarea(n) {
  var obs = el("textarea", { rows: "4" });
  obs.value = n.observacion || "";
  var exp = el("input", { type: "text", maxlength: "200", value: n.expediente || "" });
  var resp = el("select", {}, el("option", { value: "" }, ""));
  RESPONSABLES.forEach(function (r) {
    resp.append(el("option", { value: r }, r));
  });
  var nota = el("input", {
    type: "text",
    value: n.fecha ? "Surgió en la comisión del " + fmtDate(n.fecha) : "Surgió en comisión",
  });
  var err = el("p", { class: "err" });
  var btn = el("button", { type: "button" }, "Crear tarea");
  btn.addEventListener("click", async function () {
    err.textContent = "";
    if (!obs.value.trim()) return (err.textContent = "Escribí qué hay que hacer.");
    btn.disabled = true;
    var t = await sb
      .from("seguimiento")
      .insert({
        fecha: today(),
        expediente: exp.value.trim() || null,
        observaciones: obs.value.trim(),
        responsable: resp.value || null,
        estado: "Pendiente",
        notas: nota.value.trim() || null,
      })
      .select("id")
      .single();
    if (t.error) {
      btn.disabled = false;
      return (err.textContent = "No se pudo crear la tarea: " + errMsg(t.error));
    }
    var v = await sb.from("comision").update({ tarea_id: t.data.id }).eq("id", n.id);
    cerrarModal();
    if (v.error) {
      status(
        "La tarea se creó en Seguimiento (N° " + t.data.id + "), pero no se pudo vincular a esta anotación: " + errMsg(v.error) +
          ". ¿Corriste supabase/comision.sql?",
        true,
      );
      return;
    }
    n.tarea_id = t.data.id;
    pintar();
    avisar("Tarea creada en Seguimiento ✓");
  });
  abrirModal([
    el("h3", {}, "Crear tarea en Seguimiento"),
    el("label", {}, "Qué hay que hacer"),
    obs,
    el("label", {}, "Expediente"),
    exp,
    el("label", {}, "Responsable"),
    resp,
    el("label", {}, "Notas"),
    nota,
    err,
    el("div", { class: "modal-actions" }, btn, el("button", { type: "button", class: "ghost", onclick: cerrarModal }, "Cancelar")),
  ]);
  obs.focus();
}

// ---------- Exportar a Excel ----------
function exportarXlsx() {
  if (!window.XLSX) return status("No se cargó la librería de Excel.", true);
  var filas = [["Comisión", "Tipo", "Categoría", "Expte. / Proyecto", "Observación", "Estado", "Archivada"]];
  notas
    .slice()
    .sort(function (a, b) {
      return (b.fecha || "9999").localeCompare(a.fecha || "9999") || a.id - b.id;
    })
    .forEach(function (n) {
      filas.push([
        n.fecha ? fmtDate(n.fecha) : "",
        n.tipo === "en" ? "En comisión" : "Para comisión",
        n.categoria || "",
        n.expediente || "",
        n.observacion || "",
        n.estado || "",
        archivada(n) ? "Sí" : "",
      ]);
    });
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), "Comisión");
  XLSX.writeFile(wb, "comision-" + today() + ".xlsx");
}
