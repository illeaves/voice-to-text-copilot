/**
 * Voice to Text (also for Copilot Chat) Extension for VS Code
 * Author: aleaf
 */
"use strict";

// =====================================================================================================
// 📦 Imports
// =====================================================================================================
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const https = require("https");
const OpenAI = require("openai");
const { execFile, spawn } = require("child_process");
const util = require("util");
const execFilePromise = util.promisify(execFile);
const os = require("os");
const { PROMPT_PRESETS } = require("./promptPresets");

// =====================================================================================================
// 🌐 グローバル変数
// =====================================================================================================

// UI状態管理
let isRecording = false; // 録音中か
let isProcessing = false; // 音声→テキスト処理中か
let statusBarItemStatus; // ステータスバー項目 (ステータス表示)
let statusBarItemFocus; // ステータスバー項目 (Focus)
let statusBarItemChat; // ステータスバー項目 (Chat)
let statusBarItemTranslate; // ステータスバー項目 (Translation toggle)
let outputChannel; // アウトプットチャンネル

/**
 * 録音状態をコンテキストキーに設定
 * @param {boolean} recording - 録音中かどうか
 */
function setRecordingContext(recording) {
  isRecording = recording;
  vscode.commands.executeCommand(
    "setContext",
    "voiceToText.isRecording",
    recording
  );
}

// 録音タイマー管理
let recordingTimer = null; // 録音時間表示用タイマー
let recordingStartTime = null; // 録音開始時刻
let recordingMaxSeconds = 180; // 最大録音時間
let activeRecordingButton = null; // 'focus' or 'chat' - どちらのボタンで録音開始したか

// 貼り付け先情報
let pasteTarget = null; // 'auto' or 'chat'
let savedEditor = null; // 録音開始時のエディタ
let savedPosition = null; // 録音開始時のカーソル位置

// 録音制御 (SOX)
let soxProcess = null; // SOXプロセス
let recordingTimeout = null; // 録音タイムアウト
let currentRecordingFile = null; // 現在録音中のファイルパス
const outputFile = path.join(__dirname, "voice.wav"); // 録音ファイルパス

// ローカライゼーション
let messages = {}; // ローカライズメッセージ

// 履歴管理
const WHISPER_HISTORY_KEY = "whisperHistory"; // 履歴保存キー
const MAX_HISTORY_SIZE = 10; // 最大履歴件数

// 拡張機能コンテキスト
let extensionContext = null; // VS Code拡張機能のコンテキスト（secrets APIなどで使用）

// =====================================================================================================
// 🔧 ユーティリティ関数
// =====================================================================================================

/**
 * バイナリファイルの実行権限を確保
 * @returns {Promise<void>}
 */
async function ensureBinaryPermissions() {
  const platform = process.platform;
  let binaryPath;

  if (platform === "darwin") {
    binaryPath = path.join(
      extensionContext.extensionPath,
      "bin",
      "macos",
      "whisper-cli"
    );
  } else if (platform === "linux") {
    binaryPath = path.join(
      extensionContext.extensionPath,
      "bin",
      "linux",
      "whisper-cli"
    );
  } else if (platform === "win32") {
    binaryPath = path.join(
      extensionContext.extensionPath,
      "bin",
      "windows",
      "whisper-cli.exe"
    );
  } else {
    console.log(`⚠️ Unsupported platform: ${platform}`);
    return;
  }

  try {
    // ファイルの存在確認
    if (!fs.existsSync(binaryPath)) {
      console.log(`⚠️ Binary not found: ${binaryPath}`);
      return;
    }

    // プラットフォーム別の権限チェック・設定
    const stats = fs.statSync(binaryPath);

    if (platform === "win32") {
      // Windows: ファイル属性をチェック（読み取り専用でないことを確認）
      try {
        const isReadOnly = (stats.mode & parseInt("200", 8)) === 0;
        if (isReadOnly) {
          console.log(`🔧 Removing read-only attribute from: ${binaryPath}`);
          fs.chmodSync(binaryPath, stats.mode | parseInt("666", 8));
          console.log(`✅ Read-only attribute removed successfully`);
        } else {
          console.log(`✅ Windows binary has proper attributes: ${binaryPath}`);
        }
      } catch (winError) {
        console.error(
          `⚠️ Failed to modify Windows file attributes: ${winError.message}`
        );
      }
    } else {
      // Unix系 (macOS/Linux): 実行権限をチェック
      const hasExecutePermission = (stats.mode & parseInt("111", 8)) !== 0;

      if (!hasExecutePermission) {
        console.log(`🔧 Adding execute permission to: ${binaryPath}`);
        fs.chmodSync(binaryPath, stats.mode | parseInt("755", 8));
        console.log(`✅ Execute permission added successfully`);
      } else {
        console.log(
          `✅ Unix binary already has execute permission: ${binaryPath}`
        );
      }
    }
    // 実行可能性テスト（簡易チェック）
    try {
      const { execFile } = require("child_process");
      const testExecution = new Promise((resolve) => {
        execFile(binaryPath, ["--help"], { timeout: 3000 }, (error) => {
          if (error && error.code === "EACCES") {
            console.error(
              `❌ Binary still not executable after permission fix: ${binaryPath}`
            );
            resolve(false);
          } else {
            console.log(`✅ Binary execution test passed: ${binaryPath}`);
            resolve(true);
          }
        });
      });

      await testExecution;
    } catch (testError) {
      console.warn(
        `⚠️ Binary execution test failed (non-critical): ${testError.message}`
      );
    }
  } catch (error) {
    console.error(`⚠️ Failed to set binary permissions: ${error.message}`);
    // 権限エラーは致命的ではないので続行
  }
}

// ------ ローカライゼーション ------

/**
 * 指定された言語のロケールファイルを読み込み
 * @param {string} lang - 言語コード（例: 'ja', 'en'）
 * @returns {Object} ローカライズされたメッセージオブジェクト
 */
function loadLocale(lang) {
  try {
    const localeFile = path.join(__dirname, "locales", `${lang}.json`);
    if (fs.existsSync(localeFile)) {
      return JSON.parse(fs.readFileSync(localeFile, "utf8"));
    }
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, "locales", "en.json"), "utf8")
    );
  } catch (err) {
    console.error("⚠️ Failed to load locale:", err);
    return { activated: "Extension activated (fallback language)." };
  }
}

/**
 * ローカライズされたメッセージを取得し、変数を置換
 * @param {string} key - メッセージキー
 * @param {Object} vars - 置換する変数のオブジェクト
 * @returns {string} ローカライズされたメッセージ
 */
function msg(key, vars = {}) {
  let text = messages[key] || key;
  for (const [k, v] of Object.entries(vars)) {
    text = text.replace(`{{${k}}}`, v);
  }
  return text;
}

// ------ ユーザーディレクトリヘルパー ------

/**
 * ユーザーディレクトリのベースパスを取得
 * @returns {string} ~/.vscode/voice-to-text-copilot/
 */
function getUserDataDir() {
  const homeDir = os.homedir();
  return path.join(homeDir, ".vscode", "voice-to-text-copilot");
}

/**
 * モデルファイル保存ディレクトリを取得
 * @returns {string} ~/.vscode/voice-to-text-copilot/models/
 */
function getModelDir() {
  return path.join(getUserDataDir(), "models");
}

/**
 * カスタムビルド保存ディレクトリを取得（プラットフォーム別）
 * @returns {string} ~/.vscode/voice-to-text-copilot/custom-builds/{platform}/
 */
function getCustomBuildDir() {
  const platform = process.platform;
  let platformDir;

  if (platform === "win32") {
    platformDir = "windows";
  } else if (platform === "darwin") {
    platformDir = "macos";
  } else {
    platformDir = "linux";
  }

  return path.join(getUserDataDir(), "custom-builds", platformDir);
}

/**
 * ディレクトリが存在しない場合は作成
 * @param {string} dirPath - 作成するディレクトリパス
 * @returns {void}
 */
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    systemLog(`Created directory: ${dirPath}`, "INFO");
  }
}

// ------ ロギング ------

/**
 * システムログを出力チャネルに記録
 * @param {string} message - ログメッセージ
 * @param {string} level - ログレベル（例: "INFO", "WARNING", "ERROR"）
 * @returns {void}
 */
function systemLog(message, level = "INFO") {
  const timestamp = new Date().toLocaleTimeString();
  const logMessage = `[${timestamp}] ${level}: ${message}`;
  console.log(logMessage);
  if (outputChannel) outputChannel.appendLine(logMessage);
}

// ------ カスタム辞書による自動置換 ------

/**
 * カスタム辞書を使ってテキストを自動置換
 * @param {string} text - 置換前のテキスト
 * @returns {string} 置換後のテキスト
 */
function applyCustomDictionary(text) {
  const config = vscode.workspace.getConfiguration("voiceToText");
  const customDictionary = config.get("customDictionary", {});

  if (!customDictionary || Object.keys(customDictionary).length === 0) {
    return text;
  }

  let result = text;

  // 辞書の各エントリに対して置換処理
  for (const [search, replace] of Object.entries(customDictionary)) {
    // 正規表現の特殊文字をエスケープ
    const regex = new RegExp(
      search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "g"
    );
    result = result.replace(regex, replace);
  }

  if (text !== result) {
    systemLog(`Applied custom dictionary: "${result}"`, "INFO");
  }

  return result;
}

// ------ SOXインストールチェック ------

/**
 * SOXのインストール状態を確認
 * @returns {Promise<boolean>} SOXが利用可能な場合true
 */
async function checkSoxInstallation() {
  const platform = process.platform;

  // 全プラットフォームでSOXの存在確認
  let soxPath;
  if (platform === "darwin") {
    soxPath = "/opt/homebrew/bin/sox"; // Mac (Homebrew)
  } else if (platform === "win32") {
    soxPath = "sox"; // Windows (PATH内、またはChocolatey/Scoop経由)
  } else {
    soxPath = "sox"; // Linux (PATH内)
  }

  try {
    await execFilePromise(soxPath, ["--version"]);
    return { installed: true, platform };
  } catch (error) {
    return { installed: false, platform };
  }
}

/**
 * SOXのインストールを促すダイアログを表示
 * @param {string} platform - プラットフォーム識別子
 * @returns {Promise<void>}
 */
