-- Future profiles start empty; no existing rows are updated.
ALTER TABLE public.profiles ALTER COLUMN display_name SET DEFAULT '';
ALTER TABLE public.profiles ALTER COLUMN about SET DEFAULT '';
ALTER TABLE public.profiles ALTER COLUMN avatar_url SET DEFAULT NULL;