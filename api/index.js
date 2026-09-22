export const config = {
  runtime: 'edge',
};

const ORIGIN_URL_STATIC = "https://tinyurl.com/ttthethao5"; // Nguồn 1 (xoilacz1)
const ROOT_DOMAINS = [
  "https://xoilacz.io",
  "https://xoilaczzh.cc",
  "https://xoilacz.live"
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

async function findWorkingDomain() {
  for (const domain of ROOT_DOMAINS) {
    try {
      const targetUrl = `${domain}/sport/football/load-more/home/page/0/per/1?t=${Math.floor(Date.now() / 1000)}`;
      const res = await fetchWithTimeout(targetUrl, { "Referer": `${domain}/` }, 3000);
      if (res.ok) {
        const text = await res.text();
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
  
  // Xác định host đang gọi (Cloudflare Worker hoặc Vercel)
  const clientHost = request.headers.get("x-forwarded-host") || url.host;
  const protocol = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  const baseUrl = `${protocol}://${clientHost}`;

  // =========================================================
  // DEBUG
  // =========================================================
  if (path.includes("/debug")) {
    const workingDomain = await findWorkingDomain();
    if (workingDomain) {
      return new Response(`=== TRẠM KẾT NỐI VERCEL HOẠT ĐỘNG TỐT ===\n\n- Đã kết nối thành công tới: ${workingDomain}`, {
        headers: { "Content-Type": "text/plain;charset=utf-8" }
      });
    } else {
      return new Response(`=== THẤT BẠI ===\n\nVẫn bị chặn WAF hoặc tất cả máy chủ Xôi Lạc đã đổi tên miền.`, { status: 500 });
    }
  }

  // =========================================================
  // PROXY BÓC TÁCH STREAM (NGUỒN 2)
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
          if (epsUrl?.[0]?.[0]) {
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
        return new Response("Stream not found", { status: 404 });
      }
    } catch (error) {
      return new Response("Error fetching stream", { status: 500 });
    }
  }

  // =========================================================
  // SINH FILE M3U GỘP (NGUỒN 1 + NGUỒN 2)
  // =========================================================
  let combinedM3U = "#EXTM3U\n";

  // ---------------------------------------------------------
  // PHẦN A: Lấy dữ liệu Nguồn 1 (Tĩnh)
  // ---------------------------------------------------------
  try {
    const res1 = await fetchWithTimeout(ORIGIN_URL_STATIC, {}, 5000);
    if (res1.ok) {
      const m3uText = await res1.text();
      let keep = false;
      for (let line of m3uText.split(/\r?\n/)) {
        let trimmed = line.trim();
        if (trimmed === "" || trimmed.toUpperCase().startsWith("#EXTM3U")) continue;
        
        if (trimmed.startsWith("#EXTINF")) {
          keep = trimmed.includes('group-title="Hội Quán TV"') || trimmed.includes('group-title="Xôi Lạc Z TV"');
          if (keep) {
            const idx = trimmed.lastIndexOf(",");
            if (idx !== -1) {
              trimmed = trimmed.substring(0, idx) + "," + trimmed.substring(idx + 1).replace(/^\s*\p{Extended_Pictographic}+/gu, '').trim();
            }
          }
        }
        if (keep) {
          combinedM3U += (!trimmed.startsWith("#") ? trimmed.replace(/\.flv$/i, '.m3u8') : trimmed) + "\n";
        }
      }
    }
  } catch (e) {
    console.log("Lỗi nguồn 1");
  }

  // ---------------------------------------------------------
  // PHẦN B: Lấy dữ liệu Nguồn 2 (Live)
  // ---------------------------------------------------------
  const activeDomain = await findWorkingDomain();
  if (activeDomain) {
    const fetchPromises = CATEGORIES.map(async (cat) => {
      try {
        const targetUrl = `${activeDomain}/sport/${cat.slug}/load-more/home/page/0/per/20?t=${Math.floor(Date.now() / 1000)}`;
        const res2 = await fetchWithTimeout(targetUrl, { "Referer": `${activeDomain}/` }, 5000);
        if (!res2.ok) return "";
        
        const rawText = await res2.text();
        const json = JSON.parse(rawText);
        const html = json?.data?.html;
        if (!html) return "";

        const pattern = /<a\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bredirectPopup\b[^"']*["'])(?=[^>]*\bhref\s*=\s*["']([^"']+)["'])(?=[^>]*\btitle\s*=\s*["']([^"']+)["'])[^>]*>/gi;
        let match;
        let categoryContent = "";

        while ((match = pattern.exec(html)) !== null) {
          let matchLink = match[1].startsWith("http") ? match[1] : `${activeDomain}${match[1].startsWith("/") ? "" : "/"}${match[1]}`;
          let rawTitle = match[2] || "";
          let timeMatch = rawTitle.match(/^(.*?)\s+lúc\s+(.*?)(?:\s+ngày\s+(.*))?$/i);
          let finalTitle = timeMatch 
            ? `${timeMatch[2].trim().replace(":", "h")} ${timeMatch[3] ? `ngày ${timeMatch[3].trim()} ` : ""}${cat.emoji} ${timeMatch[1].trim()}` 
            : `${cat.emoji} ${rawTitle.trim()}`;

          categoryContent += `#EXTINF:-1 tvg-logo="${FALLBACK_LOGO}" group-title="Xôi Lạc Z TV Dự Phòng", ${finalTitle}\n`;
          categoryContent += `${baseUrl}/play?link=${encodeURIComponent(matchLink)}\n`;
        }
        return categoryContent;
      } catch (err) { 
        return ""; 
      }
    });

    const results = await Promise.all(fetchPromises);
    combinedM3U += results.join("");
  }

  return new Response(combinedM3U, {
    headers: {
      "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache, no-store, must-revalidate"
    }
  });
}
