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
└── shared/      設定・タブ間同期
```

## 補足

- Firebase は未使用です。試合設定は `localStorage`、得点データは同一ブラウザ内の `localStorage` と `BroadcastChannel` で共有されます。
- OBS / PRISM では Overlay の URL（`http://localhost:8765/overlay/`）をブラウザソースとして読み込めます。
- 要件定義は [requirements.md](requirements.md) を参照してください。
