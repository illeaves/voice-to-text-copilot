/**
 * Voice to Text (also for Copilot Chat) Extension for VS Code
 * Author: aleaf
 */
"use strict";

// ====== Imports ======
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const https = require("https");
const {
  startRecording,
  stopRecording,
  isCurrentlyRecording,
} = require("./whisper.js");
const { execFile } = require("child_process");
const util = require("util");
const execFilePromise = util.promisify(execFile);
const os = require("os");

// ====== Global State ======
let isRecording = false; // 録音中か
let isProcessing = false; // 音声→テキスト処理中か
let messages = {}; // ローカライズメッセージ
let statusBarItemStatus; // ステータスバー項目 (ステータス表示)
let statusBarItemFocus; // ステータスバー項目 (Focus)
let statusBarItemChat; // ステータスバー項目 (Chat)
let outputChannel; // アウトプットチャンネル
let recordingTimer = null; // 録音時間表示用タイマー
let recordingStartTime = null; // 録音開始時刻
let recordingMaxSeconds = 180; // 最大録音時間
let activeRecordingButton = null; // 'focus' or 'chat' - どちらのボタンで録音開始したか

// 📍 貼り付け先情報の保存
let pasteTarget = null; // 'auto' or 'chat'
let savedEditor = null; // 録音開始時のエディタ
let savedPosition = null; // 録音開始時のカーソル位置

// ====== History Constants ======
const WHISPER_HISTORY_KEY = "whisperHistory"; // 履歴保存キー
const MAX_HISTORY_SIZE = 10; // 最大履歴件数

// ====== Binary Permissions ======
/**
 * バイナリファイルの実行権限を確保
 */
async function ensureBinaryPermissions(context) {
  const platform = process.platform;
  let binaryPath;

  if (platform === "darwin") {
    binaryPath = path.join(context.extensionPath, "bin", "macos", "whisper-cli");
  } else if (platform === "linux") {
    binaryPath = path.join(context.extensionPath, "bin", "linux", "whisper-cli");
  } else {
    // Windows は権限設定不要
    return;
  }

  try {
    // ファイルの存在確認
    if (!fs.existsSync(binaryPath)) {
      console.log(`⚠️ Binary not found: ${binaryPath}`);
      return;
    }

    // 実行権限をチェック
    const stats = fs.statSync(binaryPath);
    const hasExecutePermission = (stats.mode & parseInt('111', 8)) !== 0;

    if (!hasExecutePermission) {
      console.log(`🔧 Adding execute permission to: ${binaryPath}`);
      fs.chmodSync(binaryPath, stats.mode | parseInt('755', 8));
      console.log(`✅ Execute permission added successfully`);
    } else {
      console.log(`✅ Binary already has execute permission: ${binaryPath}`);
    }
  } catch (error) {
    console.error(`⚠️ Failed to set binary permissions: ${error.message}`);
    // 権限エラーは致命的ではないので続行
  }
}

// ====== Localization ======
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

function msg(key, vars = {}) {
  let text = messages[key] || key;
  for (const [k, v] of Object.entries(vars)) {
    text = text.replace(`{{${k}}}`, v);
  }
  return text;
}

// ====== User Directory Helpers ======
/**
 * ユーザーディレクトリのベースパスを取得
 * ~/.vscode/voice-to-text-copilot/
 */
function getUserDataDir() {
  const homeDir = os.homedir();
  return path.join(homeDir, ".vscode", "voice-to-text-copilot");
}

/**
 * モデルファイル保存ディレクトリを取得
 * ~/.vscode/voice-to-text-copilot/models/
 */
function getModelDir() {
  return path.join(getUserDataDir(), "models");
}

/**
 * カスタムビルド保存ディレクトリを取得 (プラットフォーム別)
 * ~/.vscode/voice-to-text-copilot/custom-builds/windows/
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
 */
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    systemLog(`Created directory: ${dirPath}`, "INFO");
  }
}

// ====== Logging ======
function systemLog(message, level = "INFO") {
  const timestamp = new Date().toLocaleTimeString();
  const logMessage = `[${timestamp}] ${level}: ${message}`;
  console.log(logMessage);
  if (outputChannel) outputChannel.appendLine(logMessage);
}

// ====== SOX Installation Check ======
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

// ====== Status Bar Helper ======
/**
 * 📝 ステータスバー更新（状態に応じて）
 * @param {string} state - idle, recording, processing, success
 * @param {number} elapsed - 経過秒数（recording時のみ）
 * @param {number} max - 最大秒数（recording時のみ）
 */
