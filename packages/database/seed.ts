import "dotenv/config";
import bcrypt from "bcryptjs";
import { db, eq, sql } from "./index";
import {
  formFieldsTable,
  formResponseAnswersTable,
  formResponsesTable,
  formsTable,
  themesTable,
  usersTable,
} from "./schema";

function nowMinusDays(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function upsertUser(params: {
  email: string;
  fullName: string;
  password: string;
  role: "CREATOR" | "ADMIN";
}) {
  const email = params.email.toLowerCase();
  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing[0]) return existing[0];

  const passwordHash = await bcrypt.hash(params.password, 12);
  const created = await db
    .insert(usersTable)
    .values({ email, fullName: params.fullName, passwordHash, role: params.role })
    .returning();
  return created[0]!;
}

async function main() {
  const creator = await upsertUser({
    email: "demo@formcraft.dev",
    fullName: "Demo Creator",
    password: "DemoPass123!",
    role: "CREATOR",
  });

  await upsertUser({
    email: "admin@formcraft.dev",
    fullName: "Platform Admin",
    password: "AdminPass123!",
    role: "ADMIN",
  });

  async function upsertTheme(values: typeof themesTable.$inferInsert) {
    const existing = await db.select().from(themesTable).where(eq(themesTable.name, values.name)).limit(1);
    if (existing[0]) return existing[0];
    const created = await db.insert(themesTable).values(values).returning();
    return created[0]!;
  }

  const animeTheme = await upsertTheme({
    name: "Shonen Neon",
    description: "High-contrast neon gradients for energetic anime quizzes.",
    category: "anime",
    palette: { primary: "#7C3AED", accent: "#22D3EE", background: "#050014" },
    typography: { heading: "Space Grotesk", body: "Inter" },
    extras: { vibe: "neon" },
  });

  const movieTheme = await upsertTheme({
    name: "Cinematic Noir",
    description: "Film-grain, deep blacks, and elegant contrast for feedback forms.",
    category: "movies",
    palette: { primary: "#E11D48", accent: "#F59E0B", background: "#0B0B0F" },
    typography: { heading: "Playfair Display", body: "Inter" },
    extras: { vibe: "noir" },
  });

  const gamingTheme = await upsertTheme({
    name: "Pixel Arcade",
    description: "Retro arcade colors for gaming surveys and community polls.",
    category: "games",
    palette: { primary: "#22C55E", accent: "#F97316", background: "#060A1A" },
    typography: { heading: "Press Start 2P", body: "Inter" },
    extras: { vibe: "retro" },
  });

  const publishedAt = nowMinusDays(7);

  async function upsertForm(values: typeof formsTable.$inferInsert) {
    const existing = await db.select().from(formsTable).where(eq(formsTable.slug, values.slug)).limit(1);
    if (existing[0]) return existing[0];
    const created = await db.insert(formsTable).values(values).returning();
    return created[0]!;
  }

  const animeForm = await upsertForm({
    ownerId: creator.id,
    title: "Anime Hype Quiz",
    description: "A fast, fun quiz to reveal your shonen energy level.",
    slug: "anime-hype-quiz",
    status: "PUBLISHED",
    visibility: "PUBLIC",
    themeId: animeTheme.id,
    settings: { notifyOnResponse: true, thankYouTitle: "Sugoi! Response saved." },
    publishedAt,
  });

  const movieForm = await upsertForm({
    ownerId: creator.id,
    title: "Interstellar Movie Feedback",
    description: "Collect feedback like a real studio test screening.",
    slug: "interstellar-feedback",
    status: "PUBLISHED",
    visibility: "UNLISTED",
    themeId: movieTheme.id,
    settings: { notifyOnResponse: true, thankYouTitle: "Thanks — see you among the stars." },
    publishedAt,
  });

  const gamingForm = await upsertForm({
    ownerId: creator.id,
    title: "Pixel Gaming Survey",
    description: "A short survey on your gaming habits and preferences.",
    slug: "pixel-gaming-survey",
    status: "PUBLISHED",
    visibility: "PUBLIC",
    themeId: gamingTheme.id,
    settings: { notifyOnResponse: false, thankYouTitle: "GG! Submission received." },
    publishedAt,
  });

  async function ensureFields(formId: string, values: Array<typeof formFieldsTable.$inferInsert>) {
    const existing = await db.select().from(formFieldsTable).where(eq(formFieldsTable.formId, formId)).limit(1);
    if (existing[0]) return;
    await db.insert(formFieldsTable).values(values);
  }

  await ensureFields(animeForm.id, [
      {
        formId: animeForm.id,
        key: "name",
        type: "SHORT_TEXT",
        label: "Your name",
        required: true,
        order: 0,
        config: { minLength: 2, maxLength: 50 },
      },
      {
        formId: animeForm.id,
        key: "favorite_anime",
        type: "SINGLE_SELECT",
        label: "Pick your favorite",
        required: true,
        order: 1,
        config: { options: ["Naruto", "One Piece", "Attack on Titan", "Jujutsu Kaisen", "Demon Slayer"] },
      },
      {
        formId: animeForm.id,
        key: "hype_level",
        type: "RATING",
        label: "How hype are you today?",
        required: true,
        order: 2,
        config: { min: 1, max: 5 },
      },
      {
        formId: animeForm.id,
        key: "best_arc",
        type: "LONG_TEXT",
        label: "Best arc (and why)",
        required: false,
        order: 3,
        config: { maxLength: 500 },
      },
      {
        formId: animeForm.id,
        key: "email",
        type: "EMAIL",
        label: "Email (optional)",
        required: false,
        order: 4,
        config: {},
      },
    ]);

  await ensureFields(movieForm.id, [
      {
        formId: movieForm.id,
        key: "rating",
        type: "RATING",
        label: "Overall rating",
        required: true,
        order: 0,
        config: { min: 1, max: 10 },
      },
      {
        formId: movieForm.id,
        key: "favorite_scene",
        type: "SHORT_TEXT",
        label: "Favorite scene",
        required: true,
        order: 1,
        config: { maxLength: 120 },
      },
      {
        formId: movieForm.id,
        key: "would_rewatch",
        type: "SINGLE_SELECT",
        label: "Would you rewatch it?",
        required: true,
        order: 2,
        config: { options: ["Absolutely", "Maybe", "Not really"] },
      },
      {
        formId: movieForm.id,
        key: "thoughts",
        type: "LONG_TEXT",
        label: "Any thoughts for the director?",
        required: false,
        order: 3,
        config: { maxLength: 1200 },
      },
      {
        formId: movieForm.id,
        key: "email",
        type: "EMAIL",
        label: "Email (optional)",
        required: false,
        order: 4,
        config: {},
      },
    ]);

  await ensureFields(gamingForm.id, [
      {
        formId: gamingForm.id,
        key: "platforms",
        type: "MULTI_SELECT",
        label: "Platforms you play on",
        required: true,
        order: 0,
        config: { options: ["PC", "PlayStation", "Xbox", "Switch", "Mobile"], minItems: 1, maxItems: 5 },
      },
      {
        formId: gamingForm.id,
        key: "genre",
        type: "DROPDOWN",
        label: "Favorite genre",
        required: true,
        order: 1,
        config: { options: ["RPG", "Shooter", "Strategy", "Indie", "Sports"] },
      },
      {
        formId: gamingForm.id,
        key: "hours_per_week",
        type: "NUMBER",
        label: "Hours per week",
        required: true,
        order: 2,
        config: { min: 0, max: 80 },
      },
      {
        formId: gamingForm.id,
        key: "newsletter",
        type: "CHECKBOX",
        label: "Email me new community events",
        required: false,
        order: 3,
        config: {},
      },
      {
        formId: gamingForm.id,
        key: "email",
        type: "EMAIL",
        label: "Email (optional)",
        required: false,
        order: 4,
        config: {},
      },
    ]);

  async function insertResponse(formId: string, answers: Record<string, unknown>, daysAgo: number) {
    const submittedAt = nowMinusDays(daysAgo);
    const [r] = await db
      .insert(formResponsesTable)
      .values({ formId, status: "COMPLETED", submittedAt, answersSnapshot: answers, meta: {} })
      .returning();

    await db.insert(formResponseAnswersTable).values(
      Object.entries(answers).map(([fieldKey, value]) => ({
        responseId: r!.id,
        fieldKey,
        value,
      })),
    );
  }

  const existingResp = await db
    .select({ c: sql<number>`count(*)` })
    .from(formResponsesTable)
    .where(eq(formResponsesTable.formId, animeForm.id));
  if (Number(existingResp[0]?.c ?? 0) === 0) {
    await insertResponse(animeForm.id, { name: "Aki", favorite_anime: "One Piece", hype_level: 5, best_arc: "Marineford" }, 6);
    await insertResponse(animeForm.id, { name: "Ryo", favorite_anime: "Naruto", hype_level: 4, best_arc: "Pain Arc" }, 5);
    await insertResponse(animeForm.id, { name: "Mina", favorite_anime: "Jujutsu Kaisen", hype_level: 3 }, 4);

    await insertResponse(movieForm.id, { rating: 10, favorite_scene: "Docking", would_rewatch: "Absolutely", thoughts: "Soundtrack is unreal." }, 6);
    await insertResponse(movieForm.id, { rating: 9, favorite_scene: "Tesseract", would_rewatch: "Absolutely" }, 5);
    await insertResponse(movieForm.id, { rating: 8, favorite_scene: "Cornfield chase", would_rewatch: "Maybe" }, 4);

    await insertResponse(gamingForm.id, { platforms: ["PC", "Switch"], genre: "Indie", hours_per_week: 8, newsletter: true }, 6);
    await insertResponse(gamingForm.id, { platforms: ["PC"], genre: "Strategy", hours_per_week: 12 }, 5);
    await insertResponse(gamingForm.id, { platforms: ["Mobile", "PC"], genre: "RPG", hours_per_week: 6 }, 4);
  }

  console.log("Seed complete:");
  console.log("- creator: demo@formcraft.dev / DemoPass123!");
  console.log("- admin: admin@formcraft.dev / AdminPass123!");
  console.log("- forms: anime-hype-quiz, interstellar-feedback, pixel-gaming-survey");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
