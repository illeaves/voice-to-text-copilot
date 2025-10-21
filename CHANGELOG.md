# Changelog

All notable changes to the "Voice to Text (also for Copilot Chat)" extension will be documented in this file.

## [1.6.10] - 2025-10-22

### 🐛 Bug Fixes

- **Escキーバインドの競合を修正**
  - IntelliSenseやサジェスト表示中にEscキーが拡張機能に奪われる問題を修正
  - Fixed Esc key conflict with IntelliSense and suggestion widgets
  - 条件を厳格化: 録音中かつサジェスト非表示時のみEscキーが有効
  - Added conditions: `voiceToText.isRecording`, `!suggestWidgetVisible`, `!parameterHintsVisible`

- **録音キャンセル時の動作を改善**
  - Escキーで録音をキャンセルした際、音声処理がスキップされるように修正
  - Fixed: Recording cancellation now properly skips voice processing
  - 録音ファイルを完全に削除し、状態を完全にリセット
  - Recording file is now deleted and all states are properly reset on cancellation

### 🔧 Improvements

- **コンテキストキーの実装**
  - `voiceToText.isRecording`コンテキストキーを追加
  - Added `voiceToText.isRecording` context key for better key binding control
  - 録音状態をVS Codeのコンテキストシステムに統合
  - Integrated recording state with VS Code's context system

## [1.6.9] - 2025-10-14

### 📝 Documentation

- **README.md 英語セクション更新**
  - カスタム辞書機能の説明を英語セクションに追加
  - Added Custom Dictionary feature description to English section
  - フィラー除去、VAD、CPU最適化の説明も追加
  - Added descriptions for Filler Removal, VAD, and CPU Thread Optimization features

### 🐛 Bug Fixes

- **README.md 重複削除**
  - GPU確認ログの重複説明を削除
  - Removed duplicate GPU verification log explanation

- **絵文字修正**
  - 文字化けした絵文字 `�` を `🎙` に修正
  - Fixed corrupted emoji characters from `�` to `🎙`

## [1.6.8] - 2025-10-14

### ✨ New Features

- **📖 カスタム辞書機能 (Custom Dictionary)** ⭐ **目玉機能**
  - 認識されたテキストを自動置換するユーザー定義の辞書機能
  - User-defined dictionary for auto-replacing recognized text
  - カタカナ → 英語変換やプロジェクト固有の用語に便利
  - Useful for katakana→English conversion or project-specific terms
  - 例: `{"プッシュ": "push", "プル": "pull", "マイアプリ": "MyApp"}`
  - Example: `{"プッシュ": "push", "プル": "pull", "MyApp": "MyApplication"}`
  - 設定: `voiceToText.customDictionary`
  - Setting: `voiceToText.customDictionary`

### 🔧 Improvements

- **🔊 音量正規化 (Audio Normalization)**

  - VAD 対策として録音後に自動で音量を正規化
  - Automatically normalizes audio volume after recording for better VAD performance
  - 静かな音声でも VAD が誤って削除しないように改善
  - Prevents VAD from mistakenly removing quiet speech
  - 処理時間: 約 50ms (ほぼ影響なし)
  - Processing time: ~50ms (negligible impact)

- **📝 長い音声の認識精度向上 (Better Long-Form Recognition)**
  - `--no-timestamps`オプションを削除してタイムスタンプモードに変更
  - Removed `--no-timestamps` option, now using timestamp mode
  - 50 秒以上の長い音声でも全文を正確に認識
  - Accurately recognizes full text even for 50+ second recordings
  - セグメント処理数が 6〜9 倍に増加 (例: 118→739 runs)
  - Segment processing increased 6-9x (e.g., 118→739 runs)

### 🌍 Localization

- **多言語対応強化 (Enhanced Localization)**
  - カスタム辞書の説明を全 9 言語に追加
  - Added custom dictionary descriptions to all 9 languages
  - 対応言語: 日本語、英語、ドイツ語、スペイン語、フランス語、イタリア語、韓国語、ロシア語、中国語
  - Supported languages: Japanese, English, German, Spanish, French, Italian, Korean, Russian, Chinese

