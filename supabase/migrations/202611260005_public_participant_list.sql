begin;

drop function if exists public.santa_group_info(uuid, text);

create or replace function public.santa_group_info(
  p_draw_id uuid,
  p_invite_secret text
)
returns table (
  draw_title text,
  draw_status text,
  participant_count bigint,
  participants jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select d.title,
         d.status,
         count(p.id),
         coalesce(
           jsonb_agg(
             jsonb_build_object('name', p.name)
             order by p.created_at, p.id
           ) filter (where p.id is not null),
           '[]'::jsonb
         )
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

revoke all on function public.santa_group_info(uuid, text) from public, anon, authenticated;
grant execute on function public.santa_group_info(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
