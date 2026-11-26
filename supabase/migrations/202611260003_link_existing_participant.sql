begin;

create or replace function public.santa_find_participant(
  p_draw_id uuid,
  p_access_secret text
)
returns table (participant_id uuid, draw_title text, draw_status text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_access_secret is null or p_access_secret !~ '^[0-9a-f]{64}$' then
    raise exception 'Codice personale non valido per questo gruppo.';
  end if;

  return query
  select p.id, d.title, d.status
  from public.santa_draws d
  join public.santa_participants p on p.draw_id = d.id
  where d.id = p_draw_id
    and p.access_hash = p_access_secret
  order by p.created_at
  limit 1;

  if not found then
    raise exception 'Codice personale non valido per questo gruppo.';
  end if;
end
$$;

revoke all on function public.santa_find_participant(uuid, text) from public, anon, authenticated;
grant execute on function public.santa_find_participant(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