async function promptSoxInstallation(platform) {
  // プラットフォームに応じたメッセージとインストール手順を選択
  let messageKey, instructionsKey;

  if (platform === "win32") {
    messageKey = "soxRequiredMessageWindows";
    instructionsKey = "soxInstallInstructionsWindows";
  } else if (platform === "linux") {
    messageKey = "soxRequiredMessageLinux";
    instructionsKey = "soxInstallInstructionsLinux";
  } else {
    messageKey = "soxRequiredMessage"; // Mac
    instructionsKey = "soxInstallInstructions";
  }

  const action = await vscode.window.showWarningMessage(
    msg(messageKey),
    msg("soxShowInstructions"),
    msg("soxDismiss")
  );

  if (action === msg("soxShowInstructions")) {
    const panel = vscode.window.createWebviewPanel(
      "soxInstall",
      msg("soxRequiredTitle"),
      vscode.ViewColumn.One,
      {}
    );

    panel.webview.html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
          }
          h2 {
            color: var(--vscode-foreground);
            margin-top: 0;
          }
          pre {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 15px;
            border-radius: 5px;
            overflow-x: auto;
          }
          code {
            font-family: 'Courier New', monospace;
            font-size: 14px;
          }
          p {
            line-height: 1.6;
          }
        </style>
      </head>
      <body>
        <h2>${msg("soxRequiredTitle")}</h2>
        <pre><code>${msg(instructionsKey)}</code></pre>
        <p>${msg("soxReloadMessage")}</p>
      </body>
      </html>
    `;
  }
}

// ------ ステータスバー更新 ------

/**
 * 翻訳ボタンの表示を更新
 * @returns {void}
 */
function updateTranslateButton() {
  if (!statusBarItemTranslate) return;

  const config = vscode.workspace.getConfiguration("voiceToText");
  const enableTranslation = config.get("enableTranslation", false);

  if (enableTranslation) {
    statusBarItemTranslate.tooltip =
      "Translation: ON (to English) - Click to disable";
    // ONの時は録音中と同じ背景色
    statusBarItemTranslate.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground"
    );
    statusBarItemTranslate.color = undefined; // 通常の文字色
  } else {
    statusBarItemTranslate.tooltip = "Translation: OFF - Click to enable";
    // OFFの時は背景色なし、文字色も通常
    statusBarItemTranslate.backgroundColor = undefined;
    statusBarItemTranslate.color = undefined;
  }

  // 常に表示（APIモードでもローカルモードでも）
  statusBarItemTranslate.show();
}

/**
 * ステータスバー更新（状態に応じて表示を変更）
 * @param {string} state - 状態（"idle", "recording", "processing", "success"）
 * @param {number} elapsed - 経過秒数（recording時のみ）
 * @param {number} max - 最大秒数（recording時のみ）
 * @returns {void}
 */
function updateStatusBar(state = "idle", elapsed = 0, max = 0) {
  if (!statusBarItemStatus || !statusBarItemFocus || !statusBarItemChat) return;

  // 現在のモードを取得
  const config = vscode.workspace.getConfiguration("voiceToText");
  const mode = config.get("mode", "api");
  const localModel = config.get("localModel", "small");

  // 翻訳ボタンの表示を更新
  updateTranslateButton();

  // モデル名を大文字に変換（Tiny, Base, Small, Medium, Large）
  const modelName = localModel.charAt(0).toUpperCase() + localModel.slice(1);
  const modeLabel = mode === "api" ? "API" : `Local:${modelName}`;

  switch (state) {
    case "recording": {
      const remaining = max - elapsed;
      const elapsedMin = Math.floor(elapsed / 60);
      const elapsedSec = elapsed % 60;
      const remainingMin = Math.floor(remaining / 60);
      const remainingSec = remaining % 60;
      const timeText = `${msg("statusRecordingTime")} ${elapsedMin}:${elapsedSec
        .toString()
        .padStart(2, "0")} / ${
        max > 0
          ? `${remainingMin}:${remainingSec.toString().padStart(2, "0")}`
          : ""
      }`;
      statusBarItemStatus.text = `${timeText}`;
      statusBarItemStatus.tooltip = msg("statusRecording") + ` [${modeLabel}]`;
      statusBarItemStatus.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );

      // ボタンは両方表示、録音開始した方のみenabled（停止可能）、もう一方はdisabled
      if (activeRecordingButton === "focus") {
        // アクティブなボタン（録音中・停止可能）
        statusBarItemFocus.text = "🟦Focus";
        statusBarItemFocus.tooltip = `${msg(
          "statusRecording"
        )} - クリックで停止 [${modeLabel}]`;
        statusBarItemFocus.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.warningBackground"
        );
        statusBarItemFocus.command = "voiceToText.toggle"; // 停止可能
        statusBarItemFocus.color = undefined;

        // 非アクティブなボタン（無効化）
        statusBarItemChat.text = "💬Chat";
        statusBarItemChat.tooltip = msg("recordingDisabled");
        statusBarItemChat.backgroundColor = undefined;
        statusBarItemChat.command = undefined;
        statusBarItemChat.color = new vscode.ThemeColor(
          "statusBarItem.inactiveForeground"
        );
      } else if (activeRecordingButton === "chat") {
        // アクティブなボタン（録音中・停止可能）
        statusBarItemChat.text = "🟦Chat";
        statusBarItemChat.tooltip = `${msg(
          "statusRecording"
        )} - クリックで停止 [${modeLabel}]`;
        statusBarItemChat.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.warningBackground"
        );
        statusBarItemChat.command = "voiceToText.toggleForChat"; // 停止可能
        statusBarItemChat.color = undefined;

        // 非アクティブなボタン（無効化）
        statusBarItemFocus.text = "📍Focus";
        statusBarItemFocus.tooltip = msg("recordingDisabled");
        statusBarItemFocus.backgroundColor = undefined;
        statusBarItemFocus.command = undefined;
        statusBarItemFocus.color = new vscode.ThemeColor(
          "statusBarItem.inactiveForeground"
        );
      }

      statusBarItemStatus.show();
      statusBarItemFocus.show();
      statusBarItemChat.show();
      break;
    }
    case "processing": {
      const processingText = `$(sync~spin) ${msg(
        "statusProcessing"
      )} [${modeLabel}]`;
      statusBarItemStatus.text = `${processingText}`;
      statusBarItemStatus.tooltip =
        msg("clickToCancelProcessing") || "クリックして処理を中止";
      statusBarItemStatus.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
      statusBarItemStatus.command = "voiceToText.confirmCancelProcessing"; // クリック時に確認ダイアログを表示

      // 両方disabled
      statusBarItemFocus.text = "📍Focus";
      statusBarItemFocus.tooltip = msg("processingDisabled");
      statusBarItemFocus.backgroundColor = undefined;
      statusBarItemFocus.command = undefined;
      statusBarItemFocus.color = new vscode.ThemeColor(
        "statusBarItem.inactiveForeground"
      );

      statusBarItemChat.text = "💬Chat";
      statusBarItemChat.tooltip = msg("processingDisabled");
      statusBarItemChat.backgroundColor = undefined;
      statusBarItemChat.command = undefined;
      statusBarItemChat.color = new vscode.ThemeColor(
        "statusBarItem.inactiveForeground"
      );

      statusBarItemStatus.show();
      statusBarItemFocus.show();
      statusBarItemChat.show();
      break;
    }
    case "success": {
      statusBarItemStatus.text = `${msg("pasteDone")}`;
      statusBarItemStatus.tooltip = msg("pasteDone");
      statusBarItemStatus.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.prominentBackground"
      );

      // 両方enabled
      statusBarItemFocus.text = "📍Focus";
      statusBarItemFocus.tooltip = `${msg("recordToEditor")} [${modeLabel}]`;
      statusBarItemFocus.backgroundColor = undefined;
      statusBarItemFocus.command = "voiceToText.toggle";
      statusBarItemFocus.color = undefined;

      statusBarItemChat.text = "💬Chat";
      statusBarItemChat.tooltip = `${msg("recordToChat")} [${modeLabel}]`;
      statusBarItemChat.backgroundColor = undefined;
      statusBarItemChat.command = "voiceToText.toggleForChat";
      statusBarItemChat.color = undefined;

      statusBarItemStatus.show();
      statusBarItemFocus.show();
      statusBarItemChat.show();
      break;
    }
    case "idle":
    default: {
      statusBarItemStatus.text = msg("statusWaiting");
      statusBarItemStatus.tooltip = `Voice to Text (also for Copilot Chat) [${modeLabel}]`;
      statusBarItemStatus.backgroundColor = undefined;
      statusBarItemStatus.command = undefined;

      // 両ボタンを通常状態に戻す
      statusBarItemFocus.text = "📍Focus";
      statusBarItemFocus.tooltip = `${msg("recordToEditor")} [${modeLabel}]`;
      statusBarItemFocus.backgroundColor = undefined;
      statusBarItemFocus.command = "voiceToText.toggle";
      statusBarItemFocus.color = undefined;

      statusBarItemChat.text = "💬Chat";
      statusBarItemChat.tooltip = `${msg("recordToChat")} [${modeLabel}]`;
      statusBarItemChat.backgroundColor = undefined;
      statusBarItemChat.command = "voiceToText.toggleForChat";
      statusBarItemChat.color = undefined;

      // 強制的に表示状態をリセット
      statusBarItemStatus.show();
      statusBarItemFocus.show();
      statusBarItemChat.show();

      activeRecordingButton = null;
      break;
    }
  }
}

// ------ 貼り付け処理 ------

/**
 * Copilot Chatに文字起こしテキストを貼り付け
 * @param {string} text - 貼り付けるテキスト
 * @returns {Promise<void>}
 */
async function pasteToChat(text) {
  systemLog("📍 Copilot Chatに貼り付けます", "INFO");

  // Copilot Chatを開く
  await vscode.commands.executeCommand("workbench.action.chat.open");
  await new Promise((r) => setTimeout(r, 200));

  // クリップボード経由で貼り付け
  const originalClipboard = await vscode.env.clipboard.readText();
  await vscode.env.clipboard.writeText(text);
  await vscode.commands.executeCommand("editor.action.clipboardPasteAction");

  // クリップボードを復元
  setTimeout(async () => {
    await vscode.env.clipboard.writeText(originalClipboard);
    systemLog("Clipboard restored", "INFO");
  }, 100);
}

/**
 * 保存された位置に文字起こしテキストを貼り付け
 * @param {string} text - 貼り付けるテキスト
 * @returns {Promise<void>}
 */
async function pasteToSavedPosition(text) {
  // エディタがまだ存在するか確認
  const stillExists = vscode.window.visibleTextEditors.includes(savedEditor);

  if (!stillExists) {
    systemLog(
      "⚠ エディタが閉じられました - Copilot Chatにフォールバックします",
      "WARNING"
    );
    await pasteToChat(text);
    return;
  }

  systemLog(
    `📍 保存された位置に貼り付けます: 行 ${savedPosition.line + 1}, 列 ${
      savedPosition.character + 1
    }`,
    "INFO"
  );

  // エディタにフォーカスを戻す
  await vscode.window.showTextDocument(savedEditor.document, {
    viewColumn: savedEditor.viewColumn,
    preserveFocus: false,
  });

  // 保存された位置にカーソルを移動
  savedEditor.selection = new vscode.Selection(savedPosition, savedPosition);

  // テキストを挿入
  await savedEditor.edit((editBuilder) => {
    editBuilder.insert(savedPosition, text);
  });

  systemLog("✅ 保存された位置に貼り付けが完了しました", "SUCCESS");
}

/**
 * 現在のフォーカス位置に文字起こしテキストを貼り付け
 * @param {string} text - 貼り付けるテキスト
 * @returns {Promise<void>}
 */
async function pasteToCurrentFocus(text) {
  systemLog("📍 現在のフォーカス位置に貼り付けます", "INFO");

  const originalClipboard = await vscode.env.clipboard.readText();
  systemLog("Original clipboard saved", "INFO");

  await vscode.env.clipboard.writeText(text);
  await vscode.commands.executeCommand("editor.action.clipboardPasteAction");

  setTimeout(async () => {
    await vscode.env.clipboard.writeText(originalClipboard);
    systemLog("Clipboard restored", "INFO");
  }, 100);
}

/**
 * 録音時間表示タイマーを開始
 * @param {number} maxSeconds - 最大録音秒数
 * @returns {void}
 */
function startRecordingTimer(maxSeconds) {
  stopRecordingTimer(); // 既存のタイマーをクリア
  recordingStartTime = Date.now();
  recordingMaxSeconds = maxSeconds;

  recordingTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    updateStatusBar("recording", elapsed, recordingMaxSeconds);
  }, 1000); // 1秒ごとに更新
}

/**
 * 録音時間表示タイマーを停止
 * @returns {void}
 */
function stopRecordingTimer() {
  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }
  recordingStartTime = null;
}

/**
 * Whisper履歴に新しいエントリを追加
 * @param {string} text - 文字起こしされたテキスト
 * @param {string} mode - 使用したモード（"api" または "local"）
 * @returns {void}
 */
function addToHistory(text, mode) {
  const history = extensionContext.globalState.get(WHISPER_HISTORY_KEY, []);

  // 新しいエントリを先頭に追加
  history.unshift({
    text: text,
    timestamp: new Date().toISOString(),
    mode: mode,
  });

  // 最大件数を超えたら古いものを削除
  if (history.length > MAX_HISTORY_SIZE) {
    history.length = MAX_HISTORY_SIZE;
  }

  extensionContext.globalState.update(WHISPER_HISTORY_KEY, history);
  systemLog(`📚 Added to history (total: ${history.length})`, "INFO");
}

/**
 * Whisper履歴を取得
 * @returns {Array<Object>} 履歴エントリの配列
 */
function getHistory() {
  return extensionContext.globalState.get(WHISPER_HISTORY_KEY, []);
}

/**
 * モデルファイルをダウンロード（リダイレクト対応）
 * @param {string} modelName - モデル名（例: "small", "medium"）
 * @param {Object} msg - ローカライズメッセージ関数
 * @param {Function} onProgress - 進捗コールバック(percent, downloadedMB, totalMB)
 * @returns {Promise<void>}
 */
async function downloadModel(modelName, msg, onProgress = null) {
  const modelUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${modelName}.bin`;
  const modelDir = getModelDir(); // ユーザーディレクトリに変更
  const modelPath = path.join(modelDir, `ggml-${modelName}.bin`);

  // modelsディレクトリ作成
  ensureDirectoryExists(modelDir);

  return new Promise((resolve, reject) => {
    const downloadFromUrl = (url, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error("Too many redirects"));
        return;
      }

      const file = fs.createWriteStream(modelPath);

      systemLog(`Downloading from: ${url}`, "INFO");

      https
        .get(url, (response) => {
          // リダイレクト処理
          if (response.statusCode === 301 || response.statusCode === 302) {
            file.close();
            fs.unlink(modelPath, () => {});
            const redirectUrl = response.headers.location;
            systemLog(`Redirecting to: ${redirectUrl}`, "INFO");
            downloadFromUrl(redirectUrl, redirectCount + 1);
            return;
          }

          if (response.statusCode !== 200) {
            file.close();
            fs.unlink(modelPath, () => {});
            reject(
              new Error(`Failed to download: HTTP ${response.statusCode}`)
            );
            return;
          }

          const totalBytes = parseInt(response.headers["content-length"], 10);
          let downloadedBytes = 0;

          response.on("data", (chunk) => {
            downloadedBytes += chunk.length;
            if (totalBytes) {
              const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
              const downloadedMB = (downloadedBytes / 1024 / 1024).toFixed(1);
              const totalMB = (totalBytes / 1024 / 1024).toFixed(1);

              systemLog(
                `Downloading ${modelName}: ${percent}% (${downloadedMB}MB / ${totalMB}MB)`,
                "INFO"
              );

              // 進捗コールバック呼び出し
              if (onProgress) {
                onProgress(
                  parseFloat(percent),
                  parseFloat(downloadedMB),
                  parseFloat(totalMB)
                );
              }
            }
          });

          response.pipe(file);

          file.on("finish", () => {
            file.close();
            systemLog(`Download complete: ${modelPath}`, "INFO");
            resolve(modelPath);
          });

          file.on("error", (err) => {
            fs.unlink(modelPath, () => {});
            reject(err);
          });
        })
        .on("error", (err) => {
          file.close();
          fs.unlink(modelPath, () => {});
          reject(err);
        });
    };

    downloadFromUrl(modelUrl);
  });
}

