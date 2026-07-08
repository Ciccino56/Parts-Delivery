create type delivery_status as enum (
  'created',
  'picked',
  'moving',
  'near',
  'delivered'
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null unique,
  created_at timestamptz not null default now()
);

create table riders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  customer_id uuid references customers(id),
  rider_id uuid references riders(id),
  customer_name text not null,
  customer_phone text,
  delivery_address text not null,
  rider_name text,
  status delivery_status not null default 'created',
  last_lat numeric(10, 7),
  last_lng numeric(10, 7),
  last_location_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  status delivery_status not null,
  note text,
  lat numeric(10, 7),
  lng numeric(10, 7),
  created_at timestamptz not null default now()
);

create index orders_code_idx on orders(code);
create index orders_rider_status_idx on orders(rider_id, status);
create index order_events_order_created_idx on order_events(order_id, created_at desc);

create policy orders_demo_select on orders for select to anon, authenticated using (true);
create policy orders_demo_insert on orders for insert to anon, authenticated with check (true);
create policy orders_demo_update on orders for update to anon, authenticated using (true) with check (true);

create policy riders_demo_select on riders for select to anon, authenticated using (true);

create policy customers_demo_select on customers for select to anon, authenticated using (true);
create policy customers_demo_insert on customers for insert to anon, authenticated with check (true);

create policy order_events_demo_select on order_events for select to anon, authenticated using (true);
create policy order_events_demo_insert on order_events for insert to anon, authenticated with check (true);
