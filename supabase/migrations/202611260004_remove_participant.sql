begin;

create or replace function public.santa_remove_participant(
  p_draw_id uuid,
  p_organizer_secret text,
  p_participant_id uuid
)
returns table (participant_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  if p_participant_id is null then
    raise exception 'Partecipante non valido.';
  end if;

  perform 1
  from public.santa_draws d
  where d.id = p_draw_id
    and d.organizer_hash = public.santa_secret_hash(p_organizer_secret)
    and d.status = 'open'
  for update;
  if not found then
    raise exception 'Link organizzatore non valido o sorteggio già avviato.';
  end if;

  delete from public.santa_participants p
  where p.draw_id = p_draw_id
    and p.id = p_participant_id;
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'Il partecipante non è più presente nel gruppo.';
  end if;

  return query
  select count(*) from public.santa_participants p where p.draw_id = p_draw_id;
end
$$;

revoke all on function public.santa_remove_participant(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.santa_remove_participant(uuid, text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
