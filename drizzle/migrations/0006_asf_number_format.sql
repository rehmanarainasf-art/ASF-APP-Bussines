ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_asf_number_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_asf_number_check CHECK (asf_number ~ '^(03|\+923)[0-9]{9}$');
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_asf_number_check;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_asf_number_check CHECK (asf_number ~ '^(03|\+923)[0-9]{9}$');