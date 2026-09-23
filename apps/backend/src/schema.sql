CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('SUPER_ADMIN','ORG_ADMIN','OPERATOR','VIEWER')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS foreigners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  first_name text NOT NULL,
  middle_name text,
  last_name text NOT NULL,
  citizenship text NOT NULL,
  birth_date date,
  phone text,
  email text,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  foreigner_id uuid NOT NULL REFERENCES foreigners(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  document_number text NOT NULL,
  issuing_country text,
  issue_date date,
  expiry_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  foreigner_id uuid NOT NULL REFERENCES foreigners(id) ON DELETE CASCADE,
  registration_type text NOT NULL DEFAULT 'TEMPORARY_STAY',
  registration_number text,
  start_date date,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  government_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS visas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  foreigner_id uuid NOT NULL REFERENCES foreigners(id) ON DELETE CASCADE,
  visa_type text NOT NULL,
  visa_number text,
  issue_date date,
  start_date date,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS government_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  foreigner_id uuid REFERENCES foreigners(id) ON DELETE SET NULL,
  service_type text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  external_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_foreigners_org ON foreigners(organization_id);
CREATE INDEX IF NOT EXISTS idx_foreigners_doc_search ON foreigners(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_registrations_end_date ON registrations(end_date);
CREATE INDEX IF NOT EXISTS idx_documents_expiry ON identity_documents(expiry_date);
CREATE INDEX IF NOT EXISTS idx_visas_end_date ON visas(end_date);
CREATE INDEX IF NOT EXISTS idx_audit_org_created ON audit_logs(organization_id, created_at DESC);

ALTER TABLE foreigners ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE foreigners ADD COLUMN IF NOT EXISTS entry_date date;
ALTER TABLE foreigners ADD COLUMN IF NOT EXISTS stay_basis text;
ALTER TABLE foreigners ADD COLUMN IF NOT EXISTS stay_address text;
ALTER TABLE foreigners ADD COLUMN IF NOT EXISTS insurance_company text;
ALTER TABLE foreigners ADD COLUMN IF NOT EXISTS insurance_policy_number text;
ALTER TABLE foreigners ADD COLUMN IF NOT EXISTS insurance_end_date date;
ALTER TABLE foreigners ADD COLUMN IF NOT EXISTS photo_url text;

CREATE TABLE IF NOT EXISTS foreigner_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  foreigner_id uuid NOT NULL REFERENCES foreigners(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_type text,
  file_size bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_foreigner_files_foreigner ON foreigner_files(foreigner_id);


ALTER TABLE government_applications ADD COLUMN IF NOT EXISTS external_status text;
ALTER TABLE government_applications ADD COLUMN IF NOT EXISTS last_request_at timestamptz;
ALTER TABLE government_applications ADD COLUMN IF NOT EXISTS last_response_at timestamptz;
ALTER TABLE government_applications ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE government_applications ADD COLUMN IF NOT EXISTS request_payload jsonb;
ALTER TABLE government_applications ADD COLUMN IF NOT EXISTS response_payload jsonb;

CREATE TABLE IF NOT EXISTS government_application_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES government_applications(id) ON DELETE CASCADE,
  status text NOT NULL,
  external_status text,
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS government_integration_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES government_applications(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('OUTBOUND','INBOUND')),
  http_status integer,
  payload jsonb,
  response jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gov_app_status ON government_applications(status);
CREATE INDEX IF NOT EXISTS idx_gov_app_external_reference ON government_applications(external_reference);
CREATE INDEX IF NOT EXISTS idx_gov_app_history_application ON government_application_status_history(application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gov_integration_logs_application ON government_integration_logs(application_id, created_at DESC);
