const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const vscode = require("vscode");

let micInstance, recordingTimeout;
let currentRecordingFile; // 現在録音中のファイルパス
const outputFile = path.join(__dirname, "voice.wav");
const soxOutputFile = path.join(__dirname, "voice_sox.wav");
const rawOutputFile = path.join(__dirname, "voice_raw.pcm");

/**
 * 📝 WAVヘッダーを作成（44バイト）
 */
function createWavHeader(
  dataLength,
  sampleRate = 16000,
  channels = 1,
  bitsPerSample = 16
) {
  const header = Buffer.alloc(44);

  // RIFF header
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4); // ファイルサイズ - 8
  header.write("WAVE", 8);

  // fmt chunk
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // audio format (1 = PCM)
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE((sampleRate * channels * bitsPerSample) / 8, 28); // byte rate
  header.writeUInt16LE((channels * bitsPerSample) / 8, 32); // block align
  header.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

/**
 * 🔄 Raw PCMをWAVに変換
 */
function convertPcmToWav(pcmFile, wavFile) {
  const pcmData = fs.readFileSync(pcmFile);
  console.log(`📊 Raw PCM size: ${pcmData.length} bytes`);

  const wavHeader = createWavHeader(pcmData.length);
  const wavData = Buffer.concat([wavHeader, pcmData]);

  fs.writeFileSync(wavFile, wavData);
  console.log(`✅ WAV file created: ${wavFile} (${wavData.length} bytes)`);

  // PCMファイルを削除
  fs.unlinkSync(pcmFile);
}

