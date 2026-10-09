// Pestañas de tabla (Seguimiento, Comisión, Departamentos, Secretaría, Cuentas de mail, Links): grilla, filtros, edición y Excel.

import { $, S, byText, el, errMsg, fmtDate, grow, sb, status, today } from "./core.js";
import { liveOff, unsubscribe } from "./live.js";
import { borrarFila } from "./papelera.js";
import { TABLES } from "./tablas.js";

function inGrid() {
  var a = document.activeElement;
  return !!(a && a.closest && a.closest("#grid"));
}

async function fetchTable(name) {
  var r = await sb.from(name).select("*").order("id", { ascending: true });
  if (r.error) throw r.error;
  var t = TABLES[name];
  return {
    name: name,
    cols: t.cols.map(function (c) {
      return { h: c.h, i: c.k, type: c.type, options: c.options, optionLabels: c.optionLabels };
    }),
    rows: r.data.map(function (row) {
      return {
        id: String(row.id),
        by: byText(row),
        v: t.cols.map(function (c) {
          return row[c.k] == null ? "" : String(row[c.k]);
        }),
      };
    }),
  };
}

export async function open(name) {
  S.tab = name;
  liveOff();
  document.querySelectorAll(".tab").forEach(function (b) {
    b.classList.toggle("on", b.getAttribute("data-n") === name);
  });
  return load(true);
}

async function load(rebuildTools) {
  var name = S.tab;
  status("Cargando…");
  try {
    var d = await fetchTable(name);
    if (name !== S.tab) return;
    S.data = d;
    if (rebuildTools) tools();
    grid();
    status("");
    subscribe(name);
  } catch (e) {
    status("Error: " + errMsg(e), true);
  }
}

function subscribe(name) {
  if (S.channel && S.channel.__name === name) return;
  unsubscribe();
  S.channel = sb
    .channel("rt-" + name)
    .on("postgres_changes", { event: "*", schema: "public", table: name }, function () {
      clearTimeout(S.timer);
      S.timer = setTimeout(refresh, 400);
    })
    .subscribe();
  S.channel.__name = name;
}

export async function refresh() {
  if (!S.data) return;
  if (inGrid()) {
    S.pending = true;
    return;
  } // no pisar lo que se está escribiendo
  var name = S.tab;
  try {
    var d = await fetchTable(name);
    if (name !== S.tab || inGrid()) {
      S.pending = true;
      return;
    }
    S.data = d;
    grid();
  } catch (e) {
    /* se reintenta en el próximo cambio */
  }
}

document.addEventListener("focusout", function () {
  setTimeout(function () {
    if (S.pending && !inGrid()) {
      S.pending = false;
      refresh();
    }
  }, 250);
});

//setInterval(function () { if (!document.hidden && S.data) refresh(); }, 60000); // respaldo por si se corta la conexión en vivo

setInterval(function () {
  if (!document.hidden && S.data && S.tab !== "formulario" && S.tab !== "borradores" && S.tab !== "notas") {
    refresh();
  }
}, 60000);

// ---------- Tabla ----------
function colIdx(h) {
  return S.data.cols.findIndex(function (c) {
    return c.h.toLowerCase() === h;
  });
}

