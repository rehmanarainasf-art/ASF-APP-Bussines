CREATE SEQUENCE public.asf_number_seq START 100000000 MAXVALUE 999999999 NO CYCLE;
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, asf_number text NOT NULL UNIQUE DEFAULT ('03' || nextval('public.asf_number_seq')::text) CHECK (asf_number ~ '^03[0-9]{9}$'), display_name text NOT NULL DEFAULT 'ASF User', about text NOT NULL DEFAULT 'Hey there! I am using ASF Messenger.', avatar_url text, business jsonb NOT NULL DEFAULT '{}', preferences jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, UPDATE ON public.profiles TO authenticated; GRANT ALL ON public.profiles TO service_role;
GRANT USAGE ON SEQUENCE public.asf_number_seq TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_profile_read ON public.profiles FOR SELECT TO authenticated USING (id=auth.uid());
CREATE POLICY own_profile_update ON public.profiles FOR UPDATE TO authenticated USING (id=auth.uid()) WITH CHECK (id=auth.uid());
CREATE FUNCTION public.asf_profile_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN IF NEW.id<>OLD.id OR NEW.asf_number<>OLD.asf_number THEN RAISE EXCEPTION 'Your ASF number is permanent'; END IF; NEW.updated_at=now(); RETURN NEW; END $$;
CREATE TRIGGER profile_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.asf_profile_immutable();

CREATE TABLE public.ai_threads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, title text NOT NULL DEFAULT 'New conversation', messages jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ai_threads TO authenticated; GRANT ALL ON public.ai_threads TO service_role;
ALTER TABLE public.ai_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_ai_threads ON public.ai_threads FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());

CREATE TABLE public.messenger_state(user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE, data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.messenger_state TO authenticated; GRANT ALL ON public.messenger_state TO service_role;
ALTER TABLE public.messenger_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_state ON public.messenger_state FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());

CREATE TABLE public.ai_access_state(user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,blocked boolean NOT NULL DEFAULT false,reason text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.ai_access_state TO authenticated; GRANT ALL ON public.ai_access_state TO service_role;
ALTER TABLE public.ai_access_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_access_read ON public.ai_access_state FOR SELECT TO authenticated USING(user_id=auth.uid());

CREATE TABLE public.direct_chats(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_a uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, user_b uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_a,user_b), CHECK(user_a<>user_b));
GRANT SELECT ON public.direct_chats TO authenticated; GRANT ALL ON public.direct_chats TO service_role;
ALTER TABLE public.direct_chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY participants_chats ON public.direct_chats FOR SELECT TO authenticated USING(auth.uid() IN(user_a,user_b));

CREATE TABLE public.direct_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chat_id uuid NOT NULL REFERENCES public.direct_chats(id) ON DELETE CASCADE, sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, body text NOT NULL DEFAULT '' CHECK(char_length(body) <= 4000), media_path text, media_name text, media_type text, deleted boolean NOT NULL DEFAULT false, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT,INSERT,UPDATE ON public.direct_messages TO authenticated; GRANT ALL ON public.direct_messages TO service_role;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY participants_messages ON public.direct_messages FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.direct_chats c WHERE c.id=chat_id AND auth.uid() IN(c.user_a,c.user_b)));
CREATE POLICY participants_send ON public.direct_messages FOR INSERT TO authenticated WITH CHECK(sender_id=auth.uid() AND EXISTS(SELECT 1 FROM public.direct_chats c WHERE c.id=chat_id AND auth.uid() IN(c.user_a,c.user_b)));
CREATE POLICY participants_update ON public.direct_messages FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.direct_chats c WHERE c.id = chat_id AND auth.uid() IN (c.user_a, c.user_b))) WITH CHECK (EXISTS (SELECT 1 FROM public.direct_chats c WHERE c.id = chat_id AND auth.uid() IN (c.user_a, c.user_b)));
CREATE INDEX direct_messages_chat_idx ON public.direct_messages(chat_id, created_at);

