import type { Session } from "@qeet-id/react/contract";
import { PERSON } from "./qeet-id.js";

/** A session as the server answers it. */
export function createTestSession(overrides: Partial<Session> = {}): Session {
  return {
    user: { id: PERSON.sub, email: PERSON.email, emailVerified: true, name: PERSON.name, picture: PERSON.picture },
    organization: { id: PERSON.tenant_id, name: "Brightleaf Foods" },
    roles: ["Finance approver"],
    permissions: ["invoice.approve", "invoice.read"],
    expiresAt: "2026-12-05T09:30:00.000Z",
    ...overrides,
  };
}
