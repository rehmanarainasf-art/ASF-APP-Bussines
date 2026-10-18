CREATE TABLE public.status_receipts (
 status_id uuid NOT NULL REFERENCES public.statuses(id) ON DELETE CASCADE,
 viewer_id uuid NOT NULL REFERENCES public.profiles(id),
 viewed_at timestamptz NOT NULL DEFAULT now(),
 liked boolean NOT NULL DEFAULT false,
 PRIMARY KEY (status_id, viewer_id)
);
GRANT SELECT, INSERT, UPDATE ON public.status_receipts TO authenticated;
GRANT ALL ON public.status_receipts TO service_role;
ALTER TABLE public.status_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY receipts_read ON public.status_receipts FOR SELECT TO authenticated USING (viewer_id = auth.uid() OR EXISTS (SELECT 1 FROM public.statuses s WHERE s.id = status_id AND s.user_id = auth.uid()));
CREATE POLICY receipts_insert ON public.status_receipts FOR INSERT TO authenticated WITH CHECK (viewer_id = auth.uid() AND EXISTS (SELECT 1 FROM public.statuses s WHERE s.id = status_id AND s.user_id <> auth.uid() AND s.expires_at > now()));
CREATE POLICY receipts_update ON public.status_receipts FOR UPDATE TO authenticated USING (viewer_id = auth.uid()) WITH CHECK (viewer_id = auth.uid() AND EXISTS (SELECT 1 FROM public.statuses s WHERE s.id = status_id AND s.user_id <> auth.uid() AND s.expires_at > now()));
CREATE OR REPLACE FUNCTION public.asf_status_viewers(_status_id uuid)
RETURNS TABLE(viewer_id uuid, display_name text, asf_number text, avatar_url text, viewed_at timestamptz, liked boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT r.viewer_id, COALESCE(c.name, p.asf_number), p.asf_number, p.avatar_url, r.viewed_at, r.liked FROM public.status_receipts r JOIN public.statuses s ON s.id=r.status_id JOIN public.profiles p ON p.id=r.viewer_id LEFT JOIN public.contacts c ON c.owner_id=auth.uid() AND c.asf_number=p.asf_number WHERE s.id=_status_id AND s.user_id=auth.uid() ORDER BY r.viewed_at DESC $$;
REVOKE ALL ON FUNCTION public.asf_status_viewers(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.asf_status_viewers(uuid) TO authenticated;