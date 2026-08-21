import { env } from "cloudflare:workers";
import { handleTransactionAiRequest, transactionAiJsonSchema, transactionAiPrompt, TRANSACTION_AI_MODEL } from "../../../../lib/transaction-ai";

type WorkersAi = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};

const publicEnv = import.meta.env as ImportMetaEnv & {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
};

const supabaseUrl = publicEnv.VITE_SUPABASE_URL?.trim() || "";
const supabaseAnonKey = publicEnv.VITE_SUPABASE_ANON_KEY?.trim() || "";

const authorize = async (accessToken: string) => {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error("Supabase auth is not configured.");
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return response.ok;
};

export async function POST(request: Request) {
  const workersAi = (env as Record<string, unknown>).AI as WorkersAi | undefined;
  return handleTransactionAiRequest(request, {
    authorize,
    analyze: async (input) => {
      if (!workersAi) throw new Error("Workers AI binding is not configured.");
      return workersAi.run(TRANSACTION_AI_MODEL, {
        messages: [
          { role: "system", content: "You extract financial transaction evidence into a strict JSON draft for human review. Never invent unreadable values." },
          { role: "user", content: transactionAiPrompt(input) },
        ],
        ...(input.imageDataUrl ? { image: input.imageDataUrl } : {}),
        guided_json: transactionAiJsonSchema,
        max_tokens: 400,
        temperature: 0,
      });
    },
  });
}