## [1.6.7] - 2025-10-13

### ✨ Major Performance Features

- **🎤 フィラー除去機能 (Non-Speech Token Suppression)** ⭐ **目玉機能**

  - 「あー」「えー」「um」「uh」などのフィラーを自動除去
  - Automatically removes fillers like "um", "uh", "er", etc.
  - 音声認識結果がよりクリーンで読みやすく
  - Cleaner and more readable transcription results
  - デフォルト: 有効 (設定で無効化可能)
  - Default: Enabled (can be disabled in settings)

- **🚀 VAD (Voice Activity Detection) - 無音検出機能** ⭐ **目玉機能**

  - Silero-VAD v5.1.2 で無音部分を自動検出・スキップ
  - Automatically detects and skips silent parts using Silero-VAD v5.1.2
  - 処理速度が最大 50% 向上 (無音部分をスキップ)
  - Up to 50% faster processing (skips silent segments)
  - 例: 63.7 秒の録音 → 31.2 秒の発話のみ処理 (48.2%削減)
  - Example: 63.7s recording → 31.2s speech only (48.2% reduction)
  - デフォルト: 有効 (設定で無効化可能)
  - Default: Enabled (can be disabled in settings)

- **⚡ CPU スレッド数最適化 (Thread Optimization)** ⭐ **目玉機能**

  - CPU コア数を自動検出し、最適なスレッド数で処理
  - Auto-detects CPU cores for optimal thread count
  - マルチコア CPU で処理速度が大幅向上
  - Significantly faster on multi-core CPUs
  - デフォルト: 自動検出 (手動設定も可能)
  - Default: Auto-detect (manual override available)

### 🌍 Multilingual Support

- 新機能の設定項目を 9 言語で対応
- New feature settings available in 9 languages
- 対応言語: 日本語、英語、中国語、韓国語、フランス語、スペイン語、ドイツ語、イタリア語、ロシア語
- Languages: Japanese, English, Chinese, Korean, French, Spanish, German, Italian, Russian

### 🔧 Technical Improvements

- VAD モデルを一元管理 (`models/` ディレクトリ)
- Centralized VAD model management in `models/` directory
- プラットフォーム間でモデルファイルを共有し、ディスク容量を削減
- Shared model files across platforms to reduce disk usage

## [1.6.6] - 2025-10-13

### ✨ Major Features

- **🎯 プロンプトプリセット機能** / **Prompt Preset Feature**

  - 技術用語の認識精度を大幅向上する 12 種類のプリセット
  - 12 preset types to dramatically improve technical term recognition accuracy
  - プリセット: Web 開発, Backend 開発, Mobile 開発, AI/ML, Cloud, DevOps, Git, JavaScript, TypeScript, Python, VS Code
  - Presets: Web, Backend, Mobile, AI/ML, Cloud, DevOps, Git, JavaScript, TypeScript, Python, VS Code
  - カスタムプロンプトとの併用で最大効果を発揮
  - Best results when combined with custom prompts
  - 例: "ジッド" → "Git", "リアクト" → "React" と正確に認識
  - Example: "jit" → "Git", "react" → "React" with accurate recognition

- **📝 カスタムプロンプト機能** / **Custom Prompt Feature**

  - プロジェクト固有の用語を追加可能
  - Add project-specific terminology
  - プリセット + カスタムの組み合わせで最高精度
  - Maximum accuracy with preset + custom combination

- **🌍 設定項目の多言語対応** / **Multilingual Settings UI**
  - 設定画面を 9 言語で表示（日本語、英語、中国語、韓国語、フランス語、スペイン語、ドイツ語、イタリア語、ロシア語）
  - Settings UI in 9 languages (Japanese, English, Chinese, Korean, French, Spanish, German, Italian, Russian)
  - VS Code の言語設定に自動連動
  - Automatically follows VS Code language settings

### 🔧 Refactoring & Improvements

