# macOS Custom Build Directory

このディレクトリに配置したバイナリは、デフォルトの `bin/macos/` より優先的に使用されます。

## 📝 基本情報

macOS 版はすでに**Metal 対応版が同梱**されているため、通常はカスタムビルドは不要です。
ただし、以下のような場合にカスタムビルドが有用です:

- CPU 版を試したい場合
- 特定のビルドオプションを有効にしたい場合
- 最新の whisper.cpp を試したい場合

## 🔧 ビルド方法

### CPU 版のビルド

```bash
cd whisper.cpp
rm -rf build
mkdir build && cd build

# CPU版
cmake .. -DCMAKE_BUILD_TYPE=Release
make -j

# ビルドしたファイルをコピー
cp bin/whisper-cli ../../bin/macos-custom/
```

### Metal 版の再ビルド（既存と同じ）

```bash
cd whisper.cpp
rm -rf build
mkdir build && cd build

# Metal版（デフォルト）
cmake .. -DGGML_METAL=ON -DCMAKE_BUILD_TYPE=Release
make -j

# ビルドしたファイルをコピー
cp bin/whisper-cli ../../bin/macos-custom/
```

## 📦 必要なファイル

以下のファイルをこのディレクトリに配置してください:

```
bin/macos-custom/
├── whisper-cli          # 実行ファイル
└── (その他の共有ライブラリ)
```

## 🎯 使い方

1. 上記の手順でビルド
2. `whisper-cli` をこのディレクトリにコピー
3. 拡張機能を再起動（または VS Code をリロード）
4. このディレクトリのバイナリが自動的に優先使用されます

## 🔍 確認方法

VS Code のアウトプットパネル（`Voice to Text + Copilot Chat`）で、どのバイナリが使用されているか確認できます。

---

**注意**: このディレクトリの内容（この README 以外）は Git で追跡されません。

---

# macOS Custom Build Directory (English)

Binaries placed in this directory will be used with priority over the default `bin/macos/`.

## 📝 Basic Information

The macOS version already includes a **Metal-enabled build**, so custom builds are usually unnecessary.
However, custom builds may be useful in the following cases:

- Testing CPU-only version
- Enabling specific build options
- Testing the latest whisper.cpp

## 🔧 Build Instructions

### CPU Version Build

```bash
cd whisper.cpp
rm -rf build
mkdir build && cd build

# CPU version
cmake .. -DCMAKE_BUILD_TYPE=Release
make -j

# Copy built file
cp bin/whisper-cli ../../bin/macos-custom/
```

### Metal Version Rebuild (same as default)

```bash
cd whisper.cpp
rm -rf build
mkdir build && cd build

# Metal version (default)
cmake .. -DGGML_METAL=ON -DCMAKE_BUILD_TYPE=Release
make -j

# Copy built file
cp bin/whisper-cli ../../bin/macos-custom/
```

## 📦 Required Files

Place the following files in this directory:

```
bin/macos-custom/
├── whisper-cli          # Executable
└── (other shared libraries)
```

## 🎯 Usage

1. Build using the steps above
2. Copy `whisper-cli` to this directory
3. Restart the extension (or reload VS Code)
4. Binaries in this directory will be automatically prioritized

## 🔍 Verification

You can check which binary is being used in the VS Code Output panel (`Voice to Text + Copilot Chat`).

---

**Note**: Contents of this directory (except this README) are not tracked by Git.