/**
 * 初回セットアップウィザードを実行
 * @param {Object} config - VS Code設定オブジェクト
 * @param {Function} msg - ローカライズメッセージ関数
 * @returns {Promise<void>}
 */
async function runInitialSetup(config, msg) {
  // モード選択
  const modeChoice = await vscode.window.showQuickPick(
    [
      {
        label: msg("modeApiLabel"),
        description: msg("modeApiDescription"),
        value: "api",
      },
      {
        label: msg("modeLocalLabel"),
        description: msg("modeLocalDescription"),
        value: "local",
      },
    ],
    {
      placeHolder: msg("selectMode"),
      ignoreFocusOut: true,
    }
  );

  if (!modeChoice) {
    return; // キャンセルされた
  }

  // 設定を保存
  await config.update(
    "mode",
    modeChoice.value,
    vscode.ConfigurationTarget.Global
  );

  if (modeChoice.value === "api") {
    // === APIモード ===
    const setKey = await vscode.window.showInformationMessage(
      msg("setupApiKey"),
      msg("setupNow"),
      msg("setupLater")
    );

    if (setKey === msg("setupNow")) {
      await vscode.commands.executeCommand("voiceToText.setApiKey");
    }
  } else {
    // === ローカルモード ===
    const modelChoice = await vscode.window.showQuickPick(
      [
        {
          label: msg("modelTinyLabel"),
          description: msg("modelTinyDescription"),
          value: "tiny",
        },
        {
          label: msg("modelBaseLabel"),
          description: msg("modelBaseDescription"),
          value: "base",
        },
        {
          label: msg("modelSmallLabel"),
          description: msg("modelSmallDescription"),
          value: "small",
        },
        {
          label: msg("modelMediumLabel"),
          description: msg("modelMediumDescription"),
          value: "medium",
        },
        {
          label: msg("modelLargeLabel"),
          description: msg("modelLargeDescription"),
          value: "large",
        },
      ],
      {
        placeHolder: msg("selectModel"),
        ignoreFocusOut: true,
      }
    );

    if (!modelChoice) {
      return; // キャンセルされた
    }

    // 選択したモデルを設定に保存
    await config.update(
      "localModel",
      modelChoice.value,
      vscode.ConfigurationTarget.Global
    );

    // モデルファイルの存在確認
    const modelDir = getModelDir();
    const modelPath = path.join(modelDir, `ggml-${modelChoice.value}.bin`);

    if (fs.existsSync(modelPath)) {
      // 既にモデルファイルが存在する場合、上書きするか確認
      systemLog(`Model already exists: ${modelPath}`, "INFO");

      const overwriteChoice = await vscode.window.showInformationMessage(
        msg("modelExistsOverwrite", { model: modelChoice.value }),
        msg("overwriteModel"),
        msg("useExistingModel")
      );

      if (overwriteChoice === msg("useExistingModel")) {
        // 既存のモデルを使用
        vscode.window.showInformationMessage(
          msg("modelAlreadyExists", { model: modelChoice.value })
        );
        vscode.window.showInformationMessage(msg("setupComplete"));
        await extensionContext.globalState.update("hasConfiguredMode", true);
        return;
      } else if (overwriteChoice !== msg("overwriteModel")) {
        // キャンセルされた場合
        return;
      }
      // overwriteModelが選択された場合は、既存ファイルを削除してから続行
      try {
        fs.unlinkSync(modelPath);
        systemLog(`Deleted existing model: ${modelPath}`, "INFO");
      } catch (error) {
        systemLog(`Failed to delete existing model: ${error.message}`, "ERROR");
        vscode.window.showErrorMessage(
          msg("deleteFailed", { error: error.message })
        );
        return;
      }
    }

    // モデルダウンロード処理
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: msg("downloadingModel", { model: modelChoice.value }),
          cancellable: false,
        },
        async (progress) => {
          // 進捗コールバック関数
          const onProgress = (percent, downloadedMB, totalMB) => {
            progress.report({
              message: `${percent}% (${downloadedMB}MB / ${totalMB}MB)`,
              increment: 0, // incrementは使わず、messageで表示
            });
          };

          await downloadModel(modelChoice.value, msg, onProgress);
        }
      );

      vscode.window.showInformationMessage(msg("downloadComplete"));
    } catch (error) {
      systemLog(`Model download failed: ${error.message}`, "ERROR");
      vscode.window.showErrorMessage(
        msg("downloadFailed", { error: error.message })
      );
      return; // エラー時は早期リターン
    }

    vscode.window.showInformationMessage(msg("setupComplete"));
  }

  // セットアップ完了フラグ
  await extensionContext.globalState.update("hasConfiguredMode", true);
}

