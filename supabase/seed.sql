-- Demo data for local development (`supabase db reset` runs this file).
-- Do not run it against a live station: it creates tanks and stock.

update public.fuel_products set price_per_liter = 30.00, avg_cost_per_liter = 27.00 where code = 'PMS';
update public.fuel_products set price_per_liter = 31.00, avg_cost_per_liter = 28.00 where code = 'AGO';
update public.fuel_products set price_per_liter = 30.00, avg_cost_per_liter = 27.50 where code = 'DPK';

insert into public.tanks (tank_name, fuel_type, capacity_liters, current_volume, reorder_level_liters) values
    ('Tank 1', 'PMS', 33000, 18000, 8000),
    ('Tank 2', 'AGO', 33000, 9000, 8000),
    ('Tank 3', 'DPK', 15000, 6000, 4000);

insert into public.pumps (pump_number, tank_id, current_meter)
select p.pump_number, t.id, p.meter
from (values
    ('P1', 'Tank 1', 125400),
    ('P2', 'Tank 1', 98210),
    ('P3', 'Tank 2', 75330),
    ('P4', 'Tank 2', 64120),
    ('P5', 'Tank 3', 20150)
) as p (pump_number, tank_name, meter)
join public.tanks t on t.tank_name = p.tank_name;

insert into public.shop_inventory (item_name, sku, category, quantity_in_stock, cost_price, selling_price, reorder_threshold) values
    ('Engine oil 15W-40, 1 L',  'OIL-15W40-1L', 'Lubricants',  40, 95,  130, 10),
    ('Engine oil 20W-50, 4 L',  'OIL-20W50-4L', 'Lubricants',  12, 340, 450, 5),
    ('Brake fluid DOT 4, 500 ml', 'BRK-DOT4-500', 'Lubricants', 8,  60,  85,  6),
    ('Coolant, 1 L',            'COOL-1L',      'Coolants',    20, 55,  80,  8),
    ('Bottled water, 75 cl',    'WATER-75CL',   'Convenience', 120, 4,  7,   48);
