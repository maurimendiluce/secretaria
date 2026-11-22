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

// `detalle`: texto chico debajo (por defecto, el porcentaje sobre `total`)
function tarjeta(titulo, n, total, detalle) {
  return el(
    "div",
    { class: "stat-tile" },
    el("b", {}, String(n)),
    el("span", {}, titulo),
    detalle ? el("small", {}, detalle) : total != null ? el("small", {}, pct(n, total) + "%") : null,
  );
}

var SVG = "http://www.w3.org/2000/svg";

function svg(tag, attrs, hijos) {
  var e = document.createElementNS(SVG, tag);
  Object.keys(attrs || {}).forEach(function (k) {
    e.setAttribute(k, attrs[k]);
  });
  (hijos || []).forEach(function (h) {
    e.append(typeof h === "string" ? document.createTextNode(h) : h);
  });
  return e;
}

// Cambio entre dos puntos {y, prom}: flecha, clase de color y texto. Menos de 3% se considera estable.
function cambio(a, b, prefijo) {
  var d = b.prom - a.prom,
    p = a.prom ? (d * 100) / a.prom : 0,
    dat = nf(a.prom) + " días (" + a.y + ") a " + nf(b.prom) + " días (" + b.y + ")";
  if (Math.abs(p) < 3) return el("p", { class: "tend igual" }, prefijo + "→ Se mantuvo estable: de " + dat + ".");
  var baja = d < 0;
  return el(
    "p",
    { class: "tend " + (baja ? "baja" : "sube") },
    prefijo + (baja ? "↓ Bajó" : "↑ Subió") + " " + nf(Math.abs(d)) + " días (" + (baja ? "−" : "+") + nf(Math.abs(p)) + "%): de " + dat + ".",
  );
}

// Evolución del promedio: un punto por año (de la fecha «hasta»), con el promedio de los concursos que terminaron ese año.
function progresion(cols, filas, c) {
  var i = idx(cols, c.desde),
    j = idx(cols, c.hasta);
  if (i < 0 || j < 0) return null;
  var por = {};
  filas.forEach(function (r) {
    if (!r.v[i] || !r.v[j]) return;
    var d = dias(r.v[i], r.v[j]);
    if (d < 0) return;
    var y = r.v[j].slice(0, 4);
    (por[y] = por[y] || []).push(d);
  });
  var pts = Object.keys(por)
    .sort()
    .map(function (y) {
      var ds = por[y];
      return {
        y: +y,
        n: ds.length,
        prom:
          ds.reduce(function (a, b) {
            return a + b;
          }, 0) / ds.length,
      };
    });
  var card = el("div", { class: "stat-card stat-wide" }, el("h4", {}, c.titulo));
  if (!pts.length) {
    card.append(el("p", { class: "note" }, "Todavía no hay filas con las dos fechas."));
    return card;
  }
  if (pts.length < 2) card.append(el("p", { class: "note" }, "Hace falta más de un año con sustanciaciones para ver si el promedio sube o baja."));
  else {
    card.append(cambio(pts[pts.length - 2], pts[pts.length - 1], "Último año: "));
    if (pts.length > 2) card.append(cambio(pts[0], pts[pts.length - 1], "Desde " + pts[0].y + ": "));
  }

  // Gráfico de líneas
  var W = 560,
    H = 190,
    L = 44,
    R = 18,
    T = 22,
    B = 30,
    ymin = pts[0].y,
    ymax = pts[pts.length - 1].y,
    top = Math.max.apply(
      null,
      pts.map(function (p) {
        return p.prom;
      }),
    ),
    tope = Math.max(top * 1.15, 1);
  // los puntos de los extremos quedan un poco adentro, para que sus etiquetas no se pisen con el eje ni se corten
  var X0 = L + 30,
    X1 = W - R - 30;
  function px(y) {
    return ymax === ymin ? (X0 + X1) / 2 : X0 + ((y - ymin) / (ymax - ymin)) * (X1 - X0);
  }
  function py(v) {
    return T + (1 - v / tope) * (H - T - B);
  }
  var g = svg("svg", { class: "stat-svg", viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": c.titulo });
  [0, 0.5, 1].forEach(function (f) {
    var v = tope * f;
    g.append(svg("line", { class: "gr", x1: L, x2: W - R, y1: py(v), y2: py(v) }), svg("text", { x: L - 6, y: py(v) + 3, "text-anchor": "end" }, [nf(v)]));
  });
  if (pts.length > 1)
    g.append(
      svg("polyline", {
        class: "ln",
        points: pts
          .map(function (p) {
            return px(p.y) + "," + py(p.prom);
          })
          .join(" "),
      }),
    );
  pts.forEach(function (p) {
    g.append(
      svg("circle", { class: "pt", cx: px(p.y), cy: py(p.prom), r: 4 }, [
        svg("title", {}, [p.y + ": " + nf(p.prom) + " días de promedio (" + p.n + (p.n === 1 ? " concurso" : " concursos") + ")"]),
      ]),
      svg("text", { class: "val", x: px(p.y), y: py(p.prom) - 9, "text-anchor": "middle" }, [nf(p.prom)]),
      svg("text", { x: px(p.y), y: H - 12, "text-anchor": "middle" }, [String(p.y)]),
      svg("text", { class: "cnt", x: px(p.y), y: H - 1, "text-anchor": "middle" }, ["(" + p.n + ")"]),
    );
  });
  card.append(g);
  card.append(
    el(
      "p",
      { class: "note" },
      "Días promedio del llamado a la sustanciación, según el año en que se sustanció (entre paréntesis, cuántos concursos). Usa las filas que se ven: si filtrás por un año queda un solo punto.",
    ),
  );
  return card;
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
    if (r.sobreRespondidas) {
      var con = filas.filter(function (f) {
        return f.v[i];
      }).length;
      tiles.push(tarjeta(r.titulo, k, n, con ? pct(k, con) + "% de los " + con + " con dato" : "sin datos"));
    } else tiles.push(tarjeta(r.titulo, k, n));
  });
  var tarjetas = [];
  (cfg.cuentas || []).forEach(function (c) {
    tarjetas.push(porValor(cols, filas, c));
  });
  (cfg.anios || []).forEach(function (c) {
    tarjetas.push(porAnio(cols, filas, c));
  });
  if (cfg.duracion) tarjetas.push(duracion(cols, filas, cfg.duracion));
  if (cfg.progresion) tarjetas.push(progresion(cols, filas, cfg.progresion));
  return el(
    "section",
    { class: "stats", id: "stats" },
    el("h3", {}, "Estadísticas"),
    el("p", { class: "note" }, aviso),
    el("div", { class: "stat-tiles" }, tiles),
    n ? el("div", { class: "stat-grid" }, tarjetas.filter(Boolean)) : el("p", { class: "note" }, "No hay filas para mostrar."),
  );
}
