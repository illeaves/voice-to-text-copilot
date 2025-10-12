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

module.exports = { PROMPT_PRESETS };
