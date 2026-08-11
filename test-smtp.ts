#!/usr/bin/env -S deno run --allow-env --allow-net

/**
 * AWS SES SMTP Test Script
 * Tests SMTP connection and sends a test email
 * Usage: deno run --allow-env --allow-net test-smtp.ts
 */

const SMTP_ENDPOINT = Deno.env.get('SMTP_ENDPOINT') ?? 'email-smtp.us-east-1.amazonaws.com';
const SMTP_PORT = parseInt(Deno.env.get('SMTP_PORT') ?? '587', 10);
const SMTP_USERNAME = Deno.env.get('SMTP_USERNAME') ?? '';
const SMTP_PASSWORD = Deno.env.get('SMTP_PASSWORD') ?? '';
const SENDER_EMAIL = Deno.env.get('SENDER_EMAIL') ?? 'noreply@aromaticfamilies.com';
const TEST_TO_EMAIL = 'it@aromatic.sa';

function log(label: string, message: string) {
  console.log(`[${new Date().toISOString()}] ${label}: ${message}`);
}

function buildEmailMessage(
  from: string,
  to: string,
  subject: string,
  text: string,
  html: string,
): string {
  return `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="----BOUNDARY"\r\n\r\n------BOUNDARY\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${text}\r\n------BOUNDARY\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${html}\r\n------BOUNDARY--\r\n`;\n}

async function testSMTPConnection(): Promise<void> {\n  log('INFO', '=== AWS SES SMTP Test ===');\n  log('INFO', `SMTP Endpoint: ${SMTP_ENDPOINT}`);\n  log('INFO', `SMTP Port: ${SMTP_PORT}`);\n  log('INFO', `From: ${SENDER_EMAIL}`);\n  log('INFO', `To: ${TEST_TO_EMAIL}`);\n\n  // Validate credentials\n  if (!SMTP_USERNAME) {\n    log('ERROR', 'SMTP_USERNAME not set');\n    Deno.exit(1);\n  }\n  if (!SMTP_PASSWORD) {\n    log('ERROR', 'SMTP_PASSWORD not set');\n    Deno.exit(1);\n  }\n\n  log('INFO', 'Building test email...');\n  \n  const subject = `Test Email - ${new Date().toISOString()}`;\n  const text = `This is a test email from AWS SES SMTP.\\n\\nTest sent at: ${new Date().toISOString()}`;\n  const html = `\n    <html dir=\"rtl\">\n      <head><meta charset=\"utf-8\"></head>\n      <body style=\"font-family: Arial, sans-serif;\">\n        <h2>تجربة البريد الإلكتروني</h2>\n        <p>هذا بريد تجريبي من نظام ATHAR</p>\n        <p>الوقت: ${new Date().toLocaleString('ar-SA')}</p>\n        <hr>\n        <p style=\"color: #999; font-size: 12px;\">هذا بريد اختبار تلقائي</p>\n      </body>\n    </html>\n  `;\n\n  const message = buildEmailMessage(SENDER_EMAIL, TEST_TO_EMAIL, subject, text, html);\n  log('INFO', `Email message built (${message.length} bytes)`);\n\n  try {\n    log('INFO', `Connecting to SMTP server: ${SMTP_ENDPOINT}:${SMTP_PORT}...`);\n    \n    const url = `smtp://${SMTP_USERNAME}:${SMTP_PASSWORD}@${SMTP_ENDPOINT}:${SMTP_PORT}`;\n    log('DEBUG', `Using connection URL: smtp://${SMTP_USERNAME}:***@${SMTP_ENDPOINT}:${SMTP_PORT}`);\n\n    const response = await fetch(url, {\n      method: 'POST',\n      headers: {\n        'Content-Type': 'message/rfc822',\n      },\n      body: message,\n    });\n\n    log('INFO', `Response Status: ${response.status} ${response.statusText}`);\n\n    if (!response.ok) {\n      const errorText = await response.text();\n      log('ERROR', `SMTP Error: ${response.status} - ${errorText}`);\n      console.error('\\n❌ Email send FAILED');\n      console.error('Response:', errorText);\n      Deno.exit(1);\n    }\n\n    const responseText = await response.text();\n    log('SUCCESS', `Email sent successfully!`);\n    log('INFO', `Response: ${responseText}`);\n    console.log('\\n✅ Email send SUCCESS');\n    console.log(`Email sent to: ${TEST_TO_EMAIL}`);\n  } catch (error) {\n    log('ERROR', `Failed to send email: ${error.message}`);\n    console.error('\\n❌ Email send FAILED');\n    console.error('Error details:', error);\n    Deno.exit(1);\n  }\n}\n\n// Run test\nawait testSMTPConnection();\n