-- Application data. Keycloak owns identity (who the person is); the app owns who may act for which company.

CREATE TABLE organizations (
  id   text PRIMARY KEY,
  name text NOT NULL
);

-- One row per human. id = Keycloak user id (sub). The phone is a verified, unique login identifier.
CREATE TABLE persons (
  id                uuid PRIMARY KEY,
  display_name      text NOT NULL,
  phone             text NOT NULL UNIQUE,
  phone_verified_at timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Access comes from membership, not from the phone. History is kept: firing changes status, it does not delete.
CREATE TABLE memberships (
  person_id  uuid NOT NULL REFERENCES persons(id),
  org_id     text NOT NULL REFERENCES organizations(id),
  role       text NOT NULL CHECK (role IN ('owner', 'accountant', 'employee')),
  status     text NOT NULL CHECK (status IN ('active', 'fired', 'suspended')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz,
  PRIMARY KEY (person_id, org_id)
);

-- Tokens issued before this moment are rejected for this person in this company (firing, incident).
CREATE TABLE revoked_before (
  person_id uuid NOT NULL REFERENCES persons(id),
  org_id    text NOT NULL REFERENCES organizations(id),
  at        timestamptz NOT NULL,
  PRIMARY KEY (person_id, org_id)
);

-- Consents: a document has versions; an acceptance binds person x version x company (NULL company = personal consent).
CREATE TABLE documents (
  id    text PRIMARY KEY,
  title text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('person', 'org'))
);
CREATE TABLE document_versions (
  id           serial PRIMARY KEY,
  document_id  text NOT NULL REFERENCES documents(id),
  version      int  NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  text_sha256  text NOT NULL,
  UNIQUE (document_id, version)
);
CREATE TABLE acceptances (
  person_id   uuid NOT NULL REFERENCES persons(id),
  version_id  int  NOT NULL REFERENCES document_versions(id),
  org_id      text REFERENCES organizations(id),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  channel     text NOT NULL DEFAULT 'app'
);
CREATE UNIQUE INDEX acceptances_once ON acceptances (person_id, version_id, COALESCE(org_id, ''));

-- What the naive implementation keeps: one consent flag per phone number, no version, no company.
CREATE TABLE naive_consents (
  phone       text PRIMARY KEY,
  accepted    boolean NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now()
);
