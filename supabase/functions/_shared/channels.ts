export interface ChannelSendInput {
  to: string;
  subject?: string;
  body: string;
  replyTo?: string;
  meta?: Record<string, unknown>;
}

export interface ChannelSendResult {
  providerMessageId: string;
}

export interface ChannelProvider {
  channel: 'email' | 'sms' | 'whatsapp';
  send(input: ChannelSendInput): Promise<ChannelSendResult>;
}

export class ResendEmailProvider implements ChannelProvider {
  channel = 'email' as const;

  constructor(
    private apiKey: string,
    private fromAddress: string,
    private fromName?: string
  ) {}

  private buildFrom(): string {
    if (!this.fromName) return this.fromAddress;
    const needsQuoting = /[",()<>:;\\]/.test(this.fromName);
    const name = needsQuoting
      ? `"${this.fromName.replace(/"/g, '\\"')}"`
      : this.fromName;
    return `${name} <${this.fromAddress}>`;
  }

  async send({
    to,
    subject,
    body,
    replyTo,
  }: ChannelSendInput): Promise<ChannelSendResult> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.buildFrom(),
        to,
        subject,
        html: body,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });

    if (!res.ok) {
      throw new Error(
        `Resend send failed: ${res.status} ${await res.text()}`
      );
    }

    const json = (await res.json()) as { id: string };
    return { providerMessageId: json.id };
  }
}

export function resolveProvider(
  channel: string,
  config: { provider: string; from_address?: string },
  secrets: Record<string, string>,
  fromName?: string
): ChannelProvider {
  if (channel === 'email' && config.provider === 'resend') {
    return new ResendEmailProvider(
      secrets.RESEND_API_KEY,
      config.from_address ?? secrets.RESEND_FROM_ADDRESS,
      fromName
    );
  }
  throw new Error(
    `No provider registered for channel=${channel} provider=${config.provider}`
  );
}

// The business's contact email for Reply-To: Billing settings email, else the org owner's. None (or not an address) -> undefined, so no Reply-To.
export function pickReplyTo(
  settings: Record<string, unknown> | null | undefined,
  ownerEmail?: string | null
): string | undefined {
  for (const c of [settings?.billing_email, ownerEmail]) {
    const v = typeof c === 'string' ? c.trim() : '';
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return v;
  }
  return undefined;
}