function updateStatusBar(state = "idle", elapsed = 0, max = 0) {
  if (!statusBarItemStatus || !statusBarItemFocus || !statusBarItemChat) return;

  // 現在のモードを取得
  const config = vscode.workspace.getConfiguration("voiceToText");
  const mode = config.get("mode", "api");
  const localModel = config.get("localModel", "small");

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

// ====== 貼り付け処理関数 ======
/**
 * 💬 Copilot Chatに貼り付け
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
 * 📍 保存された位置に貼り付け
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
 * 🔄 現在のフォーカス位置に貼り付け (従来の動作)
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
 * ⏱️ 録音時間表示タイマーを開始
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
 * 🟦 録音時間表示タイマーを停止
 */
function stopRecordingTimer() {
  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }
  recordingStartTime = null;
}

/**
 * 📥 Whisper履歴に追加
 */
function addToHistory(context, text, mode) {
  const history = context.globalState.get(WHISPER_HISTORY_KEY, []);

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

  context.globalState.update(WHISPER_HISTORY_KEY, history);
  systemLog(`📚 Added to history (total: ${history.length})`, "INFO");
}

/**
 * 📜 Whisper履歴を取得
 */
function getHistory(context) {
  return context.globalState.get(WHISPER_HISTORY_KEY, []);
}

/**
 * 📥 モデルダウンロード(リダイレクト対応)
 * @param {string} modelName - モデル名
 * @param {object} msg - ローカライズメッセージ
 * @param {function} onProgress - 進捗コールバック(percent, downloadedMB, totalMB)
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
 * 🎨 初回セットアップウィザード
 */
async function runInitialSetup(context, config, msg) {
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
        await context.globalState.update("hasConfiguredMode", true);
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
  await context.globalState.update("hasConfiguredMode", true);
}

/**
 * 🔄 モード変更時の処理
 */
async function handleModeChange(context) {
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
 * 🔄 ローカルモデル変更時の処理
 */
async function handleLocalModelChange(context) {
  const config = vscode.workspace.getConfiguration("voiceToText");
  const newModel = config.get("localModel");
  const currentMode = config.get("mode");

  systemLog(`Local model changed to: ${newModel}`, "INFO");

  // ローカルモードの場合のみチェック
  if (currentMode === "local") {
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
          await revertModelSelection(context);
        }
      } else {
        // 設定を元に戻す
        await revertModelSelection(context);
      }
    }
  }
}

/**
 * 🔙 モデル選択を元に戻す
 */
