# ==========================================================
#  ☁️ Romeo Mamu — ক্লাউডে চালানোর রেসিপি
#
#  এই ফাইলটা Render-কে বলে দেয় Romeo-র জন্য কী কী লাগবে।
#  তোমাকে কিছু করতে হবে না — Render নিজেই পড়ে নেবে।
#
#  বিশেষ সুবিধা: এখানে ffmpeg আর yt-dlp দুটোই থাকবে, তাই
#  ক্লাউডে গান ফোনের চেয়েও ভালো কাজ করবে। 🎵
# ==========================================================

FROM node:20-slim

# ---- গানের জন্য যা যা দরকার ----
#   ffmpeg → গানকে আসল MP3 বানাতে
#   yt-dlp → JioSaavn-এ না পেলে YouTube থেকে আনতে
#
# yt-dlp-র স্বয়ংসম্পূর্ণ বাইনারি ব্যবহার করছি — এতে Python বসাতে
# হয় না, ইমেজ ছোট থাকে আর বিল্ড ভাঙার ঝুঁকিও কম।
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
    && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
         -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && yt-dlp --version \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# আগে শুধু package ফাইল কপি করি — তাহলে কোড বদলালেও
# প্রতিবার নতুন করে সব প্যাকেজ নামাতে হয় না (দ্রুত ডিপ্লয়)
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# Romeo-র গানের অস্থায়ী ফাইল এখানে থাকবে
ENV TMPDIR=/tmp
ENV NODE_ENV=production

# Render এই পোর্টেই ঢুঁ মারবে
EXPOSE 10000

CMD ["node", "index.js"]
