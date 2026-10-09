#!/usr/bin/env python3
"""Convierte una copia de seguridad (.json que baja el botón "Copia de seguridad")
en un archivo SQL para volver a cargar los datos en Supabase.

Uso:
  python3 scripts/restaurar_copia.py copia-seguridad-2026-10-09.json restaurar.sql
  python3 scripts/restaurar_copia.py copia.json restaurar.sql --vaciar   # borra primero lo que haya en cada tabla

Después: Supabase > SQL Editor > pegar restaurar.sql > Run.
Conserva los id, las fechas y quién editó cada fila. Sin --vaciar, si una fila con el mismo id ya existe, el SQL da error y no cambia nada.
"""
import json, sys

args = [a for a in sys.argv[1:] if not a.startswith("--")]
vaciar = "--vaciar" in sys.argv
if len(args) != 2:
    sys.exit(__doc__)
src, dst = args

data = json.load(open(src, encoding="utf-8"))
if data.get("app") != "seguimiento" or "tablas" not in data:
    sys.exit("Este archivo no parece una copia de seguridad de la app.")

def q(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (dict, list)):
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    return "'" + str(v).replace("'", "''") + "'"

def ident(n):
    return '"' + n.replace('"', '""') + '"'

out = ["-- Restauración generada por scripts/restaurar_copia.py (copia del %s)" % data.get("creado", "?"), "begin;"]
total = 0
for tabla, filas in data["tablas"].items():
    t = ident(tabla)
    out.append("\n-- %s (%d filas)" % (tabla, len(filas)))
    out.append("alter table %s disable trigger trg_updated;" % t)  # para conservar updated_at / updated_by originales
    if vaciar:
        out.append("delete from %s;" % t)
    for f in filas:
        cols = list(f.keys())
        out.append("insert into %s (%s) overriding system value values (%s);" % (
            t, ", ".join(ident(c) for c in cols), ", ".join(q(f[c]) for c in cols)))
        total += 1
    out.append("alter table %s enable trigger trg_updated;" % t)
    if filas and "id" in filas[0]:
        out.append("select setval(pg_get_serial_sequence('%s', 'id'), (select max(id) from %s));" % (tabla, t))
out.append("\ncommit;")
open(dst, "w", encoding="utf-8").write("\n".join(out) + "\n")
print("OK ->", dst, "(%d filas, %d tablas)" % (total, len(data["tablas"])))
