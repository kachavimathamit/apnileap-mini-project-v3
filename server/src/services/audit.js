import { db, newId } from '../db/connection.js';

let insertAudit;
function stmt() {
  insertAudit ??= db.prepare(`
    INSERT INTO audit_log
      (id, actor_user_id, actor_email, action, entity_type, entity_id,
       institute_id, outcome, ip_address, user_agent, detail)
    VALUES (@id, @actor_user_id, @actor_email, @action, @entity_type, @entity_id,
            @institute_id, @outcome, @ip_address, @user_agent, @detail)
  `);
  return insertAudit;
}

/**
 * Requirement 7: logins, failed authorization, views of sensitive records, edits,
 * exports and status changes are all recorded. The table is append-only (enforced
 * by triggers in schema.sql), so the trail cannot be quietly rewritten.
 *
 * Auditing must never break the request it is describing, so failures are logged
 * and swallowed rather than propagated.
 */
export function recordAudit(req, entry) {
  try {
    stmt().run({
      id: newId('aud'),
      actor_user_id: entry.actorUserId ?? req?.user?.id ?? null,
      actor_email: entry.actorEmail ?? req?.user?.email ?? null,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      institute_id: entry.instituteId ?? null,
      outcome: entry.outcome ?? 'SUCCESS',
      ip_address: req?.ip ?? null,
      user_agent: req?.get?.('user-agent')?.slice(0, 300) ?? null,
      detail: entry.detail ? JSON.stringify(entry.detail) : null,
    });
  } catch (error) {
    console.error('[audit] failed to write audit entry', entry.action, error.message);
  }
}
