import { db, and, desc, eq, sql } from "@repo/database";
import {
  formFieldsTable,
  formResponseAnswersTable,
  formResponsesTable,
  formsTable,
  usersTable,
} from "@repo/database/schema";
import { buildResponseZodSchema } from "../forms/schema";
import type { UpsertFormField } from "../forms/model";
import EmailService from "../email";
import bcrypt from "bcryptjs";

function fieldRowToModel(row: typeof formFieldsTable.$inferSelect): UpsertFormField {
  return {
    id: row.id,
    key: row.key,
    type: row.type,
    label: row.label,
    helpText: row.helpText ?? null,
    placeholder: row.placeholder ?? null,
    required: row.required ?? false,
    order: row.order ?? 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: (row.config ?? {}) as any,
  };
}

class ResponsesService {
  private email = new EmailService();

  async submitPublicResponse(params: {
    slug: string;
    answers: Record<string, unknown>;
    respondentEmail?: string | null;
    receiveEmailCopy?: boolean;
    ip?: string | null;
    userAgent?: string | null;
    formPassword?: string | null;
  }): Promise<{ responseId: string; submittedAt: Date }> {
    const formRows = await db.select().from(formsTable).where(eq(formsTable.slug, params.slug)).limit(1);
    const form = formRows[0];
    if (!form) throw new Error("FORM_NOT_FOUND");
    if (form.status !== "PUBLISHED") throw new Error("FORM_UNPUBLISHED");
    if (form.archivedAt) throw new Error("FORM_ARCHIVED");
    if (form.expiresAt && form.expiresAt < new Date()) throw new Error("FORM_EXPIRED");

    if (form.passwordHash) {
      // password protection is optional; keep it simple for now
      if (!params.formPassword) {
        throw new Error("FORM_PASSWORD_REQUIRED");
      }

      const ok = await bcrypt.compare(params.formPassword, form.passwordHash);
      if (!ok) {
        throw new Error("FORM_PASSWORD_REQUIRED");
      }
    }

    if (!form.allowMultipleSubmissionsPerIp && params.ip) {
      const existing = await db
        .select({ id: formResponsesTable.id })
        .from(formResponsesTable)
        .where(and(eq(formResponsesTable.formId, form.id), eq(formResponsesTable.ip, params.ip)))
        .limit(1);
      if (existing.length) throw new Error("DUPLICATE_SUBMISSION");
    }

    if (typeof form.responseLimit === "number") {
      const countRows = await db
        .select({ c: sql<number>`count(*)` })
        .from(formResponsesTable)
        .where(eq(formResponsesTable.formId, form.id));
      const count = Number(countRows[0]?.c ?? 0);
      if (count >= form.responseLimit) throw new Error("RESPONSE_LIMIT_REACHED");
    }

    const fieldRows = await db
      .select()
      .from(formFieldsTable)
      .where(eq(formFieldsTable.formId, form.id))
      .orderBy(formFieldsTable.order);

    const fields = fieldRows.map(fieldRowToModel);
    const schema = buildResponseZodSchema(fields);
    const validated = schema.parse(params.answers);

    const submittedAt = new Date();
    const responseRows = await db
      .insert(formResponsesTable)
      .values({
        formId: form.id,
        respondentEmail: params.respondentEmail ?? null,
        ip: params.ip ?? null,
        userAgent: params.userAgent ?? null,
        status: "COMPLETED",
        submittedAt,
        answersSnapshot: validated,
        meta: {},
      })
      .returning();

    const response = responseRows[0]!;

    const answersToInsert = Object.entries(validated).map(([fieldKey, value]) => ({
      responseId: response.id,
      fieldKey,
      value,
    }));

    if (answersToInsert.length) {
      await db.insert(formResponseAnswersTable).values(answersToInsert);
    }

    // notifications (best-effort)
    const settings = (form.settings ?? {}) as Record<string, unknown>;
    const notifyCreator = settings["notifyOnResponse"] !== false;
    if (notifyCreator) {
      const owners = await db.select().from(usersTable).where(eq(usersTable.id, form.ownerId)).limit(1);
      const owner = owners[0];
      if (owner?.email) {
        void this.email.send({
          to: owner.email,
          subject: `New response: ${form.title}`,
          html: `<p>You received a new response to <strong>${form.title}</strong>.</p><p>Response ID: <code>${response.id}</code></p>`,
          text: `You received a new response to ${form.title}. Response ID: ${response.id}`,
        });
      }
    }

    if (params.receiveEmailCopy && params.respondentEmail) {
      void this.email.send({
        to: params.respondentEmail,
        subject: `Your response: ${form.title}`,
        html: `<p>Thanks for submitting <strong>${form.title}</strong>.</p><pre>${escapeHtml(
          JSON.stringify(validated, null, 2),
        )}</pre>`,
        text: `Thanks for submitting ${form.title}.\n\n${JSON.stringify(validated, null, 2)}`,
      });
    }

    return { responseId: response.id, submittedAt };
  }

