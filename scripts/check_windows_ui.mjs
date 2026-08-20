#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import process from "node:process";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] || null;
}

const port = Number(argument("--port"));
const screenshotPath = argument("--screenshot");
const targetId = argument("--target-id");
const diagnose = process.argv.includes("--diagnose");
if (!Number.isInteger(port) || port < 1 || !screenshotPath) {
  throw new Error("usage: check_windows_ui.mjs --port <port> --screenshot <png>");
}

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
  response.json(),
);
const target = targets.find(
  (candidate) =>
    candidate.type === "page" &&
    (targetId ? candidate.id === targetId : candidate.url === "app://-/index.html"),
);
if (!target?.webSocketDebuggerUrl) {
  throw new Error("Codex main renderer target was not found");
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const errors = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id != null) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    errors.push(message.params.exceptionDetails.text || "renderer exception");
  }
  if (
    message.method === "Runtime.consoleAPICalled" &&
    message.params.type === "error"
  ) {
    errors.push("console.error");
  }
  if (
    message.method === "Log.entryAdded" &&
    message.params.entry.level === "error"
  ) {
    errors.push("log.error");
  }
});

function call(method, params = {}) {
  const id = ++nextId;
  const response = new Promise((resolve, reject) =>
    pending.set(id, { resolve, reject }),
  );
  socket.send(JSON.stringify({ id, method, params }));
  return response;
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function evaluate(expression) {
  const result = await call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "renderer evaluation failed");
  }
  return result.result.value;
}

