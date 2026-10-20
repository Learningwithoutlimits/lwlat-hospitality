// Checks the Microsoft sign-in token that the pages send with each request.
//
// Needs two Netlify environment variables from the Entra app registration:
//   ENTRA_TENANT_ID   Directory (tenant) ID
//   ENTRA_CLIENT_ID   Application (client) ID
//
// Catering Team members are given the "Catering.Admin" app role in Entra.

import { createRemoteJWKSet, jwtVerify } from "jose";

export const ADMIN_ROLE = "Catering.Admin";

const env = (name) => (process.env[name] || "").trim();
let keys;

export function entraConfig() {
  return { tenantId: env("ENTRA_TENANT_ID"), clientId: env("ENTRA_CLIENT_ID") };
}

// Returns the signed-in person, or null if the token is missing or not valid.
export async function signedInUser(req) {
  const { tenantId, clientId } = entraConfig();
  if (!tenantId || !clientId) throw new Error("ENTRA_TENANT_ID and ENTRA_CLIENT_ID are not set.");

  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;

  keys ??= createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`));
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      audience: clientId,
    });
    if (payload.tid !== tenantId) return null;
    return {
      id: payload.oid,
      name: String(payload.name || ""),
      email: String(payload.email || payload.preferred_username || "").toLowerCase(),
      isAdmin: Array.isArray(payload.roles) && payload.roles.includes(ADMIN_ROLE),
    };
  } catch {
    return null;
  }
}
