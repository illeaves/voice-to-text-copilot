const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const vscode = require("vscode");

let mic;
let micInstance, micInputStream, outputFileStream, recordingTimeout;
const outputFile = path.join(__dirname, "voice.wav");

// micモジュールの遅延ロード
function getMic() {
  if (!mic) {
    try {
      mic = require("mic");
    } catch (error) {
      throw new Error("soxNotInstalled"); // メッセージキーを返す
    }
  }
  return mic;
}

// 🎙 録音開始
function startRecording(context, maxRecordSec, msg, onTimeout) {
  try {
    const MAX_RECORD_TIME = maxRecordSec * 1000;
    const micModule = getMic();

    // 既存の録音をクリーンアップ
    if (micInstance) {
      stopRecordingInternal();
    }

    micInstance = micModule({ rate: "16000", channels: "1", debug: false });
    micInputStream = micInstance.getAudioStream();
    outputFileStream = fs.createWriteStream(outputFile);

    // エラーハンドリング
    micInputStream.on("error", (err) => {
      console.error("⚠️ Microphone error:", err);
      vscode.window.showErrorMessage(
        msg("microphoneError", { error: err.message })
      );
    });

    micInputStream.pipe(outputFileStream);
    micInstance.start();

    console.log(msg("recordingStart", { seconds: maxRecordSec }));

    // ⏱ 上限時間を超えたら自動停止
    recordingTimeout = setTimeout(() => {
      if (micInstance) {
        stopRecordingInternal();
        vscode.window.showWarningMessage(
          msg("recordingStopAuto", { seconds: maxRecordSec })
        );
        // タイムアウト時のコールバック実行
        if (onTimeout) onTimeout();
      }
    }, MAX_RECORD_TIME);
  } catch (error) {
    console.error("⚠️ Recording start error:", error);
    vscode.window.showErrorMessage(error.message);
    throw error;
  }
}

// 🔇 内部録音停止関数
function stopRecordingInternal() {
  if (recordingTimeout) {
    clearTimeout(recordingTimeout);
    recordingTimeout = null;
  }

  if (micInstance) {
    try {
      micInstance.stop();
    } catch (error) {
      console.error("⚠️ Error stopping microphone:", error);
    }
  }

  if (outputFileStream) {
    try {
      outputFileStream.end();
    } catch (error) {
      console.error("⚠️ Error closing output stream:", error);
    }
  }

  micInstance = null;
  micInputStream = null;
  outputFileStream = null;
}

// 🎧 録音停止とWhisper送信
async function stopRecording(apiKey, msg) {
  if (!micInstance) {
    console.warn("⚠️ No active recording to stop");
    return null;
  }

  try {
    // 録音を停止
    stopRecordingInternal();

    // ファイルの存在確認
    if (!fs.existsSync(outputFile)) {
      console.error("⚠️ Voice file not found");
      return null;
    }

    // ファイルサイズをチェック
    const stats = fs.statSync(outputFile);
    if (stats.size === 0) {
      console.warn("⚠️ Empty voice file");
      fs.unlink(outputFile, () => {});
      return null;
    }

    const openai = new OpenAI({ apiKey });

    const res = await openai.audio.transcriptions.create({
      file: fs.createReadStream(outputFile),
      model: "whisper-1",
    });

    // ファイルを削除
    fs.unlink(outputFile, (err) => {
      if (err) console.error("⚠️ Failed to delete voice file:", err);
    });

    return res.text;
  } catch (e) {
    console.error("❌ Whisper API error:", e);

    // ファイルを削除（エラー時も）
    if (fs.existsSync(outputFile)) {
      fs.unlink(outputFile, () => {});
    }

    // より詳細なエラーメッセージ
    if (e.code === "ENOENT") {
      vscode.window.showErrorMessage("録音ファイルが見つかりません。");
    } else if (e.status === 401) {
      vscode.window.showErrorMessage(
        "APIキーが無効です。正しいOpenAI APIキーを設定してください。"
      );
    } else if (e.status === 429) {
      vscode.window.showErrorMessage(
        "APIレート制限に達しました。しばらく待ってからお試しください。"
      );
    } else {
      vscode.window.showErrorMessage(msg("whisperApiError"));
    }

    return null;
  }
}

// 🧹 録音状態をチェックする関数
function isCurrentlyRecording() {
  return micInstance !== null;
}

module.exports = { startRecording, stopRecording, isCurrentlyRecording };
