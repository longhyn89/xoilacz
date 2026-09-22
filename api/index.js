export const config = {
  runtime: 'edge', // Bắt buộc để chạy nhanh và không bị giới hạn timeout giống Node.js thường
};

const ROOT_DOMAINS = [
  "https://xoilaczzh.cc",
  "https://xoilacz.live",
  "https://xoilacz.io"
];
const FALLBACK_LOGO = "https://i.ibb.co/m5rVgxZB/xoilacz-plugin.png";

const CATEGORIES = [
  { slug: "football", emoji: "⚽" },
  { slug: "basketball", emoji: "🏀" },
  { slug: "tennis", emoji: "🎾" },
  { slug: "badminton", emoji: "🏸" },
  { slug: "volleyball", emoji: "🏐" },
  { slug: "esports", emoji: "🎮" }
];

// Bộ giả mạo người dùng thật cực mạnh để vượt WAF của Xôi Lạc
const STEALTH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
  "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "X-Requested-With": "XMLHttpRequest"
};

// Hàm có Timeout để không bị treo
async function fetchWithTimeout(url, extraHeaders = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { 
      headers: { ...STEALTH_HEADERS, ...extraHeaders }, 
      redirect: "follow", 
      signal: controller.signal 
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

// Tìm tên miền đang hoạt động
async function findWorkingDomain() {
  for (const domain of ROOT_DOMAINS) {
    try {
      const targetUrl = `${domain}/sport/football/load-more/home/page/0/per/1?t=${Math.floor(Date.now() / 1000)}`;
      const res = await fetchWithTimeout(targetUrl, { "Referer": `${domain}/` }, 3000);
      if (res.ok) {
        const text = await res.text();
        // Đảm bảo không dính mã lỗi 1106
        if (!text.includes("error code: 1106") && text.includes("html")) {
          return domain;
        }
      }
    } catch (e) {
      continue;
    }
  }
  return null;
}

export default async function handler(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  // =========================================================
  // DEBUG
  // =========================================================
  if (path.includes("/debug")) {
    const workingDomain = await findWorkingDomain();
    if (workingDomain) {
      return new Response(`=== VERCEL ĐANG HOẠT ĐỘNG TỐT ===\n\n- Đã kết nối thành công tới máy chủ: ${workingDomain}\n- Không bị Cloudflare chặn!`, {
        headers: { "Content-Type": "text/plain;charset=utf-8" }
      });
    } else {
      return new Response(`=== THẤT BẠI ===\n\nVẫn bị chặn WAF hoặc máy chủ đã thay đổi hoàn toàn.`, { status: 500 });
    }
  }

  // =========================================================
  // TRANG PLAY VÀ CHUYỂN HƯỚNG M3U8
  // =========================================================
  if (path.includes("/play")) {
    const targetLink = url.searchParams.get("link");
    if (!targetLink) return new Response("Missing link", { status: 400 });

    try {
      let fullUrl = targetLink;
      if (!fullUrl.startsWith("http")) {
        fullUrl = fullUrl.startsWith("/") ? `${ROOT_DOMAINS[0]}${fullUrl}` : `${ROOT_DOMAINS[0]}/${fullUrl}`;
      }
      
      const response = await fetchWithTimeout(fullUrl, { "Referer": `${ROOT_DOMAINS[0]}/` }, 5000);
      const html = await response.text();
      let m3u8Url = null;

      const listStreamMatch = /var\s+list_stream\s*=\s*(\[\[.*?\]\]);/s.exec(html);
      if (listStreamMatch) {
        try {
          const epsUrl = JSON.parse(listStreamMatch[1].replace(/\\\//g, "/"));
          if (epsUrl && epsUrl.length > 0 && epsUrl[0].length > 0) {
            const embedUrl = `${epsUrl[0][0]}/off-tvc?is_off_add=true`; 
            const embedRes = await fetchWithTimeout(embedUrl, { "Referer": response.url }, 5000);
            const embedHtml = await embedRes.text();
            
            const embedStreamMatch = embedHtml.match(/(?:var|let|const)\s+urlStream\s*=\s*["']([^"']+)["']/);
            if (embedStreamMatch) m3u8Url = embedStreamMatch[1];
          }
        } catch (e) {}
      }

      if (!m3u8Url) {
         const streamMatch = html.match(/(?:var|let|const)\s+urlStream\s*=\s*["']([^"']+)["']/);
         if (streamMatch) m3u8Url = streamMatch[1];
      }

      if (m3u8Url) {
        if (m3u8Url.includes('.flv')) m3u8Url = m3u8Url.replace('.flv', '.m3u8');
        return Response.redirect(m3u8Url, 302);
      } else {
        return new Response("Stream not found or event hasn't started yet.", { status: 404 });
      }
    } catch (error) {
      return new Response("Error fetching stream", { status: 500 });
    }
  }

  // =========================================================
  // SINH FILE M3U (MẶC ĐỊNH)
  // =========================================================
  let m3uContent = "#EXTM3U\n";
  const activeDomain = await findWorkingDomain();
  
  if (!activeDomain) {
    m3uContent += `#EXTINF:-1 tvg-logo="${FALLBACK_LOGO}", ⚠️ VERCEL CŨNG BỊ CHẶN HOẶC MÁY CHỦ SẬP\nhttp://error.localhost\n`;
    return new Response(m3uContent, { headers: { "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8" } });
  }

  const fetchPromises = CATEGORIES.map(async (cat) => {
    try {
      const targetUrl = `${activeDomain}/sport/${cat.slug}/load-more/home/page/0/per/20?t=${Math.floor(Date.now() / 1000)}`;
      const res = await fetchWithTimeout(targetUrl, { "Referer": `${activeDomain}/` }, 5000);
      
      if (!res.ok) return "";
      
      const rawText = await res.text();
      const json = JSON.parse(rawText);
      const html = json?.data?.html;
      if (!html) return "";

      const pattern = /<a\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bredirectPopup\b[^"']*["'])(?=[^>]*\bhref\s*=\s*["']([^"']+)["'])(?=[^>]*\btitle\s*=\s*["']([^"']+)["'])[^>]*>/gi;
      let match;
      let categoryContent = "";

      while ((match = pattern.exec(html)) !== null) {
        let matchLink = match[1];
        if (!matchLink.startsWith("http")) {
          matchLink = matchLink.startsWith("/") ? `${activeDomain}${matchLink}` : `${activeDomain}/${matchLink}`;
        }

        const rawTitle = match[2] || "";
        let finalTitle = rawTitle.trim();
        const timeMatch = rawTitle.match(/^(.*?)\s+lúc\s+(.*?)(?:\s+ngày\s+(.*))?$/i);
        
        if (timeMatch) {
            const matchName = timeMatch[1].trim();
            const matchTime = timeMatch[2].trim().replace(":", "h");
            const matchDate = timeMatch[3] ? timeMatch[3].trim() : "";
            finalTitle = matchDate ? `${matchTime} ngày ${matchDate} ${cat.emoji} ${matchName}` : `${matchTime} ${cat.emoji} ${matchName}`;
        } else {
            finalTitle = `${cat.emoji} ${finalTitle}`;
        }

        const proxyPlayUrl = `${url.origin}/play?link=${encodeURIComponent(matchLink)}`;
        categoryContent += `#EXTINF:-1 tvg-logo="${FALLBACK_LOGO}" group-title="Xôi Lạc Z TV Dự Phòng", ${finalTitle}\n`;
        categoryContent += `${proxyPlayUrl}\n`;
      }

      return categoryContent;
    } catch (e) {
      return "";
    }
  });

  const results = await Promise.all(fetchPromises);
  m3uContent += results.join("");

  return new Response(m3uContent, {
    headers: {
      "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
      "Content-Disposition": 'attachment; filename="xoilac.m3u"',
      "Access-Control-Allow-Origin": "*"
    }
  });
}