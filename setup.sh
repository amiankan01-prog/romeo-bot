#!/data/data/com.termux/files/usr/bin/bash
# ==========================================================
#   👑 ROMEO MAMU — এক কমান্ডেই সব সেটআপ
#
#   ব্যবহার:
#     bash setup.sh                      → প্রথমবার (নাম্বার চাইবে)
#     bash setup.sh 120363xxxx@g.us     → গ্রুপ ID সেট করে চালু করবে
# ==========================================================

echo ""
echo "   👑  ROMEO MAMU — সেটআপ শুরু হলো"
echo "   ────────────────────────────────"
echo ""

# ---------- ০. Termux-এ চলছে তো? ----------
if [ ! -d /data/data/com.termux/files/usr ]; then
  echo "❌ এই স্ক্রিপ্ট শুধু Termux-এ চলবে।"
  exit 1
fi

# ---------- ১. Node.js + git ----------
echo "① Node.js যাচাই করা হচ্ছে..."
if ! command -v node >/dev/null 2>&1; then
  echo "   Node.js নেই → ইনস্টল করছি (২-৪ মিনিট সময় লাগতে পারে)..."
  pkg update -y
  pkg install nodejs -y
fi

# ⚠️ git অবশ্যই লাগবে — Baileys-এর libsignal প্যাকেজটা GitHub থেকে আসে।
#    আগে git কেবল তখনই ইনস্টল হতো যখন Node নেই — তাই দ্বিতীয়বার
#    (Node থাকায়) git থাকতো না আর `npm install` ফেল করতো।
for TOOL in git unzip; do
  if ! command -v "$TOOL" >/dev/null 2>&1; then
    echo "   $TOOL নেই → ইনস্টল করছি..."
    pkg install "$TOOL" -y
  fi
done

NODE_MAJOR=$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)
if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt 20 ] 2>/dev/null; then
  echo "❌ Node.js ২০ বা তার বেশি দরকার। পাওয়া গেল: $(node -v 2>/dev/null || echo 'কিছুই না')"
  echo "   এই কমান্ড চালিয়ে আবার চেষ্টা করো:  pkg install nodejs -y"
  exit 1
fi
echo "   ✅ Node $(node -v) পাওয়া গেছে"
echo ""

# ---------- ২. লাইব্রেরি ----------
echo "② লাইব্রেরি যাচাই করা হচ্ছে (নতুন কিছু থাকলে ইনস্টল হবে)..."
# ⚠️ সবসময় চালাই — কারণ নতুন ভার্সনে নতুন লাইব্রেরি (যেমন crypto-js) থাকতে পারে,
#    আর node_modules থাকলেই স্কিপ করলে সেটা ইনস্টল হবে না।
# ⚠️ ফেল করলে চুপচাপ এগিয়ে যাবো না — কারণ তাহলে Romeo চলবেই না
if npm install --no-audit --no-fund; then
  echo "   ✅ লাইব্রেরি রেডি"
else
  echo ""
  echo "   ❌ npm install ব্যর্থ হয়েছে। Romeo চলবে না যতক্ষণ না এটা ঠিক হয়।"
  echo ""
  echo "   সাধারণ কারণ ও সমাধান:"
  echo "   ১) ইন্টারনেট/ডেটা বন্ধ → অন করে আবার চালাও"
  echo "   ২) git নেই (libsignal GitHub থেকে আসে) → pkg install git -y"
  echo "   ৩) জায়গা কম → pkg clean"
  echo ""
  echo "   ঠিক করে আবার চালাও:  bash setup.sh $1"
  echo ""
  exit 1
fi
echo ""

# ---------- ২.৫ 🎵 গান ডাউনলোড (ঐচ্ছিক — ব্যর্থ হলেও Romeo চলবে) ----------
if command -v yt-dlp >/dev/null 2>&1; then
  echo "②.⑤ ✅ yt-dlp আছে — গান চালু 🎵"
else
  echo ""
  echo "②.⑤ 🎵 গান — পূর্ণ সাপোর্ট ইনস্টল (সাজেস্টেড)"
  echo "   ─────────────────────────────────"
  echo "   Romeo গান আনবে JioSaavn থেকে — এখনই কাজ করবে।"
  echo "   বাড়তি সুবিধার জন্য ffmpeg + yt-dlp দিলে:"
  echo "     🔸 ffmpeg → গান হবে আসল *MP3* ফাইল"
  echo "     🔸 yt-dlp → JioSaavn-এ না পাওয়া বিরল গান YouTube/SoundCloud থেকে"
  echo ""
  echo "   ⏱️  ~৫-১০ মিনিট, ~১৫০ MB লাগতে পারে (মোবাইল ডেটায় সতর্ক থেকো)"
  echo ""
  read -r -p "   👉 ইনস্টল করবো? (y লিখে Enter = হ্যাঁ, শুধু Enter = পরে): " YN
  echo ""
  if [ "$YN" = "y" ] || [ "$YN" = "Y" ]; then
    echo "   ⏳ ffmpeg ইনস্টল হচ্ছে... ধৈর্য ধরো।"
    pkg install ffmpeg -y
    echo "   ⏳ yt-dlp ইনস্টল হচ্ছে..."
    pkg install python -y
    pip install --upgrade yt-dlp 2>/dev/null ||
      pip install --break-system-packages --upgrade yt-dlp 2>/dev/null ||
      python -m pip install --upgrade yt-dlp 2>/dev/null || true

    command -v ffmpeg >/dev/null 2>&1 && echo "   ✅ ffmpeg রেডি — গান হবে আসল MP3 🎵" || echo "   ⚠️  ffmpeg হয়নি — গান .mp4 (AAC) আসবে, তবুও চলবে"
    command -v yt-dlp >/dev/null 2>&1 && echo "   ✅ yt-dlp রেডি — YouTube ব্যাকআপ চালু" || echo "   ⚠️  yt-dlp হয়নি — শুধু JioSaavn দিয়েই চলবে"
  else
    echo "   ⏭️  এখন নয় — পরে যেকোনো সময়:"
    echo "      pkg install ffmpeg python -y && pip install yt-dlp"
    echo "      তারপর Romeo বন্ধ করে আবার 'npm start' দিলেই চালু হবে।"
  fi
