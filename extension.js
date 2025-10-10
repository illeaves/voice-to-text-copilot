/**
 * Whisper Voice Input Extension for VS Code
 * Author: aleaf
 * Version: 1.0.0
 */

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

let isRecording = false;
let isProcessing = false;
let messages = {};
let statusBarItem;
let outputChannel;

// 📚 Whisper履歴管理
const WHISPER_HISTORY_KEY = "whisperHistory";
const MAX_HISTORY_SIZE = 10;

/**
 * 🌐 言語ファイルをロード
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
 * 🗣️ メッセージ取得（{{変数}}置換付き）
 */
function msg(key, vars = {}) {
  let text = messages[key] || key;
  for (const [k, v] of Object.entries(vars)) {
    text = text.replace(`{{${k}}}`, v);
  }
  return text;
}

/**
 *  システムログ出力（アウトプットパネル + コンソール）
 */
function systemLog(message, level = "INFO") {
  const timestamp = new Date().toLocaleTimeString();
  const logMessage = `[${timestamp}] ${level}: ${message}`;

  // コンソールログ
  console.log(logMessage);

  // アウトプットパネル
  if (outputChannel) {
    outputChannel.appendLine(logMessage);
  }
}

/**
 * 📝 ステータスバー更新（状態に応じて）
 */
function updateStatusBar(state = "idle") {
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
      statusBarItem.text = msg("statusRecording");
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
 * � Whisper履歴に追加
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
 * �📥 モデルダウンロード（リダイレクト対応）
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
      path.join(
        __dirname,
        "whisper.cpp",
        "build",
        "bin",
        "whisper-cli"
      ),
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
      path.join(
        __dirname,
        "whisper.cpp",
        "build",
        "bin",
        "whisper-cli"
      ),
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
    systemLog(
      `Whisper executable not found. Tried: ${possibleExePaths.join(", ")}`,
      "ERROR"
    );
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
    throw new Error("modelNotFound");
  }
  if (!fs.existsSync(outputFile)) {
    throw new Error("voiceFileNotFound");
  }

  // 音声ファイルの詳細をログ出力
  const fileStats = fs.statSync(outputFile);
  systemLog(`Voice file size: ${fileStats.size} bytes`, "INFO");

  if (fileStats.size === 0) {
    systemLog("Voice file is empty!", "ERROR");
    throw new Error("voiceFileNotFound");
  }

  try {
    // VS Codeの言語設定を取得
    const config = vscode.workspace.getConfiguration("whisperVoiceInput");
    const userLang =
      config.get("language") || vscode.env.language.split("-")[0];

    // whisper.cpp用の言語コードマッピング
    const langMap = {
      ja: "ja",
      en: "en",
      zh: "zh",
      ko: "ko",
      fr: "fr",
      de: "de",
      es: "es",
      it: "it",
      ru: "ru",
    };

    const whisperLang = langMap[userLang] || "ja"; // デフォルトは日本語

    const args = [
      "-m",
      modelPath,
      "-f",
      outputFile,
      "-l",
      whisperLang,
      "--output-txt",
    ];

    systemLog(
      `Language: ${whisperLang} (from VS Code setting: ${userLang})`,
      "INFO"
    );

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
      // 🎧 デバッグ用：.txtファイルを残す
      // fs.unlinkSync(txtOutputFile);
      systemLog(`TXT file saved for debugging: ${txtOutputFile}`, "INFO");
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

    // 🎧 デバッグ用：WAVファイルを残す
    // fs.unlink(outputFile, (err) => {
    //   if (err) console.error("⚠️ Failed to delete voice file:", err);
    // });
    systemLog(`WAV file saved for debugging: ${outputFile}`, "INFO");

    return result;
  } catch (error) {
    console.error("❌ Local Whisper error:", error);
    systemLog(`Whisper execution failed: ${error.message}`, "ERROR");

    // エラー詳細をログに記録
    if (error.stderr) {
      systemLog(`Stderr: ${error.stderr}`, "ERROR");
    }
    if (error.stdout) {
      systemLog(`Stdout: ${error.stdout}`, "ERROR");
    }

    // 🎧 デバッグ用：エラー時もファイルを残す
    // if (fs.existsSync(outputFile)) {
    //   fs.unlink(outputFile, () => {});
    // }

    throw new Error("localWhisperError");
  }
}

/**
 * 🎬 拡張アクティベーション
 */
