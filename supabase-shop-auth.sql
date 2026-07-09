create table if not exists staff_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null check (role in ('shop', 'rider')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function is_shop_user()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from staff_users
    where lower(email) = lower(auth.jwt() ->> 'email')
      and role = 'shop'
      and active = true
  );
$$;

-- Dopo aver creato l'utente in Supabase Auth, aggiungi la sua email qui:
insert into staff_users (email, role) values ('info@centroricambiautosrl.it', 'shop')
on conflict (email) do update set role = excluded.role, active = true;

-- Quando l'email del negozio e stata aggiunta, queste policy sostituiscono
-- le regole demo permissive.
drop policy if exists orders_demo_select on orders;
drop policy if exists orders_demo_insert on orders;
drop policy if exists orders_demo_update on orders;

create policy orders_shop_select on orders
  for select to authenticated
  using (is_shop_user());

create policy orders_shop_insert on orders
  for insert to authenticated
  with check (is_shop_user());

create policy orders_shop_update on orders
  for update to authenticated
  using (is_shop_user())
  with check (is_shop_user());

drop policy if exists riders_demo_select on riders;

create policy riders_shop_select on riders
  for select to authenticated
  using (is_shop_user());
