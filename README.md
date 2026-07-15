# SMAScore

モルック専用ライブ配信オーバーレイシステム（試作）

## ローカルで動作確認する（Windows）

管理画面と Overlay は **同じオリジン** から開く必要があります。  
`file://` で直接開くとタブ間同期が動かない場合があるため、Python の簡易 HTTP サーバーを使ってください。

### 1. コマンドプロンプトまたは PowerShell を開く

### 2. mock フォルダへ移動

```powershell
cd C:\Users\user2\Projects\SMAScore\mock
```

（プロジェクトを別の場所に置いている場合は、その `mock` フォルダのパスに読み替えてください）

### 3. 簡易 HTTP サーバーを起動

Python 3 が PATH に通っている場合:

```powershell
python -m http.server 8765
```

`python` が見つからない場合は、Windows の Python ランチャーを試してください:

```powershell
py -m http.server 8765
```

次のような表示が出れば起動成功です。

```
Serving HTTP on :: port 8765 (http://[::]:8765/) ...
```

### 4. ブラウザで2つのタブを開く

| 画面 | URL |
|------|-----|
| 管理画面 | http://localhost:8765/control/ |
| Overlay | http://localhost:8765/overlay/ |

Chrome で両方を開き、管理画面で得点を入力すると Overlay がリアルタイムで更新されます。

### 5. サーバーを停止する

サーバーを起動したターミナルで `Ctrl + C` を押します。

## 構成

```
mock/
├── control/     管理画面（スマホ操作）
├── overlay/     配信用 Overlay
└── shared/      タブ間同期（sync.js）
```

## 補足

- Firebase は未使用です。データは同一ブラウザ内の `localStorage` と `BroadcastChannel` で共有されます。
- OBS / PRISM では Overlay の URL（`http://localhost:8765/overlay/`）をブラウザソースとして読み込めます。
- 要件定義は [requirements.md](requirements.md) を参照してください。
