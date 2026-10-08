# Seguimiento compartido (GitHub Pages + Supabase)

Página estática (HTML/JS), sin Franklin. GitHub Pages solo sirve archivos, no ejecuta Python: el guardado y el login los hace Supabase.

Misma interfaz que la app local: pestañas, búsqueda, filtros, colores por estado, edición en la celda y exportar a Excel.
Agrega login (usuario y contraseña) y edición compartida: lo que edita uno lo ve el otro en vivo.
Los datos viven en Supabase, no en el repo. Sin login, la base no devuelve nada.

## A. Supabase (base de datos y login)
1. Crear cuenta y proyecto en https://supabase.com (plan gratuito). Esperar a que se cree.
2. **SQL Editor**: pegar todo `supabase/schema.sql` → Run.
3. **SQL Editor**: pegar todo `supabase/import.sql` (tus datos, sin contraseñas) → Run. Se pueden ver en *Table Editor*.
4. **Authentication → Users → Add user → Create new user**: crear el usuario de cada persona (email + contraseña), con *Auto Confirm User* tildado.
5. En la configuración de **Authentication**, desactivar *Allow new users to sign up* para que nadie más pueda registrarse.
6. **Project Settings → API**: copiar *Project URL* y la clave *anon public*.

## B. GitHub (la página)
7. Crear un repo vacío llamado `seguimiento` (público o privado; solo lleva código).
8. Pegar la URL y la clave del paso 6 en `docs/config.js`.
9. Subir esta carpeta al repo (rama `main`). **NO subir `supabase/import.sql`**: tiene tus datos. (`.gitignore` ya lo excluye si usás git por terminal; si subís a mano desde la web, dejalo afuera.)
10. **Settings → Pages**: Source = *Deploy from a branch* → rama `main`, carpeta `/docs`. Guardar.
11. En uno o dos minutos la página queda en `https://TU-USUARIO.github.io/seguimiento/`.

## C. Probar y compartir
12. Abrir la página, entrar y comprobar que se ven las tablas.
13. Pasarle a la otra persona la dirección, su email y su contraseña. Para probar el "en vivo": abrir la página en dos ventanas (o dos personas) y editar una celda.

## Notas
- Cada celda se guarda sola al salir de ella y solo se envía esa celda: dos personas editando celdas distintas no se pisan. Si editan la misma, queda la última.
- Si llega un cambio del otro mientras escribís, no se pisa lo que estás escribiendo: se actualiza cuando salís de la celda.
- Pasar el mouse sobre una fila muestra quién la editó por última vez.
- Agregar una columna: sumarla en `TABLES` de `docs/app.js` y en el schema SQL (`alter table ... add column ...`).
- Probar la página en tu compu (opcional): dentro de `docs/` correr `python -m http.server 8000` y abrir http://localhost:8000.
- No usa Franklin ni ningún proceso de compilación: son archivos HTML/JS/CSS que GitHub Pages sirve tal cual. Python solo se usa en `scripts/xlsx_to_sql.py` para convertir la planilla.
- Los proyectos gratuitos de Supabase pueden pausarse tras un tiempo sin uso (verificar en su página de precios); se reactivan desde el panel.
- Las claves de las cuentas de mail no se migraron: usar un gestor de contraseñas.
