ALTER TABLE applications
  ADD COLUMN sign_up text NOT NULL DEFAULT 'open',
  ADD COLUMN require_passkey boolean NOT NULL DEFAULT false,
  ADD COLUMN sign_in_methods jsonb,
  ADD COLUMN account_audience text,
  ADD COLUMN session_cap integer,
  ADD COLUMN unbound_absolute_lifetime_ms bigint,
  ADD COLUMN unbound_idle_lifetime_ms bigint,
  ADD CONSTRAINT application_sign_in_methods_object
    CHECK (sign_in_methods IS NULL OR jsonb_typeof(sign_in_methods) = 'object'),
  ADD CONSTRAINT application_sign_up_valid
    CHECK (sign_up IN ('open', 'closed')),
  ADD CONSTRAINT application_account_audience_valid
    CHECK (
      account_audience IS NULL
      OR account_audience IN ('customer', 'staff')
    ),
  ADD CONSTRAINT application_policy_version_not_negative
    CHECK (policy_version >= 0),
  ADD CONSTRAINT application_session_cap_positive
    CHECK (session_cap IS NULL OR session_cap > 0),
  ADD CONSTRAINT application_unbound_limits_valid
    CHECK (
      (
        unbound_absolute_lifetime_ms IS NULL
        AND unbound_idle_lifetime_ms IS NULL
      )
      OR
      (
        unbound_absolute_lifetime_ms IS NOT NULL
        AND unbound_idle_lifetime_ms IS NOT NULL
        AND unbound_absolute_lifetime_ms > 0
        AND unbound_idle_lifetime_ms > 0
      )
    );
