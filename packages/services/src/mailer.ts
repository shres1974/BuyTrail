/**
 * Email delivery adapter. Local mode sends to Mailpit; "disabled" records nothing externally.
 * Errors are classified so the delivery state machine can distinguish a definite non-send from
 * an ambiguous outcome (Section 21.1).
 */
import nodemailer from "nodemailer";
import type { AppConfig } from "@buytrail/config";

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Stable per logical delivery; used as Message-ID for reconciliation. */
  idempotencyKey: string;
};

export type SendResult = { providerMessageId: string };

export type SendFailureKind = "not_sent_retryable" | "permanent" | "ambiguous";

export class SendError extends Error {
  constructor(
    public readonly kind: SendFailureKind,
    message: string,
  ) {
    super(message);
  }
}

export interface Mailer {
  readonly mode: AppConfig["EMAIL_MODE"];
  send(email: OutgoingEmail): Promise<SendResult>;
  /** Look up whether a message with this idempotency key was accepted. null = unknown. */
  lookup(idempotencyKey: string): Promise<{ accepted: boolean } | null>;
}

export function messageIdFor(idempotencyKey: string, domain = "buytrail.local"): string {
  return `<${idempotencyKey.replace(/[^A-Za-z0-9._-]/g, "-")}@${domain}>`;
}

export function createMailer(config: AppConfig): Mailer {
  if (config.EMAIL_MODE === "disabled") {
    return {
      mode: "disabled",
      async send() {
        throw new SendError("permanent", "Email delivery is disabled in this environment");
      },
      async lookup() {
        return null;
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.EMAIL_MODE === "smtp" && config.SMTP_PORT === 465,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? "" } : undefined,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 15_000,
  });
  return {
    mode: config.EMAIL_MODE,
    async send(email) {
      const messageId = messageIdFor(email.idempotencyKey);
      try {
        const info = await transport.sendMail({
          from: config.EMAIL_FROM,
          to: email.to,
          subject: email.subject,
          text: email.text,
          html: email.html,
          messageId,
          headers: { "X-BuyTrail-Delivery": email.idempotencyKey },
        });
        return { providerMessageId: info.messageId ?? messageId };
      } catch (e) {
        throw classifySmtpError(e);
      }
    },
    async lookup(idempotencyKey) {
      if (config.EMAIL_MODE !== "local") return null; // no documented status API configured
      try {
        const q = encodeURIComponent(`message-id:"${messageIdFor(idempotencyKey).slice(1, -1)}"`);
        const r = await fetch(`${config.MAILPIT_API_URL}/api/v1/search?query=${q}`, { signal: AbortSignal.timeout(3000) });
        if (!r.ok) return null;
        const j = (await r.json()) as { messages_count?: number };
        return { accepted: (j.messages_count ?? 0) > 0 };
      } catch {
        return null;
      }
    },
  };
}

export function classifySmtpError(e: unknown): SendError {
  const err = e as { code?: string; responseCode?: number; message?: string };
  const msg = err.message ?? String(e);
  // Connection could not be established: the message definitely was not handed over.
  if (err.code === "ECONNECTION" || err.code === "EDNS" || /ECONNREFUSED|ENOTFOUND/.test(msg)) {
    return new SendError("not_sent_retryable", msg);
  }
  if (err.responseCode && err.responseCode >= 500) return new SendError("permanent", msg);
  if (err.responseCode && err.responseCode >= 400) return new SendError("not_sent_retryable", msg);
  if (err.code === "EENVELOPE") return new SendError("permanent", msg);
  // Timeouts / socket errors mid-conversation: the server may have accepted the message.
  return new SendError("ambiguous", msg);
}