- **コードベースの大幅改善** / **Major Codebase Improvements**

  - whisper.js を extension.js に統合し、ファイル構成を簡素化
  - Consolidated whisper.js into extension.js for simplified file structure
  - 18 個の不要なパラメータを削除
  - Removed 18 redundant parameters
  - 全 34 関数に JSDoc コメントを追加
  - Added JSDoc comments to all 34 functions
  - グローバル変数 extensionContext で状態管理を統一
  - Unified state management with global extensionContext variable

- **設定項目の最適化** / **Settings Optimization**
  - 設定項目の表示順序を論理的に整理（order プロパティ使用）
  - Optimized settings display order with logical arrangement (using order property)
  - 7 個の設定項目を使いやすい順序に配置
  - Arranged 7 settings in user-friendly order

### 📝 Documentation

- **README.md 更新** / **README.md Updates**
  - 「VS Code Speech にはない独自機能」セクションを追加（日英両方）
  - Added "Unique Features Not in VS Code Speech" section (Japanese & English)
  - プロンプトプリセット機能の詳細説明と使用例
  - Detailed explanation and usage examples of prompt preset feature
  - 差別化ポイントを明確に提示
  - Clear presentation of differentiation points

### 🐛 Bug Fixes

- **context is not defined エラー修正** / **Fixed "context is not defined" Error**
  - 12 箇所の `context.` を `extensionContext.` に修正
  - Fixed 12 instances of `context.` to `extensionContext.`

## [1.6.5] - 2025-10-13

### 🔧 Critical Bug Fixes

- **バイナリ実行権限問題の修正** / **Binary Execute Permission Fix**
  - macOS/Linux 環境で whisper-cli の実行権限エラー(EACCES)を修正
  - Fixed whisper-cli execute permission error (EACCES) on macOS/Linux
  - 拡張機能アクティベーション時に自動で実行権限を付与
  - Auto-grant execute permissions during extension activation
  - Windows 環境でのファイル属性問題にも対応
  - Added support for Windows file attribute issues

### ✨ Improvements

- **クロスプラットフォーム対応強化** / **Enhanced Cross-Platform Support**
  - すべてのプラットフォームで権限チェック・修正機能を実装
  - Implemented permission check and fix for all platforms
  - バイナリ実行可能性の事前テスト機能を追加
  - Added binary executability pre-test functionality
  - より詳細なデバッグログ出力
  - Enhanced debug logging for troubleshooting

## [1.6.4] - 2025-10-13

### 🔧 Bug Fixes

- **Minor stability improvements** / **軽微な安定性向上**

## [1.6.3] - 2025-10-12

### ✨ UI/UX Improvements

- **処理中断の改善** / **Processing Cancellation Enhancement**
  - 処理中のステータスバーをクリック可能に
  - Made processing status bar clickable
  - クリックでキャンセル確認ダイアログを表示（はい/いいえ）
  - Shows cancel confirmation dialog (Yes/No) when clicked
  - 誤操作防止のための安全な中断機能
  - Safe cancellation with accidental operation prevention

### 🔧 Bug Fixes

- **キャンセル時のリソース管理改善** / **Resource Management on Cancel**
  - キャンセル時の完全なクリーンアップ処理を追加
  - Added complete cleanup process on cancellation
  - 録音プロセス、タイマー、一時ファイルの適切な解放
  - Proper release of recording process, timers, and temporary files
  - メモリリークの防止
  - Prevents memory leaks

### 🌍 Localization

- **多言語対応強化** / **Enhanced Multilingual Support**
  - 確認ダイアログの 9 言語対応完了（日本語、英語、フランス語、スペイン語、中国語、韓国語、ドイツ語、イタリア語、ロシア語）
  - Completed 9-language support for confirmation dialogs (Japanese, English, French, Spanish, Chinese, Korean, German, Italian, Russian)

## [1.6.3] - 2025-10-12

### 🔧 Bug Fixes

- **Windows ローカルモード修正** / **Windows Local Mode Fix**
  - Windows 環境での WAV ファイルヘッダー問題を解決
  - Fixed WAV file header issues in Windows environment
  - whisper.cpp 互換性のための PCM エンコーディング修正
  - Fixed PCM encoding for whisper.cpp compatibility
  - SOX による録音後ヘッダー自動修正処理を追加
  - Added automatic header correction after SOX recording

