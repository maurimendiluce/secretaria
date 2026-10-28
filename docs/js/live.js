// Cambios en vivo: un solo canal a la vez (Borradores, Notas). La planilla usa su propio canal.

import { S, sb } from "./core.js";

// Un solo canal a la vez: al cambiar de pestaña se cierra. Los cambios de la otra persona llegan con ~½ segundo de demora.
var live = { ch: null, timer: null };

export function liveOff() {
  clearTimeout(live.timer);
  if (live.ch) {
    sb.removeChannel(live.ch);
    live.ch = null;
  }
}

// `table` puede ser una tabla o una lista de tablas: cualquier cambio en alguna dispara `fn`.
export function liveOn(tab, table, fn) {
  liveOff();
  var tablas = [].concat(table);
  var ch = sb.channel("rt-live-" + tablas.join("-"));
  tablas.forEach(function (t) {
    ch = ch.on("postgres_changes", { event: "*", schema: "public", table: t }, function () {
      if (S.tab !== tab) return;
      clearTimeout(live.timer);
      live.timer = setTimeout(fn, 400);
    });
  });
  live.ch = ch.subscribe();
}

// Deja la pestaña sin refresco de tabla (Borradores, Notas, Calendario, Formulario no usan la grilla).
export function leaveGrid() {
  unsubscribe();
  liveOff();
  S.data = null;
}

// Cierra el canal de la planilla.
export function unsubscribe() {
  if (S.channel) {
    sb.removeChannel(S.channel);
    S.channel = null;
  }
}