function tools() {
  var items = [];
  if (TABLES[S.tab].counters) {
    items.push(
      el(
        "div",
        { class: "counters", id: "counters" },
        TABLES[S.tab].counters.map(function (c, n) {
          return el("button", {
            type: "button",
            class: "counter st-" + c.value.replace(/\s/g, ""),
            "data-n": n,
            title: "Mostrar solo: " + c.value,
            onclick: function () {
              filtrarPorContador(c);
            },
          });
        }),
      ),
    );
  }
  items.push(el("input", { type: "search", id: "q", placeholder: "Buscar…", oninput: filter }));
  // Filtros de selección múltiple. Al entrar a la pestaña arrancan con los valores de filterDefaults (si los hay).
  var defs = TABLES[S.tab].filterDefaults || {};
  S.sel = {};
  (TABLES[S.tab].filters || []).forEach(function (k) {
    var i = S.data.cols.findIndex(function (c) {
      return c.i === k;
    });
    if (i < 0) return;
    if (defs[k]) S.sel[i] = defs[k].slice();
    items.push(
      el(
        "div",
        { class: "mf", "data-i": i },
        el("button", {
          type: "button",
          class: "ghost mf-btn",
          onclick: function (ev) {
            toggleMF(ev.currentTarget.parentNode);
          },
        }),
        el("div", { class: "mf-pop", hidden: "" }),
      ),
    );
  });
  items.push(el("button", { onclick: add }, "+ Nueva fila"));
  items.push(
    el(
      "button",
      {
        class: "ghost",
        onclick: function () {
          load(false);
        },
      },
      "Recargar",
    ),
  );
  items.push(el("button", { class: "ghost", onclick: exportXlsx }, "Exportar a Excel"));
  items.push(el("span", { class: "count", id: "count" }));
  $("tools").replaceChildren.apply($("tools"), items);
}

// ---------- Filtros de selección múltiple ----------
function closeMFs() {
  document.querySelectorAll(".mf-pop").forEach(function (p) {
    p.hidden = true;
  });
}

function toggleMF(mf) {
  var pop = mf.querySelector(".mf-pop"),
    wasHidden = pop.hidden;
  closeMFs();
  pop.hidden = !wasHidden;
}

document.addEventListener("click", function (ev) {
  if (!ev.target.closest || !ev.target.closest(".mf")) closeMFs();
});

document.addEventListener("keydown", function (ev) {
  if (ev.key === "Escape") closeMFs();
});

function optLabel(c, v) {
  return c.type === "date" ? fmtDate(v) : (c.optionLabels && c.optionLabels[v]) || v;
}

function mfLabel(mf, i) {
  var c = S.data.cols[i],
    vals = S.sel[i] || [];
  var txt = !vals.length
    ? "todos"
    : vals.length <= 2
      ? vals
          .map(function (v) {
            return optLabel(c, v);
          })
          .join(", ")
      : vals.length + " seleccionados";
  var btn = mf.querySelector(".mf-btn");
  btn.textContent = c.h + ": " + txt + " ▾";
  btn.classList.toggle("on", vals.length > 0);
}

function onMFChange(mf, i) {
  S.sel[i] = Array.prototype.map.call(mf.querySelectorAll(".mf-pop input:checked"), function (x) {
    return x.value;
  });
  mfLabel(mf, i);
  filter();
}

function clearMF(mf, i) {
  S.sel[i] = [];
  mf.querySelectorAll(".mf-pop input").forEach(function (x) {
    x.checked = false;
  });
  mfLabel(mf, i);
  filter();
}

// ---------- Contadores (Pendientes / En proceso) ----------
// Cuentan todas las filas de la pestaña, sin importar filtros ni búsqueda.
function contadores() {
  var box = $("counters");
  if (!box || !S.data) return;
  TABLES[S.tab].counters.forEach(function (c, n) {
    var i = S.data.cols.findIndex(function (x) {
      return x.i === c.col;
    });
    var total = S.data.rows.filter(function (r) {
      return r.v[i] === c.value;
    }).length;
    var b = box.querySelector('[data-n="' + n + '"]');
    if (b) b.replaceChildren(c.label + " ", el("b", {}, String(total)));
  });
}

// Clic en un contador: el filtro de esa columna queda solo con ese valor.
function filtrarPorContador(c) {
  var i = S.data.cols.findIndex(function (x) {
    return x.i === c.col;
  });
  if (i < 0) return;
  S.sel[i] = [c.value];
  fillFilters();
  filter();
}

function grid() {
  var d = S.data,
    rows = d.rows.slice();
  var di = d.cols.findIndex(function (c) {
    return c.type === "date";
  });
  if (di >= 0)
    rows.reverse().sort(function (a, b) {
      return a.v[di] < b.v[di] ? 1 : a.v[di] > b.v[di] ? -1 : 0;
    }); // más nuevo arriba
  else rows.reverse();
  var tb = el("tbody");
  rows.forEach(function (r) {
    tb.append(rowEl(r));
  });
  var head = el("tr");
  d.cols.forEach(function (c) {
    head.append(el("th", {}, c.h));
  });
  head.append(el("th"));
  $("grid").replaceChildren(el("table", {}, el("thead", {}, head), tb));
  document.querySelectorAll("#grid textarea").forEach(grow);
  fillFilters();
  filter();
  contadores();
}

