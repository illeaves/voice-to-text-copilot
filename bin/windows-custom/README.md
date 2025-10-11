# カスタムビルド用ディレクトリ

このディレクトリは、ユーザーが自分でビルドした whisper.cpp バイナリを配置するためのものです。

## 使用方法

1. GPU 対応版(CUDA/ROCm 等)をビルド
2. ビルドしたファイルをこのディレクトリにコピー:

   - `whisper-cli.exe` (必須)
   - `*.dll` (すべての DLL)
   - その他の実行ファイル

3. 拡張機能は以下の優先順位でバイナリを検索します:
   - 1st: `bin/windows-custom/whisper-cli.exe` ← **こちらが優先**
   - 2nd: `bin/windows/whisper-cli.exe` (デフォルトの CPU 版)

## CUDA 版のビルド例

詳細は[ルートの README.md](../../README.md)の「GPU 高速化」セクションを参照してください。

### 必要なファイル

**CUDA 版の場合**:

- `whisper-cli.exe`
- `ggml-cuda.dll` (~88MB)
- `ggml-base.dll`
- `ggml-cpu.dll`
- `ggml.dll`
- `whisper.dll`
- `cudart64_12.dll` (~0.5MB)
- `cublas64_12.dll` (~96MB)
- `cublasLt64_12.dll` (~471MB)
- `nvrtc64_120_0.dll` (~43MB)
- `nvrtc-builtins64_126.dll` (~5MB)
- `nvJitLink_120_0.dll` (~37MB)

**合計サイズ**: 約 740MB

## 注意事項

- このディレクトリは Git の管理対象外です(`.gitignore`に含まれています)
- カスタムビルドは各自の責任で管理してください
- 問題が発生した場合は、このディレクトリの内容を削除すればデフォルトの CPU 版に戻ります

---

# Custom Build Directory (Windows)

This directory is for user-built whisper.cpp binaries.

## Usage

1. Build GPU version (CUDA/ROCm etc.)
2. Copy built files to this directory:

   - `whisper-cli.exe` (required)
   - `*.dll` (all DLL files)
   - Other executable files

3. The extension searches for binaries in this priority order:
   - 1st: `bin/windows-custom/whisper-cli.exe` ← **Used first**
   - 2nd: `bin/windows/whisper-cli.exe` (default CPU version)

## CUDA Build Example

See the "GPU Acceleration" section in [root README.md](../../README.md) for details.

### Required Files

**For CUDA version**:

- `whisper-cli.exe`
- `ggml-cuda.dll` (~88MB)
- `ggml-base.dll`
- `ggml-cpu.dll`
- `ggml.dll`
- `whisper.dll`
- `cudart64_12.dll` (~0.5MB)
- `cublas64_12.dll` (~96MB)
- `cublasLt64_12.dll` (~471MB)
- `nvrtc64_120_0.dll` (~43MB)
- `nvrtc-builtins64_126.dll` (~5MB)
- `nvJitLink_120_0.dll` (~37MB)

**Total size**: ~740MB

## Notes

- This directory is excluded from Git (included in `.gitignore`)
- Custom builds are managed at your own responsibility
- If you encounter issues, delete this directory's contents to revert to the default CPU version
