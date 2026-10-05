import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeFieldKey,
  makeClientId,
  normalizeFieldKey,
  splitCommaList,
} from "../dist/template-utils.js";

test("normalizes labels into stable field keys", () => {
  assert.equal(normalizeFieldKey("Matric No."), "matric_no");
  assert.equal(normalizeFieldKey("E-mail & Phone"), "e_mail_and_phone");
  assert.equal(normalizeFieldKey("  Départment / Level  "), "department_level");
});

test("falls back to a generic key when labels have no usable characters", () => {
  assert.equal(normalizeFieldKey("!@#$"), "field");
  assert.equal(normalizeFieldKey("   "), "field");
});

test("dedupes field keys with the next available numeric suffix", () => {
  const takenKeys = ["name", "name_2", "name_3", "email"];

  assert.equal(dedupeFieldKey("name", takenKeys), "name_4");
  assert.equal(dedupeFieldKey("department", takenKeys), "department");
});

test("splits comma lists into trimmed non-empty values", () => {
  assert.deepEqual(splitCommaList("Full Name, Name,, Student Name "), [
    "Full Name",
    "Name",
    "Student Name",
  ]);
});

test("creates prefixed client ids for draft-only records", () => {
  const firstId = makeClientId("field");
  const secondId = makeClientId("field");

  assert.match(firstId, /^field_/);
  assert.match(secondId, /^field_/);
  assert.notEqual(firstId, secondId);
});
