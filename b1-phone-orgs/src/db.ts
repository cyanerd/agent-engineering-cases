import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.APP_DB_URL ?? 'postgres://app:app-stand-only@localhost:15432/app', max: 5 });

/** Reference data: five companies, one company-scoped and one personal document. Idempotent. */
export async function ensureReference(): Promise<void> {
  await pool.query(`INSERT INTO organizations (id, name) VALUES ('A','ООО Альфа'),('B','ООО Бета'),('C','ООО Гамма'),('D','ООО Дельта'),('E','ООО Эпсилон') ON CONFLICT DO NOTHING`);
  await pool.query(`INSERT INTO documents (id, title, scope) VALUES ('payments-terms','Условия работы с платежами компании','org'),('privacy','Согласие на обработку персональных данных','person') ON CONFLICT DO NOTHING`);
  await pool.query(`INSERT INTO document_versions (document_id, version, text_sha256) VALUES ('payments-terms',1,'v1'),('privacy',1,'v1') ON CONFLICT DO NOTHING`);
}

export async function publishVersion(documentId: string): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO document_versions (document_id, version, text_sha256)
     SELECT $1, COALESCE(MAX(version), 0) + 1, 'v' || (COALESCE(MAX(version), 0) + 1) FROM document_versions WHERE document_id = $1 RETURNING version`,
    [documentId],
  );
  return rows[0].version;
}
