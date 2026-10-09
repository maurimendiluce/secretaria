// Solapa Calendario: mes, eventos (tabla "eventos"), alta/edición/baja y cambios en vivo.

import { $, S, abrirModal, cerrarModal, el, errMsg, sb, status, today } from "./core.js";
import { leaveGrid } from "./live.js";
import { borrarFila } from "./papelera.js";

// ---------- Calendario ----------
// Tabla "eventos" en Supabase (ver supabase/eventos.sql). Un evento = título + fecha + hora opcional + descripción.
var MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

var DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

var DIAS_LARGOS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

var cal = { y: 0, m: 0, start: null, weeks: 5, events: [], upcoming: [], channel: null, timer: null, tok: 0 };

function pad2(n) {
  return String(n).padStart(2, "0");
}

function isoDate(d) {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}
// fecha local (no UTC)
function parseISO(s) {
  var p = s.split("-");
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

function horaCorta(h) {
  return h ? String(h).slice(0, 5) : "";
}

function cmpEvento(a, b) {
  var ha = horaCorta(a.hora),
    hb = horaCorta(b.hora);
  return ha < hb ? -1 : ha > hb ? 1 : a.id - b.id; // primero los que no tienen hora
}

function textoEvento(e) {
  return (e.hora ? horaCorta(e.hora) + " " : "") + (e.titulo || "(Sin título)");
}

export function openCalendario() {
  S.tab = "calendario";
  document.querySelectorAll(".tab").forEach(function (b) {
    b.classList.toggle("on", b.getAttribute("data-n") === "calendario");
  });
  leaveGrid(); // en esta pestaña no hay tabla de la planilla: se frena el refresco automático

  var hoy = new Date();
  cal.y = hoy.getFullYear();
  cal.m = hoy.getMonth();

  $("tools").replaceChildren();
  $("grid").replaceChildren(
    el(
      "div",
      { class: "cal-layout" },
      el("section", { class: "cal-main", id: "cal-main" }),
      el("aside", { class: "cal-side", id: "cal-side" }),
    ),
  );

  loadCalendario();
  subscribeCalendario();
}

export async function loadCalendario(quiet) {
  var tok = ++cal.tok;
  if (!quiet) status("Cargando…");

  var first = new Date(cal.y, cal.m, 1);
  var offset = (first.getDay() + 6) % 7; // la semana empieza el lunes
  var weeks = Math.ceil((offset + new Date(cal.y, cal.m + 1, 0).getDate()) / 7);
  var start = new Date(cal.y, cal.m, 1 - offset);
  var end = new Date(cal.y, cal.m, 1 - offset + weeks * 7 - 1);

  var res = await sb
    .from("eventos")
    .select("*")
    .gte("fecha", isoDate(start))
    .lte("fecha", isoDate(end))
    .order("fecha", { ascending: true });
  var up = await sb
    .from("eventos")
    .select("*")
    .gte("fecha", today())
    .order("fecha", { ascending: true })
    .limit(10);

  if (tok !== cal.tok || S.tab !== "calendario") return; // llegó una respuesta vieja o ya cambiaste de solapa

  if (res.error || up.error) {
    var er = res.error || up.error;
    status("");
    var falta =
      er.code === "42P01" || (/eventos/.test(errMsg(er)) && /exist|relation|schema cache/i.test(errMsg(er)));
    $("cal-main").replaceChildren(
      el(
        "p",
        { class: "note" },
        falta
          ? "Falta crear la tabla «eventos» en Supabase. Corré el archivo supabase/eventos.sql en el editor SQL de Supabase y recargá esta página."
          : "No se pudieron cargar los eventos: " + errMsg(er),
      ),
    );
    $("cal-side").replaceChildren();
    return;
  }

  cal.start = start;
  cal.weeks = weeks;
  cal.events = res.data;
  cal.upcoming = up.data.slice().sort(function (a, b) {
    return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : cmpEvento(a, b);
  });
  renderCalendario();
  if (!quiet) status("");
}

function moverMes(delta) {
  var d = new Date(cal.y, cal.m + delta, 1);
  cal.y = d.getFullYear();
  cal.m = d.getMonth();
  loadCalendario();
}

function irAHoy() {
  var d = new Date();
  cal.y = d.getFullYear();
  cal.m = d.getMonth();
  loadCalendario();
}

function renderCalendario() {
  var main = $("cal-main"),
    side = $("cal-side");
  if (!main || !side) return;

  var tod = today();
  var byDay = {};
  cal.events.forEach(function (e) {
    (byDay[e.fecha] = byDay[e.fecha] || []).push(e);
  });
  Object.keys(byDay).forEach(function (k) {
    byDay[k].sort(cmpEvento);
  });

  var viendoHoy = tod.slice(0, 7) === cal.y + "-" + pad2(cal.m + 1);
  var fechaNueva = viendoHoy ? tod : cal.y + "-" + pad2(cal.m + 1) + "-01";

  var head = el(
    "div",
    { class: "cal-head" },
    el(
      "button",
      {
        class: "ghost",
        title: "Mes anterior",
        onclick: function () {
          moverMes(-1);
        },
      },
      "‹",
    ),
    el("h2", {}, MESES[cal.m] + " " + cal.y),
    el(
      "button",
      {
        class: "ghost",
        title: "Mes siguiente",
        onclick: function () {
          moverMes(1);
        },
      },
      "›",
    ),
    el("button", { class: "ghost", onclick: irAHoy }, "Hoy"),
    el(
      "button",
      {
        class: "cal-new",
        onclick: function () {
          editarEvento(null, fechaNueva);
        },
      },
      "+ Nuevo evento",
    ),
  );

  var grid = el("div", { class: "cal-grid" });
  DIAS.forEach(function (d) {
    grid.append(el("div", { class: "cal-dow" }, d));
  });

  function celda(d) {
    var iso = isoDate(d),
      list = byDay[iso] || [];
    var cell = el(
      "div",
      {
        class: "cal-cell" + (d.getMonth() !== cal.m ? " out" : "") + (iso === tod ? " today" : ""),
        "data-fecha": iso,
        onclick: function () {
          editarEvento(null, iso);
        },
      },
      el("div", { class: "cal-num" }, String(d.getDate())),
    );

    list.slice(0, 3).forEach(function (e) {
      cell.append(
        el(
          "button",
          {
            class: "cal-ev",
            title: textoEvento(e) + (e.descripcion ? "\n" + e.descripcion : ""),
            onclick: function (ev) {
              ev.stopPropagation();
              editarEvento(e);
            },
          },
          textoEvento(e),
        ),
      );
    });
    if (list.length > 3) {
      cell.append(
        el(
          "button",
          {
            class: "cal-more",
            onclick: function (ev) {
              ev.stopPropagation();
              verDia(iso);
            },
          },
          "+" + (list.length - 3) + " más",
        ),
      );
    }
    return cell;
  }

  for (var i = 0; i < cal.weeks * 7; i++) {
    grid.append(celda(new Date(cal.start.getFullYear(), cal.start.getMonth(), cal.start.getDate() + i)));
  }

  main.replaceChildren(head, grid);

  // Próximos eventos
  side.replaceChildren(
    el("h3", {}, "Próximos eventos"),
    cal.upcoming.length
      ? el(
          "div",
          { class: "cal-up" },
          cal.upcoming.map(function (e) {
            var d = parseISO(e.fecha);
            return el(
              "button",
              {
                class: "cal-up-item",
                onclick: function () {
                  editarEvento(e);
                },
              },
              el(
                "small",
                {},
                DIAS[(d.getDay() + 6) % 7] +
                  " " +
                  pad2(d.getDate()) +
                  "/" +
                  pad2(d.getMonth() + 1) +
                  (e.hora ? " · " + horaCorta(e.hora) : ""),
              ),
              el("strong", {}, e.titulo || "(Sin título)"),
            );
          }),
        )
      : el("p", { class: "note" }, "No hay eventos próximos."),
  );
}

function verDia(iso) {
  var d = parseISO(iso);
  var list = cal.events
    .filter(function (e) {
      return e.fecha === iso;
    })
    .sort(cmpEvento);
  abrirModal([
    el(
      "h3",
      {},
      DIAS_LARGOS[(d.getDay() + 6) % 7] + " " + d.getDate() + " de " + MESES[d.getMonth()].toLowerCase(),
    ),
    el(
      "div",
      { class: "cal-up" },
      list.map(function (e) {
        return el(
          "button",
          {
            class: "cal-up-item",
            onclick: function () {
              editarEvento(e);
            },
          },
          el("strong", {}, textoEvento(e)),
        );
      }),
    ),
    el(
      "div",
      { class: "modal-actions" },
      el("button", { class: "ghost", onclick: cerrarModal }, "Cerrar"),
      el(
        "button",
        {
          class: "cal-new",
          onclick: function () {
            editarEvento(null, iso);
          },
        },
        "+ Nuevo evento este día",
      ),
    ),
  ]);
}

function editarEvento(e, fecha) {
  var esNuevo = !e;

  var inT = el("input", {
    id: "ev-titulo",
    type: "text",
    placeholder: "Título del evento",
    maxlength: "200",
  });
  var inF = el("input", { id: "ev-fecha", type: "date" });
  var inH = el("input", { id: "ev-hora", type: "time" });
  var inD = el("textarea", { id: "ev-desc", rows: "4", placeholder: "Detalles (opcional)" });
  inT.value = e ? e.titulo || "" : "";
  inF.value = e ? e.fecha : fecha;
  inH.value = e ? horaCorta(e.hora) : "";
  inD.value = e ? e.descripcion || "" : "";

  var err = el("p", { class: "err", id: "ev-err" });
  var btnG = el("button", { onclick: guardar }, "Guardar");

  async function guardar() {
    var titulo = inT.value.trim();
    if (!titulo) {
      err.textContent = "Falta el título.";
      inT.focus();
      return;
    }
    if (!inF.value) {
      err.textContent = "Falta la fecha.";
      return;
    }

    var row = {
      titulo: titulo,
      fecha: inF.value,
      hora: inH.value || null,
      descripcion: inD.value.trim() || null,
    };
    btnG.disabled = true;
    err.textContent = "";

    var res = esNuevo
      ? await sb.from("eventos").insert(row)
      : await sb.from("eventos").update(row).eq("id", e.id);

    if (res.error) {
      btnG.disabled = false;
      err.textContent = "No se pudo guardar: " + errMsg(res.error);
      return;
    }

    cerrarModal();
    var d = parseISO(row.fecha);
    cal.y = d.getFullYear(); // si el evento cae en otro mes, se va a ese mes para verlo
    cal.m = d.getMonth();
    loadCalendario();
  }

  async function borrar() {
    if (!confirm("¿Eliminar este evento? Va a la Papelera y se puede restaurar desde ahí.")) return;
    var res = await borrarFila("eventos", e.id);
    if (res.error) {
      err.textContent = "No se pudo eliminar: " + errMsg(res.error);
      return;
    }
    cerrarModal();
    loadCalendario();
  }

  [inT, inF, inH].forEach(function (i) {
    i.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") guardar();
    });
  });

  abrirModal([
    el("h3", {}, esNuevo ? "Nuevo evento" : "Editar evento"),
    el("label", {}, "Título"),
    inT,
    el("label", {}, "Fecha"),
    inF,
    el("label", {}, "Hora (opcional)"),
    inH,
    el("label", {}, "Descripción"),
    inD,
    err,
    el(
      "div",
      { class: "modal-actions" },
      !esNuevo && e.updated_by
        ? el("span", { class: "draft-info" }, "Última modificación: " + e.updated_by)
        : el("span", { class: "spacer" }),
      !esNuevo ? el("button", { class: "ghost", onclick: borrar }, "Eliminar") : null,
      el("button", { class: "ghost", onclick: cerrarModal }, "Cancelar"),
      btnG,
    ),
  ]);

  inT.focus();
}

// Cambios que hace la otra persona: se recarga el mes (sin tocar un evento que se esté editando).
function subscribeCalendario() {
  if (cal.channel) {
    sb.removeChannel(cal.channel);
    cal.channel = null;
  }
  cal.channel = sb
    .channel("rt-eventos")
    .on("postgres_changes", { event: "*", schema: "public", table: "eventos" }, function () {
      if (S.tab !== "calendario") {
        sb.removeChannel(cal.channel);
        cal.channel = null;
        return;
      }
      clearTimeout(cal.timer);
      cal.timer = setTimeout(function () {
        loadCalendario(true);
      }, 400);
    })
    .subscribe();
}
