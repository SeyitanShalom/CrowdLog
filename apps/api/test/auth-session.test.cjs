const assert = require("node:assert/strict");
const test = require("node:test");

const { BadRequestException, UnauthorizedException } = require("@nestjs/common");
const { AuthGuard } = require("../dist/auth/auth.guard");
const { AuthService } = require("../dist/auth/auth.service");

function mockFn(implementation) {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
    return implementation?.(...args);
  };

  fn.calls = calls;
  return fn;
}

function createExecutionContext(request) {
  return {
    switchToHttp() {
      return {
        getRequest() {
          return request;
        },
      };
    },
  };
}

test("sign-in normalizes email, creates a session, and currentUser reads it", async () => {
  const user = {
    id: "user_owner",
    email: "owner@example.com",
    name: "Owner User",
    phone: "+2348012345678",
  };
  let createdSession;

  const prisma = {
    user: {
      upsert: mockFn(async (input) => ({
        ...user,
        email: input.where.email,
        name: input.create.name,
        phone: input.create.phone,
      })),
    },
    userSession: {
      create: mockFn(async (input) => {
        createdSession = input.data;
        return { id: "session_owner", ...input.data };
      }),
      findUnique: mockFn(async (input) => {
        assert.equal(input.where.tokenHash, createdSession.tokenHash);

        return {
          id: "session_owner",
          ...createdSession,
          expiresAt: new Date(Date.now() + 60_000),
          user,
        };
      }),
      delete: mockFn(),
    },
    event: {
      findMany: mockFn(async () => []),
      updateMany: mockFn(),
    },
    eventMembership: {
      createMany: mockFn(),
    },
    $transaction: mockFn(),
  };
  const service = new AuthService(prisma);

  const session = await service.signIn({
    email: " OWNER@Example.COM ",
    name: " Owner User ",
    phone: " +2348012345678 ",
  });
  const cookie = service.sessionCookie(session.token, session.expiresAt);
  const currentUser = await service.currentUser(cookie);

  assert.deepEqual(prisma.user.upsert.calls[0][0].where, {
    email: "owner@example.com",
  });
  assert.deepEqual(prisma.user.upsert.calls[0][0].create, {
    email: "owner@example.com",
    name: "Owner User",
    phone: "+2348012345678",
  });
  assert.deepEqual(prisma.user.upsert.calls[0][0].update, {
    name: "Owner User",
    phone: "+2348012345678",
  });
  assert.equal(createdSession.userId, "user_owner");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.deepEqual(currentUser, user);
});

test("sign-in rejects invalid phone numbers before creating a user", async () => {
  const prisma = {
    user: {
      upsert: mockFn(),
    },
  };
  const service = new AuthService(prisma);

  await assert.rejects(
    () => service.signIn({ email: "owner@example.com", phone: "call-me" }),
    BadRequestException,
  );
  assert.equal(prisma.user.upsert.calls.length, 0);
});

test("sign-in rejects invalid email addresses before creating a user", async () => {
  const prisma = {
    user: {
      upsert: mockFn(),
    },
  };
  const service = new AuthService(prisma);

  await assert.rejects(
    () => service.signIn({ email: "not-an-email" }),
    BadRequestException,
  );
  assert.equal(prisma.user.upsert.calls.length, 0);
});

test("currentUser deletes expired sessions and returns null", async () => {
  const prisma = {
    userSession: {
      findUnique: mockFn(async () => ({
        id: "session_expired",
        userId: "user_owner",
        tokenHash: "hash",
        expiresAt: new Date(Date.now() - 60_000),
        user: {
          id: "user_owner",
          email: "owner@example.com",
          name: null,
          phone: null,
        },
      })),
      delete: mockFn(async () => null),
    },
  };
  const service = new AuthService(prisma);
  const cookie = service.sessionCookie(
    "expired-token",
    new Date(Date.now() + 60_000),
  );

  const currentUser = await service.currentUser(cookie);

  assert.equal(currentUser, null);
  assert.deepEqual(prisma.userSession.delete.calls[0][0], {
    where: { id: "session_expired" },
  });
});

test("signOut clears the stored session token hash", async () => {
  let createdSession;
  let deletedHash;
  const prisma = {
    user: {
      upsert: mockFn(async () => ({
        id: "user_owner",
        email: "owner@example.com",
        name: null,
        phone: null,
      })),
    },
    userSession: {
      create: mockFn(async (input) => {
        createdSession = input.data;
        return { id: "session_owner", ...input.data };
      }),
      deleteMany: mockFn(async (input) => {
        deletedHash = input.where.tokenHash;
        return { count: 1 };
      }),
    },
    event: {
      findMany: mockFn(async () => []),
      updateMany: mockFn(),
    },
    eventMembership: {
      createMany: mockFn(),
    },
    $transaction: mockFn(),
  };
  const service = new AuthService(prisma);
  const session = await service.signIn({ email: "owner@example.com" });

  await service.signOut(service.sessionCookie(session.token, session.expiresAt));

  assert.equal(deletedHash, createdSession.tokenHash);
});

test("AuthGuard rejects missing sessions", async () => {
  const guard = new AuthGuard({
    currentUser: mockFn(async () => null),
  });
  const request = { headers: {} };

  await assert.rejects(
    () => guard.canActivate(createExecutionContext(request)),
    UnauthorizedException,
  );
});

test("AuthGuard attaches authenticated users to protected requests", async () => {
  const user = {
    id: "user_owner",
    email: "owner@example.com",
    name: null,
    phone: null,
  };
  const guard = new AuthGuard({
    currentUser: mockFn(async () => user),
  });
  const request = { headers: { cookie: "crowdlog_session=test" } };

  const canActivate = await guard.canActivate(createExecutionContext(request));

  assert.equal(canActivate, true);
  assert.deepEqual(request.user, user);
});
