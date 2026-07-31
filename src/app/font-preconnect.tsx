"use client";

import ReactDOM from "react-dom";

export function FontPreconnect() {
  ReactDOM.preconnect("https://fonts.googleapis.cn");
  ReactDOM.preconnect("https://fonts.gstatic.cn", { crossOrigin: "anonymous" });
  return null;
}
