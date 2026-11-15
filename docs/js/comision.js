// Solapa Comisión: los temas se agrupan por reunión (tablas "comisiones_fechas" y "comision").
//  - Carga rápida arriba: se escribe un tema, Enter, y queda en la comisión elegida (por defecto la próxima).
//  - Cada comisión es un bloque: "Para tratar" (tipo para) y "Anotado en la comisión" (tipo en).
//  - Estados: Pendiente / Tratado / Pasa a la próxima. "Pasa a la próxima" copia el tema a la comisión siguiente.
//  - Los acuerdos anotados en comisión se pueden convertir en una tarea de Seguimiento.
// Cambios en vivo entre usuarios, igual que las demás solapas.

import { $, S, abrirModal, byText, cerrarModal, el, errMsg, fmtDate, grow, normalizar, sb, status, today } from "./core.js";
import { leaveGrid, liveOn } from "./live.js";
import { borrarFila, tablaFaltante } from "./papelera.js";
import { open as abrirPlanilla } from "./planilla.js";
import { ESTADOS_COMISION, RESPONSABLES } from "./tablas.js";

var PASA = "Pasa a la próxima";
var ESTADOS_EN = ["Pendiente", "Tratado"]; // para lo anotado en comisión no tiene sentido "Pasa a la próxima"

var notas = []; // filas de "comision"
var fechas = []; // filas de "comisiones_fechas"
var busqueda = "";
var filtroEstado = null;
var abiertos = {}; // bloque -> abierto o cerrado, según lo que eligió la persona
var pendiente = false;
var selTipo, selSesion, inExpte, inObs;

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
    m[f.fecha] = { fecha: f.fecha, id: f.id, nota: f.nota || "" };
  });
  notas.forEach(function (n) {
    if (n.fecha && !m[n.fecha]) m[n.fecha] = { fecha: n.fecha, id: null, nota: "", virtual: true };
  });
  return Object.keys(m)
    .sort()
    .map(function (k) {
      return m[k];
    });
}

function proximaFecha(ses) {
  var hoy = today();
  var s = ses.find(function (x) {
    return x.fecha >= hoy;
  });
  return s ? s.fecha : null;
}

// Fecha de la comisión que sigue a `f` (si no hay fecha, la próxima).
function siguienteFecha(f) {
  var ses = listaSesiones();
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
  var a = await traer("comision"),
    b = await traer("comisiones_fechas");
  if (S.tab !== "comision") return;
  if (a.error) return status("Error: " + errMsg(a.error), true);
  if (b.error) {
    if (tablaFaltante(b.error, "comisiones_fechas")) {
      $("cm-wrap").replaceChildren(
        el(
          "p",
          { class: "note" },
          "Falta crear la tabla «comisiones_fechas» en Supabase. Corré el archivo supabase/comision.sql en el SQL Editor y recargá esta página.",
        ),
      );
      return status("");
    }
    return status("Error: " + errMsg(b.error), true);
  }
  notas = a.data;
  fechas = b.data;
  llenarSesiones(true);
  pintar();
  liveOn("comision", ["comision", "comisiones_fechas"], refrescar);
  status("");
}

