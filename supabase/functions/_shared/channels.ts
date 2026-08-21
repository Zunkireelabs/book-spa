export interface ChannelSendInput {
  to: string;
  subject?: string;
  body: string;
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
    private fromAddress: string
  ) {}

  async send({
    to,
    subject,
    body,
  }: ChannelSendInput): Promise<ChannelSendResult> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.fromAddress,
        to,
        subject,
        html: body,
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
  secrets: Record<string, string>
): ChannelProvider {
  if (channel === 'email' && config.provider === 'resend') {
    return new ResendEmailProvider(
      secrets.RESEND_API_KEY,
      config.from_address ?? secrets.RESEND_FROM_ADDRESS
    );
  }
  throw new Error(
    `No provider registered for channel=${channel} provider=${config.provider}`
  );
}