### ✨ UI/UX Improvements

- **ステータスバー表示改善** / **Status Bar Display Enhancement**
  - ステータスバーのチカチカ現象を修正
  - Fixed status bar flickering issue
  - 録音中ボタンの視認性向上（🟦 アイコン使用）
  - Improved recording button visibility with blue square icons
  - 強制的な hide/show 処理を削除してスムーズな表示を実現
  - Eliminated forced hide/show cycles for smoother display

### 🎯 New Features

- **キャンセル機能強化** / **Enhanced Cancel Functionality**
  - 録音・処理中のキャンセルコマンドを追加
  - Added cancel command for recording/processing
  - Escape キーによるクイックキャンセル機能
  - Quick cancel with Escape key shortcut
  - コマンドパレットからのキャンセル操作対応
  - Cancel operation support from command palette
  - **処理中ステータスバークリック対応** / **Processing Status Bar Click Support**
    - 処理中のステータスバーをクリックでキャンセル確認ダイアログを表示
    - Click processing status bar to show cancel confirmation dialog
    - 誤操作防止のための確認プロンプト（はい/いいえ）
    - Confirmation prompt (Yes/No) to prevent accidental cancellation
    - 完全なリソースクリーンアップ（録音プロセス、タイマー、一時ファイル）
    - Complete resource cleanup (recording process, timers, temporary files)

### 🛠 Technical Improvements

- **Windows 固有の問題解決** / **Windows-Specific Issue Resolution**
  - signed-integer エンコーディングの明示的指定
  - Explicit signed-integer encoding specification
  - WAV ヘッダー 21 億バイト問題の解決
  - Resolved 2.1GB WAV header issue
  - クロスプラットフォーム安定性の向上
  - Improved cross-platform stability

## [1.6.0] - 2025-10-12

### 🚀 New Features

- **スマートなモデル管理** / **Smart Model Management**
  - API モード → ローカルモード切り替え時の自動モデルダウンロード提案
  - Auto-suggest model download when switching from API mode to Local mode
  - ローカルモデル変更時の存在確認とダウンロード提案
  - Verify model existence and suggest download when changing local models
  - 失敗時の設定自動復元機能
  - Automatic setting restoration on failure

### 🌍 Internationalization

- **全 9 言語対応** / **Full 9-Language Support**
  - 新機能のメッセージを全言語に追加
  - Added new feature messages to all supported languages
  - 日本語、英語、フランス語、ドイツ語、スペイン語、イタリア語、韓国語、ロシア語、中国語
  - Japanese, English, French, German, Spanish, Italian, Korean, Russian, Chinese

### 📹 Documentation & Media

- **GIF 形式デモ** / **GIF Format Demos**
  - MP4 動画を GIF に変換して VS Code Marketplace 対応
  - Converted MP4 videos to GIF format for VS Code Marketplace compatibility
  - `docs/images/` フォルダに整理
  - Organized media files in `docs/images/` folder
  - 全プラットフォームで表示可能
  - Compatible display across all platforms

### 🔧 Technical Improvements

- **設定変更イベント強化** / **Enhanced Configuration Change Events**
  - リアルタイムモデル存在確認
  - Real-time model existence verification
  - ユーザーフレンドリーなエラーハンドリング
  - User-friendly error handling
  - 設定値の自動バックアップ・復元
  - Automatic configuration backup and restoration

## [1.5.2] - 2025-10-12

### 📹 Media Enhancements

- **デモ動画追加** / **Added Demo Videos**
  - README に Focus/Chat モードのデモ動画を追加
  - Added demo videos for Focus/Chat modes in README
  - ヒーロー動画で Copilot Chat 連携をアピール
  - Hero video showcasing Copilot Chat integration
  - 超軽量化（458KB + 549KB）で fast loading
  - Ultra-optimized file sizes (458KB + 549KB) for fast loading

