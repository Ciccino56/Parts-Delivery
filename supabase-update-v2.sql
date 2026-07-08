alter table orders
  add column if not exists rider_name text;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'orders' and policyname = 'orders_demo_select') then
    create policy orders_demo_select on orders for select to anon, authenticated using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'orders' and policyname = 'orders_demo_insert') then
    create policy orders_demo_insert on orders for insert to anon, authenticated with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'orders' and policyname = 'orders_demo_update') then
    create policy orders_demo_update on orders for update to anon, authenticated using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'riders' and policyname = 'riders_demo_select') then
    create policy riders_demo_select on riders for select to anon, authenticated using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customers' and policyname = 'customers_demo_select') then
    create policy customers_demo_select on customers for select to anon, authenticated using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customers' and policyname = 'customers_demo_insert') then
    create policy customers_demo_insert on customers for insert to anon, authenticated with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'order_events' and policyname = 'order_events_demo_select') then
    create policy order_events_demo_select on order_events for select to anon, authenticated using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'order_events' and policyname = 'order_events_demo_insert') then
    create policy order_events_demo_insert on order_events for insert to anon, authenticated with check (true);
  end if;
end $$;
