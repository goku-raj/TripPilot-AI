const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

// These match the nodes in backend.py: flight -> hotel -> itinerary -> final
const AGENTS = [
  {
    n: "Flight agent",
    d: "AviationStack",
    msg: "Searching flight routes and schedules…",
    at: 0,
  },
  {
    n: "Hotel agent",
    d: "Tavily web search",
    msg: "Comparing hotels by price and location…",
    at: 6,
  },
  {
    n: "Itinerary agent",
    d: "Groq LLM",
    msg: "Writing your day-by-day itinerary…",
    at: 14,
  },
  {
    n: "Final agent",
    d: "Groq LLM",
    msg: "Putting the final plan together…",
    at: 26,
  },
];

let data = null;
let busy = false;

/* ---------- theme ---------- */
function setTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  $("themeIcon").textContent = t === "dark" ? "☀️" : "🌙";
  $("themeTxt").textContent = t === "dark" ? "Light" : "Dark";
  try {
    localStorage.setItem("tp-theme", t);
  } catch (e) {}
}
setTheme(document.documentElement.getAttribute("data-theme"));
$("themeBtn").onclick = () =>
  setTheme(
    document.documentElement.getAttribute("data-theme") === "dark"
      ? "light"
      : "dark",
  );

/* ---------- helpers ---------- */
function toast(m) {
  const t = $("toast");
  t.textContent = m;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2000);
}
function showError(m) {
  const b = $("errorBox");
  b.textContent = m;
  b.classList.remove("hidden");
}
function hideError() {
  $("errorBox").classList.add("hidden");
}
function md(text) {
  const html = window.marked
    ? marked.parse(text || "")
    : esc(text).replace(/\n/g, "<br>");
  return window.DOMPurify ? DOMPurify.sanitize(html) : html;
}
function fmtTime(s) {
  if (!s || s === "Unknown") return "Time n/a";
  const d = new Date(s);
  return isNaN(d)
    ? s
    : d.toLocaleString([], {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/* ---------- parse backend text into cards ---------- */
function field(block, label) {
  const m = block.match(new RegExp("-\\s*" + label + ":\\s*(.+)"));
  return m ? m[1].trim() : "";
}
function parseFlights(txt) {
  const out = [];
  (txt || "").split(/\n\s*---\s*\n/).forEach((b) => {
    const flight = (b.match(/Flight:\s*(.+)/) || [])[1];
    if (!flight || !b.includes("Departure:")) return;
    const dep = (b.split("Departure:")[1] || "").split("Arrival:")[0];
    const arr = b.split("Arrival:")[1] || "";
    out.push({
      airline: (b.match(/Airline:\s*(.+)/) || [])[1] || "Unknown airline",
      flight: flight.trim(),
      status: ((b.match(/Status:\s*(.+)/) || [])[1] || "unknown").trim(),
      depIata: field(dep, "IATA"),
      depAirport: field(dep, "Airport"),
      depTime: field(dep, "Scheduled"),
      depTerm: field(dep, "Terminal"),
      depGate: field(dep, "Gate"),
      arrIata: field(arr, "IATA"),
      arrAirport: field(arr, "Airport"),
      arrTime: field(arr, "Scheduled"),
    });
  });
  return out;
}
function parseHotels(txt) {
  const out = [];
  (txt || "").split(/\n\n(?=\d+\.\s)/).forEach((b) => {
    const m = b.match(/^\d+\.\s+\*\*(.+?)\*\*\s*\n\s*(\S+)\s*\n?\s*([\s\S]*)$/);
    if (m) out.push({ title: m[1], url: m[2], snippet: m[3].trim() });
  });
  return out;
}

/* ---------- render ---------- */
function renderFlights(txt) {
  const list = parseFlights(txt);
  const head = (txt || "").split("\n")[0];
  let html = "";
  if (!list.length) {
    html = `<div class="note">${esc(txt || "No flight data returned.")}</div>`;
  } else {
    html += `<p class="meta" style="margin-bottom:12px">${esc(head)}. AviationStack shows live schedules, not ticket prices.</p><div class="cards">`;
    html += list
      .map(
        (f) => `
      <div class="pass">
        <div class="main">
          <div class="airline">${esc(f.airline)}</div>
          <div class="path"><span>${esc(f.depIata)}</span><span class="line"></span><span>${esc(f.arrIata)}</span></div>
          <div class="times"><span>${esc(fmtTime(f.depTime))}</span><span>${esc(fmtTime(f.arrTime))}</span></div>
          <div class="times"><span>${esc(f.depAirport)}</span><span style="text-align:right">${esc(f.arrAirport)}</span></div>
          <span class="badge ${esc(f.status.toLowerCase())}">${esc(f.status)}</span>
        </div>
        <div class="stub"><span>Flight</span><b>${esc(f.flight)}</b><span>Terminal ${esc(f.depTerm || "N/A")}</span><span>Gate ${esc(f.depGate || "N/A")}</span></div>
      </div>`,
      )
      .join("");
    html += "</div>";
  }
  $("p-flights").innerHTML = html;
}
function renderHotels(txt) {
  const list = parseHotels(txt);
  $("p-hotels").innerHTML = list.length
    ? `<div class="cards">${list
        .map(
          (h) => `
        <div class="hotel"><h4>${esc(h.title)}</h4><p>${esc(h.snippet)}</p>
        <a href="${esc(h.url)}" target="_blank" rel="noopener noreferrer">View details</a></div>`,
        )
        .join("")}</div>`
    : `<div class="note">${esc(txt || "No hotel results returned.")}</div>`;
}
function render(d) {
  $("p-plan").innerHTML = md(d.answer);
  $("p-itinerary").innerHTML = md(d.itinerary);
  renderFlights(d.flight_results);
  renderHotels(d.hotel_results);
  document.querySelectorAll(".md a").forEach((a) => {
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  });
  $("p-flights").classList.add("cards-wrap");
  $("p-hotels").classList.add("cards-wrap");
  $("threadInfo").textContent =
    `Thread ${d.thread_id} · ${d.llm_calls} agent steps`;
  switchTab("plan");
}

/* ---------- tabs ---------- */
function switchTab(name) {
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  ["plan", "flights", "hotels", "itinerary"].forEach((k) =>
    $("p-" + k).classList.toggle("hidden", k !== name),
  );
}
document
  .querySelectorAll(".tab")
  .forEach((t) => (t.onclick = () => switchTab(t.dataset.tab)));

/* ---------- loading animation ---------- */
function guessRoute(q) {
  const from = q.match(
    /from\s+([A-Za-z ]+?)(?:\s+(?:under|for|with|including|in|to)\b|[.,!?]|$)/i,
  );
  const to =
    q.match(
      /\d+\s*days?\s+([A-Za-z ]+?)\s+(?:trip|honeymoon|vacation|holiday)/i,
    ) ||
    q.match(/\bto\s+([A-Za-z ]+?)(?:\s+(?:from|under|for|with)\b|[.,!?]|$)/i);
  return {
    from: from ? from[1].trim() : "Home",
    to: to ? to[1].trim() : "Destination",
  };
}
let timer = null;
function startLoading(query) {
  const r = guessRoute(query);
  $("fromCity").textContent = r.from;
  $("toCity").textContent = r.to;
  $("agents").innerHTML = AGENTS.map(
    (a, i) =>
      `<div class="agent" id="ag${i}"><span class="st"></span><span><b>${a.n}</b>${a.d}</span></div>`,
  ).join("");
  $("loading").classList.remove("hidden");
  const t0 = Date.now();
  const tick = () => {
    const s = (Date.now() - t0) / 1000;
    let cur = 0;
    AGENTS.forEach((a, i) => {
      if (s >= a.at) cur = i;
    });
    AGENTS.forEach((_, i) => {
      const el = $("ag" + i);
      el.className = "agent" + (i < cur ? " done" : i === cur ? " run" : "");
      el.querySelector(".st").textContent = i < cur ? "✓" : "";
    });
    $("statusMsg").textContent = AGENTS[cur].msg;
    $("timer").textContent = Math.floor(s) + "s";
  };
  tick();
  timer = setInterval(tick, 500);
}
function stopLoading() {
  clearInterval(timer);
  $("loading").classList.add("hidden");
}

/* ---------- search ---------- */
async function sendMessage() {
  const message = $("userInput").value.trim();
  if (busy) return;
  hideError();
  if (!message) {
    showError("Please enter your travel request first.");
    return;
  }

  busy = true;
  $("sendBtn").disabled = true;
  $("sendBtn").textContent = "Planning…";
  $("hero").classList.add("compact");
  $("resultSection").classList.add("hidden");
  startLoading(message);

  try {
    // No thread_id: every search is a fresh trip with its own checkpoint thread.
    const res = await fetch("/api/travel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    let json = null;
    try {
      json = await res.json();
    } catch (e) {}
    if (!res.ok || !json || !json.success)
      throw new Error(
        (json && json.error) ||
          `Server error (${res.status}). Check the FastAPI logs.`,
      );

    data = json;
    render(json);
    stopLoading();
    $("resultSection").classList.remove("hidden");
    $("resultSection").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    stopLoading();
    showError(err.message || "Something went wrong.");
  } finally {
    busy = false;
    $("sendBtn").disabled = false;
    $("sendBtn").textContent = "Plan trip";
  }
}

/* ---------- copy & PDF ---------- */
async function copyResult() {
  if (!data) return;
  const text = data.answer || "";
  try {
    await navigator.clipboard.writeText(text);
    toast("Plan copied");
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast("Plan copied");
    } catch (_) {
      toast("Could not copy");
    }
    ta.remove();
  }
}
async function downloadPDF() {
  if (!data) return;
  const btn = $("pdfBtn");
  btn.disabled = true;
  btn.textContent = "Preparing PDF…";
  const doc = document.createElement("div");
  doc.className = "pdf-doc";
  doc.style.cssText = "position:fixed;left:-9999px;top:0";
  doc.innerHTML = `<div class="brand">TripPilot AI · Travel Plan</div>${md(data.answer)}`;
  document.body.appendChild(doc);
  try {
    await html2pdf()
      .set({
        margin: 0.5,
        filename: "trippilot-travel-plan.pdf",
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, backgroundColor: "#ffffff" },
        jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["css", "legacy"] },
      })
      .from(doc)
      .save();
    toast("PDF downloaded");
  } catch (e) {
    showError("Could not download PDF.");
  }
  doc.remove();
  btn.disabled = false;
  btn.textContent = "Download PDF";
}

/* ---------- events ---------- */
const input = $("userInput");
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendMessage();
  }
});
$("sendBtn").onclick = sendMessage;
$("copyBtn").onclick = copyResult;
$("pdfBtn").onclick = downloadPDF;
document.querySelectorAll(".chip").forEach(
  (c) =>
    (c.onclick = () => {
      input.value = c.dataset.prompt;
      input.dispatchEvent(new Event("input"));
      input.focus();
    }),
);

fetch("/health")
  .then((r) => r.json())
  .then(() => {
    $("statusPill").classList.add("on");
    $("statusTxt").textContent = "Online";
  })
  .catch(() => {
    $("statusPill").classList.add("off");
    $("statusTxt").textContent = "Offline";
  });
