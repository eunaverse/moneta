import { env } from "cloudflare:workers";
import { analyzeTransactionWithOpenAI, handleTransactionAiRequest } from "../../../../lib/transaction-ai";

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
  const openAiCredential = (env as Record<string, unknown>).MONETA_TRANSACTION_AI_TOKEN;
  return handleTransactionAiRequest(request, {
    authorize,
    analyze: async (input) => {
      if (typeof openAiCredential !== "string") throw new Error("OpenAI is not configured.");
      const result = await analyzeTransactionWithOpenAI(openAiCredential, input);
      return result.output;
    },
  });
}
