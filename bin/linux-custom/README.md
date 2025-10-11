# Linux Custom Build Directory

このディレクトリに配置したバイナリは、デフォルトの `bin/linux/` より優先的に使用されます。

## 📝 基本情報

Linux 版は CPU 版が同梱されていますが、GPU をお持ちの場合は以下の方法で GPU 版をビルドできます:

- **NVIDIA GPU**: CUDA 版
- **AMD GPU**: ROCm 版
- **汎用 GPU**: Vulkan 版

## 🔧 ビルド方法

### 1. CUDA 版（NVIDIA GPU）

**必要なもの:**

- [CUDA Toolkit](https://developer.nvidia.com/cuda-downloads)
- GCC/G++ コンパイラ

**ビルド手順:**

```bash
cd whisper.cpp
rm -rf build
mkdir build && cd build

# CUDA対応でビルド
cmake .. -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release
make -j

# ビルドしたファイルをコピー
cp bin/whisper-cli ../../bin/linux-custom/
```

### 2. ROCm 版（AMD GPU）

**必要なもの:**

- [ROCm](https://rocmdocs.amd.com/)
- GCC/G++ コンパイラ

**ビルド手順:**

```bash
cd whisper.cpp
rm -rf build
mkdir build && cd build

# ROCm対応でビルド
cmake .. -DGGML_HIPBLAS=ON -DCMAKE_BUILD_TYPE=Release
make -j

# ビルドしたファイルをコピー
cp bin/whisper-cli ../../bin/linux-custom/
```

### 3. Vulkan 版（汎用 GPU）

**必要なもの:**

- Vulkan SDK
- GCC/G++ コンパイラ

**ビルド手順:**

```bash
cd whisper.cpp
rm -rf build
mkdir build && cd build

# Vulkan対応でビルド
cmake .. -DGGML_VULKAN=ON -DCMAKE_BUILD_TYPE=Release
make -j

# ビルドしたファイルをコピー
cp bin/whisper-cli ../../bin/linux-custom/
```

### 4. CPU 版の再ビルド

```bash
cd whisper.cpp
rm -rf build
mkdir build && cd build

# CPU版
cmake .. -DCMAKE_BUILD_TYPE=Release
make -j

# ビルドしたファイルをコピー
cp bin/whisper-cli ../../bin/linux-custom/
```

## 📦 必要なファイル

基本的には `whisper-cli` 実行ファイルのみで OK です。
ただし、CUDA/ROCm 版の場合は対応するランタイムライブラリがシステムにインストールされている必要があります。

```
bin/linux-custom/
└── whisper-cli          # 実行ファイル
```

## 🎯 使い方

1. 上記の手順でビルド
2. `whisper-cli` をこのディレクトリにコピー
3. 実行権限を付与: `chmod +x bin/linux-custom/whisper-cli`
4. 拡張機能を再起動（または VS Code をリロード）
5. このディレクトリのバイナリが自動的に優先使用されます

## 🔍 確認方法

VS Code のアウトプットパネル（`Voice to Text + Copilot Chat`）で、どのバイナリが使用されているか確認できます。

## ⚡ パフォーマンス

- **CUDA 版**: NVIDIA GPU で大幅な高速化が期待できます
- **ROCm 版**: AMD GPU で高速化が期待できます
- **Vulkan 版**: 幅広い GPU で動作しますが、CUDA/ROCm ほどの高速化は期待できません
- **CPU 版**: GPU を使用しませんが、すべての環境で動作します

---

**注意**: このディレクトリの内容（この README 以外）は Git で追跡されません。

---

# Linux Custom Build Directory (English)

Binaries placed in this directory will be used with priority over the default `bin/linux/`.

## 📝 Basic Information

The Linux version includes a CPU build, but if you have a GPU, you can build GPU-accelerated versions:

- **NVIDIA GPU**: CUDA version
- **AMD GPU**: ROCm version
- **Generic GPU**: Vulkan version

## 🔧 Build Instructions

### 1. CUDA Version (NVIDIA GPU)

**Requirements:**

- [CUDA Toolkit](https://developer.nvidia.com/cuda-downloads)
- GCC/G++ compiler

**Build Steps:**

```bash
cd whisper.cpp
rm -rf build
mkdir build && cd build

# Build with CUDA support
cmake .. -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release
make -j

# Copy built file
cp bin/whisper-cli ../../bin/linux-custom/
```

### 2. ROCm Version (AMD GPU)

**Requirements:**

- [ROCm](https://rocmdocs.amd.com/)
- GCC/G++ compiler

**Build Steps:**

```bash
cd whisper.cpp
rm -rf build
mkdir build && cd build

# Build with ROCm support
cmake .. -DGGML_HIPBLAS=ON -DCMAKE_BUILD_TYPE=Release
make -j

# Copy built file
cp bin/whisper-cli ../../bin/linux-custom/
```

### 3. Vulkan Version (Generic GPU)

**Requirements:**

- Vulkan SDK
- GCC/G++ compiler

**Build Steps:**

```bash
cd whisper.cpp
rm -rf build
mkdir build && cd build

# Build with Vulkan support
cmake .. -DGGML_VULKAN=ON -DCMAKE_BUILD_TYPE=Release
make -j

# Copy built file
cp bin/whisper-cli ../../bin/linux-custom/
```

### 4. CPU Version Rebuild

```bash
cd whisper.cpp
rm -rf build
mkdir build && cd build

# CPU version
cmake .. -DCMAKE_BUILD_TYPE=Release
make -j

# Copy built file
cp bin/whisper-cli ../../bin/linux-custom/
```

## 📦 Required Files

Basically, only the `whisper-cli` executable is needed.
However, for CUDA/ROCm versions, corresponding runtime libraries must be installed on your system.

```
bin/linux-custom/
└── whisper-cli          # Executable
```

## 🎯 Usage

1. Build using the steps above
2. Copy `whisper-cli` to this directory
3. Grant execute permission: `chmod +x bin/linux-custom/whisper-cli`
4. Restart the extension (or reload VS Code)
5. Binaries in this directory will be automatically prioritized

## 🔍 Verification

You can check which binary is being used in the VS Code Output panel (`Voice to Text + Copilot Chat`).

## ⚡ Performance

- **CUDA version**: Significant speedup with NVIDIA GPUs
- **ROCm version**: Speedup with AMD GPUs
- **Vulkan version**: Works with a wide range of GPUs, but not as fast as CUDA/ROCm
- **CPU version**: Doesn't use GPU, but works on all systems

---

**Note**: Contents of this directory (except this README) are not tracked by Git.
