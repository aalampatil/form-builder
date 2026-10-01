import { db, and, desc, eq, inArray } from "@repo/database";
import { formsTable, formFieldsTable } from "@repo/database/schema";
import type { CreateFormInput, UpdateFormInput, UpsertFormField } from "./model";
import crypto from "node:crypto";

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function randomSuffix() {
  return crypto.randomBytes(3).toString("hex");
}

class FormsService {
  async listForms(ownerId: string) {
    return db
      .select()
      .from(formsTable)
      .where(eq(formsTable.ownerId, ownerId))
      .orderBy(desc(formsTable.updatedAt));
  }

  async getFormById(ownerId: string, formId: string) {
    const rows = await db
      .select()
      .from(formsTable)
      .where(and(eq(formsTable.id, formId), eq(formsTable.ownerId, ownerId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async getFormWithFieldsById(ownerId: string, formId: string) {
    const form = await this.getFormById(ownerId, formId);
    if (!form) return null;
    const fields = await db
      .select()
      .from(formFieldsTable)
      .where(eq(formFieldsTable.formId, form.id))
      .orderBy(formFieldsTable.order);
    return { form, fields };
  }

  async getPublicFormBySlug(slug: string) {
    const rows = await db.select().from(formsTable).where(eq(formsTable.slug, slug)).limit(1);
    const form = rows[0];
    if (!form) return null;

    const fields = await db
      .select()
      .from(formFieldsTable)
      .where(eq(formFieldsTable.formId, form.id))
      .orderBy(formFieldsTable.order);

    return { form, fields };
  }

  async createForm(ownerId: string, input: CreateFormInput) {
    const base = input.slug ?? slugify(input.title);
    const slug = base.length ? base : `form-${randomSuffix()}`;

    const created = await db
      .insert(formsTable)
      .values({
        ownerId,
        title: input.title,
        description: input.description ?? null,
        slug,
        visibility: input.visibility,
        themeId: input.themeId ?? null,
        settings: input.settings ?? {},
      })
      .returning();

    return created[0]!;
  }

  async updateForm(ownerId: string, input: UpdateFormInput) {
    const updated = await db
      .update(formsTable)
      .set({
        title: input.title,
        description: input.description,
        slug: input.slug,
        visibility: input.visibility,
        themeId: input.themeId,
        settings: input.settings,
        updatedAt: new Date(),
      })
      .where(and(eq(formsTable.id, input.formId), eq(formsTable.ownerId, ownerId)))
      .returning();

    return updated[0] ?? null;
  }

  async setPublished(ownerId: string, formId: string, publish: boolean) {
    const now = new Date();
    const updated = await db
      .update(formsTable)
      .set(
        publish
          ? { status: "PUBLISHED", publishedAt: now, unpublishedAt: null, updatedAt: now }
          : { status: "DRAFT", unpublishedAt: now, updatedAt: now },
      )
      .where(and(eq(formsTable.id, formId), eq(formsTable.ownerId, ownerId)))
      .returning();

    return updated[0] ?? null;
  }

  async archive(ownerId: string, formId: string) {
    const now = new Date();
    const updated = await db
      .update(formsTable)
      .set({ status: "ARCHIVED", archivedAt: now, updatedAt: now })
      .where(and(eq(formsTable.id, formId), eq(formsTable.ownerId, ownerId)))
      .returning();
    return updated[0] ?? null;
  }

  async upsertFields(ownerId: string, formId: string, fields: ReadonlyArray<UpsertFormField>) {
    const form = await this.getFormById(ownerId, formId);
    if (!form) return null;

    const existing = await db
      .select()
      .from(formFieldsTable)
      .where(eq(formFieldsTable.formId, formId));

    const existingById = new Map(existing.map((f) => [f.id, f]));
    const incomingIds = fields.map((f) => f.id).filter((id): id is string => !!id);

    const toDelete = existing.filter((f) => !incomingIds.includes(f.id));
    if (toDelete.length) {
      await db.delete(formFieldsTable).where(inArray(formFieldsTable.id, toDelete.map((d) => d.id)));
    }

    for (const field of fields) {
      if (field.id && existingById.has(field.id)) {
        await db
          .update(formFieldsTable)
          .set({
            key: field.key,
            type: field.type,
            label: field.label,
            helpText: field.helpText ?? null,
            placeholder: field.placeholder ?? null,
            required: field.required,
            order: field.order,
            config: field.config ?? {},
            updatedAt: new Date(),
          })
          .where(eq(formFieldsTable.id, field.id));
        continue;
      }

      await db.insert(formFieldsTable).values({
        formId,
        key: field.key,
        type: field.type,
        label: field.label,
        helpText: field.helpText ?? null,
        placeholder: field.placeholder ?? null,
        required: field.required,
        order: field.order,
        config: field.config ?? {},
      });
    }

    return this.getFormWithFieldsById(ownerId, formId);
  }
}

export default FormsService;