  async listResponsesForOwner(params: { ownerId: string; formId: string; cursor?: string; limit: number }) {
    const formRows = await db
      .select()
      .from(formsTable)
      .where(and(eq(formsTable.id, params.formId), eq(formsTable.ownerId, params.ownerId)))
      .limit(1);
    if (!formRows[0]) return null;

    const where = params.cursor
      ? and(eq(formResponsesTable.formId, params.formId), sql`${formResponsesTable.id} < ${params.cursor}`)
      : eq(formResponsesTable.formId, params.formId);

    const rows = await db
      .select()
      .from(formResponsesTable)
      .where(where)
      .orderBy(desc(formResponsesTable.submittedAt), desc(formResponsesTable.id))
      .limit(params.limit);

    return rows;
  }

  async getResponseForOwner(params: { ownerId: string; formId: string; responseId: string }) {
    const formRows = await db
      .select()
      .from(formsTable)
      .where(and(eq(formsTable.id, params.formId), eq(formsTable.ownerId, params.ownerId)))
      .limit(1);
    if (!formRows[0]) return null;

    const responseRows = await db
      .select()
      .from(formResponsesTable)
      .where(and(eq(formResponsesTable.id, params.responseId), eq(formResponsesTable.formId, params.formId)))
      .limit(1);
    const response = responseRows[0];
    if (!response) return null;

    const answers = await db
      .select()
      .from(formResponseAnswersTable)
      .where(eq(formResponseAnswersTable.responseId, response.id));

    return { response, answers };
  }

  async getAnalyticsForOwner(params: { ownerId: string; formId: string }) {
    const formRows = await db
      .select()
      .from(formsTable)
      .where(and(eq(formsTable.id, params.formId), eq(formsTable.ownerId, params.ownerId)))
      .limit(1);
    const form = formRows[0];
    if (!form) return null;

    const fields = await db
      .select()
      .from(formFieldsTable)
      .where(eq(formFieldsTable.formId, form.id))
      .orderBy(formFieldsTable.order);

    const totalRows = await db
      .select({ c: sql<number>`count(*)` })
      .from(formResponsesTable)
      .where(eq(formResponsesTable.formId, form.id));

    const total = Number(totalRows[0]?.c ?? 0);

    const perField: Array<{
      fieldKey: string;
      type: string;
      counts?: Record<string, number>;
    }> = [];

    for (const f of fields) {
      if (["SINGLE_SELECT", "MULTI_SELECT", "DROPDOWN", "CHECKBOX", "RATING"].includes(f.type)) {
        const rows = await db
          .select({
            v: sql<string>`(${formResponseAnswersTable.value})::text`,
            c: sql<number>`count(*)`,
          })
          .from(formResponseAnswersTable)
          .innerJoin(formResponsesTable, eq(formResponsesTable.id, formResponseAnswersTable.responseId))
          .where(and(eq(formResponsesTable.formId, form.id), eq(formResponseAnswersTable.fieldKey, f.key)))
          .groupBy(sql`(${formResponseAnswersTable.value})::text`)
          .limit(1000);

        const counts: Record<string, number> = {};
        for (const r of rows) counts[r.v] = Number(r.c);
        perField.push({ fieldKey: f.key, type: f.type, counts });
      } else {
        perField.push({ fieldKey: f.key, type: f.type });
      }
    }

    return { totalResponses: total, perField };
  }
}

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export default ResponsesService;
