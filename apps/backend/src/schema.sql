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