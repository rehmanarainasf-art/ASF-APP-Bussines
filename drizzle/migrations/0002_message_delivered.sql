ALTER TABLE public.direct_messages ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
CREATE OR REPLACE FUNCTION public.asf_message_guard()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.chat_id <> OLD.chat_id OR NEW.sender_id <> OLD.sender_id OR NEW.created_at <> OLD.created_at THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF auth.uid() = OLD.sender_id THEN
    IF NEW.read_at IS DISTINCT FROM OLD.read_at OR NEW.delivered_at IS DISTINCT FROM OLD.delivered_at THEN RAISE EXCEPTION 'Not allowed'; END IF;
    IF NEW.deleted THEN NEW.body := ''; NEW.media_path := NULL; NEW.media_name := NULL; NEW.media_type := NULL; END IF;
  ELSIF auth.uid() IS NOT NULL THEN
    IF NEW.body <> OLD.body OR NEW.deleted <> OLD.deleted OR NEW.media_path IS DISTINCT FROM OLD.media_path OR NEW.media_type IS DISTINCT FROM OLD.media_type THEN RAISE EXCEPTION 'Not allowed'; END IF;
    IF NEW.read_at IS NOT NULL AND NEW.delivered_at IS NULL THEN NEW.delivered_at := NEW.read_at; END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;