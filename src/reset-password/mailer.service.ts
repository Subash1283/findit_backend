import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailerService {
  private transporter: any;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
      },
    });
  }

  async sendMail(to: string, subject: string, html: string) {
    await this.transporter.sendMail({
      from: `"Findit" <${process.env.SMTP_USER || 'noreply@findit.com'}>`,
      to,
      subject,
      html,
    });
  }

  async sendMailWithAttachments(
    to: string,
    subject: string,
    html: string,
    attachments: { filename: string; path: string; cid: string }[],
  ) {
    await this.transporter.sendMail({
      from: `"FindIT" <${process.env.SMTP_USER || 'noreply@findit.com'}>`,
      to,
      subject,
      html,
      attachments,
    });
  }
}
