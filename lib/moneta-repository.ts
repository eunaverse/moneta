import type { MonetaSnapshot } from "./moneta-types";
import { isE2EMode } from "./e2e-mode";
import { supabase } from "./supabase";

const RECEIPT_BUCKET = "receipts";

export type MonetaStateRecord = {
  state: MonetaSnapshot;
  updatedAt: string;
};

export class MonetaStateConflictError extends Error {
  constructor() {
    super("A newer version was saved from another window.");
    this.name = "MonetaStateConflictError";
  }
}

const requireClient = () => {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
};

export async function loadMonetaState(userId: string): Promise<MonetaStateRecord | null> {
  if (isE2EMode) return null;
  const client = requireClient();
  const { data, error } = await client
    .from("finance_states")
    .select("state, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    state: data.state as MonetaSnapshot,
    updatedAt: data.updated_at as string,
  };
}

export async function saveMonetaState(userId: string, state: MonetaSnapshot, expectedUpdatedAt: string | null): Promise<MonetaStateRecord> {
  if (isE2EMode) return { state, updatedAt: new Date().toISOString() };
  const client = requireClient();
  const values = { user_id: userId, schema_version: state.version, state };
  const request = expectedUpdatedAt
    ? client.from("finance_states").update(values).eq("user_id", userId).eq("updated_at", expectedUpdatedAt)
    : client.from("finance_states").insert(values);
  const { data, error } = await request.select("state, updated_at").maybeSingle();
  if (error?.code === "23505") throw new MonetaStateConflictError();
  if (error) throw error;
  if (!data) throw new MonetaStateConflictError();
  return {
    state: data.state as MonetaSnapshot,
    updatedAt: data.updated_at as string,
  };
}

export function subscribeMonetaState(userId: string, onChange: (record: MonetaStateRecord) => void) {
  if (isE2EMode) return () => undefined;
  const client = requireClient();
  const channel = client
    .channel(`finance-state:${userId}:${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "finance_states", filter: `user_id=eq.${userId}` },
      (payload) => {
        const row = payload.new as { user_id?: string; state?: MonetaSnapshot; updated_at?: string };
        if (row.user_id !== userId || !row.state || !row.updated_at) return;
        onChange({ state: row.state, updatedAt: row.updated_at });
      },
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}

const safeExtension = (file: File) => {
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension && /^[a-z0-9]{2,5}$/.test(extension) ? extension : "jpg";
};

export async function uploadReceipt(userId: string, transactionId: string, file: File, previousPath?: string) {
  if (isE2EMode) return `${userId}/${transactionId}.${safeExtension(file)}`;
  const client = requireClient();
  const path = `${userId}/${transactionId}-${crypto.randomUUID()}.${safeExtension(file)}`;
  const { error } = await client.storage.from(RECEIPT_BUCKET).upload(path, file, {
    cacheControl: "3600",
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw error;
  if (previousPath && previousPath !== path) await removeReceipt(previousPath).catch(() => undefined);
  return path;
}

export async function removeReceipt(path: string) {
  if (isE2EMode) return;
  const client = requireClient();
  const { error } = await client.storage.from(RECEIPT_BUCKET).remove([path]);
  if (error) throw error;
}

export async function createReceiptUrls(paths: string[]) {
  if (isE2EMode) return {};
  if (paths.length === 0) return {};
  const client = requireClient();
  const uniquePaths = Array.from(new Set(paths));
  const { data, error } = await client.storage.from(RECEIPT_BUCKET).createSignedUrls(uniquePaths, 60 * 60);
  if (error) throw error;
  return Object.fromEntries(data.flatMap((item) => item.signedUrl ? [[item.path, item.signedUrl]] : []));
}