### 🎨 Documentation Improvements

- **視覚的説明の強化** / **Enhanced Visual Documentation**
  - 一目で機能が分かるヒーロー動画配置
  - Hero video placement for instant feature understanding
  - Focus/Chat モードの違いを動画で明確化
  - Clear demonstration of Focus/Chat mode differences

## [1.5.1] - 2025-10-12

### 🚀 New Features

- **2 つの貼り付けボタン** / **Dual Paste Buttons**
  - `📍Focus` ボタン: 録音停止時のエディタ位置に貼り付け
  - `📍Focus` button: Paste at editor position when recording stops
  - `💬Chat` ボタン: Copilot Chat に直接貼り付け
  - `💬Chat` button: Paste directly to Copilot Chat

### 🐛 Bug Fixes

- **タイムアウト処理の修正** / **Fixed Timeout Handling**
  - タイムアウトで録音終了した際に音声が処理されない問題を修正
  - Fixed issue where audio wasn't processed when recording ended by timeout

### 🔧 Improvements

- **コード構造の簡素化** / **Code Structure Simplification**
  - 重複コードの削除と関数の統合
  - Removed duplicate code and unified functions
  - 変数名の改善 (`micInstance` → `soxProcess`)
  - Improved variable naming (`micInstance` → `soxProcess`)
  - より明確なログメッセージ
  - Clearer log messages

## [1.5.0] - 2025-10-12

### 🔧 Internal Changes (Breaking)

- **識別子の統一** / **Unified Identifiers**
  - 内部識別子を `whisperVoiceInput.*` から `voiceToText.*` に変更
  - Changed internal identifiers from `whisperVoiceInput.*` to `voiceToText.*`
  - ⚠️ **破壊的変更**: キーボードショートカットの再設定が必要
  - ⚠️ **Breaking Change**: Keyboard shortcuts need to be reconfigured

## [1.4.4] - 2025-10-11

### 🐛 Critical Bug Fix

- **実行権限の修正** / **Fixed Executable Permissions** ⚠️ **CRITICAL**
  - Windows/Linux/macOS の実行ファイルに実行権限を追加
  - Added execute permissions to Windows/Linux/macOS binaries
  - `.gitattributes` を追加して VSIX パッケージ内でも権限を保持
  - Added `.gitattributes` to preserve permissions in VSIX packages
  - **この修正により、ローカルモード(whisper.cpp)が正常に動作するようになります**
  - **This fix ensures Local mode (whisper.cpp) works correctly**

---

## [1.4.3] - 2025-10-11

### ✨ New Features

- **2 つの貼り付けモード** / **Dual Paste Mode**

  - 📍 **Focus Mode**: エディタのカーソル位置に直接貼り付け
  - 📍 **Focus Mode**: Paste directly to editor cursor position
  - 💬 **Chat Mode**: Copilot Chat の入力欄に貼り付け
  - 💬 **Chat Mode**: Paste to Copilot Chat input field

- **ステータスバーボタン追加** / **Status Bar Buttons Added**
  - 📍 **Focus Button**: エディタに貼り付け用の録音ボタン
  - 📍 **Focus Button**: Record and paste to editor
  - 💬 **Chat Button**: Copilot Chat に貼り付け用の録音ボタン
  - 💬 **Chat Button**: Record and paste to Copilot Chat
  - 録音中は選択したボタンのみ有効（切り替え不可）
  - Only selected button is active during recording (no switching allowed)

### 🐛 Bug Fixes

- **実行権限の修正** / **Fixed Executable Permissions**
  - Windows/Linux/macOS の実行ファイルに実行権限を追加
  - Added execute permissions to Windows/Linux/macOS binaries
  - `.gitattributes` を追加して VSIX パッケージ内でも権限を保持
  - Added `.gitattributes` to preserve permissions in VSIX packages

---

## [1.4.2] - 2025-10-11

### 📖 Documentation

