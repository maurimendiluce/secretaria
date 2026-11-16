// Panel de estadísticas simples de una pestaña (ver `stats` en tablas.js).
// Se calcula sobre las filas que se están viendo (búsqueda y filtros): para ver un año, un departamento o un responsable, se filtra y el panel se actualiza.

import { el } from "./core.js";

function nf(n, dec) {
  return n.toLocaleString("es-AR", { maximumFractionDigits: dec || 0 });
}

function pct(n, total) {
  return total ? Math.round((n * 100) / total) : 0;
}

function idx(cols, k) {
  return cols.findIndex(function (c) {
    return c.i === k;
  });
}

// Tarjeta con barras horizontales. items: [[etiqueta, cantidad]]
function barras(titulo, items, total) {
  var max = Math.max.apply(
    null,
    items
      .map(function (x) {
        return x[1];
      })
      .concat([1]),
  );
  var filas = items.map(function (x) {
    return el(
      "div",
      { class: "stat-row" },
      el("span", { class: "stat-lab", title: x[0] }, x[0]),
      el("span", { class: "stat-bar" }, el("i", { style: "width:" + (x[1] * 100) / max + "%" })),
      el("span", { class: "stat-n" }, String(x[1]), el("small", {}, " · " + pct(x[1], total) + "%")),
    );
  });
  return el("div", { class: "stat-card" }, el("h4", {}, titulo), filas.length ? filas : el("p", { class: "note" }, "Sin datos"));
}

// Filas por valor de una columna, en el orden de sus opciones; los valores que no figuran van después y «(sin dato)» al final.
function porValor(cols, filas, c) {
  var i = idx(cols, c.col);
  if (i < 0) return null;
  var col = cols[i],
    cuenta = {},
    sin = 0;
  filas.forEach(function (r) {
    var v = r.v[i];
    if (!v) sin++;
    else cuenta[v] = (cuenta[v] || 0) + 1;
  });
  var orden = (col.options || []).slice();
  Object.keys(cuenta)
    .sort()
    .forEach(function (v) {
      if (orden.indexOf(v) < 0) orden.push(v);
    });
  var items = orden
    .filter(function (v) {
      return c.ceros || cuenta[v];
    })
    .map(function (v) {
      return [(col.optionLabels && col.optionLabels[v]) || v, cuenta[v] || 0];
    });
  if (sin) items.push(["(sin dato)", sin]);
  return barras(c.titulo, items, filas.length);
}

// Filas por año de una fecha, del más viejo al más nuevo; «Sin fecha» al final.
function porAnio(cols, filas, c) {
  var i = idx(cols, c.col);
  if (i < 0) return null;
  var cuenta = {},
    sin = 0;
  filas.forEach(function (r) {
    var v = r.v[i];
    if (!v) sin++;
    else {
      var y = v.slice(0, 4);
      cuenta[y] = (cuenta[y] || 0) + 1;
    }
  });
  var items = Object.keys(cuenta)
    .sort()
    .map(function (y) {
      return [y, cuenta[y]];
    });
  if (sin) items.push(["Sin fecha", sin]);
  return barras(c.titulo, items, filas.length);
}

function dias(desde, hasta) {
  var a = desde.split("-"),
    b = hasta.split("-");
  return Math.round((Date.UTC(+b[0], +b[1] - 1, +b[2]) - Date.UTC(+a[0], +a[1] - 1, +a[2])) / 86400000);
}

// Tiempo entre dos fechas (promedio, mediana, mínimo y máximo) en las filas que tienen las dos.
function duracion(cols, filas, c) {
  var i = idx(cols, c.desde),
    j = idx(cols, c.hasta);
  if (i < 0 || j < 0) return null;
  var ds = [];
  filas.forEach(function (r) {
    if (!r.v[i] || !r.v[j]) return;
    var d = dias(r.v[i], r.v[j]);
    if (d >= 0) ds.push(d);
  });
  var card = el("div", { class: "stat-card" }, el("h4", {}, c.titulo));
  if (!ds.length) {
    card.append(el("p", { class: "note" }, "Todavía no hay filas con las dos fechas."));
    return card;
  }
  ds.sort(function (a, b) {
    return a - b;
  });
  var suma = ds.reduce(function (a, b) {
      return a + b;
    }, 0),
    n = ds.length,
    med = n % 2 ? ds[(n - 1) / 2] : (ds[n / 2 - 1] + ds[n / 2]) / 2,
    prom = suma / n;
  function fila(rotulo, d) {
    return el(
      "div",
      { class: "stat-dur" },
      el("span", {}, rotulo),
      el("b", {}, nf(d) + (Math.round(d) === 1 ? " día" : " días")),
      el("small", {}, " ≈ " + nf(d / 30.4, 1) + " meses"),
    );
  }
  card.append(fila("Promedio", prom), fila("Mediana", med), fila("Más corto", ds[0]), fila("Más largo", ds[n - 1]));
  card.append(el("p", { class: "note" }, "Calculado sobre " + n + (n === 1 ? " fila" : " filas") + " con las dos fechas."));
  return card;
}

function tarjeta(titulo, n, total) {
  return el(
    "div",
    { class: "stat-tile" },
    el("b", {}, String(n)),
    el("span", {}, titulo),
    total != null ? el("small", {}, pct(n, total) + "%") : null,
  );
}

// cfg: `stats` de la pestaña; cols: columnas; filas: filas que se ven; totalTabla: cantidad de filas de la pestaña
export function construirEstadisticas(cfg, cols, filas, totalTabla) {
  var n = filas.length;
  var aviso =
    n === totalTabla
      ? "Sobre las " + n + " filas."
      : "Sobre " + n + " de " + totalTabla + " filas (según la búsqueda y los filtros que están aplicados).";
  var tiles = [tarjeta("Total", n)];
  (cfg.resumen || []).forEach(function (r) {
    var i = idx(cols, r.col);
    if (i < 0) return;
    var k = filas.filter(function (f) {
      return r.valores.indexOf(f.v[i]) >= 0;
    }).length;
    tiles.push(tarjeta(r.titulo, k, n));
  });
  var tarjetas = [];
  (cfg.cuentas || []).forEach(function (c) {
    tarjetas.push(porValor(cols, filas, c));
  });
  (cfg.anios || []).forEach(function (c) {
    tarjetas.push(porAnio(cols, filas, c));
  });
  if (cfg.duracion) tarjetas.push(duracion(cols, filas, cfg.duracion));
  return el(
    "section",
    { class: "stats", id: "stats" },
    el("h3", {}, "Estadísticas"),
    el("p", { class: "note" }, aviso),
    el("div", { class: "stat-tiles" }, tiles),
    n ? el("div", { class: "stat-grid" }, tarjetas.filter(Boolean)) : el("p", { class: "note" }, "No hay filas para mostrar."),
  );
}
