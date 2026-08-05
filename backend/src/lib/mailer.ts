import { createTransport, type Transporter } from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
  close(): Promise<void>;
}

/** Development mailer that prints messages to the server log. */
export class LogMailer implements Mailer {
  constructor(
    private readonly log: (line: string) => void = (line) =>
      console.log(`[mail] ${line}`),
  ) {}

  async send(message: MailMessage): Promise<void> {
    this.log(
      `to=${JSON.stringify(message.to)} subject=${JSON.stringify(message.subject)}\n` +
        message.text,
    );
  }

  async close(): Promise<void> {
    // Nothing to close.
  }
}

/** SMTP mailer using nodemailer. */
export class SmtpMailer implements Mailer {
  readonly #transporter: Transporter;

  constructor(options: {
    host: string;
    port: number;
    user: string | undefined;
    pass: string | undefined;
    from: string;
  }) {
    this.#transporter = createTransport({
      host: options.host,
      port: options.port,
      secure: options.port === 465,
      auth:
        options.user && options.pass
          ? { user: options.user, pass: options.pass }
          : undefined,
    });
    this.from = options.from;
  }

  private readonly from: string;

  async send(message: MailMessage): Promise<void> {
    await this.#transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }

  async close(): Promise<void> {
    this.#transporter.close();
  }
}

export function createMailer(config: {
  driver: "log" | "smtp";
  from: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string | undefined;
  smtpPass: string | undefined;
}): Mailer {
  if (config.driver === "smtp") {
    return new SmtpMailer({
      host: config.smtpHost,
      port: config.smtpPort,
      user: config.smtpUser,
      pass: config.smtpPass,
      from: config.from,
    });
  }
  return new LogMailer();
}