try {
  await Promise.all([
    call("Page.enable"),
    call("Runtime.enable"),
    call("Log.enable"),
  ]);
  await pause(2_000);
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await pause(500);

  const trigger = await evaluate(`(() => {
    const allElements = (root = document) => {
      const elements = [...root.querySelectorAll("*")];
      for (const element of [...elements]) {
        if (element.shadowRoot) elements.push(...allElements(element.shadowRoot));
        if (element.tagName === "IFRAME" && element.contentDocument) {
          elements.push(...allElements(element.contentDocument));
        }
      }
      return elements;
    };
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" &&
        rect.width > 0 && rect.height > 0;
    };
    const globalRect = (element) => {
      const rect = element.getBoundingClientRect();
      let left = rect.left;
      let top = rect.top;
      let view = element.ownerDocument.defaultView;
      while (view?.frameElement) {
        const frameRect = view.frameElement.getBoundingClientRect();
        left += frameRect.left;
        top += frameRect.top;
        view = view.parent;
      }
      return { left, top, width: rect.width, height: rect.height };
    };
    const interactive = allElements().filter((element) =>
      element.matches("button,a,[role=button],[tabindex]"),
    );
    const candidates = interactive
      .filter(visible)
      .map((element) => ({ element, rect: globalRect(element) }))
      .filter(
        ({ rect }) =>
          rect.left < innerWidth * 0.4 &&
          rect.top > innerHeight * 0.6 &&
          rect.top < innerHeight &&
          rect.left + rect.width > 0,
      )
      .sort((left, right) => right.rect.top - left.rect.top || right.rect.width - left.rect.width);
    const selected =
      candidates.find(
        ({ element, rect }) =>
          element.getAttribute("aria-haspopup") === "menu" &&
          rect.left < innerWidth * 0.2,
      ) || candidates[0];
    if (!selected) return {
      x: null,
      y: null,
      viewport: [innerWidth, innerHeight],
      interactiveCount: interactive.length,
      elementCount: allElements().length,
      bodyChildren: [...document.body.children].map((element) => element.tagName),
      bodyTextLength: document.body.innerText.length,
      tagCounts: allElements().reduce((counts, element) => {
        counts[element.tagName] = (counts[element.tagName] || 0) + 1;
        return counts;
      }, {}),
      embeddedSources: allElements()
        .filter((element) => element.tagName === "IFRAME" || element.tagName === "WEBVIEW")
        .map((element) => ({ tag: element.tagName, source: element.getAttribute("src") })),
      frames: [...document.querySelectorAll("iframe")].map((frame) => ({
        url: frame.contentDocument?.URL || null,
        readyState: frame.contentDocument?.readyState || null,
        bodyChildren: [...(frame.contentDocument?.body?.children || [])].map((element) => element.tagName),
        bodyTextLength: frame.contentDocument?.body?.innerText?.length || 0,
      })),
    };
    return {
      x: selected.rect.left + selected.rect.width / 2,
      y: selected.rect.top + selected.rect.height / 2,
      candidates: candidates.slice(0, 12).map(({ element, rect }) => ({
        tag: element.tagName,
        role: element.getAttribute("role"),
        hasPopup: element.getAttribute("aria-haspopup"),
        testId: element.getAttribute("data-testid"),
        className: typeof element.className === "string" ? element.className.slice(0, 120) : "",
        rect,
      })),
    };
  })()`);
  if (trigger?.x == null) {
    throw new Error(`profile menu trigger was not found: ${JSON.stringify(trigger)}`);
  }
  if (diagnose) {
    console.log(JSON.stringify(trigger, null, 2));
    socket.close();
    process.exit(0);
  }
  const openedAt = Date.now();
  await call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    clickCount: 1,
    x: trigger.x,
    y: trigger.y,
  });
  await call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    clickCount: 1,
    x: trigger.x,
    y: trigger.y,
  });
  let menuLoaded = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      await evaluate(`([...document.querySelectorAll("*")]).some((element) =>
        element.innerText?.trim() === "Add another subscription" &&
        element.getBoundingClientRect().right < innerWidth * 0.25 &&
        element.getBoundingClientRect().width > 0 &&
        element.getBoundingClientRect().height > 0)`)
    ) {
      menuLoaded = true;
      break;
    }
    await pause(100);
  }
  const menuLoadMilliseconds = menuLoaded ? Date.now() - openedAt : null;

  const result = await evaluate(`(() => {
    const collectText = (root) => {
      let text = root.body?.innerText || root.innerText || "";
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) text += "\\n" + collectText(element.shadowRoot);
        if (element.tagName === "IFRAME" && element.contentDocument) {
          text += "\\n" + collectText(element.contentDocument);
        }
      }
      return text;
    };
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" &&
        rect.width > 0 && rect.height > 0;
    };
    const add = [...document.querySelectorAll("*")].find((element) =>
      visible(element) &&
      element.innerText?.trim() === "Add another subscription" &&
      element.getBoundingClientRect().right < innerWidth * 0.25
    );
    let menu = add;
    while (
      menu &&
      !(menu.innerText.includes("Usage remaining") && /connected subscriptions?/.test(menu.innerText))
    ) {
      menu = menu.parentElement;
    }
    const text = menu ? collectText(menu) : "";
    return {
      menuScopeFound: Boolean(menu),
      addSubscriptionVisible: text.includes("Add another subscription"),
      connectedSubscriptionsVisible: /connected subscriptions?/.test(text),
      accountIdentifierVisible: text.includes("@") && !text.includes("••••"),
      continueSignInAbsent: !text.includes("Continue sign-in"),
      browserManagerAbsent: !text.includes("Manage Codex Subscriptions"),
    };
  })()`);
  const screenshot = await call("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  await call("Input.dispatchMouseEvent", {
    type: "mousePressed", button: "left", clickCount: 1, x: trigger.x, y: trigger.y,
  });
  await call("Input.dispatchMouseEvent", {
    type: "mouseReleased", button: "left", clickCount: 1, x: trigger.x, y: trigger.y,
  });
  await pause(300);
  const closesOnSecondClick = await evaluate(`!([...document.querySelectorAll("*")]).some((element) =>
    element.innerText?.trim() === "Add another subscription" &&
    element.getBoundingClientRect().right < innerWidth * 0.25 &&
    element.getBoundingClientRect().width > 0 &&
    element.getBoundingClientRect().height > 0)`);

  const passed =
    result.menuScopeFound &&
    result.addSubscriptionVisible &&
    result.connectedSubscriptionsVisible &&
    result.accountIdentifierVisible &&
    result.continueSignInAbsent &&
    result.browserManagerAbsent &&
    menuLoadMilliseconds <= 1_000 &&
    closesOnSecondClick &&
    errors.length === 0;
  console.log(JSON.stringify({
    ...result,
    menuLoadMilliseconds,
    closesOnSecondClick,
    consoleErrors: errors.length,
    passed,
  }));
  if (!passed) process.exitCode = 1;
} finally {
  socket.close();
}
