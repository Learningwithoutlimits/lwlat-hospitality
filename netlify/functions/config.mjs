// Tells the pages which Entra app to sign in with. These IDs are not secret.

import { entraConfig } from "../lib/auth.mjs";

export const config = { path: "/api/config" };

export default async () => {
  return new Response(JSON.stringify(entraConfig()), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
