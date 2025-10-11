/**
 * Voice to Text + Copilot Chat Extension for VS Code
 * Author: aleaf
 * Version: 1.1.0
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
  stopRecordingLocal,
  isCurrentlyRecording,
} = require("./whisper.js");
const { execFile } = require("child_process");
const util = require("util");
const execFilePromise = util.promisify(execFile);

// ====== Global State ======
let isRecording = false; // 録音中か
let isProcessing = false; // 音声→テキスト処理中か
let messages = {}; // ローカライズメッセージ
let statusBarItem; // ステータスバー項目
let outputChannel; // アウトプットチャンネル
let recordingTimer = null; // 録音時間表示用タイマー
let recordingStartTime = null; // 録音開始時刻
let recordingMaxSeconds = 180; // 最大録音時間

// ====== History Constants ======
const WHISPER_HISTORY_KEY = "whisperHistory"; // 履歴保存キー
const MAX_HISTORY_SIZE = 10; // 最大履歴件数

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

  // Windowsの場合、micモジュールを使うのでSOXチェック不要
  if (platform === "win32") {
    return { installed: true, platform: "windows" };
  }

  // Mac/Linuxの場合、SOXの存在確認
  const soxPath =
    platform === "darwin"
      ? "/opt/homebrew/bin/sox" // Mac (Homebrew)
      : "sox"; // Linux (PATH内)

  try {
    await execFilePromise(soxPath, ["--version"]);
    return { installed: true, platform };
  } catch (error) {
    return { installed: false, platform };
  }
}

async function promptSoxInstallation(platform) {
  const installInstructions = {
    darwin: {
      title: "SOX Required",
      message:
        "SOX is required for audio recording on Mac. Would you like to see installation instructions?",
      instructions: `To install SOX on Mac, run this command in Terminal:

brew install sox

If you don't have Homebrew, install it first:
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`,
    },
    linux: {
      title: "SOX Required",
      message:
        "SOX is required for audio recording on Linux. Would you like to see installation instructions?",
      instructions: `To install SOX on Ubuntu/Debian, run:

sudo apt-get update && sudo apt-get install sox

For other Linux distributions:
- Fedora/RHEL: sudo dnf install sox
- Arch: sudo pacman -S sox`,
    },
  };

  const info = installInstructions[platform];
  if (!info) return;

  const action = await vscode.window.showWarningMessage(
    info.message,
    "Show Instructions",
    "Dismiss"
  );

  if (action === "Show Instructions") {
    const panel = vscode.window.createWebviewPanel(
      "soxInstall",
      info.title,
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
        </style>
      </head>
      <body>
        <h2>${info.title}</h2>
        <pre><code>${info.instructions}</code></pre>
        <p>After installation, please reload VS Code to use the extension.</p>
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
  if (!statusBarItem) return;

  // 現在のモードを取得
  const config = vscode.workspace.getConfiguration("whisperVoiceInput");
  const mode = config.get("mode", "api");
  const localModel = config.get("localModel", "base");

  // モデル名を大文字に変換（Tiny, Base, Small, Medium, Large）
  const modelName = localModel.charAt(0).toUpperCase() + localModel.slice(1);
  const modeLabel = mode === "api" ? "API" : `Local:${modelName}`;

  switch (state) {
    case "recording":
      const remaining = max - elapsed;
      const elapsedMin = Math.floor(elapsed / 60);
      const elapsedSec = elapsed % 60;
      const remainingMin = Math.floor(remaining / 60);
      const remainingSec = remaining % 60;
      statusBarItem.text = `🔴 ${elapsedMin}:${elapsedSec
        .toString()
        .padStart(2, "0")} / ${remainingMin}:${remainingSec
        .toString()
        .padStart(2, "0")}`;
      statusBarItem.tooltip =
        msg("statusRecording") + ` [${modeLabel}] - ` + msg("commandOnlyMode");
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
      break;
    case "processing":
      statusBarItem.text = `$(sync~spin) ${msg(
        "statusProcessing"
      )} [${modeLabel}]`;
      statusBarItem.tooltip =
        msg("statusProcessing") + ` [${modeLabel}] - ` + msg("commandOnlyMode");
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
      break;
    case "success":
      statusBarItem.text = "✅ " + msg("pasteDone");
      statusBarItem.tooltip = msg("pasteDone");
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.prominentBackground"
      );
      break;
    case "idle":
    default:
      statusBarItem.text = `${msg("statusIdle")} [${modeLabel}]`;
      statusBarItem.tooltip =
        msg("statusIdle") + ` [${modeLabel}] - ` + msg("commandOnlyMode");
      statusBarItem.backgroundColor = undefined;
      break;
  }
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
 * ⏹️ 録音時間表示タイマーを停止
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
 * 📥 モデルダウンロード（リダイレクト対応）
 */
