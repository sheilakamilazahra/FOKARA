
export const CONFIG = {
  mock: false, // false = menggunakan backend FastAPI
  apiBase: "https://fokara-production.up.railway.app",
  minDeteksi: 0.6, // di bawah ini data visual ditandai "tidak memadai"
};

export const MODEL_LABEL = {
  head: "Arah kepala",
  gaze: "Arah pandang"
};

export const TONE = {
  good: ["center", "centre", "front", "neutral"],
  bad: ["down"],
};
