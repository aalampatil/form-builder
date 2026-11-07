import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const api = "http://localhost:8000";

async function sessionToken(page: Page) {
  await clerk.loaded({ page });
  await expect.poll(() => page.evaluate(() => Boolean(window.Clerk?.session))).toBe(true);
  return page.evaluate(() => window.Clerk.session!.getToken());
}

test("anonymous pages stay public and the API rejects absent/invalid/legacy credentials", async ({
  page,
  request,
}) => {
  await setupClerkTestingToken({ page });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sumikami", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  expect((await request.get(`${api}/health`)).status()).toBe(200);
  const credentialCases: Record<string, string>[] = [
    {},
    { Authorization: "Bearer invalid-token" },
    { Cookie: "fb_session=legacy-token" },
  ];
  for (const headers of credentialCases) {
    const response = await request.get(`${api}/api/authentication/me`, { headers });
    expect(response.status()).toBe(401);
  }
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByTestId("account-overview")).toHaveCount(0);
});

test("a respondent-independent Clerk account reaches the API with a stable local identity", async ({
  page,
  request,
}) => {
  await setupClerkTestingToken({ page });
  const email = `sumikami-${randomUUID()}+clerk_test@example.com`;
  const password = `Sumi-${randomUUID()}-9a!`;
  await page.goto("/sign-up");
  await clerk.loaded({ page });
  await page.getByLabel("Email address", { exact: true }).fill(email);
  const passwordInput = page.getByLabel("Password", { exact: true });
  if (await passwordInput.count()) await passwordInput.fill(password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const verification = page.locator('input[autocomplete="one-time-code"]');
  // Development test addresses use the published Clerk test verification code.
  await expect(async () => {
    if (await verification.isVisible()) await verification.fill("424242");
    await expect(page).toHaveURL(/\/dashboard/);
  }).toPass({ timeout: 45_000 });
  await expect(page.getByTestId("account-overview")).toBeVisible();
  const token = await sessionToken(page);
  expect(token).toBeTruthy();
  const response = await request.get(`${api}/api/authentication/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(200);
  const user = await response.json();
  expect(user.id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(user.role).toBe("CREATOR");
  expect(user.email).toBe(email);
  const again = await request.get(`${api}/api/authentication/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect((await again.json()).id).toBe(user.id);
  await clerk.signOut({ page });
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/");
  await clerk.signIn({ page, signInParams: { strategy: "email_code", identifier: email } });
  await page.goto("/dashboard");
  await expect(page.getByTestId("account-overview")).toBeVisible();
  const returningToken = await sessionToken(page);
  const returning = await request.get(`${api}/api/authentication/me`, {
    headers: { Authorization: `Bearer ${returningToken}` },
  });
  expect((await returning.json()).id).toBe(user.id);
});
