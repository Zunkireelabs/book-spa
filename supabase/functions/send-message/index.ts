import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveProvider } from '../_shared/channels.ts';

interface MessageRequest {
  message_id: string;
}

interface MessageResponse {
  ok: boolean;
  error?: string;
}

interface OutreachMessage {
  id: string;
  org_id: string;
  channel: string;
  to_address: string;
  subject?: string;
  body: string;
  status: string;
}

interface ProviderConfig {
  provider: string;
  from_address?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Verify Authorization header
  const authHeader = req.headers.get('Authorization');
  const expectedToken = Deno.env.get('CRON_BEARER_TOKEN');

  if (!authHeader || !expectedToken) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Missing authentication configuration',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (authHeader !== `Bearer ${expectedToken}`) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Unauthorized' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Parse request body
  let messageId: string;
  try {
    const body = (await req.json()) as MessageRequest;
    messageId = body.message_id;
    if (!messageId) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing message_id' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (_err) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Invalid JSON' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Create Supabase client with service role key
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase configuration');
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Missing Supabase configuration',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  try {
    // Fetch the outreach message
    const { data: message, error: fetchError } = await supabase
      .from('outreach_messages')
      .select('*')
      .eq('id', messageId)
      .single();

    if (fetchError || !message) {
      console.log(
        `Message not found or fetch failed: ${messageId}, ${fetchError?.message || 'not found'}`
      );
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const msg = message as OutreachMessage;

    // Idempotent: skip if status is not 'sending'
    if (msg.status !== 'sending') {
      console.log(
        `Message ${messageId} status is '${msg.status}', not 'sending' — skipping`
      );
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Look up provider config for (org_id, channel)
    const { data: configData, error: configError } = await supabase
      .from('outreach_provider_config')
      .select('*')
      .eq('org_id', msg.org_id)
      .eq('channel', msg.channel)
      .single();

    if (configError || !configData) {
      const errMsg = `No provider config for org=${msg.org_id} channel=${msg.channel}`;
      console.error(errMsg);
      await supabase
        .from('outreach_messages')
        .update({
          status: 'failed',
          error: errMsg,
          updated_at: new Date().toISOString(),
        })
        .eq('id', messageId);
      return new Response(JSON.stringify({ ok: false, error: errMsg }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const config = configData as ProviderConfig;

    // Resolve provider and send
    const secretsMap: Record<string, string> = {
      RESEND_API_KEY: Deno.env.get('RESEND_API_KEY') || '',
      RESEND_FROM_ADDRESS: Deno.env.get('RESEND_FROM_ADDRESS') || '',
    };

    const provider = resolveProvider(msg.channel, config, secretsMap);

    const result = await provider.send({
      to: msg.to_address,
      subject: msg.subject,
      body: msg.body,
    });

    // Update message: status='sent', sent_at=now(), provider=<name>, provider_message_id=<id>
    const { error: updateError } = await supabase
      .from('outreach_messages')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        provider: config.provider,
        provider_message_id: result.providerMessageId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', messageId);

    if (updateError) {
      console.error(
        `Failed to update message ${messageId}: ${updateError.message}`
      );
      return new Response(
        JSON.stringify({ ok: false, error: updateError.message }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error processing message ${messageId}: ${errorMessage}`);

    // Update message with failure status
    try {
      await supabase
        .from('outreach_messages')
        .update({
          status: 'failed',
          error: errorMessage,
          updated_at: new Date().toISOString(),
        })
        .eq('id', messageId);
    } catch (updateErr) {
      console.error(
        `Failed to update failure status: ${updateErr instanceof Error ? updateErr.message : String(updateErr)}`
      );
    }

    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
