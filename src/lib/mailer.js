/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The outgoing-mail adapter (FR-AUTH-09/11; SDD v1.1 §2.2).
 *
 * One function, `sendMail({ to, subject, text })`, is all the application sees.
 * Behind it is plain SMTP, so the relay is configuration: the development-only
 * Mailpit catcher locally, a real relay in staging and production. No provider
 * is named in code (V5 is provisional).
 *
 * Messages carry single-use links, so nothing about a message is logged here:
 * nodemailer's own logging is off, and a failure is reported to the caller
 * without the message attached.
 */

import nodemailer from 'nodemailer';

/**
 * @typedef {{ to: string, subject: string, text: string }} MailMessage
 * @typedef {(message: MailMessage) => Promise<void>} SendMail
 */

/**
 * @param {{ host: string, port: number, secure: boolean, user: string, password: string, from: string }} options
 * @returns {SendMail}
 */
export function createSmtpMailer({ host, port, secure, user, password, from }) {
  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass: password } : undefined,
    logger: false,
    debug: false,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  return async function sendMail({ to, subject, text }) {
    await transport.sendMail({ from, to, subject, text });
  };
}
