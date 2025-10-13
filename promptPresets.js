/**
 * Whisper Prompt Presets
 * プロンプト機能で使用するプリセット定義
 *
 * 職種/分野ごとに整理し、実用的なプリセットを提供
 */

const PROMPT_PRESETS = {
  // ========================================
  // 開発分野別プリセット
  // ========================================

  web: "HTML, CSS, JavaScript, TypeScript, React, Vue, Angular, Next.js, Nuxt.js, component, props, state, API, fetch, async, await, DOM, element, frontend, backend",

  backend:
    "API, REST, GraphQL, endpoint, request, response, database, SQL, NoSQL, MongoDB, PostgreSQL, Redis, authentication, authorization, JWT, token, middleware, server",

  mobile:
    "iOS, Android, Swift, Kotlin, React Native, Flutter, Dart, Xcode, Android Studio, mobile app, push notification, deep link, native, cross-platform",

  ai: "AI, machine learning, deep learning, neural network, model, training, inference, dataset, PyTorch, TensorFlow, scikit-learn, numpy, pandas, GPU, CUDA, embedding, transformer",

  cloud:
    "AWS, Azure, GCP, S3, Lambda, EC2, CloudFormation, Terraform, CDK, Kubernetes, Docker, container, deployment, CI/CD, serverless, microservices",

  devops:
    "Docker, Kubernetes, container, image, pod, deployment, service, CI/CD, pipeline, Jenkins, GitHub Actions, GitLab CI, monitoring, logging, metrics, Prometheus, Grafana",

  // ========================================
  // 言語別プリセット（必要に応じて）
  // ========================================

  javascript:
    "JavaScript, React, Node.js, npm, yarn, async, await, Promise, callback, function, const, let, var, import, export, webpack, babel, ESLint",

  typescript:
    "TypeScript, interface, type, generic, enum, namespace, React, JSX, TSX, decorator, extends, implements, async, await, Promise",

  python:
    "Python, def, class, import, pip, virtual environment, numpy, pandas, matplotlib, async, await, asyncio, Django, Flask, FastAPI, pytest",

  // ========================================
  // 共通ツール（全職種で使用）
  // ========================================

  git: "git, commit, push, pull, branch, merge, rebase, cherry-pick, stash, checkout, reset, fetch, clone, remote, origin, HEAD, conflict, pull request, GitHub, GitLab",

  vscode:
    "VS Code, extension, command palette, settings, workspace, debugger, breakpoint, terminal, IntelliSense, snippet, keybinding, task, launch configuration",
};

// ========================================
// カタカナ技術用語 → 英語 自動変換辞書
// ========================================

/**
 * カタカナで認識された技術用語を英語に自動変換する辞書
 * 日本語で話しても英語表記で出力したい単語を登録
 */
const KATAKANA_TO_ENGLISH = {
  // Git関連
  ギット: "Git",
  コミット: "commit",
  プッシュ: "push",
  プル: "pull",
  ブランチ: "branch",
  マージ: "merge",
  リベース: "rebase",
  チェリーピック: "cherry-pick",
  スタッシュ: "stash",
  チェックアウト: "checkout",
  リセット: "reset",
  フェッチ: "fetch",
  クローン: "clone",
  リモート: "remote",
  オリジン: "origin",
  ヘッド: "HEAD",
  コンフリクト: "conflict",
  プルリクエスト: "pull request",
  プルリク: "pull request",
  ギットハブ: "GitHub",
  ギットラボ: "GitLab",

  // Web開発
  リアクト: "React",
  ビュー: "Vue",
  アングラー: "Angular",
  タイプスクリプト: "TypeScript",
  ジャバスクリプト: "JavaScript",
  コンポーネント: "component",
  プロップス: "props",
  ステート: "state",
  フック: "hook",
  ユーズステート: "useState",
  ユーズエフェクト: "useEffect",
  フロントエンド: "frontend",
  バックエンド: "backend",
  エーピーアイ: "API",
  フェッチ: "fetch",
  アシンク: "async",
  アウェイト: "await",

  // Backend/Database
  データベース: "database",
  エスキューエル: "SQL",
  モンゴディービー: "MongoDB",
  ポストグレス: "PostgreSQL",
  レディス: "Redis",
  エンドポイント: "endpoint",
  リクエスト: "request",
  レスポンス: "response",
  ミドルウェア: "middleware",
  サーバー: "server",
  オーセンティケーション: "authentication",
  認証: "authentication",
  オーソライゼーション: "authorization",
  トークン: "token",

  // Cloud/DevOps
  ドッカー: "Docker",
  クーバネティス: "Kubernetes",
  コンテナ: "container",
  イメージ: "image",
  デプロイ: "deploy",
  デプロイメント: "deployment",
  パイプライン: "pipeline",
  シーアイシーディー: "CI/CD",
  アマゾンウェブサービス: "AWS",
  アジュール: "Azure",
  ラムダ: "Lambda",

  // プログラミング一般
  ファンクション: "function",
  関数: "function",
  メソッド: "method",
  クラス: "class",
  インターフェース: "interface",
  インスタンス: "instance",
  オブジェクト: "object",
  配列: "array",
  アレイ: "array",
  ストリング: "string",
  文字列: "string",
  ナンバー: "number",
  数値: "number",
  ブーリアン: "boolean",
  真偽値: "boolean",
  ヌル: "null",
  アンディファインド: "undefined",
  コンスト: "const",
  レット: "let",
  バー: "var",
  インポート: "import",
  エクスポート: "export",
  リターン: "return",
  イフ: "if",
  エルス: "else",
  フォー: "for",
  ホワイル: "while",
  スイッチ: "switch",
  ケース: "case",
  ブレイク: "break",
  トライ: "try",
  キャッチ: "catch",
  ファイナリー: "finally",
  スロー: "throw",

  // VS Code
  ブイエスコード: "VS Code",
  エクステンション: "extension",
  拡張機能: "extension",
  デバッガー: "debugger",
  ブレークポイント: "breakpoint",
  ターミナル: "terminal",
  スニペット: "snippet",
  ワークスペース: "workspace",

  // その他
  バージョン: "version",
  リリース: "release",
  バグ: "bug",
  フィーチャー: "feature",
  機能: "feature",
  テスト: "test",
  ビルド: "build",
  ランタイム: "runtime",
  コンパイル: "compile",
  トランスパイル: "transpile",
};

module.exports = { PROMPT_PRESETS, KATAKANA_TO_ENGLISH };