- **ドキュメントの簡素化** / **Simplified Documentation**
  - 過去バージョンの情報(「以前は 700MB の DLL が必要でした」)を削除
  - Removed references to past versions ("Earlier versions required 700MB+ DLLs")
  - 現在必要なファイルのみをシンプルに記載
  - Now only lists currently required files simply and clearly

---

## [1.4.1] - 2025-10-11

### 📖 Documentation

- **CUDA ビルド手順の改善** / **Improved CUDA Build Instructions**

  - 700MB 以上の CUDA DLL のコピーが不要であることを明記
  - Clarified that 700MB+ CUDA DLLs are no longer required
  - 現在のビルド方法では NVIDIA ドライバーから自動的に CUDA 機能を利用
  - Current build method automatically uses CUDA functions from NVIDIA drivers
  - 詳細なビルドコマンド (`-T cuda=12.6`) を追加
  - Added detailed build commands with `-T cuda=12.6` option
  - ユーザーディレクトリへのコピー手順を明確化
  - Clarified steps to copy files to user directory

- **古い情報の削除** / **Removed Outdated Information**
  - 削除済みの `bin/*-custom/` への参照を削除
  - Removed references to deleted `bin/*-custom/` directories
  - 実装しなかった「自動移行」機能の記述を削除
  - Removed mentions of unimplemented "automatic migration" feature
  - バージョンバッジを最新に更新
  - Updated version badge to current version

---

## [1.4.0] - 2025-10-11

### 🎯 Major Changes

- **ユーザーディレクトリへの移行** / **Migration to User Directory**
  - モデルファイルとカスタムビルドをユーザーディレクトリに保存するように変更
  - Changed to save model files and custom builds in user directory
  - 保存場所: `~/.vscode/voice-to-text-copilot/`
  - Location: `~/.vscode/voice-to-text-copilot/`
  - **メリット**: バージョン更新してもデータが消えない!
  - **Benefit**: Data persists across version updates!

### ✨ New Features

- **クリーンアップコマンド** / **Clean Up Command**

  - `Voice to Text: Clean Up` コマンドを追加
  - Added command to remove all user data (models + custom builds)
  - アンインストール前や不要になったデータの削除に便利
  - Useful before uninstalling or removing unnecessary data

- **アンインストール時の通知** / **Uninstall Notification**
  - 拡張機能アンインストール時にデータ削除方法を通知
  - Notifies about data cleanup when extension is uninstalled

### 📂 Directory Structure

```
~/.vscode/voice-to-text-copilot/
  ├─ models/                    # モデルファイル (永続)
  │   ├─ ggml-tiny.bin
  │   ├─ ggml-base.bin
  │   ├─ ggml-small.bin
  │   ├─ ggml-medium.bin
  │   └─ ggml-large.bin
  │
  └─ custom-builds/             # GPU版ビルド (永続)
      ├─ windows/
      ├─ macos/
      └─ linux/
```

### 🔄 Breaking Changes

- **データ保存場所の変更** / **Storage Location Changed**
  - モデルファイルとカスタムビルドの保存場所が変更されました
  - Model files and custom builds storage location has changed
  - **旧バージョンからのアップデート時**: モデルを再ダウンロードしてください
  - **When updating from older versions**: Please re-download models
  - Setup Wizard を実行するか、既存のモデルを手動で `~/.vscode/voice-to-text-copilot/models/` にコピーしてください
  - Run Setup Wizard or manually copy existing models to `~/.vscode/voice-to-text-copilot/models/`

---

## [1.3.1] - 2025-10-11

### ✨ New Features

- **カスタムビルドフォルダーを開くコマンド** / **Open Custom Build Folder Command**
  - `Ctrl+Shift+P` → "Voice to Text: Open Custom Build Folder (for GPU builds)"
  - GPU 版ビルドを配置するフォルダーをワンクリックで開けるように
  - One-click access to the folder for placing GPU builds
  - README.md が存在する場合は、ビルド手順の表示を提案
  - Offers to display build instructions if README.md exists

### 📖 Documentation

