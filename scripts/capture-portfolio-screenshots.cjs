const { spawn } = require("node:child_process");
const { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const DEMO_EMAIL = "owner.demo@crowdlog.local";
const DEMO_NAME = "Amina Okafor";
const DEMO_EVENT_TITLE = "Portfolio Demo: Computer Science Seminar";

const SHOTS = [
  ["01-template-builder.png", "portfolio-template-builder"],
  ["02-document-extraction.png", "portfolio-document-extraction"],
  ["03-review-workspace.png", "portfolio-review-workspace"],
  ["04-reporting-panels.png", "portfolio-reporting-panels"],
  ["05-export-actions.png", "portfolio-export-actions"],
];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(__dirname, "..");
  const baseUrl = options.baseUrl ?? "http://localhost:3000";
  const apiHealthUrl = options.apiHealthUrl ?? "http://localhost:4000/health";
  const outDir = resolve(repoRoot, options.outDir ?? "docs/screenshots");
  const chromePath = options.chromePath ?? resolveChromePath();

  if (options.checkOnly) {
    console.log(`Browser: ${chromePath}`);
    console.log(`Output: ${outDir}`);
    console.log(`Frontend: ${baseUrl}`);
    console.log(`API health: ${apiHealthUrl}`);
    return;
  }

  await assertReachable(apiHealthUrl, "CrowdLog API");
  await assertReachable(baseUrl, "CrowdLog web app");
  mkdirSync(outDir, { recursive: true });

  const debuggingPort = 9300 + Math.floor(Math.random() * 500);
  const profileDir = mkdtempSync(join(tmpdir(), "crowdlog-portfolio-chrome-"));
  const chrome = spawnChrome(chromePath, debuggingPort, profileDir);

  try {
    const wsUrl = await waitForWebSocketUrl(debuggingPort);
    const client = await CdpClient.connect(wsUrl);

    try {
      await client.send("Page.enable");
      await client.send("Runtime.enable");
      await client.send("Page.setLifecycleEventsEnabled", { enabled: true });
      await client.send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false,
      });

      await navigate(client, `${baseUrl}/?portfolioDemo=1`);
      await signInIfNeeded(client);
      await waitForDemoEvent(client);

      for (const [fileName, elementId] of SHOTS) {
        await scrollToElement(client, elementId);
        await delay(700);
        const screenshot = await client.send("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
        });

        writeFileSync(join(outDir, fileName), Buffer.from(screenshot.data, "base64"));
        console.log(`Captured ${fileName}`);
      }
    } finally {
      client.close();
    }
  } finally {
    await closeChrome(chrome, profileDir);
  }

  console.log(`Portfolio screenshots saved to ${outDir}`);
}

function parseArgs(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--check-only" || arg === "-CheckOnly") {
      options.checkOnly = true;
    } else if (arg === "--base-url" || arg === "-BaseUrl") {
      options.baseUrl = args[index + 1];
      index += 1;
    } else if (arg === "--api-health-url" || arg === "-ApiHealthUrl") {
      options.apiHealthUrl = args[index + 1];
      index += 1;
    } else if (arg === "--out-dir" || arg === "-OutDir") {
      options.outDir = args[index + 1];
      index += 1;
    } else if (arg === "--chrome-path" || arg === "-ChromePath") {
      options.chromePath = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function resolveChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);

  const browserPath = candidates.find((candidate) => existsSync(candidate));

  if (!browserPath) {
    throw new Error(
      "Chrome or Edge was not found. Pass --chrome-path with a browser executable.",
    );
  }

  return browserPath;
}

async function assertReachable(url, label) {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
  } catch (error) {
    throw new Error(
      `${label} is not reachable at ${url}. Start the API and frontend before capturing screenshots. ${error.message}`,
    );
  }
}

function spawnChrome(chromePath, debuggingPort, profileDir) {
  return spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      `--remote-debugging-port=${debuggingPort}`,
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
}

async function closeChrome(chrome, profileDir) {
  await killChrome(chrome);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(profileDir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) {
        console.warn(
          `Could not remove temporary Chrome profile at ${profileDir}: ${error.message}`,
        );
        return;
      }

      await delay(250 * (attempt + 1));
    }
  }
}

function killChrome(chrome) {
  if (!chrome.pid || chrome.exitCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolveKill) => {
    const timeout = setTimeout(resolveKill, 5000);

    chrome.once("exit", () => {
      clearTimeout(timeout);
      resolveKill();
    });

    if (process.platform === "win32") {
      const taskkill = spawn("taskkill", ["/pid", String(chrome.pid), "/T", "/F"], {
        stdio: "ignore",
      });

      taskkill.once("exit", () => undefined);
      taskkill.once("error", () => {
        chrome.kill();
      });

      return;
    }

    chrome.kill();
  });
}

async function waitForWebSocketUrl(port) {
  const targetsUrl = `http://127.0.0.1:${port}/json/list`;
  const startedAt = Date.now();

  while (Date.now() - startedAt < 15000) {
    try {
      const response = await fetch(targetsUrl);

      if (response.ok) {
        const targets = await response.json();
        const page = targets.find(
          (target) => target.type === "page" && target.webSocketDebuggerUrl,
        );

        if (page?.webSocketDebuggerUrl) {
          return page.webSocketDebuggerUrl;
        }
      }
    } catch {
      // Chrome is still starting.
    }

    await delay(200);
  }

  throw new Error("Chrome did not expose a debugging WebSocket in time.");
}