async function activate(context) {
  console.log("🟢 Whisper Voice Input: Activation started");

  try {
    // --- アウトプットチャンネル作成 ---
    outputChannel = vscode.window.createOutputChannel("Whisper Voice Input");
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

    // --- トグルコマンド登録 ---
    const toggleCmd = vscode.commands.registerCommand(
      "whisperVoiceInput.toggle",
      async () => {
        console.log("🎙️ Command executed: whisperVoiceInput.toggle");

        // 処理中の場合は無視
        if (isProcessing) {
          vscode.window.showWarningMessage(msg("processingWait"));
          return;
        }

        // 最新の設定を取得（設定変更を反映）
        const currentConfig =
          vscode.workspace.getConfiguration("whisperVoiceInput");
        const maxSec = currentConfig.get("maxRecordSeconds") || 180;

        if (!isRecording || !isCurrentlyRecording()) {
          // === 録音開始 ===
          try {
            const mode = currentConfig.get("mode") || "api";
            isRecording = true;
            updateStatusBar("recording");
            systemLog(msg("recordingStart", { seconds: maxSec }), "INFO");
            systemLog(`Recording mode: ${mode}`, "INFO");
            await startRecording(
              context,
              maxSec,
              msg,
              () => {
                // タイムアウト時の処理
                isRecording = false;
                updateStatusBar("idle");
              },
              mode
            ); // モードを渡す
          } catch (error) {
            isRecording = false;
            updateStatusBar("idle");
            systemLog(`Failed to start recording: ${error.message}`, "ERROR");

            // SOXエラーの場合は専用メッセージを表示
            const errorMessage =
              error.message === "soxNotInstalled"
                ? msg("soxNotInstalled")
                : msg("recordingStartFailed", { error: error.message });

            vscode.window.showErrorMessage(errorMessage);
          }
        } else {
          // === 録音停止 ===
          try {
            isProcessing = true;
            isRecording = false;
            updateStatusBar("processing");
            systemLog(msg("sendingToWhisper"), "INFO");

            // 最新の設定を取得（設定変更を反映）
            const currentConfig =
              vscode.workspace.getConfiguration("whisperVoiceInput");
            const mode = currentConfig.get("mode") || "api";
            systemLog(`Current mode: ${mode}`, "INFO");
            let text;

            if (mode === "local") {
              // ローカルwhisper.cpp実行（言語自動検出）
              const localModel = currentConfig.get("localModel", "base");
              systemLog(
                `Using local whisper.cpp (model: ${localModel})`,
                "INFO"
              );
              // 録音を停止してWAVファイルを取得
              const outputFile = await stopRecordingLocal();
              if (!outputFile) {
                throw new Error("Failed to convert audio file");
              }
              text = await executeLocalWhisper(outputFile, msg);
            } else {
              // OpenAI API経由
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
              // 📚 履歴に保存
              addToHistory(context, text, currentConfig.get("mode", "api"));

              // 📋 元のクリップボード内容を保存
              const originalClipboard = await vscode.env.clipboard.readText();

              // ✍️ Whisperテキストをクリップボードに書き込み
              await vscode.env.clipboard.writeText(text);

              // 📌 貼り付けコマンド実行（フォーカス位置に貼り付け）
              await vscode.commands.executeCommand(
                "editor.action.clipboardPasteAction"
              );

              // 🔄 100ms後に元のクリップボード内容を復元
              setTimeout(async () => {
                await vscode.env.clipboard.writeText(originalClipboard);
                systemLog("Clipboard restored", "INFO");
              }, 100);

              updateStatusBar("success");
              setTimeout(() => {
                updateStatusBar("idle");
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
    );

    // --- APIキー設定コマンド登録 ---
    const setApiKeyCmd = vscode.commands.registerCommand(
      "whisperVoiceInput.setApiKey",
      async () => {
        const key = await vscode.window.showInputBox({
          prompt: msg("promptApiKey"),
          ignoreFocusOut: true,
          password: true,
        });
        if (key) {
          await context.secrets.store("openaiApiKey", key);
          systemLog(msg("apiKeySaved"), "SUCCESS");
        }
      }
    );

    // --- セットアップウィザードコマンド登録 ---
    const setupWizardCmd = vscode.commands.registerCommand(
      "whisperVoiceInput.setupWizard",
      async () => {
        systemLog("Running setup wizard manually", "INFO");
        await runInitialSetup(context, config, msg);
      }
    );

    // --- 履歴表示コマンド登録 ---
    const historyCmd = vscode.commands.registerCommand(
      "whisperVoiceInput.showHistory",
      async () => {
        const history = getHistory(context);

        if (history.length === 0) {
          vscode.window.showInformationMessage(
            msg("historyEmpty") || "履歴がありません"
          );
          return;
        }

        // QuickPickで履歴を表示
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
    );

    context.subscriptions.push(toggleCmd);
    context.subscriptions.push(setApiKeyCmd);
    context.subscriptions.push(setupWizardCmd);
    context.subscriptions.push(historyCmd);
    console.log("✅ Commands registered successfully");
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
  if (statusBarItem) {
    statusBarItem.dispose();
  }
  if (outputChannel) {
    outputChannel.dispose();
  }
  console.log("🧹 Whisper Voice Input: deactivated");
}

module.exports = { activate, deactivate };
