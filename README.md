# SMAScore

モルック専用ライブ配信オーバーレイシステム（試作）

## ローカルで動作確認する（Windows）

管理画面と Overlay は **同じオリジン** から開く必要があります。  
`file://` で直接開くとタブ間同期が動かない場合があるため、ローカル HTTP サーバーを使ってください。

### 1. PowerShell を開く

### 2. mock フォルダへ移動してサーバーを起動

```powershell
cd C:\Users\user2\Projects\SMAScore\mock
npx.cmd --yes serve -p 8765
```

（プロジェクトを別の場所に置いている場合は、その `mock` フォルダのパスに読み替えてください）

PowerShell では実行ポリシーの影響で `npx` ではなく `npx.cmd` を使用してください。

起動に成功すると、ローカルサーバーの URL が表示されます。

### 3. ブラウザで開く

| 画面 | URL |
|------|-----|
| 設定画面 | http://localhost:8765/setup/ |
| 管理画面 | http://localhost:8765/control/ |
| Overlay | http://localhost:8765/overlay/ |

設定画面で試合を設定して **開始** すると管理画面へ遷移します。管理画面で得点を入力すると Overlay がリアルタイムで更新されます。

### 4. サーバーを停止する

サーバーを起動した PowerShell で `Ctrl + C` を押します。

## 構成

```
mock/
├── setup/       試合設定画面
├── control/     管理画面（スマホ操作）
├── overlay/     配信用 Overlay
└── shared/      設定・同期（Firebase / localStorage）
```

## Firebase リアルタイム同期（別端末）

管理画面（control）と Overlay は **Firebase Realtime Database** で別端末間同期できます。  
Firebase 未設定・未接続時は、従来どおり **localStorage + BroadcastChannel**（同一ブラウザ内）で動作します。

### 1. Firebase 設定を貼り付ける

[mock/shared/firebase.js](mock/shared/firebase.js) の `firebaseConfig` に、Firebase コンソールの Web アプリ設定値を貼り付けてください。

### 2. Realtime Database ルール（例）

Firebase コンソール → Realtime Database → ルール で、試作用途の例:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

本番運用では認証やルーム単位のアクセス制御を検討してください。

### 3. ルーム ID（同一試合の端末を揃える）

control と overlay で **同じルーム ID** を指定します。

- URL パラメータ: `?room=match-a`（例: `/control/?room=match-a` と `/overlay/?room=match-a`）
- 省略時は `default` を使用

### 4. GitHub Pages

`mock/` フォルダを GitHub Pages の公開ディレクトリに指定すれば動作します（ビルド不要・Firebase CDN 利用）。

例:

| 画面 | URL |
|------|-----|
| 設定 | `https://<user>.github.io/<repo>/setup/` |
| 管理 | `https://<user>.github.io/<repo>/control/?room=match-a` |
| Overlay | `https://<user>.github.io/<repo>/overlay/?room=match-a` |

## 補足

- 試合設定は `localStorage`（`smascore-match-config`）、得点データは Firebase + `localStorage` バックアップ（`smascore-game-state`）で管理されます。
- Overlay 表示設定は `smascore-overlay-settings`（localStorage）に保存されます。
- OBS / PRISM では Overlay の URL をブラウザソースとして読み込めます。
- 要件定義は [requirements.md](requirements.md) を参照してください。
