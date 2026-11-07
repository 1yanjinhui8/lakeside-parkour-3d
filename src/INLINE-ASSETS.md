# playable.html 里的内联资源（源码占位符对照表）

成品为了「双击即玩、完全离线」，把以下资源以 base64 直接嵌进了 HTML。
它们不是逻辑代码，所以在 `src/` 的源码镜像里被替换成
`OMITTED-NN-X.XXMB-see-INLINE-ASSETS-md` 这样的短标记。

| 编号 | 类型 | base64 字符数 | 约合 |
|---|---|---:|---:|
| 01 | `text/javascript` | 1,697,296 | 1.21 MB |
| 02 | `text/javascript` | 150,928 | 0.11 MB |
| 03 | `text/javascript` | 44,376 | 0.03 MB |
| 04 | `model/gltf-binary` | 4,067,072 | 2.91 MB |
| 05 | `audio/mpeg` | 64,280 | 0.05 MB |
| 06 | `model/gltf-binary` | 2,443,740 | 1.75 MB |
| 07 | `model/gltf-binary` | 1,517,924 | 1.09 MB |
| 08 | `model/gltf-binary` | 4,368,092 | 3.12 MB |
| 09 | `model/gltf-binary` | 2,428,488 | 1.74 MB |
| 10 | `model/gltf-binary` | 2,246,156 | 1.61 MB |
| 11 | `model/gltf-binary` | 1,404,488 | 1.00 MB |
| 12 | `model/gltf-binary` | 2,636,908 | 1.89 MB |
| 13 | `model/gltf-binary` | 2,389,136 | 1.71 MB |
| 14 | `model/gltf-binary` | 2,580,088 | 1.85 MB |
| 15 | `model/gltf-binary` | 2,503,600 | 1.79 MB |
| 16 | `model/gltf-binary` | 4,441,824 | 3.18 MB |
| 17 | `model/gltf-binary` | 2,508,940 | 1.79 MB |

合计 17 项、约 26.8 MB。
three.js 本体另见仓库 `lib/three.module.js`，模型源文件见 `assets/`。
完整可运行的资源仍在 `playable.html` 中，本表只是源码阅读时的索引。
