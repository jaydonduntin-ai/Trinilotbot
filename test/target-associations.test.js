import test from "node:test";
import assert from "node:assert/strict";
import { createTargetAssociationQualifier } from "../src/commands/target-associations.js";

const player = { id: 123, username: "example", qualifies: true };
const client = { users: { fetch: async () => ({ username: "linked", globalName: "Linked" }) } };

test("target association qualification requires a verified, unambiguous Discord ID", async () => {
  for (const association of [
    null,
    { verified: false, discordId: "123456789012345678" },
    { verified: true, discordUsername: "matching-name" },
    { verified: true, discordId: "123456789012345678", conflict: true },
  ]) {
    const qualify = createTargetAssociationQualifier({
      client,
      lookup: async () => ({ association }),
    });
    assert.equal(await qualify(player), null);
  }
});

test("target association qualifies a traceable ID and caches the lookup", async () => {
  let calls = 0;
  const qualify = createTargetAssociationQualifier({
    client,
    lookup: async ({ userId }) => {
      calls++;
      assert.equal(userId, 123);
      return { association: { verified: true, discordId: "123456789012345678", source: "Bloxlink" } };
    },
  });
  const [first, second] = await Promise.all([qualify(player), qualify(player)]);
  assert.equal(calls, 1);
  assert.equal(first.discordAssociation.discordUsername, "linked");
  assert.equal(second.discordAssociation.source, "Bloxlink");
});
