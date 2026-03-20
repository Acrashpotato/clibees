import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { computed, nextTick, ref } from "vue";

import { startSessionTerminal } from "../../../api";
import type { SessionDetailMessageItemView } from "../../../detail-projection";

export interface ChatMessageView {
  id: string;
  senderLabel: string;
  timestamp: string;
  text: string;
  stream: "stdout" | "stderr" | "stdin";
  sourceMode: string;
  role: "user" | "agent";
}

interface UseLiveSessionTerminalOptions {
  getRunId: () => string;
  getSessionId: () => string;
  getAgentMessages: () => SessionDetailMessageItemView[];
}

export function useLiveSessionTerminal(options: UseLiveSessionTerminalOptions) {
  const liveTerminalMount = ref<HTMLElement | null>(null);
  const liveTerminalStatus = ref<"idle" | "connecting" | "connected" | "closed">("idle");
  const liveTerminalError = ref("");
  const liveTerminalConnecting = ref(false);
  const liveTerminalAutoConnectKey = ref("");
  const pendingInitialPrompt = ref("");
  const initialPromptSentKey = ref("");
  const chatInput = ref("");
  const localUserMessages = ref<Array<{
    id: string;
    timestamp: string;
    text: string;
  }>>([]);

  const localMessageDedupeKeys = new Set<string>();
  let initialPromptTimer: ReturnType<typeof setTimeout> | undefined;
  let liveTerminal: Terminal | undefined;
  let liveFitAddon: FitAddon | undefined;
  let liveSocket: WebSocket | undefined;
  let liveInputDisposable: { dispose: () => void } | undefined;
  let windowResizeHandler: (() => void) | undefined;

  function normalizeChatText(text: string): string {
    return text
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .join("\n")
      .trim();
  }

  function mergeChatText(existing: string, incoming: string): string {
    if (!incoming) {
      return existing;
    }
    if (!existing) {
      return incoming;
    }
    if (existing === incoming || existing.endsWith(incoming)) {
      return existing;
    }
    if (incoming.includes(existing)) {
      return incoming;
    }
    if (existing.includes(incoming) && incoming.length <= 120) {
      return existing;
    }
    return `${existing}\n${incoming}`.trim();
  }

  function timestampMs(timestamp: string): number {
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function createLocalMessageId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  function pushLocalUserMessage(text: string, dedupeKey?: string): void {
    const normalized = text.trim();
    if (!normalized) {
      return;
    }
    if (dedupeKey) {
      if (localMessageDedupeKeys.has(dedupeKey)) {
        return;
      }
      localMessageDedupeKeys.add(dedupeKey);
    }
    localUserMessages.value = [
      ...localUserMessages.value,
      {
        id: createLocalMessageId("chat-user"),
        timestamp: new Date().toISOString(),
        text: normalized,
      },
    ];
  }

  function getCurrentInitialPromptKey(): string {
    return `${options.getRunId()}::${options.getSessionId()}::${pendingInitialPrompt.value}`;
  }

  function buildWsUrl(wsPath: string): string {
    if (wsPath.startsWith("ws://") || wsPath.startsWith("wss://")) {
      return wsPath;
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${wsPath}`;
  }

  function sendSocketMessage(payload: unknown): boolean {
    if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) {
      return false;
    }
    liveSocket.send(JSON.stringify(payload));
    return true;
  }

  function sendPendingInitialPrompt(): void {
    const prompt = pendingInitialPrompt.value.trim();
    if (!prompt) {
      return;
    }

    const key = getCurrentInitialPromptKey();
    if (initialPromptSentKey.value === key) {
      return;
    }

    const sent = sendSocketMessage({
      type: "input",
      data: `${prompt}\r`,
    });
    if (sent) {
      initialPromptSentKey.value = key;
      pushLocalUserMessage(prompt, `initial:${key}`);
    }
  }

  function scheduleInitialPromptSend(delayMs = 1200): void {
    if (!pendingInitialPrompt.value.trim()) {
      return;
    }
    if (initialPromptSentKey.value === getCurrentInitialPromptKey()) {
      return;
    }
    clearTimeout(initialPromptTimer);
    initialPromptTimer = setTimeout(() => {
      sendPendingInitialPrompt();
    }, delayMs);
  }

  function ensureLiveTerminal(): void {
    if (!liveTerminalMount.value || liveTerminal) {
      return;
    }

    liveTerminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: "Consolas, 'Courier New', monospace",
      fontSize: 13,
      theme: {
        background: "#031018",
        foreground: "#d6e6f2",
      },
      scrollback: 5000,
    });
    liveFitAddon = new FitAddon();
    liveTerminal.loadAddon(liveFitAddon);
    liveTerminal.open(liveTerminalMount.value);
    liveFitAddon.fit();
  }

  function sendResize(): void {
    if (!liveTerminal) {
      return;
    }
    sendSocketMessage({
      type: "resize",
      cols: liveTerminal.cols,
      rows: liveTerminal.rows,
    });
  }

  function attachLiveInput(): void {
    if (!liveTerminal) {
      return;
    }
    liveInputDisposable?.dispose();
    liveInputDisposable = liveTerminal.onData((data) => {
      sendSocketMessage({
        type: "input",
        data,
      });
    });
  }

  function resetLiveTerminalState(): void {
    liveSocket = undefined;
    liveInputDisposable?.dispose();
    liveInputDisposable = undefined;
    clearTimeout(initialPromptTimer);
    initialPromptTimer = undefined;
    if (windowResizeHandler) {
      window.removeEventListener("resize", windowResizeHandler);
      windowResizeHandler = undefined;
    }
  }

  function disconnectLiveTerminal(): void {
    if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
      liveSocket.close(1000, "leave-session");
    }
    resetLiveTerminalState();
    if (liveTerminalStatus.value === "connected" || liveTerminalStatus.value === "connecting") {
      liveTerminalStatus.value = "closed";
    }
  }

  async function connectLiveTerminal(): Promise<void> {
    if (!options.getRunId() || !options.getSessionId() || liveTerminalConnecting.value) {
      return;
    }

    await nextTick();
    ensureLiveTerminal();
    if (!liveTerminal || !liveFitAddon) {
      liveTerminalError.value = "终端容器未就绪。";
      return;
    }

    disconnectLiveTerminal();
    liveTerminal.clear();
    liveTerminalConnecting.value = true;
    liveTerminalStatus.value = "connecting";
    liveTerminalError.value = "";
    liveTerminal.writeln("正在启动实时终端...");

    try {
      const bootstrap = await startSessionTerminal(options.getRunId(), options.getSessionId(), {
        cols: liveTerminal.cols,
        rows: liveTerminal.rows,
        launchCli: true,
      });
      const wsUrl = buildWsUrl(bootstrap.wsPath);
      const socket = new WebSocket(wsUrl);
      liveSocket = socket;

      socket.addEventListener("open", () => {
        liveTerminalStatus.value = "connected";
        liveFitAddon?.fit();
        sendResize();
        attachLiveInput();
        scheduleInitialPromptSend();
        windowResizeHandler = () => {
          liveFitAddon?.fit();
          sendResize();
        };
        window.addEventListener("resize", windowResizeHandler);
        liveTerminal?.focus();
      });

      socket.addEventListener("message", (event) => {
        let payload: unknown;
        try {
          payload = JSON.parse(String(event.data));
        } catch {
          liveTerminal?.writeln("\r\n[系统] 收到无效终端消息。");
          return;
        }

        if (typeof payload !== "object" || payload === null) {
          return;
        }

        const record = payload as {
          type?: unknown;
          data?: unknown;
          message?: unknown;
          exitCode?: unknown;
        };

        if (record.type === "output" && typeof record.data === "string") {
          liveTerminal?.write(record.data);
          if (record.data.includes("OpenAI Codex")) {
            sendPendingInitialPrompt();
          }
          return;
        }

        if (record.type === "error" && typeof record.message === "string") {
          liveTerminal?.writeln(`\r\n[system] ${record.message}`);
          return;
        }

        if (record.type === "exit") {
          const exitCode = typeof record.exitCode === "number" ? record.exitCode : 0;
          liveTerminal?.writeln(`\r\n[system] shell exited (${exitCode}).`);
          liveTerminalStatus.value = "closed";
        }
      });

      socket.addEventListener("close", () => {
        if (liveTerminalStatus.value !== "closed") {
          liveTerminalStatus.value = "closed";
        }
        resetLiveTerminalState();
      });

      socket.addEventListener("error", () => {
        liveTerminalError.value = "实时终端连接失败。";
      });
    } catch (caught) {
      liveTerminalStatus.value = "closed";
      liveTerminalError.value = caught instanceof Error ? caught.message : String(caught);
      liveTerminal.writeln(`\r\n[system] ${liveTerminalError.value}`);
    } finally {
      liveTerminalConnecting.value = false;
    }
  }

  function sendChatInput(): void {
    const message = chatInput.value.trim();
    if (!message) {
      return;
    }

    const sent = sendSocketMessage({
      type: "input",
      data: `${message}\r`,
    });
    if (!sent) {
      liveTerminalError.value = "实时终端未连接，无法发送消息。";
      return;
    }

    pushLocalUserMessage(message);
    chatInput.value = "";
  }

  function onChatInputKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChatInput();
    }
  }

  function liveStatusLabel(): string {
    switch (liveTerminalStatus.value) {
      case "connecting":
        return "连接中";
      case "connected":
        return "已连接";
      case "closed":
        return "已关闭";
      default:
        return "未启动";
    }
  }

  const groupedAgentMessages = computed<ChatMessageView[]>(() => {
    const sorted = [...options.getAgentMessages()].sort((left, right) =>
      left.timestamp.localeCompare(right.timestamp),
    );
    const grouped: ChatMessageView[] = [];

    for (const message of sorted) {
      const normalizedText = normalizeChatText(message.text);
      if (!normalizedText) {
        continue;
      }

      const last = grouped.at(-1);
      const sameSender = Boolean(
        last &&
        last.role === "agent" &&
        last.senderLabel === message.senderLabel &&
        last.stream === message.stream,
      );
      const withinMergeWindow =
        sameSender &&
        Math.abs(timestampMs(message.timestamp) - timestampMs(last!.timestamp)) <= 8_000;

      if (sameSender && withinMergeWindow) {
        last!.text = mergeChatText(last!.text, normalizedText);
        last!.timestamp = message.timestamp;
        last!.id = message.messageId;
        continue;
      }

      grouped.push({
        id: message.messageId,
        senderLabel: message.senderLabel,
        timestamp: message.timestamp,
        text: normalizedText,
        stream: message.stream,
        sourceMode: message.sourceMode,
        role: "agent",
      });
    }

    return grouped;
  });

  const chatTimeline = computed<ChatMessageView[]>(() => {
    const userMessages: ChatMessageView[] = localUserMessages.value.map((item) => ({
      id: item.id,
      senderLabel: "你",
      timestamp: item.timestamp,
      text: item.text,
      stream: "stdin",
      sourceMode: "session_message",
      role: "user",
    }));

    return [...groupedAgentMessages.value, ...userMessages].sort(
      (left, right) =>
        timestampMs(left.timestamp) - timestampMs(right.timestamp) || left.id.localeCompare(right.id),
    );
  });

  const liveWorkspaceTimeline = computed<ChatMessageView[]>(() =>
    chatTimeline.value.filter((message) => message.role === "agent").slice(-120),
  );

  function resetForContext(initialPrompt: string): void {
    disconnectLiveTerminal();
    liveTerminalStatus.value = "idle";
    liveTerminalError.value = "";
    localUserMessages.value = [];
    localMessageDedupeKeys.clear();
    chatInput.value = "";
    pendingInitialPrompt.value = initialPrompt.trim();
    initialPromptSentKey.value = "";
    liveTerminalAutoConnectKey.value = "";
  }

  function dispose(): void {
    disconnectLiveTerminal();
    liveTerminal?.dispose();
    liveTerminal = undefined;
  }

  return {
    liveTerminalMount,
    liveTerminalStatus,
    liveTerminalError,
    liveTerminalConnecting,
    liveTerminalAutoConnectKey,
    chatInput,
    chatTimeline,
    liveWorkspaceTimeline,
    connectLiveTerminal,
    disconnectLiveTerminal,
    sendChatInput,
    onChatInputKeydown,
    liveStatusLabel,
    resetForContext,
    dispose,
  };
}
