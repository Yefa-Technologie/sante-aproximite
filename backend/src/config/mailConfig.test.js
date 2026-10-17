import test from "node:test";
import assert from "node:assert/strict";
import { mailConfig } from "./mailConfig.js";

test("MAIL settings support STARTTLS and named sender", () => {
  const config = mailConfig({ MAIL_HOST: "mail.test", MAIL_PORT: "587", MAIL_USERNAME: "user", MAIL_PASSWORD: "password", MAIL_ENCRYPTION: "tls", MAIL_FROM_ADDRESS: "from@test.invalid", MAIL_FROM_NAME: "Santé" });
  assert.equal(config.smtpHost, "mail.test");
  assert.equal(config.smtpUser, "user");
  assert.equal(config.smtpPass, "password");
  assert.equal(config.smtpSecure, "false");
  assert.equal(config.smtpRequireTLS, true);
  assert.deepEqual(config.mailFrom, { name: "Santé", address: "from@test.invalid" });
});

test("existing SMTP settings retain precedence including explicit false", () => {
  const config = mailConfig({ SMTP_HOST: "smtp.test", MAIL_HOST: "other.test", SMTP_SECURE: "false", MAIL_ENCRYPTION: "ssl", SMTP_PORT: "587", SMTP_USER: "primary", MAIL_USERNAME: "secondary", SMTP_PASS: "primary-pass", MAIL_PASSWORD: "secondary-pass", MAIL_FROM: "from@test.invalid" });
  assert.equal(config.smtpHost, "smtp.test");
  assert.equal(config.smtpSecure, "false");
  assert.equal(config.smtpUser, "primary");
  assert.equal(config.smtpPass, "primary-pass");
  assert.equal(config.mailFrom, "from@test.invalid");
});

test("implicit TLS works with ssl or port 465", () => {
  assert.equal(mailConfig({ MAIL_ENCRYPTION: "ssl" }).smtpSecure, "true");
  assert.equal(mailConfig({ MAIL_PORT: "465" }).smtpSecure, "true");
  assert.equal(mailConfig({}).smtpSecure, "false");
});