async function revertModelSelection(context) {
  const previousModel = context.globalState.get("previousLocalModel", "small");
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
 * 📥 単一モデルのダウンロード
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

/**
 * 🤖 ローカルWhisper実行（whisper.cpp）
 */
async function executeLocalWhisper(outputFile, msg) {
  const config = vscode.workspace.getConfiguration("voiceToText");
  const selectedModel = config.get("localModel") || "small";

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

  // モデル・音声ファイルの存在確認
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

  try {
    // 言語は自動検出して、検出した言語で出力（翻訳しない）
    const args = [
      "-m",
      finalModelPath,
      "-f",
      outputFile,
      "--output-txt",
      "--language",
      "auto",
    ];

    systemLog("Language: auto-detect (no translation)", "INFO");
    systemLog(`Executing: ${whisperPath} ${args.join(" ")}`, "INFO");
    const { stdout, stderr } = await execFilePromise(whisperPath, args);

    // stderrにログがあれば記録（whisper.cppは多くの情報をstderrに出力）
    if (stderr) {
      systemLog(`Whisper stderr: ${stderr}`, "INFO");
    }

    systemLog(`Whisper stdout length: ${stdout.length}`, "INFO");
    systemLog(`Whisper output: ${stdout}`, "INFO");

    // whisper.cppは結果を .txt ファイルに出力する
    const txtOutputFile = `${outputFile}.txt`;
    let result = "";

    // .txtファイルが生成されている場合はそれを読み取る
    if (fs.existsSync(txtOutputFile)) {
      result = fs.readFileSync(txtOutputFile, "utf8").trim();
      systemLog(`Read from txt file: "${result}"`, "INFO");
      // .txtファイルを削除
      fs.unlinkSync(txtOutputFile);
      systemLog(`Deleted txt file: ${txtOutputFile}`, "INFO");
    } else {
      // .txtファイルがない場合はstdoutから抽出（フォールバック）
      const lines = stdout.split("\n");
      const textLines = lines.filter((line) => {
        const trimmed = line.trim();
        // whisper_print_timings などのログ行を除外
        return (
          trimmed &&
          !trimmed.startsWith("whisper_") &&
          !trimmed.startsWith("output_txt:") &&
          !trimmed.startsWith("main:") &&
          !trimmed.startsWith("system_info:") &&
          !line.includes("WARNING:")
        );
      });
      result = textLines.join(" ").trim();
      systemLog(`Extracted from stdout: "${result}"`, "INFO");
    }

    // WAVファイルを削除
    fs.unlink(outputFile, (err) => {
      if (err) {
        systemLog(`Failed to delete voice file: ${err.message}`, "WARNING");
      } else {
        systemLog(`Deleted voice file: ${outputFile}`, "INFO");
      }
    });

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

    // エラー時もWAVファイルを削除
    if (fs.existsSync(outputFile)) {
      fs.unlink(outputFile, (err) => {
        if (err) {
          systemLog(`Failed to delete voice file: ${err.message}`, "WARNING");
        } else {
          systemLog(`Deleted voice file after error: ${outputFile}`, "INFO");
        }
      });
    }

    throw new Error("localWhisperError");
  }
}

/**
 * 🎬 拡張アクティベーション
 */
async function activate(context) {
  console.log("🟢 Voice to Text (also for Copilot Chat): Activation started");

  try {
    // --- アウトプットチャンネル作成 ---
    outputChannel = vscode.window.createOutputChannel(
      "Voice to Text (also for Copilot Chat)"
    );
    context.subscriptions.push(outputChannel);

    // --- バイナリファイルの実行権限を確保 ---
    await ensureBinaryPermissions(context);

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
    console.log("🈶 Locale loaded:", lang);

    // システムログに初期化完了を記録
    systemLog(msg("activated"), "INFO");

    // --- 初回セットアップチェック ---
    const hasConfigured = context.globalState.get("hasConfiguredMode");
    if (!hasConfigured) {
      await runInitialSetup(context, config, msg);
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

    // --- ステータスバーアイテム作成 (3つ) - 右寄せ ---
    // 区切り記号＋ステータス表示
    statusBarItemStatus = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      1000 // 一番左（右寄せエリア内）- 高い優先度で確実に左端に配置
    );
    statusBarItemStatus.text = msg("statusWaiting");
    statusBarItemStatus.tooltip = "Voice to Text (also for Copilot Chat)";
    statusBarItemStatus.show();
    context.subscriptions.push(statusBarItemStatus);

    // Focusボタン
    statusBarItemFocus = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      999 // ステータス表示の右隣
    );
    statusBarItemFocus.command = "voiceToText.toggle";
    statusBarItemFocus.text = "📍Focus";
    statusBarItemFocus.tooltip = msg("recordToEditor");
    statusBarItemFocus.show();
    context.subscriptions.push(statusBarItemFocus);

    // Chatボタン
    statusBarItemChat = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      998 // フォーカスボタンの右隣
    );
    statusBarItemChat.command = "voiceToText.toggleForChat";
    statusBarItemChat.text = "💬Chat";
    statusBarItemChat.tooltip = msg("recordToChat");
    statusBarItemChat.show();
    context.subscriptions.push(statusBarItemChat);

    // 初期状態でステータスバーを更新
    updateStatusBar("idle");

    // --- 設定変更イベントリスナー ---
    // 現在の設定値を保存（変更前の値として使用）
    const initialConfig = vscode.workspace.getConfiguration("voiceToText");
    await context.globalState.update(
      "previousLocalModel",
      initialConfig.get("localModel", "small")
    );

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration("voiceToText.mode")) {
          systemLog("Mode configuration changed", "INFO");
          await handleModeChange(context);
          updateStatusBar("idle");
        } else if (e.affectsConfiguration("voiceToText.localModel")) {
          systemLog("Local model configuration changed", "INFO");
          // 変更前の値を保存してからハンドル
          const currentConfig =
            vscode.workspace.getConfiguration("voiceToText");
          const previousModel = context.globalState.get(
            "previousLocalModel",
            "small"
          );
          await handleLocalModelChange(context);
          // 新しい値を保存（成功した場合のみ）
          const newModel = currentConfig.get("localModel");
          if (newModel !== previousModel) {
            await context.globalState.update("previousLocalModel", newModel);
          }
          updateStatusBar("idle");
        }
      })
    );

    // コマンド登録
    registerCommands(context);
    console.log("✅ Commands registered successfully (refactored)");
  } catch (err) {
    console.error("💥 Activation failed:", err);
    vscode.window.showErrorMessage(
      msg("activationFailed", { error: err.message })
    );
  }
}