// Completa las casillas de cada filtro: las fechas salen de los datos (se actualizan solas), el resto de las opciones de la columna.
function fillFilters() {
  document.querySelectorAll("#tools .mf").forEach(function (mf) {
    var i = +mf.getAttribute("data-i"),
      c = S.data.cols[i],
      opts;
    if (c.type === "date") {
      var seen = {};
      S.data.rows.forEach(function (r) {
        if (r.v[i]) seen[r.v[i]] = 1;
      });
      opts = Object.keys(seen)
        .sort()
        .reverse()
        .map(function (v) {
          return [v, fmtDate(v)];
        });
    } else {
      opts = (c.options || []).map(function (o) {
        return [o, (c.optionLabels && c.optionLabels[o]) || o];
      });
    }
    // Se descartan selecciones que ya no existen (por ejemplo, una fecha que ya no tiene filas)
    S.sel[i] = (S.sel[i] || []).filter(function (v) {
      return opts.some(function (o) {
        return o[0] === v;
      });
    });
    var pop = mf.querySelector(".mf-pop");
    if (pop.hidden) {
      // si el menú está abierto no se toca, para no cambiarlo mientras se usa
      var sel = S.sel[i];
      pop.replaceChildren.apply(
        pop,
        opts
          .map(function (o) {
            var cb = el("input", { type: "checkbox", value: o[0] });
            cb.checked = sel.indexOf(o[0]) >= 0;
            cb.addEventListener("change", function () {
              onMFChange(mf, i);
            });
            return el("label", { class: "mf-opt" }, cb, o[1]);
          })
          .concat([
            el(
              "button",
              {
                type: "button",
                class: "mf-clear",
                onclick: function () {
                  clearMF(mf, i);
                },
              },
              "Mostrar todos",
            ),
          ]),
      );
    }
    mfLabel(mf, i);
  });
}

function rowEl(r) {
  var d = S.data,
    tr = el("tr", { "data-id": r.id, title: r.by ? "Editado por " + r.by : "" });
  var ei = colIdx("estado");
  if (ei >= 0 && r.v[ei]) tr.className = "st-" + r.v[ei].replace(/\s/g, "");
  d.cols.forEach(function (c, k) {
    var inp;
    if (c.type === "select") {
      inp = el("select", {}, el("option", { value: "" }, ""));
      c.options.forEach(function (o) {
        inp.append(el("option", { value: o }, (c.optionLabels && c.optionLabels[o]) || o));
      });
      if (r.v[k] && c.options.indexOf(r.v[k]) < 0) inp.append(el("option", { value: r.v[k] }, r.v[k]));
    } else if (c.type === "date") inp = el("input", { type: "date" });
    else {
      inp = el("textarea", { rows: "1" });
      inp.addEventListener("input", function () {
        grow(inp);
      });
    }
    inp.value = r.v[k];
    inp.addEventListener("change", function () {
      save(r, k, c, inp, tr);
    });
    tr.append(el("td", {}, inp));
  });
  tr.append(
    el(
      "td",
      { class: "act" },
      el(
        "button",
        {
          class: "del",
          title: "Borrar fila",
          onclick: function () {
            del(r);
          },
        },
        "✕",
      ),
    ),
  );
  return tr;
}

// Se guarda solo la celda modificada: dos personas editando celdas distintas no se pisan.
async function save(r, k, c, inp, tr) {
  status("Guardando…");
  var v = inp.value === "" ? null : inp.value,
    patch = {};
  patch[c.i] = v;
  var res = await sb.from(S.tab).update(patch).eq("id", r.id).select("updated_by,updated_at").single();
  if (res.error) return status("No se pudo guardar: " + errMsg(res.error), true);
  r.v[k] = inp.value;
  contadores();
  r.by = byText(res.data);
  tr.title = "Editado por " + r.by;
  if (c.h.toLowerCase() === "estado") tr.className = inp.value ? "st-" + inp.value.replace(/\s/g, "") : "";
  status("Guardado ✓");
  setTimeout(function () {
    if ($("status") && $("status").textContent === "Guardado ✓") status("");
  }, 1500);
}