async function navigate(client, url) {
  const loaded = client.waitForEvent("Page.loadEventFired", 15000);

  await client.send("Page.navigate", { url });
  await loaded.catch(() => undefined);
}

async function signInIfNeeded(client) {
  await waitForCondition(
    client,
    `Boolean(document.querySelector('input[type="email"]')) || document.body.innerText.includes(${JSON.stringify(DEMO_EVENT_TITLE)})`,
    15000,
    "sign-in form or demo event",
  );

  const result = await evaluate(
    client,
    `
      (() => {
        const emailInput = document.querySelector('input[type="email"]');

        if (!emailInput) {
          return 'already-signed-in';
        }

        const inputs = Array.from(document.querySelectorAll('input'));
        const nameInput = inputs.find((input) => input !== emailInput && input.placeholder?.toLowerCase().includes('name'));
        const setValue = (input, value) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        };

        setValue(emailInput, ${JSON.stringify(DEMO_EMAIL)});

        if (nameInput) {
          setValue(nameInput, ${JSON.stringify(DEMO_NAME)});
        }

        const form = emailInput.closest('form');

        if (form?.requestSubmit) {
          form.requestSubmit();
        } else if (form) {
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }

        return 'submitted';
      })()
    `,
  );

  console.log(`Sign-in state: ${result}`);
}

async function waitForDemoEvent(client) {
  await waitForCondition(
    client,
    `
      (() => {
        const text = document.body.innerText;
        const controlValues = Array.from(
          document.querySelectorAll('input, textarea, select'),
        )
          .map((element) => element.value)
          .join(' ');

        return (
          (text + ' ' + controlValues).includes(${JSON.stringify(DEMO_EVENT_TITLE)}) &&
          controlValues.includes('Ada Morgan') &&
          text.includes('Export Excel')
        );
      })()
    `,
    30000,
    "portfolio demo event",
  ).catch(async (error) => {
    const pageState = await evaluate(
      client,
      `
        (() => {
          const text = document.body.innerText.slice(0, 1000);
          const controlValues = Array.from(
            document.querySelectorAll('input, textarea, select'),
          )
            .map((element) => element.value)
            .filter(Boolean)
            .slice(0, 40)
            .join('\\n');

          return text + '\\n\\nControl values:\\n' + controlValues;
        })()
      `,
    );

    throw new Error(`${error.message}\nVisible page state:\n${pageState}`);
  });
}

async function scrollToElement(client, elementId) {
  const result = await evaluate(
    client,
    `
      (() => {
        const element = document.getElementById(${JSON.stringify(elementId)});

        if (!element) {
          return false;
        }

        element.scrollIntoView({ block: 'start', inline: 'nearest' });
        return true;
      })()
    `,
  );

  if (!result) {
    throw new Error(`Could not find screenshot element: ${elementId}`);
  }
}

async function waitForCondition(client, expression, timeoutMs, label) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const value = await evaluate(client, `Boolean(${expression})`);

    if (value) {
      return;
    }

    await delay(300);
  }

  throw new Error(`Timed out waiting for ${label}.`);
}

async function evaluate(client, expression) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.text ?? "Runtime.evaluate failed.",
    );
  }

  return response.result?.value;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

class CdpClient {
  static async connect(wsUrl) {
    const client = new CdpClient(wsUrl);

    await client.open();

    return client;
  }

  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.eventWaiters = new Map();
  }

  open() {
    return new Promise((resolveOpen, rejectOpen) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener("open", () => resolveOpen());
      this.ws.addEventListener("error", (event) => {
        rejectOpen(new Error(event.message ?? "WebSocket failed."));
      });
      this.ws.addEventListener("message", (event) => {
        this.handleMessage(String(event.data));
      });
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;

    const message = JSON.stringify({ id, method, params });

    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend });
      this.ws.send(message);
    });
  }

  waitForEvent(method, timeoutMs) {
    return new Promise((resolveEvent, rejectEvent) => {
      const timeout = setTimeout(() => {
        const waiters = this.eventWaiters.get(method) ?? [];
        this.eventWaiters.set(
          method,
          waiters.filter((waiter) => waiter.resolve !== resolveEvent),
        );
        rejectEvent(new Error(`Timed out waiting for ${method}.`));
      }, timeoutMs);

      const waiter = {
        resolve: (params) => {
          clearTimeout(timeout);
          resolveEvent(params);
        },
      };

      this.eventWaiters.set(method, [
        ...(this.eventWaiters.get(method) ?? []),
        waiter,
      ]);
    });
  }

  handleMessage(rawMessage) {
    const message = JSON.parse(rawMessage);

    if (message.id) {
      const pending = this.pending.get(message.id);

      if (!pending) {
        return;
      }

      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result ?? {});
      }

      return;
    }

    if (message.method) {
      const waiters = this.eventWaiters.get(message.method) ?? [];
      const [waiter, ...remainingWaiters] = waiters;

      if (waiter) {
        this.eventWaiters.set(message.method, remainingWaiters);
        waiter.resolve(message.params);
      }
    }
  }

  close() {
    this.ws.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