CREATE OR REPLACE FUNCTION public.asf_message_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.chat_id <> OLD.chat_id OR NEW.sender_id <> OLD.sender_id OR NEW.created_at <> OLD.created_at THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF auth.uid() = OLD.sender_id THEN
    IF NEW.read_at IS DISTINCT FROM OLD.read_at THEN RAISE EXCEPTION 'Not allowed'; END IF;
    IF NEW.deleted THEN NEW.body := ''; NEW.media_path := NULL; NEW.media_name := NULL; NEW.media_type := NULL; END IF;
  ELSIF auth.uid() IS NOT NULL THEN
    IF NEW.body <> OLD.body OR NEW.deleted <> OLD.deleted OR NEW.media_path IS DISTINCT FROM OLD.media_path THEN RAISE EXCEPTION 'Not allowed'; END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER direct_message_guard BEFORE UPDATE ON public.direct_messages FOR EACH ROW EXECUTE FUNCTION public.asf_message_guard();
CREATE OR REPLACE FUNCTION public.asf_touch_chat() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN UPDATE public.direct_chats SET updated_at = now() WHERE id = NEW.chat_id; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.asf_touch_chat() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER direct_message_touch AFTER INSERT ON public.direct_messages FOR EACH ROW EXECUTE FUNCTION public.asf_touch_chat();
ALTER TABLE public.direct_messages REPLICA IDENTITY FULL;

CREATE TABLE public.contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, asf_number text NOT NULL CHECK (asf_number ~ '^03[0-9]{9}$'), name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (owner_id, asf_number));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated; GRANT ALL ON public.contacts TO service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_contacts ON public.contacts FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE SCHEMA IF NOT EXISTS asf_private;
GRANT USAGE ON SCHEMA asf_private TO authenticated, service_role;
CREATE OR REPLACE FUNCTION asf_private.shares_chat(_a uuid, _b uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT _a = _b OR EXISTS (SELECT 1 FROM public.direct_chats WHERE user_a = least(_a,_b) AND user_b = greatest(_a,_b))
$$;
-- Viewer can see owner's status if they share a chat, or viewer saved owner's number in contacts
CREATE OR REPLACE FUNCTION asf_private.can_see_status(_viewer uuid, _owner uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT asf_private.shares_chat(_viewer, _owner) OR EXISTS (
    SELECT 1 FROM public.contacts c JOIN public.profiles p ON p.asf_number = c.asf_number
    WHERE c.owner_id = _viewer AND p.id = _owner)
$$;
REVOKE ALL ON FUNCTION asf_private.shares_chat(uuid,uuid), asf_private.can_see_status(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION asf_private.shares_chat(uuid,uuid), asf_private.can_see_status(uuid,uuid) TO authenticated, service_role;

CREATE TABLE public.statuses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 700), color text NOT NULL DEFAULT '#128C7E' CHECK (char_length(color) <= 20), media_path text, media_type text, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours');
GRANT SELECT, INSERT, DELETE ON public.statuses TO authenticated; GRANT ALL ON public.statuses TO service_role;
ALTER TABLE public.statuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY statuses_read ON public.statuses FOR SELECT TO authenticated USING (expires_at > now() AND asf_private.can_see_status(auth.uid(), user_id));
CREATE POLICY statuses_insert ON public.statuses FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY statuses_delete ON public.statuses FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Call signalling (WebRTC offer/answer/ice/end) between chat partners
CREATE TABLE public.call_signals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), call_id uuid NOT NULL, from_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, to_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, kind text NOT NULL CHECK (kind IN ('offer','answer','ice','end','reject','busy')), video boolean NOT NULL DEFAULT false, payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, DELETE ON public.call_signals TO authenticated; GRANT ALL ON public.call_signals TO service_role;
ALTER TABLE public.call_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY call_signals_read ON public.call_signals FOR SELECT TO authenticated USING (auth.uid() IN (from_id, to_id));
CREATE POLICY call_signals_send ON public.call_signals FOR INSERT TO authenticated WITH CHECK (from_id = auth.uid() AND from_id <> to_id AND asf_private.shares_chat(from_id, to_id));
CREATE POLICY call_signals_delete ON public.call_signals FOR DELETE TO authenticated USING (from_id = auth.uid());
CREATE INDEX call_signals_to_idx ON public.call_signals(to_id, created_at);

ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages, public.direct_chats, public.statuses, public.call_signals;

CREATE POLICY asf_media_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'asf-media' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY asf_media_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'asf-media' AND (
  asf_private.shares_chat(auth.uid(), ((storage.foldername(name))[1])::uuid)
  OR ((storage.foldername(name))[2] = 'status' AND asf_private.can_see_status(auth.uid(), ((storage.foldername(name))[1])::uuid))));
CREATE POLICY asf_media_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'asf-media' AND (storage.foldername(name))[1] = auth.uid()::text);