/**
 * 🧹 終了処理
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
  if (outputChannel) {
    outputChannel.dispose();
  }
  console.log("🧹 Voice to Text (also for Copilot Chat): deactivated");
}

// ================== 追加: コマンド登録関連ユーティリティ ==================

/**
 * 録音停止～音声認識～テキスト貼り付けまでの全工程（共通処理）
 * @param {vscode.ExtensionContext} context
 */
async function stopRecordingAndProcessVoice(context) {
  try {
    // 📍 録音状態をリセット
    isRecording = false;
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

    const currentConfig = vscode.workspace.getConfiguration("voiceToText");
    const mode = currentConfig.get("mode") || "api";
    systemLog(`Current mode: ${mode}`, "INFO");
    let text;

    if (mode === "local") {
      const localModel = currentConfig.get("localModel") || "small";
      systemLog(`Using local whisper.cpp (model: ${localModel})`, "INFO");
      // 統合関数を使用（ローカルモード）
      const outputFile = await stopRecording("local");
      if (!outputFile) throw new Error("Failed to convert audio file");
      text = await executeLocalWhisper(outputFile, msg);
    } else {
      systemLog("Using OpenAI API", "INFO");
      const apiKey = await context.secrets.get("openaiApiKey");
      if (!apiKey) {
        vscode.window.showWarningMessage(msg("apiKeyMissing"));
        systemLog("Missing API key", "WARNING");
        isProcessing = false;
        updateStatusBar("idle");
        return;
      }
      // 統合関数を使用（APIモード）
      text = await stopRecording("api", apiKey, msg);
    }

    if (text && text.trim()) {
      addToHistory(context, text, currentConfig.get("mode", "api"));

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
 * トグル処理（録音開始/停止と結果貼り付け）
 * 以前のインライン実装を関数化
 * @param {vscode.ExtensionContext} context
 */
async function handleToggleCommand(context) {
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
      const mode = currentConfig.get("mode") || "api";
      isRecording = true;
      startRecordingTimer(maxSec); // タイマー開始
      updateStatusBar("recording", 0, maxSec);
      systemLog(msg("recordingStart", { seconds: maxSec }), "INFO");
      systemLog(`Recording mode: ${mode}`, "INFO");
      await startRecording(
        context,
        maxSec,
        msg,
        stopRecordingAndProcessVoice, // 関数を直接渡す
        mode
      );
    } catch (error) {
      isRecording = false;
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
    // 録音停止～処理（タイムアウト時と全く同じ処理）
    await stopRecordingAndProcessVoice(context);
  }
}

/**
 * コマンド登録を一括実行
 * @param {vscode.ExtensionContext} context
 */
function registerCommands(context) {
  const disposables = [];

  disposables.push(
    vscode.commands.registerCommand("voiceToText.toggle", () => {
      // 現在のフォーカス位置に貼り付け (従来の動作)
      pasteTarget = "auto";
      activeRecordingButton = "focus";
      handleToggleCommand(context);
    })
  );

  disposables.push(
    vscode.commands.registerCommand("voiceToText.toggleForChat", () => {
      // Copilot Chatに貼り付け (新機能)
      pasteTarget = "chat";
      activeRecordingButton = "chat";
      systemLog("📍 Copilot Chatに貼り付けます", "INFO");
      handleToggleCommand(context);
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
            isRecording = false;

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
    vscode.commands.registerCommand("voiceToText.cancelRecording", () => {
      // 録音・処理をキャンセル
      if (isRecording || isProcessing) {
        const action = isRecording ? "録音" : "処理";
        systemLog(`🔴 ${action}をキャンセルしました`, "INFO");
        vscode.window.showInformationMessage(
          `🔴 ${action}をキャンセルしました`
        );

        if (isRecording) {
          // 録音中の場合は停止処理を実行（ただし音声処理はスキップ）
          handleToggleCommand(context);
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
    vscode.commands.registerCommand("voiceToText.setApiKey", async () => {
      const key = await vscode.window.showInputBox({
        prompt: msg("promptApiKey"),
        ignoreFocusOut: true,
        password: true,
      });
      if (key) {
        await context.secrets.store("openaiApiKey", key);
        systemLog(msg("apiKeySaved"), "SUCCESS");
      }
    })
  );

  disposables.push(
    vscode.commands.registerCommand("voiceToText.setupWizard", async () => {
      systemLog("Running setup wizard manually", "INFO");
      const config = vscode.workspace.getConfiguration("voiceToText");
      await runInitialSetup(context, config, msg);
    })
  );

  disposables.push(
    vscode.commands.registerCommand("voiceToText.showHistory", async () => {
      const history = getHistory(context);
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

  disposables.forEach((d) => context.subscriptions.push(d));
}

module.exports = {
  activate,
  deactivate,
};