- **GPU 版セットアップ手順の改善** / **Improved GPU Build Setup Instructions**
  - カスタムフォルダーへのアクセス方法を明確化
  - Clarified how to access custom build folders
  - コマンドパレットからの簡単アクセス方法を追加
  - Added easy access method via command palette
  - 不要な「カスタムパス設定」オプションを削除してシンプル化
  - Simplified by removing unnecessary "custom path" option

---

## [1.3.0] - 2025-10-11

### 🚀 Major Features

- **GPU 高速化サポート** / **GPU Acceleration Support**

  - カスタムビルドディレクトリ構造の追加
  - Added custom build directory structure for user-built GPU versions
  - Windows: CUDA 版のビルドガイドと配置方法を提供
  - Windows: CUDA build guide and deployment instructions
  - macOS: Metal 版は既に同梱済み、カスタムビルドも可能
  - macOS: Metal version already included, custom builds also supported
  - Linux: CUDA/ROCm/Vulkan 版のビルドガイドを提供
  - Linux: Build guides for CUDA/ROCm/Vulkan versions
  - 優先順位: カスタムビルド → デフォルトビルド → 開発ビルド
  - Priority: custom build → default build → development build

- **Linux 版バイナリ更新** / **Linux Binaries Updated**

  - Linux 版を共有ライブラリ付きで完全ビルド
  - Fully built Linux version with shared libraries
  - WSL2 環境で動作確認済み
  - Verified functionality in WSL2 environment
  - 合計サイズ: ~3.1MB
  - Total size: ~3.1MB

### 📚 Documentation

- **パフォーマンス記述の一般化** / **Generalized Performance Descriptions**

  - 具体的な処理時間の例を削除し、環境依存を強調
  - Removed concrete timing examples, emphasized environment variability
  - GPU 高速化の効果を相対的に記述
  - Described GPU acceleration effects relatively
  - 例: "数倍〜桁違いに速くなる" vs 具体的秒数
  - Example: "few times to order of magnitude faster" vs specific seconds

- **中立的な表現への変更** / **Neutral Wording**

  - API モード推奨の表現を削除し、両モードを対等に紹介
  - Removed API mode recommendation wording, presented both modes equally
  - ユーザーが自分の用途に合わせて選択できるように改善
  - Improved to let users choose based on their needs

- **バイリンガル README 追加** / **Bilingual READMEs Added**
  - 各カスタムビルドディレクトリに日英両言語のガイドを追加
  - Added Japanese and English guides for each custom build directory
  - Windows/macOS/Linux それぞれのビルド手順を詳細に記載
  - Detailed build instructions for Windows/macOS/Linux

### 🔧 Technical Improvements

- **優先順位ロジック実装** / **Priority Logic Implementation**

  - extension.js でカスタムビルドを優先使用する仕組み
  - Mechanism in extension.js to prioritize custom builds
  - 動作確認済み: CUDA 版 → CPU 版のフォールバック
  - Verified: CUDA version → CPU version fallback

- **.gitignore 更新** / **.gitignore Updated**
  - カスタムビルドディレクトリを除外（README を除く）
  - Excluded custom build directories (except READMEs)
  - ユーザー固有の GPU ビルドをバージョン管理対象外に
  - User-specific GPU builds excluded from version control

## [1.2.0] - 2025-10-11

### ✨ Improvements

- **録音時間表示** / **Recording Timer Display**

  - 録音中の経過時間と残り時間をステータスバーにリアルタイム表示
  - Real-time display of elapsed time and remaining time in status bar during recording
  - 例: 🔴 0:45 / 3:00
  - Example: 🔴 0:45 / 3:00

- **エラー通知改善** / **Enhanced Error Notifications**

  - 重要なエラーを通知ポップアップで表示するように改善
  - Critical errors now show notification popups for better visibility
  - 対象: API キー未設定、モデルダウンロード失敗、Whisper 実行ファイル未検出、モデルファイル未検出、音声ファイル空、録音開始失敗
  - Includes: API key missing, model download failed, whisper executable not found, model file not found, empty voice file, recording start failed

