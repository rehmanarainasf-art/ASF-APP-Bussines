CREATE TABLE public.message_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 reporter_id uuid NOT NULL REFERENCES public.profiles(id),
 message_id uuid NOT NULL REFERENCES public.direct_messages(id),
 reason text NOT NULL,
 status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Reviewed','Resolved','Dismissed')),
 moderation_note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 UNIQUE(reporter_id,message_id)
);
GRANT SELECT, INSERT ON public.message_reports TO authenticated;
GRANT ALL ON public.message_reports TO service_role;
ALTER TABLE public.message_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_report_read ON public.message_reports FOR SELECT TO authenticated USING(reporter_id = auth.uid());
CREATE POLICY own_report_insert ON public.message_reports FOR INSERT TO authenticated WITH CHECK(reporter_id = auth.uid() AND status = 'Pending' AND moderation_note = '' AND reviewed_at IS NULL AND char_length(reason) BETWEEN 3 AND 300 AND EXISTS (SELECT 1 FROM public.direct_messages m JOIN public.direct_chats c ON c.id=m.chat_id WHERE m.id=message_id AND m.sender_id<>auth.uid() AND NOT m.deleted AND auth.uid() IN (c.user_a,c.user_b)));
CREATE INDEX message_reports_status_created ON public.message_reports(status,created_at DESC);