fi
echo ""

# ---------- ৩. নাম্বার ----------
if [ ! -f .env ]; then
  cp .env.example .env
  echo "③ তোমার WhatsApp নাম্বার দরকার"
  echo "   ─────────────────────────────────"
  echo "   নিয়ম: দেশের কোড + ১০ সংখ্যা। কোনো + চিহ্ন, স্পেস বা ড্যাশ নেই।"
  echo "   ভারত হলে: 91 তারপর তোমার নাম্বার"
  echo "   উদাহরণ:  919876543210"
  echo ""
  read -r -p "   👉 এখানে নাম্বার লেখো: " NUM
  NUM=$(printf '%s' "$NUM" | tr -cd '0-9')

  if [ ${#NUM} -lt 10 ]; then
    echo ""
    echo "❌ নাম্বারটা ঠিক পাইনি (খুব ছোট)। আবার চালাও:  bash setup.sh"
    rm -f .env
    exit 1
  fi

  sed -i "s/BOT_NUMBER=.*/BOT_NUMBER=$NUM/" .env
  sed -i "s/OWNER_NUMBER=.*/OWNER_NUMBER=$NUM/" .env
  echo ""
  echo "   ✅ নাম্বার সেভ হয়েছে: $NUM"
fi
echo ""

# ---------- ৩.৫ Gemini API key (AI-এর জন্য) ----------
if ! grep -q "^GEMINI_API_KEY=.\+" .env 2>/dev/null; then
  echo "④ 🤖 Gemini API key — Romeo-কে বুদ্ধি দিতে"
  echo "   ─────────────────────────────────"
  echo "   এটা একদম ফ্রি, কোনো কার্ড লাগবে না।"
  echo "   ফোনের ব্রাউজারে যাও:  aistudio.google.com/apikey"
  echo "   → 'Create API key' → কপি করো → এখানে পেস্ট করো"
  echo ""
  echo "   (এখন না দিলে Romeo শুধু মজার কমান্ডগুলো করবে, AI বন্ধ থাকবে)"
  echo ""
  read -r -p "   👉 API key পেস্ট করো (ছেড়ে দিতে চাইলে Enter): " AKEY
  AKEY=$(printf '%s' "$AKEY" | tr -d ' \r\n')

  if [ -n "$AKEY" ]; then
    sed -i "s|^GEMINI_API_KEY=.*|GEMINI_API_KEY=$AKEY|" .env
    echo ""
    echo "   ✅ AI key সেভ হয়েছে — Romeo এখন বুদ্ধিমান! 🧠"
  else
    echo ""
    echo "   ⏭️  এখন ছাড়লে — পরে যেকোনো সময় বসাতে পারবে।"
  fi
  echo ""
fi

# ---------- ৪. গ্রুপ ID ----------
# ⚠️ অনেক গ্রুপে Romeo চাইতে পারো — তাই ডিফল্টভাবে *যোগ* করি, বদলাই না।
#    আগের মতো বদলাতে চাইলে:  bash setup.sh --reset <ID>
add_group () {
  local GID="$1"
  [ -z "$GID" ] && return
  # আগে থেকে আছে কিনা
  if grep -q "$GID" .env 2>/dev/null; then
    echo "   ℹ️  এই গ্রুপটা আগেই যোগ করা আছে: $GID"
    return
  fi
  local CUR
  CUR=$(grep '^ALLOWED_GROUPS=' .env 2>/dev/null | cut -d= -f2-)
  if [ -z "$CUR" ]; then
    sed -i "s|^ALLOWED_GROUPS=.*|ALLOWED_GROUPS=$GID|" .env
  else
    sed -i "s|^ALLOWED_GROUPS=.*|ALLOWED_GROUPS=$CUR,$GID|" .env
  fi
  echo "   ✅ গ্রুপ যোগ হলো: $GID"
}

if [ "$1" = "--reset" ]; then
  if [ -n "$2" ]; then
    sed -i "s|^ALLOWED_GROUPS=.*|ALLOWED_GROUPS=$2|" .env
    echo "④ গ্রুপ রিসেট — শুধু এইটিতে কাজ করবে: $2"
  else
    sed -i "s|^ALLOWED_GROUPS=.*|ALLOWED_GROUPS=|" .env
    echo "④ সব গ্রুপ মুছে দিলাম (discovery mode)"
  fi
  echo ""
elif [ -n "$1" ]; then
  echo "④ গ্রুপ সেট করা হচ্ছে..."
  add_group "$1"
  echo ""
fi

# কোথায় কোথায় কাজ করবে দেখিয়ে দিই
echo ""
echo "   📋 Romeo এই গ্রুপগুলোতে কাজ করবে:"
grep '^ALLOWED_GROUPS=' .env 2>/dev/null | cut -d= -f2- | tr ',' '\n' | while read -r G; do
  [ -n "$G" ] && echo "      • $G"
done
echo ""

# ---------- ৫. ওয়েক-লক (থাকলে) ----------
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock

# ---------- ৬. চালু ----------
echo "⑤ Romeo চালু হচ্ছে..."
echo "   ─────────────────────────────────"
echo "   বন্ধ করতে:  Volume Up + C   (অথবা Ctrl+C)"
echo ""
npm start
