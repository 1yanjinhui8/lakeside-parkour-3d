# Pages 在线版的外部资源

由 `tools/build-pages.py` 从根目录成品自动解码生成，请勿手改。
原先它们是 `playable.html` 主 module 里的 base64 字符串字面量；
外置后 JS 源码大幅缩小，浏览器可并行下载并走 HTTP 缓存。

| 编号 | 文件 | 原始协议 | gzip | 实际传输 | 解压后 |
|---|---|---|---|---:|---:|
| 01 | `asset-01.glb` | `data:model/gltf-binary` | 否 | 2.91 MB | 2.91 MB |
| 02 | `asset-02.mp3` | `data:audio/mpeg` | 否 | 0.05 MB | 0.05 MB |
| 03 | `asset-03.bin` | `gz:model/gltf-binary` | 是 | 1.75 MB | 7.90 MB |
| 04 | `asset-04.bin` | `gz:model/gltf-binary` | 是 | 1.09 MB | 4.02 MB |
| 05 | `asset-05.bin` | `gz:model/gltf-binary` | 是 | 3.12 MB | 3.98 MB |
| 06 | `asset-06.glb` | `data:model/gltf-binary` | 否 | 1.74 MB | 1.74 MB |
| 07 | `asset-07.glb` | `data:model/gltf-binary` | 否 | 1.61 MB | 1.61 MB |
| 08 | `asset-08.glb` | `data:model/gltf-binary` | 否 | 1.00 MB | 1.00 MB |
| 09 | `asset-09.glb` | `data:model/gltf-binary` | 否 | 1.89 MB | 1.89 MB |
| 10 | `asset-10.glb` | `data:model/gltf-binary` | 否 | 1.71 MB | 1.71 MB |
| 11 | `asset-11.glb` | `data:model/gltf-binary` | 否 | 1.85 MB | 1.85 MB |
| 12 | `asset-12.glb` | `data:model/gltf-binary` | 否 | 1.79 MB | 1.79 MB |
| 13 | `asset-13.bin` | `gz:model/gltf-binary` | 是 | 3.18 MB | 3.97 MB |
| 14 | `asset-14.glb` | `data:model/gltf-binary` | 否 | 1.79 MB | 1.79 MB |

合计 14 项，实际传输 25.46 MB（gzip 资源保留压缩态，避免体积回涨）。

> 根目录 `playable.html` 仍是内联全部资源的单文件成品，供电脑下载双击运行。
> 这里只是 `docs/playable.html`（Pages 在线版）的依赖，玩法与逻辑完全一致。
