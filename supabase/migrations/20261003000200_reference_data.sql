-- Chart of accounts, cash-book categories and default fuel products.

insert into public.accounts (code, name, account_type, report_group) values
    ('1000', 'Cash on Hand',                       'ASSET',     null),
    ('1010', 'Bank & Mobile Money',                'ASSET',     null),
    ('1100', 'Accounts Receivable (Credit Sales)', 'ASSET',     null),
    ('1200', 'Fuel Inventory',                     'ASSET',     null),
    ('1210', 'Shop Inventory',                     'ASSET',     null),
    ('2000', 'Accounts Payable (Suppliers)',       'LIABILITY', null),
    ('3000', 'Owner''s Equity',                    'EQUITY',    null),
    ('4000', 'Fuel Sales',                         'INCOME',    'REVENUE'),
    ('4010', 'Shop & Lubricant Sales',             'INCOME',    'REVENUE'),
    ('4900', 'Other Income',                       'INCOME',    'OTHER_INCOME'),
    ('4910', 'Cash Overages',                      'INCOME',    'OTHER_INCOME'),
    ('5000', 'Cost of Fuel Sold',                  'EXPENSE',   'COGS'),
    ('5010', 'Cost of Shop Goods Sold',            'EXPENSE',   'COGS'),
    ('5100', 'Fuel Stock Losses (Dip Variance)',   'EXPENSE',   'COGS'),
    ('6000', 'Salaries & Wages',                   'EXPENSE',   'OPEX'),
    ('6100', 'Electricity & Utilities',            'EXPENSE',   'OPEX'),
    ('6200', 'Generator Fuel & Maintenance',       'EXPENSE',   'OPEX'),
    ('6300', 'Rent',                               'EXPENSE',   'OPEX'),
    ('6400', 'Repairs & Maintenance',              'EXPENSE',   'OPEX'),
    ('6500', 'Cash Shortages',                     'EXPENSE',   'OPEX'),
    ('6600', 'Taxes, Licences & Levies',           'EXPENSE',   'OPEX'),
    ('6700', 'Bank & Mobile Money Charges',        'EXPENSE',   'OPEX'),
    ('6900', 'Other Operating Expenses',           'EXPENSE',   'OPEX');

insert into public.transaction_categories (name, transaction_type, account_code, description) values
    ('Other Income',            'INCOME',  '4900', 'Income that is not fuel or shop sales (e.g. car wash, rentals).'),
    ('Credit Customer Payment', 'INCOME',  '1100', 'A credit customer settling fuel taken on account. Reduces receivables; not new revenue.'),
    ('Owner Capital',           'INCOME',  '3000', 'Money the owner puts into the business. Not revenue.'),
    ('Fuel Purchase',           'EXPENSE', '2000', 'Payment to a fuel supplier. Settles the delivery payable; the fuel cost reaches profit as COGS when it is sold.'),
    ('Shop Supplier Payment',   'EXPENSE', '2000', 'Payment to a shop or lubricant supplier for stock bought on credit.'),
    ('Salary',                  'EXPENSE', '6000', 'Staff salaries, wages and allowances.'),
    ('Utility Bill',            'EXPENSE', '6100', 'Electricity, water, internet and phone.'),
    ('Generator Fuel & Maintenance', 'EXPENSE', '6200', 'Diesel and servicing for the standby generator.'),
    ('Rent',                    'EXPENSE', '6300', 'Site or equipment rent.'),
    ('Repairs & Maintenance',   'EXPENSE', '6400', 'Pump servicing, calibration and site repairs.'),
    ('Taxes & Levies',          'EXPENSE', '6600', 'Licences, council levies and taxes.'),
    ('Bank Charges',            'EXPENSE', '6700', 'Bank and mobile money fees.'),
    ('Operating Expense',       'EXPENSE', '6900', 'Any other day-to-day running cost.'),
    ('Cash Deposit to Bank',    'EXPENSE', '1010', 'Moves cash from the till to the bank. Not an expense.'),
    ('Owner Drawings',          'EXPENSE', '3000', 'Money the owner takes out of the business. Not an expense.');

-- Prices start at zero; set them in Settings before the first shift.
insert into public.fuel_products (code, name) values
    ('PMS', 'Premium Motor Spirit (Petrol)'),
    ('AGO', 'Automotive Gas Oil (Diesel)'),
    ('DPK', 'Dual Purpose Kerosene');
