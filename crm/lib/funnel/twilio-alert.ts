import twilio from "twilio";

export async function sendFailureAlert(message: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const to = process.env.TWILIO_ALERT_TO_NUMBER;
  if (!sid || !token || !from || !to) {
    console.warn("Twilio env vars missing — skipping SMS alert");
    return;
  }
  const client = twilio(sid, token);
  await client.messages.create({ body: `[Anchor Funnel] ${message}`, from, to });
}
