create extension if not exists pgcrypto with schema extensions;

create table if not exists public.santa_draws (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  invite_hash text not null unique check (invite_hash ~ '^[0-9a-f]{64}$'),
  organizer_hash text not null check (organizer_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'open' check (status in ('open', 'drawn')),
  created_at timestamptz not null default now(),
  drawn_at timestamptz
);

create table if not exists public.santa_participants (
  id uuid primary key default gen_random_uuid(),
  draw_id uuid not null references public.santa_draws(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  public_key jsonb not null
    check (
      public_key ?& array['kty', 'n', 'e']
      and coalesce(public_key->>'kty' = 'RSA', false)
      and coalesce(public_key->>'n' ~ '^[A-Za-z0-9_-]+$', false)
      and coalesce(public_key->>'e' = 'AQAB', false)
    ),
  private_key_ciphertext text not null
    check (private_key_ciphertext ~ '^[A-Za-z0-9_-]{100,10000}$'),
  private_key_iv text not null
    check (private_key_iv ~ '^[A-Za-z0-9_-]{16}$'),
  access_hash text not null check (access_hash ~ '^[0-9a-f]{64}$'),
  assignment_ciphertext text
    check (assignment_ciphertext is null or assignment_ciphertext ~ '^[A-Za-z0-9_-]{100,3000}$'),
  created_at timestamptz not null default now()
);

create unique index if not exists santa_participants_unique_name
  on public.santa_participants (draw_id, lower(btrim(name)));

alter table public.santa_draws enable row level security;
alter table public.santa_participants enable row level security;

revoke all on table public.santa_draws from public, anon, authenticated;
revoke all on table public.santa_participants from public, anon, authenticated;
create or replace function public.santa_secret_hash(p_secret text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(p_secret, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function public.santa_secret_is_valid(p_secret text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_secret is not null and p_secret ~ '^[A-Za-z0-9_-]{40,64}$'
$$;

create or replace function public.santa_create_draw(
  p_title text,
  p_invite_secret text,
  p_organizer_secret text
)
returns table (draw_id uuid, draw_title text, draw_status text, participant_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draw public.santa_draws%rowtype;
begin
  if p_title is null or char_length(btrim(p_title)) not between 1 and 80 then
    raise exception 'Il nome del gruppo deve contenere da 1 a 80 caratteri.';
  end if;
  if not public.santa_secret_is_valid(p_invite_secret)
     or not public.santa_secret_is_valid(p_organizer_secret)
     or p_invite_secret = p_organizer_secret then
    raise exception 'Chiavi del gruppo non valide.';
  end if;

  insert into public.santa_draws (title, invite_hash, organizer_hash)
  values (
    btrim(p_title),
    public.santa_secret_hash(p_invite_secret),
    public.santa_secret_hash(p_organizer_secret)
  )
  returning * into v_draw;

  return query select v_draw.id, v_draw.title, v_draw.status, 0::bigint;
end
$$;

create or replace function public.santa_group_info(
  p_draw_id uuid,
  p_invite_secret text
)
returns table (draw_title text, draw_status text, participant_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select d.title, d.status, count(p.id)
  from public.santa_draws d
  left join public.santa_participants p on p.draw_id = d.id
  where d.id = p_draw_id
    and d.invite_hash = public.santa_secret_hash(p_invite_secret)
  group by d.id;
  if not found then
    raise exception 'Link d’iscrizione non valido.';
  end if;
end
$$;

create or replace function public.santa_join_draw(
  p_draw_id uuid,
  p_invite_secret text,
  p_name text,
  p_public_key jsonb,
  p_private_key_ciphertext text,
  p_private_key_iv text,
  p_access_hash text
)
returns table (participant_id uuid, draw_title text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_participant_id uuid;
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 then
    raise exception 'Il nome deve contenere da 1 a 80 caratteri.';
  end if;
  if not public.santa_secret_is_valid(p_invite_secret)
     or p_access_hash is null
     or p_access_hash !~ '^[0-9a-f]{64}$'
     or p_private_key_ciphertext is null
     or p_private_key_ciphertext !~ '^[A-Za-z0-9_-]{100,10000}$'
     or p_private_key_iv is null
     or p_private_key_iv !~ '^[A-Za-z0-9_-]{16}$'
     or p_public_key is null
     or jsonb_typeof(p_public_key) <> 'object'
     or not (p_public_key ?& array['kty', 'n', 'e'])
     or not coalesce(p_public_key->>'kty' = 'RSA', false)
     or not coalesce(p_public_key->>'n' ~ '^[A-Za-z0-9_-]+$', false)
     or not coalesce(p_public_key->>'e' = 'AQAB', false) then
    raise exception 'Dati di iscrizione non validi.';
  end if;

  select d.title into v_title
  from public.santa_draws d
  where d.id = p_draw_id
    and d.invite_hash = public.santa_secret_hash(p_invite_secret)
    and d.status = 'open'
  for update;
  if not found then
    raise exception 'Iscrizioni chiuse o link non valido.';
  end if;

  insert into public.santa_participants (
    draw_id, name, public_key, private_key_ciphertext, private_key_iv, access_hash
  )
  values (
    p_draw_id, btrim(p_name), p_public_key, p_private_key_ciphertext,
    p_private_key_iv, p_access_hash
  )
  returning id into v_participant_id;

  return query select v_participant_id, v_title;
exception
  when unique_violation then
    raise exception 'Questo nome è già iscritto al gruppo.';
end
$$;

create or replace function public.santa_organizer_state(
  p_draw_id uuid,
  p_organizer_secret text
)
returns table (draw_title text, draw_status text, participant_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select d.title, d.status, count(p.id)
  from public.santa_draws d
  left join public.santa_participants p on p.draw_id = d.id
  where d.id = p_draw_id
    and d.organizer_hash = public.santa_secret_hash(p_organizer_secret)
  group by d.id;
  if not found then
    raise exception 'Link organizzatore non valido.';
  end if;
end
$$;

create or replace function public.santa_organizer_participants(
  p_draw_id uuid,
  p_organizer_secret text
)
returns table (participants jsonb)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.santa_draws d
    where d.id = p_draw_id
      and d.organizer_hash = public.santa_secret_hash(p_organizer_secret)
  ) then
    raise exception 'Link organizzatore non valido o iscrizioni chiuse.';
  end if;

  return query
  select coalesce(
    jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'public_key', p.public_key)
      order by p.created_at),
    '[]'::jsonb
  )
  from public.santa_participants p
  where p.draw_id = p_draw_id;
end
$$;

create or replace function public.santa_complete_draw(
  p_draw_id uuid,
  p_organizer_secret text,
  p_assignments jsonb
)
returns table (draw_status text, participant_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected bigint;
  v_updated bigint;
begin
  if jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'Risultati del sorteggio non validi.';
  end if;
  if jsonb_array_length(p_assignments) > 500 then
    raise exception 'Risultati del sorteggio non validi.';
  end if;

  perform 1 from public.santa_draws d
  where d.id = p_draw_id
    and d.organizer_hash = public.santa_secret_hash(p_organizer_secret)
    and d.status = 'open'
  for update;
  if not found then
    raise exception 'Link organizzatore non valido o sorteggio già avviato.';
  end if;

  select count(*) into v_expected
  from public.santa_participants p
  where p.draw_id = p_draw_id;
  if v_expected < 2 or jsonb_array_length(p_assignments) <> v_expected then
    raise exception 'Servono almeno due iscritti e un risultato per ciascuno.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_assignments) as x(
      participant_id uuid, recipient_id uuid, assignment_ciphertext text
    )
    where x.participant_id is null
       or x.recipient_id is null
       or coalesce(x.assignment_ciphertext !~ '^[A-Za-z0-9_-]{100,3000}$', true)
       or x.participant_id = x.recipient_id
  ) or (
    select count(distinct x.participant_id)
    from jsonb_to_recordset(p_assignments) as x(
      participant_id uuid, recipient_id uuid, assignment_ciphertext text
    )
  ) <> v_expected or (
    select count(distinct x.recipient_id)
    from jsonb_to_recordset(p_assignments) as x(
      participant_id uuid, recipient_id uuid, assignment_ciphertext text
    )
  ) <> v_expected or exists (
    select 1
    from jsonb_to_recordset(p_assignments) as x(
      participant_id uuid, recipient_id uuid, assignment_ciphertext text
    )
    left join public.santa_participants p
      on p.draw_id = p_draw_id and p.id = x.participant_id
    left join public.santa_participants r
      on r.draw_id = p_draw_id and r.id = x.recipient_id
    where p.id is null or r.id is null
  ) then
    raise exception 'Risultati incompleti o non validi.';
  end if;

  update public.santa_participants p
  set assignment_ciphertext = x.assignment_ciphertext
  from jsonb_to_recordset(p_assignments) as x(
    participant_id uuid, recipient_id uuid, assignment_ciphertext text
  )
  where p.id = x.participant_id
    and p.draw_id = p_draw_id;
  get diagnostics v_updated = row_count;
  if v_updated <> v_expected then
    raise exception 'I risultati non corrispondono agli iscritti.';
  end if;

  update public.santa_draws d
  set status = 'drawn', drawn_at = now()
  where d.id = p_draw_id;

  return query select 'drawn'::text, v_expected;
end
$$;

create or replace function public.santa_my_assignment(
  p_draw_id uuid,
  p_participant_id uuid,
  p_access_secret text
)
returns table (
  draw_title text,
  participant_name text,
  private_key_ciphertext text,
  private_key_iv text,
  assignment_ciphertext text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select d.title, p.name, p.private_key_ciphertext, p.private_key_iv, p.assignment_ciphertext
  from public.santa_draws d
  join public.santa_participants p on p.draw_id = d.id
  where d.id = p_draw_id
    and d.status = 'drawn'
    and p.id = p_participant_id
    and p.access_hash = p_access_secret
    and p.assignment_ciphertext is not null;
  if not found then
    raise exception 'Sorteggio non pronto o codice personale non valido.';
  end if;
end
$$;

create or replace function public.santa_reset_draw(
  p_draw_id uuid,
  p_organizer_secret text
)
returns table (draw_status text, participant_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.santa_draws d
  where d.id = p_draw_id
    and d.organizer_hash = public.santa_secret_hash(p_organizer_secret)
  for update;
  if not found then
    raise exception 'Link organizzatore non valido.';
  end if;

  delete from public.santa_participants p where p.draw_id = p_draw_id;
  update public.santa_draws d set status = 'open', drawn_at = null where d.id = p_draw_id;
  return query select 'open'::text, 0::bigint;
end
$$;

revoke all on function public.santa_secret_hash(text) from public, anon, authenticated;
revoke all on function public.santa_secret_is_valid(text) from public, anon, authenticated;
revoke all on function public.santa_create_draw(text, text, text) from public, anon, authenticated;
revoke all on function public.santa_group_info(uuid, text) from public, anon, authenticated;
revoke all on function public.santa_join_draw(uuid, text, text, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function public.santa_organizer_state(uuid, text) from public, anon, authenticated;
revoke all on function public.santa_organizer_participants(uuid, text) from public, anon, authenticated;
revoke all on function public.santa_complete_draw(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.santa_my_assignment(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.santa_reset_draw(uuid, text) from public, anon, authenticated;

grant execute on function public.santa_create_draw(text, text, text) to anon, authenticated;
grant execute on function public.santa_group_info(uuid, text) to anon, authenticated;
grant execute on function public.santa_join_draw(uuid, text, text, jsonb, text, text, text) to anon, authenticated;
grant execute on function public.santa_organizer_state(uuid, text) to anon, authenticated;
grant execute on function public.santa_organizer_participants(uuid, text) to anon, authenticated;
grant execute on function public.santa_complete_draw(uuid, text, jsonb) to anon, authenticated;
grant execute on function public.santa_my_assignment(uuid, uuid, text) to anon, authenticated;
grant execute on function public.santa_reset_draw(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
