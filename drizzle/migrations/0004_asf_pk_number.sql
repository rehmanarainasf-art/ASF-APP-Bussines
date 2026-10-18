CREATE OR REPLACE FUNCTION public.asf_generate_number() RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE c text;
BEGIN
  LOOP
    c := '+923' || lpad((floor(random() * 1000000000))::bigint::text, 9, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE asf_number = c);
  END LOOP;
  RETURN c;
END $$;
REVOKE EXECUTE ON FUNCTION public.asf_generate_number() FROM PUBLIC, anon, authenticated;
ALTER TABLE public.profiles ALTER COLUMN asf_number SET DEFAULT public.asf_generate_number();
CREATE UNIQUE INDEX IF NOT EXISTS profiles_asf_number_unique ON public.profiles(asf_number);