/**
 * モード変更時の処理（API/ローカル切り替え）
 * @returns {Promise<void>}
 */
async function handleModeChange() {
  const config = vscode.workspace.getConfiguration("voiceToText");
  const newMode = config.get("mode");

  systemLog(`Mode changed to: ${newMode}`, "INFO");

  // ローカルモードに変更された場合、モデルの存在確認
  if (newMode === "local") {
    const localModel = config.get("localModel", "small");
    const modelDir = getModelDir();
    const modelPath = path.join(modelDir, `ggml-${localModel}.bin`);

    if (!fs.existsSync(modelPath)) {
      systemLog(
        `Model ${localModel} not found, prompting for download`,
        "INFO"
      );

      const response = await vscode.window.showInformationMessage(
        msg("modelMissingOnModeSwitch", { model: localModel }),
        msg("downloadNow"),
        msg("stayInApiMode")
      );

      if (response === msg("downloadNow")) {
        // モデルをダウンロード
        await downloadSingleModel(localModel, msg);
      } else {
        // APIモードに戻す
        systemLog("User chose to stay in API mode", "INFO");
        await config.update("mode", "api", vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(msg("stayedInApiMode"));
      }
    }
  }
}

/**
 * ローカルモデル変更時の処理（モデルダウンロード確認）
 * @returns {Promise<void>}
 */
async function handleLocalModelChange() {
  const config = vscode.workspace.getConfiguration("voiceToText");
  const newModel = config.get("localModel");
  const currentMode = config.get("mode");

  systemLog(`Local model changed to: ${newModel}`, "INFO");

  const modelDir = getModelDir();
  const modelPath = path.join(modelDir, `ggml-${newModel}.bin`);

  if (!fs.existsSync(modelPath)) {
    systemLog(`Model ${newModel} not found, prompting for download`, "INFO");

    const response = await vscode.window.showInformationMessage(
      msg("modelNotFoundPrompt", { model: newModel }),
      msg("downloadNow"),
      msg("revertSelection")
    );

    if (response === msg("downloadNow")) {
      // モデルをダウンロード
      try {
        await downloadSingleModel(newModel, msg);
        vscode.window.showInformationMessage(
          msg("modelDownloadComplete", { model: newModel })
        );
      } catch (error) {
        systemLog(`Model download failed: ${error.message}`, "ERROR");
        vscode.window.showErrorMessage(
          msg("downloadFailed", { error: error.message })
        );
        // ダウンロード失敗時も設定を戻す
        await revertModelSelection();
      }
    } else {
      // 設定を元に戻す
      await revertModelSelection();
    }
  }
}

/**
 * モデル選択を元に戻す（ダウンロード失敗時など）
 * @returns {Promise<void>}
 */
async function revertModelSelection() {
  const previousModel = extensionContext.globalState.get(
    "previousLocalModel",
    "small"
  );
  const config = vscode.workspace.getConfiguration("voiceToText");

  systemLog(`Reverting model selection to: ${previousModel}`, "INFO");
  await config.update(
    "localModel",
    previousModel,
    vscode.ConfigurationTarget.Global
  );

  vscode.window.showInformationMessage(
    msg("modelSelectionReverted", { model: previousModel })
  );
}

/**
 * 単一モデルのダウンロード（進捗表示付き）
 * @param {string} modelName - ダウンロードするモデル名
 * @param {Function} msg - ローカライズメッセージ関数
 * @returns {Promise<void>}
 */
async function downloadSingleModel(modelName, msg) {
  return new Promise((resolve, reject) => {
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: msg("downloadingModel", { model: modelName }),
        cancellable: false,
      },
      async (progress) => {
        try {
          const onProgress = (percent, downloadedMB, totalMB) => {
            progress.report({
              increment: 0, // 累積ではなく、現在の進捗を表示
              message: `${percent}% (${downloadedMB}MB / ${totalMB}MB)`,
            });
          };

          await downloadModel(modelName, msg, onProgress);
          systemLog(`Model ${modelName} downloaded successfully`, "INFO");
          resolve();
        } catch (error) {
          systemLog(`Model download failed: ${error.message}`, "ERROR");
          reject(error);
        }
      }
    );
  });
}

// =====================================================================================================
// 🎙️ 録音制御 (SOX)
// =====================================================================================================

/**
 * 録音を開始（SOXを使用）
 * @param {number} maxRecordSec - 最大録音秒数
 * @returns {void}
 */
function startRecording(maxRecordSec) {
  try {
    const MAX_RECORD_TIME = maxRecordSec * 1000;

    // 既存の録音をクリーンアップ
    if (soxProcess) {
      if (recordingTimeout) {
        clearTimeout(recordingTimeout);
        recordingTimeout = null;
      }
      try {
        soxProcess.kill("SIGINT");
      } catch (error) {
        console.error("⚠️ Error stopping previous recording:", error);
      }
      soxProcess = null;
    }

    // 両モード共通でvoice.wavに録音
    const recordingFile = outputFile;
    currentRecordingFile = recordingFile;

    console.log(`📝 Recording file: ${recordingFile}`);

    // 古いファイルを削除
    if (fs.existsSync(recordingFile)) {
      fs.unlinkSync(recordingFile);
      console.log(`🗑️ Deleted old recording file: ${recordingFile}`);
    }

    // プラットフォームごとのSOXパス
    const platform = process.platform;
    let soxPath;
    if (platform === "darwin") {
      soxPath = "/opt/homebrew/bin/sox"; // Mac (Homebrew)
    } else {
      soxPath = "sox"; // Windows/Linux (PATH内)
    }

    // SOXで直接16kHz WAVを録音（正規化は録音後に実行）
    let soxArgs;
    if (platform === "win32") {
      soxArgs = [
        "-t",
        "waveaudio",
        "default",
        "-r",
        "16000",
        "-c",
        "1",
        "-b",
        "16",
        "-e",
        "signed-integer",
        recordingFile,
      ];
    } else {
      soxArgs = ["-d", "-r", "16000", "-c", "1", "-b", "16", recordingFile];
    }

    console.log(
      `🎤 Starting SOX recording (${platform}): ${soxPath} ${soxArgs.join(" ")}`
    );
    systemLog(`録音開始: ${soxPath} ${soxArgs.join(" ")}`, "INFO");
    soxProcess = spawn(soxPath, soxArgs);

    let soxErrorOutput = "";

    soxProcess.stdout.on("data", (data) => {
      console.log(`SOX stdout: ${data}`);
      systemLog(`SOX stdout: ${data}`, "INFO");
    });

    soxProcess.stderr.on("data", (data) => {
      const message = data.toString();
      console.log(`SOX info: ${message}`);
      systemLog(`SOX stderr: ${message}`, "INFO");

      if (message.includes("FAIL") || message.includes("error")) {
        soxErrorOutput += message;
      }
    });

    soxProcess.on("error", (err) => {
      console.error("⚠️ SOX process error:", err);
      systemLog(`SOXプロセスエラー: ${err.message}`, "ERROR");
      vscode.window.showErrorMessage(
        msg("microphoneError", { error: err.message })
      );
    });

    soxProcess.on("exit", (code) => {
      console.log(`SOX process exited with code ${code}`);
      systemLog(`SOXプロセス終了: コード ${code}`, "INFO");

      if (code !== 0 && code !== null && soxErrorOutput) {
        console.error(`⚠️ SOX failed: ${soxErrorOutput}`);
        systemLog(`SOX失敗: ${soxErrorOutput.trim()}`, "ERROR");
        vscode.window.showErrorMessage(
          msg("soxRecordingError", { error: soxErrorOutput.trim() })
        );
      }
    });

    console.log(msg("recordingStart", { seconds: maxRecordSec }));

    // ⏱ 上限時間を超えたら自動停止
    recordingTimeout = setTimeout(() => {
      if (soxProcess) {
        console.log(
          "⏰ Recording timeout reached, executing timeout callback..."
        );
        vscode.window.showWarningMessage(
          msg("recordingStopAuto", { seconds: maxRecordSec })
        );

        console.log("⏰ Executing timeout processing - same as manual stop");
        stopRecordingAndProcessVoice();
      }
    }, MAX_RECORD_TIME);
  } catch (error) {
    console.error("⚠️ Recording start error:", error);
    vscode.window.showErrorMessage(
      msg("recordingError", { error: error.message })
    );
    throw error;
  }
}

/**
 * 音声ファイルの音量を正規化（VAD対策）
 * @returns {Promise<void>}
 */
