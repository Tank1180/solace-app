BEGIN;

INSERT INTO subscription_plans (name, customer_type, monthly_price, yearly_price, description, is_active)
SELECT seed.name, seed.customer_type, seed.monthly_price, seed.yearly_price, seed.description, 1
FROM (
  VALUES
    ('Basic', 'personal', 4.99::double precision, 49.99::double precision, 'Core budgeting, spending, and paycheck tracking.'),
    ('Premium', 'personal', 9.99::double precision, 99.99::double precision, 'Everything in Basic plus tax center, investments, and AI insights.'),
    ('Business', 'business', 24.99::double precision, 249.99::double precision, 'Business income/expense tracking, P&L statements, quarterly estimated taxes, and receipt uploads.')
) AS seed(name, customer_type, monthly_price, yearly_price, description)
WHERE NOT EXISTS (
  SELECT 1
  FROM subscription_plans existing
  WHERE existing.name = seed.name
    AND existing.customer_type = seed.customer_type
);

WITH target_years AS (
  SELECT EXTRACT(YEAR FROM CURRENT_DATE)::integer - 1 AS tax_year
  UNION ALL
  SELECT EXTRACT(YEAR FROM CURRENT_DATE)::integer
  UNION ALL
  SELECT EXTRACT(YEAR FROM CURRENT_DATE)::integer + 1
)
INSERT INTO tax_years (
  tax_year,
  social_security_rate,
  social_security_wage_base,
  medicare_rate,
  additional_medicare_rate,
  additional_medicare_threshold,
  mileage_rate,
  capital_gains_rate,
  self_employment_rate,
  child_tax_credit,
  default_state_rate
)
SELECT tax_year, 0.062, 168600, 0.0145, 0.009, 200000, 0.67, 0.15, 0.153, 2000, 0.05
FROM target_years
ON CONFLICT (tax_year) DO NOTHING;

WITH target_years AS (
  SELECT EXTRACT(YEAR FROM CURRENT_DATE)::integer - 1 AS tax_year
  UNION ALL
  SELECT EXTRACT(YEAR FROM CURRENT_DATE)::integer
  UNION ALL
  SELECT EXTRACT(YEAR FROM CURRENT_DATE)::integer + 1
),
deductions AS (
  SELECT *
  FROM (
    VALUES
      ('single', 14600::double precision),
      ('married_joint', 29200::double precision),
      ('married_separate', 14600::double precision),
      ('head_of_household', 21900::double precision)
  ) AS v(filing_status, amount)
)
INSERT INTO tax_standard_deductions (tax_year, filing_status, amount)
SELECT y.tax_year, d.filing_status, d.amount
FROM target_years y
CROSS JOIN deductions d
ON CONFLICT (tax_year, filing_status) DO UPDATE SET amount = EXCLUDED.amount;

WITH target_years AS (
  SELECT EXTRACT(YEAR FROM CURRENT_DATE)::integer - 1 AS tax_year
  UNION ALL
  SELECT EXTRACT(YEAR FROM CURRENT_DATE)::integer
  UNION ALL
  SELECT EXTRACT(YEAR FROM CURRENT_DATE)::integer + 1
),
brackets AS (
  SELECT *
  FROM (
    VALUES
      ('single', 0, 11600::double precision, 0.10::double precision),
      ('single', 1, 47150::double precision, 0.12::double precision),
      ('single', 2, 100525::double precision, 0.22::double precision),
      ('single', 3, 191950::double precision, 0.24::double precision),
      ('single', 4, 243725::double precision, 0.32::double precision),
      ('single', 5, 609350::double precision, 0.35::double precision),
      ('single', 6, NULL::double precision, 0.37::double precision),
      ('married_joint', 0, 23200::double precision, 0.10::double precision),
      ('married_joint', 1, 94300::double precision, 0.12::double precision),
      ('married_joint', 2, 201050::double precision, 0.22::double precision),
      ('married_joint', 3, 383900::double precision, 0.24::double precision),
      ('married_joint', 4, 487450::double precision, 0.32::double precision),
      ('married_joint', 5, 731200::double precision, 0.35::double precision),
      ('married_joint', 6, NULL::double precision, 0.37::double precision),
      ('married_separate', 0, 11600::double precision, 0.10::double precision),
      ('married_separate', 1, 47150::double precision, 0.12::double precision),
      ('married_separate', 2, 100525::double precision, 0.22::double precision),
      ('married_separate', 3, 191950::double precision, 0.24::double precision),
      ('married_separate', 4, 243725::double precision, 0.32::double precision),
      ('married_separate', 5, 365600::double precision, 0.35::double precision),
      ('married_separate', 6, NULL::double precision, 0.37::double precision),
      ('head_of_household', 0, 16550::double precision, 0.10::double precision),
      ('head_of_household', 1, 63100::double precision, 0.12::double precision),
      ('head_of_household', 2, 100500::double precision, 0.22::double precision),
      ('head_of_household', 3, 191950::double precision, 0.24::double precision),
      ('head_of_household', 4, 243700::double precision, 0.32::double precision),
      ('head_of_household', 5, 609350::double precision, 0.35::double precision),
      ('head_of_household', 6, NULL::double precision, 0.37::double precision)
  ) AS v(filing_status, seq, upto_income, rate)
)
INSERT INTO tax_brackets (tax_year, filing_status, seq, upto_income, rate)
SELECT y.tax_year, b.filing_status, b.seq, b.upto_income, b.rate
FROM target_years y
CROSS JOIN brackets b
ON CONFLICT (tax_year, filing_status, seq) DO UPDATE
SET upto_income = EXCLUDED.upto_income,
    rate = EXCLUDED.rate;

