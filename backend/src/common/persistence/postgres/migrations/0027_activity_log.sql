ALTER TABLE security_events
  ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN kind text NOT NULL DEFAULT 'sign_in'
    CHECK (kind IN ('staff', 'sign_in'));

CREATE INDEX security_event_kind_time
  ON security_events (kind, occurred_at DESC, id DESC);
CREATE INDEX security_event_actor ON security_events (actor_id);
CREATE INDEX security_event_action ON security_events (action);