async function normalizeAudio() {
  console.log("🔊 Normalizing audio volume...");
  systemLog("音量を正規化中（VAD対策）...", "INFO");

  const platform = process.platform;
  const tempOutputFile = outputFile.replace(".wav", "_norm.wav");

  // 処理時間の測定開始
  const startTime = Date.now();
  console.time("⏱️ Audio normalization time");

  try {
    const soxPath = platform === "darwin" ? "/opt/homebrew/bin/sox" : "sox";
    const normArgs = [outputFile, tempOutputFile, "gain", "-n"];

    console.log(`🔊 Executing: ${soxPath} ${normArgs.join(" ")}`);
    systemLog(`SOX実行: ${soxPath} ${normArgs.join(" ")}`, "INFO");

    await new Promise((resolve, reject) => {
      const normProcess = spawn(soxPath, normArgs);

      normProcess.on("close", (code) => {
        if (code === 0) {
          const elapsedTime = Date.now() - startTime;
          console.log(`✅ Audio normalized successfully in ${elapsedTime}ms`);
          systemLog(`音量正規化成功 (${elapsedTime}ms)`, "INFO");
          console.timeEnd("⏱️ Audio normalization time");
          // 元のファイルを削除して、正規化版をリネーム
          fs.unlinkSync(outputFile);
          fs.renameSync(tempOutputFile, outputFile);
          resolve();
        } else {
          const elapsedTime = Date.now() - startTime;
          console.error(
            `⚠️ SOX normalization failed with code ${code} (${elapsedTime}ms)`
          );
          systemLog(
            `音量正規化失敗: コード ${code} (${elapsedTime}ms)`,
            "WARNING"
          );
          console.timeEnd("⏱️ Audio normalization time");
          // 失敗しても元のファイルは残す
          if (fs.existsSync(tempOutputFile)) {
            fs.unlinkSync(tempOutputFile);
          }
          resolve(); // エラーでも続行
        }
      });

      normProcess.on("error", (err) => {
        const elapsedTime = Date.now() - startTime;
        console.error(`⚠️ SOX normalization error: ${err} (${elapsedTime}ms)`);
        systemLog(
          `音量正規化エラー: ${err.message} (${elapsedTime}ms)`,
          "WARNING"
        );
        console.timeEnd("⏱️ Audio normalization time");
        if (fs.existsSync(tempOutputFile)) {
          fs.unlinkSync(tempOutputFile);
        }
        resolve(); // エラーでも続行
      });
    });

    console.log(`✅ Using normalized audio file: ${outputFile}`);
    systemLog("正規化済み音声ファイルを使用", "INFO");
  } catch (error) {
    const elapsedTime = Date.now() - startTime;
    console.error(
      `⚠️ Audio normalization failed, using original file: ${error} (${elapsedTime}ms)`
    );
    systemLog(
      `音量正規化失敗、元のファイルを使用 (${elapsedTime}ms)`,
      "WARNING"
    );
    console.timeEnd("⏱️ Audio normalization time");
    // エラー時は元のファイルをそのまま使う
    if (fs.existsSync(tempOutputFile)) {
      fs.unlinkSync(tempOutputFile);
    }
  }
}

/**
 * WAVヘッダーを修正（whisper.cpp互換性のため）
 * @returns {Promise<void>}
 */
async function fixWavHeader() {
  console.log("🔧 Fixing WAV header for whisper.cpp compatibility...");
  systemLog("WAVヘッダーを修正中（whisper.cpp互換性のため）...", "INFO");

  const platform = process.platform;
  const tempOutputFile = outputFile.replace(".wav", "_fixed.wav");

  try {
    // SOXでWAVファイルを読み込んで正しいヘッダーで書き直す
    const soxPath = platform === "darwin" ? "/opt/homebrew/bin/sox" : "sox";
    const fixArgs = [outputFile, tempOutputFile];

    console.log(`🔧 Executing: ${soxPath} ${fixArgs.join(" ")}`);
    systemLog(`SOX実行: ${soxPath} ${fixArgs.join(" ")}`, "INFO");

    await new Promise((resolve, reject) => {
      const fixProcess = spawn(soxPath, fixArgs);

      fixProcess.on("close", (code) => {
        if (code === 0) {
          console.log("✅ WAV header fixed successfully");
          systemLog("WAVヘッダー修正成功", "INFO");
          // 元のファイルを削除して、修正版をリネーム
          fs.unlinkSync(outputFile);
          fs.renameSync(tempOutputFile, outputFile);
          resolve();
        } else {
          console.error(`⚠️ SOX fix failed with code ${code}`);
          systemLog(`SOX修正失敗: コード ${code}`, "ERROR");
          reject(new Error(`SOX fix failed with code ${code}`));
        }
      });

      fixProcess.on("error", (err) => {
        console.error("⚠️ SOX fix error:", err);
        systemLog(`SOX修正エラー: ${err.message}`, "ERROR");
        reject(err);
      });
    });

    console.log(`✅ Using fixed WAV file: ${outputFile}`);
    systemLog("修正済みWAVファイルを使用", "INFO");
  } catch (error) {
    console.error("⚠️ WAV header fix failed, using original file:", error);
    systemLog("WAVヘッダー修正失敗、元のファイルを使用", "WARNING");
    // エラー時は元のファイルをそのまま使う
    if (fs.existsSync(tempOutputFile)) {
      fs.unlinkSync(tempOutputFile);
    }
  }
}

/**
 * 録音を完全にキャンセル（音声処理をスキップ）
 * @returns {Promise<void>}
 */
async function cancelRecordingCompletely() {
  console.log("🔴 Cancelling recording completely...");
  systemLog("録音を完全にキャンセル中...", "INFO");

  // 録音タイマーを停止
  stopRecordingTimer();

  // 録音タイムアウトをクリア
  if (recordingTimeout) {
    clearTimeout(recordingTimeout);
    recordingTimeout = null;
  }

  // SOXプロセスを強制終了
  if (soxProcess) {
    try {
      soxProcess.kill("SIGINT");
      await new Promise((resolve) => {
        soxProcess.on("exit", () => {
          console.log("✅ SOX process terminated (cancelled)");
          resolve();
        });
        setTimeout(resolve, 1000); // 1秒でタイムアウト
      });
    } catch (error) {
      console.error("⚠️ Error stopping SOX process:", error);
    }
    soxProcess = null;
  }

  // 録音ファイルを削除
  if (fs.existsSync(outputFile)) {
    try {
      fs.unlinkSync(outputFile);
      console.log("🗑️ Recording file deleted");
    } catch (error) {
      console.error("⚠️ Error deleting recording file:", error);
    }
  }

  // 状態をリセット
  setRecordingContext(false);
  isProcessing = false;
  pasteTarget = null;
  savedEditor = null;
  savedPosition = null;
  activeRecordingButton = null;

  // ステータスバーを更新
  updateStatusBar("idle");

  console.log("✅ Recording cancelled completely");
  systemLog("録音を完全にキャンセルしました", "INFO");
}

/**
 * 録音を停止してWAVファイルのパスを返す
 * @returns {Promise<string|null>} 録音されたWAVファイルのパス、またはnull
 */