// Vuelve a pedir los datos y redibuja, sin preguntar nada.
async function recargar() {
  var a = await traer("comision"),
    b = await traer("comisiones_fechas");
  if (S.tab !== "comision" || !$("cm-wrap") || a.error || b.error) return;
  notas = a.data;
  fechas = b.data;
  llenarSesiones(false);
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
  var a = await traer("comision"),
    b = await traer("comisiones_fechas");
  if (S.tab !== "comision" || !$("cm-wrap") || a.error || b.error) return;
  if (hayEdicion()) {
    pendiente = true;
    return;
  }
  notas = a.data;
  fechas = b.data;
  llenarSesiones(false);
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
  inExpte = el("input", { placeholder: "Expte. (opcional)", maxlength: "200", "aria-label": "Expediente", class: "cm-expte" });
  inObs = el("input", {
    placeholder: "Anotá un tema y apretá Enter…",
    maxlength: "2000",
    "aria-label": "Tema u observación",
    class: "cm-obs-in",
  });
  var form = el(
    "form",
    { class: "cm-quick", autocomplete: "off", onsubmit: agregarRapida },
    selTipo,
    selSesion,
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
  $("tools").replaceChildren(
    form,
    el("div", { class: "counters", id: "cm-counters" }),
    buscar,
    el("button", { type: "button", onclick: function () { modalFecha(null); } }, "+ Fecha de comisión"),
    el("button", { type: "button", class: "ghost", onclick: recargar }, "Recargar"),
    el("button", { type: "button", class: "ghost", onclick: exportarXlsx }, "Exportar a Excel"),
  );
}

// Completa las comisiones del desplegable de la carga rápida. `reset`: volver a elegir la sugerida.
function llenarSesiones(reset) {
  if (!selSesion) return;
  var ses = listaSesiones(),
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
  var obs = inObs.value.trim();
  if (!obs) return inObs.focus();
  var tipo = selTipo.value,
    fila = {
      fecha: selSesion.value || null,
      tipo: tipo,
      expediente: inExpte.value.trim() || null,
      observacion: obs,
      estado: tipo === "para" ? "Pendiente" : null,
    };
  status("Agregando…");
  var r = await sb.from("comision").insert(fila).select("*").single();
  if (r.error) return status("No se pudo agregar: " + errMsg(r.error), true);
  notas.push(r.data);
  inObs.value = "";
  inExpte.value = "";
  abiertos[fila.fecha || "sin"] = true;
  pintar();
  avisar("Agregado ✓");
  inObs.focus();
}

function avisar(msg) {
  status(msg);
  setTimeout(function () {
    if ($("status") && $("status").textContent === msg) status("");
  }, 1800);
}

// ---------- Contadores ----------
function pintarContadores() {
  var box = $("cm-counters");
  if (!box) return;
  box.replaceChildren.apply(
    box,
    ESTADOS_COMISION.map(function (e) {
      var total = notas.filter(function (n) {
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
  var ses = listaSesiones(),
    hoy = today(),
    prox = proximaFecha(ses),
    filtrando = !!(busqueda.trim() || filtroEstado);
  var porFecha = {},
    sin = [];
  notas.forEach(function (n) {
    if (!n.fecha) sin.push(n);
    else (porFecha[n.fecha] = porFecha[n.fecha] || []).push(n);
  });
  var futuras = ses.filter(function (s) {
      return s.fecha >= hoy;
    }),
    pasadas = ses
      .filter(function (s) {
        return s.fecha < hoy;
      })
      .reverse();

  var bloques = [];
  if (sin.length) bloques.push(bloque("sin", null, sin, false, filtrando));
  futuras.concat(pasadas).forEach(function (s) {
    bloques.push(bloque(s.fecha, s, porFecha[s.fecha] || [], s.fecha === prox, filtrando));
  });
  bloques = bloques.filter(Boolean);
  if (!bloques.length) {
    bloques.push(
      el(
        "p",
        { class: "note" },
        filtrando
          ? "No hay temas que coincidan con la búsqueda o el filtro."
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

function bloque(key, s, lista, esProxima, filtrando) {
  var vis = lista.filter(visible);
  if (filtrando && !vis.length) return null;
  var hoy = today();
  var abierto = filtrando ? true : key in abiertos ? abiertos[key] : key === "sin" || esProxima;

  var titulo = s ? "Comisión del " + diaSemana(s.fecha) + " " + fmtDate(s.fecha) : "Sin comisión asignada";
  var acciones = el("span", { class: "cm-actions" });
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
  if (s && s.id) {
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
      el(
        "button",
        {
          type: "button",
          class: "del",
          title: lista.length ? "No se puede borrar: tiene temas anotados" : "Borrar esta comisión",
          disabled: lista.length ? "" : null,
          onclick: function () {
            borrarSesion(s);
          },
        },
        "✕",
      ),
    );
  }

  var badge = null;
  if (s && s.fecha === hoy) badge = el("span", { class: "cm-badge hoy" }, "Hoy");
  else if (esProxima) badge = el("span", { class: "cm-badge prox" }, "Próxima");

  var cuerpo = el("div", { class: "cm-body" });
  var para = vis.filter(function (n) {
      return n.tipo !== "en";
    }),
    en = vis.filter(function (n) {
      return n.tipo === "en";
    });
  if (s && s.nota) cuerpo.append(el("p", { class: "note cm-nota" }, s.nota));
  if (para.length || !filtrando) {
    cuerpo.append(el("h4", {}, "Para tratar"));
    cuerpo.append(
      para.length ? tabla(para, false) : el("p", { class: "note" }, "Sin temas todavía. Anotá uno arriba y Enter."),
    );
  }
  if (en.length) {
    cuerpo.append(el("h4", {}, "Anotado en la comisión"));
    cuerpo.append(tabla(en, true));
  }

  var d = el(
    "details",
    { class: "cm-block" + (esProxima ? " cm-next" : "") + (s && s.fecha < hoy ? " cm-past" : "") },
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
    if (filtrando) return;
    abiertos[key] = d.open;
    if (d.open) crecer(d);
  });
  return d;
}

// ---------- Tabla de temas ----------
function tabla(lista, esEn) {
  var head = el("tr");
  ["Categoría", "Expte. / Proyecto", "Observación", "Estado", "Comisión"].forEach(function (h) {
    head.append(el("th", {}, h));
  });
  head.append(el("th"));
  var tb = el("tbody");
  lista.forEach(function (n) {
    tb.append(fila(n, esEn));
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

function fila(n, esEn) {
  var tr = el("tr", {
    "data-id": n.id,
    class: n.estado ? "st-" + n.estado.replace(/\s/g, "") : "",
    title: n.updated_by ? "Editado por " + byText(n) : "",
  });
  tr.append(campo(n, "categoria", tr, "input"), campo(n, "expediente", tr, "area"), campo(n, "observacion", tr, "area", "cm-obs"));

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

  // Comisión (para mover el tema a otra reunión)
  var sc = el("select", {});
  listaSesiones().forEach(function (s) {
    sc.append(el("option", { value: s.fecha }, fmtDate(s.fecha)));
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
  var filas = [["Comisión", "Tipo", "Categoría", "Expte. / Proyecto", "Observación", "Estado"]];
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
      ]);
    });
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), "Comisión");
  XLSX.writeFile(wb, "comision-" + today() + ".xlsx");
}