WITH target_years AS (
  SELECT EXTRACT(YEAR FROM CURRENT_DATE)::integer - 1 AS tax_year
  UNION ALL
  SELECT EXTRACT(YEAR FROM CURRENT_DATE)::integer
  UNION ALL
  SELECT EXTRACT(YEAR FROM CURRENT_DATE)::integer + 1
),
state_taxes AS (
  SELECT *
  FROM (
    VALUES
      ('FL', 'State Income Tax', 'state_income', 0::double precision, NULL::double precision),
      ('TX', 'State Income Tax', 'state_income', 0::double precision, NULL::double precision),
      ('WA', 'State Income Tax', 'state_income', 0::double precision, NULL::double precision),
      ('NV', 'State Income Tax', 'state_income', 0::double precision, NULL::double precision),
      ('TN', 'State Income Tax', 'state_income', 0::double precision, NULL::double precision),
      ('SD', 'State Income Tax', 'state_income', 0::double precision, NULL::double precision),
      ('WY', 'State Income Tax', 'state_income', 0::double precision, NULL::double precision),
      ('AK', 'State Income Tax', 'state_income', 0::double precision, NULL::double precision),
      ('NH', 'State Income Tax', 'state_income', 0::double precision, NULL::double precision),
      ('CA', 'State Income Tax', 'state_income', 0.093::double precision, NULL::double precision),
      ('NY', 'State Income Tax', 'state_income', 0.0685::double precision, NULL::double precision),
      ('NJ', 'State Income Tax', 'state_income', 0.0637::double precision, NULL::double precision),
      ('OR', 'State Income Tax', 'state_income', 0.0875::double precision, NULL::double precision),
      ('MN', 'State Income Tax', 'state_income', 0.0785::double precision, NULL::double precision),
      ('MA', 'State Income Tax', 'state_income', 0.05::double precision, NULL::double precision),
      ('IL', 'State Income Tax', 'state_income', 0.0495::double precision, NULL::double precision),
      ('PA', 'State Income Tax', 'state_income', 0.0307::double precision, NULL::double precision),
      ('CO', 'State Income Tax', 'state_income', 0.044::double precision, NULL::double precision),
      ('AZ', 'State Income Tax', 'state_income', 0.025::double precision, NULL::double precision),
      ('GA', 'State Income Tax', 'state_income', 0.0549::double precision, NULL::double precision),
      ('NC', 'State Income Tax', 'state_income', 0.0425::double precision, NULL::double precision),
      ('VA', 'State Income Tax', 'state_income', 0.0575::double precision, NULL::double precision),
      ('MI', 'State Income Tax', 'state_income', 0.0425::double precision, NULL::double precision),
      ('OH', 'State Income Tax', 'state_income', 0.035::double precision, NULL::double precision),
      ('CO', 'FAMLI (Paid Family & Medical Leave)', 'additional', 0.009::double precision, 176100::double precision)
  ) AS v(state_code, tax_name, tax_type, rate, wage_base)
)
INSERT INTO tax_state_taxes (tax_year, state_code, tax_name, tax_type, rate, wage_base)
SELECT y.tax_year, s.state_code, s.tax_name, s.tax_type, s.rate, s.wage_base
FROM target_years y
CROSS JOIN state_taxes s
ON CONFLICT (tax_year, state_code, tax_name, tax_type) DO UPDATE
SET rate = EXCLUDED.rate,
    wage_base = EXCLUDED.wage_base;

COMMIT;