async function stopRecording() {
  if (!soxProcess) {
    console.warn("⚠️ No active recording to stop");
    return null;
  }

  try {
    console.log("🛑 Stopping recording");

    // 共通処理：録音を停止
    if (recordingTimeout) {
      clearTimeout(recordingTimeout);
      recordingTimeout = null;
    }

    if (soxProcess) {
      try {
        soxProcess.kill("SIGINT");
        await new Promise((resolve) => {
          soxProcess.on("exit", () => {
            console.log("✅ SOX process terminated successfully");
            resolve();
          });
          setTimeout(resolve, 2000);
        });
      } catch (error) {
        console.error("⚠️ Error stopping SOX process:", error);
      }
    }

    soxProcess = null;

    // 共通処理：ファイルが作成されるまでポーリング
    let fileFound = false;
    for (let i = 0; i < 30; i++) {
      if (fs.existsSync(outputFile)) {
        fileFound = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (!fileFound) {
      console.error("⚠️ Voice file not found:", outputFile);
      systemLog(`録音ファイルが見つかりません: ${outputFile}`, "ERROR");
      return null;
    }

    const fileStats = fs.statSync(outputFile);
    console.log(`📊 Voice file size: ${fileStats.size} bytes`);
    systemLog(`録音ファイルサイズ: ${fileStats.size} bytes`, "INFO");

    if (fileStats.size === 0) {
      console.warn("⚠️ Empty WAV file (0 bytes)");
      systemLog("空のWAVファイル（0バイト）", "WARNING");
      fs.unlinkSync(outputFile);
      return null;
    }

    // 録音後に音量を正規化（VAD対策）
    await normalizeAudio();

    // ローカルモード用: WAVヘッダーを修正（whisper.cpp互換性のため）
    await fixWavHeader();

    // WAVファイルパスを返す
    systemLog(`録音完了: ${outputFile}`, "INFO");
    return outputFile;
  } catch (e) {
    console.error("❌ Error in stopRecording:", e);

    fs.unlink(outputFile, (err) => {
      if (err) {
        systemLog(`Failed to delete voice file: ${err.message}`, "WARNING");
      } else {
        systemLog(`Deleted voice file: ${outputFile}`, "INFO");
      }
    });

    return null;
  }
}

/**
 * 録音状態をチェック
 * @returns {boolean} 録音中の場合true
 */
function isCurrentlyRecording() {
  return soxProcess !== null;
}

// =====================================================================================================
// 🤖 Whisper実行
// =====================================================================================================

/**
 * Whisper実行（APIモード・ローカルモード両対応）
 * @param {string} outputFile - 録音されたWAVファイルのパス
 * @returns {Promise<string>} 文字起こし結果のテキスト
 */
async function executeWhisper(outputFile) {
  if (!fs.existsSync(outputFile)) {
    systemLog(`Voice file not found: ${outputFile}`, "ERROR");
    throw new Error("voiceFileNotFound");
  }

  // 音声ファイルの詳細をログ出力
  const fileStats = fs.statSync(outputFile);
  systemLog(`Voice file size: ${fileStats.size} bytes`, "INFO");

  if (fileStats.size === 0) {
    systemLog("Voice file is empty!", "ERROR");
    vscode.window.showErrorMessage(msg("voiceFileEmpty"));
    throw new Error("voiceFileNotFound");
  }

  const config = vscode.workspace.getConfiguration("voiceToText");

  // ========== モード判定 ==========
  const mode = config.get("mode") || "api";
  systemLog(`Current mode: ${mode}`, "INFO");

  // ========== 共通設定取得 ==========
  // 翻訳機能
  const enableTranslation = config.get("enableTranslation", false);

  // プロンプト機能: プリセット + カスタムの併用
  const promptPreset = config.get("promptPreset", "none");
  const customPrompt = config.get("customPrompt", "");

  let prompt = "";

  // プリセットプロンプトを追加
  if (promptPreset !== "none" && PROMPT_PRESETS[promptPreset]) {
    prompt = PROMPT_PRESETS[promptPreset];
  }

  // カスタムプロンプトを追加
  if (customPrompt && customPrompt.trim()) {
    if (prompt) {
      // プリセット + カスタム
      prompt = `${prompt}, ${customPrompt.trim()}`;
    } else {
      // カスタムのみ
      prompt = customPrompt.trim();
    }
  }

  if (prompt) {
    console.log(
      `🎯 Using prompt (${promptPreset}${
        customPrompt ? " + custom" : ""
      }): ${prompt.substring(0, 50)}${prompt.length > 50 ? "..." : ""}`
    );
  }
  // ========== APIモード ==========
  if (mode === "api") {
    systemLog("Using OpenAI API", "INFO");
    const apiKey = await extensionContext.secrets.get("openaiApiKey");

    if (!apiKey) {
      vscode.window.showWarningMessage(msg("apiKeyMissing"));
      systemLog("Missing API key", "WARNING");
      throw new Error("apiKeyMissing");
    }

    console.log(`📝 Sending WAV to OpenAI API (${fileStats.size} bytes)`);

    try {
      const openai = new OpenAI({ apiKey });

      const options = {
        file: fs.createReadStream(outputFile),
        model: "whisper-1",
        prompt: prompt || undefined,
      };
      let res;
      if (enableTranslation) {
        console.log("🌍 Using translation API (to English)");

        res = await openai.audio.translations.create(options);
      } else {
        console.log("📝 Using transcription API (original language)");

        res = await openai.audio.transcriptions.create(options);
      }

      let result = res.text;
      systemLog(`API response text: "${result}"`, "INFO");

      // カスタム辞書による自動置換
      result = applyCustomDictionary(result);

      return result;
    } catch (e) {
      console.error("❌ Whisper API error:", e);

      if (e.code === "ENOENT") {
        vscode.window.showErrorMessage(msg("voiceFileNotFound"));
      } else if (e.status === 401) {
        vscode.window.showErrorMessage(msg("invalidApiKey"));
      } else if (e.status === 429) {
        vscode.window.showErrorMessage(msg("apiRateLimit"));
      } else {
        vscode.window.showErrorMessage(msg("whisperApiError"));
      }

      throw new Error("apiWhisperError");
    } finally {
      // WAVファイルを削除
      fs.unlink(outputFile, (err) => {
        if (err) {
          systemLog(`Failed to delete voice file: ${err.message}`, "WARNING");
        } else {
          systemLog(`Deleted voice file: ${outputFile}`, "INFO");
        }
      });
    }
  } else {
    // ========== ローカルモード ==========
    systemLog("Using local whisper.cpp", "INFO");
    const selectedModel = config.get("localModel") || "small";
    systemLog(`Model: ${selectedModel}`, "INFO");

    // プラットフォーム判定
    const platform = process.platform; // 'win32', 'darwin', 'linux'
    const isWindows = platform === "win32";
    const isMac = platform === "darwin";
    const isLinux = platform === "linux";

    // プラットフォーム別の実行ファイルパス
    const possibleExePaths = [];

    // ユーザーディレクトリのカスタムビルド (最優先)
    const customBuildDir = getCustomBuildDir();
    if (isWindows) {
      possibleExePaths.push(
        path.join(customBuildDir, "whisper-cli.exe"),
        path.join(customBuildDir, "main.exe")
      );
    } else {
      possibleExePaths.push(
        path.join(customBuildDir, "whisper-cli"),
        path.join(customBuildDir, "main")
      );
    }

    if (isWindows) {
      // Windows用パス(デフォルトのbin/ → whisper.cpp/build/)
      possibleExePaths.push(
        // デフォルトのCPU版
        path.join(__dirname, "bin", "windows", "whisper-cli.exe"),
        path.join(__dirname, "bin", "windows", "main.exe"),
        // 開発用 (whisper.cpp/build/)
        path.join(
          __dirname,
          "whisper.cpp",
          "build",
          "bin",
          "Release",
          "whisper-cli.exe"
        ),
        path.join(
          __dirname,
          "whisper.cpp",
          "build",
          "bin",
          "Release",
          "main.exe"
        ),
        path.join(__dirname, "whisper.cpp", "build", "bin", "whisper-cli.exe"),
        path.join(__dirname, "whisper.cpp", "build", "bin", "main.exe")
      );
    } else if (isMac) {
      // macOS用パス(デフォルトのbin/ → whisper.cpp/build/)
      possibleExePaths.push(
        // デフォルトのMetal版
        path.join(__dirname, "bin", "macos", "whisper-cli"),
        // 開発用 (whisper.cpp/build/)
        path.join(
          __dirname,
          "whisper.cpp",
          "build",
          "bin",
          "macos",
          "whisper-cli"
        ),
        path.join(__dirname, "whisper.cpp", "build", "bin", "whisper-cli"),
        path.join(__dirname, "whisper.cpp", "main"), // Makefileでビルドした場合
        path.join(__dirname, "whisper.cpp", "whisper-cli")
      );
    } else if (isLinux) {
      // Linux用パス(デフォルトのbin/ → whisper.cpp/build/)
      possibleExePaths.push(
        // デフォルトのCPU版
        path.join(__dirname, "bin", "linux", "whisper-cli"),
        // 開発用 (whisper.cpp/build/)
        path.join(
          __dirname,
          "whisper.cpp",
          "build",
          "bin",
          "linux",
          "whisper-cli"
        ),
        path.join(__dirname, "whisper.cpp", "build", "bin", "whisper-cli"),
        path.join(__dirname, "whisper.cpp", "main"), // Makefileでビルドした場合
        path.join(__dirname, "whisper.cpp", "whisper-cli")
      );
    }

    let whisperPath = null;
    for (const exePath of possibleExePaths) {
      if (fs.existsSync(exePath)) {
        whisperPath = exePath;
        systemLog(`Found whisper executable: ${exePath}`, "INFO");
        break;
      }
    }

    if (!whisperPath) {
      const errorMsg = `Whisper executable not found. Tried: ${possibleExePaths.join(
        ", "
      )}`;
      systemLog(errorMsg, "ERROR");
      vscode.window.showErrorMessage(msg("whisperNotFound"));
      throw new Error("whisperNotFound");
    }

    // モデルパス: ユーザーディレクトリ → 拡張機能ディレクトリ (後方互換)
    const modelDir = getModelDir();
    const modelPath = path.join(modelDir, `ggml-${selectedModel}.bin`);
    const fallbackModelPath = path.join(
      __dirname,
      "whisper.cpp",
      "models",
      `ggml-${selectedModel}.bin`
    );

    let finalModelPath = null;
    if (fs.existsSync(modelPath)) {
      finalModelPath = modelPath;
      systemLog(`Using model from user directory: ${modelPath}`, "INFO");
    } else if (fs.existsSync(fallbackModelPath)) {
      finalModelPath = fallbackModelPath;
      systemLog(
        `Using model from extension directory: ${fallbackModelPath}`,
        "INFO"
      );
    }

    // モデル存在確認
    if (!finalModelPath) {
      systemLog(
        `Model file not found: ${modelPath} (or ${fallbackModelPath})`,
        "ERROR"
      );
      vscode.window.showErrorMessage(
        msg("modelNotFound", { model: selectedModel })
      );
      throw new Error("modelNotFound");
    }

    try {
      // 基本引数
      const args = [
        "-m",
        finalModelPath,
        "-f",
        outputFile,
        // --no-timestampsを削除（長い音声の認識不良の原因）
        "--language",
        "auto",
      ];

      // 🌍 翻訳機能
      if (enableTranslation) {
        args.push("--translate");
        systemLog(
          "Translation enabled: speech will be translated to English",
          "INFO"
        );
      } else {
        systemLog("Language: auto-detect (no translation)", "INFO");
      }

      // 🎯 プロンプト機能
      if (prompt && prompt.trim()) {
        args.push("--prompt", prompt);
      }

      // 🚫 フィラー除去機能
      const suppressNonSpeech = config.get("suppressNonSpeech", true);
      if (suppressNonSpeech) {
        args.push("-sns");
        systemLog(
          "Non-speech token suppression enabled (fillers removed)",
          "INFO"
        );
      }

      // ⚡ スレッド数最適化
      const threads = config.get("threads", 0);
      const actualThreads = threads > 0 ? threads : os.cpus().length;
      args.push("-t", actualThreads.toString());
      systemLog(`Using ${actualThreads} CPU threads`, "INFO");

      // 🔇 VAD (Voice Activity Detection)
      const enableVAD = config.get("enableVAD", true);
      if (enableVAD) {
        // VADモデルのパスを構築（全プラットフォーム共通）
        const vadModelPath = path.join(
          extensionContext.extensionPath,
          "models",
          "ggml-silero-v5.1.2.bin"
        );

        // VADモデルが存在する場合のみ有効化
        if (fs.existsSync(vadModelPath)) {
          args.push("--vad", "-vm", vadModelPath);
          systemLog(`VAD enabled with model: ${vadModelPath}`, "INFO");
        } else {
          systemLog(
            `VAD model not found: ${vadModelPath}, skipping VAD`,
            "WARNING"
          );
        }
      }

      systemLog(`Executing: ${whisperPath} ${args.join(" ")}`, "INFO");
      const { stdout, stderr } = await execFilePromise(whisperPath, args);

      // stderrにログがあれば記録（whisper.cppは多くの情報をstderrに出力）
      if (stderr) {
        systemLog(`Whisper stderr: ${stderr}`, "INFO");
      }

      systemLog(`Whisper stdout length: ${stdout.length}`, "INFO");

      // stdoutから純粋なテキストを抽出（ログ行とタイムスタンプを除外）
      const lines = stdout.split("\n");
      const textLines = lines.filter((line) => {
        const trimmed = line.trim();
        // whisper_ や main: などのログ行を除外
        return (
          trimmed &&
          !trimmed.startsWith("whisper_") &&
          !trimmed.startsWith("output_txt:") &&
          !trimmed.startsWith("main:") &&
          !trimmed.startsWith("system_info:") &&
          !trimmed.startsWith("sampling") &&
          !line.includes("WARNING:") &&
          !line.includes("processing") &&
          !line.includes("samples,")
        );
      });

      // タイムスタンプを除去（例: [00:00:00.000 --> 00:00:05.000] text）
      let result = textLines
        .map((line) => {
          // タイムスタンプパターンを除去: [00:00:00.000 --> 00:00:05.000]
          return line.replace(
            /\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]\s*/g,
            ""
          );
        })
        .join(" ")
        .trim();

      systemLog(`Extracted text: "${result}"`, "INFO");

      // カスタム辞書による自動置換
      result = applyCustomDictionary(result);

      return result;
    } catch (error) {
      console.error("❌ Local Whisper error:", error);
      systemLog(`Whisper execution failed: ${error.message}`, "ERROR");

      // ユーザーに通知
      vscode.window.showErrorMessage(
        msg("whisperExecutionFailed", { error: error.message })
      );

      // エラー詳細をログに記録
      if (error.stderr) {
        systemLog(`Stderr: ${error.stderr}`, "ERROR");
      }
      if (error.stdout) {
        systemLog(`Stdout: ${error.stdout}`, "ERROR");
      }
      if (error.code) {
        systemLog(`Error code: ${error.code}`, "ERROR");
      }

      throw new Error("localWhisperError");
    } finally {
      // WAVファイルを削除
      fs.unlink(outputFile, (err) => {
        if (err) {
          systemLog(`Failed to delete voice file: ${err.message}`, "WARNING");
        } else {
          systemLog(`Deleted voice file: ${outputFile}`, "INFO");
        }
      });
    }
  }
}

// =====================================================================================================
// 🎬 VS Code拡張機能のエントリーポイント
// =====================================================================================================

/**
 * 拡張機能のアクティベーション（VS Code起動時に呼ばれる）
 * @param {vscode.ExtensionContext} context - 拡張機能のコンテキスト
 * @returns {Promise<void>}
 */
async function activate(context) {
  console.log("🟢 Voice to Text (also for Copilot Chat): Activation started");

  // グローバル変数に保存
  extensionContext = context;

  // 初期状態のコンテキストキーを設定
  vscode.commands.executeCommand(
    "setContext",
    "voiceToText.isRecording",
    false
  );

  try {
    // --- アウトプットチャンネル作成 ---
    outputChannel = vscode.window.createOutputChannel(
      "Voice to Text (also for Copilot Chat)"
    );
    extensionContext.subscriptions.push(outputChannel);

    // --- バイナリファイルの実行権限を確保 ---
    await ensureBinaryPermissions();

    // --- 設定を取得 ---
    const config = vscode.workspace.getConfiguration("voiceToText");
    let lang = config.get("language");

    // --- 言語自動検出（初回のみ） ---
    if (!lang) {
      const supportedLangs = [
        "ja",
        "en",
        "fr",
        "es",
        "zh",
        "ko",
        "de",
        "it",
        "ru",
      ];
      const vscodeLang = vscode.env.language.split("-")[0];
      lang = supportedLangs.includes(vscodeLang) ? vscodeLang : "en";
      await config.update("language", lang, vscode.ConfigurationTarget.Global);
      console.log("🌏 Auto language set to:", lang);
    }

    // --- ロケールをロード ---
    messages = loadLocale(lang);
    console.log("Locale loaded:", lang);

    // システムログに初期化完了を記録
    systemLog(msg("activated"), "INFO");

    // --- 初回セットアップチェック ---
    const hasConfigured = extensionContext.globalState.get("hasConfiguredMode");
    if (!hasConfigured) {
      await runInitialSetup(config, msg);
    }

    // --- SOXインストールチェック（Mac/Linuxのみ） ---
    const soxCheck = await checkSoxInstallation();
    if (!soxCheck.installed) {
      systemLog(
        `⚠️ SOX not found on ${soxCheck.platform}. Recording will fail.`,
        "WARNING"
      );
      await promptSoxInstallation(soxCheck.platform);
    } else {
      systemLog(`✅ SOX is installed (${soxCheck.platform})`, "INFO");
    }

    // --- ステータスバーアイテム作成 (4つ) - 右寄せ ---
    // 区切り記号＋ステータス表示
    statusBarItemStatus = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      1000 // 一番左（右寄せエリア内）- 高い優先度で確実に左端に配置
    );
    statusBarItemStatus.text = msg("statusWaiting");
    statusBarItemStatus.tooltip = "Voice to Text (also for Copilot Chat)";
    statusBarItemStatus.show();
    extensionContext.subscriptions.push(statusBarItemStatus);

    // 翻訳トグルボタン (ステータス表示の右隣)
    statusBarItemTranslate = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      999 // ステータス表示の右隣
    );
    statusBarItemTranslate.text = "🔤";
    statusBarItemTranslate.command = "voiceToText.toggleTranslation";
    statusBarItemTranslate.tooltip = "Translation: OFF - Click to enable";
    extensionContext.subscriptions.push(statusBarItemTranslate);

    // Focusボタン (翻訳ボタンの右隣)
    statusBarItemFocus = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      998 // 翻訳ボタンの右隣
    );
    statusBarItemFocus.command = "voiceToText.toggle";
    statusBarItemFocus.text = "📍Focus";
    statusBarItemFocus.tooltip = msg("recordToEditor");
    statusBarItemFocus.show();
    extensionContext.subscriptions.push(statusBarItemFocus);

    // Chatボタン (Focusボタンの右隣)
    statusBarItemChat = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      997 // Focusボタンの右隣
    );
    statusBarItemChat.command = "voiceToText.toggleForChat";
    statusBarItemChat.text = "💬Chat";
    statusBarItemChat.tooltip = msg("recordToChat");
    statusBarItemChat.show();
    extensionContext.subscriptions.push(statusBarItemChat);

    // 初期状態でステータスバーを更新
    updateStatusBar("idle");

    // --- 設定変更イベントリスナー ---
    // 現在の設定値を保存（変更前の値として使用）
    const initialConfig = vscode.workspace.getConfiguration("voiceToText");
    await extensionContext.globalState.update(
      "previousLocalModel",
      initialConfig.get("localModel", "small")
    );

    extensionContext.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration("voiceToText.mode")) {
          systemLog("Mode configuration changed", "INFO");
          await handleModeChange();
          updateStatusBar("idle");
        } else if (e.affectsConfiguration("voiceToText.localModel")) {
          systemLog("Local model configuration changed", "INFO");
          // 変更前の値を保存してからハンドル
          const currentConfig =
            vscode.workspace.getConfiguration("voiceToText");
          const previousModel = extensionContext.globalState.get(
            "previousLocalModel",
            "small"
          );
          await handleLocalModelChange();
          // 新しい値を保存（成功した場合のみ）
          const newModel = currentConfig.get("localModel");
          if (newModel !== previousModel) {
            await extensionContext.globalState.update(
              "previousLocalModel",
              newModel
            );
          }
          updateStatusBar("idle");
        } else if (e.affectsConfiguration("voiceToText.enableTranslation")) {
          systemLog("Translation configuration changed", "INFO");
          updateTranslateButton();
        }
      })
    );

    // コマンド登録
    registerCommands();
    console.log("✅ Commands registered successfully (refactored)");
  } catch (err) {
    console.error("💥 Activation failed:", err);
    vscode.window.showErrorMessage(
      msg("activationFailed", { error: err.message })
    );
  }
}

