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

-- Drinks commonly sold in Sierra Leone clubs; prices in SLE.
insert into public.bar_inventory (item_name, sku, category, quantity_in_stock, cost_price, selling_price, reorder_threshold) values
    ('Star beer, 60 cl', 'STAR-BEER-60-CL', 'Beer', 96, 20, 30, 24),
    ('Heineken, 33 cl', 'HEINEKEN-33-CL', 'Beer', 72, 27, 40, 24),
    ('Guinness stout, 33 cl', 'GUINNESS-STOUT-33-CL', 'Beer', 72, 27, 40, 24),
    ('Savanna Dry cider, 33 cl', 'SAVANNA-DRY-CIDER-33-CL', 'Ciders', 48, 35, 50, 12),
    ('Smirnoff Ice, 33 cl', 'SMIRNOFF-ICE-33-CL', 'Ciders', 48, 32, 45, 12),
    ('Maltina, 33 cl', 'MALTINA-33-CL', 'Malt drinks', 48, 16, 25, 24),
    ('Malta Guinness, 33 cl', 'MALTA-GUINNESS-33-CL', 'Malt drinks', 48, 16, 25, 24),
    ('Coca-Cola, 35 cl', 'COCA-COLA-35-CL', 'Soft drinks', 96, 9, 15, 24),
    ('Fanta, 35 cl', 'FANTA-35-CL', 'Soft drinks', 72, 9, 15, 24),
    ('Sprite, 35 cl', 'SPRITE-35-CL', 'Soft drinks', 72, 9, 15, 24),
    ('Red Bull, 25 cl', 'RED-BULL-25-CL', 'Energy drinks', 48, 30, 45, 12),
    ('Bottled water, 75 cl', 'BOTTLED-WATER-75-CL', 'Water', 120, 5, 10, 24),
    ('Hennessy VS, 70 cl', 'HENNESSY-VS-70-CL', 'Spirits', 6, 1800, 2500, 2),
    ('Johnnie Walker Black Label, 75 cl', 'JOHNNIE-WALKER-BLACK-LABEL-75-CL', 'Spirits', 6, 1400, 2000, 2),
    ('Jameson, 75 cl', 'JAMESON-75-CL', 'Spirits', 6, 1000, 1500, 2),
    ('Smirnoff vodka, 75 cl', 'SMIRNOFF-VODKA-75-CL', 'Spirits', 6, 600, 900, 2),
    ('Gordon''s gin, 75 cl', 'GORDONS-GIN-75-CL', 'Spirits', 6, 600, 900, 2),
    ('Four Cousins sweet red, 75 cl', 'FOUR-COUSINS-SWEET-RED-75-CL', 'Wine & champagne', 12, 280, 400, 3),
    ('Moët & Chandon Brut, 75 cl', 'MOET-CHANDON-BRUT-75-CL', 'Wine & champagne', 6, 3500, 4500, 2);
