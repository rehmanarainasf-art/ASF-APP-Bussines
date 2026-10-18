CREATE OR REPLACE FUNCTION public.asf_caller_profile(_id uuid) RETURNS TABLE(display_name text, asf_number text, avatar_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT p.display_name, p.asf_number, p.avatar_url FROM public.profiles p
  WHERE p.id = _id AND auth.uid() IS NOT NULL AND asf_private.shares_chat(auth.uid(), _id)
$$;
REVOKE ALL ON FUNCTION public.asf_caller_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asf_caller_profile(uuid) TO authenticated;