// =====================================================================================================
// 🧹 拡張機能の終了処理
// =====================================================================================================

/**
 * 拡張機能の非アクティブ化（VS Code終了時に呼ばれる）
 * @returns {void}
 */
function deactivate() {
  stopRecordingTimer(); // タイマー停止
  if (statusBarItemStatus) {
    statusBarItemStatus.dispose();
  }
  if (statusBarItemFocus) {
    statusBarItemFocus.dispose();
  }
  if (statusBarItemChat) {
    statusBarItemChat.dispose();
  }
  if (statusBarItemTranslate) {
    statusBarItemTranslate.dispose();
  }
  if (outputChannel) {
    outputChannel.dispose();
  }
  console.log("🧹 Voice to Text (also for Copilot Chat): deactivated");
}

// =====================================================================================================
// 🎯 コマンド実行関数
// =====================================================================================================

/**
 * 録音停止～音声認識～テキスト貼り付けまでの全工程を実行
 * @returns {Promise<void>}
 */
async function stopRecordingAndProcessVoice() {
  try {
    // 📍 録音状態をリセット
    setRecordingContext(false);
    stopRecordingTimer(); // タイマー停止

    isProcessing = true;
    updateStatusBar("processing");
    systemLog(msg("sendingToWhisper"), "INFO");

    // 📍 'auto' モードの場合、現在のカーソル位置を保存
    if (pasteTarget === "auto") {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        savedEditor = editor;
        savedPosition = editor.selection.active;
        systemLog(
          `📍 保存された位置: 行 ${savedPosition.line + 1}, 列 ${
            savedPosition.character + 1
          }`,
          "INFO"
        );
      } else {
        systemLog(
          "📍 エディタ位置が保存できませんでした - 現在のフォーカス位置に貼り付けます",
          "INFO"
        );
        // アクティブなエディタがない場合でも現在のフォーカス位置に貼り付け
        // （Copilotチャットなど、フォーカスがある場所に貼り付けられる）
      }
    }

    // 録音停止してWAVファイルを取得
    const outputFile = await stopRecording();
    if (!outputFile) {
      systemLog("録音ファイルの取得に失敗しました", "ERROR");
      throw new Error("Failed to get audio file");
    }

    // Whisper実行
    const text = await executeWhisper(outputFile);

    if (text && text.trim()) {
      const currentConfig = vscode.workspace.getConfiguration("voiceToText");
      addToHistory(text, currentConfig.get("mode", "api"));

      // 📍 保存された貼り付け先に応じて処理を分岐
      if (pasteTarget === "chat") {
        // Copilot Chatに貼り付け
        await pasteToChat(text);
      } else if (pasteTarget === "auto" && savedEditor && savedPosition) {
        // 保存された位置に貼り付け
        await pasteToSavedPosition(text);
      } else {
        // フォールバック: 従来の動作 (クリップボード経由で貼り付け)
        await pasteToCurrentFocus(text);
      }

      // 貼り付け先情報をリセット
      pasteTarget = null;
      savedEditor = null;
      savedPosition = null;

      updateStatusBar("success");
      setTimeout(() => {
        updateStatusBar("idle");
        systemLog("Status bar reset to idle", "INFO");
      }, 3000);

      systemLog(msg("pasteDone"), "SUCCESS");
    } else {
      systemLog(msg("noAudioOrFail"), "WARNING");
      vscode.window.showWarningMessage(msg("noAudioOrFail"));
      updateStatusBar("idle");
    }
  } catch (error) {
    systemLog(`Failed to process recording: ${error.message}`, "ERROR");
    vscode.window.showErrorMessage(
      msg("processingFailed", { error: error.message })
    );
    updateStatusBar("idle");
  } finally {
    isProcessing = false;
  }
}

