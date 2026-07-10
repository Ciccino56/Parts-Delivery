create table if not exists staff_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  user_id uuid,
  role text not null check (role in ('shop', 'rider')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table staff_users add column if not exists user_id uuid;
alter table orders add column if not exists delivery_notes text;
alter table orders add column if not exists priority text not null default 'normal' check (priority in ('normal', 'urgent'));
alter table orders add column if not exists payment_status text not null default 'unknown' check (payment_status in ('unknown', 'paid', 'collect'));

create table if not exists rider_access (
  id uuid primary key default gen_random_uuid(),
  rider_name text not null unique,
  pin text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into staff_users (email, role)
values ('info@centroricambiautosrl.it', 'shop')
on conflict (email) do update set role = excluded.role, active = true;

update staff_users
set user_id = auth_users.id
from auth.users as auth_users
where lower(auth_users.email) = lower(staff_users.email)
  and staff_users.user_id is null;

insert into rider_access (rider_name, pin) values
  ('Marco', '2222'),
  ('Luca', '3333'),
  ('Antonio', '4444'),
  ('Salvatore', '5555')
on conflict (rider_name) do update set pin = excluded.pin, active = true;

create or replace function normalize_phone(value text)
returns text
language sql
immutable
as $$
  select case
    when regexp_replace(coalesce(value, ''), '\D', '', 'g') like '39%' then regexp_replace(coalesce(value, ''), '\D', '', 'g')
    when length(regexp_replace(coalesce(value, ''), '\D', '', 'g')) >= 9 then '39' || regexp_replace(coalesce(value, ''), '\D', '', 'g')
    else regexp_replace(coalesce(value, ''), '\D', '', 'g')
  end;
$$;

create or replace function is_shop_user()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from staff_users
    where role = 'shop'
      and active = true
      and (
        (user_id is not null and user_id = (select auth.uid()))
        or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
  );
$$;

create or replace function get_customer_order(p_code text, p_phone text)
returns setof orders
language sql
stable
security definer
set search_path = public
as $$
  select *
  from orders
  where upper(code) = upper(trim(p_code))
    and normalize_phone(customer_phone) = normalize_phone(p_phone)
  limit 1;
$$;

create or replace function get_rider_profile(p_pin text)
returns table (rider_name text)
language sql
stable
security definer
set search_path = public
as $$
  select rider_access.rider_name
  from rider_access
  where pin = trim(p_pin)
    and active = true
  limit 1;
$$;

create or replace function get_rider_orders(p_pin text)
returns setof orders
language sql
stable
security definer
set search_path = public
as $$
  select o.*
  from orders o
  join rider_access r on lower(r.rider_name) = lower(o.rider_name)
  where r.pin = trim(p_pin)
    and r.active = true
    and o.status <> 'delivered'
  order by o.created_at desc;
$$;

create or replace function update_rider_order(
  p_pin text,
  p_code text,
  p_status text default null,
  p_lat numeric default null,
  p_lng numeric default null,
  p_location_at timestamptz default null
)
returns setof orders
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed_rider text;
  next_status delivery_status;
begin
  select rider_name into allowed_rider
  from rider_access
  where pin = trim(p_pin)
    and active = true
  limit 1;

  if allowed_rider is null then
    return;
  end if;

  if p_status is not null then
    next_status := p_status::delivery_status;
  end if;

  return query
  update orders
  set
    status = coalesce(next_status, orders.status),
    last_lat = coalesce(p_lat, orders.last_lat),
    last_lng = coalesce(p_lng, orders.last_lng),
    last_location_at = coalesce(p_location_at, orders.last_location_at),
    delivered_at = case when next_status = 'delivered'::delivery_status then now() else orders.delivered_at end,
    updated_at = now()
  where upper(orders.code) = upper(trim(p_code))
    and lower(orders.rider_name) = lower(allowed_rider)
  returning orders.*;
end;
$$;

revoke all on function get_customer_order(text, text) from public;
revoke all on function get_rider_profile(text) from public;
revoke all on function get_rider_orders(text) from public;
revoke all on function update_rider_order(text, text, text, numeric, numeric, timestamptz) from public;

grant execute on function get_customer_order(text, text) to anon, authenticated;
grant execute on function get_rider_profile(text) to anon, authenticated;
grant execute on function get_rider_orders(text) to anon, authenticated;
grant execute on function update_rider_order(text, text, text, numeric, numeric, timestamptz) to anon, authenticated;

create or replace function create_shop_order(
  p_code text,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_address text,
  p_rider_name text
)
returns setof orders
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_shop_user() then
    return;
  end if;

  return query
  insert into orders (
    code,
    customer_name,
    customer_phone,
    delivery_address,
    rider_name,
    status,
    updated_at
  ) values (
    upper(trim(p_code)),
    trim(p_customer_name),
    nullif(trim(p_customer_phone), ''),
    trim(p_delivery_address),
    trim(p_rider_name),
    'created',
    now()
  )
  returning *;
end;
$$;

revoke all on function create_shop_order(text, text, text, text, text) from public;
grant execute on function create_shop_order(text, text, text, text, text) to authenticated;

create or replace function update_shop_order(
  p_code text,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_delivery_address text default null,
  p_rider_name text default null
)
returns setof orders
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_shop_user() then
    return;
  end if;

  return query
  update orders
  set
    customer_name = coalesce(nullif(trim(p_customer_name), ''), orders.customer_name),
    customer_phone = coalesce(nullif(trim(p_customer_phone), ''), orders.customer_phone),
    delivery_address = coalesce(nullif(trim(p_delivery_address), ''), orders.delivery_address),
    rider_name = coalesce(nullif(trim(p_rider_name), ''), orders.rider_name),
    updated_at = now()
  where upper(orders.code) = upper(trim(p_code))
  returning orders.*;
end;
$$;

create or replace function delete_shop_order(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  if not is_shop_user() then
    return false;
  end if;

  delete from order_events where order_id in (
    select id from orders where upper(code) = upper(trim(p_code))
  );

  delete from orders
  where upper(code) = upper(trim(p_code));

  get diagnostics deleted_count = row_count;
  return deleted_count > 0;
end;
$$;

revoke all on function update_shop_order(text, text, text, text, text) from public;
revoke all on function delete_shop_order(text) from public;
grant execute on function update_shop_order(text, text, text, text, text) to authenticated;
grant execute on function delete_shop_order(text) to authenticated;

create or replace function create_shop_order_v2(
  p_code text,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_address text,
  p_rider_name text,
  p_delivery_notes text default null,
  p_priority text default 'normal',
  p_payment_status text default 'unknown'
)
returns setof orders
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_shop_user() then
    return;
  end if;

  return query
  insert into orders (
    code,
    customer_name,
    customer_phone,
    delivery_address,
    rider_name,
    status,
    delivery_notes,
    priority,
    payment_status,
    updated_at
  ) values (
    upper(trim(p_code)),
    trim(p_customer_name),
    nullif(trim(p_customer_phone), ''),
    trim(p_delivery_address),
    trim(p_rider_name),
    'created',
    nullif(trim(coalesce(p_delivery_notes, '')), ''),
    coalesce(nullif(trim(p_priority), ''), 'normal'),
    coalesce(nullif(trim(p_payment_status), ''), 'unknown'),
    now()
  )
  returning *;
end;
$$;

create or replace function update_shop_order_v2(
  p_code text,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_delivery_address text default null,
  p_rider_name text default null,
  p_delivery_notes text default null,
  p_priority text default null,
  p_payment_status text default null
)
returns setof orders
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_shop_user() then
    return;
  end if;

  return query
  update orders
  set
    customer_name = coalesce(nullif(trim(p_customer_name), ''), orders.customer_name),
    customer_phone = coalesce(nullif(trim(p_customer_phone), ''), orders.customer_phone),
    delivery_address = coalesce(nullif(trim(p_delivery_address), ''), orders.delivery_address),
    rider_name = coalesce(nullif(trim(p_rider_name), ''), orders.rider_name),
    delivery_notes = nullif(trim(coalesce(p_delivery_notes, orders.delivery_notes, '')), ''),
    priority = coalesce(nullif(trim(p_priority), ''), orders.priority),
    payment_status = coalesce(nullif(trim(p_payment_status), ''), orders.payment_status),
    updated_at = now()
  where upper(orders.code) = upper(trim(p_code))
  returning orders.*;
end;
$$;

revoke all on function create_shop_order_v2(text, text, text, text, text, text, text, text) from public;
revoke all on function update_shop_order_v2(text, text, text, text, text, text, text, text) from public;
grant execute on function create_shop_order_v2(text, text, text, text, text, text, text, text) to authenticated;
grant execute on function update_shop_order_v2(text, text, text, text, text, text, text, text) to authenticated;

drop policy if exists orders_demo_select on orders;
drop policy if exists orders_demo_insert on orders;
drop policy if exists orders_demo_update on orders;
drop policy if exists orders_shop_select on orders;
drop policy if exists orders_shop_insert on orders;
drop policy if exists orders_shop_update on orders;

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
drop policy if exists riders_shop_select on riders;

create policy riders_shop_select on riders
  for select to authenticated
  using (is_shop_user());
