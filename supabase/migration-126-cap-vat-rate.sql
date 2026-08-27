-- 100% is the hard mathematical ceiling for a VAT rate used to back out gross
-- sales (platform_commission_for_range divides by 1 + vat_rate/100) — anything
-- above that has no sane interpretation and was previously accepted silently.
ALTER TABLE public.org_commission_rates
  ADD CONSTRAINT chk_vat_rate_sane CHECK (vat_rate_percent <= 100);

INSERT INTO public.schema_migrations (version, name)
VALUES ('126', 'cap-vat-rate') ON CONFLICT (version) DO NOTHING;