- **多言語対応の完全性向上** / **Complete Multi-language Support**

  - 全 9 言語で新しいエラーメッセージを追加
  - Added new error messages across all 9 supported languages
  - ドイツ語と韓国語のモデル説明の不一致を修正
  - Fixed inconsistencies in German and Korean model descriptions

### 🔧 Bug Fixes

- **リポジトリ URL 修正** / **Repository URL Fix**
  - GitHub リポジトリ URL を正しい名前に更新
  - Updated GitHub repository URL to correct name

## [1.1.0] - 2025-10-11

### 🎉 Major Features

- **ローカルモード追加** / **Added Local Mode**

  - whisper.cpp を使用したオフライン音声認識に対応
  - Offline speech recognition using whisper.cpp
  - 完全無料・インターネット接続不要
  - Completely free, no internet required

- **モード選択機能** / **Mode Selection**

  - API モード（クラウド・高精度）とローカルモード（オフライン・無料）から選択可能
  - Choose between API mode (cloud, accurate) and Local mode (offline, free)
  - 設定画面で簡単に切り替え可能
  - Easy switching in settings

- **初回セットアップウィザード** / **Initial Setup Wizard**

  - 初回起動時に自動表示
  - Automatically shown on first launch
  - モード選択と API キー設定/モデルダウンロードをガイド
  - Guides through mode selection and API key setup / model download

- **履歴機能** / **History Feature**

  - 過去 10 件の音声入力結果を保存
  - Saves last 10 transcription results
  - タイムスタンプとモード（API/Local）を記録
  - Records timestamp and mode (API/Local)
  - コマンドパレットから履歴を表示・再利用可能
  - View and reuse history from Command Palette

- **クリップボード保護機能** / **Clipboard Protection**
  - 貼り付け後、元のクリップボード内容を自動復元
  - Automatically restores original clipboard content after pasting
  - 録音中にコピーした内容を保護
  - Protects content copied during recording

### ✨ Improvements

- **ステータスバー表示の強化** / **Enhanced Status Bar**

  - モード表示: `[API]` または `[Local:Small]`
  - Mode indicator: `[API]` or `[Local:Small]`
  - 処理中のアニメーション: $(sync~spin) アイコン
  - Processing animation: $(sync~spin) icon
  - 状態に応じた色分け（warningBackground）
  - Color-coded status (warningBackground)

- **パフォーマンス最適化** / **Performance Optimization**

  - SOX normalization 削除で 1-2 秒高速化
  - 1-2 seconds faster by removing SOX normalization
  - API モードは SOX 変換不要に
  - API mode no longer requires SOX conversion

- **設定変更のリアルタイム反映** / **Real-time Config Updates**

  - モード変更が即座に反映
  - Mode changes reflected immediately
  - 古いファイルの再利用を防止
  - Prevents reuse of old recording files

- **完全な多言語対応** / **Complete Multilingual Support**
  - すべてのユーザー向けメッセージが 9 言語対応
  - All user-facing messages support 9 languages
  - ハードコードされた英語文字列を削除
  - Removed hardcoded English strings

### 🐛 Bug Fixes

- 設定変更後に古い設定が使われる問題を修正
- Fixed issue where old settings were used after configuration changes
- 録音ファイルが削除されず再利用される問題を修正
- Fixed issue where recording files were not deleted and reused

### 📚 Documentation

- README.md を 2 モード対応に更新
- Updated README.md for dual-mode support
- 各モードのメリット・デメリットを明記
- Clearly documented pros/cons of each mode
- トラブルシューティングセクションを拡充
- Expanded troubleshooting section

## [1.0.1] - 2025-10-09

### Initial Release

- OpenAI Whisper API を使用した音声入力機能
- Voice input using OpenAI Whisper API
- 100 以上の言語に対応
- Support for 100+ languages
- 9 言語の UI 対応（日本語、英語、フランス語、スペイン語、中国語、韓国語、ドイツ語、イタリア語、ロシア語）
- UI in 9 languages (Japanese, English, French, Spanish, Chinese, Korean, German, Italian, Russian)
- ステータスバー表示
- Status bar display
- Copilot Chat 対応
- Copilot Chat support
