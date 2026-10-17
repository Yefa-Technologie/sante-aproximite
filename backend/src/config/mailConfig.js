export function mailConfig(source) {
  const port = source.SMTP_PORT || source.MAIL_PORT || "587";
  const encryption = String(source.MAIL_ENCRYPTION || "").toLowerCase();
  return {
    smtpHost: source.SMTP_HOST || source.MAIL_HOST || "",
    smtpPort: port,
    smtpSecure: source.SMTP_SECURE || String(encryption === "ssl" || (!encryption && Number(port) === 465)),
    smtpRequireTLS: source.SMTP_REQUIRE_TLS === "true" || encryption === "tls" || encryption === "starttls",
    smtpUser: source.SMTP_USER || source.MAIL_USERNAME || "",
    smtpPass: source.SMTP_PASS || source.MAIL_PASSWORD || "",
    mailFrom: source.MAIL_FROM || (source.MAIL_FROM_ADDRESS ? {
      name: source.MAIL_FROM_NAME || "Sante Aproximite",
      address: source.MAIL_FROM_ADDRESS,
    } : ""),
    contactRecipient: source.CONTACT_RECIPIENT || "yefa.technologie@gmail.com",
  };
}
