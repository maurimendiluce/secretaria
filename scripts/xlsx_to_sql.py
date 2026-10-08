#!/usr/bin/env python3
"""Convierte la planilla de seguimiento en supabase/import.sql.

Uso: python3 scripts/xlsx_to_sql.py planilla.xlsx supabase/import.sql

NO importa las credenciales (usuarios/contraseñas) de la hoja "cosas utiles".
"""
import sys, datetime, warnings
import openpyxl

warnings.filterwarnings("ignore")
src, dst = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, data_only=True)

def q(v):
    if v is None:
        return "null"
    if isinstance(v, (datetime.datetime, datetime.date)):
        return "'%s'" % v.strftime("%Y-%m-%d")
    s = str(v).strip()
    if not s:
        return "null"
    return "'" + s.replace("'", "''") + "'"

def rows(ws, first=2):
    for r in ws.iter_rows(min_row=first, values_only=True):
        if any(c is not None and str(c).strip() for c in r):
            yield list(r)

out = ["-- Generado por scripts/xlsx_to_sql.py (sin credenciales)\nbegin;"]

def insert(table, cols, vals):
    out.append("insert into %s (%s) values (%s);" % (table, ", ".join(cols), ", ".join(q(v) for v in vals)))

def sheet(name):
    for ws in wb:
        if ws.title.strip().lower() == name:
            return ws
    raise SystemExit("No encuentro la hoja: " + name)

# seguimiento: A..G + H (notas) + columnas extra I..L se agregan a notas
for r in rows(sheet("seguimiento")):
    r += [None] * (12 - len(r))
    extra = [str(x).strip() for x in r[7:12] if x is not None and str(x).strip()]
    insert("seguimiento", ["fecha","expediente","dpto","contacto","observaciones","responsable","estado","notas"],
           r[0:7] + ["\n".join(extra) or None])

for r in rows(sheet("observaciones para comision")):
    r += [None] * 5
    insert("comision", ["fecha","tipo","categoria","expediente","observacion","estado"],
           [r[0], "para", r[1], r[2], r[3], r[4]])

for r in rows(sheet("obvservaciones en comision")):
    r += [None] * 4
    insert("comision", ["fecha","tipo","categoria","expediente","observacion","estado"],
           [r[0], "en", None, r[1], r[2], r[3]])

# cosas utiles: personal (filas hasta el título "Links") y links (sin credenciales)
ws = sheet("cosas utiles")
in_links = False
for r in rows(ws):
    r += [None] * 7
    if r[0] and str(r[0]).strip() == "Links":
        in_links = True
        continue
    if not in_links:
        insert("personal", ["nombre","funcion","contacto","horario","home","vacaciones"], r[0:6])
    else:
        # Cada fila de links: nombre | valor1 | valor2. Se omiten filas con credenciales
        # (las que tienen usuario + clave en B y C, sin URL ni lista de mails).
        b, c = r[1], r[2]
        if b and str(b).startswith("http"):
            insert("links", ["nombre","valor"], [r[0], b])
        elif b and "@" in str(b) and not c:
            insert("links", ["nombre","valor"], [r[0], b])
        # el resto (usuario/clave) se descarta a propósito

for r in rows(sheet("contacto_dptos")):
    r += [None] * 7
    insert("contactos_dptos", ["dpto","director_titular","email_titular","director_adjunto","email_adjunto","administrativos","email_admin"], r[0:7])

for r in rows(sheet("cuentas de mail"), first=3):
    # columnas B y C
    b = r[1] if len(r) > 1 else None
    c = r[2] if len(r) > 2 else None
    if b:
        insert("cuentas_mail", ["cuenta","acceso"], [str(b).replace("\xa0", " "), c])

out.append("commit;")
open(dst, "w", encoding="utf-8").write("\n".join(out) + "\n")
print("OK ->", dst, "(%d sentencias)" % (len(out) - 2))
