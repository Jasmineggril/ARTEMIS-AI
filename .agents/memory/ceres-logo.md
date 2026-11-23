---
name: CERES AI Logo
description: Which logo file to use and where it is referenced
---

The official CERES AI logo is `@assets/LOGO_CERES_AI_1782244864205.png` — a clean circular illustration of Ceres (goddess) surrounded by wheat/leaves, with a river and trees inside, and tech circuit nodes on the right.

**Why:** The previous logo (`image_1782242804699.png`) had the full branding card with text beneath it, creating a white rectangle on dark backgrounds. The new logo is just the circular mark.

**How to apply:** In the UI use the web-optimized copy `import ceresLogo from "@assets/LOGO_CERES_AI_web.png"` (192×192, ~57 KB) in Header.tsx, Layout.tsx and Home.tsx. The original `LOGO_CERES_AI_1782244864205.png` (2048×2048, 5.6 MB) is kept only as the high-resolution source — importing it in the app makes every page download 5.6 MB. Do NOT reference the old path.