async function add() {
  status("Creando…");
  var res = await sb.from(S.tab).insert(TABLES[S.tab].defaults()).select("id").single();
  if (res.error) return status("No se pudo crear: " + errMsg(res.error), true);
  await load(false);
  revealRow(res.data.id);
  var tr = document.querySelector('#grid tr[data-id="' + res.data.id + '"]');
  var f = tr && tr.querySelector("input,textarea,select");
  if (f) f.focus();
}

// Si algún filtro (o la búsqueda) oculta la fila recién creada, se quita ese filtro para que no desaparezca.
function revealRow(id) {
  var r = S.data.rows.find(function (x) {
    return String(x.id) === String(id);
  });
  if (!r) return;
  var cleared = [];
  Object.keys(S.sel).forEach(function (i) {
    if (S.sel[i].length && S.sel[i].indexOf(r.v[i]) < 0) {
      S.sel[i] = [];
      cleared.push(S.data.cols[i].h);
    }
  });
  var q = $("q");
  if (q && q.value && r.v.join(" ").toLowerCase().indexOf(q.value.toLowerCase()) < 0) {
    q.value = "";
    cleared.push("búsqueda");
  }
  if (!cleared.length) return;
  fillFilters();
  filter();
  status("Se quitó el filtro de " + cleared.join(", ") + " para mostrar la fila nueva.");
  setTimeout(function () {
    if ($("status") && /para mostrar la fila nueva/.test($("status").textContent)) status("");
  }, 4000);
}

async function del(r) {
  if (!confirm("¿Borrar esta fila? Va a la Papelera y se puede restaurar desde ahí.")) return;
  var res = await borrarFila(S.tab, r.id);
  if (res.error) return status("No se pudo borrar: " + errMsg(res.error), true);
  await load(false);
}

function filter() {
  var q = (($("q") && $("q").value) || "").toLowerCase();
  // Cada filtro es una lista de valores permitidos: la fila se muestra si su valor está en la lista (lista vacía = sin filtro)
  var active = Object.keys(S.sel)
    .filter(function (i) {
      return S.sel[i].length;
    })
    .map(function (i) {
      return { i: +i, v: S.sel[i] };
    });
  var byId = {};
  S.data.rows.forEach(function (r) {
    byId[r.id] = r;
  });
  var shown = 0;
  document.querySelectorAll("#grid tbody tr").forEach(function (tr) {
    var r = byId[tr.getAttribute("data-id")];
    if (!r) return;
    var ok =
      (!q || r.v.join(" ").toLowerCase().indexOf(q) >= 0) &&
      active.every(function (f) {
        return f.v.indexOf(r.v[f.i]) >= 0;
      });
    tr.style.display = ok ? "" : "none";
    if (ok) shown++;
  });
  var cnt = $("count");
  if (cnt) cnt.textContent = "Mostrando " + shown + " de " + S.data.rows.length;
}

// ---------- Exportar a Excel (todas las pestañas) ----------
async function exportXlsx() {
  if (!window.XLSX) return status("No se cargó la librería de Excel.", true);
  status("Exportando…");
  try {
    var wb = XLSX.utils.book_new();
    for (var name of Object.keys(TABLES)) {
      var d = await fetchTable(name);
      var aoa = [
        d.cols
          .map(function (c) {
            return c.h;
          })
          .concat(["Editado"]),
      ];
      d.rows.forEach(function (r) {
        aoa.push(r.v.concat([r.by]));
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), TABLES[name].label.slice(0, 31));
    }
    XLSX.writeFile(wb, "seguimiento-" + today() + ".xlsx");
    status("");
  } catch (e) {
    status("No se pudo exportar: " + errMsg(e), true);
  }
}
