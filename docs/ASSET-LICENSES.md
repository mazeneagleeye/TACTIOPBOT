# Website asset sources and permissions

The site reuses media supplied in `TACTIOPBOT_WEBSITE/public/`. Originals are left in place. The matching `asset-manifest.json` records filenames, measured image dimensions, and intended use.

| Asset group | Source recorded | Public-use permission |
|---|---|---|
| Logos, wallpapers, operator artwork, dashboard art, and maps | User-provided files | Unverified; confirm redistribution rights before public deployment |
| Landing and gameplay videos | User-provided local MP4 files | Unverified; source and permission need confirmation |
| Nine `music/music*.mp4` files | User-provided local MP4 files | Unverified; track titles, codecs, durations, source, and redistribution rights need confirmation |

No third-party media was downloaded for this implementation. The landing videos are muted in markup and are not requested on small screens or when reduced motion/data-saving is enabled. Music playback is not enabled until the owner confirms the files may be streamed publicly.
