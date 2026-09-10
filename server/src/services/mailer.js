import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transporter;

function getTransporter() {
  if (transporter) return transporter;

  if (config.mail.transport === 'smtp' && config.mail.host) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.port === 465,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
    });
  } else {
    // Default for development and pilots: nothing leaves the machine. Messages are
    // serialised so the exact authorized content of each recipient's report can be
    // inspected before real delivery is switched on.
    transporter = nodemailer.createTransport({ jsonTransport: true });
  }
  return transporter;
}

export async function sendMail({ to, subject, text, html }) {
  const message = { from: config.mail.from, to, subject, text, html };
  const result = await getTransporter().sendMail(message);
  if (config.mail.transport !== 'smtp') {
    console.log(`[mail] (not delivered - console transport) to=${to} subject="${subject}"`);
  }
  return result;
}
