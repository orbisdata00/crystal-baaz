import React from "react";

const paths = {
  search: [["circle", { cx: 10.8, cy: 10.8, r: 6.4 }], ["path", { d: "m16 16 4.2 4.2" }]],
  bag: [["path", { d: "M5 8h14l1 13H4L5 8Z" }], ["path", { d: "M9 9V6a3 3 0 0 1 6 0v3" }]],
  user: [["circle", { cx: 12, cy: 8, r: 3.5 }], ["path", { d: "M5 21a7 7 0 0 1 14 0" }]],
  menu: [["path", { d: "M4 7h16M4 12h16M4 17h16" }]],
  close: [["path", { d: "m6 6 12 12M18 6 6 18" }]],
  arrow: [["path", { d: "M4 12h15m-6-6 6 6-6 6" }]],
  arrowLeft: [["path", { d: "M20 12H5m7 7-7-7 7-7" }]],
  share: [["circle", { cx: 18, cy: 5, r: 3 }], ["circle", { cx: 6, cy: 12, r: 3 }], ["circle", { cx: 18, cy: 19, r: 3 }], ["path", { d: "m8.7 10.6 6.6-4.2m-6.6 7 6.6 4.2" }]],
  zoom: [["circle", { cx: 10.8, cy: 10.8, r: 6.5 }], ["path", { d: "m16 16 4.2 4.2M10.8 7.8v6m-3-3h6" }]],
  play: [["path", { d: "m8 5 11 7-11 7V5Z", fill: "currentColor", stroke: "none" }]],
  arrowUp: [["path", { d: "m7 14 5-5 5 5" }]],
  download: [["path", { d: "M12 3v12m-5-5 5 5 5-5" }], ["path", { d: "M5 17v3h14v-3" }]],
  check: [["path", { d: "m5 12 4 4L19 6" }]],
  heart: [["path", { d: "M20.8 8.8c0 5-8.8 10-8.8 10s-8.8-5-8.8-10A4.8 4.8 0 0 1 12 6.3a4.8 4.8 0 0 1 8.8 2.5Z" }]],
  plus: [["path", { d: "M12 5v14M5 12h14" }]],
  minus: [["path", { d: "M5 12h14" }]],
  trash: [["path", { d: "M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3" }]],
  star: [["path", { d: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z" }]],
  sparkle: [["path", { d: "m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Zm7 12 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" }]],
  grid: [["rect", { x: 4, y: 4, width: 6, height: 6, rx: 1 }], ["rect", { x: 14, y: 4, width: 6, height: 6, rx: 1 }], ["rect", { x: 4, y: 14, width: 6, height: 6, rx: 1 }], ["rect", { x: 14, y: 14, width: 6, height: 6, rx: 1 }]],
  bracelet: [["circle", { cx: 12, cy: 12, r: 8 }], ["circle", { cx: 12, cy: 12, r: 3, strokeWidth: 1.2 }]],
  ring: [["circle", { cx: 12, cy: 13, r: 6 }], ["path", { d: "m9 6 3-3 3 3M8.7 7.2l-2-1.8M15.3 7.2l2-1.8" }]],
  pendant: [["path", { d: "M8 4h8l4 5-8 11L4 9l4-5Z" }], ["path", { d: "m8 4 4 16 4-16M4 9h16" }]],
  home: [["path", { d: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1V10Z" }]],
  homeTab: [["path", { d: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10Z" }]],
  mic: [["rect", { x: 9, y: 3, width: 6, height: 12, rx: 3 }], ["path", { d: "M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8" }]],
  truck: [["path", { d: "M3 6h11v12H3zM14 10h4l3 3v5h-7z" }], ["circle", { cx: 7.5, cy: 18, r: 1.5 }], ["circle", { cx: 17.5, cy: 18, r: 1.5 }]],
  filter: [["path", { d: "M4 7h16M7 12h10M10 17h4" }], ["circle", { cx: 8, cy: 7, r: 1.5, fill: "currentColor" }], ["circle", { cx: 15, cy: 12, r: 1.5, fill: "currentColor" }], ["circle", { cx: 11, cy: 17, r: 1.5, fill: "currentColor" }]],
  chevron: [["path", { d: "m9 18 6-6-6-6" }]],
  chat: [["path", { d: "M20 11.5a7.5 7.5 0 0 1-11.2 6.5L4 19l1-4.1A7.5 7.5 0 1 1 20 11.5Z" }], ["path", { d: "M8 11.5h.01M12 11.5h.01M16 11.5h.01" }]],
};

export function Icon({ name, size = 19, stroke = 1.7 }) {
  const children = (paths[name] || paths.sparkle).map(([tag, props], index) => React.createElement(tag, { ...props, key: `${name}-${index}` }));
  return React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  }, children);
}