async function downloadModel(modelName, msg) {
  const modelUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${modelName}.bin`;
  const modelDir = path.join(__dirname, "whisper.cpp", "models");
  const modelPath = path.join(modelDir, `ggml-${modelName}.bin`);

  // modelsディレクトリ作成
  if (!fs.existsSync(modelDir)) {
    fs.mkdirSync(modelDir, { recursive: true });
  }

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
              const progress = ((downloadedBytes / totalBytes) * 100).toFixed(
                1
              );
              systemLog(`Downloading ${modelName}: ${progress}%`, "INFO");
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
      await vscode.commands.executeCommand("whisperVoiceInput.setApiKey");
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

    // モデルダウンロード
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: msg("downloadingModel", { model: modelChoice.value }),
          cancellable: false,
        },
        async () => {
          await downloadModel(modelChoice.value, msg);
        }
      );

      vscode.window.showInformationMessage(msg("downloadComplete"));
      vscode.window.showInformationMessage(msg("setupComplete"));
    } catch (error) {
      systemLog(`Model download failed: ${error.message}`, "ERROR");
      vscode.window.showErrorMessage(
        msg("downloadFailed", { error: error.message })
      );
    }
  }

  // セットアップ完了フラグ
  await context.globalState.update("hasConfiguredMode", true);
}

/**
 * 🤖 ローカルWhisper実行（whisper.cpp）
 */
async function executeLocalWhisper(outputFile, msg) {
  const config = vscode.workspace.getConfiguration("whisperVoiceInput");
  const selectedModel = config.get("localModel") || "base";

  // プラットフォーム判定
  const platform = process.platform; // 'win32', 'darwin', 'linux'
  const isWindows = platform === "win32";
  const isMac = platform === "darwin";
  const isLinux = platform === "linux";

  // プラットフォーム別の実行ファイルパス
  const possibleExePaths = [];

  if (isWindows) {
    // Windows用パス
    possibleExePaths.push(
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
    // macOS用パス
    possibleExePaths.push(
      // 推奨: プラットフォーム共通配置 (build/bin/whisper-cli)
      path.join(__dirname, "whisper.cpp", "build", "bin", "whisper-cli"),
      path.join(
        __dirname,
        "whisper.cpp",
        "build",
        "bin",
        "macos",
        "whisper-cli"
      ),
      path.join(__dirname, "whisper.cpp", "main"), // Makefileでビルドした場合
      path.join(__dirname, "whisper.cpp", "whisper-cli")
    );
  } else if (isLinux) {
    // Linux用パス
    possibleExePaths.push(
      // 推奨: プラットフォーム共通配置 (build/bin/whisper-cli)
      path.join(__dirname, "whisper.cpp", "build", "bin", "whisper-cli"),
      path.join(
        __dirname,
        "whisper.cpp",
        "build",
        "bin",
        "linux",
        "whisper-cli"
      ),
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

  const modelPath = path.join(
    __dirname,
    "whisper.cpp",
    "models",
    `ggml-${selectedModel}.bin`
  );

  // モデル・音声ファイルの存在確認
  if (!fs.existsSync(modelPath)) {
    systemLog(`Model file not found: ${modelPath}`, "ERROR");
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
    // 言語は自動検出（-l オプションなし）
    const args = ["-m", modelPath, "-f", outputFile, "--output-txt"];

    systemLog("Language: auto-detect", "INFO");
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
  console.log("🟢 Voice to Text + Copilot Chat: Activation started");

  try {
    // --- アウトプットチャンネル作成 ---
    outputChannel = vscode.window.createOutputChannel(
      "Voice to Text + Copilot Chat"
    );
    context.subscriptions.push(outputChannel);

    // --- 設定を取得 ---
    const config = vscode.workspace.getConfiguration("whisperVoiceInput");
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

    // --- ステータスバーアイテム作成（表示専用） ---
    statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );

    // クリック機能は無効化（表示専用）
    statusBarItem.command = undefined;

    statusBarItem.text = msg("statusIdle");
    statusBarItem.tooltip = msg("statusIdle") + " - " + msg("commandOnlyMode");
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // 初期状態でステータスバーを更新
    updateStatusBar("idle");

    // --- 設定変更イベントリスナー ---
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration("whisperVoiceInput.mode") ||
          e.affectsConfiguration("whisperVoiceInput.localModel")
        ) {
          systemLog("Configuration changed, updating status bar", "INFO");
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
  if (statusBarItem) {
    statusBarItem.dispose();
  }
  if (outputChannel) {
    outputChannel.dispose();
  }
  console.log("🧹 Voice to Text + Copilot Chat: deactivated");
}

module.exports = { activate, deactivate };

// ================== 追加: コマンド登録関連ユーティリティ ==================

/**
 * トグル処理（録音開始/停止と結果貼り付け）
 * 以前のインライン実装を関数化
 * @param {vscode.ExtensionContext} context
 */
async function handleToggleCommand(context) {
  console.log("🎙️ Command executed: whisperVoiceInput.toggle");

  if (isProcessing) {
    vscode.window.showWarningMessage(msg("processingWait"));
    return;
  }

  const currentConfig = vscode.workspace.getConfiguration("whisperVoiceInput");
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
        () => {
          isRecording = false;
          stopRecordingTimer(); // タイマー停止
          updateStatusBar("idle");
        },
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
    // 録音停止～処理
    try {
      isProcessing = true;
      isRecording = false;
      stopRecordingTimer(); // タイマー停止
      updateStatusBar("processing");
      systemLog(msg("sendingToWhisper"), "INFO");

      const mode = currentConfig.get("mode") || "api";
      systemLog(`Current mode: ${mode}`, "INFO");
      let text;
      if (mode === "local") {
        const localModel = currentConfig.get("localModel", "base");
        systemLog(`Using local whisper.cpp (model: ${localModel})`, "INFO");
        const outputFile = await stopRecordingLocal();
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
        text = await stopRecording(apiKey, msg);
      }

      if (text && text.trim()) {
        addToHistory(context, text, currentConfig.get("mode", "api"));

        // クリップボード保護付きペースト
        const originalClipboard = await vscode.env.clipboard.readText();
        systemLog("Original clipboard saved", "INFO");

        await vscode.env.clipboard.writeText(text);
        await vscode.commands.executeCommand(
          "editor.action.clipboardPasteAction"
        );

        setTimeout(async () => {
          await vscode.env.clipboard.writeText(originalClipboard);
          systemLog("Clipboard restored", "INFO");
        }, 100);

        updateStatusBar("success");
        setTimeout(() => {
          updateStatusBar("idle");
          systemLog("Status bar reset to idle", "INFO");
        }, 3000);

        systemLog(msg("pasteDone"), "SUCCESS");
      } else {
        systemLog(msg("noAudioOrFail"), "WARNING");
        vscode.window.showWarningMessage(msg("noAudioOrFail"));
      }
    } catch (error) {
      systemLog(`Failed to process recording: ${error.message}`, "ERROR");
      vscode.window.showErrorMessage(
        msg("processingFailed", { error: error.message })
      );
    } finally {
      isProcessing = false;
      updateStatusBar("idle");
    }
  }
}

/**
 * コマンド登録を一括実行
 * @param {vscode.ExtensionContext} context
 */
function registerCommands(context) {
  const disposables = [];

  disposables.push(
    vscode.commands.registerCommand("whisperVoiceInput.toggle", () =>
      handleToggleCommand(context)
    )
  );

  disposables.push(
    vscode.commands.registerCommand("whisperVoiceInput.setApiKey", async () => {
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
    vscode.commands.registerCommand(
      "whisperVoiceInput.setupWizard",
      async () => {
        systemLog("Running setup wizard manually", "INFO");
        const config = vscode.workspace.getConfiguration("whisperVoiceInput");
        await runInitialSetup(context, config, msg);
      }
    )
  );

  disposables.push(
    vscode.commands.registerCommand(
      "whisperVoiceInput.showHistory",
      async () => {
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
      }
    )
  );

  disposables.forEach((d) => context.subscriptions.push(d));
}