// 🎙 録音開始
function startRecording(context, maxRecordSec, msg, onTimeout, mode = "api") {
  try {
    const MAX_RECORD_TIME = maxRecordSec * 1000;

    // 既存の録音をクリーンアップ
    if (micInstance) {
      stopRecordingInternal();
    }

    // モードに応じて保存先を決定
    const recordingFile = mode === "local" ? soxOutputFile : outputFile;
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
    micInstance = spawn(soxPath, soxArgs);

    let soxErrorOutput = ""; // SOXのエラーメッセージを蓄積

    micInstance.stdout.on("data", (data) => {
      console.log(`SOX stdout: ${data}`);
    });

    micInstance.stderr.on("data", (data) => {
      const message = data.toString();
      console.log(`SOX info: ${message}`);

      // エラーメッセージを蓄積
      if (message.includes("FAIL") || message.includes("error")) {
        soxErrorOutput += message;
      }
    });

    micInstance.on("error", (err) => {
      console.error("⚠️ SOX process error:", err);
      vscode.window.showErrorMessage(
        msg("microphoneError", { error: err.message })
      );
    });

    micInstance.on("exit", (code) => {
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
    recordingTimeout = setTimeout(async () => {
      if (micInstance) {
        console.log("⏰ Recording timeout reached, stopping...");
        await stopRecordingInternal();
        vscode.window.showWarningMessage(
          msg("recordingStopAuto", { seconds: maxRecordSec })
        );
        
        // 少し待ってからコールバック実行（ファイル作成完了を待つ）
        setTimeout(() => {
          if (onTimeout) {
            console.log("⏰ Executing timeout callback");
            onTimeout();
          }
        }, 500); // 500ms待機
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

// 🔇 内部録音停止関数
async function stopRecordingInternal() {
  if (recordingTimeout) {
    clearTimeout(recordingTimeout);
    recordingTimeout = null;
  }

  if (micInstance) {
    try {
      // 全プラットフォームでSOXプロセスを停止（SIGINTで正常終了）
      micInstance.kill("SIGINT");
      // プロセスが終了するのを待つ
      await new Promise((resolve) => {
        micInstance.on("exit", () => {
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

  micInstance = null;
}

// 🎧 録音停止とWhisper送信（APIモード用）
async function stopRecording(apiKey, msg) {
  if (!micInstance) {
    console.warn("⚠️ No active recording to stop");
    return null;
  }

  try {
    // 録音を停止(ストリームのクローズを待つ)
    await stopRecordingInternal();

    // ファイルが作成されるまでポーリング(最大3秒、100ms間隔)
    let fileFound = false;
    for (let i = 0; i < 30; i++) {
      if (fs.existsSync(outputFile)) {
        fileFound = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // ファイルの存在確認
    if (!fileFound) {
      console.error("⚠️ Voice file not found");
      return null;
    }

    // ファイルサイズをログ出力
    const fileStats = fs.statSync(outputFile);
    console.log(`📊 Voice file size: ${fileStats.size} bytes`);

    if (fileStats.size === 0) {
      console.error("⚠️ Voice file is empty (0 bytes)");
      return null;
    }

    // 全プラットフォームで既に16kHz WAVで録音されているので変換不要
    console.log(`📝 Sending WAV to OpenAI API (${fileStats.size} bytes)`);

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

    return res.text;
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

// 🎧 録音停止(ローカルモード用:WAVファイルのパスを返す)
async function stopRecordingLocal() {
  if (!micInstance) {
    console.warn("⚠️ No active recording to stop");
    return null;
  }

  try {
    // 録音を停止(ストリームのクローズを待つ)
    await stopRecordingInternal();

    // ファイルが作成されるまでポーリング(最大3秒、100ms間隔)
    let fileFound = false;
    for (let i = 0; i < 30; i++) {
      if (fs.existsSync(soxOutputFile)) {
        fileFound = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (!fileFound) {
      console.error("⚠️ SOX WAV file not found:", soxOutputFile);
      return null;
    }

    // SOXファイルサイズをチェック
    const soxFileStats = fs.statSync(soxOutputFile);
    console.log(`📊 SOX file size: ${soxFileStats.size} bytes`);

    if (soxFileStats.size === 0) {
      console.warn("⚠️ Empty SOX WAV file (0 bytes)");
      fs.unlinkSync(soxOutputFile); // 空ファイルを削除
      return null;
    }

    console.log(
      `📝 Converting SOX WAV to standard WAV (${soxFileStats.size} bytes)`
    );

    // SOXコマンドでraw PCMに変換 + 音量を増幅
    const { execSync } = require("child_process");
    try {
      // 古いPCMファイルを削除
      if (fs.existsSync(rawOutputFile)) {
        fs.unlinkSync(rawOutputFile);
      }

      // gainオプションで音量増幅（+8dB）
      execSync(
        `sox "${soxOutputFile}" -t raw -r 16000 -c 1 -b 16 -e signed-integer "${rawOutputFile}" gain 8`
      );
      console.log(`✅ Converted to raw PCM with gain boost: ${rawOutputFile}`);
    } catch (soxError) {
      console.error(`❌ SOX conversion failed: ${soxError.message}`);

      // 失敗時はPCMファイルを削除
      if (fs.existsSync(rawOutputFile)) {
        fs.unlinkSync(rawOutputFile);
      }

      throw new Error("SOX conversion failed");
    }

    // PCMファイルサイズをチェック
    const pcmStats = fs.statSync(rawOutputFile);
    console.log(`📊 Raw PCM size: ${pcmStats.size} bytes`);

    if (pcmStats.size === 0) {
      console.warn("⚠️ Empty PCM file");
      fs.unlinkSync(rawOutputFile);
      fs.unlinkSync(soxOutputFile);
      return null;
    }

    // 古いWAVファイルを削除
    if (fs.existsSync(outputFile)) {
      fs.unlinkSync(outputFile);
      console.log(`🗑️ Deleted old WAV file: ${outputFile}`);
    }

    // PCMをWAVに変換（標準的なWAVヘッダーを追加）
    convertPcmToWav(rawOutputFile, outputFile);

    // WAVファイルの検証（最初の50バイトを確認）
    const buffer = fs.readFileSync(outputFile);
    console.log(
      `✅ WAV first 50 bytes (hex): ${buffer.slice(0, 50).toString("hex")}`
    );

    // SOXファイルを削除（もう不要）
    if (fs.existsSync(soxOutputFile)) {
      fs.unlinkSync(soxOutputFile);
      console.log(`🗑️ Deleted SOX file: ${soxOutputFile}`);
    }

    console.log(`✅ Converted to WAV: ${outputFile}`);

    return outputFile;
  } catch (e) {
    console.error("❌ Error stopping recording:", e);

    // エラー時もクリーンアップ
    if (fs.existsSync(soxOutputFile)) {
      fs.unlinkSync(soxOutputFile);
    }
    if (fs.existsSync(rawOutputFile)) {
      fs.unlinkSync(rawOutputFile);
    }

    return null;
  }
}

// 🧹 録音状態をチェックする関数
function isCurrentlyRecording() {
  return micInstance !== null;
}

module.exports = {
  startRecording,
  stopRecording,
  stopRecordingLocal,
  isCurrentlyRecording,
};
