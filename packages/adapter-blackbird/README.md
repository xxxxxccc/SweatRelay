# @sweatrelay/adapter-blackbird

Source label: **Blackbird (黑鸟单车) — file-import only**.

黑鸟单车没有公开的开发者 API；本 adapter 走"用户手动导出 GPX/FIT → 工具上传"路径。

## How users export Blackbird rides

1. 打开黑鸟单车 App
2. 进入"我的 → 骑行记录"，点开任意一条
3. 点右上角分享 → 导出文件（GPX 或 FIT）
4. 通过 AirDrop / 微信文件传输助手 把文件拷到 SweatRelay 监听的目录

## Source type

`file-import`

## Why no API

黑鸟单车定位是社交骑行 App，未对外提供开放平台。如果将来开放，把 `BlackbirdFolderAdapter` 留作 fallback，新增 `BlackbirdApiAdapter` 实现同一 `SourceAdapter` 接口即可。
