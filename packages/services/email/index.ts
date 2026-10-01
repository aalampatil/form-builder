import nodemailer from "nodemailer";
import { env } from "../env";
import { logger } from "@repo/logger";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

class EmailService {
  private transporter: nodemailer.Transporter | null = null;

  private getTransporter() {
    if (!env.SMTP_URL || !env.EMAIL_FROM) return null;
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport(env.SMTP_URL);
    }
    return this.transporter;
  }

  async send(input: SendEmailInput): Promise<{ ok: true } | { ok: false; reason: string }> {
    const transporter = this.getTransporter();
    if (!transporter || !env.EMAIL_FROM) {
      return { ok: false, reason: "Email is not configured" };
    }

    try {
      await transporter.sendMail({
        from: env.EMAIL_FROM,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });
      return { ok: true };
    } catch (err) {
      logger.error("Email send failed", { err });
      return { ok: false, reason: "Email send failed" };
    }
  }
}

export default EmailService;