/**
 * トグルコマンドの処理（録音開始/停止と結果貼り付け）
 * @returns {Promise<void>}
 */
async function handleToggleCommand() {
  console.log("🎙️ Command executed: voiceToText.toggle");

  if (isProcessing) {
    vscode.window.showWarningMessage(msg("processingWait"));
    return;
  }

  const currentConfig = vscode.workspace.getConfiguration("voiceToText");
  const maxSec = currentConfig.get("maxRecordSeconds") || 180;

  if (!isRecording || !isCurrentlyRecording()) {
    // 録音開始
    try {
      setRecordingContext(true);
      startRecordingTimer(maxSec); // タイマー開始
      updateStatusBar("recording", 0, maxSec);
      systemLog(msg("recordingStart", { seconds: maxSec }), "INFO");
      startRecording(maxSec);
    } catch (error) {
      setRecordingContext(false);
      stopRecordingTimer(); // タイマー停止
      updateStatusBar("idle");
      systemLog(`Failed to start recording: ${error.message}`, "ERROR");

      // ユーザーに通知
      const errorMessage =
        error.message === "soxNotInstalled"
          ? msg("soxNotInstalled")
          : msg("recordingStartFailed", { error: error.message });
      vscode.window.showErrorMessage(errorMessage);
    }
  } else {
    // 録音停止～処理
    await stopRecordingAndProcessVoice();
  }
}

/**
 * すべてのコマンドを登録
 * @returns {vscode.Disposable[]} 登録されたコマンドのDisposable配列
 */
function registerCommands() {
  const disposables = [];

  disposables.push(
    vscode.commands.registerCommand("voiceToText.toggle", () => {
      // 現在のフォーカス位置に貼り付け (従来の動作)
      pasteTarget = "auto";
      activeRecordingButton = "focus";
      handleToggleCommand();
    })
  );

  disposables.push(
    vscode.commands.registerCommand("voiceToText.toggleForChat", () => {
      // Copilot Chatに貼り付け (新機能)
      pasteTarget = "chat";
      activeRecordingButton = "chat";
      systemLog("📍 Copilot Chatに貼り付けます", "INFO");
      handleToggleCommand();
    })
  );

  disposables.push(
    vscode.commands.registerCommand(
      "voiceToText.confirmCancelProcessing",
      async () => {
        // 処理中のステータスバーをクリックした時の確認ダイアログ
        if (isProcessing) {
          const choice = await vscode.window.showWarningMessage(
            msg("confirmCancelProcessing") || "処理を中止しますか？",
            { modal: true },
            msg("yes") || "はい",
            msg("no") || "いいえ"
          );

          if (choice === (msg("yes") || "はい")) {
            systemLog("🔴 処理をキャンセルしました（ユーザーが確認）", "INFO");
            vscode.window.showInformationMessage("🔴 処理をキャンセルしました");

            // 状態をリセット
            isProcessing = false;
            setRecordingContext(false);

            // 録音タイマーを停止
            stopRecordingTimer();

            // whisper.jsの録音プロセスをクリーンアップ
            if (isCurrentlyRecording()) {
              try {
                await stopRecording();
              } catch (e) {
                console.error("⚠️ Error during cleanup:", e);
              }
            }

            // 一時ファイルを削除
            const voiceFile = path.join(__dirname, "voice.wav");
            if (fs.existsSync(voiceFile)) {
              try {
                fs.unlinkSync(voiceFile);
                console.log("🗑️ Deleted temporary voice file");
              } catch (e) {
                console.error("⚠️ Failed to delete temporary file:", e);
              }
            }

            updateStatusBar("idle");
          }
        }
      }
    )
  );

  disposables.push(
    vscode.commands.registerCommand("voiceToText.cancelRecording", async () => {
      // 録音・処理をキャンセル
      if (isRecording || isProcessing) {
        const action = isRecording ? "録音" : "処理";
        systemLog(`🔴 ${action}をキャンセルしました`, "INFO");
        vscode.window.showInformationMessage(
          `🔴 ${action}をキャンセルしました`
        );

        if (isRecording) {
          // 録音中の場合は完全にキャンセル（音声処理をスキップ）
          await cancelRecordingCompletely();
        } else if (isProcessing) {
          // 処理中の場合は強制的に状態をリセット
          isProcessing = false;
          updateStatusBar("idle");
        }
      } else {
        vscode.window.showInformationMessage(
          "現在、録音または処理は実行されていません"
        );
      }
    })
  );

  disposables.push(
    vscode.commands.registerCommand(
      "voiceToText.toggleTranslation",
      async () => {
        const config = vscode.workspace.getConfiguration("voiceToText");
        const currentValue = config.get("enableTranslation", false);

        await config.update(
          "enableTranslation",
          !currentValue,
          vscode.ConfigurationTarget.Global
        );

        const newValue = !currentValue;
        const statusMsg = newValue
          ? "🌍 Translation enabled (to English)"
          : "🌍 Translation disabled";

        vscode.window.showInformationMessage(statusMsg);
        systemLog(statusMsg, "INFO");

        // ステータスバーを更新
        updateTranslateButton();
      }
    )
  );

  disposables.push(
    vscode.commands.registerCommand("voiceToText.setApiKey", async () => {
      const key = await vscode.window.showInputBox({
        prompt: msg("promptApiKey"),
        ignoreFocusOut: true,
        password: true,
      });
      if (key) {
        await extensionContext.secrets.store("openaiApiKey", key);
        systemLog(msg("apiKeySaved"), "SUCCESS");
      }
    })
  );

  disposables.push(
    vscode.commands.registerCommand("voiceToText.setupWizard", async () => {
      systemLog("Running setup wizard manually", "INFO");
      const config = vscode.workspace.getConfiguration("voiceToText");
      await runInitialSetup(config, msg);
    })
  );

  disposables.push(
    vscode.commands.registerCommand("voiceToText.showHistory", async () => {
      const history = getHistory();
      if (history.length === 0) {
        vscode.window.showInformationMessage(
          msg("historyEmpty") || "履歴がありません"
        );
        return;
      }
      const items = history.map((entry, index) => {
        const preview =
          entry.text.length > 60
            ? entry.text.substring(0, 60) + "..."
            : entry.text;
        const date = new Date(entry.timestamp);
        const timeStr = date.toLocaleString();
        return {
          label: `$(history) ${index + 1}. ${preview}`,
          description: `${entry.mode.toUpperCase()} - ${timeStr}`,
          detail: entry.text,
          entry: entry,
        };
      });
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder:
          msg("historySelectPlaceholder") ||
          "Whisper履歴から選択してクリップボードにコピー",
        matchOnDescription: true,
        matchOnDetail: true,
      });
      if (selected) {
        await vscode.env.clipboard.writeText(selected.entry.text);
        vscode.window.showInformationMessage(
          msg("copiedToClipboard") || "クリップボードにコピーしました"
        );
        systemLog(
          `Copied from history: "${selected.entry.text.substring(0, 50)}..."`,
          "INFO"
        );
      }
    })
  );

  // カスタムビルドフォルダーを開くコマンド
  disposables.push(
    vscode.commands.registerCommand(
      "voiceToText.openCustomBuildFolder",
      async () => {
        const customDir = getCustomBuildDir(); // ユーザーディレクトリに変更
        const platform = process.platform;
        let platformName;

        if (platform === "win32") {
          platformName = "Windows";
        } else if (platform === "darwin") {
          platformName = "macOS";
        } else {
          platformName = "Linux";
        }

        // ディレクトリが存在しない場合は作成
        ensureDirectoryExists(customDir);

        // エクスプローラー/Finderで開く
        try {
          const uri = vscode.Uri.file(customDir);
          await vscode.commands.executeCommand("revealFileInOS", uri);

          // 情報メッセージ
          const message = msg("customBuildFolderMessage", {
            platform: platformName,
            folder: customDir,
          });

          vscode.window.showInformationMessage(message);
          systemLog(`Opened custom build folder: ${customDir}`, "INFO");
        } catch (error) {
          vscode.window.showErrorMessage(
            msg("folderOpenFailed", { folder: customDir })
          );
          systemLog(`Failed to open custom build folder: ${error}`, "ERROR");
        }
      }
    )
  );

  // クリーンアップコマンド (モデルとカスタムビルドを削除)
  disposables.push(
    vscode.commands.registerCommand("voiceToText.cleanUp", async () => {
      const userDataDir = getUserDataDir();

      // ディレクトリが存在しない場合
      if (!fs.existsSync(userDataDir)) {
        vscode.window.showInformationMessage(msg("noDataToDelete"));
        return;
      }

      // ディレクトリサイズを計算
      let totalSize = 0;
      const calculateSize = (dirPath) => {
        if (!fs.existsSync(dirPath)) return;
        const files = fs.readdirSync(dirPath);
        files.forEach((file) => {
          const filePath = path.join(dirPath, file);
          const stats = fs.statSync(filePath);
          if (stats.isDirectory()) {
            calculateSize(filePath);
          } else {
            totalSize += stats.size;
          }
        });
      };
      calculateSize(userDataDir);
      const sizeMB = (totalSize / 1024 / 1024).toFixed(1);

      // 確認ダイアログ
      const choice = await vscode.window.showWarningMessage(
        msg("confirmDeleteMessage", { folder: userDataDir, size: sizeMB }),
        { modal: true },
        msg("confirmDelete"),
        msg("cancelDelete")
      );

      if (choice !== msg("confirmDelete")) {
        return;
      }

      // 削除実行
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
        vscode.window.showInformationMessage(
          msg("dataDeleted", { size: sizeMB })
        );
        systemLog(`Cleaned up user data: ${userDataDir}`, "INFO");
      } catch (error) {
        vscode.window.showErrorMessage(
          msg("deleteFailed", { error: error.message })
        );
        systemLog(`Failed to clean up user data: ${error}`, "ERROR");
      }
    })
  );

  extensionContext.subscriptions.push(...disposables);
}

module.exports = {
  activate,
  deactivate,
};
