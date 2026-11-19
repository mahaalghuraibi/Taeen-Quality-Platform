-- Quality Control Forms — Phase 2 migration script
-- Run manually in Supabase SQL editor BEFORE deploying Phase 2 code.
-- All statements use IF NOT EXISTS — safe to re-run.
-- IMPORTANT: Run this script BEFORE deploying Phase 2 code to Render.

CREATE TABLE IF NOT EXISTS quality_form_sessions (
    id              SERIAL PRIMARY KEY,
    tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
    branch_id       INTEGER NOT NULL,
    branch_name     VARCHAR(255),
    meal_date       DATE NOT NULL,
    meal_period     VARCHAR(20) NOT NULL,
    created_by_id   INTEGER REFERENCES users(id),
    created_by_name VARCHAR(255),
    created_at      TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    is_complete     BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at    TIMESTAMP WITHOUT TIME ZONE,
    CONSTRAINT uq_session_branch_date_period UNIQUE (tenant_id, branch_id, meal_date, meal_period),
    CONSTRAINT ck_meal_period CHECK (meal_period IN ('breakfast', 'lunch', 'dinner'))
);

CREATE INDEX IF NOT EXISTS ix_quality_form_sessions_tenant_id ON quality_form_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS ix_quality_form_sessions_branch_id ON quality_form_sessions(branch_id);
CREATE INDEX IF NOT EXISTS ix_quality_form_sessions_meal_date  ON quality_form_sessions(meal_date);

CREATE TABLE IF NOT EXISTS quality_form_stage_submissions (
    id               SERIAL PRIMARY KEY,
    session_id       INTEGER NOT NULL REFERENCES quality_form_sessions(id) ON DELETE CASCADE,
    stage_number     INTEGER NOT NULL,
    stage_name_ar    VARCHAR(100) NOT NULL,
    submitted_by_id  INTEGER NOT NULL REFERENCES users(id),
    submitted_by_name VARCHAR(255),
    submitted_at     TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    answers          TEXT NOT NULL,
    measurements     TEXT,
    notes            TEXT,
    CONSTRAINT uq_stage_per_session UNIQUE (session_id, stage_number),
    CONSTRAINT ck_stage_number_range CHECK (stage_number >= 1 AND stage_number <= 5)
);

CREATE INDEX IF NOT EXISTS ix_quality_form_stage_submissions_session_id ON quality_form_stage_submissions(session_id);

-- Satisfy Supabase RLS advisory. The backend connects as postgres (superuser),
-- which bypasses RLS without FORCE. These statements have no runtime effect on
-- the application but prevent direct anon-key access to these tables.
ALTER TABLE quality_form_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_form_stage_submissions ENABLE ROW LEVEL SECURITY;
