-- Esquema para el sistema de seguimiento. Pegar completo en Supabase > SQL Editor > Run.

create table if not exists seguimiento (
  id bigint generated always as identity primary key,
  fecha date,
  expediente text,
  dpto text,
  contacto text,
  observaciones text,
  responsable text,
  estado text,
  notas text,
  updated_at timestamptz default now(),
  updated_by text
);

create table if not exists comision (
  id bigint generated always as identity primary key,
  fecha date,
  tipo text,            -- 'para' = observaciones para comisión, 'en' = observaciones en comisión
  categoria text,
  expediente text,
  observacion text,
  estado text,
  updated_at timestamptz default now(),
  updated_by text
);

create table if not exists personal (
  id bigint generated always as identity primary key,
  nombre text, funcion text, contacto text, horario text, home text, vacaciones text,
  updated_at timestamptz default now(), updated_by text
);

create table if not exists contactos_dptos (
  id bigint generated always as identity primary key,
  dpto text,
  director_titular text, email_titular text,
  director_adjunto text, email_adjunto text,
  administrativos text, email_admin text,
  updated_at timestamptz default now(), updated_by text
);

create table if not exists cuentas_mail (
  id bigint generated always as identity primary key,
  cuenta text, acceso text,
  updated_at timestamptz default now(), updated_by text
);

create table if not exists links (
  id bigint generated always as identity primary key,
  nombre text, valor text,
  updated_at timestamptz default now(), updated_by text
);

-- Registra quién y cuándo editó cada fila
create or replace function set_updated() returns trigger as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.jwt() ->> 'email', 'import');
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array['seguimiento','comision','personal','contactos_dptos','cuentas_mail','links']
  loop
    execute format('drop trigger if exists trg_updated on %I', t);
    execute format('create trigger trg_updated before insert or update on %I for each row execute function set_updated()', t);

    -- Solo usuarios con sesión iniciada pueden leer/escribir. Sin login la API no devuelve nada.
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "solo_logueados" on %I', t);
    execute format('create policy "solo_logueados" on %I for all to authenticated using (true) with check (true)', t);

    -- Cambios en vivo entre usuarios
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
