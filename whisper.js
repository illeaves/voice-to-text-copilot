const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const vscode = require("vscode");

let soxProcess, recordingTimeout;
let currentRecordingFile; // 現在録音中のファイルパス
const outputFile = path.join(__dirname, "voice.wav");

// 🎙 録音開始
function startRecording(
  context,
  maxRecordSec,
  msg,
  stopRecordingAndProcessVoice,
  mode = "api"
) {
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

    console.log(`📝 Recording mode: ${mode}, file: ${recordingFile}`);

    // 古いファイルを削除
    if (fs.existsSync(recordingFile)) {
      fs.unlinkSync(recordingFile);
      console.log(`🗑️ Deleted old recording file: ${recordingFile}`);
    }

    // 全プラットフォームでSOXを直接使用
    const { spawn } = require("child_process");
    const platform = process.platform;

    // プラットフォームごとのSOXパス
    let soxPath;
    if (platform === "darwin") {
      soxPath = "/opt/homebrew/bin/sox"; // Mac (Homebrew)
    } else {
      soxPath = "sox"; // Windows/Linux (PATH内)
    }

    // SOXで直接16kHz WAVを録音
    // Windows: waveaudioドライバを明示的に指定
    // Mac/Linux: デフォルトデバイス(-d)を使用
    let soxArgs;
    if (platform === "win32") {
      soxArgs = [
        "-t",
        "waveaudio",
        "default", // Windowsのデフォルト録音デバイス
        "-r",
        "16000", // サンプルレート: 16kHz
        "-c",
        "1", // チャンネル: mono
        "-b",
        "16", // ビット深度: 16-bit
        "-e",
        "signed-integer", // エンコーディング: 符号付き整数
        recordingFile, // 出力ファイル
      ];
    } else {
      soxArgs = [
        "-d", // Mac/Linux: デフォルト入力デバイス
        "-r",
        "16000", // サンプルレート: 16kHz
        "-c",
        "1", // チャンネル: mono
        "-b",
        "16", // ビット深度: 16-bit
        recordingFile, // 出力ファイル
      ];
    }

    console.log(
      `🎤 Starting SOX recording (${platform}): ${soxPath} ${soxArgs.join(" ")}`
    );
    soxProcess = spawn(soxPath, soxArgs);

    let soxErrorOutput = ""; // SOXのエラーメッセージを蓄積

    soxProcess.stdout.on("data", (data) => {
      console.log(`SOX stdout: ${data}`);
    });

    soxProcess.stderr.on("data", (data) => {
      const message = data.toString();
      console.log(`SOX info: ${message}`);

      // エラーメッセージを蓄積
      if (message.includes("FAIL") || message.includes("error")) {
        soxErrorOutput += message;
      }
    });

    soxProcess.on("error", (err) => {
      console.error("⚠️ SOX process error:", err);
      vscode.window.showErrorMessage(
        msg("microphoneError", { error: err.message })
      );
    });

    soxProcess.on("exit", (code) => {
      console.log(`SOX process exited with code ${code}`);

      // 異常終了時にエラーメッセージを表示
      if (code !== 0 && code !== null && soxErrorOutput) {
        console.error(`⚠️ SOX failed: ${soxErrorOutput}`);
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

        // 手動停止時と全く同じ関数を直接呼び出し
        if (stopRecordingAndProcessVoice) {
          console.log("⏰ Executing timeout processing - same as manual stop");
          stopRecordingAndProcessVoice(context);
        }
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

// 🎧 録音停止関数（全モード対応）
async function stopRecording(mode = "api", apiKey = null, msg = null) {
  if (!soxProcess) {
    console.warn("⚠️ No active recording to stop");
    return null;
  }

  try {
    console.log(`🛑 Stopping recording (mode: ${mode})`);

    // 共通処理：録音を停止
    if (recordingTimeout) {
      clearTimeout(recordingTimeout);
      recordingTimeout = null;
    }

    if (soxProcess) {
      try {
        // 全プラットフォームでSOXプロセスを停止（SIGINTで正常終了）
        soxProcess.kill("SIGINT");
        // プロセスが終了するのを待つ
        await new Promise((resolve) => {
          soxProcess.on("exit", () => {
            console.log("✅ SOX process terminated successfully");
            resolve();
          });
          // タイムアウト保護（2秒）
          setTimeout(resolve, 2000);
        });
      } catch (error) {
        console.error("⚠️ Error stopping SOX process:", error);
      }
    }

    soxProcess = null;

    // 共通処理：ファイルが作成されるまでポーリング(最大3秒、100ms間隔)
    let fileFound = false;
    for (let i = 0; i < 30; i++) {
      if (fs.existsSync(outputFile)) {
        fileFound = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // 共通処理：ファイルの存在確認
    if (!fileFound) {
      console.error("⚠️ Voice file not found:", outputFile);
      return null;
    }

    // 共通処理：ファイルサイズをチェック
    const fileStats = fs.statSync(outputFile);
    console.log(`📊 Voice file size: ${fileStats.size} bytes`);

    if (fileStats.size === 0) {
      console.warn("⚠️ Empty WAV file (0 bytes)");
      fs.unlinkSync(outputFile); // 空ファイルを削除
      return null;
    }

    // モード別処理
    if (mode === "api") {
      return await handleApiMode(apiKey, msg, fileStats);
    } else {
      return await handleLocalMode(fileStats);
    }
  } catch (e) {
    console.error("❌ Error in stopRecording:", e);

    // エラー時もクリーンアップ
    if (fs.existsSync(outputFile)) {
      fs.unlinkSync(outputFile);
    }

    return null;
  }
}

// APIモード専用処理
async function handleApiMode(apiKey, msg, fileStats) {
  if (!apiKey || !msg) {
    console.error("⚠️ API key or msg is missing for API mode");
    return null;
  }

  console.log(`📝 Sending WAV to OpenAI API (${fileStats.size} bytes)`);

  try {
    const openai = new OpenAI({ apiKey });

    const res = await openai.audio.transcriptions.create({
      file: fs.createReadStream(outputFile),
      model: "whisper-1",
    });

    // 録音ファイルを削除
    fs.unlink(outputFile, (err) => {
      if (err) console.error("⚠️ Failed to delete voice file:", err);
      else console.log(`🗑️ Deleted voice file: ${outputFile}`);
    });

    return res.text; // テキストを返す
  } catch (e) {
    console.error("❌ Whisper API error:", e);

    // エラー時もファイルを削除
    if (fs.existsSync(outputFile)) {
      fs.unlink(outputFile, (err) => {
        if (err) console.error("⚠️ Failed to delete voice file:", err);
        else console.log(`🗑️ Deleted voice file after error: ${outputFile}`);
      });
    }

    // より詳細なエラーメッセージ
    if (e.code === "ENOENT") {
      vscode.window.showErrorMessage(msg("voiceFileNotFound"));
    } else if (e.status === 401) {
      vscode.window.showErrorMessage(msg("invalidApiKey"));
    } else if (e.status === 429) {
      vscode.window.showErrorMessage(msg("apiRateLimit"));
    } else {
      vscode.window.showErrorMessage(msg("whisperApiError"));
    }

    return null;
  }
}

// ローカルモード専用処理
async function handleLocalMode(fileStats) {
  console.log(`🔧 Fixing WAV header for whisper.cpp compatibility...`);

  const { spawn } = require("child_process");
  const platform = process.platform;

  // 一時ファイル名
  const tempOutputFile = outputFile.replace(".wav", "_fixed.wav");

  try {
    // SOXでWAVファイルを読み込んで正しいヘッダーで書き直す
    const soxPath = platform === "darwin" ? "/opt/homebrew/bin/sox" : "sox";
    const fixArgs = [outputFile, tempOutputFile];

    console.log(`🔧 Executing: ${soxPath} ${fixArgs.join(" ")}`);

    await new Promise((resolve, reject) => {
      const fixProcess = spawn(soxPath, fixArgs);

      fixProcess.on("close", (code) => {
        if (code === 0) {
          console.log("✅ WAV header fixed successfully");
          // 元のファイルを削除して、修正版をリネーム
          fs.unlinkSync(outputFile);
          fs.renameSync(tempOutputFile, outputFile);
          resolve();
        } else {
          console.error(`⚠️ SOX fix failed with code ${code}`);
          reject(new Error(`SOX fix failed with code ${code}`));
        }
      });

      fixProcess.on("error", (err) => {
        console.error("⚠️ SOX fix error:", err);
        reject(err);
      });
    });

    console.log(`✅ Using fixed WAV file: ${outputFile}`);
    return outputFile; // ファイルパスを返す
  } catch (error) {
    console.error("⚠️ WAV header fix failed, using original file:", error);
    // エラー時は元のファイルをそのまま使う
    if (fs.existsSync(tempOutputFile)) {
      fs.unlinkSync(tempOutputFile);
    }
    return outputFile;
  }
}

// 🧹 録音状態をチェックする関数
function isCurrentlyRecording() {
  return soxProcess !== null;
}

module.exports = {
  startRecording,
  stopRecording,
  isCurrentlyRecording,
};
