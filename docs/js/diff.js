// Comparación de textos palabra por palabra, para mostrar una sugerencia como un control de cambios:
// lo agregado en verde y lo quitado en rojo y tachado.

import { el } from "./core.js";

function tokens(s) {
  return String(s || "")
    .split(/(\s+)/)
    .filter(function (x) {
      return x !== "";
    });
}

function juntar(out, t, s) {
  if (!s) return;
  var u = out[out.length - 1];
  if (u && u.t === t) u.s += s;
  else out.push({ t: t, s: s });
}

// Subsecuencia común más larga entre dos listas de palabras.
function lcs(a, b) {
  var n = a.length,
    m = b.length,
    w = m + 1;
  var d = new Uint16Array((n + 1) * w); // n*m <= 4.000.000, así que el largo común entra en 16 bits
  var i, j;
  for (i = n - 1; i >= 0; i--) {
    for (j = m - 1; j >= 0; j--) {
      d[i * w + j] = a[i] === b[j] ? d[(i + 1) * w + j + 1] + 1 : Math.max(d[(i + 1) * w + j], d[i * w + j + 1]);
    }
  }
  var out = [];
  i = 0;
  j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      juntar(out, "=", a[i]);
      i++;
      j++;
    } else if (d[(i + 1) * w + j] >= d[i * w + j + 1]) {
      juntar(out, "-", a[i++]);
    } else {
      juntar(out, "+", b[j++]);
    }
  }
  while (i < n) juntar(out, "-", a[i++]);
  while (j < m) juntar(out, "+", b[j++]);
  return out;
}

// Devuelve una lista de tramos { t: "=" | "+" | "-", s: texto }.
export function diffTexto(a, b) {
  var A = tokens(a),
    B = tokens(b);
  var ini = 0;
  while (ini < A.length && ini < B.length && A[ini] === B[ini]) ini++;
  var fa = A.length,
    fb = B.length;
  while (fa > ini && fb > ini && A[fa - 1] === B[fb - 1]) {
    fa--;
    fb--;
  }
  var ma = A.slice(ini, fa),
    mb = B.slice(ini, fb);
  var out = [];
  juntar(out, "=", A.slice(0, ini).join(""));
  var medio;
  if (ma.length * mb.length > 4000000) {
    // texto enorme: se marca todo el tramo del medio como cambiado
    medio = [];
    juntar(medio, "-", ma.join(""));
    juntar(medio, "+", mb.join(""));
  } else {
    medio = lcs(ma, mb);
  }
  medio.forEach(function (x) {
    juntar(out, x.t, x.s);
  });
  juntar(out, "=", A.slice(fa).join(""));
  return out;
}

export function hayCambios(a, b) {
  return String(a || "") !== String(b || "");
}

var CTX = 90; // cuánto texto sin cambios se deja alrededor de cada cambio

// Elemento con el texto comparado. Los tramos largos sin cambios se achican con "…".
export function pintarDiff(a, b) {
  var partes = diffTexto(a, b);
  var box = el("div", { class: "df" });
  if (!hayCambios(a, b)) {
    box.textContent = "(sin cambios)";
    box.classList.add("df-vacio");
    return box;
  }
  partes.forEach(function (p, i) {
    var s = p.s;
    if (p.t === "=") {
      var primero = i === 0,
        ultimo = i === partes.length - 1;
      if (s.length > CTX * 2 + 20) {
        if (primero && ultimo) s = "…";
        else if (primero) s = "… " + s.slice(s.length - CTX);
        else if (ultimo) s = s.slice(0, CTX) + " …";
        else s = s.slice(0, CTX) + " … " + s.slice(s.length - CTX);
      }
      box.append(document.createTextNode(s));
    } else {
      var n = document.createElement(p.t === "+" ? "ins" : "del");
      n.className = p.t === "+" ? "df-ins" : "df-del";
      n.textContent = s;
      box.append(n);
    }
  });
  return box;
}
